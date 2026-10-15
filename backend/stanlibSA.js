// South Africa — STANLIB fund performance.
//
// STANLIB's fund pages link monthly performance PDFs on a literature hub
// (`https://stanlib.literaturehub.co.za/secure/?s=STANLIB_<Fund>_Perf`). We list
// the funds from /our-funds, derive each Performance code, fetch the PDF, read
// it with poppler pdftotext and pull the returns table. Funds use `sf-za-` ids.

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const specialFunds = require('./specialFundsService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const LIST_URL = 'https://www.stanlib.com/our-funds';
const HUB = 'https://stanlib.literaturehub.co.za/secure/?s=';
const SOURCE = 'STANLIB — fund performance (monthly PDF)';
const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

// Fallback fund list — used if /our-funds is WAF-blocked (it 403s under load).
const DEFAULT_SLUGS = [
  'stanlib-flexible-income-fund', 'stanlib-income-fund', 'stanlib-bond-fund', 'stanlib-money-market-fund',
  'stanlib-global-property-feeder-fund', 'stanlib-multi-asset-cautious-fund', 'stanlib-absolute-plus-fund',
  'stanlib-enhanced-multi-style-equity-fund', 'stanlib-multi-asset-growth-fund', 'stanlib-equity-fund',
  'stanlib-property-income-fund', 'stanlib-enhanced-yield-fund', 'stanlib-extra-income-fund',
  'stanlib-global-balanced-cautious-fund', 'stanlib-global-balanced-feeder-fund', 'stanlib-global-balanced-fund',
  'stanlib-global-equity-feeder-fund', 'stanlib-global-equity-fund', 'stanlib-global-property-fund',
];

const zaId = (slug) => 'sf-za-stanlib-' + slug.replace(/^stanlib-/, '').slice(0, 90);
const perfCode = (slug) => 'STANLIB_' + slug.replace(/^stanlib-/, '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join('_') + '_Perf';

function inferCategory(name) {
  const n = name.toLowerCase();
  if (/money market/.test(n)) return 'Money Market';
  if (/property/.test(n)) return 'REIT';
  if (/equity/.test(n) && !/multi|balanced/.test(n)) return 'Equity';
  if (/income|bond|yield|interest/.test(n)) return 'Fixed Income / Bond';
  return 'Balanced';
}

function pdfText(buf) {
  const tmp = path.join(os.tmpdir(), `sl-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmp, buf);
  try {
    return execFileSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 30 * 1024 * 1024 }).toString();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function listFundSlugs() {
  try {
    const { data } = await axios.get(LIST_URL, { timeout: 30000, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }, responseType: 'text' });
    const slugs = new Set();
    for (const m of String(data).matchAll(/\/our-funds\/([a-z0-9-]+)/gi)) slugs.add(m[1].toLowerCase());
    if (slugs.size) return [...slugs];
  } catch (e) {
    console.warn('[STANLIB-SA] live list unavailable, using fallback:', e.message);
  }
  return DEFAULT_SLUGS;
}

function parsePerf(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const name = lines.find(l => /fund/i.test(l) && l.length < 80) || null;
  const asOfM = text.match(/at (\d{1,2}) ([A-Z][a-z]+) (20\d{2})/);
  let asOf = null;
  if (asOfM && MONTHS[asOfM[2].toLowerCase()]) asOf = `${asOfM[3]}-${MONTHS[asOfM[2].toLowerCase()]}-${String(asOfM[1]).padStart(2, '0')}`;
  const benchM = text.match(/Benchmark:\s*([^\n]+)/);
  const retM = text.match(/Class\s+(-?[0-9]+\.[0-9]+)\s+(-?[0-9]+\.[0-9]+)(?:\s+(-?[0-9]+\.[0-9]+))?/);
  return {
    name: name ? name.replace(/\s+/g, ' ').trim() : null,
    asOf,
    benchmark: benchM ? benchM[1].trim() : null,
    oneYear: retM ? Number(retM[1]) : null,
    threeYear: retM ? Number(retM[2]) : null,
  };
}

async function refresh() {
  const result = { ok: false, source: LIST_URL, funds: 0, ingested: null, skipped: [], error: null };
  try {
    const slugs = await listFundSlugs();
    const rows = [];
    for (const slug of slugs) {
      const url = HUB + perfCode(slug);
      try {
        const { data, headers } = await axios.get(url, { timeout: 60000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer', maxRedirects: 5, validateStatus: () => true });
        if (!/pdf/i.test(headers['content-type'] || '')) { result.skipped.push(slug); continue; }
        const parsed = parsePerf(pdfText(Buffer.from(data)));
        if (!parsed.name || (parsed.oneYear == null && parsed.threeYear == null)) { result.skipped.push(slug); continue; }
        rows.push({
          id: zaId(slug),
          name: parsed.name,
          manager: 'STANLIB',
          country: 'South Africa',
          currency: 'ZAR',
          category: inferCategory(parsed.name),
          structure: 'Collective Investment Scheme',
          one_year_return_pct: parsed.oneYear,
          three_year_return_pct: parsed.threeYear,
          benchmarks: parsed.benchmark,
          data_source: SOURCE,
          source_url: url,
          observation_date: parsed.asOf || undefined,
        });
      } catch (e) { result.skipped.push(slug); }
    }
    if (!rows.length) throw new Error('no STANLIB funds parsed');
    const summary = await specialFunds.bulkIngest(rows, { data_source: SOURCE, source_url: LIST_URL });
    result.ok = true;
    result.funds = rows.length;
    result.ingested = { created: summary.created, updated: summary.updated, skipped: summary.skipped };
    console.log(`[STANLIB-SA] ${rows.length} funds (${result.skipped.length} skipped)`);
  } catch (e) {
    result.error = e.message;
    console.warn('[STANLIB-SA] refresh failed:', e.message);
  }
  return result;
}

module.exports = { refresh, perfCode, parsePerf, inferCategory, listFundSlugs };
