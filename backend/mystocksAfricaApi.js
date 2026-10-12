const axios = require('axios');

// MyStocks Africa Partner API — authoritative market data for NSE (Kenya) and the
// other approved African exchanges (NGX Nigeria, JSE South Africa, GSE, BRVM...).
// Docs: https://mystocks.africa/partners/docs  (Market Data API)
// Quotes are DELAYED (~15 min) during 08:00-16:00 UTC weekdays, end-of-day
// outside that window — see dataQuality on each quote.

const API_BASE = (process.env.MYSTOCKS_AFRICA_BASE_URL || 'https://mystocks.africa/api/v1/partner').replace(/\/$/, '');
const API_KEY = process.env.MYSTOCKS_AFRICA_API_KEY;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT = 8000;

// exchange code -> symbol suffix + settlement currency + our internal market tag.
const EXCHANGES = {
  NSE: { suffix: '.KE', currency: 'KES', market: 'NSE' },
  NGX: { suffix: '.NG', currency: 'NGN', market: 'NGX' },
  JSE: { suffix: '.ZA', currency: 'ZAR', market: 'JSE' },
};

const cache = new Map(); // `${exchange}:${ticker}` -> { value, time }

// Detect the exchange from a symbol ("NGX:MTN", "MTN.ZA", "SCOM.KE") or an
// explicit exchange argument, defaulting to NSE to preserve legacy callers.
function exchangeOf(raw, fallback = 'NSE') {
  const s = String(raw || '').toUpperCase();
  if (s.startsWith('NGX:')) return 'NGX';
  if (s.startsWith('JSE:')) return 'JSE';
  if (s.startsWith('NSE:')) return 'NSE';
  if (s.endsWith('.NG')) return 'NGX';
  if (s.endsWith('.ZA')) return 'JSE';
  if (s.endsWith('.KE')) return 'NSE';
  return EXCHANGES[fallback] ? fallback : 'NSE';
}

function bareTicker(raw) {
  return String(raw || '')
    .replace(/^(NSE|NGX|JSE):/i, '')
    .replace(/\.(KE|NG|ZA)$/i, '')
    .trim()
    .toUpperCase();
}

function toApiSymbol(raw, exchange) {
  const ex = EXCHANGES[exchange] ? exchange : exchangeOf(raw);
  const t = bareTicker(raw);
  if (!t) return t;
  if (t.includes('.')) return t; // already exchange-qualified
  return t + (EXCHANGES[ex] || EXCHANGES.NSE).suffix;
}

function normalize(summary, rawSymbol, exchange) {
  if (!summary || summary.price == null) return null;
  const ex = EXCHANGES[exchange] || EXCHANGES.NSE;
  const price = Number(summary.price);
  if (!price || isNaN(price)) return null;
  const previousClose = Number(summary.previousClose) || price;
  const derivedChange = price - previousClose;
  let changePct = Number(summary.changePct);
  if (changePct && !isNaN(changePct) && changePct !== 0) {
    changePct = changePct * 100; // API returns a fraction
  } else if (previousClose > 0) {
    changePct = (derivedChange / previousClose) * 100;
  } else {
    changePct = 0;
  }
  return {
    price,
    change: derivedChange,
    changesPercentage: changePct,
    changePercent: changePct,
    volume: Number(summary.volume) || 0,
    marketCap: Number(summary.marketCap) || 0,
    open: Number(summary.open) || price,
    dayHigh: Number(summary.dayHigh) || price,
    dayLow: Number(summary.dayLow) || price,
    previousClose,
    company_name: summary.name || summary.symbol || rawSymbol,
    currency: ex.currency,
    market: ex.market,
    exchange: ex.market,
    sector: summary.sector || null,
    asOf: summary.lastPriceUpdate || summary.asOf || null,
    stale: Boolean(summary.stale),
    provider: 'mystocksAfrica',
  };
}

async function fetchSingle(apiSymbol, exchange) {
  const resp = await axios.get(`${API_BASE}/market/quotes`, {
    timeout: FETCH_TIMEOUT,
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    params: { symbol: apiSymbol, exchange: exchange || 'NSE' },
  });
  const data = resp.data && resp.data.data;
  if (!data) return null;
  // Single-symbol mode returns a single StockSummary object.
  return Array.isArray(data) ? (data[0] || null) : data;
}

