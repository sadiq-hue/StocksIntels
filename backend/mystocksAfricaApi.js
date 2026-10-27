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
// Listing pages (especially JSE) are materially slower than quotes/history and
// have been observed taking ~33s for a 200-row page. Keep the quote timeout tight
// but allow the listing endpoint enough time to return real breadth.
const LIST_FETCH_TIMEOUT = 40000;

// exchange code -> symbol suffix + settlement currency + our internal market tag.
const EXCHANGES = {
  NSE: { suffix: '.KE', currency: 'KES', market: 'NSE' },
  NGX: { suffix: '.NG', currency: 'NGN', market: 'NGX' },
  JSE: { suffix: '.ZA', currency: 'ZAR', market: 'JSE' },
};

const cache = new Map(); // `${exchange}:${ticker}` -> { value, time }
// Exchange listings are heavy and the partner endpoint is flaky on large pages
// (JSE 200 has been observed timing out intermittently). Cache successful pages,
// coalesce concurrent callers, and retry once so the daily brief and Markets page
// do not silently drop an exchange when one upstream request fails.
const listCache = new Map(); // `${exchange}|${limit}|${search}|${cursor}` -> { value, time }
const listInflight = new Map();
const LIST_CACHE_TTL_MS = 5 * 60 * 1000;
// Complete-universe cache: walk the cursor to the end once, then serve the full
// exchange. JSE has more than one 200-row page, so a single page is not a
// complete universe.
const fullListCache = new Map(); // `${exchange}|${limit}|${search}` -> { value, time }
const fullListInflight = new Map();

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
async function fetchListPage(exchange, limit, search, cursor) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await axios.get(`${API_BASE}/stocks`, {
        timeout: LIST_FETCH_TIMEOUT,
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
      lastError = e;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError || new Error('listStocks failed');
}

async function listStocks(exchange, { limit = 200, search = '', cursor = '' } = {}) {
  if (!API_KEY) return { data: [], hasMore: false, nextCursor: null };
  const key = `${exchange}|${limit}|${search}|${cursor}`;
  const cached = listCache.get(key);
  if (cached && Date.now() - cached.time < LIST_CACHE_TTL_MS) return cached.value;
  // Serve stale immediately and refresh in the background; this keeps the
  // Markets page and daily brief responsive while the partner recovers.
  if (cached) {
    fetchListPage(exchange, limit, search, cursor)
      .then(value => { if (value.data.length > 0) listCache.set(key, { value, time: Date.now() }); })
      .catch(() => {});
    return cached.value;
  }
  if (listInflight.has(key)) return listInflight.get(key);
  const pending = fetchListPage(exchange, limit, search, cursor)
    .then(value => {
      if (value.data.length > 0) listCache.set(key, { value, time: Date.now() });
      return value;
    })
    .catch(e => {
      console.warn(`[myStocksAfrica] listStocks ${exchange} failed: ${e.message}`);
      return { data: [], hasMore: false, nextCursor: null };
    })
    .finally(() => listInflight.delete(key));
  listInflight.set(key, pending);
  return pending;
}

// Complete exchange universe: follow the cursor to the end. Cached separately
// from individual pages so the daily brief, Markets page and Financials page all
// see the same complete listing. Stale-while-revalidate prevents a slow upstream
// refresh from blocking a page.
async function listAllStocks(exchange, { limit = 200, search = '', maxPages = 25 } = {}) {
  if (!API_KEY) return { data: [], hasMore: false, nextCursor: null, count: 0, complete: false };
  const key = `${exchange}|${limit}|${search}`;
  const cached = fullListCache.get(key);
  if (cached && Date.now() - cached.time < LIST_CACHE_TTL_MS) return cached.value;
  if (cached) {
    fetchAllListPages(exchange, limit, search, maxPages)
      .then(value => { if (value.data.length > 0) fullListCache.set(key, { value, time: Date.now() }); })
      .catch(() => {});
    return cached.value;
  }
  if (fullListInflight.has(key)) return fullListInflight.get(key);
  const pending = fetchAllListPages(exchange, limit, search, maxPages)
    .then(value => {
      if (value.data.length > 0) fullListCache.set(key, { value, time: Date.now() });
      return value;
    })
    .finally(() => fullListInflight.delete(key));
  fullListInflight.set(key, pending);
  return pending;
}

async function fetchAllListPages(exchange, limit, search, maxPages) {
  const all = [];
  let cursor = '';
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const chunk = await listStocks(exchange, { limit, search, cursor });
    if (!Array.isArray(chunk.data) || chunk.data.length === 0) break;
    all.push(...chunk.data);
    if (!chunk.hasMore || !chunk.nextCursor) { complete = true; break; }
    cursor = chunk.nextCursor;
  }
  return { data: all, hasMore: !complete, nextCursor: complete ? null : cursor, count: all.length, complete };
}

