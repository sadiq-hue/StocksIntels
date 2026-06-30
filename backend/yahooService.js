const axios = require('axios');
const Bottleneck = require('bottleneck');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const YAHOO_HOSTS = ['query1', 'query2', 'query3', 'query4', 'query5'];
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
  'https://api.allorigins.win/get?url=',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const CACHE_TTL = {
  quote: 5 * 60 * 1000,
  historical: 60 * 60 * 1000,
};

const quoteCache = new Map();
const histCache = new Map();

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;
  if (hit) map.delete(key);
  return null;
}

function cacheSet(map, key, data) {
  map.set(key, { data, ts: Date.now() });
  return data;
}

class CircuitBreaker {
  constructor(name, threshold = 5, cooldownMs = 120000) {
    this.name = name;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openUntil = 0;
  }

  isOpen() {
    if (this.openUntil === 0) return false;
    if (Date.now() >= this.openUntil) { this.reset(); return false; }
    return true;
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }

  recordSuccess() { if (this.failures > 0) this.reset(); }

  reset() { this.failures = 0; this.openUntil = 0; }
}

const breakers = {
  v8: new CircuitBreaker('v8', 5, 120000),
  yf2: new CircuitBreaker('yf2', 3, 300000),
  rapidapi: new CircuitBreaker('rapidapi', 5, 120000),
  proxy: new CircuitBreaker('proxy', 5, 120000),
  cors: new CircuitBreaker('cors', 3, 300000),
  google: new CircuitBreaker('google', 3, 300000),
};

const limiters = {
  v8: new Bottleneck({ maxConcurrent: 5, minTime: 150 }),
  yf2: new Bottleneck({ maxConcurrent: 3, minTime: 500 }),
  rapidapi: new Bottleneck({ maxConcurrent: 1, minTime: 600 }),
  proxy: new Bottleneck({ maxConcurrent: 3, minTime: 1000 }),
  cors: new Bottleneck({ maxConcurrent: 2, minTime: 2000 }),
};

function pickHost() {
  return YAHOO_HOSTS[Math.floor(Math.random() * YAHOO_HOSTS.length)];
}

function toYahooSymbol(symbol) {
  const clean = symbol.replace('NSE:', '').toUpperCase();
  const overrides = { KLG: 'KQ.NR' };
  if (symbol.startsWith('NSE:')) return overrides[clean] || `${clean}.NR`;
  if (/^[A-Z]{6}$/.test(clean)) return clean + '=X';
  return clean;
}

function formatQuote(meta, symbol, provider) {
  const price = Number(meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose ?? 0);
  const prevClose = Number(meta.previousClose ?? meta.chartPreviousClose ?? price);
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  return {
    symbol: symbol || meta.symbol || '',
    company_name: meta.shortName || meta.longName || symbol || '',
    price,
    currency: meta.currency || (symbol?.startsWith?.('NSE:') ? 'KES' : 'USD'),
    change,
    changePercent,
    changesPercentage: changePercent,
    volume: meta.regularMarketVolume ?? 0,
    dayHigh: Number(meta.regularMarketDayHigh ?? price),
    dayLow: Number(meta.regularMarketDayLow ?? price),
    previousClose: prevClose,
    open: Number(meta.regularMarketOpen ?? prevClose),
    marketCap: meta.marketCap ?? 0,
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    exchange: meta.exchangeName || (symbol?.startsWith?.('NSE:') ? 'NSE' : 'Global'),
    provider,
  };
}

async function fetchV8Quote(symbol) {
  if (symbol.endsWith('.NR')) return null;
  if (breakers.v8.isOpen()) return null;
  const host = pickHost();
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    const resp = await limiters.v8.schedule(() =>
      axios.get(url, { headers: { 'User-Agent': UA }, timeout: 8000 })
    );
    const meta = resp?.data?.chart?.result?.[0]?.meta;
    if (!meta || (!meta.regularMarketPrice && !meta.previousClose && !meta.chartPreviousClose)) {
      breakers.v8.recordFailure();
      return null;
    }
    breakers.v8.recordSuccess();
    return formatQuote(meta, symbol, 'yahoo-v8');
  } catch (err) {
    if (err?.response?.status !== 404) breakers.v8.recordFailure();
    return null;
  }
}

