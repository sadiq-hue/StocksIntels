// South Africa — STANLIB fund performance.
//
// STANLIB publishes monthly performance documents on a literature hub
// (`https://stanlib.literaturehub.co.za/secure/?s=<CODE>`), served as real PDFs.
// The exact document code varies per fund, so we keep a static map of the codes
// (STANLIB's own pages are WAF-blocked from the server IP). Two doc formats are
// handled: the "Performance" sheet ("Class  1yr 3yr ...") and the MDD/Comp
// sheets ("Fund Annualised Return: 1m 3m 1yr 3yr ..."). Funds use `sf-za-` ids.

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const specialFunds = require('./specialFundsService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HUB = 'https://stanlib.literaturehub.co.za/secure/?s=';
const SOURCE = 'STANLIB — fund performance (monthly PDF)';
const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

// Exact document code per fund (Performance sheet where available, else MDD/Comp).
const FUND_CODES = {
  'stanlib-money-market-fund': 'STANLIB_Money_Market_Fund_Perf',
  'stanlib-income-fund': 'STANLIB_Income_Fund_Perf',
  'stanlib-flexible-income-fund': 'STANLIB_Flexible_Income_Fund_Perf',
  'stanlib-extra-income-fund': 'STANLIB_Extra_Income_Fund_Perf',
  'stanlib-enhanced-yield-fund': 'STANLIB_Enhanced_Yield_Fund_Perf',
  'stanlib-bond-fund': 'STANLIB_Bond_Fund_Perf',
  'stanlib-absolute-plus-fund': 'STANLIB_Absolute_Plus_Fund_Perf',
  'stanlib-equity-fund': 'STANLIB_Equity_Fund_Perf',
  'stanlib-enhanced-multi-style-equity-fund': 'STANLIB_Enhanced_Multi_Style_Equity_Fund_Perf',
  'stanlib-multi-asset-growth-fund': 'STANLIB_Multi-Asset_Growth_Fund_Perf',
  'stanlib-multi-asset-cautious-fund': 'STANLIB_Multi-Asset_Cautious_Fund_Perf',
  'stanlib-property-income-fund': 'STANLIB_Property_Income_Fund_Perf',
  'stanlib-global-property-feeder-fund': 'STANLIB_Global_Property_Feeder_Fund_Perf',
  'stanlib-global-balanced-cautious-fund': 'STANLIB_Global_Balanced_Cautious_Fund_Comp',
  'stanlib-global-balanced-fund': 'STANLIB_Global_Balanced_Fund_Comp',
  'stanlib-global-equity-fund': 'STANLIB_Global_Equity_Fund_MDD',
  'stanlib-global-property-fund': 'STANLIB_Global_Property_Fund_MDD',
};

const zaId = (slug) => 'sf-za-stanlib-' + slug.replace(/^stanlib-/, '').slice(0, 90);

function inferCategory(name) {
  const n = name.toLowerCase();
  if (/money market/.test(n)) return 'Money Market';
  if (/property/.test(n)) return 'REIT';
  if (/equity/.test(n) && !/multi.?asset|balanced/.test(n)) return 'Equity';
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

function parsePerf(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  const name = lines.find(l => /fund/i.test(l) && l.length < 80) || null;
  const asOfM = text.match(/(?:at|as of|as at)\s+(\d{1,2})\s+([A-Z][a-z]+)\s+(20\d{2})/);
  let asOf = null;
  if (asOfM && MONTHS[asOfM[2].toLowerCase()]) asOf = `${asOfM[3]}-${MONTHS[asOfM[2].toLowerCase()]}-${String(asOfM[1]).padStart(2, '0')}`;
  const benchM = text.match(/Benchmark(?:\s+index)?:?\s*([^\n]+)/i);

  let oneYear = null, threeYear = null;
  // Format A — "Performance" sheet: "Class  1yr  3yr  5yr ..."
  const a = text.match(/Class\s+(-?[0-9]+\.[0-9]+)\s+(-?[0-9]+\.[0-9]+)(?:\s+(-?[0-9]+\.[0-9]+))?/);
  if (a) { oneYear = Number(a[1]); threeYear = Number(a[2]); }
  else {
    // Format B — MDD/Comp: "Fund Annualised Return: 1m 3m 1yr 3yr 5yr 10y"
    const i = text.indexOf('Fund Annualised Return');
    if (i >= 0) {
      const seg = text.slice(i, i + 320);
      const pcts = [...seg.matchAll(/(-?[0-9]+\.[0-9]+)\s?%/g)].map(m => Number(m[1]));
      if (pcts.length >= 4) { oneYear = pcts[2]; threeYear = pcts[3]; }
    }
  }
  return { name: name ? name.replace(/\s+/g, ' ').trim() : null, asOf, benchmark: benchM ? benchM[1].trim().slice(0, 120) : null, oneYear, threeYear };
}

async function refresh() {
  const result = { ok: false, source: HUB, funds: 0, ingested: null, skipped: [], error: null };
  try {
    const rows = [];
    for (const [slug, code] of Object.entries(FUND_CODES)) {
      const url = HUB + code;
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
          ...(parsed.asOf ? { observation_date: parsed.asOf } : {}),
        });
      } catch (e) { result.skipped.push(slug); }
    }
    if (!rows.length) throw new Error('no STANLIB funds parsed');
    const summary = await specialFunds.bulkIngest(rows, { data_source: SOURCE, source_url: HUB });
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

module.exports = { refresh, parsePerf, inferCategory, FUND_CODES };
