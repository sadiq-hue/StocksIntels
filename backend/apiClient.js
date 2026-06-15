const axios = require('axios');
const Bottleneck = require('bottleneck');

function createRateLimitedClient(name, minTime, maxConcurrent = 1) {
  const limiter = new Bottleneck({
    maxConcurrent,
    minTime,
    highWater: 100,
    strategy: Bottleneck.strategy.OVERFLOW
  });

  const client = axios.create({ timeout: 10000 });

  const wrappedGet = (url, config) =>
    limiter.schedule(() => client.get(url, config));

  const wrappedPost = (url, data, config) =>
    limiter.schedule(() => client.post(url, data, config));

  limiter.on('error', (err) => console.error(`[apiClient:${name}]`, err));

  return { get: wrappedGet, post: wrappedPost, client, limiter };
}

// FMP free tier ~30 req/min
const fmp = createRateLimitedClient('fmp', 2000, 1);

// EODHD free tier
const eodhd = createRateLimitedClient('eodhd', 2000, 1);

// Polygon free tier: 5 req/min
const polygon = createRateLimitedClient('polygon', 12000, 1);

// Finnhub free tier: 30 req/min
const finnhub = createRateLimitedClient('finnhub', 2000, 1);

// NewsAPI free tier: 100 req/day
const newsapi = createRateLimitedClient('newsapi', 15000, 1);

// RapidAPI (Yahoo Finance) - generous tier
const rapidapi = createRateLimitedClient('rapidapi', 600, 1);

// Generic external API client (cautious default)
const generic = createRateLimitedClient('generic', 1000, 2);

// Brokers / payment services
const broker = createRateLimitedClient('broker', 500, 2);
const payd = createRateLimitedClient('payd', 500, 2);

// Exponential backoff retry wrapper for transient failures
async function withRetry(fn, { label = 'api', maxRetries = 3, baseDelay = 1000, shouldRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      const isRetryable = shouldRetry
        ? shouldRetry(err)
        : !status || (status >= 500 || status === 429);
      if (!isRetryable || attempt >= maxRetries) break;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[apiClient:${label}] Attempt ${attempt + 1}/${maxRetries} failed (${status || err.code}), retrying in ${delay.toFixed(0)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

module.exports = { fmp, eodhd, polygon, finnhub, newsapi, rapidapi, generic, broker, payd, withRetry };
