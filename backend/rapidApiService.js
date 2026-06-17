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
    { path: '/api/v1/markets/stocks/quotes', params: (sym) => ({ ticker: sym, region: 'KE' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'KE' }) },
    { path: '/api/v1/markets/quote', params: (sym) => ({ symbol: sym, region: 'US' }) },
    { path: '/api/v1/markets/stocks/quotes', params: (sym) => ({ ticker: sym, region: 'US' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'US' }) },
    { path: '/stock/v2/get-summary', params: (sym) => ({ symbol: sym, region: 'US' }) },
  ];

  let lastError = null;
  for (const sym of symbolVariants) {
    for (const ep of endpoints) {
      try {
        const resp = await axios.get(`https://${host}${ep.path}`, {
          params: ep.params(sym),
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
          timeout: 6000,
        });
        const result = resp.data?.quoteResponse?.result?.[0] || resp.data?.price;
        if (result?.regularMarketPrice) {
          return parseYahooResult(result, cleanSymbol);
        }
      } catch (err) {
        lastError = err.response?.status || err.message;
      }
    }
  }
  if (lastError) console.log(`[rapidApiService] RapidAPI NSE lookup failed for ${cleanSymbol}: ${lastError}`);
  return null;
}

async function fetchNSEQuote(symbol) {
  if (!symbol.startsWith('NSE:')) return null;

  let quote = await fetchRapidAPI(symbol);
  if (quote) return quote;

  quote = await fetchYahooFinance2(symbol);
  if (quote) return quote;

  return null;
}

async function fetchRapidAPIGlobal(symbol) {
  const results = await fetchRapidAPIGlobalBatch([symbol]);
  return results[symbol.toUpperCase().replace(/\./g, '-')] || null;
}

