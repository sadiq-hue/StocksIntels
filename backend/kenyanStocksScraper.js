const axios = require('axios');

const API_URL = 'https://kenyanstocks.com/data/events/v1/all';
const STOCKS_API_URL = 'https://kenyanstocks.com/data/stocks/v1/all';
const SCRAPE_TIMEOUT = 20000;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

let eventsCache = [];
let eventsCacheTime = 0;
let stocksCache = null;
let stocksCacheTime = 0;

async function scrapeEvents() {
  const now = Date.now();
  if (eventsCache.length > 0 && (now - eventsCacheTime) < CACHE_TTL) {
    return eventsCache;
  }

  try {
    const response = await axios.get(API_URL, {
      timeout: SCRAPE_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StocksIntelsBot/1.0)' },
    });

    const data = response.data;
    if (!data || !Array.isArray(data.data)) {
      console.log('[KenyanStocks] API returned no events array');
      return eventsCache;
    }

    const events = data.data.map(ev => ({
      symbol: (ev.symbol || '').toUpperCase(),
      companyName: (ev.company_name || '').trim(),
      date: ev.date || '',
      eventType: ev.event_type || 'other',
      message: ev.message || '',
      exchange: (ev.exchange || 'nse').toUpperCase(),
      companyLogo: ev.company_logo || '',
      source: 'kenyanstocks',
    })).filter(ev => ev.symbol && ev.date);

    if (events.length > 0) {
      eventsCache = events;
      eventsCacheTime = now;
      console.log(`[KenyanStocks] Fetched ${events.length} events from API`);
    } else {
      console.log('[KenyanStocks] API returned 0 events, keeping previous cache');
    }

    return eventsCache;
  } catch (e) {
    console.error('[KenyanStocks] API fetch failed:', e.message);
    return eventsCache;
  }
}

async function getStocksData() {
  const now = Date.now();
  if (stocksCache && (now - stocksCacheTime) < CACHE_TTL) {
    return stocksCache;
  }

  try {
    const response = await axios.get(STOCKS_API_URL, {
      timeout: SCRAPE_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StocksIntelsBot/1.0)' },
    });

    const data = response.data;
    if (data && Array.isArray(data.data)) {
      stocksCache = data.data;
      stocksCacheTime = now;
      console.log(`[KenyanStocks] Fetched ${data.data.length} stocks from API`);
    }
    return stocksCache;
  } catch (e) {
    console.error('[KenyanStocks] Stocks API failed:', e.message);
    return stocksCache;
  }
}

function getEvents() {
  return eventsCache;
}

module.exports = { scrapeEvents, getEvents, getStocksData };
