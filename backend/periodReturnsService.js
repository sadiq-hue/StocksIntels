// PeriodReturnsService — computes top gainers/losers over configurable periods
// (1d, 1w, 1mo, 3mo, 1y) using historical price bars. Results are cached in
// memory with a TTL so the whole universe only gets recomputed periodically,
// not on every dashboard hit.
const { fetchHistoricalQuotes } = require('./globalScraper');
const signalService = require('./signalService');

// NSE bars map from period -> required lookback bars (approximate trading days).
const NSE_LOOKBACK = {
  '1d': 3,
  '1w': 7,
  '1mo': 24,
  '3mo': 70,
  '1y': 260,
};

async function fetchNseHistory(symbol, range) {
  // NSE history is read from the DB-backed daily bars (seeded from KenyanStocks /
  // Mystocks Africa). The mystocksAfrica partner history endpoint is unreliable
  // and rate-limited (429), so attempting it per-symbol just wastes time and
  // trips the rate limiter. DB bars are the dependable source here.
  try {
    const nseHistory = require('./nseHistoryService');
    const ticker = String(symbol).replace(/^NSE:/i, '').replace(/\.NSE$/i, '').toUpperCase();
    const need = NSE_LOOKBACK[range] || 30;
    const bars = await nseHistory.getBars(ticker, need);
    if (Array.isArray(bars) && bars.length > 1) return bars;
  } catch { /* fall through */ }
  // Fallback: mystocksAfrica partner API as a last resort.
  try {
    const msa = require('./mystocksAfricaApi');
    const bars = await msa.fetchHistorical(symbol, range);
    if (Array.isArray(bars) && bars.length > 1) return bars;
  } catch { /* ignore */ }
  return null;
}

const PERIODS = {
  '1d':  { range: '1d',  interval: '1d', label: 'Daily' },
  '1w':  { range: '5d',  interval: '1d', label: 'Weekly' },
  '1mo': { range: '1mo', interval: '1d', label: 'Monthly' },
  '3mo': { range: '3mo', interval: '1d', label: 'Quarterly' },
  '1y':  { range: '1y',  interval: '1d', label: 'Yearly' },
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const WARM_INTERVAL_MS = 7 * 60 * 1000; // refresh each period ~every 7 min
const CONCURRENCY = 24;
const FETCH_TIMEOUT_MS = 6000;

const periodCache = new Map(); // period -> { ts, returns: Map<symbol, number> }
const computeInProgress = new Map();

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function periodAgoPrice(bars) {
  // bars: array of { date, close, ... } ascending by date. The first bar is the
  // period-start close, the last is the most recent.
  if (!Array.isArray(bars) || bars.length < 2) return null;
  for (const b of bars) {
    if (b && typeof b.close === 'number' && b.close > 0) return b.close;
  }
  return null;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/^(NSE|NYSE|NASDAQ|AMEX):/, '');
}

