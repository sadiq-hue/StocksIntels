// Secondary enrichment layer for US symbols.
//
// StockAnalysis provides normalized statistics and consensus/forecast data from
// S&P Global Market Intelligence and TipRanks. It is deliberately isolated from
// the primary scoring path: enrichment is cached, rate-limited, and never blocks
// signal generation. Consumers peek the cache on the hot path and can request a
// fresh fetch for a detail page.

const PersistentCache = require('./cacheService');
const scraper = require('./stockAnalysisScraper');

const cache = new PersistentCache('sa_enrich_v1', 24 * 60 * 60 * 1000);
const inflight = new Map();
cache.loadFromDb().catch(() => {});
const queue = [];
let active = 0;
const MAX_CONCURRENCY = 2;
const MIN_GAP_MS = 300;
let lastStart = 0;
let scheduled = false;

const isUs = (symbol) => !/^(NSE|NGX|JSE):/i.test(String(symbol || ''));

function keyFor(symbol) {
  return String(symbol || '').toUpperCase().replace(/^US:/, '');
}

function peek(symbol) {
  if (!isUs(symbol)) return null;
  return cache.get(`sa_${keyFor(symbol)}`);
}

async function fetchOnce(symbol) {
  const ticker = keyFor(symbol);
  if (!ticker) return null;
  const cacheKey = `sa_${ticker}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const p = (async () => {
    const [stats, forecast] = await Promise.allSettled([
      scraper.getStatistics(ticker),
      scraper.getForecast(ticker),
    ]);
    const statistics = stats.status === 'fulfilled' && stats.value?.success ? stats.value.data : null;
    const forecastData = forecast.status === 'fulfilled' && forecast.value?.success ? forecast.value.data : null;
    if (!statistics && !forecastData) return null;
    const value = {
      symbol: ticker,
      source: 'stockanalysis',
      providers: ['S&P Global Market Intelligence', 'TipRanks'],
      reliability: 'secondary',
      asOf: new Date().toISOString(),
      statistics,
      forecast: forecastData,
    };
    cache.set(cacheKey, value);
    return value;
  })().finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

function pump() {
  if (active >= MAX_CONCURRENCY || queue.length === 0) {
    scheduled = false;
    return;
  }
  if (scheduled) return;
  scheduled = true;
  const gap = Math.max(0, MIN_GAP_MS - (Date.now() - lastStart));
  setTimeout(() => {
    scheduled = false;
    if (active >= MAX_CONCURRENCY || queue.length === 0) return;
    const job = queue.shift();
    active++;
    lastStart = Date.now();
    fetchOnce(job.symbol)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        active--;
        pump();
      });
    pump();
  }, gap);
}

function getEnrichment(symbol) {
  if (!isUs(symbol)) return Promise.resolve(null);
  const cached = peek(symbol);
  if (cached) return Promise.resolve(cached);
  const cacheKey = `sa_${keyFor(symbol)}`;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  return new Promise((resolve, reject) => {
    queue.push({ symbol, resolve, reject });
    pump();
  });
}

async function warm(symbols = [], { forecast = true } = {}) {
  const unique = [...new Set((symbols || []).map(keyFor).filter(Boolean))];
  for (const symbol of unique) {
    if (!isUs(symbol) || peek(symbol)) continue;
    try {
      await getEnrichment(symbol);
    } catch {
      /* best-effort */
    }
  }
}

module.exports = { getEnrichment, peek, warm };
