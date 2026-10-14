// Provider fund-rate scraper.
//
// Kenyan fund NAV/yield/fee data has no single public API — each provider
// publishes rates on its own page. This module fetches a provider page, parses
// the published rate block, maps the labels onto our funds, and upserts the
// figures through specialFundsService.bulkIngest() with full provenance
// (source, source_url, observation_date). It is intentionally resilient to
// markup changes: it works off the visible text of the rate section rather than
// brittle CSS classes, and any parse miss simply leaves the fund untouched.
//
// Add a provider by appending to PROVIDERS. `map` maps the provider's published
// label (lower-cased) to our fund name; `metrics` declares which figures to read.

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const specialFunds = require('./specialFundsService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
// Some provider CDNs return oversized response headers; lift the Node default.
const httpsAgent = new https.Agent({ maxHeaderSize: 100000000, keepAlive: true });

// ── Provider definitions ─────────────────────────────────────────────────────
const PROVIDERS = [
  {
    key: 'ncba',
    name: 'NCBA Investment Bank',
    url: 'https://ncbagroup.com/investment-banking/',
    source: 'NCBA Investment Bank — Unit Rates',
    map: {
      'fixed income': 'NCBA Fixed Income Fund',
      'equity fund': 'NCBA Equity Fund',
      'dollar fixed fund': 'NCBA Dollar Fixed Income Fund',
      'money market fund': 'NCBA Money Market Fund (KES)',
    },
    parse: ($) => {
      const asOfTxt = $('.fund-rates-date').first().text().trim();
      const asOf = asOfTxt ? new Date(asOfTxt.replace(',', '')).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const entries = [];
      $('.fund-card').each((_, el) => {
        const label = $(el).find('h3').first().text().trim();
        $(el).find('.fund-row').each((__, row) => {
          const metric = $(row).find('.label').first().text().replace(/\s+/g, ' ').trim();
          if (!metric) return;
          const allText = $(row).text().replace(/\s+/g, ' ').trim();
          const value = allText.startsWith(metric) ? allText.slice(metric.length).trim() : allText;
          entries.push({ context: label, metric, value });
        });
      });
      return { asOf, entries };
    },
  },
  {
    key: 'britam',
    name: 'Britam Asset Managers',
    source: 'Britam unit trust fund pages — Effective Annual Yield',
    // Each Britam fund has its own server-rendered page carrying an
    // "Effective Annual Yield" figure.
    pages: [
      { url: 'https://ke.britam.com/save-and-invest/personal/invest/unit-trust-funds/money-market-fund', fund: 'Britam Money Market Fund' },
      { url: 'https://ke.britam.com/save-and-invest/personal/invest/unit-trust-funds/bond-plus-fund', fund: 'Britam Bond Plus Fund' },
    ],
  },
];

const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12', jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Most-recent "Effective Annual Yield" figure: the last percentage in the
// segment following the phrase (providers list periods oldest→newest).
function extractYield(text) {
  const i = text.toLowerCase().lastIndexOf('effective annual yield');
  if (i < 0) return null;
  const seg = text.slice(i, i + 300).split(/the effective/i)[0];
  const p = [...seg.matchAll(/([0-9]+(?:\.[0-9]+)?)\s?%/g)];
  if (!p.length) return null;
  const n = Number(p[p.length - 1][1]);
  return Number.isFinite(n) ? n : null;
}

// Infer the "as of" date from a trailing "<Month> <Year>" on the page.
function extractAsOf(text) {
  const re = /([A-Za-z]{3,9})[,\s]+(20\d{2})/g;
  let m, best = null;
  while ((m = re.exec(text)) !== null) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) best = { y: m[2], m: mon };
  }
  if (!best) return null;
  const lastDay = new Date(Number(best.y), Number(best.m), 0).getDate();
  return `${best.y}-${best.m}-${String(lastDay).padStart(2, '0')}`;
}

