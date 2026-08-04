// NSE official portal live ticker — the same feed that powers the nse.co.ke
// homepage widget and the portal's % change displays. Authoritative previous
// close + change for NSE equities (the KenyanStocks / MyStocks feeds share a
// stale upstream reference, e.g. CRWN showing +1.71% vs the portal's +0.42%).
const axios = require('axios');

const TICKER_URL = 'https://deveintapps.com/nseticker/api/v1/ticker';
const NSE_ACCOUNT = 'KE3000009674'; // data-account on nse.co.ke widget embeds
const CACHE_TTL = 180000; // 3 min
const MAX_STALE_CACHE_MS = 600000; // serve stale up to 10 min on failure

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let cache = new Map(); // ticker -> normalized quote
let cacheTime = 0;
let failCount = 0;

async function fetchNseTickerQuotes() {
  const now = Date.now();
  const ttl = failCount >= 3 ? CACHE_TTL * 2 : CACHE_TTL;
  if (cache.size > 0 && now - cacheTime < ttl) return cache;

  try {
    const resp = await axios.post(TICKER_URL, JSON.stringify({ nopage: 'true', isinno: NSE_ACCOUNT }), {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': UA,
        'Referer': 'https://www.nse.co.ke/',
        'Origin': 'https://www.nse.co.ke',
        'Host': 'deveintapps.com',
      },
    });
    const snapshot = resp?.data?.message?.[0]?.snapshot;
    if (!Array.isArray(snapshot) || !snapshot.length) {
      throw new Error('empty ticker snapshot');
    }
    const next = new Map();
    for (const q of snapshot) {
      const price = Number(q.price);
      if (!q.issuer || !(price > 0)) continue;
      const prev = Number(q.prev_price) > 0 ? Number(q.prev_price) : price;
      // The API's `change` field is already the % change (verified against
      // price/prev_price on CRWN 0.42 vs 0.422 and SCOM -0.82 vs -0.82).
      const changePercent = Number(q.change);
      next.set(q.issuer.toUpperCase(), {
        symbol: q.issuer.toUpperCase(),
        price,
        previousClose: prev,
        change: price - prev,
        changePercent: isFinite(changePercent) ? changePercent : prev > 0 ? ((price - prev) / prev) * 100 : 0,
        changesPercentage: isFinite(changePercent) ? changePercent : prev > 0 ? ((price - prev) / prev) * 100 : 0,
        volume: Number(q.volume) || 0,
        dayHigh: Number(q.today_high) > 0 ? Number(q.today_high) : price,
        dayLow: Number(q.today_low) > 0 ? Number(q.today_low) : price,
        open: Number(q.today_open) || prev,
        marketCap: 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastUpdated: new Date().toISOString(),
        provider: 'nseportal',
      });
    }
    if (next.size === 0) throw new Error('no parseable ticker entries');
    cache = next;
    cacheTime = now;
    failCount = 0;
    return cache;
  } catch (e) {
    failCount++;
    console.warn(`[NSE-Ticker] fetch failed (${failCount}): ${e.message}`);
    if (cache.size > 0 && now - cacheTime < MAX_STALE_CACHE_MS) return cache;
    return new Map();
  }
}

async function getQuoteForSymbol(symbol) {
  const clean = String(symbol || '').replace('NSE:', '').toUpperCase();
  if (!clean) return null;
  const map = await fetchNseTickerQuotes();
  const q = map.get(clean);
  if (q) {
    return { ...q, company_name: clean };
  }
  return null;
}

module.exports = { fetchNseTickerQuotes, getQuoteForSymbol };
