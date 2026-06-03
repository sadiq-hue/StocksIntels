const { eodhd, fmp } = require('./apiClient');
const { KENYAN_STOCKS } = require('./newsService');

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const EODHD_API_KEY = process.env.EODHD_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const MARKET_DATA_PROVIDER = process.env.MARKET_DATA_PROVIDER || 'fmp';

// Unified Quote Cache and Base Data
const quoteCache = new Map();
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000; // 5 minutes cache for market data

const BASE_QUOTES = {
  'NSE:SCOM': { company_name: 'Safaricom', price: 28.5, previousClose: 28.1, volume: 15200000 },
  'AAPL': { company_name: 'Apple Inc.', price: 270.1, previousClose: 268.5, volume: 55000000 },
  'MSFT': { company_name: 'Microsoft Corp.', price: 430.5, previousClose: 428.2, volume: 22000000 },
  'NVDA': { company_name: 'NVIDIA Corp.', price: 118.74, previousClose: 115.5, volume: 280000000 },
  'TSLA': { company_name: 'Tesla Inc.', price: 176.43, previousClose: 179.3, volume: 100000000 },
  'AMZN': { company_name: 'Amazon.com Inc.', price: 182.21, previousClose: 180.5, volume: 45000000 },
  'GOOGL': { company_name: 'Alphabet Inc.', price: 171.54, previousClose: 170.2, volume: 25000000 },
  'META': { company_name: 'Meta Platforms', price: 498.62, previousClose: 490.1, volume: 18000000 },
  'NFLX': { company_name: 'Netflix Inc.', price: 622.47, previousClose: 610.0, volume: 4500000 },
  'JPM': { company_name: 'JPMorgan Chase', price: 198.74, previousClose: 197.5, volume: 9000000 },
  'V': { company_name: 'Visa Inc.', price: 281.15, previousClose: 279.8, volume: 7500000 }
};

/**
 * Shared name mapper for consistent display
 */
function getCompanyName(symbol) {
  const ticker = symbol.replace('NSE:', '').toUpperCase();
  const names = {
    'SCOM': 'Safaricom', 'EQTY': 'Equity Group', 'KCB': 'KCB Group', 'EABL': 'EABL',
    'ABSA': 'Absa Bank', 'SBIC': 'Stanbic Holdings', 'KLG': 'Kenya Airways',
    'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'NVDA': 'NVIDIA Corp.',
    'TSLA': 'Tesla Inc.', 'AMZN': 'Amazon.com Inc.', 'GOOGL': 'Alphabet Inc.',
    'META': 'Meta Platforms', 'NFLX': 'Netflix Inc.', 'JPM': 'JPMorgan Chase', 'V': 'Visa Inc.'
  };
  return names[ticker] || KENYAN_STOCKS[ticker] || ticker;
}

/**
 * Generates a synthetic quote when live providers are unavailable
 */
function getSyntheticQuote(symbol) {
  const isGlobal = !symbol.startsWith('NSE:');
  const base = BASE_QUOTES[symbol] || { 
    price: isGlobal ? 150 : 10, 
    previousClose: isGlobal ? 150 : 10, 
    volume: 100000 
  };
  
  const cached = quoteCache.get(symbol) || base;
  const volatility = symbol.startsWith('NSE:NSE') ? 0.12 : 0.55; 
  const driftPercent = (Math.random() - 0.5) * volatility;
  const nextPrice = Math.max(0.01, cached.price * (1 + driftPercent / 100));
  const volumeDelta = Math.floor(Math.random() * Math.max(1, Math.floor(cached.volume * 0.003)));
  const previousClose = cached.previousClose || base.previousClose || nextPrice;
  const change = nextPrice - previousClose;

  const synthetic = {
    symbol,
    company_name: base.company_name || getCompanyName(symbol),
    currency: symbol.startsWith('NSE:') ? 'KES' : 'USD', // Explicitly check original symbol
    price: nextPrice,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    changesPercentage: previousClose ? (change / previousClose) * 100 : 0,
    volume: cached.volume + volumeDelta,
    dayHigh: Math.max(cached.dayHigh || nextPrice, nextPrice),
    dayLow: Math.min(cached.dayLow || nextPrice, nextPrice),
    previousClose,
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    provider: 'synthetic',
    exchange: isGlobal ? 'Global' : 'NSE'
  };

  quoteCache.set(symbol, synthetic);
  return synthetic;
}

/**
 * Fetches real-time price data using a unified logic for both NSE and Global stocks.
 */