async function fetchYf2Quote(symbol) {
  if (breakers.yf2.isOpen()) return null;
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const q = await limiters.yf2.schedule(() =>
      Promise.race([
        yf.quote(symbol).catch(() => null),
        new Promise(r => setTimeout(r, 8000)),
      ])
    );
    if (!q?.regularMarketPrice && !q?.regularMarketPreviousClose) {
      breakers.yf2.recordFailure();
      return null;
    }
    breakers.yf2.recordSuccess();
    return formatQuote(q, symbol, 'yahoo-yf2');
  } catch {
    breakers.yf2.recordFailure();
    return null;
  }
}

async function fetchRapidapiQuote(symbol) {
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host) return null;
  if (breakers.rapidapi.isOpen()) return null;

  const symbolVariants = [symbol, symbol.replace('.NR', '').replace('=X', '')];
  const endpoints = [
    { path: '/api/v1/markets/quote', params: (sym) => ({ symbol: sym, region: 'US' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'US' }) },
    { path: '/stock/v2/get-summary', params: (sym) => ({ symbol: sym, region: 'US' }) },
    { path: '/api/v1/markets/quote', params: (sym) => ({ symbol: sym, region: 'KE' }) },
    { path: '/market/v2/get-quotes', params: (sym) => ({ symbols: sym, region: 'KE' }) },
  ];

  for (const sym of symbolVariants) {
    for (const ep of endpoints) {
      try {
        const resp = await limiters.rapidapi.schedule(() =>
          axios.get(`https://${host}${ep.path}`, {
            params: ep.params(sym),
            headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
            timeout: 8000,
          })
        );
        const result = resp.data?.quoteResponse?.result?.[0] || resp.data?.price || resp.data;
        if (result?.regularMarketPrice) {
          breakers.rapidapi.recordSuccess();
          return formatQuote(result, symbol, 'yahoo-rapidapi');
        }
      } catch (err) {
        if (err?.response?.status === 429) { breakers.rapidapi.recordFailure(); return null; }
      }
    }
  }
  breakers.rapidapi.recordFailure();
  return null;
}