// Top movers for an exchange. `direction` is 'gainers' (default) or 'losers'
// — the partner endpoint returns one side per call, padded with 0% rows.
// The endpoint is rate-limited, so results are cached in-process per side.
const moversCache = new Map(); // `${exchange}:${direction}` -> { value, time }
const MOVERS_TTL_MS = 5 * 60 * 1000;

async function listMovers(exchange, direction) {
  if (!API_KEY) return [];
  const dir = direction === 'losers' ? 'losers' : 'gainers';
  const key = `${exchange}:${dir}`;
  const cached = moversCache.get(key);
  if (cached && Date.now() - cached.time < MOVERS_TTL_MS) return cached.value;
  try {
    const resp = await axios.get(`${API_BASE}/market/movers`, {
      timeout: FETCH_TIMEOUT * 2,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { exchange, direction: dir },
    });
    const d = resp.data || {};
    const rows = Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []);
    const out = rows.map(r => ({
      symbol: r.symbol || null,
      ticker: bareTicker(r.symbol),
      name: r.name || r.symbol || '',
      exchange: r.exchange || exchange,
      currency: r.currency || (EXCHANGES[exchange] || EXCHANGES.NSE).currency,
      assetType: r.assetType || r.asset_type || null,
      listingStatus: r.listingStatus || r.listing_status || null,
      stale: Boolean(r.stale),
      asOf: r.asOf || r.timestamp || null,
      price: Number(r.price) || 0,
      changePct: (Number(r.changePct) || 0) * 100,
      volume: Number(r.volume) || 0,
    }));
    moversCache.set(key, { value: out, time: Date.now() });
    return out;
  } catch (e) {
    console.warn(`[myStocksAfrica] movers ${exchange} ${dir} failed: ${e.message}`);
    return cached ? cached.value : [];
  }
}

// ── Market Intelligence Feed ──────────────────────────────────────────────────
// Cache per exchange — a single global cache meant the first call (e.g. JSE)
// was served for every later exchange (NGX), hiding NGX coverage entirely.
const intelCache = new Map(); // exchange|ALL -> { data, time }
const INTEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function fetchMarketIntel(exchange, limit = 10) {
  if (!API_KEY) return null;
  const key = exchange ? String(exchange).toUpperCase() : 'ALL';
  const cached = intelCache.get(key);
  const now = Date.now();
  if (cached && now - cached.time < INTEL_CACHE_TTL_MS) return cached.data;

  try {
    const resp = await axios.get(`${API_BASE}/market-intel`, {
      timeout: FETCH_TIMEOUT,
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
      params: { limit, ...(exchange ? { exchange } : {}) },
    });
    const articles = resp.data?.articles || resp.data?.data || resp.data;
    const result = Array.isArray(articles) ? articles : [];
    intelCache.set(key, { data: result, time: now });
    return result;
  } catch (e) {
    console.warn(`[myStocksAfrica] market-intel failed: ${e.message}`);
    return null;
  }
}

// Warm the complete exchange universes in the background. JSE is slow enough
// (~30s per page) that waiting until the first Markets/brief request would show
// an incomplete or empty JSE card; the cache/in-flight maps mean later requests
// share this fetch.
if (API_KEY) {
  const warm = setTimeout(() => {
    for (const ex of ['NSE', 'NGX', 'JSE']) {
      listAllStocks(ex, { limit: 200 }).catch(() => {});
    }
  }, 3000);
  if (warm && typeof warm.unref === 'function') warm.unref();
}

module.exports = {
  getQuoteForSymbol, getBatchQuotes, toApiSymbol, fetchHistorical, fetchMarketIntel,
  getExchanges, listStocks, listAllStocks, listMovers,
  exchangeOf, bareTicker, EXCHANGES,
};
