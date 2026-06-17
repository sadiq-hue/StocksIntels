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
    const $ = cheerio.load(resp.data);
    const priceEl = $('#rtPrice2');
    if (!priceEl.length) return null;
    const price = parseFloat(priceEl.text().trim().replace(/,/g, ''));
    if (isNaN(price) || !price) return null;
    const changeEl = $('#rtChange2');
    let change = 0;
    if (changeEl.length) {
      const t = changeEl.text().trim().replace(/,/g, '');
      change = parseFloat(t) || 0;
    }
    const hiEl = $('#rtHi');
    const loEl = $('#rtLo');
    const high = hiEl.length ? parseFloat(hiEl.text().trim()) || price : price;
    const low = loEl.length ? parseFloat(loEl.text().trim()) || price : price;
    const volEl = $('#rtVol');
    let volume = 0;
    if (volEl.length) {
      const v = volEl.text().trim().toUpperCase().replace(/,/g, '');
      if (v.endsWith('M')) volume = parseFloat(v) * 1e6;
      else if (v.endsWith('K')) volume = parseFloat(v) * 1e3;
      else volume = parseFloat(v) || 0;
    }
    let name = resp.data.match(/<title>([^<]+) Realtime/);
    name = name ? name[1].trim() : ticker;
    return {
      ticker, name, price, change,
      changePercent: change && price ? (change / (price - change)) * 100 : 0,
      volume, previousClose: price - change, dayHigh: high, dayLow: low,
      currency: 'KES', market: 'NSE', provider: 'mystocks',
      timestamp: Math.floor(Date.now() / 1000),
    };
  } catch {
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
  for (const batch of batches) {
    const results = await Promise.allSettled(batch.map(t => scrapeStockPage(t)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        quotes[r.value.ticker] = r.value;
        successCount++;
      }
    }
    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }

  if (successCount > 0) {
    cache = quotes;
    cacheTime = now;
    console.log(`[myStocks] Scraped ${successCount}/${NSE_TICKERS.length} NSE stocks`);
  } else if (cache) {
    console.warn(`[myStocks] All stock pages failed, using cached data`);
  } else {
    console.error(`[myStocks] All stock pages failed, no cache available`);
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
