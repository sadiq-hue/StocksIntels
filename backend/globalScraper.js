const yahooService = require('./yahooService');

const CACHE_TTL = 60000;
let globalCache = {};
let globalCacheTime = 0;

async function fetchSingleStock(symbol) {
  const now = Date.now();
  if (globalCacheTime && (now - globalCacheTime) < CACHE_TTL && globalCache[symbol]) {
    return globalCache[symbol];
  }
  const quote = await yahooService.fetchQuote(symbol);
  if (quote) {
    globalCache[symbol] = quote;
    globalCacheTime = now;
  }
  return quote || null;
}

async function fetchGlobalQuotes(symbols) {
  const now = Date.now();
  if (globalCacheTime && (now - globalCacheTime) < CACHE_TTL) {
    const cached = {};
    let allFound = true;
    for (const s of symbols) {
      if (globalCache[s]) cached[s] = globalCache[s];
      else allFound = false;
    }
    if (allFound) return cached;
  }

  const results = await yahooService.fetchQuotes(symbols);

  if (Object.keys(results).length > 0) {
    Object.assign(globalCache, results);
    globalCacheTime = now;
  }

  return results;
}

async function fetchHistoricalQuotes(symbol, range = '6mo', interval = '1d') {
  return yahooService.fetchHistorical(symbol, range, interval);
}

module.exports = { fetchGlobalQuotes, fetchSingleStock, fetchHistoricalQuotes };