async function computePeriodReturns(period) {
  const cfg = PERIODS[period];
  if (!cfg) return { returns: new Map(), prices: new Map(), volumes: new Map(), names: new Map() };

  // Use the current cached quote prices for the "now" value. Include the fresh
  // signals, open monitored positions, AND every NSE symbol from the universe —
  // the monitor-first gate and eligibility drops can keep valid NSE names (e.g.
  // Car & General CGEN) out of the fresh cache even though they trade daily.
  const currentPrices = new Map();
  const signals = await signalService.generateSignals(null, true);
  for (const s of signals) {
    if (s && s.ticker != null && s.price != null && s.price > 0) {
      currentPrices.set(s.ticker, s.price);
    }
  }
  try {
    for (const m of signalService.getMonitoredSignals()) {
      if (m && m.ticker && m.price != null && m.price > 0 && !currentPrices.has(m.ticker)) {
        currentPrices.set(m.ticker, m.price);
      }
    }
  } catch { /* monitored list may be empty */ }
  // Pull current NSE prices from the quote cache so every tracked NSE name is
  // in the universe even if the signal pipeline skipped it this cycle.
  try {
    const fr = require('./financialReportsService');
    const nseSymbols = signalService.NSE_SYMBOLS || [];
    for (const sym of nseSymbols) {
      if (!currentPrices.has(sym)) {
        try {
          const q = await fr.getQuote(`NSE:${sym}`);
          if (q && q.price && q.price > 0) currentPrices.set(sym, q.price);
        } catch { /* skip */ }
      }
    }
  } catch { /* quote service may be unavailable */ }

  const symbols = [...currentPrices.keys()];
  const returns = new Map();
  const volumes = new Map();
  const names = new Map();
  for (const s of signals) if (s && s.name) names.set(s.ticker, s.name);

  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const symbol = symbols[idx++];
      try {
        const isNse = signalService.NSE_SYMBOLS.includes(symbol);
        const cur = currentPrices.get(symbol);
        if (!cur) continue;
        const bars = isNse
          ? await withTimeout(fetchNseHistory(symbol, cfg.range), FETCH_TIMEOUT_MS)
          : await withTimeout(fetchHistoricalQuotes(symbol, cfg.range, cfg.interval, { bulk: true }), FETCH_TIMEOUT_MS);
        const startPrice = periodAgoPrice(bars);
        if (startPrice && startPrice > 0) {
          returns.set(symbol, ((cur - startPrice) / startPrice) * 100);
        }
        const lastBar = Array.isArray(bars) ? bars[bars.length - 1] : null;
        if (lastBar && typeof lastBar.volume === 'number' && lastBar.volume > 0) {
          volumes.set(symbol, lastBar.volume);
        }
      } catch {
        // skip symbols we can't resolve
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  return { returns, prices: currentPrices, volumes, names };
}

// Get period returns, computing + caching if stale. Returns Map<symbol, pct>.
// Serves the last known result immediately and refreshes in the background so a
// period switch on the dashboard never blocks behind a multi-minute recompute.
// Get full period details (returns/prices/volumes/names), computing + caching
// if stale. Serves the last known result immediately and refreshes in the
// background so a period switch on the dashboard never blocks behind a
// multi-minute recompute.
async function getPeriodDetails(period) {
  const key = period || '1d';
  const cached = periodCache.get(key);
  if (cached) {
    if (Date.now() - cached.ts < CACHE_TTL_MS) return cached;
    // Stale: kick off a background refresh but answer with what we have.
    if (!computeInProgress.has(key)) {
      const promise = computePeriodReturns(key)
        .then(details => { periodCache.set(key, { ts: Date.now(), ...details }); return details; })
        .catch(() => {})
        .finally(() => computeInProgress.delete(key));
      computeInProgress.set(key, promise);
    }
    return cached;
  }
  // No cache yet (cold start): block on the compute or share in-progress work.
  if (computeInProgress.has(key)) return computeInProgress.get(key);
  const promise = computePeriodReturns(key)
    .then(details => { periodCache.set(key, { ts: Date.now(), ...details }); return details; })
    .finally(() => computeInProgress.delete(key));
  computeInProgress.set(key, promise);
  return promise;
}

async function getPeriodReturns(period) {
  const details = await getPeriodDetails(period);
  return details.returns;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Background warmer: precomputes the non-daily periods on boot and refreshes
// them on a loop so on-demand requests are almost always warm cache hits.
async function warmPeriodCaches() {
  const order = ['1w', '1mo', '3mo', '1y'];
  while (true) {
    for (const p of order) {
      try { await getPeriodReturns(p); } catch { /* keep going */ }
    }
    try { await sleep(WARM_INTERVAL_MS); } catch { /* ignore */ }
  }
}

// Build a movers payload (gainers/losers) for a period, merged with quote data.
async function getPeriodMovers(period = '1d') {
  const { returns, prices, volumes, names } = await getPeriodDetails(period);
  const signals = await signalService.generateSignals(null, true);
  const byTicker = new Map();
  for (const s of signals) byTicker.set(s.ticker, s);

  const rows = [];
  for (const [ticker, r] of returns) {
    if (r == null) continue;
    const s = byTicker.get(ticker);
    const isNse = signalService.NSE_SYMBOLS.includes(ticker);
    rows.push({
      symbol: ticker,
      ticker,
      name: s?.name || names?.get(ticker) || ticker,
      price: prices?.get(ticker) ?? s?.price ?? null,
      changePercent: Math.round(r * 100) / 100,
      change: Math.round(r * 100) / 100,
      volume: volumes?.get(ticker) ?? s?.rawVolume ?? s?.volume ?? 0,
      rawVolume: volumes?.get(ticker) ?? s?.rawVolume ?? 0,
      currency: s?.currency || (isNse ? 'KES' : 'USD'),
      market: s?.market || (isNse ? 'NSE' : 'Global'),
      sector: s?.sector || null,
    });
  }
  const gainers = [...rows].filter(r => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = [...rows].filter(r => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  return { gainers, losers };
}

module.exports = { getPeriodReturns, getPeriodDetails, getPeriodMovers, warmPeriodCaches, PERIODS, normalizeSymbol };
