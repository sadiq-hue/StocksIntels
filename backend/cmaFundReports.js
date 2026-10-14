// CMA quarterly report importer.
//
// Downloads the latest CMA "Quarterly Capital Markets Statistical Bulletin",
// extracts its text (poppler `pdftotext`, which ships in the image) and ingests:
//   • Table 36 — Market Share of Assets under Management (AUM) by scheme
//   • Table 37 — Distribution of funds by asset class
// Data is scheme/industry-level and quarterly — stored separately from the
// sub-fund directory and shown as market context with full provenance.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const { pool } = require('./db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SITEMAP = 'https://www.cma.or.ke/wp-sitemap-posts-wpfd_file-1.xml';
const BULLETIN_SLUG_RE = /(quarterly-statistical-bulletin|quarterly-bulletin|cis-report)/i;

async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS special_fund_schemes (
        period TEXT NOT NULL,
        scheme TEXT NOT NULL,
        aum NUMERIC(20,2),
        prev_aum NUMERIC(20,2),
        pct_change NUMERIC(8,2),
        market_share NUMERIC(8,2),
        source TEXT,
        source_url TEXT,
        published_at TIMESTAMPTZ,
        observation_date DATE,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (period, scheme)
      );`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS special_fund_asset_classes (
        period TEXT NOT NULL,
        asset_class TEXT NOT NULL,
        amount NUMERIC(20,2),
        prev_amount NUMERIC(20,2),
        proportion NUMERIC(8,2),
        change_pct NUMERIC(10,2),
        source TEXT,
        source_url TEXT,
        observation_date DATE,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (period, asset_class)
      );`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sfs_period ON special_fund_schemes(period)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sfac_period ON special_fund_asset_classes(period)');
  } catch (e) {
    console.error('[CMAFunds] ensureTable failed:', e.message);
  }
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 60 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// Extract text from a PDF buffer — prefer poppler pdftotext (present in the
// image), fall back to the pdf-parse module if available.
async function extractPdfText(buf, hint = 'cma') {
  const tmp = path.join(os.tmpdir(), `${hint}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    const out = await execFileP('pdftotext', ['-layout', tmp, '-']);
    if (out && out.trim().length > 100) return out;
  } catch (e) {
    // fall through to pdf-parse
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
  try {
    const mod = require('pdf-parse');
    const Parser = mod.PDFParse || mod;
    if (mod.PDFParse) {
      const p = new mod.PDFParse({ data: new Uint8Array(buf) });
      const r = await p.getText();
      await p.destroy?.();
      return (r && r.text) || '';
    }
    const r = await Parser(buf);
    return (r && r.text) || '';
  } catch (e) {
    throw new Error(`PDF text extraction failed (pdftotext + pdf-parse): ${e.message}`);
  }
}

// Find the latest quarterly bulletin's direct PDF URL from the CMA file sitemap.
async function findLatestBulletin() {
  const { data: xml } = await axios.get(SITEMAP, { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'text' });
  const entries = [];
  const re = /<url>\s*<loc>(.*?)<\/loc>\s*<lastmod>(.*?)<\/lastmod>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1];
    if (!loc.includes('/wpfd_file/')) continue;
    if (!BULLETIN_SLUG_RE.test(loc)) continue;
    entries.push({ loc, lastmod: m[2] });
  }
  if (!entries.length) throw new Error('No CMA bulletin found in sitemap');
  entries.sort((a, b) => new Date(b.lastmod) - new Date(a.lastmod));
  const page = entries[0].loc;
  // Resolve the direct /download/.../.pdf link from the file page.
  const { data: html } = await axios.get(page, { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'text' });
  const pdf = html.match(/https:\/\/www\.cma\.or\.ke\/download\/[0-9]+\/[0-9]+\/[0-9]+\/[^"']+\.pdf/i);
  if (!pdf) throw new Error('Could not resolve bulletin PDF url');
  return { page, pdfUrl: pdf[0], lastmod: entries[0].lastmod };
}

// Parse "Table 36: Market Share of AUM" → [{ scheme, aum, prevAum, pctChange, marketShare }]
function parseSchemeTable(text) {
  const start = text.lastIndexOf('Market Share of Assets under Management');
  if (start < 0) return [];
  const section = text.slice(start, start + 8000);
  const rows = [];
  const lineRe = /^\s*\d+\s+(.+?)\s+([\d,]{6,})\s+([\d,]{6,})\s+(-?[\d.]+)%\s+([\d.]+)%\s*$/gm;
  let m;
  while ((m = lineRe.exec(section)) !== null) {
    rows.push({
      scheme: m[1].trim(),
      aum: Number(m[2].replace(/,/g, '')),
      prevAum: Number(m[3].replace(/,/g, '')),
      pctChange: Number(m[4]),
      marketShare: Number(m[5]),
    });
  }
  return rows;
}

// Parse "Table 37" asset-class distribution.
function parseAssetClassTable(text) {
  const start = text.lastIndexOf('Distribution of funds by Asset Class');
  if (start < 0) return [];
  const section = text.slice(start, start + 2500);
  const rows = [];
  const lineRe = /^\s*([A-Za-z][A-Za-z &()'\-]+?)\s+([\d,]{6,})\s+([\d,]{6,})\s+([\d.]+)%\s+(-?[\d.]+)%\s*$/gm;
  let m;
  while ((m = lineRe.exec(section)) !== null) {
    const name = m[1].trim();
    if (/^total$/i.test(name)) continue;
    rows.push({
      assetClass: name,
      amount: Number(m[2].replace(/,/g, '')),
      prevAmount: Number(m[3].replace(/,/g, '')),
      proportion: Number(m[4]),
      changePct: Number(m[5]),
    });
  }
  return rows;
}

// "as at March 2026" / "as at June 2026" → { period: '2026-03', date: '2026-03-31' } + quarter label
function parsePeriod(text) {
  const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const m = text.match(/as at ([A-Z][a-z]+)\s+(20\d{2})/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mm = MONTHS[m[1].toLowerCase()];
    const lastDay = new Date(Number(m[2]), Number(mm), 0).getDate();
    return { period: `${m[2]}-${mm}`, observationDate: `${m[2]}-${mm}-${String(lastDay).padStart(2, '0')}` };
  }
  const now = new Date();
  return { period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, observationDate: new Date().toISOString().slice(0, 10) };
}

async function importLatest() {
  const result = { ok: false, source: null, period: null, schemes: 0, assetClasses: 0, error: null };
  try {
    await ensureTable();
    const { pdfUrl, page, lastmod } = await findLatestBulletin();
    result.source = page;
    const { data: buf } = await axios.get(pdfUrl, { timeout: 90000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    const text = await extractPdfText(Buffer.from(buf), 'cma-bulletin');
    const { period, observationDate } = parsePeriod(text);
    const schemes = parseSchemeTable(text);
    const assetClasses = parseAssetClassTable(text);
    const source = 'CMA Quarterly Capital Markets Statistical Bulletin';
    for (const r of schemes) {
      await pool.query(
        `INSERT INTO special_fund_schemes (period, scheme, aum, prev_aum, pct_change, market_share, source, source_url, published_at, observation_date, ingested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (period, scheme) DO UPDATE SET aum=EXCLUDED.aum, prev_aum=EXCLUDED.prev_aum, pct_change=EXCLUDED.pct_change, market_share=EXCLUDED.market_share, source=EXCLUDED.source, source_url=EXCLUDED.source_url, published_at=EXCLUDED.published_at, observation_date=EXCLUDED.observation_date, ingested_at=NOW()`,
        [period, r.scheme, r.aum, r.prevAum, r.pctChange, r.marketShare, source, pdfUrl, lastmod || null, observationDate]
      );
    }
    for (const r of assetClasses) {
      await pool.query(
        `INSERT INTO special_fund_asset_classes (period, asset_class, amount, prev_amount, proportion, change_pct, source, source_url, observation_date, ingested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (period, asset_class) DO UPDATE SET amount=EXCLUDED.amount, prev_amount=EXCLUDED.prev_amount, proportion=EXCLUDED.proportion, change_pct=EXCLUDED.change_pct, source=EXCLUDED.source, source_url=EXCLUDED.source_url, observation_date=EXCLUDED.observation_date, ingested_at=NOW()`,
        [period, r.assetClass, r.amount, r.prevAmount, r.proportion, r.changePct, source, pdfUrl, observationDate]
      );
    }
    result.ok = true;
    result.period = period;
    result.schemes = schemes.length;
    result.assetClasses = assetClasses.length;
    console.log(`[CMAFunds] imported ${schemes.length} schemes + ${assetClasses.length} asset classes for ${period}`);
  } catch (e) {
    result.error = e.message;
    console.warn('[CMAFunds] import failed:', e.message);
  }
  return result;
}

async function getContext() {
  try {
    await ensureTable();
    const { rows: p } = await pool.query('SELECT MAX(period) AS period FROM special_fund_schemes');
    const period = p[0] && p[0].period;
    if (!period) return { period: null, schemes: [], assetClasses: [], totalAum: 0 };
    const [schemes, assetClasses] = await Promise.all([
      pool.query('SELECT scheme, aum, prev_aum, pct_change, market_share, source, source_url, published_at, observation_date, ingested_at FROM special_fund_schemes WHERE period = $1 ORDER BY aum DESC NULLS LAST', [period]),
      pool.query('SELECT asset_class, amount, prev_amount, proportion, change_pct FROM special_fund_asset_classes WHERE period = $1 ORDER BY amount DESC NULLS LAST', [period]),
    ]);
    const totalAum = schemes.rows.reduce((s, r) => s + (Number(r.aum) || 0), 0);
    return {
      period,
      totalAum,
      source: schemes.rows[0]?.source || 'CMA Quarterly Capital Markets Statistical Bulletin',
      sourceUrl: schemes.rows[0]?.source_url || null,
      publishedAt: schemes.rows[0]?.published_at || null,
      observationDate: schemes.rows[0]?.observation_date || null,
      ingestedAt: schemes.rows[0]?.ingested_at || null,
      schemes: schemes.rows.map(r => ({ scheme: r.scheme, aum: Number(r.aum), prevAum: Number(r.prev_aum), pctChange: Number(r.pct_change), marketShare: Number(r.market_share) })),
      assetClasses: assetClasses.rows.map(r => ({ assetClass: r.asset_class, amount: Number(r.amount), prevAmount: Number(r.prev_amount), proportion: Number(r.proportion), changePct: Number(r.change_pct) })),
    };
  } catch (e) {
    console.warn('[CMAFunds] getContext failed:', e.message);
    return { period: null, schemes: [], assetClasses: [], totalAum: 0 };
  }
}

module.exports = { ensureTable, importLatest, getContext, findLatestBulletin, parseSchemeTable, parseAssetClassTable, parsePeriod, extractPdfText };
