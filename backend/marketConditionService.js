// Live market-condition overlay used by the adaptive score/confidence gates.
//
// This is deliberately a separate, cached plane: VIX and sector ETFs refresh
// every minute; a broad tracked-universe quote sample refreshes every five
// minutes. Signal cycles and detail requests read the cache and never wait for
// these network calls.

const axios = require('axios');
const marketService = require('./marketService');
const yahooService = require('./yahooService');
const { US_SYMBOLS } = require('./stockData');

const SECTOR_ETFS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC'];
const BREADTH_SYMBOLS = US_SYMBOLS.slice();
const BREADTH_FALLBACK = US_SYMBOLS.filter((_, i) => i % 10 === 0);
const FAST_TTL_MS = 60 * 1000;
const BREADTH_TTL_MS = 10 * 60 * 1000;
const BREADTH_CHUNK = 100;

let conditions = {
  asOf: null,
  vix: null,
  vixChangePct: null,
  breadth: null,
  sectors: null,
  creditSpread: null,
  riskTone: 'unknown',
};
let lastFast = 0;
let lastBreadth = 0;
let inflight = null;
let timer = null;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function scoreBreadth(adv, dec, flat) {
  const total = adv + dec + flat;
  if (!total) return null;
  const ratio = (adv - dec) / Math.max(1, total);
  return Math.max(0, Math.min(100, Math.round(50 + ratio * 50)));
}

function deriveTone(vix, breadth) {
  if (vix == null && !breadth) return 'unknown';
  if ((vix != null && vix >= 30) || (breadth?.score != null && breadth.score < 30)) return 'risk-off';
  if ((vix != null && vix <= 17) && (breadth?.score == null || breadth.score >= 55)) return 'risk-on';
  return 'mixed';
}

async function fetchVixDirect() {
  try {
    const res = await withTimeout(
      axios.get('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1m&includePrePost=false', {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      }),
      12000,
      null
    );
    const meta = res?.data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    const prev = Number(meta?.previousClose) || Number(meta?.chartPreviousClose) || price;
    return { price, changePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0 };
  } catch {
    return null;
  }
}

