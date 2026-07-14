const axios = require('axios');
const cheerio = require('cheerio');

const NSE_TICKERS = [
  'ABSA','ALP','AMAC','ARM','BAMB','BAT','BKG','BOC','BRIT','CABL',
  'CARB','CGEN','CIC','COOP','CRWN','CTUM','DCON','DTK','EABL','EGAD',
  'EQTY','EVRD','FTGH','GLD','HAFR','HBE','HFCK','IMH','IPO','JUB',
  'KAPC','KCB','KEGN','KNRE','KPC','KPLC','KQ','KUKZ','KURV','LAPR',
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
    const chMatch = html.match(/<b[^>]*id\s*=\s*rtChange2[^>]*>\s*([+-]?[0-9.,]+)\s*\(/i);
    if (chMatch) change = parseFloat(chMatch[1].replace(/,/g, '')) || 0;

    let high = price, low = price;
    const hiMatch = html.match(/<b[^>]*id\s*=\s*rtHi[^>]*>\s*([0-9.,]+)\s*<\/b>/i);
    if (hiMatch) high = parseFloat(hiMatch[1].replace(/,/g, '')) || price;
    const loMatch = html.match(/<b[^>]*id\s*=\s*rtLo[^>]*>\s*([0-9.,]+)\s*<\/b>/i);
    if (loMatch) low = parseFloat(loMatch[1].replace(/,/g, '')) || price;

    let marketCap = 0;
    let volume = 0;
    const dataDivMatch = html.match(/<div[^>]*id\s*=\s*rtDataJson[^>]*>\s*(\{[\s\S]*?\})\s*<\/div>/i);
    if (dataDivMatch) {
      const jsonStr = dataDivMatch[1].replace(/&quot;/g, '"');
      try {
        const data = JSON.parse(jsonStr);
        if (data && Array.isArray(data.data) && data.data.length >= 11) {
          // Market cap at index 10 (e.g. "1.42T")
          const mcStr = String(data.data[10] ?? '');
          const mcMatch = mcStr.match(/([\d,.]+)\s*([MBT])?/i);
          if (mcMatch) {
            let mcNum = parseFloat(mcMatch[1].replace(/,/g, ''));
            const sfx = (mcMatch[2] || '').toUpperCase();
            if (sfx === 'T') mcNum *= 1e12;
            else if (sfx === 'B') mcNum *= 1e9;
            else if (sfx === 'M') mcNum *= 1e6;
            marketCap = Math.round(mcNum) || 0;
          }
          // Volume at index 7 (e.g. "4.74M")
          if (data.data.length >= 8) {
            const volStr = String(data.data[7] ?? '');
            const volMatch = volStr.match(/([\d,.]+)\s*([MBT])?/i);
            if (volMatch) {
              let volNum = parseFloat(volMatch[1].replace(/,/g, ''));
              const vsfx = (volMatch[2] || '').toUpperCase();
              if (vsfx === 'T') volNum *= 1e12;
              else if (vsfx === 'B') volNum *= 1e9;
              else if (vsfx === 'M') volNum *= 1e6;
              else if (vsfx === 'K') volNum *= 1e3;
              volume = Math.round(volNum) || 0;
            }
          }
        }
      } catch (e) {
        console.warn(`[myStocks] Failed to parse data JSON for ${ticker}: ${e.message}`);
      }
    }

    // Fallback: some page variants expose volume directly in the HTML
    if (!volume) {
      const volMatch = html.match(/([\d,.]+)\s*([MKB])?\s*Volume/i);
      if (volMatch) {
        let volNum = parseFloat(volMatch[1].replace(/,/g, ''));
        const suffix = (volMatch[2] || '').toUpperCase();
        if (suffix === 'M') volNum *= 1000000;
        else if (suffix === 'B') volNum *= 1000000000;
        else if (suffix === 'K') volNum *= 1000;
        volume = Math.round(volNum) || 0;
      }
    }

    let name = ticker;
    const titleMatch = html.match(/<title>([^<]+)\s+Realtime/i);
    if (titleMatch) name = titleMatch[1].trim();

    return {
      ticker, name, price, change,
      changePercent: change && price ? (change / (price - change)) * 100 : 0,
      volume, previousClose: price - change, dayHigh: high, dayLow: low,
      marketCap, currency: 'KES', market: 'NSE', provider: 'mystocks',
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
  if (!cache) {
    // Never block a request on a full-universe scrape. Kick off a background
    // refresh and fetch just this one symbol on demand so the request can't hang.
    fetchAllQuotes().catch(() => {});
    const single = await scrapeStockPage(cleanSymbol);
    if (single) {
      if (!cache) cache = {};
      cache[cleanSymbol] = single;
    }
    return single || null;
  }
  // Cache exists but this symbol is missing -> scrape just this stock on demand
  const result = await scrapeStockPage(cleanSymbol);
  if (result) {
    cache[cleanSymbol] = result;
    return result;
  }
  return null;
}

function clearCache() {
  cache = null;
  cacheTime = 0;
  console.log('[myStocks] Cache cleared');
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

module.exports = { fetchAllQuotes, getQuoteForSymbol, startAutoRefresh, clearCache, getCacheSize };
