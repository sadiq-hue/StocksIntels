const { polygon } = require('./apiClient');

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE = 'https://api.polygon.io';

/**
 * Map ticker to Polygon.io exchange suffix
 */
function toPolygonTicker(symbol) {
  const clean = symbol.replace('NSE:', '').toUpperCase();
  const isIndex = clean.startsWith('NSE') || clean.startsWith('^');
  if (isIndex) return null;
  if (symbol.startsWith('NSE:')) return `${clean}.XNSE`;
  return clean;
}

/**
 * Fetch the latest trade price from Polygon.io
 */
async function fetchLastTrade(symbol) {
  const ticker = toPolygonTicker(symbol);
  if (!ticker) return null;
  try {
    const { data } = await polygon.get(
      `${POLYGON_BASE}/v2/last/trade/${ticker}?apiKey=${POLYGON_API_KEY}`,
      { timeout: 8000 }
    );
    if (data?.status === 'OK' && data.results) {
      return {
        price: data.results.p,
        timestamp: Math.floor(data.results.t / 1000000000),
      };
    }
  } catch (err) {
    if (err.response?.status !== 404 && err.response?.status !== 403) {
      console.error(`[Polygon] lastTrade error for ${ticker}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Fetch previous day OHLCV aggregate from Polygon.io
 */
async function fetchPrevAgg(symbol) {
  const ticker = toPolygonTicker(symbol);
  if (!ticker) return null;
  try {
    const { data } = await polygon.get(
      `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`,
      { timeout: 8000 }
    );
    if (data?.status === 'OK' && data.results?.length > 0) {
      const r = data.results[0];
      return {
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
        vwap: r.vw,
        timestamp: Math.floor(r.t / 1000000000),
        trades: r.n,
      };
    }
  } catch (err) {
    if (err.response?.status !== 404 && err.response?.status !== 403) {
      console.error(`[Polygon] prevAgg error for ${ticker}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Get a complete quote from Polygon.io (last trade + prev day agg)
 */
async function fetchFromPolygon(symbol) {
  if (!POLYGON_API_KEY) return null;

  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const isKenyan = symbol.startsWith('NSE:');

  const [trade, agg] = await Promise.all([
    fetchLastTrade(symbol),
    fetchPrevAgg(symbol),
  ]);

  if (!trade && !agg) return null;

  const price = trade?.price ?? agg?.close ?? 0;
  const previousClose = agg?.close ?? price;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    symbol: isKenyan ? `NSE:${cleanSymbol}` : cleanSymbol,
    company_name: cleanSymbol,
    price,
    currency: isKenyan ? 'KES' : 'USD',
    change,
    changePercent,
    changesPercentage: changePercent,
    volume: agg?.volume ?? 0,
    dayHigh: agg?.high ?? price,
    dayLow: agg?.low ?? price,
    previousClose,
    timestamp: trade?.timestamp ?? agg?.timestamp ?? Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    exchange: isKenyan ? 'NSE' : 'Global',
    provider: 'polygon',
  };
}

/**
 * Fetch quotes for multiple symbols in parallel via Polygon.io
 */
async function fetchBatchFromPolygon(symbols) {
  if (!POLYGON_API_KEY || !symbols.length) return {};
  const results = {};
  const BATCH_SIZE = 3;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const quotes = await Promise.all(batch.map(s => fetchFromPolygon(s).catch(() => null)));
    batch.forEach((s, idx) => {
      if (quotes[idx]) results[s] = quotes[idx];
    });
  }
  return results;
}

// Provider interface for brokerService
async function validateCredentials(apiKey, apiSecret, config) {
  if (!apiKey && !process.env.POLYGON_API_KEY) {
    return { valid: false, error: "Polygon API key not configured" };
  }
  return { valid: true };
}

async function sync(apiKey, apiSecret, userId, pool, config) {
  return { positions: [], account: null };
}

module.exports = { fetchFromPolygon, fetchBatchFromPolygon, fetchLastTrade, fetchPrevAgg, validateCredentials, sync };
