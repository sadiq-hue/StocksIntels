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
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host) return null;

  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const yahooSymbol = toYahooSymbol(symbol); // e.g. SCOM.NR

  // Try multiple symbol formats and endpoint patterns
  const symbolVariants = [yahooSymbol, cleanSymbol];
  const endpoints = [
    { path: '/api/v1/markets/quote', params: (sym) => ({ symbol: sym, region: 'KE' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'KE' }) },
    { path: '/api/v1/markets/quote', params: (sym) => ({ symbol: sym, region: 'US' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'US' }) },
  ];

  for (const sym of symbolVariants) {
    for (const ep of endpoints) {
      const url = `https://${host}${ep.path}`;
      try {
        console.log(`[rapidApiService] RapidAPI NSE request: ${url} symbol=${sym}`);
        const resp = await axios.get(url, {
          params: ep.params(sym),
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
          timeout: 6000,
        });
        const result = resp.data?.quoteResponse?.result?.[0];
        if (result?.regularMarketPrice) {
          console.log(`[rapidApiService] RapidAPI NSE success for ${cleanSymbol} via ${ep.path}:`, result.regularMarketPrice);
          return parseYahooResult(result, cleanSymbol);
        }
      } catch (err) {
        console.error(`[rapidApiService] RapidAPI NSE ${ep.path} failed for ${sym}:`, err.message);
      }
    }
  }
  return null;
}

async function fetchNSEQuote(symbol) {
  if (!symbol.startsWith('NSE:')) return null;

  // RapidAPI first — it works on Railway; yahoo-finance2 direct is unreliable from cloud IPs
  console.log(`[rapidApiService] fetchNSEQuote for ${symbol}; key set: ${!!process.env.RAPIDAPI_KEY}`);
  let quote = await fetchRapidAPI(symbol);
  if (quote) {
    console.log(`[rapidApiService] fetchNSEQuote got RapidAPI quote for ${symbol}:`, quote.price);
    return quote;
  }

  quote = await fetchYahooFinance2(symbol);
  if (quote) return quote;

  return null;
}

async function fetchRapidAPIGlobal(symbol) {
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  // Remove accidental scheme prefix
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host) return null;

  const cleanSymbol = symbol.toUpperCase().replace(/\./g, '-');
  const endpoints = [
    { path: '/api/v1/markets/quote', params: { symbol: cleanSymbol, region: 'US' } },
    { path: '/market/v2/get-quotes', params: { symbols: cleanSymbol, region: 'US' } },
  ];

  for (const ep of endpoints) {
    const url = `https://${host}${ep.path}`;
    try {
      console.log(`[rapidApiService] RapidAPI request: ${url} for ${cleanSymbol}`);
      const resp = await axios.get(url, {
        params: ep.params,
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 6000,
      });
      const result = resp.data?.quoteResponse?.result?.[0];
      if (result?.regularMarketPrice) {
        const parsed = parseYahooGlobalResult(result);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.error(`[rapidApiService] RapidAPI endpoint ${ep.path} failed for ${cleanSymbol}:`, err.message);
    }
  }
  return null;
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
  } catch (err) {
    console.error(`[rapidApiService] yahoo-finance2 failed for ${symbol}:`, err.message);
  }

  // Fallback: RapidAPI Yahoo Finance proxy
  console.log(`[rapidApiService] Trying RapidAPI fallback for ${symbol}; key set: ${!!process.env.RAPIDAPI_KEY}`);
  return fetchRapidAPIGlobal(symbol);
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

  const map = {};

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const cleanSymbols = globalSymbols.map(s => s.toUpperCase().replace(/\./g, '-'));
    const chunks = chunkArray(cleanSymbols, 10);
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
  } catch {}

  // Fallback: RapidAPI for any symbols still missing
  const missing = globalSymbols.filter(s => !map[s.toUpperCase().replace(/\./g, '-')]);
  if (missing.length > 0 && process.env.RAPIDAPI_KEY) {
    const rapidResults = await Promise.allSettled(missing.map(s => fetchRapidAPIGlobal(s)));
    for (const result of rapidResults) {
      if (result.status === 'fulfilled' && result.value) {
        map[result.value.symbol] = result.value;
      }
    }
  }

  return map;
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes, fetchGlobalQuote, fetchBatchGlobalQuotes };
