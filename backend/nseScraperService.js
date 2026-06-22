const axios = require('axios');

const RAPIDAPI_HOST = 'nairobi-stock-exchange-nse.p.rapidapi.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

const SYMBOL_MAP = {
  KLG: 'KQ',
  BAMB: 'BAMB',
  OLYM: 'OCH',
  CRAY: 'CRWN',
  UMEM: 'UMME',
};

let cache = null;
let cacheTime = 0;
let rateLimitedUntil = 0;

function getApiKey() {
  return process.env.RAPIDAPI_KEY || '';
}

function isCacheValid() {
  return cache && (Date.now() - cacheTime) < CACHE_TTL_MS;
}

function parseChange(changeStr) {
  if (!changeStr || typeof changeStr !== 'string') return { change: 0, changePercent: 0 };
  const cleaned = changeStr.replace(/\s/g, '').trim();
  const m = cleaned.match(/^([+-]?\d+\.?\d*)%$/);
  if (m) return { change: 0, changePercent: parseFloat(m[1]) };
  const m2 = cleaned.match(/^([+-]?\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)$/);
  if (m2) return { change: parseFloat(m2[1]), changePercent: parseFloat(m2[2]) };
  const m3 = cleaned.match(/^([+-]?\d+\.?\d*)%?\s*\/\s*([+-]?\d+\.?\d*)$/);
  if (m3) return { change: parseFloat(m3[1]), changePercent: parseFloat(m3[2]) };
  const m4 = cleaned.match(/^([+-]?\d+\.?\d*)$/);
  if (m4) return { change: 0, changePercent: parseFloat(m4[1]) };
  return { change: 0, changePercent: 0 };
}

function parseStockResult(item, requestedSymbol) {
  if (!item) return null;
  const ticker = (item.ticker || '').toUpperCase();
  const cleanSymbol = requestedSymbol ? requestedSymbol.replace('NSE:', '').toUpperCase() : ticker;
  const { change, changePercent } = parseChange(item.change);
  const price = parseFloat(item.price) || 0;
  const volume = parseInt((item.volume || '0').replace(/[,\s]/g, ''), 10) || 0;
  if (!price && !volume) return null;
  return {
    symbol: `NSE:${cleanSymbol}`,
    company_name: item.name || cleanSymbol,
    price,
    currency: 'KES',
    change,
    changePercent,
    changesPercentage: changePercent,
    volume,
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    exchange: 'NSE',
    provider: 'nse-scraper',
  };
}

function buildLookup(stocks) {
  const lookup = {};
  for (const s of stocks) {
    const t = (s.ticker || '').toUpperCase();
    lookup[t] = s;
    const mapped = SYMBOL_MAP[t];
    if (mapped) lookup[mapped] = s;
  }
  return lookup;
}

function lookupStock(lookup, symbol) {
  const clean = symbol.replace('NSE:', '').toUpperCase();
  return lookup[clean] || lookup[SYMBOL_MAP[clean]] || null;
}

async function refreshCache() {
  if (isCacheValid()) return true;
  if (Date.now() < rateLimitedUntil) return cache !== null;
  const key = getApiKey();
  if (!key) return false;
  try {
    const resp = await axios.get(`https://${RAPIDAPI_HOST}/stocks`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': RAPIDAPI_HOST },
      timeout: 10000,
    });
    if (resp.data?.success && Array.isArray(resp.data?.data)) {
      cache = resp.data.data;
      cacheTime = Date.now();
      return true;
    }
    return false;
  } catch (err) {
    if (err.response?.status === 429) {
      rateLimitedUntil = Date.now() + 5 * 60 * 1000;
      console.warn(`[nseScraperService] Rate limited (429), retrying in 5 min`);
    }
    return cache !== null;
  }
}

async function fetchNSEQuote(symbol) {
  if (!symbol || !symbol.startsWith('NSE:')) return null;
  await refreshCache();
  if (!cache) return null;
  const stock = lookupStock(buildLookup(cache), symbol);
  return stock ? parseStockResult(stock, symbol) : null;
}

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};
  await refreshCache();
  if (!cache) return {};
  const lookup = buildLookup(cache);
  const map = {};
  for (const s of nseSymbols) {
    const stock = lookupStock(lookup, s);
    if (stock) {
      const parsed = parseStockResult(stock, s);
      if (parsed) {
        parsed.symbol = s;
        map[s] = parsed;
      }
    }
  }
  return map;
}

async function fetchGlobalQuote(symbol) {
  return null;
}

async function fetchBatchGlobalQuotes(symbols) {
  return {};
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes, fetchGlobalQuote, fetchBatchGlobalQuotes };
