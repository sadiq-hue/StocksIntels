require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pool } = require('./db');

// ── Mistral OCR (replicated from jsParser.callMistralOcr) ──
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest';
function mistralOcr(buffer) {
  return new Promise((resolve) => {
    if (!MISTRAL_API_KEY) return resolve(null);
    const data = JSON.stringify({ model: MISTRAL_OCR_MODEL, document: { type: 'document_url', document_url: 'data:application/pdf;base64,' + buffer.toString('base64') }, include_image_base64: false });
    const url = new URL('https://api.mistral.ai/v1/ocr');
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + MISTRAL_API_KEY, 'Content-Length': Buffer.byteLength(data) }, timeout: 120000 }, (res) => {
      let chunks = ''; res.on('data', c => chunks += c);
      res.on('end', () => { try { const j = JSON.parse(chunks); resolve(Array.isArray(j.pages) ? j.pages.map(p => p.markdown || '').join('\n\n') : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(data); req.end();
  });
}

// ── matcher (copied from verifyNseData.js) ──
const SCALES = [1, 1e3, 1e6, 1e9];
const PER_SHARE = new Set(['eps', 'dividend_per_share']);
const COMPUTED = new Set(['total_debt', 'cash_from_operations']);
const VERIFIED = 0.02, WEAK = 0.10;
function numbersFromText(text) {
  const nums = []; const re = /\(?-?[\d][\d,]*\.?\d*\)?|\(\s*[\d][\d,]*\.?\d*\s*\)/g; let m;
  while ((m = re.exec(text)) !== null) {
    let tok = m[0].replace(/,/g, '').replace(/[()]/g, '').trim();
    if (tok === '' || isNaN(Number(tok))) continue;
    let val = Number(tok); if (m[0].includes('(') || m[0].includes('-')) val = -Math.abs(val);
    nums.push(val);
  } return nums;
}
function detectScale(text) {
  const t = text.toLowerCase();
  if (/\bbillion\b|\bbn\b/.test(t)) return 1e9;
  if (/\bmillion\b|\bmn\b|\bm\s/.test(t)) return 1e6;
  if (/['’]\s?000|\bthousand\b/.test(t)) return 1e3;
  return 1;
}
function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1); }
function bestMatch(V, nums, detectedScale) {
  let best = { err: Infinity, scale: 1, matched: null };
  for (const n of nums) for (const mult of SCALES) { const c = n * mult; const e = rel(V, c); if (e < best.err) best = { err: e, scale: mult, matched: c }; }
  return best;
}
function verifyOne(parsed, nums, detectedScale, text, company, ticker) {
  const results = {}; let verified = 0, weak = 0, mismatch = 0, zero = 0, n = 0;
  for (const [k, v] of Object.entries(parsed || {})) {
    if (v === null || v === undefined) continue; n++;
    if (Number(v) === 0) { results[k] = { status: 'zero', value: v }; zero++; continue; }
    const V = Number(v); const bm = bestMatch(V, nums, detectedScale);
    let status = bm.err <= VERIFIED ? 'verified' : bm.err <= WEAK ? 'weak' : 'mismatch';
    let scaleWarn = false;
    if (status === 'verified' && !PER_SHARE.has(k) && bm.scale !== detectedScale) scaleWarn = true;
    if (status === 'verified') verified++; else if (status === 'weak') weak++; else mismatch++;
    results[k] = { status, value: V, pdf_match: bm.matched, rel_err: +bm.err.toFixed(4), pdf_scale: bm.scale, detected_scale: detectedScale, scale_warn: scaleWarn, note: COMPUTED.has(k) ? 'computed' : (PER_SHARE.has(k) ? 'per_share' : 'reported') };
  }
  return { results, summary: { verified, weak, mismatch, zero, total: n } };
}

function download(url, dest) {
  if (fs.existsSync(dest)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'GET', insecureHTTPParser: true, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/pdf,*/*' }, timeout: 30000 }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) { res.resume(); return download(new URL(res.headers.location, url).toString(), dest).then(resolve, () => resolve(false)); }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const f = fs.createWriteStream(dest); res.pipe(f);
      f.on('finish', () => f.close(() => resolve(true)));
    });
    req.on('error', () => resolve(false)); req.on('timeout', () => req.destroy()); req.end();
  });
}

(async () => {
  // Determine which statements to OCR-verify: those that were unverifiable OR had mismatches in the pypdf run.
  const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'verify_report.json'), 'utf8'));
  const targets = new Set();
  for (const s of prev) {
    if (s.status !== 'done' || (s.summary && s.summary.mismatch > 0)) targets.add(s.ticker + '|' + s.period);
  }
  console.log('Statements to OCR-verify:', targets.size);

  const rows = await pool.query(
    `SELECT fs.id, s.ticker, s.name AS company, fs.period_end_date, fs.file_name, fs.parsed_data
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE' AND fs.status='completed'`
  );
  const filings = await pool.query(`SELECT filename, pdf_url FROM nse_report_filings`);
  const byName = {}; for (const f of filings.rows) byName[f.filename] = f.pdf_url;
  const dir = path.join(__dirname, 'verify_pdfs'); fs.mkdirSync(dir, { recursive: true });

  const report = [];
  let overall = { verified: 0, weak: 0, mismatch: 0, zero: 0, ocr_failed: 0, statements: 0 };
  let done = 0;
  for (const r of rows.rows) {
    const key = r.ticker + '|' + (r.period_end_date ? r.period_end_date.toISOString().slice(0,10) : null);
    if (!targets.has(key)) continue;
    const url = byName[r.file_name];
    let status = 'ocr_failed', detail = 'no url';
    if (url) {
      const dest = path.join(dir, r.file_name);
      if (await download(url, dest)) {
        const buf = fs.readFileSync(dest);
        const text = await mistralOcr(buf);
        if (text && text.trim()) {
          const nums = numbersFromText(text);
          const scale = detectScale(text);
          const res = verifyOne(r.parsed_data, nums, scale, text, r.company, r.ticker);
          status = 'done'; detail = '';
          overall.verified += res.summary.verified; overall.weak += res.summary.weak;
          overall.mismatch += res.summary.mismatch; overall.zero += res.summary.zero;
          report.push({ ticker: r.ticker, period: key.split('|')[1], file: r.file_name, ocr_chars: text.length, summary: res.summary, results: res.results, method: 'mistral-ocr' });
          done++;
          process.stdout.write(`${r.ticker} OCR ${res.summary.verified}v/${res.summary.weak}w/${res.summary.mismatch}x/${res.summary.zero}z\n`);
          continue;
        } else detail = 'ocr failed';
      } else detail = 'download failed';
      overall.ocr_failed++;
    }
    report.push({ ticker: r.ticker, period: key.split('|')[1], file: r.file_name, status, detail, method: 'mistral-ocr' });
    process.stdout.write(`${r.ticker} ${status}: ${detail}\n`);
  }
  fs.writeFileSync(path.join(__dirname, 'verify_report_ocr.json'), JSON.stringify(report, null, 2));
  console.log('\n=== OCR VERIFY SUMMARY ===');
  console.log(JSON.stringify(overall, null, 2));
  console.log('report -> verify_report_ocr.json');
  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
