// StockAnalysis.com "Gainers Today" / "Losers Today" scraper.
//
// The predefined Yahoo screeners apply liquidity/market-cap filters, so they
// miss micro-cap / low-float movers. stockanalysis.com's /markets/gainers
// scans the whole US market unfiltered, matching what their site shows.
//
// Table columns: rank | symbol | name | change% | price | volume | market cap.

const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json,*/*',
};

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

async function fetchList(kind) {
  const resp = await axios.get(`https://stockanalysis.com/markets/${kind}/`, { timeout: 20000, headers: HEADERS });
  const $ = cheerio.load(resp.data);
  const out = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length < 7) return;
    const ticker = cells[1];
    if (!ticker) return;
    out.push({
      ticker,
      name: cells[2] || ticker,
      changePercent: num(cells[3]),
      price: num(cells[4]),
      volume: num(cells[5]),
      marketCap: parseCap(cells[6]),
    });
  });
  return out;
}

async function getGainers(limit = 15) { return (await fetchList('gainers')).slice(0, limit); }
async function getLosers(limit = 15) { return (await fetchList('losers')).slice(0, limit); }

module.exports = { getGainers, getLosers };