async function fetchBreadthQuotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += BREADTH_CHUNK) {
    const chunk = symbols.slice(i, i + BREADTH_CHUNK);
    const part = await withTimeout(yahooService.fetchV7Quotes(chunk), 12000, null);
    if (part) Object.assign(out, part);
    if (i + BREADTH_CHUNK < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  return out;
}

async function refresh() {
  if (inflight) return inflight;
  if (Date.now() - lastFast < FAST_TTL_MS) return conditions;
  inflight = (async () => {
    const now = Date.now();
    let vix = conditions.vix;
    let vixChangePct = conditions.vixChangePct;
    let sectors = conditions.sectors;
    let breadth = conditions.breadth;
    let creditSpread = conditions.creditSpread;

    try {
      const [directVix, sectorQuotes] = await Promise.all([
        fetchVixDirect(),
        withTimeout(marketService.getQuotesBatch(SECTOR_ETFS), 12000, null),
      ]);
      const vixQuote = directVix
        || await withTimeout(yahooService.fetchQuote('^VIX'), 12000, null)
        || await withTimeout(marketService.getStockQuote('^VIX'), 8000, null);
      if (vixQuote) {
        vix = Number(vixQuote.price) || vix;
        vixChangePct = Number(vixQuote.changePercent) || vixChangePct;
      }
      if (sectorQuotes) {
        const rows = SECTOR_ETFS.map(sym => {
          const q = sectorQuotes[sym] || null;
          const rawPct = q ? Number(q.changePercent) : 0;
          // A split/stale previous-close glitch can surface as a double-digit
          // one-day ETF move; clamp it out rather than let it flip risk tone.
          const changePct = Number.isFinite(rawPct) && Math.abs(rawPct) <= 5 ? rawPct : 0;
          return {
            symbol: sym,
            changePct,
            price: q ? Number(q.price) || null : null,
          };
        });
        const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
        const positive = rows.filter(r => r.changePct > 0).length;
        sectors = {
          leader: sorted[0]?.symbol || null,
          laggard: sorted[sorted.length - 1]?.symbol || null,
          dispersion: sorted.length ? Math.round((sorted[0].changePct - sorted[sorted.length - 1].changePct) * 100) / 100 : null,
          riskOn: positive >= Math.ceil(rows.length * 0.6),
          rows,
        };
      }
    } catch { /* optional fast conditions */ }

    // Publish VIX/sector state immediately; breadth batches can take longer on a
    // cold start and should not leave the conditions plane blank meanwhile.
    conditions = {
      ...conditions,
      asOf: new Date().toISOString(),
      vix,
      vixChangePct,
      sectors,
      riskTone: deriveTone(vix, breadth),
    };

    if (now - lastBreadth >= BREADTH_TTL_MS) {
      try {
        // Yahoo v7 carries the 50/200-day averages and 52-week extremes in the
        // same batch response, so true trend breadth costs no extra requests.
        const v7 = await withTimeout(fetchBreadthQuotes(BREADTH_SYMBOLS), 60000, null);
        let rows = [];
        if (v7 && Object.keys(v7).length >= 20) {
          rows = Object.entries(v7).map(([symbol, q]) => ({
            symbol,
            price: Number(q?.regularMarketPrice),
            changePct: Number(q?.regularMarketChangePercent),
            sma200: Number(q?.twoHundredDayAverage),
            sma50: Number(q?.fiftyDayAverage),
            high52: Number(q?.fiftyTwoWeekHigh),
            low52: Number(q?.fiftyTwoWeekLow),
          }));
        }
        if (!rows.length) {
          const quotes = await withTimeout(marketService.getQuotesBatch(BREADTH_FALLBACK), 12000, null);
          if (quotes) {
            rows = Object.values(quotes).map(q => ({
              price: Number(q?.price),
              changePct: Number(q?.changePercent),
            }));
          }
        }
        if (rows.length) {
          let adv = 0, dec = 0, flat = 0;
          let above200 = 0, ma200N = 0, above50 = 0, ma50N = 0;
          let newHighs = 0, newLows = 0;
          for (const r of rows) {
            const c = r.changePct;
            if (!Number.isFinite(c) || c === 0) flat++;
            else if (c > 0) adv++;
            else dec++;
            if (Number.isFinite(r.price) && r.price > 0) {
              if (Number.isFinite(r.sma200) && r.sma200 > 0) {
                ma200N++;
                if (r.price > r.sma200) above200++;
              }
              if (Number.isFinite(r.sma50) && r.sma50 > 0) {
                ma50N++;
                if (r.price > r.sma50) above50++;
              }
              if (Number.isFinite(r.high52) && r.high52 > 0 && r.price >= r.high52 * 0.99) newHighs++;
              if (Number.isFinite(r.low52) && r.low52 > 0 && r.price <= r.low52 * 1.01) newLows++;
            }
          }
          breadth = {
            advancers: adv,
            decliners: dec,
            unchanged: flat,
            sampled: adv + dec + flat,
            score: scoreBreadth(adv, dec, flat),
            pctAbove200: ma200N ? Math.round((above200 / ma200N) * 1000) / 10 : null,
            pctAbove50: ma50N ? Math.round((above50 / ma50N) * 1000) / 10 : null,
            newHighs,
            newLows,
            maSampled: ma200N,
          };
          lastBreadth = now;
        }
      } catch { /* keep previous breadth */ }
    }

    // Credit spreads are slow-moving and the FRED endpoint is often slow; keep
    // the last value and refresh opportunistically, never blocking the cycle.
    if (!creditSpread || now - (conditions.creditSpreadAt || 0) > 60 * 60 * 1000) {
      try {
        const res = await withTimeout(
          axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2', { timeout: 10000 }),
          10000,
          null
        );
        const text = String(res?.data || '').trim();
        const last = text.split(/\r?\n/).filter(Boolean).pop();
        const val = Number(last?.split(',')[1]);
        if (Number.isFinite(val)) {
          creditSpread = val;
          conditions.creditSpreadAt = now;
        }
      } catch { /* keep previous */ }
    }

    const tone = deriveTone(vix, breadth);

    conditions = {
      ...conditions,
      asOf: new Date().toISOString(),
      vix,
      vixChangePct,
      breadth,
      sectors,
      creditSpread,
      riskTone: tone,
    };
    lastFast = now;
    return conditions;
  })().finally(() => { inflight = null; });
  return inflight;
}

function getConditions() {
  return conditions;
}

function start(intervalMs = 60 * 1000) {
  if (timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => refresh().catch(() => {}), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { refresh, getConditions, start };
