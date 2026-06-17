const axios = require('axios');
const cheerio = require('cheerio');

const NSE_TICKERS = [
  'ABSA','ALP','AMAC','ARM','BAMB','BAT','BKG','BOC','BRIT','CABL',
  'CARB','CGEN','CIC','COOP','CRWN','CTUM','DCON','DTK','EABL','EGAD',
  'EQTY','EVRD','FTGH','GLD','HAFR','HBE','HFCK','IMH','IPO','JUB',
  'KAPC','KCB','KEGN','KNRE','KPC','KPLC','KUKZ','KURV','LAPR',
  'LBTY','LIMT','LKL','MSC','NASI','NBV','NCBA','NMG','NSE','OCH',
  'PORT','SASN','SBIC','SCAN','SCBK','SCOM','SGL','SKL','SLAM',
  'SMER','SMWF','TCL','TOTL','TPSE','UCHM','UMME','UNGA','WTK','XPRS',
];

const CACHE_TTL = 300000; // 5 min
const FETCH_TIMEOUT = 10000;
const BATCH_SIZE = 5;
const BATCH_DELAY = 500;

let cache = null;
let cacheTime = 0;
let refreshTimer = null;

async function scrapeStockPage(ticker) {
  try {
    const resp = await axios.get(`https://live.mystocks.co.ke/stock=${ticker}`, {
      timeout: FETCH_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    const html = resp.data;
    // Fallback: parse rtPrice2 from raw HTML (cheerio might not work with this HTML)
    let price = null;
    const priceMatch = html.match(/<b[^>]*id\s*=\s*rtPrice2[^>]*>\s*([0-9.,]+)\s*<\/b>/i);
    if (priceMatch) {
      price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }
    if (price === null || isNaN(price)) {
      // Try cheerio as fallback
      const $ = cheerio.load(html);
      const priceEl = $('#rtPrice2');
      if (priceEl.length) {
        price = parseFloat(priceEl.text().trim().replace(/,/g, ''));
      }
    }
    if (price === null || isNaN(price) || !price) return null;

    let change = 0;
    const chMatch = html.match(/<b[^>]*id\s*=\s*rtChange2[^>]*>\s*([0-9.,-]+)\s*<\/b>/i);
    if (chMatch) change = parseFloat(chMatch[1].replace(/,/g, '')) || 0;

    let high = price, low = price;
    const hiMatch = html.match(/<b[^>]*id\s*=\s*rtHi[^>]*>\s*([0-9.,]+)\s*<\/b>/i);
    if (hiMatch) high = parseFloat(hiMatch[1].replace(/,/g, '')) || price;
    const loMatch = html.match(/<b[^>]*id\s*=\s*rtLo[^>]*>\s*([0-9.,]+)\s*<\/b>/i);
    if (loMatch) low = parseFloat(loMatch[1].replace(/,/g, '')) || price;

    let name = ticker;
    const titleMatch = html.match(/<title>([^<]+)\s+Realtime/i);
    if (titleMatch) name = titleMatch[1].trim();

    return {
      ticker, name, price, change,
      changePercent: change && price ? (change / (price - change)) * 100 : 0,
      volume: 0, previousClose: price - change, dayHigh: high, dayLow: low,
      currency: 'KES', market: 'NSE', provider: 'mystocks',
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    if (err.response?.status === 404) {
      console.warn(`[myStocks] 404 for ${ticker} - stock not found`);
    } else if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      console.warn(`[myStocks] timeout for ${ticker}`);
    }
    return null;
  }
}

async function fetchAllQuotes(force) {
  const now = Date.now();
  if (!force && cache && (now - cacheTime) < CACHE_TTL) return cache;

  const quotes = {};
  const batches = [];
  for (let i = 0; i < NSE_TICKERS.length; i += BATCH_SIZE) {
    batches.push(NSE_TICKERS.slice(i, i + BATCH_SIZE));
  }
  let successCount = 0;
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const results = await Promise.allSettled(batch.map(t => scrapeStockPage(t)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        quotes[r.value.ticker] = r.value;
        successCount++;
      }
    }
    console.log(`[myStocks] batch ${bi + 1}/${batches.length}: got ${successCount}/${NSE_TICKERS.length} so far`);
    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }

  if (successCount > 0) {
    cache = quotes;
    cacheTime = now;
    console.log(`[myStocks] Scraped ${successCount}/${NSE_TICKERS.length} NSE stocks`);
  } else if (cache) {
    console.warn(`[myStocks] All stock pages failed, using cached data`);
  } else {
    console.error(`[myStocks] All stock pages failed, no cache available. Check if live.mystocks.co.ke is reachable.`);
  }
  return quotes;
}

async function getQuoteForSymbol(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  if (cache && cache[cleanSymbol]) return cache[cleanSymbol];
  if (!cache) await fetchAllQuotes();
  return cache?.[cleanSymbol] || null;
}

function getCacheSize() {
  return cache ? Object.keys(cache).length : 0;
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  // First fetch runs inline (no await so module import doesn't block)
  fetchAllQuotes(true).catch(() => {});
  refreshTimer = setInterval(() => fetchAllQuotes().catch(() => {}), CACHE_TTL);
  console.log('[myStocks] Auto-refresh started every 5 min');
}

module.exports = { fetchAllQuotes, getQuoteForSymbol, startAutoRefresh, getCacheSize };
