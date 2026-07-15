require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');
const { pool } = require('./db');

const SCALES = [1, 1e3, 1e6, 1e9];
const PER_SHARE = new Set(['eps', 'dividend_per_share']);
const COMPUTED = new Set(['total_debt', 'cash_from_operations']);
const VERIFIED = 0.02, WEAK = 0.10;

function downloadOne(url, dest) {
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'GET', insecureHTTPParser: true,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/pdf,*/*' }, timeout: 30000,
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return downloadOne(new URL(res.headers.location, url).toString(), dest).then(resolve, () => resolve(false));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(true)));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return true;
  for (let i = 0; i < 3; i++) {
    if (await downloadOne(url, dest)) return true;
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

function extractText(pdfPath) {
  try {
    const out = execFileSync('python', [path.join(__dirname, 'verify_extract.py'), pdfPath], { encoding: 'utf8', timeout: 30000 });
    const j = JSON.parse(out);
    return j;
  } catch (e) { return { chars: 0, text: '', error: e.message.slice(0, 120) }; }
}

// Pull every numeric token from the PDF text, returning {n, raw} with sign handling.
function numbersFromText(text) {
  const nums = [];
  const re = /\(?-?[\d][\d,]*\.?\d*\)?|\(\s*[\d][\d,]*\.?\d*\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let tok = m[0].replace(/,/g, '').replace(/[()]/g, '').trim();
    if (tok === '' || isNaN(Number(tok))) continue;
    let val = Number(tok);
    if (m[0].includes('(') || m[0].includes('-')) val = -Math.abs(val);
    nums.push(val);
  }
  return nums;
}

function detectScale(text) {
  const t = text.toLowerCase();
  if (/\bbillion\b|\bbn\b/.test(t)) return 1e9;
  if (/\bmillion\b|\bmn\b|\bm\s/.test(t)) return 1e6;
  if (/['’]\s?000|\bthousand\b/.test(t)) return 1e3;
  return 1;
}

function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1); }

// For value V, find best scaled match among pdf numbers. Returns {err, scale, matched}.
function bestMatch(V, nums, detectedScale) {
  let best = { err: Infinity, scale: 1, matched: null };
  for (const n of nums) {
    for (const mult of SCALES) {
      const c = n * mult;
      const e = rel(V, c);
      if (e < best.err) best = { err: e, scale: mult, matched: c };
    }
  }
  return best;
}

function verifyOne(parsed, nums, detectedScale, text, company, ticker) {
  const results = {};
  let verified = 0, weak = 0, mismatch = 0, zero = 0, n = 0;
  for (const [k, v] of Object.entries(parsed || {})) {
    if (v === null || v === undefined) continue;
    n++;
    if (Number(v) === 0) { results[k] = { status: 'zero', value: v }; zero++; continue; }
    const V = Number(v);
    const bm = bestMatch(V, nums, detectedScale);
    let status;
    if (bm.err <= VERIFIED) status = 'verified';
    else if (bm.err <= WEAK) status = 'weak';
    else status = 'mismatch';
    let scaleWarn = false;
    if (status === 'verified' && !PER_SHARE.has(k) && bm.scale !== detectedScale) scaleWarn = true;
    if (status === 'verified') verified++;
    else if (status === 'weak') weak++;
    else mismatch++;
    const note = COMPUTED.has(k) ? 'computed' : (PER_SHARE.has(k) ? 'per_share' : 'reported');
    results[k] = { status, value: V, pdf_match: bm.matched, rel_err: +bm.err.toFixed(4), pdf_scale: bm.scale, detected_scale: detectedScale, scale_warn: scaleWarn, note };
  }
  // company presence check
  const cname = (company || '').replace(/\b(PLC|Ltd|Limited|Group|Kenya|Holdings|PLC)\b/gi, '').replace(/\s+/g, ' ').trim();
  const tokens = cname.split(' ').filter(w => w.length > 3);
  const companyOk = tokens.some(tok => text.toLowerCase().includes(tok.toLowerCase())) || text.toUpperCase().includes(ticker);
  return { results, summary: { verified, weak, mismatch, zero, total: n }, companyOk };
}

(async () => {
  const filter = process.env.TICKER ? `AND s.ticker = $2` : '';
  const params = ['completed'];
  if (process.env.TICKER) params.push(process.env.TICKER);
  const rows = await pool.query(
    `SELECT fs.id AS stmt_id, s.ticker, s.name AS company, fs.period_end_date, fs.file_name, fs.parsed_data
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market = 'NSE' AND fs.status = $1 ${filter}
     ORDER BY s.ticker, fs.period_end_date`,
    params
  );

  // map filings by filename for pdf_url
  const filings = await pool.query(`SELECT filename, pdf_url FROM nse_report_filings`);
  const byName = {};
  for (const f of filings.rows) byName[f.filename] = f.pdf_url;

  const dir = path.join(__dirname, 'verify_pdfs');
  fs.mkdirSync(dir, { recursive: true });

  const report = [];
  let overall = { verified: 0, weak: 0, mismatch: 0, zero: 0, unverifiable: 0, company_mismatch: 0, statements: 0 };

  for (const r of rows.rows) {
    const fn = r.file_name;
    const url = byName[fn];
    let status = 'unverifiable', detail = 'no filing url';
    let res = null;
    if (url) {
      const dest = path.join(dir, fn);
      const ok = await download(url, dest);
      if (ok) {
        const ex = extractText(dest);
        if (ex.chars < 200) { status = 'unverifiable'; detail = 'scanned/encrypted: ' + (ex.error || 'low text'); }
        else {
          const nums = numbersFromText(ex.text);
          const scale = detectScale(ex.text);
          res = verifyOne(r.parsed_data, nums, scale, ex.text, r.company, r.ticker);
          status = 'done';
          detail = '';
          overall.verified += res.summary.verified;
          overall.weak += res.summary.weak;
          overall.mismatch += res.summary.mismatch;
          overall.zero += res.summary.zero;
          if (!res.companyOk) overall.company_mismatch++;
        }
      } else { detail = 'download failed'; }
    }
    overall.statements++;
    if (status === 'unverifiable') overall.unverifiable++;
    report.push({
      ticker: r.ticker, period: r.period_end_date ? r.period_end_date.toISOString().slice(0,10) : null,
      file: fn, status, detail,
      company_ok: res ? res.companyOk : null,
      summary: res ? res.summary : null,
      results: res ? res.results : null,
    });
    process.stdout.write(`${r.ticker} ${status === 'done' ? (res.summary.verified+'v/'+res.summary.weak+'w/'+res.summary.mismatch+'x/'+res.summary.zero+'z') : detail}\n`);
  }

  const outFile = path.join(__dirname, 'verify_report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(overall, null, 2));
  console.log('report ->', outFile);
  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
