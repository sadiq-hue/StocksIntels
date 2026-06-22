const axios = require('axios');

const RAPIDAPI_HOST = 'nairobi-stock-exchange-nse.p.rapidapi.com';

const SYMBOL_MAP = {
  KLG: 'KQ',
  BAMB: 'BAMB',
  OLYM: 'OCH',
  CRAY: 'CRWN',
  UMEM: 'UMME',
};

function getApiKey() {
  return process.env.RAPIDAPI_KEY || '';
}

function mapTicker(ticker) {
  const upper = ticker.replace('NSE:', '').toUpperCase();
  return SYMBOL_MAP[upper] || upper;
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

async function fetchAllStocks() {
  const key = getApiKey();
  if (!key) return [];
  const host = RAPIDAPI_HOST;
  try {
    const resp = await axios.get(`https://${host}/stocks`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
      timeout: 10000,
    });
    if (resp.data?.success && Array.isArray(resp.data?.data)) {
      return resp.data.data;
    }
    return [];
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) {
      console.warn(`[nseScraperService] Rate limited (429) on fetchAllStocks`);
    }
    return [];
  }
}

async function fetchSingleStock(ticker) {
  const key = getApiKey();
  if (!key) return null;
  const mapped = mapTicker(ticker);
  const host = RAPIDAPI_HOST;
  try {
    const resp = await axios.get(`https://${host}/stocks`, {
      params: { search: mapped, limit: 1 },
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
      timeout: 10000,
    });
    if (resp.data?.success && Array.isArray(resp.data?.data) && resp.data.data.length > 0) {
      return parseStockResult(resp.data.data[0], ticker);
    }
    return null;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429) {
      console.warn(`[nseScraperService] Rate limited (429) on fetchSingleStock ${mapped}`);
    }
    return null;
  }
}

async function fetchNSEQuote(symbol) {
  if (!symbol || !symbol.startsWith('NSE:')) return null;
  return fetchSingleStock(symbol);
}

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};
  const allStocks = await fetchAllStocks();
  if (!allStocks.length) return {};
  const map = {};
  const lookup = {};
  for (const s of allStocks) {
    const t = (s.ticker || '').toUpperCase();
    lookup[t] = s;
    lookup[SYMBOL_MAP[t] || t] = s;
  }
  for (const s of nseSymbols) {
    const clean = s.replace('NSE:', '').toUpperCase();
    for (const [key, stock] of Object.entries(lookup)) {
      if (key === clean || clean === key || clean.endsWith(key)) {
        const parsed = parseStockResult(stock, s);
        if (parsed) {
          parsed.symbol = s;
          map[s] = parsed;
        }
        break;
      }
    }
    if (!map[s]) {
      const stock = lookup[clean];
      if (stock) {
        const parsed = parseStockResult(stock, s);
        if (parsed) {
          parsed.symbol = s;
          map[s] = parsed;
        }
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
