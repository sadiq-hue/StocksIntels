const Bottleneck = require('bottleneck');
const proxyService = require('./proxyService');

const YAHOO_HOSTS = ['query1', 'query2', 'query3', 'query4', 'query5'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const CACHE_TTL = {
  quote: 5 * 60 * 1000,
  historical: 60 * 60 * 1000,
};

const useRedis = process.env.REDIS_URL && process.env.REDIS_CACHE_ENABLED === 'true';
let redisClient = null;
let redisSet, redisGet;

if (useRedis) {
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', () => {});
    redisClient.connect().catch(() => {});
    redisSet = async (key, data, ttl) => {
      try { await redisClient.set(key, JSON.stringify(data), { EX: Math.ceil(ttl / 1000) }); } catch {}
    };
    redisGet = async (key) => {
      try {
        const val = await redisClient.get(key);
        return val ? JSON.parse(val) : null;
      } catch { return null; }
    };
  } catch { /* redis unavailable, fall back to in-memory */ }
}

const quoteCache = new Map();
const histCache = new Map();

async function cacheGet(map, key, ttl, redisKey) {
  if (redisKey && redisGet) {
    const val = await redisGet(redisKey);
    if (val) return val;
  }
  const hit = map.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data;
  if (hit) map.delete(key);
  return null;
}

function cacheSet(map, key, data, ttl, redisKey) {
  map.set(key, { data, ts: Date.now() });
  if (redisKey && redisSet) {
    redisSet(redisKey, data, ttl).catch(() => {});
  }
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
  google: new CircuitBreaker('google', 3, 300000),
};