async function fetchRapidAPIGlobalBatch(symbols) {
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host || !symbols.length) return {};

  const cleanSymbols = symbols.map(s => s.toUpperCase().replace(/\./g, '-'));
  const chunks = chunkArray(cleanSymbols, 10);
  const map = {};
  let rateLimited = false;

  for (const chunk of chunks) {
    if (rateLimited) break;
    const symbolsParam = chunk.join(',');
    try {
      const resp = await axios.get(`https://${host}/market/v2/get-quotes`, {
        params: { symbols: symbolsParam, region: 'US' },
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 8000,
      });
      const results = resp.data?.quoteResponse?.result || [];
      for (const q of results) {
        const parsed = parseYahooGlobalResult(q);
        if (parsed) map[parsed.symbol] = parsed;
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        rateLimited = true;
        console.warn(`[rapidApiService] RapidAPI rate limited (429) on batch, stopping further RapidAPI calls`);
      } else {
        console.error(`[rapidApiService] RapidAPI batch failed for ${symbolsParam}:`, status || err.message);
      }
    }
  }
  return map;
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
    const q = await Promise.race([
      yf.quote(yahooSymbol).catch(() => {}),
      new Promise(r => setTimeout(r, 5000)),
    ]);
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
    // yahoo-finance2 is expected to fail from cloud IPs; RapidAPI is the fallback
  }

  // Fallback: RapidAPI Yahoo Finance proxy
  const rapidQuote = await fetchRapidAPIGlobal(symbol);
  if (rapidQuote) return rapidQuote;

  // Final fallback: Twelve Data
  try {
    const { fetchQuoteWithStats } = require('./twelveDataService');
    const tq = await fetchQuoteWithStats(symbol);
    if (tq) {
      return {
        symbol: cleanSymbol,
        company_name: tq.company_name || cleanSymbol,
        price: tq.price,
        currency: tq.currency || 'USD',
        change: tq.change || 0,
        changePercent: tq.changePercent || 0,
        volume: tq.volume || 0,
        dayHigh: tq.dayHigh || tq.price,
        dayLow: tq.dayLow || tq.price,
        previousClose: tq.previousClose || tq.price,
        marketCap: tq.marketCap || 0,
        peRatio: tq.peRatio || 0,
        eps: tq.eps || 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastUpdated: new Date().toISOString(),
        exchange: tq.exchange || 'Global',
        provider: 'twelvedata',
      };
    }
  } catch {}
  return null;
}

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};

  const map = {};

  // Try RapidAPI first (works from cloud IPs)
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (key && host) {
    const yahooSymbols = nseSymbols.map(s => toYahooSymbol(s));
    const chunks = chunkArray(yahooSymbols, 10);
    for (const chunk of chunks) {
      try {
        const resp = await axios.get(`https://${host}/market/v2/get-quotes`, {
          params: { symbols: chunk.join(','), region: 'KE' },
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
          timeout: 8000,
        });
        const results = resp.data?.quoteResponse?.result || [];
        for (const q of results) {
          if (!q?.regularMarketPrice) continue;
          const rawSymbol = (q.symbol || '').toUpperCase();
          const cleanSymbol = rawSymbol.replace('.NR', '');
          const keySym = `NSE:${cleanSymbol}`;
          map[keySym] = { symbol: keySym, company_name: q.shortName || q.longName || cleanSymbol, price: Number(q.regularMarketPrice), currency: 'KES', change: Number(q.regularMarketChange ?? 0), changePercent: Number(q.regularMarketChangePercent ?? 0), volume: q.regularMarketVolume ?? 0, dayHigh: Number(q.regularMarketDayHigh ?? q.regularMarketPrice), dayLow: Number(q.regularMarketDayLow ?? q.regularMarketPrice), previousClose: Number(q.regularMarketPreviousClose ?? q.regularMarketPrice), timestamp: Math.floor(Date.now() / 1000), lastUpdated: new Date().toISOString(), exchange: 'NSE', provider: 'yahoo' };
        }
        if (Object.keys(map).length > 0) return map;
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn(`[rapidApiService] RapidAPI rate limited on NSE batch`);
          break;
        }
      }
    }
  }

  // Try yahoo-finance2 with a timeout (often fails from cloud IPs)
  try {
    await Promise.race([
      (async () => {
        const { default: YahooFinance } = await import('yahoo-finance2');
        const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
        const yahooSymbols = nseSymbols.filter(s => !map[s]).map(s => toYahooSymbol(s));
        const chunks = chunkArray(yahooSymbols, 10);
        for (let i = 0; i < chunks.length; i += 5) {
          const batch = chunks.slice(i, i + 5);
          const results = await Promise.allSettled(batch.map(c => yf.quote(c).catch(() => {})));
          for (const result of results) {
            if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
            for (const q of result.value) {
              if (!q?.regularMarketPrice) continue;
              const rawSymbol = (q.symbol || '').toUpperCase();
              const cleanSymbol = rawSymbol.replace('.NR', '');
              const keySym = `NSE:${cleanSymbol}`;
              if (map[keySym]) continue;
              map[keySym] = { symbol: keySym, company_name: q.shortName || q.longName || cleanSymbol, price: Number(q.regularMarketPrice), currency: 'KES', change: Number(q.regularMarketChange ?? 0), changePercent: Number(q.regularMarketChangePercent ?? 0), volume: q.regularMarketVolume ?? 0, dayHigh: Number(q.regularMarketDayHigh ?? q.regularMarketPrice), dayLow: Number(q.regularMarketDayLow ?? q.regularMarketPrice), previousClose: Number(q.regularMarketPreviousClose ?? q.regularMarketPrice), timestamp: Math.floor(Date.now() / 1000), lastUpdated: new Date().toISOString(), exchange: 'NSE', provider: 'yahoo' };
            }
          }
        }
      })(),
      new Promise(r => setTimeout(r, 5000)),
    ]);
  } catch {}

  return map;
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

  // yahoo-finance2 batch is skipped here because it hangs from cloud IPs.
  // Single-quote path (fetchGlobalQuote) still tries yahoo-finance2 first.

  // Fallback: RapidAPI for any symbols still missing (batched to avoid rate limits)
  const missing = globalSymbols.filter(s => !map[s.toUpperCase().replace(/\./g, '-')]);
  if (missing.length > 0 && process.env.RAPIDAPI_KEY) {
    const rapidMap = await fetchRapidAPIGlobalBatch(missing);
    Object.assign(map, rapidMap);
  }

  // Final fallback: Twelve Data for any still-missing symbols
  const stillMissing = globalSymbols.filter(s => !map[s.toUpperCase().replace(/\./g, '-')]);
  if (stillMissing.length > 0 && process.env.TWELVE_DATA_API_KEY) {
    try {
      const { fetchBatchQuotes } = require('./twelveDataService');
      const tdMap = await fetchBatchQuotes(stillMissing);
      for (const [sym, q] of Object.entries(tdMap)) {
        const key = sym.toUpperCase().replace(/\./g, '-');
        if (!map[key]) {
          map[key] = {
            symbol: key,
            company_name: q.company_name || key,
            price: q.price,
            currency: q.currency || 'USD',
            change: q.change || 0,
            changePercent: q.changePercent || 0,
            volume: q.volume || 0,
            dayHigh: q.dayHigh || q.price,
            dayLow: q.dayLow || q.price,
            previousClose: q.previousClose || q.price,
            marketCap: q.marketCap || 0,
            timestamp: Math.floor(Date.now() / 1000),
            lastUpdated: new Date().toISOString(),
            exchange: 'Global',
            provider: 'twelvedata',
          };
        }
      }
    } catch {}
  }

  return map;
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes, fetchGlobalQuote, fetchBatchGlobalQuotes };