async function getStockQuote(symbol) {
  if (!symbol) return null;
  
  // 1. Check Cache
  const cached = quoteCache.get(symbol);
  if (cached && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
    return cached;
  }

  let quote = null;

  // 2. Try preferred provider based on MARKET_DATA_PROVIDER
  if (MARKET_DATA_PROVIDER === 'polygon' && POLYGON_API_KEY) {
    const { fetchFromPolygon } = require('./polygonService');
    quote = await fetchFromPolygon(symbol);
  } else if (MARKET_DATA_PROVIDER === 'eodhd' && EODHD_API_KEY) {
    quote = await fetchFromEODHD(symbol);
  }
  // 3. Fallback: try other providers in order
  if (!quote && MARKET_DATA_PROVIDER !== 'polygon' && POLYGON_API_KEY) {
    const { fetchFromPolygon } = require('./polygonService');
    quote = await fetchFromPolygon(symbol);
  }
  if (!quote && MARKET_DATA_PROVIDER !== 'eodhd' && EODHD_API_KEY) {
    quote = await fetchFromEODHD(symbol);
  }
  if (!quote && FMP_API_KEY) {
    quote = await fetchFromFMP(symbol);
  }
  // 4. Try Yahoo Finance (yahoo-finance2 or RapidAPI) as last resort
  if (!quote && RAPIDAPI_KEY) {
    const { fetchNSEQuote } = require('./rapidApiService');
    quote = await fetchNSEQuote(symbol);
  }

  // 5. Update Cache and return (or return synthetic)
  if (quote) {
    console.log(`[MarketService] Caching quote for ${symbol}:`, quote);
    quoteCache.set(symbol, quote);
    return quote;
  }

  return getSyntheticQuote(symbol);
}

/**
 * EODHD Implementation
 */
async function fetchFromEODHD(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const isIndex = cleanSymbol.startsWith('NSE') || cleanSymbol.startsWith('^');
  const isKenyan = !!KENYAN_STOCKS[cleanSymbol] || isIndex;

  // EODHD requires exchange suffixes (e.g. .XNSE, .US, .INDX)
  let fetchSymbol = cleanSymbol;
  if (isKenyan && !isIndex) {
    fetchSymbol = `${cleanSymbol}.XNSE`;
  } else if (isIndex) {
    // Kenyan indices on EODHD typically use .INDX suffix
    fetchSymbol = `${cleanSymbol}.INDX`;
  } else if (!isKenyan && !isIndex && !cleanSymbol.includes('.')) {
    // Default to US exchange for global stocks like AAPL to ensure EODHD finds them
    fetchSymbol = `${cleanSymbol}.US`;
  }

  try {
    console.log(`[MarketService] Fetching EODHD data for: ${fetchSymbol}`);
    const response = await eodhd.get(`https://eodhd.com/api/real-time/${fetchSymbol}?api_token=${EODHD_API_KEY}&fmt=json`);
    const data = response.data;

    // Ensure we have a valid quote object and not an error response (EODHD errors also have a 'code' field)
    if (data && (data.code || data.symbol) && data.close !== undefined) {
      console.log(`[MarketService] EODHD Success: ${fetchSymbol} @ ${data.close}`);
      const timestamp = data.timestamp || Math.floor(Date.now() / 1000);
      return {
        symbol: isKenyan ? `NSE:${cleanSymbol}` : cleanSymbol,
        company_name: KENYAN_STOCKS[cleanSymbol] || cleanSymbol,
        price: Number(data.close || data.price) || 0,
        currency: symbol.startsWith('NSE:') ? 'KES' : 'USD',
        change: Number(data.change) || 0,
        changePercent: Number(data.change_p) || 0,
        changesPercentage: Number(data.change_p) || 0,
        volume: data.volume,
        dayHigh: data.high,
        dayLow: data.low,
        previousClose: data.previousClose || data.previous_close,
        timestamp,
        lastUpdated: new Date(timestamp * 1000).toISOString(),
        exchange: isKenyan ? 'NSE' : 'Global',
        provider: 'eodhd'
      };
    }
    console.warn(`[MarketService] EODHD returned no data for ${fetchSymbol}:`, data);
    return null;
  } catch (error) {
    console.error(`[MarketService] EODHD error for ${fetchSymbol}: ${error.message}`);
    return null;
  }
}

/**
 * FMP Implementation (Original)
 */
async function fetchFromFMP(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const isIndex = cleanSymbol.startsWith('NSE') || cleanSymbol.startsWith('^');
  const isKenyan = !!KENYAN_STOCKS[cleanSymbol] || isIndex;

  let fetchSymbol = cleanSymbol;
  if (isKenyan && !isIndex) {
    fetchSymbol = `${cleanSymbol}.NR`;
  }

  try {
    if (!FMP_API_KEY) throw new Error('FMP_API_KEY missing');
    const response = await fmp.get(`${FMP_BASE_URL}/quote`, {
      params: { symbol: fetchSymbol, apikey: FMP_API_KEY },
      timeout: 10000
    });
    const data = (Array.isArray(response.data) ? response.data[0] : response.data);

    if (data && data.symbol) {
      return {
        symbol: isKenyan ? `NSE:${cleanSymbol}` : cleanSymbol,
        company_name: data.name || cleanSymbol,
        price: Number(data.price) || 0,
        currency: symbol.startsWith('NSE:') ? 'KES' : (data.currency || 'USD'),
        change: Number(data.change) || 0,
        changePercent: Number(data.changePercentage ?? data.changesPercentage) || 0,
        changesPercentage: Number(data.changePercentage ?? data.changesPercentage) || 0,
        volume: data.volume,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        previousClose: data.previousClose,
        timestamp: data.timestamp || Math.floor(Date.now() / 1000),
        lastUpdated: new Date((data.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        exchange: data.exchange,
        provider: 'fmp'
      };
    }
    return null;
  } catch (error) {
    if (error.response?.status === 403) {
      console.warn(`[MarketService] 403 Forbidden for ${fetchSymbol}. Using fallback.`);
    } else if (error.response?.status === 401) {
      console.error(`[MarketService] 401 Unauthorized. Check if your FMP_API_KEY is correct.`);
    } else {
      console.error(`[MarketService] FMP error for ${fetchSymbol}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Fetches multiple stock quotes in batch.
 */
async function getQuotesBatch(symbols) {
  let results = {};
  const missingSymbols = [];

  // Check cache first
  symbols.forEach(s => {
    const cached = quoteCache.get(s);
    if (cached && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
      results[s] = cached;
    } else {
      missingSymbols.push(s);
    }
  });

  if (missingSymbols.length === 0) return results;
  
  const liveResults = await fetchLiveBatch(missingSymbols);
  
  // Merge and fallback to synthetic for anything still missing
  symbols.forEach(s => {
    if (liveResults[s]) {
      quoteCache.set(s, liveResults[s]);
      results[s] = liveResults[s];
    } else if (!results[s]) {
      results[s] = getSyntheticQuote(s);
    }
  });

  return results;
}

async function fetchLiveBatch(symbols) {
  let results = {};

  // 0. Try RapidAPI first for NSE stocks
  if (RAPIDAPI_KEY) {
    const { fetchBatchNSEQuotes } = require('./rapidApiService');
    const rapidResults = await fetchBatchNSEQuotes(symbols);
    results = { ...results, ...rapidResults };
  }

  // 1. Try primary provider
  const missing0 = symbols.filter(s => !results[s]);
  if (MARKET_DATA_PROVIDER === 'polygon' && POLYGON_API_KEY) {
    const { fetchBatchFromPolygon } = require('./polygonService');
    results = { ...results, ...(await fetchBatchFromPolygon(missing0)) };
  } else if (MARKET_DATA_PROVIDER === 'eodhd' && EODHD_API_KEY) {
    results = { ...results, ...(await fetchBatchFromEODHD(missing0)) };
  }

  // 2. Fallback: try other providers for missing symbols
  const missing1 = symbols.filter(s => !results[s]);
  if (missing1.length > 0 && MARKET_DATA_PROVIDER !== 'polygon' && POLYGON_API_KEY) {
    const { fetchBatchFromPolygon } = require('./polygonService');
    const polyResults = await fetchBatchFromPolygon(missing1);
    results = { ...results, ...polyResults };
  }
  const missing2 = symbols.filter(s => !results[s]);
  if (missing2.length > 0 && MARKET_DATA_PROVIDER !== 'eodhd' && EODHD_API_KEY) {
    const eodhdResults = await fetchBatchFromEODHD(missing2);
    results = { ...results, ...eodhdResults };
  }
  const missing3 = symbols.filter(s => !results[s]);
  if (missing3.length > 0 && FMP_API_KEY) {
    const fmpResults = await fetchBatchFromFMP(missing3);
    results = { ...results, ...fmpResults };
  }
  return results;
}

/**
 * Internal EODHD Batch Fetcher
 */
async function fetchBatchFromEODHD(symbols) {
  const results = {};
  const mappedSymbols = symbols.map(s => {
    const clean = s.replace('NSE:', '').toUpperCase();
    const isIndex = clean.startsWith('NSE') || clean.startsWith('^') || clean.includes('INDEX');
    const isKenyan = !!KENYAN_STOCKS[clean] || isIndex;
    
    let fetchSymbol = clean;
    if (isKenyan && !isIndex) {
      fetchSymbol = `${clean}.XNSE`;
    } else if (isIndex) {
      fetchSymbol = `${clean}.INDX`;
    } else if (!isKenyan && !isIndex && !clean.includes('.')) {
      fetchSymbol = `${clean}.US`;
    }
    return { original: s, fetch: fetchSymbol };
  });

  try {
    // Correct Bulk Pattern: Anchor with first ticker, rest in 's' param
    const anchor = mappedSymbols[0].fetch;
    const others = mappedSymbols.slice(1).map(m => m.fetch).join(',');
    
    console.log(`[MarketService] EODHD Batch Fetch: ${anchor} + [${others}]`);
    const response = await eodhd.get(`https://eodhd.com/api/real-time/${anchor}`, {
      params: { api_token: EODHD_API_KEY, fmt: 'json', s: others || undefined }
    });

    const data = response.data;
    const dataArray = Array.isArray(data) ? data : [data];

    dataArray.forEach(q => {
      if (!q || (!q.code && !q.symbol)) return;
      const receivedCode = (q.code || q.symbol).toUpperCase();
      const mapping = mappedSymbols.find(m => 
        m.fetch.toUpperCase() === receivedCode || 
        m.fetch.split('.')[0].toUpperCase() === receivedCode
      );
      
      const originalSymbol = mapping ? mapping.original : (q.code || q.symbol);
      const isKenyan = originalSymbol?.startsWith('NSE:');

      results[originalSymbol] = {
        symbol: originalSymbol,
        company_name: isKenyan ? (KENYAN_STOCKS[originalSymbol.replace('NSE:', '')] || receivedCode) : receivedCode,
        price: Number(q.close || q.price) || 0,
        currency: originalSymbol.startsWith('NSE:') ? 'KES' : 'USD',
        change: Number(q.change) || 0,
        changePercent: Number(q.change_p) || 0,
        changesPercentage: Number(q.change_p) || 0,
        volume: q.volume,
        dayHigh: q.high,
        dayLow: q.low,
        previousClose: q.previousClose || q.previous_close,
        timestamp: q.timestamp || Math.floor(Date.now() / 1000),
        lastUpdated: new Date((q.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        exchange: isKenyan ? 'NSE' : 'Global',
        provider: 'eodhd'
      };
    });
  } catch (error) {
    console.error('[MarketService] EODHD Batch Error:', error.message);
  }
  return results;
}

/**
 * Internal FMP Batch Fetcher
 */
async function fetchBatchFromFMP(symbols) {
  const results = {};
  const fmpSymbols = symbols.map(s => {
    const clean = s.replace('NSE:', '').toUpperCase();
    const isIndex = clean.startsWith('NSE') || clean.startsWith('^');
    return (isIndex || !KENYAN_STOCKS[clean]) ? clean : `${clean}.NR`;
  });

  try {
    const response = await fmp.get(`${FMP_BASE_URL}/quote`, {
      params: { symbol: fmpSymbols.join(','), apikey: FMP_API_KEY },
      timeout: 10000
    });
    // Stable API returns an array for comma-separated symbols
    const data = Array.isArray(response.data) ? response.data : [response.data].filter(Boolean);
    data.forEach(q => {
      if (!q || !q.symbol) return;
      const originalSymbol = symbols.find(s => s.includes(q.symbol.replace('.NR', '')));
      if (originalSymbol) {
        results[originalSymbol] = {
          symbol: q.symbol,
          company_name: q.name || q.symbol,
          price: Number(q.price) || 0,
          currency: originalSymbol.startsWith('NSE:') ? 'KES' : (q.currency || 'USD'),
          change: Number(q.change) || 0,
          changePercent: Number(q.changePercentage ?? q.changesPercentage) || 0,
          changesPercentage: Number(q.changePercentage ?? q.changesPercentage) || 0,
          volume: q.volume,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          previousClose: q.previousClose,
          timestamp: q.timestamp || Math.floor(Date.now() / 1000),
          lastUpdated: new Date((q.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          exchange: q.exchange,
          provider: 'fmp'
        };
      }
    });
  } catch (error) {
    console.error('[MarketService] FMP Batch Error:', error.message);
  }
  return results;
}

module.exports = { getStockQuote, getQuotesBatch, getCompanyName, getSyntheticQuote };