const limiters = {
  v8: new Bottleneck({ maxConcurrent: 5, minTime: 150 }),
  yf2: new Bottleneck({ maxConcurrent: 3, minTime: 500 }),
  rapidapi: new Bottleneck({ maxConcurrent: 1, minTime: 600 }),
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
    const { data } = await limiters.v8.schedule(() =>
      proxyService.fetchWithProxyFallback(url)
    );
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || (!meta.regularMarketPrice && !meta.previousClose && !meta.chartPreviousClose)) {
      breakers.v8.recordFailure();
      return null;
    }
    breakers.v8.recordSuccess();
    return formatQuote(meta, symbol, 'yahoo-v8');
  } catch {
    breakers.v8.recordFailure();
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
          require('axios').get(`https://${host}${ep.path}`, {
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
  const clean = symbol.replace('.NR', '').replace('=X', '').split(':')[0];

  // Common US exchange mapping for Google Finance URLs
  const exchMap = {
    'SPY':'NYSEARCA','VOO':'NYSEARCA','QQQ':'NASDAQ','VTI':'NYSEARCA',
    'BND':'NASDAQ','AGG':'NYSEARCA','VXUS':'NASDAQ','GLD':'NYSEARCA',
    'SLV':'NYSEARCA','TLT':'NASDAQ','IWM':'NYSEARCA','DIA':'NYSEARCA',
    'XLF':'NYSEARCA','XLK':'NYSEARCA','ARKK':'NYSEARCA',
    'EEM':'NYSEARCA','IEMG':'NASDAQ','VWO':'NYSEARCA','VEU':'NYSEARCA',
    'EZA':'NYSEARCA','AFK':'NYSEARCA','IJR':'NYSEARCA','TIP':'NYSEARCA',
    'VNQ':'NYSEARCA','VUG':'NASDAQ','VTV':'NYSEARCA','IVV':'NYSEARCA',
    'SHY':'NASDAQ','JPM':'NYSE','DIS':'NYSE','BAC':'NYSE','WMT':'NYSE',
    'JNJ':'NYSE','PG':'NYSE','KO':'NYSE','PEP':'NASDAQ','BRK.B':'NYSE',
    'XOM':'NYSE','CVX':'NYSE','WFC':'NYSE','C':'NYSE','GS':'NYSE',
    'MS':'NYSE','V':'NYSE','MA':'NYSE','UNH':'NYSE','HD':'NYSE',
    'MCD':'NYSE','NKE':'NYSE','INTC':'NASDAQ','CSCO':'NASDAQ',
    'CMCSA':'NASDAQ','ADBE':'NASDAQ','CRM':'NYSE','ORCL':'NYSE',
    'AMD':'NASDAQ','NFLX':'NASDAQ','AMGN':'NASDAQ','GILD':'NASDAQ',
    'QCOM':'NASDAQ','TXN':'NASDAQ','MDLZ':'NASDAQ','ISRG':'NASDAQ',
    'KR':'NYSE','BBY':'NYSE','TGT':'NYSE','COST':'NASDAQ',
  };
  const exchange = exchMap[clean] || 'NASDAQ';

  for (const url of [
    `https://www.google.com/finance/quote/${clean}:${exchange}`,
    `https://www.google.com/finance/quote/${clean}`,
  ]) {
    try {
      const resp = await require('axios').get(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 8000, maxRedirects: 5,
      });
      const ds2 = extractDataArray(resp.data, 'ds:2');
      if (!ds2) continue;
      const inner = ds2[0]?.[0]?.[0];
      if (!inner) continue;
      const priceArr = inner[5];
      if (!priceArr || priceArr[0] == null) continue;
      const result = { price: priceArr[0], change: priceArr[1] || 0, changePercent: priceArr[2] || 0, currency: inner[4] || 'USD', companyName: inner[2] || '' };
      const ds8 = extractDataArray(resp.data, 'ds:8');
      if (ds8) {
        const row = ds8[0]?.[0];
        if (row && row.length >= 7) { result.previousClose = row[2]; result.dayLow = row[4]; result.dayHigh = row[5]; }
      }
      try {
        const html = typeof resp.data === 'string' ? resp.data : '';
        const mcMatch = html.match(/Mkt\.?\s*cap[\s\S]{0,60}?([\d,.]+)\s*([KMBT])/i) || html.match(/Market\s*cap[\s\S]{0,60}?([\d,.]+)\s*([KMBT])/i);
        if (mcMatch) {
          const num = parseFloat(mcMatch[1].replace(/,/g, ''));
          const suffix = mcMatch[2].toUpperCase();
          const mult = suffix === 'T' ? 1e12 : suffix === 'B' ? 1e9 : suffix === 'M' ? 1e6 : suffix === 'K' ? 1e3 : 1;
          result.marketCap = Math.round(num * mult);
        } else {
          // Debug: log nearby text around any "cap" mentions
          const capIdx = html.indexOf('cap');
          if (capIdx > -1) {
            const snippet = html.substring(Math.max(0, capIdx - 30), capIdx + 60);
            console.log(`[Google MC DEBUG] No match. Snippet around 'cap': ${snippet.replace(/\n/g, ' ')}`);
          }
        }
      } catch (e) { console.log('[Google MC ERROR]', e.message); }
      return result;
    } catch {}
  }
  return null;
}

function extractDataArray(body, key) {
  const marker = `AF_initDataCallback({key: '${key}'`;
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const dataPos = body.indexOf('data:', start);
  if (dataPos === -1) return null;
  let i = dataPos + 5;
  while (body[i] !== '[' && i < body.length) i++;
  if (body[i] !== '[') return null;
  let depth = 0, jsonStart = i, jsonEnd = -1, inString = false;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  if (jsonEnd === -1) return null;
  try { return JSON.parse(body.substring(jsonStart, jsonEnd)); } catch { return null; }
}

async function fetchV8Historical(symbol, range, interval) {
  if (symbol.endsWith('.NR')) {
    // Nairobi (NSE) historical is only served by the v8 chart endpoint directly.
  }
  const buildUrl = (host) =>
    `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // Direct calls (proxyService hangs on the chart endpoint from this host)
  for (const host of ['query1', 'query2']) {
    try {
      const { data } = await limiters.v8.schedule(() =>
        require('axios').get(buildUrl(host), { timeout: 6000, headers: { 'User-Agent': UA } })
      );
      const bars = parseChartBars(data);
      if (bars?.length) return bars;
    } catch {}
  }
  return null;
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
        require('axios').get(`https://${host}${ep.path}`, {
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

async function fetchQuote(symbol) {
  if (!symbol) return null;
  const cacheKey = symbol.toUpperCase();
  const redisKey = useRedis ? `yahoo:quote:${cacheKey}` : null;
  const cached = await cacheGet(quoteCache, cacheKey, CACHE_TTL.quote, redisKey);
  if (cached) return cached;

  const yahooSymbol = toYahooSymbol(symbol);
  if (symbol.startsWith('NSE:')) return null;

  // 1. Google Finance scrape — fastest and most reliable free option (no IP blocks)
  const google = await fetchGoogleFinanceQuote(yahooSymbol);
  if (google?.price) {
    return cacheSet(quoteCache, cacheKey, {
      symbol: symbol.toUpperCase(),
      company_name: google.companyName || symbol.toUpperCase(),
      price: google.price,
      currency: google.currency || 'USD',
      change: google.change || 0,
      changePercent: google.changePercent || 0,
      changesPercentage: google.changePercent || 0,
      volume: 0,
      dayHigh: google.dayHigh || google.price,
      dayLow: google.dayLow || google.price,
      previousClose: google.previousClose || google.price,
      marketCap: google.marketCap || 0,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      exchange: 'Global',
      provider: 'google',
    }, CACHE_TTL.quote, redisKey);
  }

  // 2. Proxy fallback — Yahoo v8 via free proxy pool or CORS relay
  if (!symbol.startsWith('NSE:')) {
    try {
      const proxyResult = await fetchPriceViaProxy(yahooSymbol);
      if (proxyResult?.price) {
        return cacheSet(quoteCache, cacheKey, {
          symbol: symbol.toUpperCase(),
          company_name: proxyResult.companyName || symbol.toUpperCase(),
          price: proxyResult.price,
          currency: proxyResult.currency || 'USD',
          change: 0,
          changePercent: 0,
          changesPercentage: 0,
          volume: 0,
          dayHigh: proxyResult.price,
          dayLow: proxyResult.price,
          previousClose: proxyResult.previousClose || proxyResult.price,
          marketCap: proxyResult.marketCap || 0,
          timestamp: Math.floor(Date.now() / 1000),
          lastUpdated: new Date().toISOString(),
          exchange: proxyResult.exchange || 'Global',
          provider: 'proxy',
        }, CACHE_TTL.quote, redisKey);
      }
    } catch {}
  }

  // 3. Yahoo V8 direct (works from local dev, usually blocked on cloud)
  let quote = await fetchV8Quote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote, CACHE_TTL.quote, redisKey);

  // 4. yahoo-finance2 npm package
  quote = await fetchYf2Quote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote, CACHE_TTL.quote, redisKey);

  // 5. RapidAPI (needs RAPIDAPI_KEY)
  quote = await fetchRapidapiQuote(yahooSymbol);
  if (quote) return cacheSet(quoteCache, cacheKey, quote, CACHE_TTL.quote, redisKey);

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
  const redisKey = useRedis ? `yahoo:hist:${symbol}:${range}:${interval}` : null;
  const cached = await cacheGet(histCache, cacheKey, CACHE_TTL.historical, redisKey);
  if (cached) return cached;

  const yahooSymbol = toYahooSymbol(symbol);
  let bars = await fetchV8Historical(yahooSymbol, range, interval);
  if (bars) return cacheSet(histCache, cacheKey, bars, CACHE_TTL.historical, redisKey);

  bars = await fetchRapidapiHistorical(yahooSymbol, range, interval);
  if (bars) return cacheSet(histCache, cacheKey, bars, CACHE_TTL.historical, redisKey);

  return null;
}