async function fetchGoogleFinanceQuote(symbol) {
  if (breakers.google.isOpen()) return null;
  const cheerio = require('cheerio');
  const clean = symbol.replace('.NR', '').replace('=X', '');
  try {
    const resp = await axios.get(`https://www.google.com/finance/quote/${clean}`, {
      headers: { 'User-Agent': UA },
      timeout: 5000,
    });
    const $ = cheerio.load(resp.data);
    const priceEl = $('div[data-last-price]').first();
    if (priceEl.length) {
      const price = parseFloat(priceEl.attr('data-last-price'));
      if (price && !isNaN(price)) return { price };
    }
    const scriptText = $('script').text();
    const m = scriptText.match(/"price":(\d+(?:\.\d+)?)/);
    if (m) {
      const price = parseFloat(m[1]);
      if (price && !isNaN(price)) return { price };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchV8Historical(symbol, range, interval) {
  if (symbol.endsWith('.NR')) return null;
  const host = pickHost();
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  try {
    const resp = await limiters.v8.schedule(() =>
      axios.get(url, { headers: { 'User-Agent': UA }, timeout: 10000 })
    );
    return parseChartBars(resp?.data);
  } catch {
    return null;
  }
}

async function fetchRapidapiHistorical(symbol, range, interval) {
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (!key || !host) return null;

  const rangeMap = { '1d': '1d', '5d': '5d', '1mo': '1mo', '3mo': '3mo', '6mo': '6mo', '1y': '1y', '2y': '2y', '5y': '5y', 'max': 'max' };
  const intervalMap = { '1m': '1m', '2m': '2m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '60m', '1d': '1d', '1wk': '1wk', '1mo': '1mo' };
  const endpoints = [
    { path: '/api/v1/markets/stocks/historical-prices', params: { symbol: symbol.toUpperCase(), range: rangeMap[range] || '6mo', interval: intervalMap[interval] || '1d', region: 'US' } },
    { path: '/stock/v3/get-chart', params: { symbol: symbol.toUpperCase(), range: rangeMap[range] || '6mo', interval: intervalMap[interval] || '1d', region: 'US' } },
  ];

  for (const ep of endpoints) {
    try {
      const resp = await limiters.rapidapi.schedule(() =>
        axios.get(`https://${host}${ep.path}`, {
          params: ep.params,
          headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
          timeout: 10000,
        })
      );
      const bars = parseChartBars(resp.data);
      if (bars?.length > 0) return bars;
    } catch (err) {
      if (err?.response?.status === 429) return null;
    }
  }
  return null;
}

function parseChartBars(data) {
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = timestamps.map((t, i) => ({
    date: new Date(t * 1000).toISOString().split('T')[0],
    timestamp: t,
    open: quote.open?.[i] ?? null,
    high: quote.high?.[i] ?? null,
    low: quote.low?.[i] ?? null,
    close: quote.close?.[i] ?? null,
    volume: quote.volume?.[i] ?? 0,
    adjclose: adjclose[i] ?? quote.close?.[i] ?? null,
  })).filter(d => d.close != null);
  return bars.length > 0 ? bars : null;
}

async function fetchViaCorsProxy(url) {
  if (breakers.cors.isOpen()) return null;
  for (const proxy of CORS_PROXIES) {
    try {
      const resp = await limiters.cors.schedule(() =>
        axios.get(proxy + encodeURIComponent(url), {
          timeout: 8000,
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        })
      );
      breakers.cors.recordSuccess();
      return resp.data;
    } catch {}
  }
  breakers.cors.recordFailure();
  return null;
}

async function fetchViaProxyPool(url, params) {
  if (breakers.proxy.isOpen()) return null;
  // Lazy-require proxyService to avoid circular dependency
  const proxyService = require('./proxyService');
  for (let attempt = 0; attempt < 3; attempt++) {
    const proxy = proxyService.getRandomProxy();
    if (!proxy) break;
    const agent = proxy.type === 'socks' || proxy.type === 'socks5'
      ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`)
      : new HttpsProxyAgent(`http://${proxy.host}:${proxy.port}`);
    try {
      const resp = await limiters.proxy.schedule(() =>
        axios.get(url, {
          params,
          httpsAgent: agent,
          timeout: 8000,
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        })
      );
      breakers.proxy.recordSuccess();
      return resp.data;
    } catch {}
  }
  breakers.proxy.recordFailure();
  return null;
}

async function fetchQuote(symbol) {
  if (!symbol) return null;
  const cacheKey = symbol.toUpperCase();
  const cached = cacheGet(quoteCache, cacheKey, CACHE_TTL.quote);
  if (cached) return cached;

  const yahooSymbol = toYahooSymbol(symbol);
  let quote = await fetchV8Quote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote);

  quote = await fetchYf2Quote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote);

  quote = await fetchRapidapiQuote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote);

  if (symbol.startsWith('NSE:')) return null;

  const google = await fetchGoogleFinanceQuote(yahooSymbol);
  if (google?.price) {
    return cacheSet(quoteCache, cacheKey, {
      symbol: symbol.toUpperCase(),
      company_name: symbol.toUpperCase(),
      price: google.price,
      currency: 'USD',
      change: 0,
      changePercent: 0,
      changesPercentage: 0,
      volume: 0,
      dayHigh: google.price,
      dayLow: google.price,
      previousClose: google.price,
      marketCap: 0,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      exchange: 'Global',
      provider: 'google',
    });
  }

  return null;
}

async function fetchQuotes(symbols) {
  const results = {};
  const entries = await Promise.allSettled(symbols.map(s => fetchQuote(s)));
  entries.forEach((entry, i) => {
    if (entry.status === 'fulfilled' && entry.value) {
      const sym = symbols[i].toUpperCase();
      results[sym] = entry.value;
      results[sym].symbol = sym;
    }
  });
  return results;
}

async function fetchHistorical(symbol, range = '6mo', interval = '1d') {
  const cacheKey = `${symbol}|${range}|${interval}`;
  const cached = cacheGet(histCache, cacheKey, CACHE_TTL.historical);
  if (cached) return cached;

  const yahooSymbol = toYahooSymbol(symbol);
  let bars = await fetchV8Historical(yahooSymbol, range, interval);
  if (bars) return cacheSet(histCache, cacheKey, bars);

  bars = await fetchRapidapiHistorical(yahooSymbol, range, interval);
  if (bars) return cacheSet(histCache, cacheKey, bars);

  return null;
}

async function fetchQuoteSummary(symbol, modules) {
  const yahooSymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}`;
  const params = { modules: modules.join(',') };

  // Try proxy pool first (v10 often blocked from cloud IPs)
  const proxyData = await fetchViaProxyPool(url, params);
  if (proxyData?.quoteSummary?.result?.[0]?.financialData?.marketCap) {
    return normalizeYahooResponse(proxyData.quoteSummary.result[0]);
  }

  // Try CORS relay
  const corsData = await fetchViaCorsProxy(url + '?' + new URLSearchParams(params).toString());
  if (corsData?.quoteSummary?.result?.[0]?.financialData?.marketCap) {
    return normalizeYahooResponse(corsData.quoteSummary.result[0]);
  }

  // Try yahoo-finance2 as last resort
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const qs = await yf.quoteSummary(yahooSymbol, { modules });
    if (qs?.financialData?.marketCap) {
      return normalizeYahooResponse(qs);
    }
  } catch {}

  // Try RapidAPI
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (key && host) {
    try {
      const resp = await axios.get(`https://${host}/api/v1/markets/stock/modules`, {
        params: { symbol: yahooSymbol, module: modules.join(',') },
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 10000,
      });
      if (resp.data?.financialData?.marketCap) return resp.data;
    } catch {}
  }

  return null;
}

