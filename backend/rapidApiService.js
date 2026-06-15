const axios = require('axios');

const NSE_YAHOO_SUFFIX = '.NR';

const SYMBOL_OVERRIDES = {
  KLG: 'KQ.NR',
};

function toYahooSymbol(symbol) {
  const clean = symbol.replace('NSE:', '').toUpperCase();
  return SYMBOL_OVERRIDES[clean] || `${clean}${NSE_YAHOO_SUFFIX}`;
}

function parseYahooResult(result, cleanSymbol) {
  const price = result.regularMarketPrice ?? result.regularMarketPreviousClose;
  if (price == null) return null;

  return {
    symbol: `NSE:${cleanSymbol}`,
    company_name: result.shortName || result.longName || cleanSymbol,
    price: Number(price),
    currency: 'KES',
    change: Number(result.regularMarketChange ?? 0),
    changePercent: Number(result.regularMarketChangePercent ?? 0),
    changesPercentage: Number(result.regularMarketChangePercent ?? 0),
    volume: result.regularMarketVolume ?? 0,
    dayHigh: result.regularMarketDayHigh ?? price,
    dayLow: result.regularMarketDayLow ?? price,
    previousClose: Number(result.regularMarketPreviousClose ?? price),
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    exchange: 'NSE',
    provider: 'yahoo',
  };
}

async function fetchYahooFinance2(symbol) {
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

    const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
    const yahooSymbol = toYahooSymbol(symbol);
    const q = await yf.quote(yahooSymbol);

    if (!q?.regularMarketPrice) return null;
    return parseYahooResult(q, cleanSymbol);
  } catch {
    return null;
  }
}

async function fetchRapidAPI(symbol) {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com';
  if (!key) return null;

  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const yahooSymbol = toYahooSymbol(symbol);

  // Try multiple endpoint patterns
  const endpoints = [
    { path: '/api/v1/markets/quote', params: { symbol: yahooSymbol, region: 'KE' } },
    { path: '/market/v2/get-quotes', params: { symbols: yahooSymbol, region: 'KE' } },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await axios.get(`https://${host}${ep.path}`, {
        params: ep.params,
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 6000,
      });
      const result = resp.data?.quoteResponse?.result?.[0];
      if (result?.regularMarketPrice) {
        return parseYahooResult(result, cleanSymbol);
      }
    } catch {
      // continue to next endpoint pattern
    }
  }
  return null;
}

async function fetchNSEQuote(symbol) {
  if (!symbol.startsWith('NSE:')) return null;

  let quote = await fetchYahooFinance2(symbol);
  if (quote) return quote;

  quote = await fetchRapidAPI(symbol);
  return quote;
}

async function fetchGlobalQuote(symbol) {
  if (symbol.startsWith('NSE:')) return null;

  const cleanSymbol = symbol.toUpperCase().replace(/\./g, '-');
  // Detect forex pairs (e.g. EURUSD) and append =X for Yahoo Finance
  const isForex = /^[A-Z]{6}$/.test(cleanSymbol);
  const yahooSymbol = isForex ? cleanSymbol + '=X' : cleanSymbol;
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const q = await yf.quote(yahooSymbol);
    if (!q?.regularMarketPrice) return null;
    const price = Number(q.regularMarketPrice ?? q.regularMarketPreviousClose);
    return {
      symbol: cleanSymbol,
      company_name: q.shortName || q.longName || cleanSymbol,
      price,
      currency: 'USD',
      change: Number(q.regularMarketChange ?? 0),
      changePercent: Number(q.regularMarketChangePercent ?? 0),
      volume: q.regularMarketVolume ?? 0,
      dayHigh: Number(q.regularMarketDayHigh ?? price),
      dayLow: Number(q.regularMarketDayLow ?? price),
      previousClose: Number(q.regularMarketPreviousClose ?? price),
      marketCap: q.marketCap ?? 0,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      exchange: 'Global',
      provider: 'yahoo',
    };
  } catch {
    return null;
  }
}

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const yahooSymbols = nseSymbols.map(s => toYahooSymbol(s));
    const chunks = chunkArray(yahooSymbols, 10);
    const map = {};
    // Process 5 chunks at a time to avoid overwhelming Yahoo
    for (let i = 0; i < chunks.length; i += 5) {
      const batch = chunks.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(c => yf.quote(c)));
      for (const result of results) {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
        for (const q of result.value) {
          if (!q?.regularMarketPrice) continue;
          const rawSymbol = (q.symbol || '').toUpperCase();
          const cleanSymbol = rawSymbol.replace('.NR', '');
          const key = `NSE:${cleanSymbol}`;
          const price = Number(q.regularMarketPrice ?? q.regularMarketPreviousClose);
          map[key] = { symbol: key, company_name: q.shortName || q.longName || cleanSymbol, price, currency: 'KES', change: Number(q.regularMarketChange ?? 0), changePercent: Number(q.regularMarketChangePercent ?? 0), volume: q.regularMarketVolume ?? 0, dayHigh: Number(q.regularMarketDayHigh ?? price), dayLow: Number(q.regularMarketDayLow ?? price), previousClose: Number(q.regularMarketPreviousClose ?? price), timestamp: Math.floor(Date.now() / 1000), lastUpdated: new Date().toISOString(), exchange: 'NSE', provider: 'yahoo' };
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function parseYahooGlobalResult(q) {
  if (!q?.regularMarketPrice) return null;
  const symbol = (q.symbol || '').toUpperCase();
  if (!symbol) return null;
  const price = Number(q.regularMarketPrice ?? q.regularMarketPreviousClose);
  return { symbol, company_name: q.shortName || q.longName || symbol, price, currency: 'USD', change: Number(q.regularMarketChange ?? 0), changePercent: Number(q.regularMarketChangePercent ?? 0), volume: q.regularMarketVolume ?? 0, dayHigh: Number(q.regularMarketDayHigh ?? price), dayLow: Number(q.regularMarketDayLow ?? price), previousClose: Number(q.regularMarketPreviousClose ?? price), marketCap: q.marketCap ?? 0, timestamp: Math.floor(Date.now() / 1000), lastUpdated: new Date().toISOString(), exchange: 'Global', provider: 'yahoo' };
}

async function fetchBatchGlobalQuotes(symbols) {
  const globalSymbols = symbols.filter(s => !s.startsWith('NSE:'));
  if (!globalSymbols.length) return {};

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const cleanSymbols = globalSymbols.map(s => s.toUpperCase().replace(/\./g, '-'));
    const chunks = chunkArray(cleanSymbols, 10);
    const map = {};
    // Process 5 chunks at a time to avoid overwhelming Yahoo
    for (let i = 0; i < chunks.length; i += 5) {
      const batch = chunks.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(c => yf.quote(c)));
      for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          for (const q of result.value) {
            const parsed = parseYahooGlobalResult(q);
            if (parsed) map[parsed.symbol] = parsed;
          }
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes, fetchGlobalQuote, fetchBatchGlobalQuotes };
