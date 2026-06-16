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
  const bars = await fetchYahooHistoricalQuotes(symbol, range, interval);
  if (bars && bars.length > 0) return bars;

  // Fallback: RapidAPI Yahoo Finance proxy
  const rapidBars = await fetchRapidApiHistoricalQuotes(symbol, range, interval);
  if (rapidBars && rapidBars.length > 0) return rapidBars;

  return null;
}

async function fetchYahooHistoricalQuotes(symbol, range, interval) {
  try {
    const { data } = await withRetry(
      () => axios.get(
        `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
        { timeout: 10000, headers: { 'User-Agent': UA } }
      ),
      { label: `yahoo-hist:${symbol}`, maxRetries: 2, baseDelay: 500,
        shouldRetry: e => !e?.response || e.response.status >= 500 }
    );
    return parseYahooChartResult(data);
  } catch {
    return null;
  }
}

async function fetchRapidApiHistoricalQuotes(symbol, range, interval) {
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host) return null;

  const rangeMap = { '1d': '1d', '5d': '5d', '1mo': '1mo', '3mo': '3mo', '6mo': '6mo', '1y': '1y', '2y': '2y', '5y': '5y', 'max': 'max' };
  const intervalMap = { '1m': '1m', '2m': '2m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '60m', '1d': '1d', '1wk': '1wk', '1mo': '1mo' };
  const rapidRange = rangeMap[range] || '6mo';
  const rapidInterval = intervalMap[interval] || '1d';

  const endpoints = [
    { path: '/api/v1/markets/stocks/historical-prices', params: { symbol: symbol.toUpperCase(), range: rapidRange, interval: rapidInterval, region: 'US' } },
    { path: '/api/yahoo/hi/history', params: { symbol: symbol.toUpperCase(), range: rapidRange, interval: rapidInterval, region: 'US' } },
    { path: '/stock/v3/get-chart', params: { symbol: symbol.toUpperCase(), range: rapidRange, interval: rapidInterval, region: 'US' } },
  ];

  for (const ep of endpoints) {
    try {
      const { data } = await axios.get(`https://${host}${ep.path}`, {
        params: ep.params,
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 8000,
      });
      const bars = parseYahooChartResult(data);
      if (bars && bars.length > 0) {
        console.log(`[GlobalScraper] RapidAPI historical data for ${symbol} via ${ep.path}: ${bars.length} bars`);
        return bars;
      }
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`[GlobalScraper] RapidAPI rate limited for historical ${symbol}`);
        return null;
      }
    }
  }
  return null;
}

function parseYahooChartResult(data) {
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
}

module.exports = { fetchGlobalQuotes, fetchSingleStock, fetchHistoricalQuotes };