function normalizeYahooResponse(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.raw !== undefined) return data.raw;
  const result = Array.isArray(data) ? [] : {};
  for (const [key, val] of Object.entries(data)) {
    result[key] = normalizeYahooResponse(val);
  }
  return result;
}

async function fetchPriceViaProxy(symbol) {
  const yahooSymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  const params = { interval: '1d', range: '1d', includePreMarket: 'true' };

  // Try proxy pool
  const proxyData = await fetchViaProxyPool(url, params);
  if (proxyData) {
    const result = parsePriceProxyResult(proxyData, symbol);
    if (result) return result;
  }

  // Try CORS relay
  const corsData = await fetchViaCorsProxy(url + '?' + new URLSearchParams(params).toString());
  if (corsData) {
    const result = parsePriceProxyResult(corsData, symbol);
    if (result) return result;
  }

  // Try direct (may work from some regions)
  try {
    const resp = await axios.get(url, {
      params,
      timeout: 5000,
      headers: { 'User-Agent': UA },
    });
    const result = parsePriceProxyResult(resp.data, symbol);
    if (result) return result;
  } catch {}

  return null;
}

function parsePriceProxyResult(data, symbol) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta?.regularMarketPrice) return null;
  return {
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose || meta.regularMarketPrice,
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName || '',
    marketCap: meta.marketCap || 0,
    symbol: symbol.toUpperCase(),
    companyName: meta.shortName || meta.longName || '',
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketPreviousClose: meta.chartPreviousClose || meta.regularMarketPrice,
    preMarketPrice: meta.preMarketPrice ?? null,
    preMarketChange: meta.preMarketChange ?? null,
    preMarketChangePercent: meta.preMarketChangePercent ?? null,
    preMarketTime: meta.preMarketTime ?? null,
    postMarketPrice: meta.postMarketPrice ?? null,
    postMarketChange: meta.postMarketChange ?? null,
    postMarketChangePercent: meta.postMarketChangePercent ?? null,
    postMarketTime: meta.postMarketTime ?? null,
    currentTradingPeriod: result?.meta?.currentTradingPeriod || null,
    marketState: meta.marketState || 'REGULAR',
  };
}

async function fetchPreMarketBatch(symbols) {
  if (!symbols || symbols.length === 0) return {};
  const results = {};
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    const promises = batch.map(async (sym) => {
      try {
        const data = await fetchPriceViaProxy(sym);
        if (data) results[sym.toUpperCase()] = data;
      } catch {}
    });
    await Promise.all(promises);
    if (symbols.length > 10) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

function clearCache() {
  quoteCache.clear();
  histCache.clear();
}

module.exports = {
  fetchQuote,
  fetchQuotes,
  fetchHistorical,
  fetchQuoteSummary,
  fetchPriceViaProxy,
  fetchPreMarketBatch,
  clearCache,
};