function textOf(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Parse the "Unit Rates <date> ... " section text into entries.
// Pattern: <Fund Label> <Metric> <value> where Metric ∈ the known set.
const METRIC_RE = /(Daily Income|Effective Annual Yield|Buy Price|Sell Price|Offer Price|Bid Price|Yield|NAV|Management Fee|Expense Ratio)\s+([0-9][0-9.,]*\s*(?:%|KES|USD)?)/gi;

function parseUnitRates(text) {
  const asOfM = text.match(/Unit Rates\s+([A-Z][a-z]+ \d{1,2},? \d{4})/);
  const asOf = asOfM ? new Date(asOfM[1].replace(',', '')).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const start = text.search(/Unit Rates/i);
  let section = start >= 0 ? text.slice(start) : text;
  const basket = section.search(/Basket Rates/i);
  if (basket > 0) section = section.slice(0, basket);

  // Walk the section capturing "<context> <metric> <value>".
  const entries = [];
  const re = new RegExp(METRIC_RE.source, 'gi');
  let m;
  let cursor = 0;
  while ((m = re.exec(section)) !== null) {
    const before = section.slice(cursor, m.index).trim();
    entries.push({ context: before, metric: m[1], value: m[2].trim() });
    cursor = m.index + m[0].length;
  }
  return { asOf, entries };
}

function toNumber(v) {
  const s = String(v).replace(/[^0-9.]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? n : null;
}

// Turn provider entries into our fund rows (yield_pct / nav).
function buildRows(provider, parsed) {
  const rows = [];
  const byFund = {};
  for (const e of parsed.entries) {
    // Match the entry's context (text since the previous metric) against the
    // configured label keys; longest key wins so "dollar fixed" beats "fixed".
    const ctx = String(e.context || '').toLowerCase();
    let fundName = null;
    let bestLen = 0;
    for (const [k, v] of Object.entries(provider.map)) {
      if (k.length > bestLen && ctx.includes(k)) { fundName = v; bestLen = k.length; }
    }
    if (!fundName) continue;
    const rec = byFund[fundName] || (byFund[fundName] = { name: fundName });
    const metric = e.metric.toLowerCase();
    const val = toNumber(e.value);
    if (val == null) continue;
    if (metric.includes('daily income') || metric === 'yield') rec.yield_pct = rec.yield_pct ?? val;
    else if (metric.includes('effective annual yield')) rec.yield_pct = rec.yield_pct ?? val;
    else if (metric.includes('buy price') || metric.includes('offer price') || metric === 'nav') rec.nav = val;
    else if (metric.includes('management fee')) rec.management_fee_pct = val;
    else if (metric.includes('expense ratio')) rec.expense_ratio_pct = val;
  }
  return Object.values(byFund);
}

async function fetchHtml(url, attempts = 3) {
  // Optional egress proxy (set FUND_SCRAPE_PROXY=http://user:pass@host:port) so
  // providers that block the datacenter IP can still be reached.
  const proxy = process.env.FUND_SCRAPE_PROXY
    ? (() => { try { const p = new URL(process.env.FUND_SCRAPE_PROXY); return { host: p.hostname, port: Number(p.port) || 8080, protocol: p.protocol.replace(':', ''), ...(p.username ? { auth: { username: decodeURIComponent(p.username), password: decodeURIComponent(p.password) } } : {}) }; } catch { return undefined; } })()
    : undefined;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await axios.get(url, {
        timeout: 45000,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
        maxRedirects: 5,
        proxy,
        httpsAgent,
      });
      return String(res.data);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
  // Browser rendering is intentionally NOT used here: launching Chromium inside
  // the app container OOM-killed the backend in testing. Providers must be
  // scraped from their server-rendered HTML.
  throw lastErr;
}

// Providers that publish one fund's yield per page (e.g. Britam).
async function scrapeYieldPages(provider) {
  const result = { provider: provider.key, name: provider.name, ok: false, asOf: null, entries: 0, rows: 0, ingested: null, error: null };
  const rows = [];
  let asOf = null;
  for (const pg of provider.pages) {
    try {
      const html = await fetchHtml(pg.url);
      const text = textOf(html);
      const y = extractYield(text);
      if (y == null) continue;
      rows.push({ name: pg.fund, yield_pct: y });
      if (!asOf) asOf = extractAsOf(text);
    } catch (e) { /* skip a failing page */ }
  }
  result.entries = rows.length;
  result.rows = rows.length;
  result.asOf = asOf || new Date().toISOString().slice(0, 10);
  if (rows.length) {
    try {
      const summary = await specialFunds.bulkIngest(rows, { data_source: provider.source, source_url: provider.pages[0]?.url, observation_date: result.asOf });
      result.ingested = { updated: summary.updated, created: summary.created, skipped: summary.skipped };
    } catch (e) { result.error = e.message; }
  }
  result.ok = rows.length > 0;
  console.log(`[FundRates] ${provider.name}: ${rows.length} fund rows, asOf ${result.asOf}`);
  return result;
}

// Scrape one provider and ingest what it published. Returns a per-provider result.
async function scrapeProvider(provider) {
  if (Array.isArray(provider.pages)) return scrapeYieldPages(provider);
  const result = { provider: provider.key, name: provider.name, ok: false, asOf: null, entries: 0, rows: 0, ingested: null, error: null };
  try {
    const html = await fetchHtml(provider.url);
    const parsed = provider.parse ? provider.parse(cheerio.load(html)) : parseUnitRates(textOf(html));
    const rows = buildRows(provider, parsed);
    result.asOf = parsed.asOf;
    result.entries = parsed.entries.length;
    result.rows = rows.length;
    if (rows.length) {
      const summary = await specialFunds.bulkIngest(rows, {
        data_source: provider.source,
        source_url: provider.url,
        observation_date: parsed.asOf,
      });
      result.ingested = { updated: summary.updated, created: summary.created, skipped: summary.skipped };
    }
    result.ok = rows.length > 0;
    console.log(`[FundRates] ${provider.name}: ${result.entries} entries, ${rows.length} fund rows, asOf ${result.asOf}`);
  } catch (e) {
    result.error = e.message;
    console.warn(`[FundRates] ${provider.name} failed: ${e.message}`);
  }
  return result;
}

async function refreshAll() {
  const results = [];
  for (const p of PROVIDERS) results.push(await scrapeProvider(p));
  return { providers: results, totalRows: results.reduce((s, r) => s + r.rows, 0) };
}

module.exports = { PROVIDERS, parseUnitRates, buildRows, scrapeProvider, refreshAll };
