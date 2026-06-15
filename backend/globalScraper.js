const axios = require('axios');
const { withRetry } = require('./apiClient');

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CACHE_TTL = 60000; // 1 minute cache
const FETCH_TIMEOUT = 5000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

let globalCache = {};
let globalCacheTime = 0;

/**
 * Parse Yahoo chart API response into a normalized quote
 */
function parseChartResponse(symbol, result) {
  const meta = result.meta;
  const quotes = result.indicators?.quote?.[0];
  if (!meta) return null;
  const closes = quotes?.close?.filter(c => c != null) || [];
  const opens = quotes?.open?.filter(o => o != null) || [];
  const highs = quotes?.high?.filter(h => h != null) || [];
  const lows = quotes?.low?.filter(l => l != null) || [];
  const volumes = quotes?.volume?.filter(v => v != null) || [];
  const currentPrice = meta.regularMarketPrice || closes?.[closes.length - 1] || meta.previousClose || 0;
  const prevClose = meta.previousClose || currentPrice;
  const change = currentPrice - prevClose;
  return {
    symbol,
    company_name: meta.shortName || meta.longName || symbol,
    price: currentPrice,
    change,
    changePercent: prevClose ? (change / prevClose) * 100 : 0,
    changesPercentage: prevClose ? (change / prevClose) * 100 : 0,
    volume: meta.regularMarketVolume || (volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : 0),
    dayHigh: meta.regularMarketDayHigh || (highs.length > 0 ? Math.max(...highs) : currentPrice),
    dayLow: meta.regularMarketDayLow || (lows.length > 0 ? Math.min(...lows) : currentPrice),
    previousClose: prevClose,
    open: meta.regularMarketOpen || (opens.length > 0 ? opens[0] : prevClose),
    currency: meta.currency || 'USD',
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    provider: 'yahoo-chart',
    exchange: meta.exchangeName || 'Global',
  };
}

/**
 * Fetch a single stock quote from Yahoo chart API (with cache)
 */
async function fetchSingleStock(symbol) {
  const now = Date.now();
  if (globalCacheTime && (now - globalCacheTime) < CACHE_TTL && globalCache[symbol]) {
    return globalCache[symbol];
  }
  try {
    const { data } = await withRetry(
      () => axios.get(
        `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
        { timeout: FETCH_TIMEOUT, headers: { 'User-Agent': UA } }
      ),
      { label: `yahoo-chart:${symbol}`, maxRetries: 2, baseDelay: 500,
        shouldRetry: e => !e?.response || e.response.status >= 500 }
    );
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const parsed = parseChartResponse(symbol, result);
    if (parsed) {
      globalCache[symbol] = parsed;
      globalCacheTime = now;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetch multiple stock quotes in parallel from Yahoo chart API
 */
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

  const results = {};
  const entries = await Promise.allSettled(
    symbols.map(s => fetchSingleStock(s))
  );
  entries.forEach((entry, i) => {
    if (entry.status === 'fulfilled' && entry.value) {
      results[symbols[i]] = entry.value;
    }
  });

  if (Object.keys(results).length > 0) {
    Object.assign(globalCache, results);
    globalCacheTime = now;
    console.log(`[GlobalScraper] Fetched ${Object.keys(results).length}/${symbols.length} global stocks`);
  }

  return results;
}

/**
 * Fetch historical daily OHLCV data from Yahoo chart API
 * @param {string} symbol - Stock symbol (e.g. AAPL, MSFT)
 * @param {string} range - Time range: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max
 * @param {string} interval - Data interval: 1m, 2m, 5m, 15m, 30m, 60m, 1d, 1wk, 1mo
 */
async function fetchHistoricalQuotes(symbol, range = '6mo', interval = '1d') {
  try {
    const { data } = await withRetry(
      () => axios.get(
        `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
        { timeout: 10000, headers: { 'User-Agent': UA } }
      ),
      { label: `yahoo-hist:${symbol}`, maxRetries: 2, baseDelay: 500,
        shouldRetry: e => !e?.response || e.response.status >= 500 }
    );
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];

    const bars = timestamps.map((t, i) => ({
      date: new Date(t * 1000).toISOString().split('T')[0],
      timestamp: t,
      open: quote.open?.[i] ?? null,
      high: quote.high?.[i] ?? null,
      low: quote.low?.[i] ?? null,
      close: quote.close?.[i] ?? null,
      volume: quote.volume?.[i] ?? 0,
      adjclose: adjclose[i] ?? quote.close?.[i] ?? null,
    })).filter(d => d.close != null);

    return bars.length > 0 ? bars : null;
  } catch {
    return null;
  }
}

module.exports = { fetchGlobalQuotes, fetchSingleStock, fetchHistoricalQuotes };
