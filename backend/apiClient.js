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

module.exports = { fmp, eodhd, polygon, finnhub, newsapi, rapidapi, generic, broker, payd };
