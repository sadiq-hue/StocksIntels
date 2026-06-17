const axios = require('axios');

const ACTOR_ID = 'wafspaul~nse-kenya-market-data';
const API_BASE = 'https://api.apify.com/v2';
const CACHE_TTL = 5 * 60 * 1000;
const MAX_RUN_TIME_SEC = 30;

let nseCache = null;
let nseCacheTime = 0;
let lastRefresh = null;
let refreshInProgress = false;
let consecutiveFailures = 0;

function getApiKey() {
  return process.env.APIFY_API_KEY;
}

function mapActorItem(item) {
  const ticker = (item.symbol || item.ticker || item.code || item.securityCode || '').toString().trim().toUpperCase();
  const price = Number(item.price || item.currentPrice || item.lastPrice || item.close || item.lastTradePrice || item.ltp || 0);
  const change = Number(item.change || item.difference || item.priceChange || 0);
  const changePercent = Number(item.changePercent || item.pctChange || item.changePercentage || item.percentageChange || item.percentChange || 0);
  const volume = Number(item.volume || item.totalVolume || item.tradedVolume || 0);
  const name = item.name || item.company || item.companyName || item.securityName || '';

  if (!ticker || !price) return null;

  const previousClose = Number(item.previousClose || item.previous_close || (price - change) || 0);

  return {
    ticker,
    name,
    price,
    change,
    changePercent: changePercent || (change && price ? (change / (price - change)) * 100 : 0),
    volume,
    previousClose,
    currency: 'KES',
    market: 'NSE',
    provider: 'apify',
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function runActor() {
  const key = getApiKey();
  if (!key) return [];

  const resp = await axios.post(
    `${API_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items`,
    { dataType: 'all' },
    {
      params: { token: key, timeout: MAX_RUN_TIME_SEC },
      timeout: (MAX_RUN_TIME_SEC + 5) * 1000,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const items = resp.data;
  if (!Array.isArray(items)) return [];

  return items;
}

async function fetchNseQuotes() {
  const now = Date.now();
  if (nseCache && (now - nseCacheTime) < CACHE_TTL) {
    return nseCache;
  }

  if (refreshInProgress) {
    if (nseCache) return nseCache;
    await new Promise(r => setTimeout(r, 2000));
    if (nseCache) return nseCache;
    return {};
  }

  refreshInProgress = true;
  try {
    const items = await runActor();
    const quotes = {};
    let mappedCount = 0;

    if (items.length > 0) {
      console.log(`[Apify] Actor returned ${items.length} items, first item keys: ${Object.keys(items[0]).join(', ')}`);
    }

    for (const item of items) {
      const q = mapActorItem(item);
      if (q) {
        quotes[q.ticker] = q;
        mappedCount++;
      }
    }

    if (mappedCount > 0) {
      nseCache = quotes;
      nseCacheTime = now;
      lastRefresh = new Date().toISOString();
      consecutiveFailures = 0;
      console.log(`[Apify] Fetched ${mappedCount} NSE stocks from actor ${ACTOR_ID}`);
    } else {
      throw new Error(`No valid quotes mapped from ${items.length} actor items`);
    }

    return quotes;
  } catch (err) {
    consecutiveFailures++;
    const status = err.response?.status || err.status;
    if (status === 402) {
      if (consecutiveFailures <= 2) {
        console.error(`[Apify] Payment required - add billing at https://console.apify.com/ to run NSE actor`);
      }
    } else if (consecutiveFailures <= 3 || consecutiveFailures % 10 === 0) {
      console.error(`[Apify] Actor run failed (${consecutiveFailures}): ${err.message}`);
    }
    if (nseCache) return nseCache;
    return {};
  } finally {
    refreshInProgress = false;
  }
}

function getQuoteForSymbol(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  if (!nseCache) return null;
  return nseCache[cleanSymbol] || null;
}

function startAutoRefresh(intervalMs = 5 * 60 * 1000) {
  fetchNseQuotes().catch(() => {});
  setInterval(() => {
    fetchNseQuotes().catch(() => {});
  }, intervalMs);
  console.log(`[Apify] Auto-refresh scheduled every ${intervalMs / 1000}s`);
}

function clearCache() {
  nseCache = null;
  nseCacheTime = 0;
}

module.exports = { fetchNseQuotes, getQuoteForSymbol, startAutoRefresh, clearCache };
