const axios = require('axios');
const cheerio = require('cheerio');

const AFX_URL = 'https://afx.kwayisi.org/nse/';
const SCRAPE_TIMEOUT = 15000;
const RETRIES = 0;
const CACHE_TTL = 60000;

let afxCache = null;
let afxCacheTime = 0;
let afxFailCount = 0;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchNseQuotes() {
  const now = Date.now();
  if (afxCache && (now - afxCacheTime) < CACHE_TTL) {
    return afxCache;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
      const response = await axios.get(AFX_URL, {
        timeout: SCRAPE_TIMEOUT,
        headers: { 'User-Agent': USER_AGENT },
      });
      const $ = cheerio.load(response.data);
      const quotes = {};
      $('div.t > table > tbody > tr').each((i, row) => {
        const $cells = $(row).find('td');
        if ($cells.length < 5) return;
        const ticker = $cells.eq(0).find('a').text().trim().toUpperCase();
        const name = $cells.eq(1).find('a').text().trim();
        const volumeStr = $cells.eq(2).text().trim().replace(/,/g, '');
        const priceStr = $cells.eq(3).text().trim().replace(/,/g, '');
        const changeStr = $cells.eq(4).text().trim().replace(/,/g, '');
        if (!ticker || !priceStr) return;
        const volume = parseInt(volumeStr, 10) || 0;
        const price = parseFloat(priceStr);
        const change = changeStr ? parseFloat(changeStr) : 0;
        if (isNaN(price)) return;
        quotes[ticker] = {
          ticker, name, price, change,
          changePercent: change && price ? (change / (price - change)) * 100 : 0,
          volume, previousClose: price - change,
          currency: 'KES', market: 'NSE',
          provider: 'afx',
          timestamp: Math.floor(Date.now() / 1000),
        };
      });
      if (Object.keys(quotes).length > 0) {
        afxCache = quotes;
        afxCacheTime = now;
        afxFailCount = 0;
        console.log(`[AFX] Scraped ${Object.keys(quotes).length} NSE stocks from afx.kwayisi.org`);
      } else {
        const snippet = response.data.substring(0, 300).replace(/\n/g, ' ');
        console.log(`[AFX] Response has no rows, length=${response.data.length}, snippet: ${snippet}`);
      }
      return quotes;
    } catch (err) {
      lastErr = err;
      console.error(`[AFX] Scrape attempt ${attempt + 1}/${RETRIES + 1} failed: ${err.message}`);
    }
  }
  afxFailCount++;
  if (afxFailCount <= 3 || afxFailCount % 10 === 0) {
    console.error(`[AFX] All scrape attempts failed (${afxFailCount}): ${lastErr ? lastErr.message : 'unknown'}`);
  }
  if (afxCache) return afxCache;
  return {};
}

function getQuoteForSymbol(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  if (!afxCache) return null;
  return afxCache[cleanSymbol] || null;
}

module.exports = { fetchNseQuotes, getQuoteForSymbol };