async function fetchQuoteSummary(symbol, modules) {
  const yahooSymbol = toYahooSymbol(symbol);
  const host = pickHost();
  const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}`;
  const params = { modules: modules.join(',') };

  // Try proxy-first (v10 aggressively blocks cloud IPs)
  const { data: proxyData } = await proxyService.fetchWithProxyFallback(url, params);
  if (proxyData?.quoteSummary?.result?.[0]) {
    return normalizeYahooResponse(proxyData.quoteSummary.result[0]);
  }

  // Try yahoo-finance2 as fallback
  if (!breakers.yf2.isOpen()) {
    try {
      const { default: YahooFinance } = await import('yahoo-finance2');
      const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
      const qs = await yf.quoteSummary(yahooSymbol, { modules });
      if (qs) return normalizeYahooResponse(qs);
    } catch {}
  }

  // Try RapidAPI
  const key = process.env.RAPIDAPI_KEY;
  let rapidHost = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  rapidHost = rapidHost.replace(/^https?:\/\//, '');
  if (key && rapidHost) {
    try {
      const resp = await require('axios').get(`https://${rapidHost}/api/v1/markets/stock/modules`, {
        params: { symbol: yahooSymbol, module: modules.join(',') },
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': rapidHost },
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
  const host = pickHost();
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  const params = { interval: '1d', range: '1d', includePreMarket: 'true' };

  const { data } = await proxyService.fetchWithProxyFallback(url, params);
  if (data) {
    const result = parsePriceProxyResult(data, symbol);
    if (result) return result;
  }

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