// Single-instrument quote, with a short in-memory cache. Returns the normalized
// shape consumed by marketService, or null on any failure.
async function getQuoteForSymbol(rawSymbol, exchange) {
  if (!API_KEY) return null;
  const ex = exchangeOf(rawSymbol, exchange || 'NSE');
  const ticker = bareTicker(rawSymbol);
  if (!ticker) return null;

  const key = `${ex}:${ticker}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.value;

  const apiSymbol = toApiSymbol(rawSymbol, ex);
  try {
    const summary = await fetchSingle(apiSymbol, ex);
    const norm = summary ? normalize(summary, rawSymbol, ex) : null;
    cache.set(key, { value: norm, time: Date.now() });
    return norm;
  } catch (e) {
    console.warn(`[myStocksAfrica] quote failed for ${apiSymbol}: ${e.message}`);
    cache.set(key, { value: null, time: Date.now() });
    return null;
  }
}

// Batch quotes for one exchange. Bare tickers (no suffix) on the way in; a map of
// bare ticker -> normalized quote on the way out.
async function getBatchQuotes(tickers, exchange) {
  if (!API_KEY || !Array.isArray(tickers) || tickers.length === 0) return {};
  const ex = exchange || 'NSE';
  const apiSymbols = tickers.map(t => toApiSymbol(t, ex)).filter(Boolean);
  if (apiSymbols.length === 0) return {};
  try {
    const resp = await axios.get(`${API_BASE}/market/quotes`, {
      timeout: FETCH_TIMEOUT * 2,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { symbols: apiSymbols.slice(0, 50).join(','), exchange: ex },
    });
    const arr = resp.data && resp.data.data;
    const out = {};
    if (Array.isArray(arr)) {
      for (const s of arr) {
        const norm = normalize(s, s.symbol, ex);
        if (norm) out[bareTicker(s.symbol)] = norm;
      }
    }
    return out;
  } catch (e) {
    console.warn(`[myStocksAfrica] batch quotes failed: ${e.message}`);
    return {};
  }
}

// ── Historical OHLCV ──────────────────────────────────────────────────────────
const RANGE_TO_PERIOD = { '1d': '1W', '5d': '1W', '1mo': '1MO', '3mo': '3MO', '6mo': '6MO', '1y': '1Y', '2y': '2Y', '5y': '5Y', 'max': '5Y' };

async function fetchHistorical(rawSymbol, range = '6mo', exchange) {
  if (!API_KEY) return null;
  const ex = exchangeOf(rawSymbol, exchange || 'NSE');
  const ticker = bareTicker(rawSymbol);
  if (!ticker) return null;

  const apiSymbol = ticker.includes('.') ? ticker : ticker + (EXCHANGES[ex] || EXCHANGES.NSE).suffix;
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

// ── Exchange catalog / listings / movers ──────────────────────────────────────

// List supported exchanges (code, MIC, country, currency, trading hours...).
async function getExchanges() {
  if (!API_KEY) return [];
  try {
    const resp = await axios.get(`${API_BASE}/market/exchanges`, {
      timeout: FETCH_TIMEOUT,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    });
    const d = resp.data || {};
    return Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []);
  } catch (e) {
    console.warn(`[myStocksAfrica] exchanges failed: ${e.message}`);
    return [];
  }
}

// List stocks on an exchange. Returns { data, hasMore, nextCursor }.
async function listStocks(exchange, { limit = 200, search = '', cursor = '' } = {}) {
  if (!API_KEY) return { data: [], hasMore: false, nextCursor: null };
  try {
    const resp = await axios.get(`${API_BASE}/stocks`, {
      timeout: FETCH_TIMEOUT * 2,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { exchange, limit, ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) },
    });
    const d = resp.data || {};
    const rows = Array.isArray(d.stocks) ? d.stocks : (Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []));
    return {
      data: rows.map(r => ({
        symbol: r.symbol || null,
        ticker: bareTicker(r.symbol),
        name: r.name || r.symbol || '',
        exchange: r.exchange || exchange,
        currency: r.currency || (EXCHANGES[exchange] || EXCHANGES.NSE).currency,
        sector: r.sector || null,
        price: Number(r.price) || 0,
        changePct: (Number(r.changePct) || 0) * 100,
        volume: Number(r.volume) || 0,
      })),
      hasMore: !!d.hasMore,
      nextCursor: d.nextCursor || null,
    };
  } catch (e) {
    console.warn(`[myStocksAfrica] listStocks ${exchange} failed: ${e.message}`);
    return { data: [], hasMore: false, nextCursor: null };
  }
}

// Top movers (gainers/losers) for an exchange.
async function listMovers(exchange) {
  if (!API_KEY) return [];
  try {
    const resp = await axios.get(`${API_BASE}/market/movers`, {
      timeout: FETCH_TIMEOUT * 2,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { exchange },
    });
    const d = resp.data || {};
    const rows = Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []);
    return rows.map(r => ({
      symbol: r.symbol || null,
      ticker: bareTicker(r.symbol),
      name: r.name || r.symbol || '',
      exchange: r.exchange || exchange,
      currency: r.currency || (EXCHANGES[exchange] || EXCHANGES.NSE).currency,
      price: Number(r.price) || 0,
      changePct: (Number(r.changePct) || 0) * 100,
      volume: Number(r.volume) || 0,
    }));
  } catch (e) {
    console.warn(`[myStocksAfrica] movers ${exchange} failed: ${e.message}`);
    return [];
  }
}

// ── Market Intelligence Feed ──────────────────────────────────────────────────
const intelCache = { data: null, time: 0 };
const INTEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function fetchMarketIntel(exchange, limit = 10) {
  if (!API_KEY) return null;
  const now = Date.now();
  if (intelCache.data && now - intelCache.time < INTEL_CACHE_TTL_MS) return intelCache.data;

  try {
    const resp = await axios.get(`${API_BASE}/market-intel`, {
      timeout: FETCH_TIMEOUT,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { limit, ...(exchange ? { exchange } : {}) },
    });
    const articles = resp.data?.articles || resp.data?.data || resp.data;
    const result = Array.isArray(articles) ? articles : [];
    intelCache.data = result;
    intelCache.time = now;
    return result;
  } catch (e) {
    console.warn(`[myStocksAfrica] market-intel failed: ${e.message}`);
    return null;
  }
}

module.exports = {
  getQuoteForSymbol, getBatchQuotes, toApiSymbol, fetchHistorical, fetchMarketIntel,
  getExchanges, listStocks, listMovers,
  exchangeOf, bareTicker, EXCHANGES,
};
