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

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};

  const results = {};
  for (const s of nseSymbols) {
    const quote = await fetchNSEQuote(s);
    if (quote) results[s] = quote;
  }
  return results;
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes };
