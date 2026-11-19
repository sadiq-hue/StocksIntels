// StockAnalysis.com "Gainers Today" / "Losers Today" scraper.
//
// The predefined Yahoo screeners apply liquidity/market-cap filters, so they
// miss micro-cap / low-float movers. stockanalysis.com's /markets/gainers
// scans the whole US market unfiltered, matching what their site shows.
//
// Table columns: rank | symbol | name | change% | price | volume | market cap.
//
// Reliability: the page is intermittently behind Cloudflare (429). To guarantee
// micro-cap coverage with no data break, keep the LAST GOOD micro-cap list on
// disk and serve it when the live fetch is blocked, so a transient outage never
// silently collapses the movers list to Yahoo-only large caps.

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json,*/*',
};

// Persist inside the mounted `uploads` volume so it survives container
// rebuilds (a plain /app/backend/.cache would be wiped on every deploy).
const CACHE_FILE = path.join(__dirname, '..', 'backend', 'uploads', '.stockanalysis_movers.cache.json');

function parseCap(s) {
  if (!s) return 0;
  const t = String(s).replace(/[$,\s]/g, '');
  const m = t.match(/^(-?[0-9.]+)([KMBT]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1;
  return n * mult;
}

function num(s) {
  const n = parseFloat(String(s == null ? '' : s).replace(/[%,$,\s+]/g, ''));
  return isFinite(n) ? n : 0;
}

// Parse every data table on the page. The /markets/gainers and /markets/losers
// pages each have ONE table, but premarket and after-hours pages carry TWO (a
// gainers table and a losers table). Grabbing `table tr` across all of them
// merged positive and negative movers into one list, which is why the Premarket
// tab showed +344% then -35% rows together. We parse per-table instead.
function parseRowsAsTables(html) {
  const $ = cheerio.load(html);
  const tables = [];
  $('table').each((_, tbl) => {
    const rows = [];
    $(tbl).find('tbody tr').each((__, tr) => {
      const cells = $(tr).find('td').map((___, td) => $(td).text().trim()).get();
      if (cells.length < 7) return;
      const ticker = cells[1];
      if (!ticker) return;
      rows.push({
        ticker,
        name: cells[2] || ticker,
        changePercent: num(cells[3]),
        price: num(cells[4]),
        volume: num(cells[5]),
        marketCap: parseCap(cells[6]),
      });
    });
    tables.push(rows);
  });
  return tables;
}

// stockanalysis pages:
//  - gainers:     1 table (positive changes)
//  - losers:      1 table (negative changes)
//  - premarket:   2 tables (gainers then losers)
//  - after-hours: 2 tables (gainers then losers)
// Return rows of the matching polarity only.
function pickTable(kind, tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  for (const rows of tables) {
    if (rows.length === 0) continue;
    const avgSign = rows.reduce((s, r) => s + Math.sign(r.changePercent || 0), 0) / rows.length;
    if (kind === 'losers') { if (avgSign < 0) return rows; }
    else { if (avgSign > 0) return rows; }
  }
  return tables[0] || [];
}

// ------------------------------------------------ disk-backed last-good cache
let lastGood = { gainers: [], losers: [], premarket: [], afterhours: [], at: 0 };
function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.gainers) && Array.isArray(parsed.losers)) {
      // Backfill lists that may not exist in an older cache file.
      lastGood = {
        gainers: parsed.gainers || [],
        losers: parsed.losers || [],
        premarket: parsed.premarket || [],
        afterhours: (parsed.afterhours || []).filter((r) => r?.ticker),
        at: parsed.at || 0,
      };
    }
  } catch { /* no cache yet */ }
}
function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(lastGood));
  } catch (e) { console.warn('[stockanalysis] cache write failed:', e.message); }
}
loadCache();

const SECTION_URL = {
  gainers: 'https://stockanalysis.com/markets/gainers/',
  losers: 'https://stockanalysis.com/markets/losers/',
  premarket: 'https://stockanalysis.com/markets/premarket/',
  afterhours: 'https://stockanalysis.com/markets/afterhours/',
};

async function fetchList(kind) {
  const url = SECTION_URL[kind] || `https://stockanalysis.com/markets/${kind}/`;
  let rows = [];
  // Try the plain HTTP scrape, retrying once ~1s apart (Cloudflare is flaky).
  for (let attempt = 0; attempt < 2 && rows.length < 5; attempt++) {
    try {
      const resp = await axios.get(url, { timeout: 20000, headers: HEADERS });
      const body = String(resp.data || '');
      if (!/Just a moment|cf-challenge|challenge-platform/i.test(body)) {
        rows = pickTable(kind, parseRowsAsTables(body));
      }
    } catch (e) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
    }
  }
  // Cloudflare sometimes beats plain HTTP too; the renderer container's
  // Chromium can load it. Fall back to that before the disk cache.
  if (rows.length < 5) {
    try {
      const { render } = require('./rendererClient');
      const rendered = await render(url, { html: true, selector: 'table tbody tr', timeout: 45000 });
      rows = pickTable(kind, parseRowsAsTables(rendered.html || ''));
    } catch (e) {
      console.warn(`[stockanalysis] ${kind} renderer fallback failed: ${e.message}`);
    }
  }
  // Persist the freshest successful set, then guarantee a non-empty answer.
  if (rows.length >= 5) {
    lastGood[kind] = rows;
    lastGood.at = Date.now();
    saveCache();
    return rows;
  }
  // Live fetch blocked -> serve the last good micro-cap list (no data break).
  if (lastGood[kind] && lastGood[kind].length) {
    console.warn(`[stockanalysis] ${kind} live fetch blocked; serving last-good (${lastGood[kind].length} rows)`);
    return lastGood[kind];
  }
  return rows;
}

async function getGainers(limit = 15) { return (await fetchList('gainers')).slice(0, limit); }
async function getLosers(limit = 15) { return (await fetchList('losers')).slice(0, limit); }
async function getPremarket(limit = 15) { return (await fetchList('premarket')).slice(0, limit); }
async function getAfterHours(limit = 15) { return (await fetchList('afterhours')).slice(0, limit); }

module.exports = {
  getGainers, getLosers, getPremarket, getAfterHours,
  _getLastGood: () => lastGood,
  _saveAfterHours(rows) { if (Array.isArray(rows) && rows.length) { lastGood.afterhours = rows; lastGood.at = Date.now(); saveCache(); } },
};
