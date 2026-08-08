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
const CONCURRENCY = 16;
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
  if (!cfg) return new Map();

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
          : await withTimeout(fetchHistoricalQuotes(symbol, cfg.range, cfg.interval), FETCH_TIMEOUT_MS);
        const startPrice = periodAgoPrice(bars);
        if (startPrice && startPrice > 0) {
          returns.set(symbol, ((cur - startPrice) / startPrice) * 100);
        }
      } catch {
        // skip symbols we can't resolve
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  return returns;
}

// Get period returns, computing + caching if stale. Returns Map<symbol, pct>.
async function getPeriodReturns(period) {
  const key = period || '1d';
  const cached = periodCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.returns;

  // Avoid duplicate concurrent computations for the same period.
  if (computeInProgress.has(key)) return computeInProgress.get(key);
  const promise = computePeriodReturns(key).then(returns => {
    periodCache.set(key, { ts: Date.now(), returns });
    return returns;
  }).finally(() => {
    computeInProgress.delete(key);
  });
  computeInProgress.set(key, promise);
  return promise;
}

// Build a movers payload (gainers/losers) for a period, merged with quote data.
async function getPeriodMovers(period = '1d') {
  const returns = await getPeriodReturns(period);
  const signals = await signalService.generateSignals(null, true);
  const byTicker = new Map();
  for (const s of signals) byTicker.set(s.ticker, s);

  const rows = [];
  for (const [ticker, r] of returns) {
    if (r == null) continue;
    const s = byTicker.get(ticker);
    rows.push({
      symbol: ticker,
      ticker,
      name: s?.name || ticker,
      price: s?.price || null,
      changePercent: Math.round(r * 100) / 100,
      change: Math.round(r * 100) / 100,
      volume: s?.volume || 0,
      rawVolume: s?.rawVolume || 0,
      currency: s?.currency || (signalService.NSE_SYMBOLS.includes(ticker) ? 'KES' : 'USD'),
      market: s?.market || (signalService.NSE_SYMBOLS.includes(ticker) ? 'NSE' : 'Global'),
      sector: s?.sector || null,
    });
  }
  const gainers = [...rows].filter(r => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
  const losers = [...rows].filter(r => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent);
  return { gainers, losers };
}

module.exports = { getPeriodReturns, getPeriodMovers, PERIODS, normalizeSymbol };
