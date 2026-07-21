const axios = require('axios');

// MyStocks Africa Partner API — authoritative NSE (and other African exchange)
// market-data source. Approved production key is supplied via MYSTOCKS_AFRICA_API_KEY.
// Docs: https://mystocks.africa/partners/docs  (Market Data API)
// Quotes are DELAYED (~15 min, refreshed 08:00-16:00 UTC Mon-Fri) — see dataQuality on each quote.
const API_BASE = (process.env.MYSTOCKS_AFRICA_BASE_URL || 'https://mystocks.africa/api/v1/partner').replace(/\/$/, '');
const API_KEY = process.env.MYSTOCKS_AFRICA_API_KEY;
const EXCHANGE_SUFFIX = '.KE'; // NSE tickers are exchange-qualified, e.g. SCOM.KE
const CACHE_TTL_MS = 5 * 60 * 1000; // quotes are delayed 15min; 5min cache is plenty
const FETCH_TIMEOUT = 8000;

const cache = new Map(); // ticker(upper, no prefix) -> { value, time }

function toApiSymbol(raw) {
  let s = String(raw || '').replace(/^NSE:/i, '').trim().toUpperCase();
  if (!s) return s;
  if (s.includes('.')) return s; // already exchange-qualified (SCOM.KE) or other
  return s + EXCHANGE_SUFFIX;
}

function normalize(summary, rawSymbol) {
  if (!summary || summary.price == null) return null;
  const price = Number(summary.price);
  if (!price || isNaN(price)) return null;
  const change = Number(summary.change) || 0;
  // API returns changePct as a FRACTION (e.g. 0.00565 = 0.565%); the rest of the
  // app and the UI expect a PERCENTAGE, so convert. Derive from change if absent.
  let changePct = Number(summary.changePct);
  if (changePct && !isNaN(changePct)) changePct = changePct * 100;
  else if (change && price) changePct = (change / (price - change)) * 100;
  else changePct = 0;
  return {
    price,
    change,
    changesPercentage: changePct,
    changePercent: changePct,
    volume: Number(summary.volume) || 0,
    marketCap: Number(summary.marketCap) || 0, // not in quote payload; buildLocalNseReport computes price*shares
    open: Number(summary.open) || price,
    dayHigh: Number(summary.dayHigh) || price,
    dayLow: Number(summary.dayLow) || price,
    previousClose: Number(summary.previousClose) || price,
    company_name: summary.name || summary.symbol || rawSymbol,
    currency: 'KES',
    market: 'NSE',
    asOf: summary.lastPriceUpdate || summary.asOf || null,
    stale: Boolean(summary.stale),
    provider: 'mystocksAfrica',
  };
}

async function fetchSingle(apiSymbol) {
  const url = `${API_BASE}/market/quotes`;
  const resp = await axios.get(url, {
    timeout: FETCH_TIMEOUT,
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    params: { symbol: apiSymbol, exchange: 'NSE' },
  });
  const data = resp.data && resp.data.data;
  if (!data) return null;
  // Single-symbol mode returns a single StockSummary object.
  return Array.isArray(data) ? (data[0] || null) : data;
}

// Single-instrument quote, with a short in-memory cache. Returns the normalized
// shape consumed by marketService.getNseBaseQuote, or null on any failure.
async function getQuoteForSymbol(rawSymbol) {
  if (!API_KEY) return null;
  const ticker = String(rawSymbol || '').replace(/^NSE:/i, '').toUpperCase();
  if (!ticker) return null;

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.value;

  const apiSymbol = toApiSymbol(rawSymbol);
  try {
    const summary = await fetchSingle(apiSymbol);
    const norm = summary ? normalize(summary, rawSymbol) : null;
    cache.set(ticker, { value: norm, time: Date.now() });
    return norm;
  } catch (e) {
    console.warn(`[myStocksAfrica] quote failed for ${apiSymbol}: ${e.message}`);
    // Cache the miss briefly so a broken key / outage doesn't hammer the API.
    cache.set(ticker, { value: null, time: Date.now() });
    return null;
  }
}

// Batch refresh for the whole NSE universe (used by background cache if desired).
// Returns a map of bare ticker -> normalized quote.
async function getBatchQuotes(tickers) {
  if (!API_KEY || !Array.isArray(tickers) || tickers.length === 0) return {};
  const apiSymbols = tickers.map(toApiSymbol).filter(Boolean);
  try {
    const resp = await axios.get(`${API_BASE}/market/quotes`, {
      timeout: FETCH_TIMEOUT * 2,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { symbols: apiSymbols.slice(0, 50).join(',') },
    });
    const arr = resp.data && resp.data.data;
    const out = {};
    if (Array.isArray(arr)) {
      for (const s of arr) {
        const norm = normalize(s, s.symbol);
        if (norm) out[String(s.symbol || '').replace(/\.KE$/, '')] = norm;
      }
    }
    return out;
  } catch (e) {
    console.warn(`[myStocksAfrica] batch quotes failed: ${e.message}`);
    return {};
  }
}

// ── Historical OHLCV ──────────────────────────────────────────────────────────
// Fetches end-of-day candle data for NSE Kenya stocks from MyStocks Africa.
// Returns bars in the same shape used by the rest of the backend
//   { date, open, high, low, close, volume }
// The `range` param mirrors Yahoo's conventions (1d, 1mo, 3mo, 6mo, 1y, 2y, 5y).

const RANGE_TO_PERIOD = { '1d': '1W', '5d': '1W', '1mo': '1MO', '3mo': '3MO', '6mo': '6MO', '1y': '1Y', '2y': '2Y', '5y': '5Y', 'max': '5Y' };

async function fetchHistorical(rawSymbol, range = '6mo') {
  if (!API_KEY) return null;
  const ticker = String(rawSymbol || '').replace(/^NSE:/i, '').replace(/\.NSE$/i, '').toUpperCase();
  if (!ticker) return null;

  const apiSymbol = ticker.includes('.') ? ticker : ticker + EXCHANGE_SUFFIX;
  const period = RANGE_TO_PERIOD[range.toLowerCase()] || '6MO';

  try {
    const resp = await axios.get(`${API_BASE}/stocks/${encodeURIComponent(apiSymbol)}/history`, {
      timeout: 12000,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { period },
    });
    const candles = resp.data && (resp.data.candles || resp.data.data);
    if (!Array.isArray(candles) || candles.length === 0) return null;
    return candles.map(c => ({
      date: (c.date || '').slice(0, 10),   // normalise ISO → YYYY-MM-DD
      open:   Number(c.open)   || 0,
      high:   Number(c.high)   || 0,
      low:    Number(c.low)    || 0,
      close:  Number(c.close ?? c.price) || 0,
      volume: Number(c.volume) || 0,
    }));
  } catch (e) {
    console.warn(`[myStocksAfrica] historical failed for ${apiSymbol}: ${e.message}`);
    return null;
  }
}

module.exports = { getQuoteForSymbol, getBatchQuotes, toApiSymbol, fetchHistorical };
