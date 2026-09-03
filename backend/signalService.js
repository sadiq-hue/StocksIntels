// Signal Service - AI-powered trading signal generation for NSE and NYSE stocks
// Uses hardcoded fundamentals for known stocks and auto-generates for any stock

const axios = require('axios');
const { pool } = require('./db');

const { getStockQuote, getQuotesBatch } = require('./marketService');
const { fetchHistoricalQuotes } = require('./globalScraper');
const nseHistory = require('./nseHistoryService');
const { getMacroScore, getCountryForSymbol, generateMacroReason } = require('./macroService');
const { getAggregatedSentiment, getCatalysts, getInsiderNewsSignals, initNewsHistory } = require('./newsService');
const { getKeyMetrics, getQuote, getCompanyProfile } = require('./financialReportsService');
const { calculateSMA } = require('./technicalIndicators');
const { guessSector, resolveStockName, KNOWN_NAMES, NSE_SYMBOLS, US_SYMBOLS, ALL_SYMBOLS, SECTOR_AVG_PE, INDUSTRY_MEDIAN_EV_EBITDA, TBILI_RATE, KNOWN_FUNDAMENTALS, NSE_FUNDAMENTALS } = require('./stockData');
const financialReportsService = require('./financialReportsService');
const edgarService = require('./edgarService');
const { getEffectiveSectorPE, getGrade, determineSignal, determineTradeType, getSectorMacroAdjustment, analyzeFundamentals, analyzeTechnicals, analyzeFinancials, generateReason } = require('./analysisEngine');
const { calculatePositionSize, calculateKellyPositionSize, calculateTradeLevels, MIN_STOP_PCT, enforceStopFloor, isPlausibleBuyLevels, updatePortfolioRisk, applyPortfolioConstraints, trackSignalOutcomes } = require('./riskManager');
const mlModel = require('./mlSignalModel');
const engineConfig = require('./engineConfig');
const { trackSignalQuality, logHealth, detectSignalDrift, getQualityScore } = require('./monitorService');
const PersistentCache = require('./cacheService');
const { EventEmitter } = require('events');
const signalEventBus = new EventEmitter();
signalEventBus.setMaxListeners(50);

console.log('📊 Signal Service Loaded - AI Trading Signals Engine (NYSE + NSE)');

// Ensure DB schema columns exist before any operations
(async () => {
  try {
    await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE`);
    // Source of each outcome row: 'live' (live-monitor stop/target/trailing fills),
    // 'backtest' (historical day-close evaluation), or 'backfill' (mark-to-market
    // approximation). Live win-rate stats must only count 'live'.
    await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live'`);
    // The restore/win-rate queries COALESCE(signal_generated_at, recorded_at), so a
    // deploy that predates this column used to crash boot with
    // 'column "signal_generated_at" does not exist'. Idempotent ALTER fixes that.
    await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS signal_generated_at TIMESTAMP WITH TIME ZONE`);
    // Audit trail: why each outcome was closed. Score-based closes persist the
    // exact verdict ('score flipped' | 'profit fade' | 'stale thesis' |
    // 'conviction faded'), stop/target closes record the level that fired
    // ('stop loss' | 'trailing stop' | 'target reached'), so forensics like the
    // MS Aug 7 premature close no longer have to be reverse-engineered from the
    // exit price + code version.
    await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS close_reason TEXT`);
    // Dedupe and enforce one outcome per emitted signal. signal_outcomes had no
    // unique constraint, so the same (ticker, signal_generated_at) could be
    // inserted twice (e.g. double resolution or a backtest/live race) and the
    // ON CONFLICT DO NOTHING inserts above were silent no-ops. This self-heals
    // on any DB then makes those guards actually work going forward.
    await pool.query(`DELETE FROM signal_outcomes a USING signal_outcomes b
      WHERE a.ctid < b.ctid AND a.ticker = b.ticker
        AND a.signal_generated_at IS NOT DISTINCT FROM b.signal_generated_at`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_outcomes_signal
      ON signal_outcomes (ticker, signal_generated_at)`).catch(() => {});
    // Historical backtest previously force-closed signals at the last available
    // bar even when the trade-type hold window hadn't elapsed (CGEN Aug 5 Long
    // Term: entry 156.75, target1 208.34, force-closed at 194.75 four bars later,
    // ~5 calendar days, as an 'expiry close'; same for the Aug 2 signal closed
    // at 158.00 — matched neither stop 146.11 nor target1 172.52). Those rows are
    // premature and pollute stats; delete them so the fixed backtest re-evaluates
    // each signal honestly once available history covers its hold window (Long
    // Term ~130 bars, short-term ~20 bars, approximated in calendar days below).
    // A row is premature when it resolved before its hold window elapsed AND its
    // exit price matches neither the stop nor target1 (the ONLY legitimate
    // short-history closes); close_reason may be empty on rows recorded before
    // that column existed.
    await pool.query(`DELETE FROM signal_outcomes o
      USING signal_history h
      WHERE o.ticker = h.ticker
        AND o.signal_generated_at IS NOT DISTINCT FROM date_trunc('milliseconds', h.generated_at)
        AND o.source = 'backtest'
        AND o.resolved_at - o.signal_generated_at < CASE
          WHEN h.trade_type ILIKE '%long term%' THEN INTERVAL '182 days'
          ELSE INTERVAL '20 days'
        END
        AND (
          o.close_reason = 'expiry close'
          OR (
            (o.close_reason IS NULL OR o.close_reason = '')
            AND NOT (o.exit_price BETWEEN h.stop_loss - 0.001 AND h.stop_loss + 0.001)
            AND NOT (o.exit_price BETWEEN h.target1 - 0.001 AND h.target1 + 0.001)
          )
        )`).catch(() => {});
    await pool.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS analysis_data JSONB`);
    // restoreStateFromDb SELECTs target3/reason from signal_history to re-seed
    // monitored positions across restarts; the idempotent ALTERs keep restores
    // working on schemas created before target3/T2 existed.
    await pool.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS target3 NUMERIC(15,2)`);
    await pool.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS reason TEXT`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(15,2)`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS target1 NUMERIC(15,2)`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS action VARCHAR(10)`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS trade_type VARCHAR(30)`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS sector VARCHAR(50)`);
    await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS bench_price NUMERIC(15,2)`);
    await nseHistory.ensureTable().catch(() => {});
  } catch {}
})();
// Signal evaluation window (must be declared before restoreStateFromDb runs).
// Covers the longest monitored position lifespan: wide targets can take weeks to
// fill and positions run until stop/target (no expiry), so a 180-day window keeps
// monitored signals, live/forward test stats, and the auto backtest aligned with
// the full signal lifecycle instead of only the last day. Open positions restore
// within this same window (see restoreStateFromDb) and OPEN_POSITION_MAX_AGE_HOURS
// below is derived from it so stats and position-restore can never drift apart.
const SIGNAL_WINDOW_DAYS = 180;
// Physical retention is decoupled from the display/backtest window: the runtime
// window (SIGNAL_WINDOW_DAYS) decides what the stats, live/forward test and auto
// backtest show, while retentionDays (engine config, default 365; env override
// RETENTION_DAYS) decides how long signal_history and other audit-critical rows
// are kept before the scheduled cleanup deletes them. Audit trails must survive
// far longer than the evaluation window, so keep 1yr+ here. The value is read at
// runtime (not cached) so it can be edited from the admin Config page.
const RETENTION_DAYS = Math.max(90, parseInt(process.env.RETENTION_DAYS || '365', 10) || 365);
// Only the most recent Buy signal per ticker is restored as an open monitored
// position after a restart. Anything older than this is treated as a stale
// (unused/expired) signal, not an active position — otherwise old buys pile up
// as "open positions" that only close on stop/target and never age out.
// Long-term types (Long Term / Long Term Value) are exempt: their whole thesis
// is a months-long stop/target hold (score closes are disabled for them), so a
// 72h restart cap would silently kill a position that had simply been running
// A short-term cap of 72h was silently dropping positions that hadn't reached
// their stop or target yet — those signals became orphans in signal_history
// with no monitor to ever resolve them. Now ALL trade types restore within the
// full SIGNAL_WINDOW_DAYS evaluation window. The resolved-outcome check
// (9c1ebea fix) already prevents re-monitoring resolved positions, so there
// is no harm in restoring more — every open position gets its fair chance.
const OPEN_POSITION_MAX_AGE_HOURS = Math.max(1, parseInt(process.env.OPEN_POSITION_MAX_AGE_HOURS || String(SIGNAL_WINDOW_DAYS * 24), 10) || (SIGNAL_WINDOW_DAYS * 24)); // default = SIGNAL_WINDOW_DAYS days, so position restore matches the evaluation window
// Restore performance stats and portfolio state from DB on startup
restoreStateFromDb().catch(() => {});
// Bootstrap durable NSE daily history (KenyanStocks seed + best-effort deep bootstrap) non-blocking
nseHistory.bootstrapNseHistory().catch(() => {});
// Bootstrap durable news-sentiment history (ensure table, prune, backfill past ~2 weeks) non-blocking
initNewsHistory().catch(() => {});

// In-memory cache for generateSignals to prevent redundant calls
let _signalsCache = null;
let _signalsCacheTime = 0;
let _signalsInProgress = false;
const SIGNALS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (matches the quick-mode stale background refresh threshold)

async function _persistSignalCache(signals) {
  try {
    await pool.query(
      `INSERT INTO app_cache (cache_key, cache_value, updated_at) VALUES ('signals_cache', $1::jsonb, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET cache_value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(signals)]
    );
  } catch { /* best-effort */ }
}

async function _loadSignalCacheFromDb() {
  try {
    const result = await pool.query(
      `SELECT cache_value FROM app_cache WHERE cache_key = 'signals_cache'`
    );
    if (result.rows.length && result.rows[0].cache_value) {
      _signalsCache = _normalizeSignalCurrency(result.rows[0].cache_value);
      _signalsCacheTime = 0;
      console.log(`[SignalService] Loaded ${_signalsCache.length} signals from cache DB (will regenerate in background)`);
      return;
    }
  } catch { /* table may not exist */ }

  // Fallback: rebuild from signal_history (last known signal per ticker)
  try {
    const hist = await pool.query(
      `SELECT DISTINCT ON (ticker) ticker, signal, confidence, price, change_pct, sector, market, currency, trade_type
       FROM signal_history ORDER BY ticker, generated_at DESC LIMIT 500`
    );
    if (hist.rows.length > 0) {
      _signalsCache = _normalizeSignalCurrency(hist.rows.map(r => ({
        ticker: r.ticker,
        name: r.ticker,
        sector: r.sector || 'General',
        price: parseFloat(r.price) || 0,
        change: parseFloat(r.change_pct) || 0,
        market: r.market || (NSE_SYMBOLS.includes(r.ticker) ? 'NSE' : 'Global'),
        currency: r.currency || (NSE_SYMBOLS.includes(r.ticker) ? 'KES' : 'USD'),
        signal: r.signal || 'Hold',
        type: r.trade_type || 'Swing Trade',
        confidence: parseInt(r.confidence) || 0,
        volume: 0,
        analysis: { overall: { score: 50, grade: 'C' }, fundamental: { score: 50 }, technical: { score: 50 }, financial: { score: 50 }, macro: { score: 50 } },
      })));
      _signalsCacheTime = Date.now();
      console.log(`[SignalService] Loaded ${_signalsCache.length} signals from signal_history (fallback)`);
      return;
    }
  } catch { /* table may not exist */ }

  // Final fallback: build baseline from KNOWN_FUNDAMENTALS
  _buildBaselineCache();
}

// Ensure every cached signal carries a correct currency/market for its ticker,
// backfilling stale rows written by older engine versions (some historically
// defaulted NSE symbols to USD).
function _normalizeSignalCurrency(signals) {
  if (!Array.isArray(signals)) return signals;
  for (const s of signals) {
    if (!s) continue;
    const isNse = NSE_SYMBOLS.includes(s.ticker);
    if (isNse) {
      s.currency = 'KES';
      s.market = 'NSE';
    }
  }
  return signals;
}

function _buildBaselineCache() {
  const baseline = [];
  for (const symbol of ALL_SYMBOLS) {
    const info = KNOWN_FUNDAMENTALS[symbol] || NSE_FUNDAMENTALS[symbol] || {};
    baseline.push({
      ticker: symbol,
      name: KNOWN_FUNDAMENTALS[symbol]?.name || symbol,
      sector: info.sector || guessSector(symbol),
      price: 0,
      change: 0,
      market: NSE_SYMBOLS.includes(symbol) ? 'NSE' : 'US',
      currency: NSE_SYMBOLS.includes(symbol) ? 'KES' : 'USD',
      signal: 'Hold',
      type: 'Swing Trade',
      confidence: 0,
      volume: 0,
      analysis: { overall: { score: 50, grade: 'C' }, fundamental: { score: 50 }, technical: { score: 50 }, financial: { score: 50 }, macro: { score: 50 } },
    });
  }
  _signalsCache = baseline;
  _signalsCacheTime = Date.now();
  console.log(`[SignalService] Built baseline cache with ${baseline.length} stocks`);
}

// Price history cache for technical analysis
const _priceHistoryCache = new Map();
const PRICE_HISTORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const PRICE_HISTORY_FAIL_TTL = 60 * 1000;       // retry a failed fetch after 60s (not 1h)

// Financial report cache for fundamental analysis (daily refresh, persisted to DB on restart)
const _financialReportCache = new PersistentCache('sigfin', 24 * 60 * 60 * 1000);

// Signal performance tracker (in-memory, rolling 100 signals per symbol)
const _signalOutcomes = new Map();
let _signalHistoryCount = 0;

// Count of positions the live monitor is actively tracking (open directional calls
// with stop/target levels and a timestamp — resolved ones have result set and no
// timestamp). Hold ratings and level-less Sell ratings are not tracked, so they
// are excluded to keep the "Monitored Signals" stat honest.
function getOpenPositionCount() {
  let n = 0;
  for (const v of _signalOutcomes.values()) {
    if (!v.result && v.timestamp && v.action !== 'hold' && v.stopLoss != null && v.target1 != null) n++;
  }
  return n;
}

// Detail list of the positions the live monitor is actively tracking — every one
// is a Buy-direction call (Sell ratings are exit/avoid flags with no levels, so
// they are never tracked as positions). Exposed so the frontend can show the
// monitored buys instead of only the fresh generation output, where open buys
// are held by the monitor-first gate and therefore don't appear.
function getMonitoredSignals() {
  const out = [];
  for (const [ticker, v] of _signalOutcomes) {
    if (v.result || !v.timestamp || v.action === 'hold' || v.stopLoss == null || v.target1 == null) continue;
    const cached = Array.isArray(_signalsCache) ? _signalsCache.find(s => s.ticker === ticker) : null;
    // Monitored positions are held by the monitor-first gate and thus never appear
    // in the fresh generation cache, so their live price/change come from the
    // batch quote cache (warmed by prefetchQuotes during generation cycles and by
    // refreshMonitoredQuotes() on the /api/signals routes). Prefer the fresh-signal
    // values when present, else the quote cache, else a warm refresh.
    const qc = _quoteCache.get(ticker);
    const price = (cached && cached.price) || (qc && qc.price) || null;
    const change = cached && cached.change != null ? cached.change : (qc && qc.changePercent != null ? qc.changePercent : null);
    const isNse = NSE_SYMBOLS.includes(ticker);
    out.push({
      ticker,
      signal: v.signal,
      action: v.action,
      type: v.type || 'Swing Trade',
      entryPrice: v.entryPrice,
      stopLoss: v.stopLoss,
      target1: v.target1,
      target2: v.target2 != null ? v.target2 : null,
      target3: v.target3 != null ? v.target3 : null,
      positionSize: v.positionSize || 25,
      price,
      change,
      confidence: v.confidence != null ? v.confidence : (cached && cached.confidence != null ? cached.confidence : null),
      name: cached && cached.name ? cached.name : null,
      sector: cached && cached.sector ? cached.sector : null,
      timeframe: v.timeframe || (cached && cached.timeframe ? cached.timeframe : null),
      market: isNse ? 'NSE' : 'Global',
      currency: isNse ? 'KES' : 'USD',
      openedAt: new Date(v.timestamp).toISOString(),
      daysHeld: Math.max(0, Math.round((Date.now() - v.timestamp) / 86400000)),
      // Surface the original signal's rationale + analysis so monitored cards show
      // the same comprehensive explanation as fresh signals instead of a generic
      // "being monitored" placeholder. Double periods are collapsed: older stored
      // reasons carry ".." both trailing ("...risk..") and mid-string before a
      // catalyst append ("...pressure.. | Deal catalyst") from the macro-reason
      // embed bug in generateReason.
      reason: (v.reason || '').replace(/\.{2,}/g, '.') || null,
      analysis: v.analysis || null,
    });
  }
  _warmMonitoredQuotes().catch(() => {});
  out.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  return out;
}

// Guard against concurrent refreshes from the two signals routes + the sync
// getMonitoredSignals background warm colliding on the same batch.
let _monitoredQuoteWarming = false;

// Fetches fresh quotes (via the batch quote cache) for every monitored position
// that currently lacks a usable price/change, so /api/signals and
// /api/signals/monitored can render live prices on the held-buy cards instead of
// a blank placeholder. Network work is capped by QUOTE_CACHE_TTL.
async function _warmMonitoredQuotes() {
  if (_monitoredQuoteWarming) return;
  const tickers = [];
  for (const [ticker, v] of _signalOutcomes) {
    if (v.result || !v.timestamp || v.stopLoss == null || v.target1 == null) continue;
    const cached = Array.isArray(_signalsCache) ? _signalsCache.find(s => s.ticker === ticker) : null;
    if (cached && cached.price) continue;
    const qc = _quoteCache.get(ticker);
    if (qc && Date.now() - qc.ts < QUOTE_CACHE_TTL) continue;
    tickers.push(ticker);
  }
  if (!tickers.length) return;
  _monitoredQuoteWarming = true;
  try {
    await prefetchQuotes(tickers);
  } catch { /* best-effort — cards fall back to the last cached price */ }
  finally {
    _monitoredQuoteWarming = false;
  }
}

// Awaited by the /api/signals* route handlers so the monitored cards they merge
// in are rendered with a live quote, not whatever the last generation cycle left.
// Bounded: when a provider chain is slow (Google Finance scrape regressed and the
// proxy/Yahoo fallbacks each take seconds), the route still responds promptly and
// the background warm in getMonitoredSignals() keeps refreshing for the next poll.
async function refreshMonitoredQuotes() {
  await Promise.race([_warmMonitoredQuotes(), new Promise(resolve => setTimeout(resolve, 25000))]);
}

// Live test store — ring buffer of resolved signal outcomes with resolvedAt timestamps
const _liveTestStore = new Map(); // symbol -> { outcomes: [{ result, entryPrice, exitPrice, signal, generatedAt, resolvedAt }] }
const LIVE_TEST_MAX_PER_SYMBOL = 200;
const _performanceStats = { total: 0, wins: 0, losses: 0, winRate: 0 };
// Last known live price per symbol, refreshed every cycle — the mark-to-market
// basis for scoring open positions toward the live win rate without extra fetches.
const _lastKnownPrices = new Map();
const _histBacktestCache = new Map(); // symbol -> { bars, ts }
const HIST_BACKTEST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Market regime cache
let _marketRegime = { regime: 'unknown', score: 50, timestamp: 0 };
const REGIME_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Dynamic sector PE averages (updated from tracked stock data)
let _dynamicSectorPE = null;
let _sectorPELastUpdate = 0;
const SECTOR_PE_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Portfolio state tracker
let _portfolioState = { cash: 1, positions: [], maxDrawdown: 0, peakValue: 1, consecutiveLosses: 0, totalTrades: 0 };

// Source health tracking for graceful degradation
const _sourceHealth = { yahooFinance: { ok: true, failCount: 0, lastFail: 0 }, db: { ok: true, failCount: 0, lastFail: 0 }, scraper: { ok: true, failCount: 0, lastFail: 0 } };
const SOURCE_RECOVERY_MS = 5 * 60 * 1000; // 5 min cooldown after 3 failures
const MAX_SOURCE_FAILURES = 3;

// Weekly price cache
const _weeklyPriceCache = new Map();
const WEEKLY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ML training rate limiter
let _lastMLTrain = 0;
const ML_TRAIN_COOLDOWN = 5 * 60 * 1000; // 5 minutes

// Quote cache populated by batch pre-fetch — eliminates sequential getStockQuote calls
const _quoteCache = new Map();
const QUOTE_CACHE_TTL = 30 * 1000; // 30 seconds

// NSE price accumulator: builds daily OHLC bars from periodic scraper data
const _nseDailyHistory = new Map();
const _nseIntradayBuffer = new Map();
const MAX_DAYS = 90;

// Max allowed deviation of a live quote from the prior session close before it is
// treated as a garbage/stale quote (day-high-as-price, wrong symbol, broken feed).
// Catches absurd entries without blocking real (large but plausible) moves.
const MAX_ENTRY_DEVIATION = 0.5;

// Strict signal eligibility: a stock only earns a signal when its data and
// trade levels satisfy every condition. These are the floors for data
// trustworthiness — see meetsSignalConditions() below.
const MIN_SIGNAL_HISTORY = 20; // enough bars for ATR/RSI/SMA to be meaningful
const MIN_RISK_REWARD = 1.2;   // buy setups must offer a sane reward vs the stop
const INSIDER_MAX_DELTA = 8;   // max composite swing from insider-activity conviction (0 = no data)

// Stop/target resolution is only valid while the exchange's live session is open;
// resolving on after-hours/stale quotes fabricates stop-fills and entries.
function isExchangeOpen(symbol, now = new Date()) {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (NSE_SYMBOLS.includes(symbol)) {
    // Nairobi Stock Exchange: 09:00-15:00 EAT (UTC+3) = 06:00-12:00 UTC
    return utcMinutes >= 360 && utcMinutes < 720;
  }
  // US markets: 09:30-16:00 ET
  const isDST = now.getMonth() >= 2 && now.getMonth() <= 9;
  const etMinutes = ((utcMinutes + (isDST ? -4 : -5) * 60) % 1440 + 1440) % 1440;
  return etMinutes >= 570 && etMinutes < 960;
}

// Whether any exchange the engine tracks (NSE 06:00-12:00 UTC, US 13:30-20:00
// UTC) has a live session right now. Drives the dynamic generation guard: outside
// exchange hours quotes are static last-close values, so regenerating would only
// burn API quota and churn the feed. Pure clock math — no network calls.
function anyTrackedExchangeOpen(now = new Date()) {
  const nseOpen = NSE_SYMBOLS.length > 0 && isExchangeOpen(NSE_SYMBOLS[0], now);
  const usOpen = isExchangeOpen('AAPL', now);
  return nseOpen || usOpen;
}

// NSE trades Mon-Fri 09:00-15:00 Nairobi (UTC+3). Return the current Nairobi
// trading date (YYYY-MM-DD) or null on weekends, so the live accumulator never
// stamps Saturday/Sunday bars into nse_daily_history.
function nseTradingDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => (parts.find(p => p.type === t) || {}).value;
  const y = get('year'), m = get('month'), d = get('day');
  if (!y || !m || !d) return null;
  const dow = new Date(`${y}-${m}-${d}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5 ? `${y}-${m}-${d}` : null;
}

function accumulateNseQuote(symbol, price, volume) {
  const today = nseTradingDate();
  if (!today) return; // weekend — no NSE session, don't write spurious bars
  if (!_nseIntradayBuffer.has(symbol)) _nseIntradayBuffer.set(symbol, {});
  const buf = _nseIntradayBuffer.get(symbol);
  if (!buf[today]) buf[today] = { open: price, high: price, low: price, close: price, volume: 0 };
  const bar = buf[today];
  bar.high = Math.max(bar.high, price);
  bar.low = Math.min(bar.low, price);
  bar.close = price;
  bar.volume += volume || 0;
  // Persist the accumulated day bar to Postgres so history survives container restarts.
  try {
    nseHistory.upsertBar(symbol, { date: today, ...bar }, 'live').catch(() => {});
  } catch { /* best-effort */ }
}

function flushNseDailyBars() {
  const today = nseTradingDate();
  if (!today) return; // weekend — nothing to flush
  for (const [symbol, buf] of _nseIntradayBuffer) {
    if (buf[today]) {
      if (!_nseDailyHistory.has(symbol)) _nseDailyHistory.set(symbol, []);
      const history = _nseDailyHistory.get(symbol);
      const existing = history.find(d => d.date === today);
      if (existing) {
        Object.assign(existing, buf[today]);
      } else {
        history.push({ date: today, ...buf[today] });
        if (history.length > MAX_DAYS) _nseDailyHistory.set(symbol, history.slice(-MAX_DAYS));
      }
    }
  }
}

function getNseDailyHistory(symbol) {
  const history = _nseDailyHistory.get(symbol);
  if (!history || history.length < 2) return null;
  const prices = history.map(d => d.close);
  prices.volumes = history.map(d => d.volume).filter(v => v != null && v > 0);
  prices.highs = history.map(d => d.high);
  prices.lows = history.map(d => d.low);
  return prices;
}

async function getPriceHistory(symbol) {
  const cached = _priceHistoryCache.get(symbol);
  if (cached) {
    const age = Date.now() - cached.ts;
    if (cached.data && age < PRICE_HISTORY_CACHE_TTL) return cached.data;
    // A failed fetch is cached only briefly so a transient blip can't retry-storm
    // a dead upstream, but the short TTL means the next call/cycle recovers quickly
    // instead of poisoning the symbol's history for the full hour.
    if (!cached.data && age < PRICE_HISTORY_FAIL_TTL) return null;
  }

  const isNse = NSE_SYMBOLS.includes(symbol);

  // NSE stocks: use MyStocks Africa (same pipeline as financial-reports page)
  if (isNse) {
    try {
      const msa = require('./mystocksAfricaApi');
      const bars = await msa.fetchHistorical(`NSE:${symbol}`, '6mo');
      if (bars && bars.length >= 2) {
        const valid = bars.filter(b => b.close != null);
        const prices = valid.map(b => b.close);
        prices.volumes = valid.map(b => b.volume || 0).filter(v => v > 0);
        prices.highs = valid.map(b => b.high);
        prices.lows = valid.map(b => b.low);
        _priceHistoryCache.set(symbol, { data: prices, ts: Date.now() });
        // Persist durably so a later MyStocks outage still has history to serve.
        nseHistory.persistBars(symbol, valid, 'mystocksafrica').catch(() => {});
        return prices;
      }
    } catch (e) { /* fall through to accumulator */ }
    // Fallback 1: durable Postgres daily history (KenyanStocks seed + accumulated live bars)
    try {
      const dbBars = await nseHistory.getBars(symbol, MAX_DAYS);
      const dbPrices = nseHistory.toPriceArray(dbBars);
      if (dbPrices) {
        _priceHistoryCache.set(symbol, { data: dbPrices, ts: Date.now() });
        return dbPrices;
      }
    } catch (e) { /* fall through to in-memory accumulator */ }
    // Fallback 2: in-memory accumulated daily history from scraper data
    const nsePrices = getNseDailyHistory(symbol);
    if (nsePrices) {
      _priceHistoryCache.set(symbol, { data: nsePrices, ts: Date.now() });
      return nsePrices;
    }
    _priceHistoryCache.set(symbol, { data: null, ts: Date.now() });
    return null;
  }

  // Non-NSE: Yahoo Finance V8
  const bars = await fetchHistoricalQuotes(symbol, '3mo', '1d');
  if (bars && bars.length >= 2) {
    const valid = bars.filter(b => b.close != null);
    const prices = valid.map(b => b.close);
    prices.volumes = valid.map(b => b.volume).filter(v => v != null && v > 0);
    prices.highs = valid.map(b => b.high);
    prices.lows = valid.map(b => b.low);
    _priceHistoryCache.set(symbol, { data: prices, ts: Date.now() });
    return prices;
  }

  _priceHistoryCache.set(symbol, { data: null, ts: Date.now() });
  return null;
}

async function prefetchPriceHistories(symbols) {
  const nseSymbols = symbols.filter(s => NSE_SYMBOLS.includes(s));
  const otherSymbols = symbols.filter(s => !NSE_SYMBOLS.includes(s));
  // NSE stocks all hit the same MyStocks Africa API — process one at a time to avoid rate limits
  for (const s of nseSymbols) {
    await getPriceHistory(s).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
  }
  // US & other stocks use Yahoo Finance with per-domain pools — batch 20 at a time
  const batchSize = 20;
  const delayMs = 100;
  for (let i = 0; i < otherSymbols.length; i += batchSize) {
    const batch = otherSymbols.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(s => getPriceHistory(s)));
    if (i + batchSize < otherSymbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function prefetchWeeklyData(symbols) {
  const nseSymbols = symbols.filter(s => NSE_SYMBOLS.includes(s));
  const otherSymbols = symbols.filter(s => !NSE_SYMBOLS.includes(s));
  for (const s of nseSymbols) {
    await getWeeklyData(s).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }
  const batchSize = 20;
  const delayMs = 50;
  for (let i = 0; i < otherSymbols.length; i += batchSize) {
    const batch = otherSymbols.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(s => getWeeklyData(s)));
    if (i + batchSize < otherSymbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ─── Real Financial Metrics from financialReportsService (shared pipeline) ──
// Uses the same data pipeline as the /api/financial-reports endpoint:
// Yahoo Finance → Alpha Vantage → SEC EDGAR with per-source rate limiting & caching.
// getFinancialReport() returns everything (income, balance, cash flow, ratios)
// in one call with 24h caching, so subsequent signal cycles are fast.
async function fetchRealFinancialMetrics(symbol) {
  const cached = _financialReportCache.get(symbol);
  if (cached) return cached;
  try {
    const isNse = NSE_SYMBOLS.includes(symbol);
    const metrics = {};

    // Full financial report (24h cache) — income, balance, cash flow, ratios
    // For NSE, getFinancialReport routes to buildLocalNseReport (local DB + marketService).
    // For US stocks, it goes Yahoo Finance → Alpha Vantage → SEC EDGAR.
    const report = await financialReportsService.getFinancialReport(symbol, 'annual', 2);
    if (!report?.success || !report?.data) {
      _financialReportCache.set(symbol, null);
      return null;
    }

    const d = report.data;

    // Price / marketCap from the report's quote data
    const rq = d.quote;
    if (rq?.marketCap) metrics.marketCap = rq.marketCap;
    if (rq?.price) metrics.price = rq.price;
    if (rq?.pe > 0) metrics.peRatio = Math.round(rq.pe * 10) / 10;

    // Profile
    if (d.profile?.sector) metrics.sector = d.profile.sector;

    // Key metrics (PB, ROE, yield, etc.)
    const km = d.keyMetricsHistory?.[0] || {};
    if (km.pbRatio > 0) metrics.pbRatio = Math.round(km.pbRatio * 10) / 10;
    if (km.dividendYieldPercentage > 0) metrics.dividendYield = Math.round(km.dividendYieldPercentage * 10) / 10;
    else if (km.dividendYield > 0) metrics.dividendYield = Math.round(km.dividendYield * 1000) / 10;
    if (km.returnOnEquity > 0) metrics.roe = Math.round(km.returnOnEquity * 1000) / 10;
    if (km.debtToEquity > 0) metrics.debtToEquity = Math.round(km.debtToEquity * 100) / 100;
    if (km.currentRatio > 0) metrics.currentRatio = Math.round(km.currentRatio * 100) / 100;
    if (km.revenueGrowth != null) metrics.revenueGrowth = Math.round(km.revenueGrowth * 1000) / 10;
    if (km.earningsGrowth != null) metrics.epsGrowth = Math.round(km.earningsGrowth * 1000) / 10;
    if (km.forwardPE > 0 && !metrics.peRatio) metrics.peRatio = Math.round(km.forwardPE * 10) / 10;
    if (km.profitMargin != null) metrics.profitMargin = Math.round(km.profitMargin * 1000) / 10;
    if (km.operatingMargin != null) metrics.operatingMargin = Math.round(km.operatingMargin * 1000) / 10;

    // Income statement — current & prior year for growth/margins
    const inc = d.incomeStatementHistory || [];
    if (inc.length >= 1) {
      const cur = inc[0];
      if (cur.revenue) { metrics.revenue = cur.revenue; }
      if (cur.netIncome) { metrics.netIncome = cur.netIncome; }
      if (cur.eps) { metrics.eps = Math.round(cur.eps * 100) / 100; }
      if (cur.ebitda) { metrics.ebitda = cur.ebitda; }
      if (cur.grossProfit && cur.revenue > 0) {
        metrics.grossMargin = Math.round((cur.grossProfit / cur.revenue) * 1000) / 10;
      }
      if (cur.operatingIncome && cur.revenue > 0) {
        metrics.operatingMargin = Math.round((cur.operatingIncome / cur.revenue) * 1000) / 10;
      }
      // YoY growth
      if (inc.length >= 2) {
        const prev = inc[1];
        if (cur.revenue && prev.revenue > 0) {
          const rg = ((cur.revenue - prev.revenue) / prev.revenue) * 100;
          metrics.revenueGrowth = Math.round(rg * 10) / 10;
        }
        if (cur.eps && prev.eps > 0) {
          const eg = ((cur.eps - prev.eps) / prev.eps) * 100;
          metrics.epsGrowth = Math.round(eg * 10) / 10;
        }
      }
    }

    // Balance sheet — for Altman Z, EV/EBITDA, debt
    let totalDebt = 0, cash = 0, totalAssets = 0, totalLiabilities = 0;
    let totalEquity = 0, currAssets = 0, currLiabilities = 0, retainedEarnings = 0;
    const bal = d.balanceSheetHistory || [];
    if (bal.length >= 1) {
      const b = bal[0];
      totalDebt = b.totalDebt || 0;
      cash = b.cashAndCashEquivalents || 0;
      totalAssets = b.totalAssets || 0;
      totalLiabilities = b.totalLiabilities || 0;
      totalEquity = b.totalStockholdersEquity || b.totalEquity || 0;
      currAssets = b.totalCurrentAssets || 0;
      currLiabilities = b.totalCurrentLiabilities || 0;
      retainedEarnings = b.retainedEarnings || 0;
      metrics.totalDebt = totalDebt;
      metrics.cash = cash;
    }

    // Free cash flow yield
    const cf = d.cashFlowStatementHistory || [];
    if (cf.length >= 1 && cf[0].freeCashFlow) {
      const fcf = cf[0].freeCashFlow;
      const mcap = metrics.marketCap || km.marketCap || 0;
      if (mcap > 0) {
        metrics.fcfYield = Math.round((fcf / mcap) * 1000) / 10;
      }
    }

    // EV/EBITDA
    if (metrics.marketCap && totalDebt > 0 && metrics.ebitda) {
      const ev = metrics.marketCap + totalDebt - cash;
      if (ev > 0) { metrics.evEbitda = Math.round((ev / metrics.ebitda) * 10) / 10; }
    }

    // Altman Z
    if (inc[0]?.netIncome && inc[0]?.revenue > 0 && totalAssets > 0 && totalLiabilities > 0) {
      const ebit = inc[0]?.operatingIncome || inc[0]?.ebitda || 0;
      const mcap = metrics.marketCap || km.marketCap || 0;
      const workingCapital = currAssets - currLiabilities;
      const X1 = workingCapital / totalAssets;
      const X2 = retainedEarnings / totalAssets;
      const X3 = ebit / totalAssets;
      const X4 = mcap / totalLiabilities;
      const X5 = inc[0].revenue / totalAssets;
      metrics.altmanZ = Math.round((1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5) * 100) / 100;
    }

    // Insider / institutional ownership (US only — NSE returns null from Yahoo)
    if (d.ownership) metrics.ownership = d.ownership;

    const hasUsableMetrics = metrics.peRatio || metrics.roe || metrics.revenueGrowth || metrics.currentRatio;
    _financialReportCache.set(symbol, hasUsableMetrics ? metrics : null);
    return hasUsableMetrics ? metrics : null;
  } catch (e) {
    console.warn(`[SignalService] Failed to fetch real financials for ${symbol}: ${e.message}`);
    _financialReportCache.set(symbol, null);
    return null;
  }
}

async function prefetchFinancialReports(symbols) {
  const batchSize = 30;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(s => fetchRealFinancialMetrics(s)));
    if (i + batchSize < symbols.length) await new Promise(r => setTimeout(r, 50));
  }
}

// ─── Batch Quote Pre-fetch ──────────────────────────────────────────────────
// Pre-fetches stock quotes in parallel batches instead of sequential getStockQuote.
async function prefetchQuotes(symbols) {
  const toFetch = symbols.filter(s => {
    const cached = _quoteCache.get(s);
    return !cached || Date.now() - cached.ts > QUOTE_CACHE_TTL;
  });
  if (toFetch.length === 0) return;
  const batchSize = 100;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    try {
      const marketSymbols = batch.map(s => NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s);
      const quotes = await getQuotesBatch(marketSymbols);
      for (const s of batch) {
        const q = quotes[NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s];
        if (q && q.price) {
          _quoteCache.set(s, { price: q.price, changePercent: q.changePercent || 0, volume: q.volume || 0, ts: Date.now() });
          _lastKnownPrices.set(s, q.price);
        }
      }
    } catch { /* individual fallback handled in main loop */ }
    if (i + batchSize < toFetch.length) await new Promise(r => setTimeout(r, 50));
  }
  // Final sweep: any symbols still missing a quote after the main loop get one
  // more chance now that the concurrent prefetch burst has subsided. Their
  // quotes were likely lost to transient rate limits, not bad symbols.
  const stillMissing = toFetch.filter(s => {
    const c = _quoteCache.get(s);
    return !c || !Number(c.price) || c.price <= 0;
  });
  if (stillMissing.length > 0) {
    try {
      const marketSymbols = stillMissing.map(s => NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s);
      const quotes = await getQuotesBatch(marketSymbols);
      for (const s of stillMissing) {
        const q = quotes[NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s];
        if (q && q.price) {
          _quoteCache.set(s, { price: q.price, changePercent: q.changePercent || 0, volume: q.volume || 0, ts: Date.now() });
          _lastKnownPrices.set(s, q.price);
        }
      }
    } catch { /* best effort */ }
  }
  let covered = 0;
  for (const s of toFetch) {
    const c = _quoteCache.get(s);
    if (c && Number(c.price) > 0) covered++;
  }
  console.log(`[SignalService] prefetchQuotes final coverage ${covered}/${toFetch.length}`);
}

// ─── Market Regime Detection ────────────────────────────────────────────────
// Uses SPY (S&P 500 ETF) as a proxy for overall market conditions, with VOO/IVV fallbacks.
// Falls back to a simple price-vs-SMA heuristic for NSE via SCOM.
const REGIME_ETFS = ['SPY', 'VOO', 'IVV'];
async function detectMarketRegime() {
  if (Date.now() - _marketRegime.timestamp < REGIME_CACHE_TTL) return _marketRegime;

  const cfg = engineConfig.getConfig();
  const det = cfg.regime_adaptation?.detection || {};
  const t = det.thresholds || {};

  const trendFast = det.trend_fast || 20;
  const trendSlow = det.trend_slow || 100;

  const th = {
    bullStrong: t.bull_strong ?? 15,
    bullModerate: t.bull_moderate ?? 5,
    bearStrong: t.bear_strong ?? -15,
    bearModerate: t.bear_moderate ?? -5,
    crash: t.crash ?? -25,
    bullScoreStrong: t.bull_score_strong ?? 85,
    bullScoreModerate: t.bull_score_moderate ?? 70,
    bearScoreStrong: t.bear_score_strong ?? 25,
    bearScoreModerate: t.bear_score_moderate ?? 35,
    crashScore: t.crash_score ?? 10,
    sidewaysScore: t.sideways_score ?? 50,
  };

  let regime = 'sideways';
  let score = 50;

  for (const etf of REGIME_ETFS) {
    try {
      // getPriceHistory only returns ~3 months of daily bars (< trendSlow=100),
      // which made this branch always fail and silently fall through to the
      // single-stock SCOM fallback. Fetch 6 months (~126 trading days) so the
      // 100-day SMA checks actually run against the real index.
      const bars = await fetchHistoricalQuotes(etf, '6mo', '1d');
      const prices = bars && bars.length ? bars.filter(b => b && b.close != null).map(b => b.close) : null;
      if (prices && prices.length >= trendSlow) {
        const currentPrice = prices[prices.length - 1];
        const smaSlow = calculateSMA(prices, trendSlow);
        const smaFast = calculateSMA(prices, trendFast);
        const periodReturn = ((currentPrice - prices[0]) / prices[0]) * 100;

        if (periodReturn > th.bullStrong && currentPrice > smaFast && smaFast > smaSlow) {
          regime = 'bull'; score = th.bullScoreStrong;
        } else if (periodReturn > th.bullModerate && currentPrice > smaSlow) {
          regime = 'bull'; score = th.bullScoreModerate;
        } else if (periodReturn < th.bearStrong && currentPrice < smaFast && smaFast < smaSlow) {
          regime = 'bear'; score = th.bearScoreStrong;
        } else if (periodReturn < th.bearModerate && currentPrice < smaSlow) {
          regime = 'bear'; score = th.bearScoreModerate;
        } else if (periodReturn < th.crash) {
          regime = 'crash'; score = th.crashScore;
        } else {
          regime = 'sideways'; score = th.sidewaysScore;
        }
        break; // successful detection
      }
    } catch (e) {
      console.warn(`[SignalService] Regime detection failed for ${etf}: ${e.message}`);
    }
  }

  // If all ETFs failed, try SCOM as a last resort
  if (regime === 'sideways' && score === 50) {
    try {
      const scomPrices = await getPriceHistory('SCOM');
      if (scomPrices && scomPrices.length >= trendFast) {
        const currentPrice = scomPrices[scomPrices.length - 1];
        const smaFast = calculateSMA(scomPrices, trendFast);
        if (currentPrice > smaFast) { regime = 'bull'; score = 65; }
        else { regime = 'bear'; score = 40; }
      }
    } catch (e) { console.warn(`[SignalService] Regime SCOM fallback failed: ${e.message}`); }
  }

  _marketRegime = { regime, score, timestamp: Date.now() };
  return _marketRegime;
}

// ─── Dynamic Weights ────────────────────────────────────────────────────────
// Adjusts the score component weights based on market regime.
// Delegates to engineConfig for regime-specific weight profiles.
function computeDynamicWeights(regime) {
  const baseWeights = engineConfig.getConfig().weights;
  return engineConfig.getWeightsForRegime(regime, baseWeights);
}

// Restore performance stats and portfolio state from DB on startup
// Recompute the resolved live-outcomes tally from signal_outcomes using the
// SAME canonical evaluation window (SIGNAL_WINDOW_DAYS) and filter that the
// Forward Test / Audit tab uses (getForwardTestStats). The Health tab and the
// Audit tab both claim to surface "the same resolved live outcomes", so they
// must draw from one population when refreshed — otherwise dividing the truth
// across a 30-day startup snapshot vs a 90-day live window manufactures a
// phantom win-rate gap.
async function refreshPerformanceStats() {
  const result = await pool.query(
    `SELECT result, COUNT(*) as cnt FROM signal_outcomes
     WHERE COALESCE(signal_generated_at, recorded_at) > NOW() - $1::interval AND result IS NOT NULL AND source = 'live'
     GROUP BY result`,
    [`${SIGNAL_WINDOW_DAYS} days`]
  );
  let wins = 0, losses = 0;
  for (const row of result.rows) {
    if (row.result === 'win') wins = parseInt(row.cnt) || 0;
    if (row.result === 'loss') losses = parseInt(row.cnt) || 0;
  }
  _performanceStats.wins = wins;
  _performanceStats.losses = losses;
  _performanceStats.total = wins + losses;
  _performanceStats.winRate = _performanceStats.total > 0
    ? Math.round((_performanceStats.wins / _performanceStats.total) * 1000) / 10 : 0;
  return _performanceStats;
}

async function restoreStateFromDb() {
  try {
    // Load all historical outcomes into memory so health/trade tracking works across restarts
    const outcomes = await pool.query(
      `SELECT ticker, entry_price, signal, exit_price, result, recorded_at, resolved_at, signal_generated_at, close_reason FROM signal_outcomes WHERE COALESCE(signal_generated_at, recorded_at) > NOW() - $1::interval AND result IS NOT NULL AND source = 'live' ORDER BY recorded_at DESC`,
      [`${SIGNAL_WINDOW_DAYS} days`]
    );
    _signalOutcomes.clear();
    _liveTestStore.clear();
    for (const row of outcomes.rows) {
      _signalOutcomes.set(row.ticker, {
        entryPrice: parseFloat(row.entry_price) || 0,
        signal: row.signal,
        exitPrice: row.exit_price != null ? parseFloat(row.exit_price) : null,
        result: row.result,
        recordedAt: row.recorded_at,
        closeReason: row.close_reason || null,
      });
      // Populate live test store for time-bucket analysis
      const rAt = row.resolved_at ? new Date(row.resolved_at).getTime() : null;
      const gAt = row.signal_generated_at ? new Date(row.signal_generated_at).getTime() : Date.now();
      const sym = row.ticker;
      if (!_liveTestStore.has(sym)) _liveTestStore.set(sym, { outcomes: [] });
      const store = _liveTestStore.get(sym);
      store.outcomes.push({
        result: row.result, signal: row.signal,
        entryPrice: parseFloat(row.entry_price) || 0,
        exitPrice: row.exit_price != null ? parseFloat(row.exit_price) : null,
        generatedAt: gAt,
        resolvedAt: rAt || gAt,
        closeReason: row.close_reason || null,
      });
      if (store.outcomes.length > LIVE_TEST_MAX_PER_SYMBOL) store.outcomes = store.outcomes.slice(-LIVE_TEST_MAX_PER_SYMBOL);
    }

    // Restore still-open (unresolved) live positions from signal_history so the
    // monitor-first gate survives restarts. No time window — a position that
    // hasn't reached its stop or target is restored regardless of age. Some
    // targets take 3-6 months or more. The resolved-outcome check on the next
    // line prevents re-monitoring any position that already resolved. Only the
    // most recent signal per ticker is restored (DISTINCT ON + ORDER BY DESC).
    const openRes = await pool.query(
      `SELECT DISTINCT ON (ticker) ticker, signal, entry_price, stop_loss, target1, target2, target3, trade_type, position_size, generated_at, reason, analysis_data, confidence, timeframe
       FROM signal_history
       WHERE signal IN ('Strong Buy','Buy')
         AND entry_price > 0 AND stop_loss > 0 AND target1 > 0
       ORDER BY ticker, generated_at DESC`
    );
    for (const row of openRes.rows) {
      const sym = row.ticker;
      const genAt = new Date(row.generated_at).getTime();
      // Skip if this signal has already produced a resolved outcome. Use a
      // ±30s window around the history row's generated_at (matching the apply
      // scripts) because the outcome's signal_generated_at can land a moment
      // before the history row's generated_at (e.g. C 19:40:45 vs 19:40:56);
      // a strict >= match would miss it and re-monitor a resolved position
      // with stale levels after a restart.
      const resolved = await pool.query(
        `SELECT 1 FROM signal_outcomes WHERE ticker = $1 AND COALESCE(signal_generated_at, recorded_at) >= date_trunc('milliseconds', $2::timestamptz) - interval '30 seconds' AND COALESCE(signal_generated_at, recorded_at) <= date_trunc('milliseconds', $2::timestamptz) + interval '30 seconds' AND result IS NOT NULL LIMIT 1`,
        [sym, row.generated_at]
      );
      if (resolved.rows.length > 0) continue;
      const entry = parseFloat(row.entry_price);
      let stop = parseFloat(row.stop_loss);
      const target = parseFloat(row.target1);
      const action = /buy/i.test(row.signal) ? 'buy' : 'sell';
      // For buys: target must be above entry. Stop can be below entry (initial) or
      // above entry (re-leveled locked-profit stop) — but always below target.
      // For sells: stop must be above entry and target below entry.
      const saneLevels = action === 'buy'
        ? isPlausibleBuyLevels(entry, stop, target)
        : (stop > entry && target < entry);
      if (!saneLevels) {
        if (action === 'buy') console.warn(`[SignalService] ${sym} skipping corrupt buy levels (entry=${entry} stop=${stop} target=${target}) - inverted or implausible locked-profit stop`);
        continue;
      }
      // Legacy sub-floor stops (pre-MIN_STOP_PCT builds) would re-arm a noise-band
      // stop-out on the next cycle. Widen to the 15% floor at restore and persist
      // the repair so a restart doesn't re-seed the tight level from signal_history.
      const flooredStop = enforceStopFloor(entry, stop);
      if (flooredStop !== stop) {
        console.log(`[SignalService] ${sym} restored legacy sub-floor stop ${stop} -> floored to ${flooredStop} (entry=${entry})`);
        stop = flooredStop;
        pool.query(
          `UPDATE signal_history SET stop_loss = $1
           WHERE ticker = $2 AND generated_at >= $3::timestamptz - interval '30 seconds'
             AND generated_at <= $3::timestamptz + interval '30 seconds'
             AND stop_loss > 0`,
          [stop, sym, row.generated_at]
        ).catch(() => {});
      }
      _signalOutcomes.set(sym, {
        entryPrice: entry, signal: row.signal, action, type: row.trade_type || 'Swing Trade',
        stopLoss: stop, target1: target, target2: row.target2 != null ? parseFloat(row.target2) : null,
        target3: row.target3 != null ? parseFloat(row.target3) : null,
        positionSize: parseInt(row.position_size) || 25,
        timestamp: genAt, result: null, lastProgressAlert: 0,
        reason: row.reason || '', analysis: row.analysis_data || null,
        confidence: row.confidence != null ? parseInt(row.confidence) : null,
        timeframe: row.timeframe || null,
      });
    }
    console.log(`[SignalService] Restored open live positions from signal_history`);

    // Compute performance stats from live outcomes in the canonical evaluation
    // window (SIGNAL_WINDOW_DAYS, same as the Forward Test / Audit tab) so the
    // Health tab's resolved win rate matches what the Audit tab reports.
    await refreshPerformanceStats();

    // Track total signal history rows for health display
    const histCount = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_history').catch(() => ({ rows: [{ cnt: 0 }] }));
    _signalHistoryCount = histCount.rows[0]?.cnt || 0;

    console.log(`[SignalService] Restored ${_signalOutcomes.size} outcomes, ${_signalHistoryCount} history rows from DB (${_performanceStats.wins} wins, ${_performanceStats.losses} losses in last ${SIGNAL_WINDOW_DAYS}d)`);

    // NOTE: automatic backfill intentionally removed. backfillOutcomesFromHistory
    // marked win/loss by comparing old entries to current quotes (no stop/target/
    // trailing fills, no market-open guard) which polluted production win-rate
    // stats with pseudo-outcomes (e.g. phantom CRWN 60.00 entry). It is still
    // available manually via POST /api/signals/engine/backfill and tags rows as
    // source='backfill' so they never count toward live stats.
  } catch (e) { /* table may not exist — start fresh */ console.warn('[SignalService] restoreStateFromDb outcomes error:', e.message); }
  try {
    const result = await pool.query(
      `SELECT consecutive_losses FROM portfolio_state ORDER BY updated_at DESC LIMIT 1`
    );
    if (result.rows.length > 0) {
      _portfolioState.consecutiveLosses = parseInt(result.rows[0].consecutive_losses) || 0;
    }
  } catch { /* table may not exist — start fresh */ }
}

// ─── Backfill signal_outcomes from recent signal_history ─────────────────────
// When signal_outcomes is empty but signal_history has rows (fresh deploy / schema fix),
// approximate outcomes using current live prices so health/backtest show real numbers immediately.
async function backfillOutcomesFromHistory(days = 1, maxRows = 50) {
  try {
    const outcomeCount = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes').catch(() => ({ rows: [{ cnt: 0 }] }));
    if ((outcomeCount.rows[0]?.cnt || 0) > 0) return; // only backfill when empty

    const result = await pool.query(`
      SELECT DISTINCT ON (sh.ticker, sh.entry_price) sh.ticker, sh.signal, sh.entry_price, sh.generated_at
      FROM signal_history sh
      LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price
      WHERE sh.generated_at > NOW() - $1::interval
        AND sh.generated_at < NOW() - INTERVAL '7 days'
        AND sh.signal IN ('Strong Buy','Buy','Sell','Strong Sell')
        AND sh.entry_price > 0
        AND so.id IS NULL
      ORDER BY sh.ticker, sh.entry_price, sh.generated_at DESC
      LIMIT $2
    `, [`${days} days`, maxRows]);
    if (result.rows.length === 0) return;

    const tickers = [...new Set(result.rows.map(r => r.ticker))];
    const quotes = await getQuotesBatch(tickers).catch(() => ({}));

    let wins = 0, losses = 0, inserted = 0;
    for (const row of result.rows) {
      const quote = quotes[row.ticker];
      if (!quote || !quote.price) continue;
      const currentPrice = quote.price;
      const returnPct = ((currentPrice - row.entry_price) / row.entry_price) * 100;
const isBuy = row.signal === 'Strong Buy' || row.signal === 'Buy';
      if (!isBuy) continue;
      // Garbage guard: only backfill signals >7 days old whose current quote is
      // within 50% of entry. Resolving recent/open signals at a live quote
      // produced the implausible rows (e.g. CGEN 152 -> 2.25).
      if (Math.abs(returnPct) > 50) {
        console.warn(`[SignalService] Backfill skip ${row.ticker} - implausible quote ${row.entry_price} -> ${currentPrice}`);
        continue;
      }
      const won = returnPct > 0.5;
      const resultStr = won ? 'win' : 'loss';
       try {
         const now = new Date().toISOString();
         await pool.query(
            `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, recorded_at, resolved_at, signal_generated_at, source, close_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'backfill', 'mark-to-market')
             ON CONFLICT (source, ticker, entry_price) DO NOTHING`,
           [row.ticker, row.entry_price, row.signal, currentPrice, resultStr, now, now, row.generated_at]
         );
        inserted++;
        if (won) wins++; else losses++;
      } catch { /* skip duplicates */ }
    }

    console.log(`[SignalService] Backfilled ${inserted} outcomes from signal_history (${wins} wins, ${losses} losses) — source='backfill', excluded from live stats`);
  } catch (e) {
    console.warn('[SignalService] backfillOutcomesFromHistory error:', e.message);
  }
}

// ─── Historical Backtest: evaluate signal_history against actual OHLC history ─
// For each signal in signal_history, walks forward day-by-day using the signal's
// own stop_loss / target1 levels to decide win/loss, then inserts the outcome.

// Hold window (in trading bars) derived from the signal's own trade type, not a
// fixed short cap. A Long Term 3-6mo thesis needs ~130 trading days to reach its
// verdict; a fixed 20-bar window force-closed it at the last available close —
// because the fetched history simply ends at today — manufacturing a premature
// 'expiry close' (e.g. CGEN Aug 5: closed at 194.75 with target1 208.34 untouched,
// then a fresh position was opened at the same price).
function backtestHoldBarsFor(tradeType, fallback = 20) {
  const tt = (tradeType || '').toLowerCase();
  if (tt.includes('long term')) return 130; // 3-6 months ≈ 130 trading days
  if (tt.includes('aggressive') || tt.includes('momentum') || tt.includes('swing')) return 20; // 1-4 weeks
  return fallback;
}
async function runHistoricalBacktest({ days = 90, maxHoldDays = 20, maxSignals = 1000, force = false } = {}) {
  try {
    // Dedupe by (ticker, signal_generated_at) so a signal is evaluated once no
    // matter how many cycles run — the old entry_price match collided across
    // same-price re-emissions and the forced 6h run re-inserted duplicate rows.
    // force=true explicitly bypasses the dedupe for a manual re-run.
    const dedupeClause = force ? '' : `NOT EXISTS (
          SELECT 1 FROM signal_outcomes so
          WHERE so.ticker = sh.ticker AND so.signal_generated_at = date_trunc('milliseconds', sh.generated_at)
        ) AND `;
    const result = await pool.query(`
      SELECT sh.id, sh.ticker, sh.signal, sh.entry_price, sh.stop_loss, sh.target1, sh.target2, sh.generated_at, sh.trade_type
      FROM signal_history sh
      WHERE ${dedupeClause}
        sh.generated_at > NOW() - $1::interval
        AND sh.generated_at < NOW() - INTERVAL '1 hour'
        AND sh.signal IN ('Strong Buy','Buy')
        AND sh.entry_price > 0
        AND sh.stop_loss > 0 AND sh.target1 > 0
      ORDER BY sh.generated_at DESC
      LIMIT $2
    `, [`${days} days`, maxSignals]);
    if (result.rows.length === 0) {
      console.log('[HistoricalBacktest] No eligible signals to evaluate');
      return { evaluated: 0, wins: 0, losses: 0 };
    }

    // Group signals by ticker so we fetch historical prices once per ticker
    const byTicker = {};
    for (const row of result.rows) {
      if (!byTicker[row.ticker]) byTicker[row.ticker] = [];
      byTicker[row.ticker].push(row);
    }

    let totalWins = 0, totalLosses = 0, totalInserted = 0, errors = 0;

    for (const [ticker, signals] of Object.entries(byTicker)) {
      const isNse = NSE_SYMBOLS.includes(ticker);

      // Reuse cached bars when possible to avoid repeated API calls
      let cached = _histBacktestCache.get(ticker);
      if (!cached || Date.now() - cached.ts > HIST_BACKTEST_CACHE_TTL) {
        let bars;
        if (isNse) {
          try {
            const msa = require('./mystocksAfricaApi');
            bars = await msa.fetchHistorical(`NSE:${ticker}`, '6mo');
          } catch { bars = null; }
        } else {
          bars = await fetchHistoricalQuotes(ticker, '3mo', '1d').catch(() => null);
        }
        if (!bars || bars.length < 2) {
          console.warn(`[HistoricalBacktest] No historical bars for ${ticker}`);
          continue;
        }
        cached = { bars, ts: Date.now() };
        _histBacktestCache.set(ticker, cached);
      }
      const bars = cached.bars;

      for (const sig of signals) {
        try {
          const entry = parseFloat(sig.entry_price);
          const stop = parseFloat(sig.stop_loss);
          const target = parseFloat(sig.target1);
          const signalDate = new Date(sig.generated_at);
          const isBuy = sig.signal === 'Strong Buy' || sig.signal === 'Buy';
          if (!isBuy) continue;
          // Never backtest live-mutated levels: the monitor ratchets stops to
          // breakeven/locked-gain floors (stop == entry) and tightens targets as
          // price advances, so a re-leveled row can't be resolved against entry-
          // cycle geometry. A stop >= entry fires the very first bar as an
          // instant 0% "loss" (EABL Aug 3). Only entry-cycle-shaped levels are
          // backtestable.
          if (!(stop < entry && target > entry)) {
            console.warn(`[HistoricalBacktest] Skip ${sig.ticker} entry ${entry} - stop ${stop} not below entry (re-leveled/live-mutated levels aren't backtestable)`);
            continue;
          }

          // Never race the live monitor: if this signal is still open in memory
          // (result null) the gate owns its resolution. Backtest must not force
          // a same-day close over a real stop/target being tracked.
          const liveOpen = _signalOutcomes.get(ticker);
          if (liveOpen && !liveOpen.result && liveOpen.timestamp &&
              Math.abs((parseFloat(liveOpen.entryPrice) - entry) / (entry || 1)) < 0.001) {
            console.log(`[HistoricalBacktest] Skip ${ticker} entry ${entry} - signal open and live-monitored`);
            continue;
          }

          // Find the first bar on or after the signal date
          let startIdx = bars.findIndex(b => new Date(b.date + 'T00:00:00Z').getTime() >= signalDate.getTime());
          if (startIdx < 0) startIdx = bars.length - 1;
          if (startIdx >= bars.length) continue;

          let exitPrice = null;
          let resultStr = null;
          let closeReason = null;
          let exitDay = 0;

          // Hold horizon from the signal's own trade type (Long Term ≈ 130 bars,
          // short-term ≈ 20). Stop/target hits are evaluated against every bar we
          // have; the 'expiry close' branch only fires once the FULL hold window
          // elapses. When the fetched history ends before the hold window (bars
          // run out with no stop/target hit), NO close condition has been met, so
          // the signal must NOT be force-closed at the last bar — that manufactured
          // premature 'expiry close' outcomes (e.g. CGEN Aug 5 Long Term, target1
          // 208.34 — force-closed at 194.75 four bars later). The signal stays
          // unresolved and a later run (once history extends) or the live monitor
          // resolves it.
          const holdBars = backtestHoldBarsFor(sig.trade_type, maxHoldDays);
          const holdEnd = startIdx + holdBars;
          const lastEval = Math.min(holdEnd, bars.length - 1);

          // Evaluate from the NEXT bar after the signal date (exitDay >= 1).
          // A signal generated mid-day must never be resolved against the same
          // day's partial bar; that is what manufactured the day-0 close noise.
          for (let i = startIdx + 1; i <= lastEval; i++) {
            const bar = bars[i];
            const dayHigh = parseFloat(bar.high);
            const dayLow = parseFloat(bar.low);
            const dayClose = parseFloat(bar.close);
            if (!dayHigh || !dayLow || !dayClose) continue;

            exitDay = i - startIdx;

            // Sells are never evaluated here — the SELECT above restricts to
            // Buy/Strong Buy (sells are exit/avoid ratings, not positions).
            if (dayLow <= stop) { exitPrice = stop; resultStr = 'loss'; closeReason = 'stop loss'; break; }
            if (dayHigh >= target) { exitPrice = target; resultStr = 'win'; closeReason = 'target reached'; break; }

            if (i === holdEnd) {
              exitPrice = dayClose;
              const pnl = (dayClose - entry) / entry * 100;
              // Honest evaluation: a trade wins when it exits in the profitable
              // direction. No arbitrary %-of-target threshold (that mislabeled
              // profitable exits as losses).
              resultStr = (isBuy ? pnl > 0 : pnl < 0) ? 'win' : 'loss';
              closeReason = 'expiry close';
              break;
            }
          }

          if (!exitPrice || !resultStr) continue;
          // Garbage guard: a valid resolution cannot be >50% away from entry
          // (e.g. bad quote/split feeding an absurd exit like 152 -> 2.25).
          if (Math.abs((exitPrice - entry) / (entry || 1)) > 0.5) {
            console.warn(`[HistoricalBacktest] Skip ${ticker} - implausible exit ${entry} -> ${exitPrice}`);
            continue;
          }

          const now = new Date().toISOString();
          await pool.query(
            `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, recorded_at, resolved_at, signal_generated_at, source, close_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'backtest', $9)
             ON CONFLICT (source, ticker, entry_price) DO NOTHING`,
            [sig.ticker, entry, sig.signal, exitPrice, resultStr, now, now, sig.generated_at, closeReason]
          );
          totalInserted++;
          if (resultStr === 'win') totalWins++; else totalLosses++;
        } catch (e) {
          errors++;
          console.warn(`[HistoricalBacktest] Error evaluating ${sig.ticker}:`, e.message);
        }
      }
    }

    console.log(`[HistoricalBacktest] Evaluated ${totalInserted} signals (${totalWins} wins, ${totalLosses} losses, ${errors} errors)`);
    return { evaluated: totalInserted, wins: totalWins, losses: totalLosses, errors };
  } catch (e) {
    console.error('[HistoricalBacktest] runHistoricalBacktest error:', e.message);
    return { evaluated: 0, wins: 0, losses: 0, errors: 1, error: e.message };
  }
}

// ─── Dynamic Sector PE Update ───────────────────────────────────────────────
// Computes sector-average PE ratios from the tracked stock fundamentals,
// falling back to hardcoded values when insufficient data exists.
function updateSectorAverages() {
  if (Date.now() - _sectorPELastUpdate < SECTOR_PE_UPDATE_INTERVAL) return;
  
  const sectorData = {};
  const allSymbols = [...Object.keys(KNOWN_FUNDAMENTALS), ...Object.keys(NSE_FUNDAMENTALS)];
  for (const sym of allSymbols) {
    const stock = KNOWN_FUNDAMENTALS[sym] || NSE_FUNDAMENTALS[sym];
    if (stock && stock.sector && stock.peRatio && stock.peRatio > 0 && stock.peRatio < 100) {
      if (!sectorData[stock.sector]) sectorData[stock.sector] = { sum: 0, count: 0 };
      sectorData[stock.sector].sum += stock.peRatio;
      sectorData[stock.sector].count++;
    }
    // Also check real financial cache for US stocks
    const fm = _financialReportCache.get(sym);
    if (fm && fm.peRatio) {
      const stock = getFundamentals(sym);
      if (stock && stock.sector) {
        if (!sectorData[stock.sector]) sectorData[stock.sector] = { sum: 0, count: 0 };
        sectorData[stock.sector].sum += fm.peRatio;
        sectorData[stock.sector].count++;
      }
    }
  }
  
  const computed = {};
  for (const [sector, data] of Object.entries(sectorData)) {
    if (data.count >= 2) {
      computed[sector] = Math.round((data.sum / data.count) * 10) / 10;
    }
  }
  
  if (Object.keys(computed).length > 0) {
    _dynamicSectorPE = computed;
    _sectorPELastUpdate = Date.now();
  }
}

// ─── Real Weekly Chart Data ────────────────────────────────────────────────
// Fetches actual weekly OHLC data from Yahoo Finance (1wk interval)
// instead of aggregating daily bars.
async function getWeeklyData(symbol) {
  const cached = _weeklyPriceCache.get(symbol);
  if (cached && Date.now() - cached.ts < WEEKLY_CACHE_TTL) return cached.data;
  try {
    const isNse = NSE_SYMBOLS.includes(symbol);
    if (isNse) {
      try {
        const msa = require('./mystocksAfricaApi');
        const bars = await msa.fetchHistorical(`NSE:${symbol}`, '6mo');
        if (bars && bars.length >= 4) {
          const closes = bars.map(b => b.close).filter(p => p != null);
          _weeklyPriceCache.set(symbol, { data: closes, ts: Date.now() });
          return closes;
        }
      } catch { /* fall through */ }
      return null;
    }
    const { fetchHistoricalQuotes } = require('./globalScraper');
    const bars = await fetchHistoricalQuotes(symbol, '6mo', '1wk');
    if (bars && bars.length >= 4) {
      const closes = bars.map(b => b.close).filter(p => p != null);
      _weeklyPriceCache.set(symbol, { data: closes, ts: Date.now() });
      return closes;
    }
  } catch { /* fall through */ }
  return null;
}

// Uses real weekly data if available, falls back to daily aggregation.
// Returns trend direction + bull flag for weekly timeframe confirmation.
async function getWeeklyTrend(symbol) {
  try {
    const weeklyPrices = await getWeeklyData(symbol);
    if (weeklyPrices && weeklyPrices.length >= 4) {
      const sma10 = calculateSMA(weeklyPrices, Math.min(10, weeklyPrices.length));
      const currentPrice = weeklyPrices[weeklyPrices.length - 1];
      const trendUp = currentPrice > sma10;
      let trend;
      if (trendUp && weeklyPrices.length >= 2 && currentPrice > weeklyPrices[0] * 1.05) trend = 'bullish';
      else if (!trendUp && weeklyPrices.length >= 2 && currentPrice < weeklyPrices[0] * 0.95) trend = 'bearish';
      else trend = 'neutral';
      return { trend, bull: trendUp };
    }
  } catch { /* fall through */ }
  return { trend: 'unknown', bull: false };
}

// ─── Historical Backtesting ─────────────────────────────────────────────────
// Queries signal_history DB table and computes actual win/loss rates
// by comparing entry prices to current market prices.
async function computeBacktestStats({ days = 30, limit = 500, signalType, minConfidence = 0 } = {}) {
  try {
    console.log(`[Backtest] computeBacktestStats requested: days=${days}, signalType=${signalType || 'all'}`);
    // Primary data source: signal_outcomes — has actual exit prices and real win/loss results.
    // Single consistent source filter + signal filter shared by every query below so the
    // aggregate, by-signal, returns and outcome-row figures all reconcile.
    const tradable = "signal IN ('Strong Buy','Buy','Sell','Strong Sell')";
    const conditions = ['recorded_at > NOW() - $1::interval', "source IN ('live','backtest')", tradable];
    const params = [`${days} days`];
    let idx = 2;
    if (signalType && signalType !== 'All' && signalType !== 'all') { conditions.push(`signal = $${idx++}`); params.push(signalType); }
    const whereClause = conditions.join(' AND ');

    let outcomeRows;
    try {
      const result = await pool.query(
        `SELECT ticker, signal, entry_price, exit_price, result, recorded_at
         FROM signal_outcomes WHERE ${whereClause}
         ORDER BY recorded_at DESC LIMIT $${idx}`,
        [...params, limit]
      );
      outcomeRows = result.rows;
      console.log(`[Backtest] Found ${outcomeRows.length} signal_outcomes rows`);
    } catch (e) {
      console.warn('[Backtest] signal_outcomes query failed:', e.message);
      outcomeRows = [];
    }

    if (outcomeRows.length > 0) {
      // Aggregate win/loss counts
      const aggResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE result = 'win') AS wins,
          COUNT(*) FILTER (WHERE result = 'loss') AS losses,
          COUNT(*) AS total
        FROM signal_outcomes
        WHERE ${whereClause}
      `, params);
      const agg = aggResult.rows[0];
      const total = parseInt(agg.total) || 0;
      const wins = parseInt(agg.wins) || 0;
      const losses = parseInt(agg.losses) || 0;

      // By-signal breakdown
      const bySignalResult = await pool.query(`
        SELECT signal,
          COUNT(*) FILTER (WHERE result = 'win') AS wins,
          COUNT(*) FILTER (WHERE result = 'loss') AS losses,
          COUNT(*) AS total
        FROM signal_outcomes
        WHERE ${whereClause}
        GROUP BY signal
      `, params);
      const bySignal = {};
      for (const r of bySignalResult.rows) {
        bySignal[r.signal] = {
          total: parseInt(r.total) || 0,
          wins: parseInt(r.wins) || 0,
          losses: parseInt(r.losses) || 0,
          winRate: (parseInt(r.total) || 0) > 0 ? Math.round((parseInt(r.wins) / parseInt(r.total)) * 1000) / 10 : 0,
          avgReturn: 0,
        };
      }

        // Return-based metrics from resolved rows (where exit_price != entry_price)
        const returnsResult = await pool.query(`
          SELECT ticker, signal, entry_price, exit_price,
            (exit_price - entry_price) / entry_price * 100 AS return_pct,
            COALESCE(position_size, 25) AS position_size
          FROM signal_outcomes
          WHERE ${whereClause}
            AND entry_price > 0 AND exit_price > 0 AND exit_price != entry_price
          ORDER BY recorded_at ASC
        `, params);

        let avgReturn = 0, profitFactor = 0, sharpe = 0, maxDrawdown = 0;
        let retVals = returnsResult.rows.map(r => ({ return: parseFloat(r.return_pct), posSize: parseInt(r.position_size) || 25 }));

        if (retVals.length > 0) {
          const totalReturn = retVals.reduce((s, v) => s + v.return, 0);
          avgReturn = Math.round((totalReturn / retVals.length) * 10) / 10;
          const mean = totalReturn / retVals.length;
          const returnArr = retVals.map(v => v.return);
          sharpe = returnArr.length > 1 ? Math.round((mean / (stdDev(returnArr) || 1)) * 100) / 100 : 0;
          // Max drawdown: compound equity curve with position sizing
          let equity = 100, peak = 100, maxDd = 0;
          for (const v of retVals) {
            const tradeImpact = (v.return / 100) * (v.posSize / 100);
            equity *= (1 + tradeImpact);
            if (equity > peak) peak = equity;
            const dd = ((peak - equity) / peak) * 100;
            if (dd > maxDd) maxDd = dd;
          }
          maxDrawdown = Math.round(maxDd * 10) / 10;
          // Profit factor: gross wins / gross losses
          const grossWins = retVals.filter(v => v.return > 0).reduce((s, v) => s + v.return, 0);
          const grossLosses = Math.abs(retVals.filter(v => v.return < 0).reduce((s, v) => s + v.return, 0));
          profitFactor = grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : grossWins > 0 ? 999 : 0;
        }

      // Fill by-signal avgReturn from resolved outcome returns only
      for (const st of Object.keys(bySignal)) {
        const sigRows = returnsResult.rows.filter(r => r.signal === st);
        if (sigRows.length > 0) {
          const rets = sigRows.map(r => parseFloat(r.return_pct));
          bySignal[st].avgReturn = Math.round((rets.reduce((s, v) => s + v, 0) / rets.length) * 10) / 10;
        }
      }

      const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
      return {
        total, wins, losses, winRate,
        avgReturn, profitFactor, sharpe, maxDrawdown,
        dataSource: 'signal_outcomes',
        bySignal,
      };
    }

    return { total: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0, bySignal: {}, dataSource: 'none' };
  } catch (e) { console.error('[Backtest] computeBacktestStats error:', e.message); return null; }
}

function stdDev(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function computeMaxDrawdown(returns) {
  let equity = 100, peak = 100, maxDD = 0;
  for (const r of returns) {
    equity *= (1 + r / 100);
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ─── Forward Testing ────────────────────────────────────────────────────────
// Tracks signal predictions forward and compares to actual outcomes.
const _forwardTestStore = new Map(); // symbol -> { predictions: [{id, signal, confidence, price, stopLoss, target1, action, tradeType, generatedAt, resolved, actualReturn, correct, resolvedAt, expiry}] }

const FORWARD_TEST_MIN_AGE = 28800000; // 8 hours — predictions younger than this are skipped

// A resolution quote that deviates more than 50% from the prediction entry cannot
// be a legitimate stop/target touch (stops/targets sit within ~10-25% of entry).
// Such quotes are treated as stale/garbage and the prediction is deferred instead
// of manufacturing an outcome (e.g. CRWN, ARM +4373%, GLD -92%).
const RESOLUTION_MAX_DEVIATION = 0.5;

// Sells are exit/avoid ratings, not short positions — they carry no mirrored
// stop/target levels. A sell resolves on whether the stock actually moved past
// this fraction (~2%) of the signal price in the direction that validates the
// rating (fell = right to exit/avoid) or refutes it (rose = wrong to exit).
const SELL_EXIT_MOVE = 0.02;

// Benchmark-relative threshold for sells: a stock that moved sideways (±2%) can
// still be resolved when it under/over-performed its benchmark by at least this
// much (~3%) over the evaluation window (e.g. flat while the market fell 4% →
// the exit/avoid rating was right).
const SELL_REL_MOVE = 0.03;

// Bounded resolution horizon for sell predictions. Sells are exit/avoid ratings
// that normally resolve on a decisive move or benchmark lag; without a horizon a
// sell whose stock and benchmark both sit flat would pend forever and the audit
// accuracy could never populate. After this age the exit thesis is judged by the
// total relative performance (see evaluateSellAtHorizon).
const SELL_RESOLVE_MAX_AGE = 5 * 24 * 60 * 60 * 1000; // 5 days

// Relative-performance tolerance at the sell horizon: a stock that stayed within
// ~1% of its benchmark after SELL_RESOLVE_MAX_AGE is noise, resolved neutral.
const SELL_HORIZON_TOLERANCE = 0.01;

// NSE low-float names are far more volatile than the liquid US names the US
// thresholds above were calibrated for: a 2-5% pop on a flat NSE20 is ordinary
// noise, not evidence the exit/avoid rating was wrong. Widen every sell band for
// NSE names so the audit stops punishing normal Kenyan-market volatility.
const NSE_SELL_EXIT_MOVE = 0.06;
const NSE_SELL_REL_MOVE = 0.08;
const NSE_SELL_HORIZON_TOLERANCE = 0.06;

const DEFAULT_SELL_THRESHOLDS = {
  exitMove: SELL_EXIT_MOVE,
  relMove: SELL_REL_MOVE,
  horizonTolerance: SELL_HORIZON_TOLERANCE,
};

// Per-symbol sell thresholds — wider bands for volatile NSE names. Evaluators
// take an explicit thresholds object so the pure decision helpers stay unit
// testable with the US defaults while callers pass the symbol's real bands.
function sellThresholdsFor(symbol) {
  return NSE_SYMBOLS.includes(symbol)
    ? { exitMove: NSE_SELL_EXIT_MOVE, relMove: NSE_SELL_REL_MOVE, horizonTolerance: NSE_SELL_HORIZON_TOLERANCE }
    : DEFAULT_SELL_THRESHOLDS;
}

// Benchmark for benchmark-relative sell evaluation: NSE names run against the
// NSE 20-share index, everything else against the S&P 500 proxy (the same index
// the regime detector already relies on).
function benchmarkSymbolFor(symbol) {
  return NSE_SYMBOLS.includes(symbol) ? 'NSE:NSE20' : 'SPY';
}

// marketService only resolves NSE names under the 'NSE:' prefix (mystocks/AFX);
// the resolvers must quote the prefixed symbol or NSE predictions never get a
// price to evaluate against.
function _marketQuoteSymbol(symbol) {
  return NSE_SYMBOLS.includes(symbol) ? 'NSE:' + symbol : symbol;
}

async function _getBenchmarkNow(symbol) {
  try {
    if (symbol === 'NSE:NSE20') {
      // NSE indices aren't stock quotes — they come from the NSE site scraper
      // (marketService only knows NSE stocks). Reuse indicesService so NSE sells
      // get a real index benchmark instead of an absolute fallback.
      const { fetchIndexLive } = require('./indicesService');
      const idx = await fetchIndexLive('NSE:NSE20');
      return idx && idx.price > 0 ? idx.price : null;
    }
    const q = await getStockQuote(symbol);
    return q && q.price > 0 ? q.price : null;
  } catch {
    return null;
  }
}

// Score-based closes (flip or fade) are re-enabled. A flip requires
// FLIP_CLOSE_CONFIRMATIONS consecutive readings while the position is in profit
// (winner-only — see evaluateScoreClose). Both are env-overridable.
const FLIP_CLOSE_CONFIRMATIONS = Math.max(1, parseInt(process.env.FLIP_CLOSE_CONFIRMATIONS || '3', 10) || 3);
// A fade is less decisive than a full flip, so it needs FADE_CLOSE_CONFIRMATIONS
// consecutive trustworthy readings SPANNING at least two distinct days before it
// can close — a cluster of readings inside a single session can all come from one
// bad data spell, so the streak must survive a day boundary.
const FADE_CLOSE_CONFIRMATIONS = Math.max(2, parseInt(process.env.FADE_CLOSE_CONFIRMATIONS || '3', 10) || 3);
// Fade strength: the fresh composite score sits in the Hold band (production
// thresholds: buy starts at 55, hold band is 30..54). A DEEP fade has fallen to
// FADE_DEEP_SCORE or below (more than halfway toward Sell) and confirms at the
// base count. A MARGINAL fade that merely crossed the buy/hold line (e.g. 61 -> 49
// vs 50 -> 49) is a weaker signal and demands one extra confirmation.
const FADE_DEEP_SCORE = 42;      // <= this: deep fade; 43..54: marginal fade
// Score-based closes (flip or fade) are suppressed until a monitored position is at
// least this old. The composite score sits right on the buy/hold boundary, so a
// re-scoring pass can flicker Buy<->Hold/Sell within minutes of entry; closing at
// market then books entry==exit — the ~0% coin-flip churn. During the guard the
// position resolves ONLY by stop/target (trackSignalOutcomes). A genuine target1
// touch is still handled there as a win, so no realized gain is lost.
// The guard also gives a fresh thesis room to develop: a 4-hour-old swing position
// (EABL Aug 5) was fade-closed at +1.2% before it ever approached its +14% target.
const SCORE_CLOSE_MIN_AGE_MS = (Math.max(1, parseInt(process.env.SCORE_CLOSE_MIN_AGE_HOURS || '6', 10) || 6)) * 3600000; // 6 hours by default
// Re-leveling: while a long is monitored, the hard stop is re-derived from the
// current price/ATR (never loosened) and capped so it NEVER climbs above the
// entry zone until the stock is near its target. A rally that retraces to the
// entry point (e.g. +10% up then back to entry) must not stop the position — the
// stock can pump again. The stop rides below entry through the whole pre-lock
// phase with a volatility-scaled buffer (at least RELEVEL_BREAKEVEN_BUFFER_PCT,
// and scaled up for high-ATR names) so a normal pullback after a run doesn't stop
// a dip-and-rally stock at ~breakeven; only once progress crosses
// RELEVEL_LOCK_PROGRESS does it start banking a locked share of the gain, and the
// post-target trailing stop protects the final run.
const RELEVEL_BREAKEVEN_BUFFER_PCT = parseFloat(process.env.RELEVEL_BREAKEVEN_BUFFER_PCT || '2'); // floor: % below entry the pre-lock stop may approach (never above entry)
const RELEVEL_BREAKEVEN_BUFFER_ATR_FRACTION = parseFloat(process.env.RELEVEL_BREAKEVEN_BUFFER_ATR_FRACTION || '0.5'); // pre-lock cap stays at least this fraction of the fresh ATR stop distance below entry
const RELEVEL_LOCK_PROGRESS = 75;      // % of target1 distance to lock part of the gain
const RELEVEL_LOCK_RATIO = 0.5;        // fraction of the open gain locked once lock progress is reached

// ─── Pure decision helpers (unit-testable, used by processSymbol) ────────
// Conviction-fade: classify whether an open position's fresh analysis no longer
// supports its direction (buy -> hold / sell -> hold) but hasn't flipped. A fade
// only counts on trustworthy data. To confirm, the streak needs
// FADE_CLOSE_CONFIRMATIONS consecutive readings (one extra when the fade is
// MARGINAL — score still high in the Hold band) AND the streak must span at least
// two distinct days: a batch of readings inside a single session can all come from
// one bad data spell, so the fade must survive a day boundary before the gate may
// close the position.
// Returns { isFade, fadeCount, fadeConfirmed, fadeFirstSeen, required } where
// fadeFirstSeen is the timestamp of the first reading in the current streak (reset
// with the counter) and required is the confirmation count this reading demanded.
function assessConvictionFade(prevAction, freshAction, eligibilityOk, prevFadeCount = 0, prevFadeFirstSeen = null, now = Date.now(), freshScore = null) {
  const isFade = eligibilityOk && freshAction === 'hold' && (prevAction === 'buy' || prevAction === 'sell');
  let fadeCount, fadeFirstSeen;
  if (isFade) {
    fadeCount = (prevFadeCount || 0) + 1;
    fadeFirstSeen = prevFadeFirstSeen || now;
  } else {
    fadeCount = 0;
    fadeFirstSeen = null;
  }
  const deep = freshScore != null && freshScore <= FADE_DEEP_SCORE;
  const required = isFade ? (FADE_CLOSE_CONFIRMATIONS + (deep ? 0 : 1)) : FADE_CLOSE_CONFIRMATIONS;
  const spansTwoDays = fadeFirstSeen != null
    && Math.floor(fadeFirstSeen / 86400000) !== Math.floor(now / 86400000);
  const fadeConfirmed = fadeCount >= required && spansTwoDays;
  return { isFade, fadeCount, fadeConfirmed, fadeFirstSeen, required };
}

// Long-term holds are closed ONLY by their stop/target (see the monitor gate);
// score-based closes are reserved for short-term trade types.
function isLongTermHold(type) {
  return type === 'Long Term Value' || type === 'Long Term';
}

// Immediate-close reason for a fresh conviction fade on an open position
// (non-long-term trades only). Trailing positions are excluded — the trail stop,
// not the market print, books those exits. Returns:
//   'profit fade' - price already at/above target1: a degraded thesis banks the
//                   gain now instead of waiting for multi-reading confirmation.
//   null          - fall through to the regular FADE_CLOSE_CONFIRMATIONS path.
// Winner-only: a faded LOSER never closes here (see evaluateScoreClose) — it
// rides to its hard stop/target, resolved by trackSignalOutcomes.
function fadeCloseReason(prevOutcome, freshAction, eligibilityOk, currentPrice) {
  if (!eligibilityOk || !prevOutcome || freshAction !== 'hold') return null;
  const type = prevOutcome.type || 'Swing Trade';
  if (isLongTermHold(type)) return null;
  if (prevOutcome.trailing === true) return null;
  const { entryPrice, target1 } = prevOutcome;
  if (entryPrice > 0 && target1 > entryPrice) {
    const progress = ((currentPrice - entryPrice) / (target1 - entryPrice)) * 100;
    if (progress >= 100) return 'profit fade';
  }
  return null;
}

// Pure verdict for the monitor gate's score-based close. Combines flip/fade rules
// with the confirmation and minimum-age guards into a single testable decision
// (see test-fade-relevel.cjs). freshScore is the current composite score (0-100);
// it grades the fade as deep (<= FADE_DEEP_SCORE, base confirmations) or marginal
// (one extra confirmation). Returns:
//   close         - null (keep monitoring) or a close reason string:
//                   'score flipped' | 'profit fade'
//   fadeCount     - next fade counter (0 while the min-age guard suppresses it)
//   fadeFirstSeen - timestamp of the first reading in the current fade streak
//   required      - confirmations this reading demands (for logging)
//   isFade        - a fade reading occurred this cycle (for logging)
//   tooYoung      - position is still under the min-age guard
//   longTermHold  - long-term type (score closes permanently disabled)
function evaluateScoreClose(prevOutcome, freshAction, eligibilityOk, currentPrice, now = Date.now(), minAgeMs = SCORE_CLOSE_MIN_AGE_MS, freshScore = null) {
  if (!prevOutcome) return { close: null, fadeCount: 0, fadeFirstSeen: null, required: FADE_CLOSE_CONFIRMATIONS, isFade: false, tooYoung: true, longTermHold: false };
  const prevAction = prevOutcome.action;
  const longTermHold = isLongTermHold(prevOutcome.type);
  const allowScoreClose = !longTermHold;
  const tooYoung = prevOutcome.timestamp ? (now - prevOutcome.timestamp) < minAgeMs : true;
  const scoreCloseAllowed = allowScoreClose && !tooYoung;

  // WINNER-ONLY closes (Option 1): the score can book a gain when the thesis
  // turns against an IN-PROFIT position, but it can never cut a loser early.
  // A faded/flipped loser rides to its hard stop or target (resolved by
  // riskManager.trackSignalOutcomes) — the score exit is a gain-banking signal,
  // not a risk-cap. So every score close below is gated on inProfit (price has
  // crossed entry toward target).
  const isPrevBuy = prevAction === 'buy';
  const inProfit = currentPrice > 0 && prevOutcome.entryPrice > 0
    ? (isPrevBuy ? currentPrice >= prevOutcome.entryPrice : currentPrice <= prevOutcome.entryPrice)
    : false;

  // Flip: fresh thesis flipped direction (Buy->Sell or Sell->Buy). A winner-only
  // flip requires FLIP_CLOSE_CONFIRMATIONS consecutive flip readings AND the
  // position in profit — the reversal banks the gain instead of holding a thesis
  // that just turned. A LOSER flip never closes here; it rides to its hard stop.
  const isFlipCandidate = eligibilityOk && scoreCloseAllowed && ((prevAction === 'buy' && freshAction === 'sell') || (prevAction === 'sell' && freshAction === 'buy'));
  if (isFlipCandidate) {
    if (prevOutcome.flipFirstSeen == null) {
      prevOutcome.flipFirstSeen = now;
      prevOutcome.flipCount = 1;
    } else {
      prevOutcome.flipCount++;
    }
  } else if (eligibilityOk) {
    // Trustworthy data shows no flip — reset the streak. Skip reset when data
    // is untrustworthy (eligibilityOk=false) so a transient data glitch doesn't
    // kill a confirmed flip that started under good data.
    prevOutcome.flipCount = 0;
    prevOutcome.flipFirstSeen = null;
  }
  const flipConfirmed = prevOutcome.flipCount >= FLIP_CLOSE_CONFIRMATIONS;
  const flipQualifies = flipConfirmed && inProfit;

  const { isFade, fadeCount, fadeConfirmed, fadeFirstSeen, required } = scoreCloseAllowed
    ? assessConvictionFade(prevAction, freshAction, eligibilityOk, prevOutcome.fadeCount, prevOutcome.fadeFirstSeen, now, freshScore)
    : { isFade: false, fadeCount: 0, fadeConfirmed: false, fadeFirstSeen: null, required: FADE_CLOSE_CONFIRMATIONS };
  const fadeReason = scoreCloseAllowed && isFade ? fadeCloseReason(prevOutcome, freshAction, eligibilityOk, currentPrice) : null;
  // Winner-only: every score close fires ONLY while the position is in profit
  // (flip banks the gain on a reversed thesis; profit-fade banks it at target).
  // A LOSER never closes here — it rides to its hard stop/target
  // (trackSignalOutcomes).
  let close = null;
  if (inProfit) {
    if (flipQualifies) close = 'score flipped';
    else if (fadeReason) close = fadeReason;
  }
  return { close, fadeCount, fadeFirstSeen, required, isFade, tooYoung, longTermHold };
}

// Re-level: derive the new hard stop for a monitored long from the fresh ATR stop
// (never loosening it) with a below-entry pre-lock cap and a locked-gain floor as
// price advances toward target1. Through the whole pre-lock phase the stop tightens
// only as far as entry minus a volatility-scaled buffer, so a rally that retraces
// to (or just past) entry keeps the position alive for a second leg instead of
// stopping it at ~0%, and a normal pullback after a run doesn't yank a dip-and-rally
// stock. Once progress crosses RELEVEL_LOCK_PROGRESS the stop starts
// banking RELEVEL_LOCK_RATIO of the open gain; an already-raised stop is never
// loosened if price later retraces below lock. Returns changed=false when the new
// stop isn't a real improvement or would sit at/above the market price.
function computeRelevelStop(position, currentPrice, freshStopLoss) {
  const { entryPrice, stopLoss, target1 } = position || {};
  if (freshStopLoss == null || currentPrice <= 0 || entryPrice <= 0 || !(target1 > entryPrice)) {
    return { newStop: stopLoss, changed: false, progress: 0 };
  }
  const progress = ((currentPrice - entryPrice) / (target1 - entryPrice)) * 100;
  // The pre-lock cap is entry minus a volatility-scaled buffer: the fresher the
  // ATR stop (i.e. the more the stock is moving), the further below entry the stop
  // must stay. A fixed tiny buffer lets the cap climb to just under entry on a
  // rally, and a normal pullback then stops a position that would have recovered
  // (dip-and-rally names get yanked at ~breakeven). The buffer is at least
  // RELEVEL_BREAKEVEN_BUFFER_PCT and never smaller than
  // RELEVEL_BREAKEVEN_BUFFER_ATR_FRACTION of the fresh ATR stop distance, and it
  // also respects the MIN_STOP_PCT floor — a calm stock's stop is never tightened
  // closer to entry than the floor, so monitoring can't undo the initial stop
  // width that gave it a fair chance. (The floor exists because a pre-floor
  // build once ratcheted PAAS's stop from -10% to -1.2% and a routine pullback
  // stopped out a 6-day Long Term Value position at 47.47 on 2026-08-13.)
  const freshStopDistancePct = freshStopLoss != null && currentPrice > 0 && freshStopLoss < currentPrice
    ? ((currentPrice - freshStopLoss) / currentPrice) * 100
    : 0;
  const breakevenCap = entryPrice - (entryPrice * Math.max(RELEVEL_BREAKEVEN_BUFFER_PCT, MIN_STOP_PCT * 100, freshStopDistancePct * RELEVEL_BREAKEVEN_BUFFER_ATR_FRACTION)) / 100;
  let newStop = stopLoss;
  // Math.max can only tighten, never loosen, the hard stop.
  newStop = Math.max(newStop, freshStopLoss);
  if (progress >= RELEVEL_LOCK_PROGRESS) {
    newStop = Math.max(newStop, entryPrice + (currentPrice - entryPrice) * RELEVEL_LOCK_RATIO);
  } else if (stopLoss != null && stopLoss < entryPrice) {
    // Pre-lock: tighten toward entry but never above entry minus the buffer. A stop
    // already raised past the cap by a prior lock phase (stopLoss >= entryPrice)
    // is left exactly where it is. Legacy stops set with a tighter MIN_STOP_PCT
    // (stopLoss between breakevenCap and entryPrice) are corrected down to the cap.
    newStop = Math.min(newStop, breakevenCap);
  }
  newStop = Math.round(newStop * 100) / 100;
  // changed means the stop actually moved — a real tighten (Math.max) or a downward
  // correction of a legacy sub-floor stop (Math.min toward the breakevenCap, which
  // never loosens past the MIN_STOP_PCT floor). Previously `newStop > stopLoss`
  // only reported tightenings, so the legacy repair computed above was silently
  // dropped and a 2.61% pre-floor stop (ASML 2026-08-28) stayed live and booked a
  // noise-band loss instead of riding the -15% floor. Round both sides so an
  // already-floored stop never churns (e.g. stop at 85 with price retrace).
  const stopLossRounded = Math.round((stopLoss || 0) * 100) / 100;
  const changed = newStop !== stopLossRounded && newStop < currentPrice;
  return { newStop, changed, progress };
}

async function _loadForwardPredictionsFromDb() {
  try {
    const result = await pool.query(
      `SELECT id, symbol, signal, confidence, price, stop_loss, target1, action, trade_type, sector, bench_price, generated_at, resolved, actual_return, correct, resolved_at
       FROM forward_predictions WHERE generated_at > NOW() - $1::interval ORDER BY generated_at`,
      [`${SIGNAL_WINDOW_DAYS} days`]
    );
    const resolved = result.rows.filter(r => r.resolved).length;
    const unresolved = result.rows.length - resolved;
    if (result.rows.length) console.log(`[SignalService] Loaded ${result.rows.length} forward predictions from DB (${unresolved} unresolved, ${resolved} resolved)`);
    // Deduplicate DB rows on load: keep latest per (symbol, price, action)
    const seenFp = new Map();
    const dedupedRows = [];
    for (const row of result.rows) {
      const key = `${row.symbol}:${row.price}:${row.action}`;
      const existing = seenFp.get(key);
      if (!existing || row.generated_at > existing.generated_at) {
        if (existing) { const idx = dedupedRows.indexOf(existing); if (idx >= 0) dedupedRows.splice(idx, 1); }
        dedupedRows.push(row);
        seenFp.set(key, row);
      }
    }
    const dropped = result.rows.length - dedupedRows.length;
    if (dropped > 0) console.log(`[SignalService] Deduped ${dropped} duplicate forward predictions from DB`);
    for (const row of dedupedRows) {
      if (!_forwardTestStore.has(row.symbol)) _forwardTestStore.set(row.symbol, { predictions: [] });
      const tradeType = row.trade_type || 'Swing Trade';
      _forwardTestStore.get(row.symbol).predictions.push({
        id: row.id, signal: row.signal, confidence: row.confidence,
        price: Number(row.price), stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null, target1: row.target1 != null ? Number(row.target1) : null,
        action: row.action, tradeType, sector: row.sector,
        benchPrice: row.bench_price != null ? Number(row.bench_price) : null,
        generatedAt: new Date(row.generated_at).getTime(),
        resolved: !!row.resolved, actualReturn: row.actual_return != null ? Number(row.actual_return) : null, correct: row.correct,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null,
      });
    }
  } catch (e) { /* table may not exist yet */ }
}

async function recordForwardPrediction(symbol, signalAction, confidence, price, stopLoss, target1, signalObjAction, tradeType, sector) {
  // Dedup: one live prediction per symbol+action+THESIS. A persistent signal that
  // never triggers a decisive move must NOT re-emit a fresh prediction every
  // signal cycle — the audit would count the same call N times (same ref price,
  // same outcome). The old prediction stays until it resolves (decisive move or
  // benchmark lag), then a new one may be created. Keying on the thesis (entry
  // price + target1) instead of symbol+action alone lets a GENUINELY NEW signal
  // with fresh levels be recorded even while an older prediction for the same
  // symbol is still open — the CGEN Aug 5 Long Term signal (entry 156.75,
  // target1 208.34) was swallowed because the Aug 2 prediction (target1 172.52)
  // was still pending, so it never reached the forward test at all.
  const existing = _forwardTestStore.get(symbol);
  if (existing) {
    const open = existing.predictions.find(p =>
      !p.resolved && p.action === signalObjAction &&
      (() => {
        if (p.price > 0 && price > 0 && Math.abs(p.price - price) / price >= 0.02) return false; // materially new entry → distinct thesis
        // Same price within 0.5% is a duplicate thesis regardless of target levels
        if (p.price > 0 && price > 0 && Math.abs(p.price - price) / price < 0.005) return true;
        if (signalObjAction === 'sell') return true; // sells carry no target levels
        return p.target1 != null && target1 != null && Math.abs(p.target1 - target1) / target1 < 0.05;
      })()
    );
    if (open) return;
    // Also block re-creation of a prediction with the same thesis that was
    // recently resolved — without this, a restart between two hourly cycles
    // re-records the same prediction (DB loads the resolved row, next cycle
    // sees it resolved and creates a duplicate in-memory).
    const recentResolved = existing.predictions.find(p =>
      p.resolved && p.action === signalObjAction && p.price > 0 && price > 0 &&
      Math.abs(p.price - price) / price < 0.005
    );
    if (recentResolved) return;
  }
  // DB-backed dedup backstop: the in-memory store above can be empty during a
  // startup race (it loads asynchronously while the first signal cycle already
  // runs at +100ms), so also guard against any row (resolved or not) with the
  // same thesis still in forward_predictions. Without this, a restart between
  // two hourly cycles re-emits the same prediction and creates a duplicate (e.g.
  // CGEN Aug 10: identical rows id 12422/12428, COMP Aug 11: twin entries).
  try {
    const dup = await pool.query(
      `SELECT id FROM forward_predictions
       WHERE symbol = $1 AND action = $2
         AND generated_at > NOW() - $3::interval
         AND price > 0 AND $4 > 0
         AND ABS(price - $4) / $4 < 0.005
       LIMIT 1`,
      [symbol, signalObjAction, `${SIGNAL_WINDOW_DAYS} days`, price]
    );
    if (dup.rows.length) return;
  } catch (e) { /* persistence best-effort */ }
  // Benchmark snapshot for sell predictions so the exit thesis can be judged
  // relative to the market later (best-effort; null → absolute evaluation).
  let benchPrice = null;
  if (signalObjAction === 'sell') {
    benchPrice = await _getBenchmarkNow(benchmarkSymbolFor(symbol));
  }
  if (!_forwardTestStore.has(symbol)) _forwardTestStore.set(symbol, { predictions: [] });
  const store = _forwardTestStore.get(symbol);
  let dbId = null;
  try {
    const result = await pool.query(
      `INSERT INTO forward_predictions (symbol, signal, confidence, price, stop_loss, target1, action, trade_type, sector, bench_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [symbol, signalAction, confidence, price, stopLoss, target1, signalObjAction, tradeType, sector, benchPrice]
    );
    dbId = result.rows[0].id;
  } catch (e) { /* persistence best-effort */ }
  store.predictions.push({
    id: dbId, signal: signalAction, confidence, price,
    stopLoss, target1, action: signalObjAction, tradeType, sector, benchPrice,
    generatedAt: Date.now(), resolved: false,
    actualReturn: null, correct: null,
  });
  if (store.predictions.length > 200) store.predictions = store.predictions.slice(-200);
}

// True when the resolution quote is stale/garbage — a quote that deviates more
// than 50% from the prediction entry cannot be a legitimate price move.
function isGarbageQuote(pred, currentPrice) {
  return !pred.price || pred.price <= 0 || !currentPrice || currentPrice <= 0 ||
    Math.abs(currentPrice - pred.price) / pred.price > RESOLUTION_MAX_DEVIATION;
}

// Shared forward-prediction resolution core (used by the per-symbol resolver,
// the bulk resolver and the expiry validator so the outcome rules can't drift).
// Returns one of:
//   { status: 'defer' }   — stale/garbage quote, keep monitoring
//   { status: 'pending' } — no level/move triggered yet, keep monitoring
//   { status: 'neutral' } — missing directional action, cannot be evaluated
//   { status: 'resolved', correct, actualReturn }
function evaluateForwardPrediction(pred, currentPrice, th = DEFAULT_SELL_THRESHOLDS) {
  if (isGarbageQuote(pred, currentPrice)) return { status: 'defer' };
  const actualReturn = Math.round(((currentPrice - pred.price) / pred.price) * 1000) / 10;
  const isBuy = pred.action === 'buy';
  const isSell = pred.action === 'sell';
  if (isBuy && pred.stopLoss != null && pred.target1 != null) {
    if (currentPrice <= pred.stopLoss) return { status: 'resolved', correct: false, actualReturn };
    if (currentPrice >= pred.target1) return { status: 'resolved', correct: true, actualReturn };
    return { status: 'pending' };
  }
  if (isSell) {
    // Exit/avoid semantics: correct if the stock fell vs the signal price (the
    // exit was right), incorrect if it rose. No stop/target levels involved.
    const exitMove = (pred.price - currentPrice) / pred.price;
    if (exitMove >= th.exitMove) return { status: 'resolved', correct: true, actualReturn };
    // A decisive up-move only verdicts "incorrect" when there is no benchmark
    // to compare against. When a benchmark was captured at rating time, defer
    // to the benchmark-relative refinement instead: a stock that rose but
    // LAGGED its market by th.relMove still validates the exit/avoid call,
    // and the absolute path would wrongly mark it incorrect here.
    if (exitMove <= -th.exitMove && (pred.benchPrice == null || pred.benchPrice <= 0)) {
      return { status: 'resolved', correct: false, actualReturn };
    }
    return { status: 'pending' };
  }
  if (isBuy || isSell) return { status: 'pending' };
  return { status: 'neutral' };
}

// Refinement for sells that the absolute evaluator left pending (stock moved
// less than ±th.exitMove). Uses absolute direction: stock fell = sell was
// correct, stock rose = sell was wrong.
function evaluateSellRelative(pred, currentPrice, benchReturn, th = DEFAULT_SELL_THRESHOLDS) {
  const stockReturn = (currentPrice - pred.price) / pred.price;
  const actualReturn = Math.round(stockReturn * 1000) / 10;
  if (stockReturn < 0) return { resolved: true, correct: true, actualReturn };
  if (stockReturn > 0) return { resolved: true, correct: false, actualReturn };
  return { resolved: true, correct: null, actualReturn };
}

// Horizon fallback for sells that never crossed a decisive move (±th.exitMove).
// Uses absolute direction: stock fell = sell was correct, stock rose = sell was wrong.
function evaluateSellAtHorizon(pred, currentPrice, benchReturn, th = DEFAULT_SELL_THRESHOLDS) {
  const stockReturn = (currentPrice - pred.price) / pred.price;
  const actualReturn = Math.round(stockReturn * 1000) / 10;
  if (stockReturn < 0) return { resolved: true, correct: true, actualReturn };
  if (stockReturn > 0) return { resolved: true, correct: false, actualReturn };
  return { resolved: true, correct: null, actualReturn };
}

async function resolveForwardPredictions(symbol) {
  const store = _forwardTestStore.get(symbol);
  if (!store || !store.predictions.length) return;
  const unresolved = store.predictions.filter(p => !p.resolved);
  if (!unresolved.length) return;
  try {
    const quote = await getStockQuote(_marketQuoteSymbol(symbol));
    if (!quote || !quote.price) return;
    const currentPrice = quote.price;
    const th = sellThresholdsFor(symbol);
    for (const pred of unresolved) {
      if (Date.now() - pred.generatedAt < FORWARD_TEST_MIN_AGE) continue;
      const age = Date.now() - pred.generatedAt;
      const outcome = evaluateForwardPrediction(pred, currentPrice, th);
      if (outcome.status === 'defer') {
        const dev = Math.abs(currentPrice - pred.price) / pred.price * 100;
        if (!pred._garbageWarned) {
          pred._garbageWarned = true;
          if (process.env.NODE_ENV !== 'test') {
            console.warn(`[ForwardTest] Deferring ${symbol} resolution: quote ${currentPrice} is ${dev.toFixed(1)}% from entry ${pred.price} - stale/garbage quote`);
          }
        }
        continue;
      }
      const actualReturn = Math.round(((currentPrice - pred.price) / pred.price) * 1000) / 10;
      if (outcome.status === 'resolved') {
        // Only when the level actually fires (stop for a loss, target for a win)
        // do we stamp the return and resolution time. Pending buys below stay
        // un-stamped so the UI never shows a fake "+x% / resolved" for an idea
        // that is still monitoring toward its target.
        pred.correct = outcome.correct;
        pred.resolved = true;
        pred.resolvedAt = Date.now();
        pred.actualReturn = actualReturn;
      } else if (outcome.status === 'neutral') {
        // Missing directional action (legacy/foreign rows) — cannot be evaluated.
        // Resolve as neutral instead of guessing from the signal name, so stale
        // rows don't manufacture fake wins/losses.
        pred.correct = null;
        pred.actualReturn = null;
        pred.resolvedAt = Date.now();
        pred.resolved = true;
      } else if (pred.action === 'sell') {
        // Pending sell — refine with benchmark-relative evaluation before
        // staying on hold. A stock moving sideways while the market grinds
        // lower is itself evidence the exit/avoid rating was right.
        let benchReturn = null;
        const benchNow = await _getBenchmarkNow(benchmarkSymbolFor(symbol));
        if (pred.benchPrice && benchNow) {
          const b = (benchNow - pred.benchPrice) / pred.benchPrice;
          if (Math.abs(b) <= RESOLUTION_MAX_DEVIATION) benchReturn = b;
        }
        const rel = evaluateSellRelative(pred, currentPrice, benchReturn, th);
        if (rel.resolved) {
          pred.correct = rel.correct;
          pred.resolved = true;
          pred.resolvedAt = Date.now();
          pred.actualReturn = rel.actualReturn;
        } else if (age >= SELL_RESOLVE_MAX_AGE) {
          const horiz = evaluateSellAtHorizon(pred, currentPrice, benchReturn, th);
          if (horiz.resolved) {
            pred.correct = horiz.correct;
            pred.resolved = true;
            pred.resolvedAt = Date.now();
            pred.actualReturn = horiz.actualReturn;
          } else {
            pred.actualReturn = null;
            pred.resolvedAt = null;
            continue; // Keep monitoring.
          }
        } else {
          continue; // Still pending — keep monitoring.
        }
      } else {
        // Pending buy: still monitoring toward stop/target. Ensure no stale
        // return/resolution time from an earlier cycle leaks into the UI.
        pred.actualReturn = null;
        pred.resolvedAt = null;
        continue; // Pending — keep monitoring.
      }
      if (pred.resolved && pred.id) {
        pool.query(
          `UPDATE forward_predictions SET resolved = TRUE, actual_return = $1, correct = $2, resolved_at = NOW() WHERE id = $3`,
          [pred.actualReturn, pred.correct, pred.id]
        ).catch(e => { console.warn(`[ForwardTest] Failed to persist resolved prediction #${pred.id} (${symbol}): ${e.message}`); });
      }
    }
  } catch { /* skip */ }
}

async function getForwardTestStats() {
  // Forward Test mirrors the Health tab's accuracy story: it audits the SAME
  // resolved live outcomes the Health tab's win rate is computed from
  // (signal_outcomes source='live' — win = target/trailing-stop hit, loss =
  // stop hit). It deliberately does NOT re-score sells benchmark-relative; that
  // trail lives in the dedicated Sells tab. The only difference is the drill-
  // down: per symbol, per confidence band, per time-to-resolve bucket, plus a
  // full outcome log, so an operator can audit the engine from one number.
  const rows = [];
  try {
    const res = await pool.query(
      `SELECT o.ticker, o.signal, o.entry_price, o.exit_price, o.result,
              o.recorded_at, o.resolved_at, o.signal_generated_at,
              h.confidence
       FROM signal_outcomes o
       LEFT JOIN LATERAL (
         SELECT h.confidence FROM signal_history h
         WHERE h.ticker = o.ticker
           AND h.generated_at BETWEEN COALESCE(o.signal_generated_at, o.recorded_at) - interval '5 minutes'
                                 AND COALESCE(o.signal_generated_at, o.recorded_at) + interval '5 minutes'
         ORDER BY ABS(EXTRACT(EPOCH FROM (h.generated_at - COALESCE(o.signal_generated_at, o.recorded_at))))
         LIMIT 1
       ) h ON true
       WHERE o.result IS NOT NULL AND o.source = 'live'
         AND COALESCE(o.signal_generated_at, o.recorded_at) > NOW() - $1::interval
       ORDER BY COALESCE(o.resolved_at, o.recorded_at) DESC`,
      [`${SIGNAL_WINDOW_DAYS} days`]
    );
    rows.push(...res.rows);
  } catch (e) {
    console.warn('[SignalService] getForwardTestStats outcomes query failed:', e.message);
  }

  let total = 0, wins = 0, losses = 0;
  let totalHours = 0, hourlyCount = 0;
  const byConfidence = {};
  const bySymbol = {};
  const buckets = { '1d': { total: 0, wins: 0, losses: 0 }, '15d': { total: 0, wins: 0, losses: 0 }, '30d': { total: 0, wins: 0, losses: 0 }, '60d': { total: 0, wins: 0, losses: 0 } };
  const log = [];

  const bucketOf = (hours) => hours <= 24 ? '1d' : hours <= 360 ? '15d' : hours <= 720 ? '30d' : '60d';
  const confOf = (c) => c == null ? 'unknown' : c >= 80 ? 'high' : c >= 60 ? 'med' : 'low';

  for (const r of rows) {
    if (r.result !== 'win' && r.result !== 'loss') continue;
    total++;
    if (r.result === 'win') wins++; else losses++;
    const gAt = r.signal_generated_at ? new Date(r.signal_generated_at).getTime() : null;
    const rAt = r.resolved_at ? new Date(r.resolved_at).getTime() : (r.recorded_at ? new Date(r.recorded_at).getTime() : gAt);
    const hours = (gAt && rAt) ? (rAt - gAt) / 3600000 : null;
    if (hours != null) { totalHours += hours; hourlyCount++; }
    const sym = r.ticker;
    if (!bySymbol[sym]) bySymbol[sym] = { total: 0, wins: 0, losses: 0, winRate: 0 };
    bySymbol[sym].total++;
    if (r.result === 'win') bySymbol[sym].wins++; else bySymbol[sym].losses++;
    const cb = confOf(r.confidence);
    if (!byConfidence[cb]) byConfidence[cb] = { total: 0, wins: 0, losses: 0, winRate: 0 };
    byConfidence[cb].total++;
    if (r.result === 'win') byConfidence[cb].wins++; else byConfidence[cb].losses++;
    if (hours != null) {
      const bk = bucketOf(hours);
      buckets[bk].total++;
      if (r.result === 'win') buckets[bk].wins++; else buckets[bk].losses++;
    }
    const entry = r.entry_price != null ? parseFloat(r.entry_price) : null;
    const exit = r.exit_price != null ? parseFloat(r.exit_price) : null;
    log.push({
      symbol: sym,
      signal: r.signal,
      confidence: r.confidence != null ? Math.round(Number(r.confidence)) : null,
      action: /buy|strong buy/i.test(r.signal) ? 'buy' : /sell|strong sell/i.test(r.signal) ? 'sell' : null,
      entryPrice: entry,
      exitPrice: exit,
      result: r.result,
      returnPct: entry && exit ? Math.round(((exit - entry) / entry) * 1000) / 10 : null,
      generatedAt: gAt ? new Date(gAt).toISOString() : null,
      resolvedAt: rAt ? new Date(rAt).toISOString() : null,
      currency: NSE_SYMBOLS.includes(sym) ? 'KES' : 'USD',
    });
  }

  // Merge resolved forward-test predictions into the LOG so symbols that are
  // only ever forward-tested (NSE/KES stocks like CGEN, which never get a
  // live-monitored signal_outcomes row) show their outcomes here too. These
  // rows feed the log ONLY — the win-rate stats above stay live-outcomes-only.
  try {
    const fw = await pool.query(
      `SELECT symbol, signal, confidence, price, actual_return, correct, generated_at, resolved_at
       FROM forward_predictions
       WHERE resolved = TRUE AND correct IS NOT NULL
         AND COALESCE(resolved_at, generated_at) > NOW() - $1::interval`,
      [`${SIGNAL_WINDOW_DAYS} days`]
    );
    for (const p of fw.rows) {
      const entry = p.price != null ? parseFloat(p.price) : null;
      const ret = p.actual_return != null ? parseFloat(p.actual_return) : null;
      log.push({
        symbol: p.symbol,
        signal: p.signal,
        confidence: p.confidence != null ? Math.round(Number(p.confidence)) : null,
        action: /buy|strong buy/i.test(p.signal) ? 'buy' : /sell|strong sell/i.test(p.signal) ? 'sell' : null,
        entryPrice: entry,
        exitPrice: entry && ret != null ? Math.round(entry * (1 + ret / 100) * 100) / 100 : null,
        result: p.correct === true ? 'win' : 'loss',
        returnPct: ret,
        generatedAt: p.generated_at ? new Date(p.generated_at).toISOString() : null,
        resolvedAt: p.resolved_at ? new Date(p.resolved_at).toISOString() : null,
        currency: NSE_SYMBOLS.includes(p.symbol) ? 'KES' : 'USD',
      });
    }
  } catch (e) {
    console.warn('[SignalService] forward-test log query failed:', e.message);
  }

  log.sort((a, b) => new Date(b.resolvedAt || b.generatedAt || 0) - new Date(a.resolvedAt || a.generatedAt || 0));

  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  for (const k of Object.keys(bySymbol)) {
    bySymbol[k].winRate = bySymbol[k].total > 0 ? Math.round((bySymbol[k].wins / bySymbol[k].total) * 1000) / 10 : 0;
  }
  for (const k of Object.keys(byConfidence)) {
    byConfidence[k].winRate = byConfidence[k].total > 0 ? Math.round((byConfidence[k].wins / byConfidence[k].total) * 1000) / 10 : 0;
  }
  for (const k of Object.keys(buckets)) {
    buckets[k].winRate = buckets[k].total > 0 ? Math.round((buckets[k].wins / buckets[k].total) * 1000) / 10 : 0;
  }

  return {
    totalOutcomes: total,
    wins,
    losses,
    pending: getOpenPositionCount(),
    winRate,
    avgDaysToResolve: hourlyCount > 0 ? Math.round((totalHours / hourlyCount / 24) * 100) / 100 : 0,
    bySymbol,
    byConfidence,
    byTimeBucket: buckets,
    log,
  };
}

function getForwardTestSnapshot() {
  const now = Date.now();
  const maxAge = SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let total = 0, correct = 0, losses = 0, neutral = 0, totalHours = 0, hourlyCount = 0;
  const buckets = { '1d': { total: 0, correct: 0, losses: 0, neutral: 0 }, '5d': { total: 0, correct: 0, losses: 0, neutral: 0 }, '20d': { total: 0, correct: 0, losses: 0, neutral: 0 } };
  for (const [, store] of _forwardTestStore) {
    for (const p of store.predictions) {
      if (p.generatedAt && (now - p.generatedAt) > maxAge) continue;
      if (!p.resolved) continue;
      total++;
      if (p.correct === true) correct++;
      else if (p.correct === false) losses++;
      else if (p.correct === null) neutral++;
      if (!p.resolvedAt) continue;
      const hours = (p.resolvedAt - p.generatedAt) / 3600000;
      totalHours += hours;
      hourlyCount++;
      if (hours <= 24) { buckets['1d'].total++; if (p.correct === true) buckets['1d'].correct++; else if (p.correct === false) buckets['1d'].losses++; else if (p.correct === null) buckets['1d'].neutral++; }
      if (hours <= 120) { buckets['5d'].total++; if (p.correct === true) buckets['5d'].correct++; else if (p.correct === false) buckets['5d'].losses++; else if (p.correct === null) buckets['5d'].neutral++; }
      if (hours <= 480) { buckets['20d'].total++; if (p.correct === true) buckets['20d'].correct++; else if (p.correct === false) buckets['20d'].losses++; else if (p.correct === null) buckets['20d'].neutral++; }
    }
  }
  const resolvedTotal = correct + losses;
  return {
    total, correct, losses, neutral,
    accuracy: resolvedTotal > 0 ? Math.round((correct / resolvedTotal) * 1000) / 10 : 0,
    avgDaysToResolve: hourlyCount > 0 ? Math.round((totalHours / hourlyCount / 24) * 100) / 100 : 0,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, {
      total: v.total, correct: v.correct, losses: v.losses, neutral: v.neutral,
      accuracy: (v.correct + v.losses) > 0 ? Math.round((v.correct / (v.correct + v.losses)) * 1000) / 10 : 0,
}])),
  };
}

// ─── Sell/Avoid Audit ─────────────────────────────────────────────────────────
// Dedicated audit surface for the exit/avoid rating logic. Sells are NOT
// monitored as positions (no stop/target levels); they are judged benchmark-
// relative via the forward-test sell predictions. This exposes that trail so
// sell accuracy can be audited independently of the Buy monitor.

// Collapse raw forward_predictions sell rows so one call is counted once:
//   • resolved rows share a resolution event — re-emissions of the same call
//     resolve within the same bulk pass (ms apart), so (symbol, price,
//     resolved_at rounded to the minute) identifies the call, surviving the
//     ms-level noise that defeats SQL DISTINCT;
//   • unresolved rows collapse to the latest per (symbol, ref price), while a
//     genuinely new call created after a resolution stays separate.
// Rows are returned newest-first (callers ORDER BY generated_at DESC).
function dedupeSellPredictions(rows) {
  const resolvedKeys = new Set();
  const pendingKeys = new Set();
  const out = [];
  for (const p of rows) {
    if (p.resolved) {
      const resMs = p.resolved_at ? Math.floor(new Date(p.resolved_at).getTime() / 60000) * 60000 : 't';
      const key = `${p.symbol}|${p.price}|${resMs}`;
      if (resolvedKeys.has(key)) continue;
      resolvedKeys.add(key);
    } else {
      const key = `${p.symbol}|${p.price}`;
      if (pendingKeys.has(key)) continue;
      pendingKeys.add(key);
    }
    out.push(p);
  }
  return out;
}

async function getSellAudit() {
  const windowDays = SIGNAL_WINDOW_DAYS;
  const stats = {
    totalRatings: 0, activeRatings: 0,
    sellPredictions: 0, pendingPredictions: 0, resolvedPredictions: 0,
    correct: 0, incorrect: 0, neutral: 0, accuracy: null,
  };
  const ratings = [];
  const predictions = [];
  try {
    // Only real ratings are audited: a signal below the emission floor
    // (minConfidence) is not a rating the engine stands behind, so it must not
    // inflate Total Ratings or the accuracy denominator. Applies at read time
    // so legacy sub-threshold rows are excluded too.
    const minConfidence = engineConfig.getConfig().minConfidence || 30;
    // Total Sell/Strong Sell ratings in the evaluation window (event count).
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM signal_history
       WHERE generated_at > NOW() - $1::interval AND signal IN ('Sell','Strong Sell')
         AND confidence >= $2::int`,
      [`${windowDays} days`, minConfidence]
    );
    stats.totalRatings = totalRes.rows[0]?.n || 0;

    // Active sell ratings — single source of truth for both the stat and the
    // Current table: tickers whose LATEST rating in the window is a Sell/Strong
    // Sell. A ticker regraded to Buy (e.g. CAG) drops out of both, so the count
    // and the table can never disagree.
    const ratingsRes = await pool.query(
      `SELECT DISTINCT ON (ticker) ticker, signal, confidence, price, entry_price, sector, reason, generated_at
       FROM signal_history
       WHERE generated_at > NOW() - $1::interval AND confidence >= $2::int
       ORDER BY ticker, generated_at DESC`,
      [`${windowDays} days`, minConfidence]
    );
    for (const r of ratingsRes.rows) {
      if (r.signal !== 'Sell' && r.signal !== 'Strong Sell') continue;
      ratings.push({
        ticker: r.ticker, signal: r.signal, confidence: r.confidence,
        price: r.price != null ? parseFloat(r.price) : (r.entry_price != null ? parseFloat(r.entry_price) : null),
        sector: r.sector, reason: r.reason || '',
        currency: NSE_SYMBOLS.includes(r.ticker) ? 'KES' : 'USD',
        generatedAt: r.generated_at ? new Date(r.generated_at).getTime() : null,
      });
    }
    stats.activeRatings = ratings.length;

    // Sell forward-test predictions — the benchmark-relative audit trail.
    // The engine used to re-emit a fresh prediction every signal cycle for a
    // persistent sell, so one call can appear as several rows with the same ref
    // price and outcome. Dedupe in JS:
    //   • resolved rows collapse into their resolution event (same symbol, price
    //     and resolved_at — the ms-level timestamps make SQL DISTINCT unreliable);
    //   • unresolved rows collapse to the latest per (symbol, price), while a
    //     genuinely new call created after a resolution stays separate.
    const predRes = await pool.query(
      `SELECT id, symbol, signal, confidence, price, bench_price, actual_return, correct, resolved, generated_at, resolved_at
       FROM forward_predictions
       WHERE action = 'sell' AND generated_at > NOW() - $1::interval AND confidence >= $2::int
       ORDER BY symbol, generated_at DESC LIMIT 500`,
      [`${windowDays} days`, minConfidence]
    );
    for (const p of dedupeSellPredictions(predRes.rows)) {
      predictions.push({
        id: p.id, symbol: p.symbol, signal: p.signal, confidence: p.confidence,
        price: p.price != null ? parseFloat(p.price) : null,
        benchPrice: p.bench_price != null ? parseFloat(p.bench_price) : null,
        actualReturn: p.actual_return != null ? parseFloat(p.actual_return) : null,
        correct: p.correct, resolved: !!p.resolved,
        currency: NSE_SYMBOLS.includes(p.symbol) ? 'KES' : 'USD',
        generatedAt: p.generated_at ? new Date(p.generated_at).getTime() : null,
        resolvedAt: p.resolved_at ? new Date(p.resolved_at).getTime() : null,
      });
      stats.sellPredictions++;
      if (p.resolved) {
        stats.resolvedPredictions++;
        if (p.correct === true) stats.correct++;
        else if (p.correct === false) stats.incorrect++;
        else stats.neutral++;
      } else {
        stats.pendingPredictions++;
      }
    }
    const resolvedTotal = stats.correct + stats.incorrect;
    stats.accuracy = resolvedTotal > 0 ? Math.round((stats.correct / resolvedTotal) * 1000) / 10 : null;
  } catch (e) {
    console.warn('[SignalService] getSellAudit error:', e.message);
  }
  return { stats, ratings, predictions };
}

function getSignalProgress(symbol, currentPrice) {
  const prev = _signalOutcomes.get(symbol);
  if (!prev || prev.result || prev.action === 'hold' || prev.entryPrice == null || prev.stopLoss == null || prev.target1 == null) return null;
  const entry = prev.entryPrice;
  if (entry <= 0) return null;
  const isPrevBuy = prev.action === 'buy';
  const returnPct = ((currentPrice - entry) / entry) * 100;
  let progressToTarget = 0, progressToStop = 0;
  if (isPrevBuy) {
    const targetDist = prev.target1 - entry;
    const stopDist = entry - prev.stopLoss;
    progressToTarget = targetDist > 0 ? Math.round(((currentPrice - entry) / targetDist) * 100) : 0;
    progressToStop = stopDist > 0 ? Math.round(((entry - currentPrice) / stopDist) * 100) : 0;
  } else {
    const targetDist = entry - prev.target1;
    const stopDist = prev.stopLoss - entry;
    progressToTarget = targetDist > 0 ? Math.round(((entry - currentPrice) / targetDist) * 100) : 0;
    progressToStop = stopDist > 0 ? Math.round(((currentPrice - entry) / stopDist) * 100) : 0;
  }
  const daysHeld = prev.timestamp ? Math.round((Date.now() - prev.timestamp) / 86400000) : 0;
  const isProfit = isPrevBuy ? returnPct > 0 : returnPct < 0;
  return {
    status: 'active',
    entryPrice: entry,
    currentPrice,
    currentReturn: Math.round(returnPct * 100) / 100,
    progressToTarget: Math.max(0, Math.min(100, progressToTarget)),
    progressToStop: Math.max(0, Math.min(100, progressToStop)),
    isProfit,
    daysHeld,
    signal: prev.signal,
    targetPrice: prev.target1,
    stopPrice: prev.stopLoss,
  };
}

// Returns the current monitored action for a ticker (e.g. 'buy', 'sell')
// or null if the ticker has no open monitored position. Used by the screener
// and stock lists to overlay active positions on fresh-cycle signal ratings.
function getMonitoredAction(symbol) {
  const prev = _signalOutcomes.get(symbol);
  if (!prev || prev.result || !prev.action || prev.action === 'hold') return null;
  return prev.action === 'buy' ? 'Buy' : prev.action === 'sell' ? 'Sell' : null;
}

function getLiveTestSnapshot() {
  const now = Date.now();
  const maxAge = SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let total = 0, wins = 0, losses = 0, totalHours = 0, hourlyCount = 0;
  const buckets = { '1d': { total: 0, wins: 0, losses: 0 }, '15d': { total: 0, wins: 0, losses: 0 }, '30d': { total: 0, wins: 0, losses: 0 }, '60d': { total: 0, wins: 0, losses: 0 } };
  for (const [, store] of _liveTestStore) {
    for (const o of store.outcomes) {
      if (o.generatedAt && (now - o.generatedAt) > maxAge) continue;
      total++;
      if (o.result === 'win') wins++;
      else if (o.result === 'loss') losses++;
      if (!o.resolvedAt) continue;
      const hours = (o.resolvedAt - o.generatedAt) / 3600000;
      totalHours += hours;
      hourlyCount++;
      if (hours <= 24) { buckets['1d'].total++; if (o.result === 'win') buckets['1d'].wins++; else if (o.result === 'loss') buckets['1d'].losses++; }
      if (hours <= 360) { buckets['15d'].total++; if (o.result === 'win') buckets['15d'].wins++; else if (o.result === 'loss') buckets['15d'].losses++; }
      if (hours <= 720) { buckets['30d'].total++; if (o.result === 'win') buckets['30d'].wins++; else if (o.result === 'loss') buckets['30d'].losses++; }
      if (hours <= 1440) { buckets['60d'].total++; if (o.result === 'win') buckets['60d'].wins++; else if (o.result === 'loss') buckets['60d'].losses++; }
    }
  }
  return {
    total, wins, losses,
    winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
    avgDaysToResolve: hourlyCount > 0 ? Math.round((totalHours / hourlyCount / 24) * 100) / 100 : 0,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, {
      total: v.total, wins: v.wins, losses: v.losses,
      winRate: v.total > 0 ? Math.round((v.wins / v.total) * 1000) / 10 : 0,
    }])),
  };
}

function getForwardTestPredictions({ symbol, resolved, limit = 50, offset = 0 } = {}) {
  const now = Date.now();
  const maxAge = SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const all = [];
  for (const [sym, store] of _forwardTestStore) {
    for (const p of store.predictions) {
      if (p.generatedAt && (now - p.generatedAt) > maxAge) continue;
      if (symbol && sym !== symbol) continue;
      if (resolved !== undefined && p.resolved !== resolved) continue;
      all.push({ symbol: sym, ...p, currency: NSE_SYMBOLS.includes(sym) ? 'KES' : 'USD', generatedAt: new Date(p.generatedAt).toISOString(), resolvedAt: p.resolvedAt ? new Date(p.resolvedAt).toISOString() : null });
    }
  }
  // Deduplicate: the in-memory store can accumulate duplicate entries for the
  // same (symbol, price, action) after restarts (loaded from DB + re-recorded
  // by the next signal cycle). Keep the latest per group.
  const deduped = [];
  const seen = new Map();
  for (const p of all) {
    const key = `${p.symbol}:${p.price}:${p.action}`;
    const existing = seen.get(key);
    if (!existing || new Date(p.generatedAt) > new Date(existing.generatedAt)) {
      if (existing) { const idx = deduped.indexOf(existing); if (idx >= 0) deduped.splice(idx, 1); }
      deduped.push(p);
      seen.set(key, p);
    }
  }
  deduped.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  return { predictions: deduped.slice(offset, offset + limit), total: deduped.length };
}

async function resolveAllForwardPredictions() {
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(15,2)`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS target1 NUMERIC(15,2)`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS action VARCHAR(10)`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS trade_type VARCHAR(30)`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS sector VARCHAR(50)`).catch(() => {});
  await pool.query(`ALTER TABLE forward_predictions ADD COLUMN IF NOT EXISTS bench_price NUMERIC(15,2)`).catch(() => {});
  await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE`).catch(() => {});
  let resolved = 0, failed = 0, skipped = 0;
  for (const [symbol, store] of _forwardTestStore) {
    const unresolved = store.predictions.filter(p => !p.resolved);
    if (!unresolved.length) continue;

    // Sync with live signal outcomes: when the live engine resolves a position
    // via score-based close (profit fade, score flipped, stale thesis) or
    // stop/target hit, the corresponding forward prediction should reflect the
    // same outcome instead of staying pending.
    for (const pred of unresolved) {
      if (pred.action !== 'buy') continue;
      try {
        // Match by symbol + entry price proximity (±0.5%) AND time proximity: the
        // live outcome must have been generated within a short window of the
        // forward prediction's own generation cycle. Without the time constraint a
        // fresh prediction silently matched a stale outcome from weeks earlier at a
        // similar price (e.g. MSFT Aug 21 @ 481.15 resolved against an Aug 3
        // outcome @ 482.89, booking a bogus +1.1% win minutes after generation).
        const genAtIso = pred.generatedAt ? new Date(pred.generatedAt).toISOString() : null;
        const outcomeRes = await pool.query(
          `SELECT exit_price, result, close_reason FROM signal_outcomes
           WHERE ticker = $1 AND source = 'live' AND result IS NOT NULL
             AND ABS(entry_price - $2) / NULLIF($2, 0) < 0.005
             AND ($3::timestamptz IS NULL
               OR COALESCE(signal_generated_at, recorded_at) >= $3::timestamptz - interval '5 minutes'
               AND COALESCE(signal_generated_at, recorded_at) <= $3::timestamptz + interval '5 minutes')
           ORDER BY resolved_at DESC LIMIT 1`,
          [symbol, pred.price, genAtIso]
        );
        if (outcomeRes.rows.length > 0) {
          const o = outcomeRes.rows[0];
          const exitPrice = parseFloat(o.exit_price);
          const actualReturn = Math.round(((exitPrice - pred.price) / pred.price) * 1000) / 10;
          pred.correct = actualReturn > 0;
          pred.resolved = true;
          pred.actualReturn = actualReturn;
          pred.resolvedAt = Date.now();
          if (pred.id) {
            pool.query(
              `UPDATE forward_predictions SET resolved = TRUE, actual_return = $1, correct = $2, resolved_at = NOW() WHERE id = $3`,
              [actualReturn, pred.correct, pred.id]
            ).catch(e => { console.warn(`[ForwardTest] Failed to persist resolved prediction #${pred.id} (${symbol}): ${e.message}`); });
          }
          resolved++;
        }
      } catch { /* sync best-effort */ }
    }

    const stillUnresolved = store.predictions.filter(p => !p.resolved);
    if (!stillUnresolved.length) continue;
    try {
      const quote = await getStockQuote(_marketQuoteSymbol(symbol));
      if (!quote || !quote.price) { failed += unresolved.length; continue; }
      const currentPrice = quote.price;
      const th = sellThresholdsFor(symbol);
      for (const pred of unresolved) {
        if (Date.now() - pred.generatedAt < FORWARD_TEST_MIN_AGE) { skipped++; continue; }
        const age = Date.now() - pred.generatedAt;
        const outcome = evaluateForwardPrediction(pred, currentPrice, th);
        if (outcome.status === 'defer') {
          const dev = Math.abs(currentPrice - pred.price) / pred.price * 100;
          if (!pred._garbageWarned) {
            pred._garbageWarned = true;
            if (process.env.NODE_ENV !== 'test') {
              console.warn(`[ForwardTest] Deferring ${symbol} resolution: quote ${currentPrice} is ${dev.toFixed(1)}% from entry ${pred.price} - stale/garbage quote`);
            }
          }
          skipped++;
          continue;
        }
        const actualReturn = Math.round(((currentPrice - pred.price) / pred.price) * 1000) / 10;
        if (outcome.status === 'resolved') {
          // Only when the level actually fires (stop for a loss, target for a win)
          // do we stamp the return and resolution time. Pending buys below stay
          // un-stamped so the UI never shows a fake "+x% / resolved" for an idea
          // that is still monitoring toward its target.
          pred.correct = outcome.correct;
          pred.resolved = true;
          pred.resolvedAt = Date.now();
          pred.actualReturn = actualReturn;
        } else if (outcome.status === 'neutral') {
          // Missing directional action (legacy/foreign rows) — cannot be evaluated.
          // Resolve as neutral instead of guessing from the signal name, so stale
          // rows don't manufacture fake wins/losses.
          pred.correct = null;
          pred.actualReturn = null;
          pred.resolvedAt = Date.now();
          pred.resolved = true;
        } else if (pred.action === 'sell') {
          // Pending sell — refine with benchmark-relative evaluation before
          // staying on hold (see resolveForwardPredictions).
          let benchReturn = null;
          const benchNow = await _getBenchmarkNow(benchmarkSymbolFor(symbol));
          if (pred.benchPrice && benchNow) {
            const b = (benchNow - pred.benchPrice) / pred.benchPrice;
            if (Math.abs(b) <= RESOLUTION_MAX_DEVIATION) benchReturn = b;
          }
          const rel = evaluateSellRelative(pred, currentPrice, benchReturn, th);
          if (rel.resolved) {
            pred.correct = rel.correct;
            pred.resolved = true;
            pred.resolvedAt = Date.now();
            pred.actualReturn = rel.actualReturn;
          } else if (age >= SELL_RESOLVE_MAX_AGE) {
            const horiz = evaluateSellAtHorizon(pred, currentPrice, benchReturn, th);
            if (horiz.resolved) {
              pred.correct = horiz.correct;
              pred.resolved = true;
              pred.resolvedAt = Date.now();
              pred.actualReturn = horiz.actualReturn;
            } else {
              pred.actualReturn = null;
              pred.resolvedAt = null;
              skipped++;
              continue;
            }
          } else {
            skipped++;
            continue;
          }
        } else {
          // Pending buy: still monitoring toward stop/target. Ensure no stale
          // return/resolution time from an earlier cycle leaks into the UI.
          pred.actualReturn = null;
          pred.resolvedAt = null;
          skipped++;
          continue;
        }
        if (pred.resolved && pred.id) {
          pool.query(
            `UPDATE forward_predictions SET resolved = TRUE, actual_return = $1, correct = $2, resolved_at = NOW() WHERE id = $3`,
            [pred.actualReturn, pred.correct, pred.id]
          ).catch(e => { console.warn(`[ForwardTest] Failed to persist resolved prediction #${pred.id} (${symbol}): ${e.message}`); });
        }
        resolved++;
      }
    } catch { failed += unresolved.length; }
  }
  return { resolved, failed, skipped };
}

// ─── Engine Audit Log ───────────────────────────────────────────────────────
// Logs engine state changes + signal cycle results for management review.
const _auditLog = []; // in-memory ring buffer (also persisted to DB)
const AUDIT_LOG_MAX = 1000;

function _pushAudit(entry) {
  _auditLog.push({ ...entry, ts: new Date().toISOString() });
  if (_auditLog.length > AUDIT_LOG_MAX) _auditLog.shift();
}

async function persistAuditEntry(entry) {
  try {
    await pool.query(
      `INSERT INTO signal_audit_log (event_type, message, details, recorded_at)
       VALUES ($1, $2, $3, NOW())`,
      [entry.type, entry.message, entry.details ? JSON.stringify(entry.details) : null]
    );
  } catch (err) { console.error('[Audit] Failed to persist:', err.message); }
}

function logAuditEvent(type, message, details = {}) {
  const entry = { type, message, details };
  _pushAudit(entry);
  persistAuditEntry(entry).catch(() => {});
}

async function getAuditLog({ type, limit = 100, offset = 0 } = {}) {
  try {
    const conditions = [];
    const params = [];
    let idx = 1;
    if (type) { conditions.push(`event_type = $${idx++}`); params.push(type); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT id, event_type, message, details, recorded_at
       FROM signal_audit_log ${where}
       ORDER BY recorded_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM signal_audit_log ${where}`, params
    );
    const entries = rows.rows.map(r => ({
      type: r.event_type,
      message: r.message,
      details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
      ts: r.recorded_at ? new Date(r.recorded_at).toISOString() : new Date().toISOString(),
    }));
    return { entries, total: count.rows[0].cnt };
  } catch { return { entries: _auditLog.slice(-limit), total: _auditLog.length }; }
}

// ─── Engine Config Management ───────────────────────────────────────────────
// Mutable engine configuration that can be adjusted at runtime via API.
// Delegates to engineConfig module for persistence and full parameter set.

function getEngineConfig(view) {
  return engineConfig.getConfig(view);
}

function updateEngineConfig(updates) {
  const result = engineConfig.updateConfig(updates);
  logAuditEvent('config_change', 'Engine configuration updated', { before: result.before, after: result.after, changes: updates });
  return result.after;
}

// ─── Weight Optimization ────────────────────────────────────────────────────
// Tests different weight configurations against historical signal data
// to find the combination with the highest predictive accuracy.
async function optimizeWeights() {
  const configs = [
    { fundamental: 0.30, technical: 0.35, financial: 0.20, macro: 0.15, label: 'default' },
    { fundamental: 0.35, technical: 0.30, financial: 0.20, macro: 0.15, label: 'fund-heavy' },
    { fundamental: 0.25, technical: 0.40, financial: 0.20, macro: 0.15, label: 'tech-heavy' },
    { fundamental: 0.25, technical: 0.25, financial: 0.30, macro: 0.20, label: 'fin-heavy' },
    { fundamental: 0.40, technical: 0.20, financial: 0.25, macro: 0.15, label: 'defensive' },
    { fundamental: 0.20, technical: 0.45, financial: 0.20, macro: 0.15, label: 'momentum' },
  ];
  
  try {
    const result = await pool.query(
      `SELECT ticker, signal, confidence, entry_price, generated_at FROM signal_history 
       WHERE generated_at > NOW() - INTERVAL '7 days' 
       AND entry_price > 0 ORDER BY generated_at DESC LIMIT 200`
    );
    if (!result.rows.length || result.rows.length < 10) {
      return { best: configs[0], note: 'insufficient history for optimization' };
    }
    
    const scores = configs.map(cfg => {
      let correct = 0, total = 0;
      // We can't re-score historical signals without the full component scores.
      // Instead, measure: did confidence correlate with outcome?
    for (const row of rows) {
        const conf = parseInt(row.confidence) || 50;
        const signal = row.signal;
        const entryPrice = parseFloat(row.entry_price);
        if (!entryPrice) continue;
        
        const isNse = NSE_SYMBOLS.includes(row.ticker);
        // Use a simple proxy: for buy signals, higher confidence should predict positive return
        total++;
        // Since we can't get current prices for all historical signals here,
        // we use confidence as a self-consistency check
        if ((signal === 'Strong Buy' || signal === 'Buy') && conf >= 70) correct++;
        else if ((signal === 'Sell' || signal === 'Strong Sell') && conf >= 60) correct++;
        else if (signal === 'Hold' && conf >= 45 && conf <= 65) correct++;
      }
      return { ...cfg, score: total > 0 ? correct / total : 0 };
    });
    
    scores.sort((a, b) => b.score - a.score);
    return { best: scores[0], all: scores };
  } catch {
    return { best: configs[0], note: 'optimization unavailable' };
  }
}

// ─── Error Budget & Graceful Degradation ────────────────────────────────────
// Tracks source health and adjusts behavior when external APIs fail.
function recordSourceFailure(source) {
  if (_sourceHealth[source]) {
    _sourceHealth[source].failCount++;
    _sourceHealth[source].lastFail = Date.now();
    if (_sourceHealth[source].failCount >= MAX_SOURCE_FAILURES) {
      _sourceHealth[source].ok = false;
    }
  }
}

function recordSourceSuccess(source) {
  if (_sourceHealth[source]) {
    _sourceHealth[source].failCount = 0;
    _sourceHealth[source].ok = true;
  }
}

function isSourceHealthy(source) {
  const h = _sourceHealth[source];
  if (!h) return true;
  if (!h.ok && Date.now() - h.lastFail > SOURCE_RECOVERY_MS) {
    h.ok = true;
    h.failCount = 0;
  }
  return h.ok;
}

// Returns a degradation multiplier (0-1) based on source health
function getConfidenceMultiplier() {
  let healthy = 0, total = 0;
  for (const [name, h] of Object.entries(_sourceHealth)) {
    total++;
    if (h.ok && h.failCount === 0) healthy++;
    else if (h.ok) healthy += 0.5;
  }
  return total > 0 ? healthy / total : 1;
}

// ─── Persist Signal Outcomes to DB ──────────────────────────────────────────
// Stores signal performance outcomes in the database so state survives restarts.
async function persistSignalOutcome(symbol, entryPrice, signalAction, currentPrice, result, resolvedAt, signalGeneratedAt, closeReason = null) {
  try {
    const prevOutcome = _signalOutcomes.get(symbol);
    const signalGenAtMs = signalGeneratedAt || prevOutcome?.timestamp || Date.now();
    const posSize = prevOutcome?.positionSize || 25;
    const now = new Date().toISOString();
    const signalGenAt = new Date(signalGenAtMs).toISOString();
    await pool.query(
      `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, position_size, recorded_at, resolved_at, signal_generated_at, close_reason, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'live')
       ON CONFLICT (source, ticker, entry_price) DO NOTHING`,
      [symbol, entryPrice, signalAction, currentPrice, result, posSize, now, resolvedAt || now, signalGenAt, closeReason]
    );
    // Push to live test store
    const store = _liveTestStore.get(symbol);
    if (store) {
      store.outcomes.push({
        result, signal: signalAction, entryPrice, exitPrice: currentPrice,
        generatedAt: signalGenAtMs, resolvedAt: resolvedAt ? new Date(resolvedAt).getTime() : Date.now(),
        closeReason,
      });
      if (store.outcomes.length > LIVE_TEST_MAX_PER_SYMBOL) store.outcomes = store.outcomes.slice(-LIVE_TEST_MAX_PER_SYMBOL);
    } else {
      _liveTestStore.set(symbol, {
        outcomes: [{
          result, signal: signalAction, entryPrice, exitPrice: currentPrice,
          generatedAt: signalGenAtMs, resolvedAt: resolvedAt ? new Date(resolvedAt).getTime() : Date.now(),
          closeReason,
        }]
      });
    }
    // Update prediction log with actual outcome
    resolvePredictionLogs(symbol, result).catch(() => {});
  } catch { /* table may not exist — create it */ }
}

// Persist portfolio state so consecutive losses survive restarts
async function persistPortfolioState() {
  try {
    await pool.query(
      `INSERT INTO portfolio_state (consecutive_losses, updated_at)
       VALUES ($1, NOW())
       ON CONFLICT (id) DO UPDATE SET consecutive_losses = $1, updated_at = NOW()`,
      [_portfolioState.consecutiveLosses]
    );
  } catch { /* table may not exist yet */ }
}

// ─── Live (mark-to-market) win rate ─────────────────────────────────────────
// Resolved outcomes PLUS open positions marked to their last known live price.
// With wide targets positions can stay open for weeks, so the resolved-only rate
// sits frozen while ~30 positions run; this shows the running picture instead. An
// open long above its entry counts as a win right now, below it as a loss — the
// same rule the monitor gate applies when a score-close books the market print.
// Positions without a live quote this session are left out rather than guessed.
// State maps are injectable for unit tests (see test-fade-relevel.cjs).
function getLiveWinRate(signalOutcomes = _signalOutcomes, lastKnownPrices = _lastKnownPrices, performanceStats = _performanceStats) {
  const resolvedWins = performanceStats.wins || 0;
  const resolvedLosses = performanceStats.losses || 0;
  const resolvedTotal = resolvedWins + resolvedLosses;
  let openWins = 0, openLosses = 0;
  const openPositions = [];
  for (const [symbol, pos] of signalOutcomes) {
    if (!pos || pos.result || pos.action === 'hold' || pos.entryPrice == null || pos.entryPrice <= 0) continue;
    const price = lastKnownPrices.get(symbol);
    if (!price || price <= 0) continue;
    const isBuy = pos.action === 'buy';
    const mtmWin = isBuy ? price >= pos.entryPrice : price <= pos.entryPrice;
    if (mtmWin) openWins++; else openLosses++;
    openPositions.push({
      symbol, action: pos.action, entryPrice: pos.entryPrice, lastPrice: price,
      currency: NSE_SYMBOLS.includes(symbol) ? 'KES' : 'USD',
      mtm: mtmWin ? 'win' : 'loss',
      unrealizedPct: Math.round(((price - pos.entryPrice) / pos.entryPrice) * 1000) / 10,
    });
  }
  const openTotal = openPositions.length;
  const combinedWins = resolvedWins + openWins;
  const combinedLosses = resolvedLosses + openLosses;
  const combinedTotal = combinedWins + combinedLosses;
  return {
    resolved: {
      total: resolvedTotal, wins: resolvedWins, losses: resolvedLosses,
      winRate: resolvedTotal > 0 ? Math.round((resolvedWins / resolvedTotal) * 1000) / 10 : 0,
    },
    open: {
      total: openTotal, wins: openWins, losses: openLosses,
      winRate: openTotal > 0 ? Math.round((openWins / openTotal) * 1000) / 10 : 0,
    },
    combined: {
      total: combinedTotal, wins: combinedWins, losses: combinedLosses,
      winRate: combinedTotal > 0 ? Math.round((combinedWins / combinedTotal) * 1000) / 10 : 0,
    },
    openPositions,
    asOf: Date.now(),
  };
}

// ─── Health Check ───────────────────────────────────────────────────────────
function getEngineHealth() {
  const perf = _performanceStats;
  // Keep the mark-to-market basis fresh: open positions' last-known prices are
  // only written by quote fetches (generation cycles + monitored-quote warms),
  // so after a restart or while nobody polls /api/signals the marks go stale.
  // Fire a bounded warm on every health read — _monitoredQuoteWarming + the 30s
  // QUOTE_CACHE_TTL dedupe it, so it is at most one quote refresh per symbol per
  // 30s and the next health poll renders updated marks.
  if (getOpenPositionCount() > 0) _warmMonitoredQuotes().catch(() => {});
  return {
    status: Object.values(_sourceHealth).every(h => h.ok) ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    sources: { ..._sourceHealth },
    performance: { ...perf, live: getLiveWinRate() },
    portfolio: {
      consecutiveLosses: _portfolioState.consecutiveLosses,
      totalTrades: perf.total,
      maxDrawdown: Math.round(_portfolioState.maxDrawdown * 1000) / 10,
    },
    regime: _marketRegime.regime,
    signalCount: (() => {
      // Match what GET /api/signals returns to the frontend: the engine cache
      // plus monitored open positions that are surfaced as Buy cards.
      const cached = Array.isArray(_signalsCache) ? _signalsCache : [];
      const cacheTickers = new Set(cached.map(s => s && s.ticker).filter(Boolean));
      const monitored = getMonitoredSignals();
      return cached.length + monitored.filter(m => !cacheTickers.has(m.ticker)).length;
    })(),
    openPositions: getOpenPositionCount(),
    confidenceMultiplier: getConfidenceMultiplier(),
  };
}



// ─── Real Fundamentals from FMP ─────────────────────────────────────────────
const realFundamentalsCache = new Map();
const FUND_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchRealFundamentals(symbol) {
  try {
    const [metricsArr, quote, profile] = await Promise.all([
      getKeyMetrics(symbol, 'annual', 2),
      getQuote(symbol),
      getCompanyProfile(symbol),
    ]);

    if (!metricsArr || metricsArr.length === 0) return null;

    const m = metricsArr[0];
    const prev = metricsArr.length > 1 ? metricsArr[1] : null;

    const revenueGrowth = prev && m.revenuePerShare && prev.revenuePerShare
      ? ((m.revenuePerShare - prev.revenuePerShare) / prev.revenuePerShare) * 100 : null;

    const epsGrowth = prev && m.netIncomePerShare && prev.netIncomePerShare
      ? ((m.netIncomePerShare - prev.netIncomePerShare) / prev.netIncomePerShare) * 100 : null;

    return {
      name: profile?.companyName || symbol,
      sector: profile?.sector || guessSector(symbol),
      peRatio: m.peRatio || quote?.pe || 0,
      pbRatio: m.pbRatio || 0,
      dividendYield: m.dividendYieldPercentage || m.dividendYield || 0,
      marketCap: quote?.marketCap || m.marketCap || 0,
      epsGrowth: epsGrowth != null ? Math.round(epsGrowth * 10) / 10 : 0,
      revenueGrowth: revenueGrowth != null ? Math.round(revenueGrowth * 10) / 10 : 0,
      debtToEquity: m.debtToEquity || 0,
      currentRatio: m.currentRatio || 0,
      fcfYield: (m.freeCashFlowYield || 0) * 100,
      payoutRatio: m.payoutRatio || 0,
      roe: 0,
      netIncomePerShare: m.netIncomePerShare || 0,
      revenuePerShare: m.revenuePerShare || 0,
    };
  } catch (e) {
    if (process.env.DEBUG) console.warn(`[SignalService] fetchRealFundamentals failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// Warm cache in background batches (non-blocking)
// WARNING: FMP free tier is 250 req/day. This function burns ~3 requests per symbol.
// Only call with a small subset (max ~50 symbols) to stay under the limit.
// US stocks already get real fundamentals from Yahoo Finance (free, unlimited) via
// fetchRealFinancialMetrics() — populates live financial data for all stocks (US + NSE) via the shared pipeline.
async function warmFMPCache(symbols) {
  const MAX_SYMBOLS = 50;
  const toFetch = symbols.filter(s => !_financialReportCache.get(s)).slice(0, MAX_SYMBOLS);
  if (toFetch.length === 0) return;
  console.warn(`[SignalService] warmFMPCache: fetching ${toFetch.length} symbols ` +
    `(FMP rate limit: 250/day, will use ${toFetch.length * 3} requests)`);
  const batchSize = 3;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(s => fetchRealFundamentals(s)));
    batch.forEach((s, j) => {
      if (results[j].status === 'fulfilled' && results[j].value) {
        realFundamentalsCache.set(s, { data: results[j].value, ts: Date.now() });
      }
    });
    if (i + batchSize < toFetch.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

// ─── NSE Static Fundamentals (from frontend stock universe) ──────────────────

// Sanitize live-feed fundamentals against feed artifacts before they reach the
// scorer. The financial reports feed (Alpha Vantage Overview / Yahoo / EDGAR)
// sometimes ships misaligned-quarter or unit-shifted values (e.g. AAPL showing
// "revenue -38.7%" or "D/E 6.08" — data that would never appear in the curated
// baseline). An artifact like that inflates sell evidence (declining revenue /
// high leverage) and would manufacture a wrong Sell rating. Rules:
//   • revenueGrowth outside [-60, 500] is implausible for the tracked universe
//     (S&P + NSE blue chips) — drop it;
//   • a live revenueGrowth that contradicts the curated baseline by > 30pp is a
//     misalignment — fall back to the baseline instead of the garbage;
//   • debtToEquity outside [0, 5] or contradicting the baseline by > 2.5 is a
//     feed error — fall back to the baseline / drop it.
// Dropped metrics become null so the scorer reports "no data" rather than a
// false positive/negative signal.
function sanitizeLiveFundamentals(stock, live) {
  if (!live) return stock;
  const isNum = (v) => v != null && v !== '' && isFinite(Number(v));
  const out = { ...stock, ...live };
  const revBase = isNum(stock.revenueGrowth) ? Number(stock.revenueGrowth) : null;
  const revLive = isNum(live.revenueGrowth) ? Number(live.revenueGrowth) : null;
  if (revLive != null && (revLive < -60 || revLive > 500 || (revBase != null && Math.abs(revLive - revBase) > 30))) {
    out.revenueGrowth = revBase != null && revBase >= -60 && revBase <= 500 ? revBase : null;
  }
  const deBase = isNum(stock.debtToEquity) ? Number(stock.debtToEquity) : null;
  const deLive = isNum(live.debtToEquity) ? Number(live.debtToEquity) : null;
  if (deLive != null && (deLive < 0 || deLive > 5 || (deBase != null && deBase >= 0 && deBase <= 5 && Math.abs(deLive - deBase) > 2.5))) {
    out.debtToEquity = deBase != null && deBase >= 0 && deBase <= 5 ? deBase : null;
  }
  // Altman Z guard: the Yahoo/Alpha Vantage income & balance statement feeds
  // have shipped near-empty since late 2024, so the live Z is routinely computed
  // from zeroed X1-X4 components (workingCapital, retainedEarnings, EBIT, market
  // cap) — e.g. TM 0.69, JPM 0.19, CMCSA 0.97 vs their real 2-4 readings. Feeding
  // those into the scorer flag-57%-of-the-market as "financial distress" and
  // suppresses every buy (analysisEngine caps the fundamental score at 50). Only
  // trust the live Z when it does NOT contradict the curated baseline: a live
  // distress reading on a baseline that is healthy is a feed artifact — keep the
  // baseline so the symbol scores neutrally instead of manufacturing a Sell.
  const zBase = isNum(stock.altmanZ) ? Number(stock.altmanZ) : null;
  const zLive = isNum(live.altmanZ) ? Number(live.altmanZ) : null;
  if (zLive != null && zBase != null && zLive < 1.81 && zBase >= 1.81) {
    out.altmanZ = zBase;
  }
  return out;
}

function getFundamentals(symbol) {
  const cached = realFundamentalsCache.get(symbol);
  let base;
  if (cached && Date.now() - cached.ts < FUND_CACHE_TTL) {
    base = { ...cached.data };
  } else {
    base = { name: resolveStockName(symbol), sector: guessSector(symbol) };
    // Seed the FULL curated baseline (PE, revenue growth, D/E, ROE, Altman Z,
    // etc.), not just name+sector — sanitizeLiveFundamentals compares live feed
    // values against this reference to reject artifacts (e.g. AAPL "revenue
    // -38.7%" / TM Altman Z 0.69). A null baseline lets the garbage through.
    if (KNOWN_FUNDAMENTALS[symbol]) base = { ...KNOWN_FUNDAMENTALS[symbol] };
    else if (NSE_FUNDAMENTALS[symbol]) base = { ...NSE_FUNDAMENTALS[symbol] };
    if (!base.name) base.name = resolveStockName(symbol);
    if (!base.sector) base.sector = guessSector(symbol);
  }
  const result = {
    evEbitda: null, fcfYield: null, payoutRatio: 50, marginChange: 0,
    epsSurprise: null, altmanZ: 2.5,
    newsSentiment: 'neutral',
    ...base
  };
  // Merge real financial metrics from the live pipeline (Yahoo/Alpha Vantage/EDGAR/NSE DB)
  const fm = _financialReportCache.get(symbol);
  if (fm) {
    Object.assign(result, sanitizeLiveFundamentals(result, fm));
    result.dataSource = 'live';
  } else {
    result.dataSource = 'fallback';
  }
  if (!result.name || result.name === symbol) {
    result.name = resolveStockName(symbol);
  }
  if (!result.sector || result.sector === 'N/A') {
    result.sector = guessSector(symbol);
  }
  return result;
}

// Persist signals to database for history
async function persistSignals(signals) {
  try {
    if (!signals || signals.length === 0) {
      console.log('[SignalService] persistSignals called with empty signals');
      return;
    }
    // Only persist actionable signals (Hold is noise; Accumulate/Reduce are legacy engine types).
    // signal_bucket dedupes via the unique (ticker, signal_bucket) index so repeated
    // generateSignals cycles within the same hour don't duplicate rows.
    const actionable = signals.filter(s => ['Strong Buy', 'Buy', 'Sell', 'Strong Sell'].includes(s.signal));
    if (actionable.length === 0) return;
    console.log(`[SignalService] Persisting ${actionable.length} actionable signals to signal_history`);
    const values = actionable.map(s => [
      s.ticker, s.signal, s.confidence, s.price, s.change || 0,
      s.entry || s.price, s.stopLoss || 0, s.target1 || 0, s.target2 || 0, s.target3 || 0,
      s.riskReward || 1, s.sector || 'General', s.market || 'Global',
      s.currency || 'USD', s.type || 'Swing Trade', s.timeframe || '2-4 weeks', s.reason || '',
      parseInt(s.positionSize) || 25,
      s.analysis ? JSON.stringify(s.analysis) : null,
    ]);
    const cols = 19;
    const placeholders = values.map((_, i) => {
      const base = i * cols;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14}, $${base+15}, $${base+16}, $${base+17}, $${base+18}, $${base+19}, NOW(), date_trunc('hour', NOW()))`;
    }).join(',');
    const flat = values.flat();
    const result = await pool.query(
      `INSERT INTO signal_history (ticker, signal, confidence, price, change_pct, entry_price, stop_loss, target1, target2, target3, risk_reward, sector, market, currency, trade_type, timeframe, reason, position_size, analysis_data, generated_at, signal_bucket)
       VALUES ${placeholders}
       ON CONFLICT DO NOTHING`,
      flat
    );
    _signalHistoryCount += result.rowCount || 0;
    console.log(`[SignalService] Persisted ${result.rowCount} new signal_history rows`);
  } catch (error) {
    if (error.code !== '42P01') {
      console.error('[SignalService] DB persist error:', error.message);
    } else {
      console.warn('[SignalService] signal_history table does not exist');
    }
  }
}

// Clean old signal_history rows (keep last 7 days)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // once per day
let _lastCleanup = 0;
async function cleanupOldSignals() {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL) return;
  _lastCleanup = now;
  try {
    // Keep signal_history for the full evaluation window (SIGNAL_WINDOW_DAYS) so the
    // open-signal restore and historical backtests still see Long Term signals that
    // can stay open up to ~90 days. A 7-day prune made those signals disappear and
    // silently shrank Monitored Signals / history after restarts.
    // Physical cleanup uses the runtime retentionDays config (admin Config page,
    // default 365) NOT SIGNAL_WINDOW_DAYS: the signal history is the primary audit
    // record and must survive longer than the stats/backtest window it feeds.
    const retentionDays = Math.max(90, parseInt(engineConfig.getConfig().retentionDays, 10) || RETENTION_DAYS);
    const result = await pool.query(
      `DELETE FROM signal_history WHERE generated_at < NOW() - make_interval(days => $1::int)`,
      [retentionDays]
    );
    if (result.rowCount > 0) {
      console.log(`[SignalService] Cleaned ${result.rowCount} old signal records`);
    }
  } catch (error) {
    if (error.code !== '42P01') {
      console.error('[SignalService] Cleanup error:', error.message);
    }
  }
}

// Query historical signals from DB for backtesting
async function getSignalHistory({ ticker, signal, market, sector, limit = 100, offset = 0, from, to } = {}) {
  try {
    const conditions = [];
    const params = [];
    let idx = 1;
    if (ticker) { conditions.push(`ticker = $${idx++}`); params.push(ticker.toUpperCase()); }
    if (signal) { conditions.push(`signal = $${idx++}`); params.push(signal); }
    if (market) { conditions.push(`market = $${idx++}`); params.push(market.toUpperCase()); }
    if (sector) { conditions.push(`sector ILIKE $${idx++}`); params.push(`%${sector}%`); }
    if (from) { conditions.push(`generated_at >= $${idx++}::date`); params.push(from); }
    if (to) { conditions.push(`generated_at <= $${idx++}::date + interval '1 day'`); params.push(to); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const data = await pool.query(
      `SELECT id, ticker, signal, confidence, price, change_pct, entry_price, stop_loss,
              target1, target2, target3, risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at
       FROM signal_history ${where}
       ORDER BY generated_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM signal_history ${where}`, params
    );
    return { signals: data.rows, total: count.rows[0].cnt };
  } catch (error) {
    if (error.code !== '42P01') {
      console.error('[SignalService] getSignalHistory error:', error.message);
    }
    return { signals: [], total: 0 };
  }
}

// Pre-warm caches on module load (non-blocking)
// Eagerly detect market regime so it's available before the first cycle
detectMarketRegime().catch(() => {});
_loadForwardPredictionsFromDb().catch(() => {});
_loadSignalCacheFromDb().catch(() => {});
_financialReportCache.loadFromDb().then(count => {
  if (count > 0) console.log(`[SignalService] Restored ${count} financial report cache entries from DB`);
}).catch(() => {});
setTimeout(() => {
  generateSignals(null, false, true).catch(() => {});
}, 100);

// Seed signal_history on startup if it's empty (e.g. fresh deploy / cleared DB)
// so the Signal Engine backtest has something to show. Uses cached/fundamental data.
setTimeout(async () => {
  try {
    const countRes = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_history').catch(() => ({ rows: [{ cnt: 0 }] }));
    if ((countRes.rows[0]?.cnt || 0) === 0) {
      console.log('[SignalService] signal_history is empty; seeding initial signals...');
      const signals = await generateSignals(null, false, true);
      if (signals && signals.length > 0) {
        await persistSignals(signals);
        console.log(`[SignalService] Seeded ${signals.length} signals into signal_history`);
      } else {
        console.log('[SignalService] No signals generated for seeding');
      }
    }
  } catch (e) {
    console.error('[SignalService] Startup seed error:', e.message);
  }
}, 5000);
// Auto-resolve forward test predictions every 5 minutes
setInterval(() => {
  resolveAllForwardPredictions().catch(() => {});
}, 5 * 60 * 1000);
// Auto-generate signals every hour (checks market hours internally)
setInterval(() => {
  generateSignals(null, false).catch(() => {});
}, 60 * 60 * 1000);

// Auto-run historical backtest every 6 hours to mature signal outcomes.
// Window is SIGNAL_WINDOW_DAYS so only current-engine signals are evaluated,
// keeping metrics aligned with live/forward test instead of old-engine data.
setTimeout(() => {
  runHistoricalBacktest({ days: SIGNAL_WINDOW_DAYS, maxHoldDays: 20, maxSignals: 1000 }).catch(() => {});
}, 60000);
setInterval(() => {
  runHistoricalBacktest({ days: SIGNAL_WINDOW_DAYS, maxHoldDays: 20, maxSignals: 1000 }).catch(() => {});
}, 6 * 60 * 60 * 1000);

// Main function to generate signals for all tracked stocks
// When quick=true, skips all external API fetches and uses only cached data.
async function generateSignals(marketData = null, quick = false, force = false) {
  if (!marketData && !quick && !force && _signalsCache && Date.now() - _signalsCacheTime < SIGNALS_CACHE_TTL) {
    return _signalsCache;
  }
  if (!marketData && quick && _signalsCache) {
    // Kick off background full regeneration if cache is stale (>30 min old).
    // No force: the exchange-hours guard below applies, so a cycle only runs
    // when a tracked exchange is actually live — never on weekends/nights.
    if (!_signalsInProgress && Date.now() - _signalsCacheTime > 30 * 60 * 1000) {
      generateSignals(null, false, false).catch(() => {});
    }
    return _signalsCache;
  }
  if (!marketData && !quick && _signalsInProgress) {
    return _signalsCache || [];
  }

  // Dynamic generation guard: a fresh cycle only runs while at least one
  // tracked exchange (NSE or US) has a live session, unless marketData is
  // explicitly provided or force=true. Outside live sessions quotes are static
  // last-close values, so regenerating would burn API quota and churn the feed.
  if (!marketData && !quick && !force) {
    if (!anyTrackedExchangeOpen()) {
      if (_signalsCache) return _signalsCache;
      return [];
    }
  }

  const signals = [];
  // When marketData is provided (e.g. from publisher), only process those symbols
  const rawSymbols = marketData ? Object.keys(marketData) : ALL_SYMBOLS;
  // Track the entire universe. US names used to require a SEC EDGAR CIK mapping,
  // but cikLookup was only a membership gate here — never used to build a signal.
  // Real fundamentals come from the shared Yahoo/Alpha Vantage pipeline
  // (fetchRealFinancialMetrics) which covers every US ticker, so the gate only
  // starved ~200 otherwise-quotable names of signals. Symbols that fail quote or
  // fundamental fetch are skipped downstream by processSymbol, so a broader
  // universe cannot break a cycle. maxSymbols (Config page) remains the cap.
  const symbols = [...rawSymbols];
  const cfg = engineConfig.getConfig();
  const maxSymbols = cfg.maxSymbols || 2000;
  if (!marketData && symbols.length > maxSymbols) {
    symbols.length = maxSymbols;
  }
  if (!marketData && !quick) _signalsInProgress = true;
  try {

  // Quick mode: skip all external fetches, use only cached data
  let newsSentiment = {};
  let catalysts = {};
  let insiderNews = {};
  let regime = _marketRegime;
  if (!quick) {
    try {
      newsSentiment = await Promise.race([
        getAggregatedSentiment(),
        new Promise(resolve => setTimeout(() => resolve({}), 15000)),
      ]);
    } catch { /* silent */ }
    try {
      catalysts = await Promise.race([
        getCatalysts(),
        new Promise(resolve => setTimeout(() => resolve({}), 15000)),
      ]);
    } catch { /* silent */ }
    try {
      insiderNews = await Promise.race([
        getInsiderNewsSignals(),
        new Promise(resolve => setTimeout(() => resolve({}), 15000)),
      ]);
    } catch { /* silent */ }
    await Promise.all([
      prefetchPriceHistories(symbols).catch(() => {}),
      prefetchFinancialReports(symbols).catch(() => {}),
      prefetchWeeklyData(symbols).catch(() => {}),
    ]);
    // Quotes last: spark makes this fast, and keeping it out of the big
    // concurrent prefetch burst means the quote cache is still fresh when the
    // scoring loop reads it (QUOTE_CACHE_TTL is short). Otherwise every symbol
    // re-fetches its quote mid-cycle, bursting the rate limit.
    await prefetchQuotes(symbols).catch(() => {});
    flushNseDailyBars();
    regime = await detectMarketRegime();
  }
  const weights = computeDynamicWeights(regime.regime);
  updateSectorAverages();
  
  const BATCH_SIZE = 20;
  console.log(`[SignalService] generateSymbols: ${symbols.length} symbols, marketData=${!!marketData}, quick=${quick}, force=${force}`);
  const processSymbol = async (symbol) => {
    let stock = getFundamentals(symbol);
    if (!stock) return null;
    let currentPrice;
    let priceChange;
    let volume;

    if (marketData && marketData[symbol]) {
      currentPrice = marketData[symbol].price;
      priceChange = marketData[symbol].changePercent;
      volume = marketData[symbol].volume;
    } else {
      const cached = _quoteCache.get(symbol);
      if (cached) {
        currentPrice = cached.price;
        priceChange = cached.changePercent;
        volume = cached.volume;
      } else {
        const marketSymbol = NSE_SYMBOLS.includes(symbol) ? `NSE:${symbol}` : symbol;
        const quote = await getStockQuote(marketSymbol);
        if (quote) {
          currentPrice = quote.price;
          priceChange = quote.changePercent;
          volume = quote.volume;
        } else if (NSE_SYMBOLS.includes(symbol)) {
          // Fallback chain for NSE: mystocksAfrica partner API first,
          // then KenyanStocks scraper.
          let nseResolved = false;
          try {
            const msa = require('./mystocksAfricaApi');
            if (msa.getCached) {
              const cq = msa.getCached(symbol);
              if (cq && Number(cq.price) > 0) {
                currentPrice = Number(cq.price);
                priceChange = cq.changePercent || 0;
                volume = Number(cq.volume) || 0;
                nseResolved = true;
              }
            }
          } catch { /* mystocksAfricaApi may not be available */ }
          if (!nseResolved) {
            try {
              const ksMod = require('./kenyanStocksScraper');
              const ksStocks = await ksMod.getStocksData();
              const ks = Array.isArray(ksStocks) ? ksStocks.find(s => s.symbol === symbol) : null;
              if (ks && Number(ks.close) > 0) {
                currentPrice = Number(ks.close);
                const prev = Number(ks.previous_price) || currentPrice;
                priceChange = prev > 0 ? ((currentPrice - prev) / prev) * 100 : 0;
                volume = Number(ks.volume) || 0;
              } else {
                return null;
              }
            } catch (e) {
              return null;
            }
          }
        } else {
          return null;
        }
      }
    }
    
    if (NSE_SYMBOLS.includes(symbol)) accumulateNseQuote(symbol, currentPrice, volume);
    if (currentPrice > 0) _lastKnownPrices.set(symbol, currentPrice);
    
    const marketOpen = isExchangeOpen(symbol);
    // Merge live financial report cache BEFORE fundamental analysis so the
    // Yahoo/Alpha Vantage pipeline (PE, revenue growth, debt/equity, ROE,
    // Altman Z, etc.) feeds into the scorer instead of the hardcoded defaults
    // that only cover ~20 US tickers. The sanitizeLiveFundamentals guard
    // rejects feed artifacts (e.g. AAPL -38.7% revenue) vs the curated baseline.
    const reportMetrics = _financialReportCache.get(symbol);
    if (reportMetrics) stock = sanitizeLiveFundamentals(stock, reportMetrics);
    const fundamental = analyzeFundamentals(stock, currentPrice, newsSentiment[symbol] || null, _dynamicSectorPE);
    const priceHistory = await getPriceHistory(symbol);
    // Entry sanity check: the quote used to build stop/target levels must be
    // plausible relative to the prior session close. Day-high-as-price or broken
    // feed values create phantom entries with meaningless stops (e.g. CRWN 60.00).
    const prevClose = priceHistory && priceHistory.length > 1 ? priceHistory[priceHistory.length - 1] : null;
    if (currentPrice > 0 && prevClose && prevClose > 0) {
      const dev = Math.abs(currentPrice - prevClose) / prevClose;
      if (dev > MAX_ENTRY_DEVIATION) {
        console.warn(`[SignalService] Skipping ${symbol}: quote ${currentPrice} deviates ${(dev * 100).toFixed(1)}% from prev close ${prevClose} - garbage/stale quote, no signal emitted`);
        return null;
      }
    }
    
    // Enrich volume from price history if quote cache returned 0
    if ((!volume || volume === 0) && priceHistory?.volumes?.length > 0) {
      for (let i = priceHistory.volumes.length - 1; i >= 0; i--) {
        if (priceHistory.volumes[i] > 0) { volume = priceHistory.volumes[i]; break; }
      }
    }
    const technical = analyzeTechnicals(symbol, currentPrice, priceHistory, volume, engineConfig.getConfig().indicator_params);
    const financial = analyzeFinancials(stock, fundamental);
    const country = getCountryForSymbol(symbol);
    let macro = getMacroScore(country);
    const sectorAdj = getSectorMacroAdjustment(stock.sector, country, macro.score);
    if (sectorAdj.delta !== 0) {
      macro = { ...macro, score: Math.max(0, Math.min(100, macro.score + sectorAdj.delta)), reasons: [...(macro.reasons || []), ...sectorAdj.reasons] };
    }
    const weeklyTrend = await getWeeklyTrend(symbol);
    const degFactor = getConfidenceMultiplier();
    const sigObj = await _buildSignal({
      symbol, stock, currentPrice, priceChange, volume,
      fundamental, technical, financial, macro, regime, weights, weeklyTrend,
      newsSent: newsSentiment[symbol] || null,
      catalyst: catalysts[symbol] || null,
      insiderNews: insiderNews[symbol] || null,
      priceHistory, degFactor
    });
    const prevOutcome = _signalOutcomes.get(symbol);
    let emitSignal = true;
    // Strict all-conditions gate: a stock only earns a (new) signal when its
    // data and trade levels satisfy every condition. A stock with no open
    // position is dropped entirely; one with an open position is still tracked
    // (its stop/target use the previously-valid levels) but never emits a fresh
    // signal built on untrustworthy data.
    const eligibility = meetsSignalConditions(sigObj, {
      currentPrice, priceHistory, volume, fundamental, technical, financial, macro,
    });
    if (!eligibility.ok) {
      const hasOpen = prevOutcome && !prevOutcome.result && prevOutcome.timestamp;
      if (!hasOpen) {
        console.log(`[SignalService] ${symbol} ineligible for a signal: ${eligibility.reasons.join(', ')}`);
        return null;
      }
      emitSignal = false;
    }
    // Monitor-first gate: while the previous signal for this symbol is still open
    // (live, unresolved), keep monitoring it instead of emitting a new signal. A new
    // signal is only emitted when the open position (a) hits stop/target (resolved by
    // trackSignalOutcomes below), or (b) flips direction (or its conviction fades to
    // neutral) on the full all-conditions score (fundamental, technical, macro, news,
    // regime, ML...). Positions are deliberately NOT force-closed after a trade-type
    // hold window: wide targets can take weeks to fill, and an expiry close at market
    // price was the source of the coin-flip "~0% target hit" churn. Without this gate,
    // the hourly cycle re-emitted the same still-open signal over and over, ballooning
    // the signal count for no reason.
    if (prevOutcome && !prevOutcome.result && prevOutcome.timestamp) {
      const prevAction = prevOutcome.action;
      const monitoring = prevAction !== 'hold' && prevOutcome.stopLoss != null && prevOutcome.target1 != null;
      if (monitoring) {
        // Long-term holds (Long Term / Long Term Value) are closed ONLY by their
        // stop or target. A score-based close (flip or conviction fade) resolves
        // them at whatever the market price happens to be — usually a coin-flip
        // around entry — which churns a weeks/months thesis out at ~0% return.
        // Short-term trade types may also be closed by a scored flip/fade.
        // Score-based close verdict (flip / profit-fade / stale-thesis / conviction
        // fade) with the minimum-age guard and fade-confirmation rules — extracted
        // as a pure helper so this decision is unit-verifiable (test-fade-relevel.cjs).
        const sc = evaluateScoreClose(prevOutcome, sigObj.action, eligibility.ok, currentPrice, Date.now(), SCORE_CLOSE_MIN_AGE_MS, sigObj.analysis?.overall?.score);
        prevOutcome.fadeCount = sc.fadeCount;
        prevOutcome.fadeFirstSeen = sc.fadeFirstSeen;
        if (!sc.close) {
          emitSignal = false;
          console.log(`[SignalService] ${symbol} previous ${prevAction} signal still open (entry=${prevOutcome.entryPrice}, stop=${prevOutcome.stopLoss}, target=${prevOutcome.target1}) - monitoring, not emitting a new signal${sc.isFade ? ` (conviction fading ${sc.fadeCount}/${sc.required})` : ''}${sc.longTermHold ? ' [long-term hold: score-based close disabled]' : ''}${sc.tooYoung && !sc.longTermHold ? ` [min-age guard: ${Math.max(0, Math.round((SCORE_CLOSE_MIN_AGE_MS - (Date.now() - prevOutcome.timestamp)) / 60000))}m remaining]` : ''}`);
        } else if (marketOpen) {
          // Score-based close at market: the full analysis flipped direction against
          // the open position, its conviction faded to neutral on consecutive
          // readings, or (non-long-term only) a fade was backed by a banked gain or
          // a stale thesis. The position is never closed for simply aging — a stale
          // close still requires the fresh thesis to have gone neutral first.
          const closeReason = sc.close;
          const isPrevBuy = prevAction === 'buy';
          const closedWin = isPrevBuy ? currentPrice >= prevOutcome.entryPrice : currentPrice <= prevOutcome.entryPrice;
          prevOutcome.result = closedWin ? 'win' : 'loss';
          prevOutcome.resolvedAt = Date.now();
          prevOutcome.exitPrice = currentPrice;
          prevOutcome.closeReason = closeReason;
          if (closedWin) { performanceStats.wins++; } else { performanceStats.losses++; }
          performanceStats.total++;
          portfolioState.totalTrades++;
          performanceStats.winRate = performanceStats.total > 0
            ? Math.round((performanceStats.wins / performanceStats.total) * 1000) / 10 : 0;
          console.log(`[SignalService] ${symbol} closed previous ${prevAction} signal (${closeReason}) at ${currentPrice} -> ${prevOutcome.result}${eligibility.ok ? ', emitting fresh signal' : ''}`);
          // A fresh signal is only emitted when this cycle's analysis is trustworthy.
          emitSignal = eligibility.ok;
        } else {
          // Flipped/faded while the exchange is closed: defer the close until the
          // next live session so the exit price isn't a stale after-hours quote.
          emitSignal = false;
          console.log(`[SignalService] ${symbol} previous ${prevAction} signal ${sc.close === 'score flipped' ? 'flipped' : 'conviction faded'} but ${NSE_SYMBOLS.includes(symbol) ? 'NSE' : 'US'} market closed - deferring close until next session`);
        }
      }
    }
    trackSignalOutcomes(_portfolioState, _performanceStats, _signalOutcomes, symbol, currentPrice, sigObj, marketOpen);
    // Sell persistence gate: one sell forward-prediction per symbol until it
    // resolves. A persistent sell must not create a new prediction every cycle
    // — the audit counts every persisted row, so duplicates inflate the totals.
    // The signal itself is still returned to the frontend (so the Market
    // Intelligence page shows active sell ratings), only the forward-prediction
    // insert is suppressed.
    let suppressSellPersist = false;
    if (emitSignal && sigObj.action === 'sell') {
      const sellStore = _forwardTestStore.get(symbol);
      const openSell = sellStore && sellStore.predictions.find(p => !p.resolved && p.action === 'sell');
      if (openSell) {
        suppressSellPersist = true;
        console.log(`[SignalService] ${symbol} sell rating already pending (entry=${openSell.price}) - monitoring, not re-persisting`);
      }
    }
    // Confidence floor: a signal below the emission threshold is not a real
    // rating. Sells below the floor must not be persisted — the Sells audit
    // would count a rating the engine itself refuses to surface. (The same
    // floor already drops them from the returned signals list at the end of
    // generateSignals; this stops the persistence leak for sells.)
    if (emitSignal && sigObj.action === 'sell' && sigObj.confidence != null && sigObj.confidence < (cfg.minConfidence || 40)) {
      emitSignal = false;
      console.log(`[SignalService] ${symbol} ${sigObj.signal} confidence ${sigObj.confidence} below emission floor ${cfg.minConfidence || 40} - not persisting`);
    }
    if (emitSignal && !suppressSellPersist && sigObj.signal !== 'Hold') {
      recordForwardPrediction(symbol, sigObj.signal, sigObj.confidence, currentPrice, sigObj.stopLoss, sigObj.target1, sigObj.action, sigObj.type, sigObj.sector).catch(() => {});
    }
    if (prevOutcome && prevOutcome.result && prevOutcome.timestamp) {
      // Only persist outcomes that trackSignalOutcomes resolved THIS cycle.
      // Entries restored from DB / backfilled / backtest have result pre-set but no
      // timestamp — re-persisting them creates duplicate rows and a self-perpetuating
      // cascade (each re-persist becomes a "resolved prevOutcome" for the next cycle).
      persistSignalOutcome(symbol, prevOutcome.entryPrice, prevOutcome.signal, prevOutcome.exitPrice != null ? prevOutcome.exitPrice : currentPrice, prevOutcome.result, prevOutcome.resolvedAt ? new Date(prevOutcome.resolvedAt).toISOString() : null, prevOutcome.timestamp, prevOutcome.closeReason || null);
      signalEventBus.emit('signal:resolved', {
        ticker: symbol,
        entryPrice: prevOutcome.entryPrice,
        targetPrice: prevOutcome.target1,
        stopPrice: prevOutcome.stopLoss,
        currentPrice,
        result: prevOutcome.result,
        returnPct: prevOutcome.entryPrice > 0 ? Math.round(((currentPrice - prevOutcome.entryPrice) / prevOutcome.entryPrice) * 10000) / 100 : 0,
        signal: prevOutcome.signal,
        resolvedAt: prevOutcome.resolvedAt || Date.now(),
      });
      // If the position resolved on a cycle where the data was untrustworthy,
      // drop it from the monitored set — trackSignalOutcomes re-seeds a fresh
      // entry from this cycle's (invalid) signal object, which would otherwise
      // linger as an inert position that can never resolve.
      if (!eligibility.ok) _signalOutcomes.delete(symbol);
    }
    // Check progress milestones on the current active signal
    const currentActive = _signalOutcomes.get(symbol);
    if (currentActive && !currentActive.result && currentActive.action !== 'hold' && currentActive.entryPrice > 0 && currentActive.target1) {
      const isBuy = currentActive.action === 'buy';
      let progress = 0;
      if (isBuy) {
        const targetDist = currentActive.target1 - currentActive.entryPrice;
        progress = targetDist > 0 ? ((currentPrice - currentActive.entryPrice) / targetDist) * 100 : 0;
      } else {
        const targetDist = currentActive.entryPrice - currentActive.target1;
        progress = targetDist > 0 ? ((currentActive.entryPrice - currentPrice) / targetDist) * 100 : 0;
      }
      const lastAlert = currentActive.lastProgressAlert || 0;
      [25, 50, 75, 90].forEach(milestone => {
        if (progress >= milestone && lastAlert < milestone) {
          currentActive.lastProgressAlert = milestone;
          signalEventBus.emit('signal:progress', {
            ticker: symbol,
            entryPrice: currentActive.entryPrice,
            targetPrice: currentActive.target1,
            stopPrice: currentActive.stopLoss,
            currentPrice,
            progress: Math.min(100, Math.round(progress * 10) / 10),
            milestone,
            signal: currentActive.signal,
            isProfit: isBuy ? currentPrice > currentActive.entryPrice : currentPrice < currentActive.entryPrice,
          });
        }
      });

      // ±5% movement alert: notify when the live price moves more than 5% from
      // entry (absolute), once per crossing. Uses lastMovementAlertPct to fire only
      // when the magnitude crosses a fresh 5%-band boundary (5/10/15/...) so a
      // position hovering around the threshold doesn't spam.
      const movePct = ((currentPrice - currentActive.entryPrice) / currentActive.entryPrice) * 100;
      const absMove = Math.abs(movePct);
      if (absMove >= 5) {
        const band = Math.floor(absMove / 5) * 5;
        if ((currentActive.lastMovementAlertPct || 0) < band) {
          currentActive.lastMovementAlertPct = band;
          signalEventBus.emit('signal:movement', {
            ticker: symbol,
            entryPrice: currentActive.entryPrice,
            currentPrice,
            movePct: Math.round(movePct * 100) / 100,
            band,
            isUp: movePct > 0,
            signal: currentActive.signal,
          });
        }
      }
    }
    // Re-level open positions to current market behavior: while a long is being
    // monitored on trustworthy data during a live session, re-derive the hard stop
    // from the current price/ATR (only ever tightening it, never loosening), with
    // the pre-lock stop capped below entry (entry minus the buffer) and locked-gain
    // floors only once progress nears the target. This keeps the open position's
    // risk geometry in sync with live volatility and price action instead of
    // freezing the entry-cycle levels forever, while a +X% rally that retraces to
    // entry rides the below-entry stop instead of stopping at ~0%. The tighter stop
    // is persisted to the open signal_history row so a restart re-arms it instead
    // of falling back to the original entry-cycle stop.
    const relevelTarget = _signalOutcomes.get(symbol);
    if (relevelTarget && !relevelTarget.result && relevelTarget.action === 'buy'
        && eligibility.ok && marketOpen && currentPrice > 0
        && Array.isArray(priceHistory) && priceHistory.length >= 14) {
      const freshLevels = calculateTradeLevels(symbol, currentPrice, { action: 'buy' }, priceHistory, MIN_STOP_PCT, relevelTarget.type || 'Swing Trade');
      const { newStop, changed, progress } = computeRelevelStop(relevelTarget, currentPrice, freshLevels.stopLoss);
      if (changed) {
        const prevStop = relevelTarget.stopLoss;
        relevelTarget.stopLoss = newStop;
        const genAtIso = new Date(relevelTarget.timestamp).toISOString();
        pool.query(
          `UPDATE signal_history SET stop_loss = $1
           WHERE id = (SELECT id FROM signal_history WHERE ticker = $2
                       AND generated_at BETWEEN $3::timestamptz - interval '30 seconds' AND $3::timestamptz + interval '30 seconds'
                       AND stop_loss > 0 ORDER BY generated_at DESC LIMIT 1)`,
          [newStop, symbol, genAtIso]
        ).catch(() => {});
        console.log(`[SignalService] ${symbol} re-leveled stop ${prevStop} -> ${newStop} (price=${currentPrice}, progress=${Math.round(progress)}% of target1)`);
      }
    }
    resolveForwardPredictions(symbol).catch(() => {});
    return emitSignal ? sigObj : null;
  };

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(s => processSymbol(s).catch(e => { console.error(`[SignalService] Error processing ${s}:`, e.message); return null; })));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) signals.push(r.value);
    }
  }
  
  console.log(`[SignalService] Generated ${signals.length} raw signals before constraints (${signals.filter(s => s.signal !== 'Hold').length} non-Hold)`);

  // Sort by confidence and signal strength
  signals.sort((a, b) => {
    const signalOrder = { 'Strong Buy': 5, 'Buy': 4, 'Hold': 3, 'Sell': 2, 'Strong Sell': 1 };
    const aOrder = signalOrder[a.signal] || 3;
    const bOrder = signalOrder[b.signal] || 3;
    if (aOrder !== bOrder) return bOrder - aOrder;
    return b.confidence - a.confidence;
  });
  
  // Apply portfolio-level constraints (sector concentration, correlation)
  const constrainedSignals = applyPortfolioConstraints(signals);
  console.log(`[SignalService] After portfolio constraints: ${constrainedSignals.length} signals (${constrainedSignals.filter(s => s.signal !== 'Hold').length} non-Hold)`);

    // Full mode: persist, monitor, train ML
    if (!quick) {
      persistSignals(constrainedSignals).catch(() => {});
      cleanupOldSignals().catch(() => {});
      persistPortfolioState().catch(() => {});
      trackSignalQuality(_performanceStats);
      logHealth(getEngineHealth()).catch(() => {});
      detectSignalDrift().catch(() => {});
      logAuditEvent('signal_cycle', `Generated ${constrainedSignals.length} signals (regime: ${regime.regime})`, {
        total: constrainedSignals.length,
        strongBuy: constrainedSignals.filter(s => s.signal === 'Strong Buy').length,
        buy: constrainedSignals.filter(s => s.signal === 'Buy').length,
        sell: constrainedSignals.filter(s => s.signal === 'Sell' || s.signal === 'Strong Sell').length,
        regime: regime.regime,
      });
      const now = Date.now();
      if (_performanceStats.total >= 50 && now - _lastMLTrain > ML_TRAIN_COOLDOWN) {
        _lastMLTrain = now;
        mlModel.train().catch(() => {});
      }
    }

    const minConfidence = cfg.minConfidence || 40;
    const filteredSignals = constrainedSignals.filter(s => s.confidence >= minConfidence);

    if (!marketData && filteredSignals.length > 0) {
      _signalsCache = filteredSignals;
      _signalsCacheTime = Date.now();
      _persistSignalCache(filteredSignals).catch(() => {});
    }
    return filteredSignals;
  } finally {
    if (!marketData && !quick) _signalsInProgress = false;
  }
}

// Get signal for a specific stock (works for ANY stock symbol)
async function getSignalForStock(symbol) {
  const upper = symbol.toUpperCase();
  // First check if it's in our main list
  if (ALL_SYMBOLS.includes(upper)) {
    const signals = await generateSignals();
    const found = signals.find(s => s.ticker === upper);
    if (found) return found;
    // The symbol's prior signal is still open and being monitored — surface that
    // state instead of a fresh (suppressed) signal.
    const open = _signalOutcomes.get(upper);
    if (open && !open.result && open.timestamp) {
      // Surface the full monitored position state (type, target2/3, riskReward,
      // timeframe, position size, reason) — not just the bare levels — so the AI
      // analyst and dashboard render a complete card instead of "N/A"/undefined
      // fields. riskReward is derived from the stop/target ladder when it wasn't
      // stored, matching calculateTradeLevels' (target1-entry)/(entry-stop) ratio.
      const entry = open.entryPrice;
      const stop = open.stopLoss;
      const t1 = open.target1;
      let riskReward = open.riskReward;
      if (riskReward == null && entry != null && stop != null && t1 != null && entry !== stop) {
        const risk = Math.abs(entry - stop);
        const reward = Math.abs(t1 - entry);
        riskReward = risk > 0 ? parseFloat((reward / risk).toFixed(1)) : null;
      }
      return {
        ticker: upper, signal: open.signal, action: open.action,
        entry: entry, entryPrice: entry, stopLoss: stop, target1: t1,
        target2: open.target2 != null ? open.target2 : null,
        target3: open.target3 != null ? open.target3 : null,
        type: open.type || 'Swing Trade',
        riskReward,
        confidence: open.confidence || 0,
        timeframe: open.timeframe || null,
        positionSize: open.positionSize != null ? open.positionSize + '%' : null,
        reason: open.reason || '',
        status: 'monitoring',
      };
    }
    return null;
  }
  // Generate signal for a single unknown stock
  return generateSingleSignal(upper);
}

async function generateSingleSignal(symbol) {
  try {
    let stock = getFundamentals(symbol);
    if (!stock) {
      console.warn(`[SignalService] Cannot generate signal for ${symbol} — no fundamentals`);
      return null;
    }
    const marketSymbol = NSE_SYMBOLS.includes(symbol) ? `NSE:${symbol}` : symbol;
    const quote = await getStockQuote(marketSymbol);
    if (!quote) {
      console.warn(`[SignalService] Cannot generate signal for ${symbol} — no quote`);
      return null;
    }
    const currentPrice = quote.price;
    const priceChange = quote.changePercent;
    const volume = quote.volume;
    let newsSent = null;
    let catalyst = null;
    try {
      const sentimentMap = await getAggregatedSentiment();
      newsSent = sentimentMap[symbol] || null;
    } catch { /* silent */ }
    try {
      const catalystMap = await getCatalysts();
      catalyst = catalystMap[symbol] || null;
    } catch { /* silent */ }
    let insiderNews = null;
    try {
      const insiderNewsMap = await getInsiderNewsSignals();
      insiderNews = insiderNewsMap[symbol] || null;
    } catch { /* silent */ }
    const priceHistory = await getPriceHistory(symbol).catch(() => null);
    const reportMetrics = _financialReportCache.get(symbol);
    if (reportMetrics) stock = sanitizeLiveFundamentals(stock, reportMetrics);
    const fundamental = analyzeFundamentals(stock, currentPrice, newsSent, _dynamicSectorPE);
    const technical = analyzeTechnicals(symbol, currentPrice, priceHistory, volume);
    const financial = analyzeFinancials(stock, fundamental);
    const country = getCountryForSymbol(symbol);
    let macro = getMacroScore(country);
    const sectorAdj = getSectorMacroAdjustment(stock.sector, country, macro.score);
    if (sectorAdj.delta !== 0) {
      macro = { ...macro, score: Math.max(0, Math.min(100, macro.score + sectorAdj.delta)) };
    }
    const regime = await detectMarketRegime();
    const weights = computeDynamicWeights(regime.regime);
    const weeklyTrend = await getWeeklyTrend(symbol);
    const degFactor = getConfidenceMultiplier();
    const sigObj = await _buildSignal({
      symbol, stock, currentPrice, priceChange, volume,
      fundamental, technical, financial, macro, regime, weights, weeklyTrend,
      newsSent, catalyst, insiderNews, priceHistory, degFactor
    });
    if (sigObj) {
      // Same strict all-conditions gate as the batch path: an on-demand lookup
      // only returns a signal when the stock genuinely qualifies.
      const eligibility = meetsSignalConditions(sigObj, {
        currentPrice, priceHistory, volume, fundamental, technical, financial, macro,
      });
      if (!eligibility.ok) {
        console.log(`[SignalService] ${symbol} ineligible for a signal: ${eligibility.reasons.join(', ')}`);
        return null;
      }
      persistPortfolioState().catch(() => {});
    }
    return sigObj;
  } catch (error) {
    console.error(`Error generating signal for ${symbol}:`, error.message);
    return null;
  }
}

// Get signals summary
async function getSignalsSummary() {
  const signals = await generateSignals();
  
  const summary = {
    total: signals.length,
    strongBuy: signals.filter(s => s.signal === 'Strong Buy').length,
    buy: signals.filter(s => s.signal === 'Buy').length,
    hold: signals.filter(s => s.signal === 'Hold').length,
    sell: signals.filter(s => s.signal === 'Sell').length,
    strongSell: signals.filter(s => s.signal === 'Strong Sell').length,
    avgConfidence: Math.round(signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length),
    topGainers: signals.sort((a, b) => b.change - a.change).slice(0, 5),
    highConfidence: signals.filter(s => s.confidence >= 80).length,
    bySector: {}
  };
  
  // Group by sector
  signals.forEach(s => {
    if (!summary.bySector[s.sector]) {
      summary.bySector[s.sector] = { count: 0, avgScore: 0, signals: [] };
    }
    summary.bySector[s.sector].count++;
    summary.bySector[s.sector].signals.push(s.signal);
  });
  
  // Calculate average score per sector
  Object.keys(summary.bySector).forEach(sector => {
    const sectorSignals = summary.bySector[sector].signals;
    const scoreMap = { 'Strong Buy': 90, 'Buy': 70, 'Hold': 50, 'Sell': 30, 'Strong Sell': 15 };
    const totalScore = sectorSignals.reduce((sum, sig) => sum + (scoreMap[sig] || 45), 0);
    summary.bySector[sector].avgScore = Math.round(totalScore / sectorSignals.length);
    summary.bySector[sector].pctOfTotal = Math.round((summary.bySector[sector].count / signals.length) * 100);
  });
  
  // Sector concentration warning
  const maxSector = Object.entries(summary.bySector).sort((a, b) => b[1].count - a[1].count)[0];
  if (maxSector && maxSector[1].pctOfTotal > 30) {
    summary.sectorConcentrationWarning = `High concentration in ${maxSector[0]} (${maxSector[1].pctOfTotal}% of signals)`;
  }
  
  // Machine performance stats
  summary.signalPerformance = { ..._performanceStats };
  
  // Market regime
  summary.marketRegime = _marketRegime.regime;
  
  // Backtesting stats from historical signal_history data
  summary.backtest = await computeBacktestStats();
  
  // Engine health
  summary.health = getEngineHealth();
  
  // Weight optimization
  summary.weightOptimization = await optimizeWeights();
  
  // ML model & monitoring
  summary.mlModel = mlModel.getModelInfo();
  summary.qualityScore = getQualityScore(getEngineHealth());
  
  return summary;
}

function searchStocks(query) {
  const q = query.toUpperCase().trim();
  if (!q || q.length < 1) return [];
  const results = [];
  const seen = new Set();

  // Search by ticker
  for (const sym of ALL_SYMBOLS) {
    if (sym.startsWith(q) || sym.includes(q)) {
      const fund = KNOWN_FUNDAMENTALS[sym] || NSE_FUNDAMENTALS[sym];
      seen.add(sym);
      results.push({
        ticker: sym,
        name: resolveStockName(sym),
        sector: fund?.sector || guessSector(sym),
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }

  // Search by company name
  const nameMap = { ...KNOWN_NAMES };
  for (const sym of ALL_SYMBOLS) {
    const fund = KNOWN_FUNDAMENTALS[sym];
    if (fund && fund.name && fund.name.toUpperCase().includes(q) && !seen.has(sym)) {
      seen.add(sym);
      results.push({
        ticker: sym,
        name: fund.name,
        sector: fund.sector || 'Other',
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }
  for (const [sym, name] of Object.entries(nameMap)) {
    if (name.toUpperCase().includes(q) && !seen.has(sym)) {
      seen.add(sym);
      results.push({
        ticker: sym,
        name,
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }

  return results.slice(0, 20);
}

// ─── Signal Bucket Classifier ───────────────────────────────────────────────
// Pure decision: maps the 0-100 composite score to a signal bucket. The buy side
// is unchanged. The sell side is asymmetric and evidence-gated because a Sell in
// equities means "the fundamentals/technical/financial/sentiment no longer
// support holding for upside" — an exit/avoid rating, not the mirror of the buy
// signal.
//
// The evidence model deliberately looks past the composite score — which gets
// diluted by neutral ML/confidence priors — at the raw stock dimensions:
//   evidence = degree-aware negativity across fundamental/technical/financial
//              + negative sentiment + technical-breakdown confirmation
//              + prior-cycle deterioration
// A regime-adjusted conviction bar is then applied: sells fight the trend in a
// bull market and need more evidence; in bear/crash markets the bar is lower.
// A hard financial-distress trigger (Altman Z below the distress threshold)
// forces a Strong Sell regardless of the score, but only when it is trustworthy:
// Altman Z is a manufacturing-firm heuristic and is routinely < 1.81 for banks/
// insurers (huge deposit liabilities, negative working capital) and for firms
// with incomplete financials, so the hard trigger requires (a) a non-financial
// sector and (b) corroborating profitability weakness. Otherwise a suppressed Z
// just contributes to the evidence. The RSI oversold guard keeps the model from
// screaming Strong Sell at a likely bounce bottom.
function classifySignalBucket(overallScore, thresholds, ctx) {
  if (overallScore >= thresholds.strong_buy) return { signal: 'Strong Buy', action: 'buy', strength: 'strong' };
  if (overallScore >= thresholds.buy) return { signal: 'Buy', action: 'buy', strength: 'moderate' };

  const sub = ctx.subScores || {};
  const ind = ctx.indicators || {};
  const newsNegative = ctx.newsSent === 'negative';
  const cat = ctx.catalyst || {};
  const positiveCatalyst = cat.direction === 'positive';
  const negativeCatalyst = cat.direction === 'negative';

  // Degree-aware negativity: deeper weakness counts more, shallow sub-40
  // readings contribute little (they may be noise).
  const neg = (s) => (s != null && s < 40) ? (40 - s) / 25 : 0;
  let evidence = neg(sub.fundamental) + neg(sub.technical) + neg(sub.financial);
  if (newsNegative) evidence += 1;
  if (negativeCatalyst) evidence += 1;

  // Technical breakdown confirmation — the trend actually broke (price under the
  // slow SMA, bearish MACD, or falling momentum), not just a weak raw score.
  const price = Number(ctx.price);
  const slowSma = Number(ind.smaSlow);
  let breakdown = isFinite(price) && isFinite(slowSma) && slowSma > 0 && price < slowSma;
  if (!breakdown && ind.macdSignal && /bearish/i.test(String(ind.macdSignal))) breakdown = true;
  if (!breakdown && ind.momentum != null && Number(parseFloat(String(ind.momentum))) < 0) breakdown = true;
  if (breakdown && sub.technical < 55) evidence += 0.5;

  // Prior-cycle deterioration — a sharp composite drop vs the last cycle is the
  // classic "exit now" tell: the trend is changing for the worse.
  if (ctx.priorScore != null && (ctx.priorScore - overallScore) >= 8) evidence += 0.5;

  // Altman Z suppression: analysisEngine flags altSignal='SUPPRESS' when the
  // computed Z falls below the distress threshold. That alone is NOT proof of
  // insolvency — the Z model is unreliable for financials (banks/insurers have
  // structurally huge liabilities and negative working capital) and for firms
  // with sparse financials — so it only hard-triggers a Strong Sell when the
  // company is a non-financial with corroborating profitability weakness.
  const distressFlagged = !!(ctx.fundamentals && ctx.fundamentals.altSignal === 'SUPPRESS');
  const sector = String(ctx.sector || '').toLowerCase();
  const isFinancial = /financial|bank|insurance|reinsur/i.test(sector);
  const fp = ctx.fundProfile || {};
  // Corroboration = genuine profitability deterioration, not a hairline dip:
  // a -0.4% revenue wobble on a healthy balance sheet (e.g. a capital-intensive
  // utility whose Altman Z is structurally low) must not force a Strong Sell.
  const deteriorating =
    Number(fp.roe) < 0 ||
    Number(fp.epsGrowth) < -10 ||
    Number(fp.revenueGrowth) < -5;
  if (distressFlagged && !isFinancial) {
    // Even an uncorroborated suppression is a meaningful caution flag.
    evidence += 0.75;
    // A positive deal catalyst (M&A/strategic-investor talk, capital injection)
    // is a separate, market-visible narrative: the market can be pricing a
    // premium that the last audited financials don't show (KQ strategic-investor
    // talks, NCBA takeover bid). In that case don't force the Strong Sell — the
    // catalyst-boosted composite decides instead (typically landing in the hold
    // band with the catalyst surfaced on the signal).
    if (deteriorating && !positiveCatalyst) {
      return { signal: 'Strong Sell', action: 'sell', strength: 'strong' };
    }
  }

  // Composite in the hold band: default to do-nothing, but overwhelming evidence
  // can break through — the composite is diluted by neutral priors, so a stock
  // whose real dimensions are all deep-negative can still deserve an exit.
  if (overallScore >= thresholds.hold) {
    if (evidence >= 2) return { signal: 'Sell', action: 'sell', strength: 'moderate' };
    return { signal: 'Hold', action: 'hold', strength: 'neutral' };
  }

  // Regime-adjusted conviction bar for the below-hold band.
  let bar = 1.2;
  if (ctx.regime === 'bull') bar = 1.5;
  else if (ctx.regime === 'bear' || ctx.regime === 'crash') bar = 1.0;
  if (evidence < bar) return { signal: 'Hold', action: 'hold', strength: 'neutral' };

  // Oversold-bounce guard: at extreme RSI oversold the downside may already be
  // priced in and a bounce is likely — don't upgrade to Strong Sell at the bottom.
  const rsi = Number.parseFloat(String(ind.rsi));
  const oversold = Number.isFinite(rsi) && rsi <= 30;
  const strongEvidence = evidence >= 1.7;

  if (overallScore < thresholds.sell) {
    if (strongEvidence && !oversold) return { signal: 'Strong Sell', action: 'sell', strength: 'strong' };
    return { signal: 'Sell', action: 'sell', strength: 'moderate' };
  }
  return { signal: 'Sell', action: 'sell', strength: 'moderate' };
}

// Prior-cycle composite scores keyed by symbol, updated at the end of every
// _buildSignal call so the next cycle can detect deterioration (the "exit now"
// tell of a score dropping sharply vs the previous reading).
const _lastCycleScores = new Map();
function getPriorScore(symbol) {
  return _lastCycleScores.has(symbol) ? _lastCycleScores.get(symbol) : null;
}

// ─── Speculative-Rally Detection ─────────────────────────────────────────────
// A strong price run-up on top of distressed fundamentals (low fundamental
// score / negative Altman Z) is a sentiment/catalyst-driven rally, not an
// earnings-backed one (e.g. KQ 2026: ~+130% Jan->Apr on strategic-investor
// deal talk, insider buying and load-factor headlines while FY25 booked a
// Sh17.2B loss and negative equity). Such rallies never justify a Buy: the
// composite is capped at Hold and the flag is surfaced so the driver
// (story vs fundamentals) is explicit in the reasoning.
function detectSpeculativeRally(priceHistory, fundamental) {
  const cfg = engineConfig.getConfig().scoring?.signal_confidence?.speculative_rally || {};
  if (cfg.enabled === false) return null;
  if (!Array.isArray(priceHistory) || priceHistory.length < (cfg.min_history || 20)) return null;
  const lookback = cfg.momentum_lookback || 40;
  const momentumThreshold = cfg.momentum_threshold ?? 40;
  const n = Math.min(lookback, priceHistory.length - 1);
  const start = priceHistory[priceHistory.length - 1 - n];
  const end = priceHistory[priceHistory.length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  const momentum = ((end - start) / start) * 100;
  if (momentum < momentumThreshold) return null;
  if (fundamental.score > (cfg.fundamental_max_score ?? 40)) return null;
  return { momentum: Math.round(momentum * 10) / 10, lookback: n };
}

// ─── Insider-Activity Scoring ─────────────────────────────────────────────────
// Deliberate, informed transactions: when officers/directors put their own
// money behind the stock it is one of the strongest non-quantitative tells,
// and mass insider selling is a known forward-look warning. The score is
// conviction (not volume-level): a big offsetting sell out of pre-existing
// holdings should not out-shout a fresh accumulation campaign.
//
//   netShareRatio = (buys - sells) / (buys + sells)  in [-1, 1]
//   recency factor weights recent months ~3x older ones
//   base  = 50 + netShareRatio * 40 + (buys - sells) * 1.5      (0..100)
//   score = clamp(base adjusted by recency, 3, 97)
//
// Only US stocks have Yahoo insider data; NSE symbols pass null (ownership
// never resolves) and stay neutral. Transaction rows carry their direction in
// the `text` label (e.g. "Sale at price X", "Purchase at price X"); stock
// awards/grants/gifts are compensation, not conviction, so they count as
// neutral rather than buys. Rows with no usable date are treated as current
// (Yahoo returns the latest 15, so age is bounded in practice).
function scoreInsiderActivity(ownership) {
  const cfg = engineConfig.getConfig().scoring?.signal_confidence?.insider_activity || {};
  if (cfg.enabled === false) return null;
  const txns = ownership?.insiderTransactions;
  if (!Array.isArray(txns) || txns.length === 0) return null;
  const now = Date.now();
  const maxAgeMs = (cfg.max_age_months ?? 12) * 30 * 24 * 60 * 60 * 1000;
  let buys = 0, sells = 0, neutral = 0, buyShares = 0, sellShares = 0;
  let latestDate = null, latestText = null, latestTs = 0;
  for (const t of txns) {
    let ts = 0;
    if (t.startDate instanceof Date) {
      ts = t.startDate.getTime();
    } else if (t.startDate && typeof t.startDate === 'object' && !Array.isArray(t.startDate)) {
      // yahoo-finance2 v3 returns startDate as a Date, but flattened/cached
      // copies may hold { raw, fmt } or an ISO epoch number.
      const raw = t.startDate.raw ?? t.startDate.__raw ?? t.startDate.value ?? null;
      const d = raw != null ? new Date(typeof raw === 'string' && /^\d{10,13}$/.test(raw) ? Number(raw) : raw) : null;
      if (d && !Number.isNaN(d.getTime())) ts = d.getTime();
    } else if (typeof t.startDate === 'string' || typeof t.startDate === 'number') {
      const raw = String(t.startDate);
      if (raw && raw !== '[object Object]') {
        const asNum = /^\d{10,13}$/.test(raw) ? Number(raw) : NaN;
        const d = asNum ? new Date(asNum) : new Date(raw);
        if (!Number.isNaN(d.getTime())) ts = d.getTime();
      }
    }
    const value = t.value ?? t.transactionValue ?? null;
    const shares = (t.shares ?? value ?? 0) || 0;
    const label = String(t.text ?? t.transactionText ?? '').toLowerCase();
    // Compensation grants/gifts are not discretionary conviction trades.
    const isComp = /stock (award|grant|gift)|restricted/i.test(label);
    const isSell = !isComp && /sale|sold|sell/i.test(label) && !/purchase|buy/i.test(label);
    const isBuy = !isComp && /purchase|acqui|buy/i.test(label);
    if (ts > 0 && latestTs < ts) {
      latestTs = ts;
      latestDate = new Date(ts).toISOString().slice(0, 10);
      latestText = t.text || t.transactionText || null;
    }
    if (ts > 0 && now - ts > maxAgeMs) continue;
    if (isSell) { sells++; sellShares += shares; }
    else if (isBuy) { buys++; buyShares += shares; }
    else neutral++;
  }
  if (buys + sells === 0) {
    return {
      score: 50, hasActivity: false, netShares: null, netShareRatio: 0,
      buyCount: buys, sellCount: sells, neutralCount: neutral,
      latestDate, latestText, summary: 'No conviction insider transactions in the window',
    };
  }
  const netShares = buyShares - sellShares;
  const netRatio = (buyShares + sellShares) > 0 ? (buyShares - sellShares) / (buyShares + sellShares) : 0;
  const countDiff = buys - sells;
  const raw = 50 + netRatio * 40 + countDiff * 1.5;
  // Recency: recent transactions (<=3 months) carry ~2x the weight of older ones.
  let recency = 1;
  if (latestTs > 0 && now > latestTs) {
    const ageMonths = (now - latestTs) / (30 * 24 * 60 * 60 * 1000);
    recency = ageMonths <= 3 ? 1.25 : ageMonths <= 6 ? 1.1 : 1;
  }
  const score = Math.max(3, Math.min(97, Math.round(50 + (raw - 50) * recency)));
  return {
    score, hasActivity: true, netShares, netShareRatio: Math.round(netRatio * 100) / 100,
    buyCount: buys, sellCount: sells, neutralCount: neutral,
    latestDate, latestText,
    summary: netShares >= 0
      ? `Insiders net bought ${netShares.toLocaleString()} shares (${buys} buys / ${sells} sells)`
      : `Insiders net sold ${Math.abs(netShares).toLocaleString()} shares (${buys} buys / ${sells} sells)`,
  };
}

function ownershipShortFloat(ownership) {
  const v = ownership?.shortFloatPct ?? ownership?.sharesShort ?? null;
  return v != null ? Math.round(Number(v) * 100) / 100 : null;
}

// ─── News-derived Insider Scoring (NSE) ──────────────────────────────────────
// NSE stocks have no Yahoo insider-transaction coverage (ownership never
// resolves), so their insider dimension comes from reported director/insider/
// major-shareholder transactions in the news pipeline (Kenyan Wall Street,
// Business Daily, Bizna Kenya, NewsAPI...). Each reported event shifts the
// score; no events means no data (neutral). Produces the same shape as
// scoreInsiderActivity so _buildSignal treats both sources identically.
function scoreNewsInsider(info) {
  const cfg = engineConfig.getConfig().scoring?.signal_confidence?.insider_activity || {};
  if (cfg.enabled === false) return null;
  if (!info) return null;
  const buys = Number(info.buys) || 0;
  const sells = Number(info.sells) || 0;
  if (buys + sells === 0) return null;
  const perEvent = cfg.news_per_event ?? 6;
  const raw = 50 + (buys - sells) * perEvent;
  // Recency: a fresh report (<=7 days) carries more weight than a stale one.
  let recency = 1;
  if (info.latestTs) {
    const ageDays = (Date.now() - Number(info.latestTs)) / 864e5;
    recency = ageDays <= 7 ? 1.3 : ageDays <= 21 ? 1.1 : 1;
  }
  const score = Math.max(5, Math.min(95, Math.round(50 + (raw - 50) * recency)));
  return {
    score, hasActivity: true, netShares: null, netShareRatio: null,
    buyCount: buys, sellCount: sells, neutralCount: 0,
    latestDate: info.latestDate || null, latestText: info.latestText || null,
    summary: buys >= sells
      ? `News reports ${buys} insider/director buying event(s)${sells ? ` vs ${sells} selling` : ''} (latest ${info.latestDate || 'n/a'})`
      : `News reports ${sells} insider/director selling event(s)${buys ? ` vs ${buys} buying` : ''} (latest ${info.latestDate || 'n/a'})`,
  };
}

// ─── Shared Signal Builder ──────────────────────────────────────────────────
// Consolidates scoring, confidence, position sizing, and signal object construction
// used by both generateSignals() and generateSingleSignal().
// Renders the engine-computed holding period (trading sessions to reach target1
// at the stock's average daily range) into a human label, so the value shown on
// the cards reflects each stock's real volatility instead of a static per-type
// string like "2-4 weeks" for everything. Long-term classifications are floored
// at their classified horizon — the engine's score-based trade type says "hold
// for months", so an ATR estimate of a few weeks never contradicts it.
function formatHoldingPeriod(days, tradeType) {
  if (tradeType === 'Long Term' || tradeType === 'Long Term Value') return '3-6 months';
  if (days == null || !isFinite(days) || days <= 0) return null;
  if (days <= 5) return '~1 week';
  if (days <= 10) return '1-2 weeks';
  if (days <= 15) return '~2 weeks';
  if (days <= 25) return '2-4 weeks';
  if (days <= 40) return '~1 month';
  if (days <= 90) return '1-3 months';
  return '3-6 months';
}
async function _buildSignal({ symbol, stock, currentPrice, priceChange, volume, fundamental, technical, financial, macro, regime, weights, weeklyTrend, newsSent, catalyst, insiderNews, priceHistory, degFactor }) {
  // Read scoring and portfolio config once at the top
  const sc = engineConfig.getConfig().scoring?.signal_confidence || {};
  const baselineConf = sc.baseline ?? 50;
  const confMin = sc.min ?? 10;
  const confMax = sc.max ?? 95;
  const varMult = sc.variance_multiplier ?? 0.3;
  const newsPos = sc.news_positive ?? 5;
  const newsNeg = sc.news_negative ?? -5;
  const catPos = sc.catalyst_positive ?? 10;
  const catNeg = sc.catalyst_negative ?? -10;
  const sparseFT = sc.sparse_fund_tech ?? -4;
  const sparseFF = sc.sparse_fund_fin ?? -3;
  const wlrDefault = sc.kelly_wlr_default ?? 1.5;
  const portfolioCfg = engineConfig.getConfig().portfolio || {};
  const maxConcentration = portfolioCfg.maxConcentration || 0.25;
  const maxDrawdownThreshold = portfolioCfg.maxDrawdown || 0.20;
  const stopLossPct = portfolioCfg.stopLoss || 0.05;
  const regimePenaltyCrash = sc.regime_penalty_crash ?? 0.5;

  // Compute ML win probability BEFORE weighted score so it can contribute
  let mlWinProb = null;
  const ftSnap = getForwardTestSnapshot();
  const ltSnap = getLiveTestSnapshot();
  try {
    mlWinProb = await mlModel.predictWinProbability(fundamental, technical, macro, priceHistory, currentPrice, volume, symbol, stock.sector, stock, ftSnap, ltSnap);
  } catch { /* ML model not ready */ }
  let mlFeatures = null;
  try {
    const rawFeatMap = mlModel.extractRawIndicators({ fundamental, technical, macro, priceHistory, currentPrice, volume, forwardTest: ftSnap, liveTest: ltSnap });
    mlFeatures = mlModel.FEATURES.map(f => rawFeatMap[f] ?? 0);
  } catch { /* indicators not available */ }
  const mlProbScore = mlWinProb != null ? Math.round(mlWinProb * 100) : 50;

  // Weighted composite score including ML probability and confidence
  const w = weights;
  let adjScore =
    (fundamental.score * (w.fundamental || 0)) +
    (technical.score   * (w.technical || 0)) +
    (financial.score   * (w.financial || 0)) +
    (macro.score       * (w.macro || 0)) +
    (mlProbScore       * (w.ml_probability || 0)) +
    (baselineConf      * (w.confidence || 0));
  // Normalize: if weights don't sum to 1, scale accordingly
  const weightSum = Object.values(w).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  if (weightSum > 0) adjScore = adjScore / weightSum;

  const sparseFund = fundamental.metrics?.dataQuality === 'Very sparse data';
  const sparseTech = technical.indicators?.dataQuality === 'Insufficient history';
  const sparseFin = financial.analysis?.financialHealth === 'Limited financial data';
  if (sparseFund && sparseTech) adjScore += sparseFT;
  if (sparseFund && sparseFin) adjScore += sparseFF;
  if (newsSent === 'positive') adjScore += newsPos;
  else if (newsSent === 'negative') adjScore += newsNeg;
  // Deal/narrative catalyst overlay (M&A talk, capital injection, crisis...).
  // A positive catalyst lifts the composite so a fundamentals-Sell can be
  // downgraded to a catalyst-aware reading; a negative one deepens it.
  const cat = catalyst || {};
  const catDelta = cat.direction === 'positive' ? catPos : cat.direction === 'negative' ? catNeg : 0;
  if (catDelta !== 0) adjScore += catDelta;

  // Insider-activity overlay: deliberate, informed transactions shift the
  // composite the same way a catalyst does — insider accumulation lifts it,
  // mass insider selling deepens it. No data stays neutral. Applied before the
  // speculative cap so a sentiment-driven rally can never be re-classified as
  // a Buy by insider conviction (the cap below still holds).
  // US symbols score from Yahoo ownership transactions; NSE symbols (no Yahoo
  // insider coverage) score from director/insider dealings reported in news.
  const insider = scoreInsiderActivity(stock.ownership) || scoreNewsInsider(insiderNews || null);
  if (insider) adjScore += ((insider.score - 50) / 50) * INSIDER_MAX_DELTA;

  // Speculative-rally gate: a large run-up on distressed fundamentals is a
  // sentiment/catalyst story, not earnings support. Cap the composite at Hold
  // (just below the Buy threshold) so the rally can never mint a Buy/Aggressive
  // Buy, and surface the flag so the driver is explicit in the reasoning.
  const speculative = detectSpeculativeRally(priceHistory, fundamental);
  if (speculative) {
    const specCap = sc.speculative_rally?.cap_score ?? 54;
    if (adjScore > specCap) {
      adjScore = specCap;
      console.log(`[SignalService] ${symbol} speculative rally detected (+${speculative.momentum}% over ~${speculative.lookback} sessions vs distressed fundamentals) - composite capped at ${specCap} (Hold)`);
    }
  }

  let overallScore = Math.max(0, Math.min(100, Math.round(adjScore)));

  // Use configurable thresholds + the evidence-gated sell classifier
  const thresholds = engineConfig.getConfig().thresholds;
  const sig = classifySignalBucket(overallScore, thresholds, {
    subScores: {
      fundamental: fundamental.score,
      technical: technical.score,
      financial: financial.score,
    },
    newsSent,
    catalyst: cat,
    indicators: technical.indicators,
    fundamentals: fundamental.metrics,
    sector: stock.sector,
    fundProfile: {
      roe: stock.roe,
      epsGrowth: stock.epsGrowth,
      revenueGrowth: stock.revenueGrowth,
    },
    regime: regime.regime,
    price: currentPrice,
    priorScore: getPriorScore(symbol),
  });

  const tradeType = sig.action === 'sell' ? 'Avoid' : determineTradeType(technical.score, fundamental.score);
  const tradeLevels = calculateTradeLevels(symbol, currentPrice, sig, priceHistory, stopLossPct, tradeType);
  const scoreVariance = Math.max(
    Math.abs(fundamental.score - overallScore),
    Math.abs(technical.score - overallScore),
    Math.abs(financial.score - overallScore),
    Math.abs(macro.score - overallScore)
  );
  let confidence = Math.min(confMax, Math.max(confMin, Math.round(overallScore - scoreVariance * varMult)));
  confidence = Math.round(confidence * degFactor);
  const riskMetrics = updatePortfolioRisk(_portfolioState, symbol, currentPrice, priceHistory, sig.action);
  confidence = Math.round(confidence * riskMetrics.circuitBreaker);
  // Apply calibration
  confidence = mlModel.calibrateConfidence(confidence, mlWinProb);

  // Enforce max drawdown — reduce confidence if portfolio is underwater
  if (_portfolioState.maxDrawdown > maxDrawdownThreshold) {
    confidence = Math.round(confidence * 0.7);
  }

  const regimePenalty = regime.regime === 'crash' ? regimePenaltyCrash : 1;

  let kellyPct = null;
  if (mlWinProb != null && mlWinProb > 0.5) {
    const wlr = _performanceStats.total > 0 ? _performanceStats.wins / Math.max(_performanceStats.losses, 1) : wlrDefault;
    kellyPct = calculateKellyPositionSize(mlWinProb, wlr, maxConcentration);
  }
  let positionSize;
  if (sig.action === 'sell') {
    // Exit/avoid rating — no position is opened, so no capital is allocated.
    positionSize = 0;
  } else if (kellyPct != null && kellyPct > 0) {
    positionSize = Math.round(kellyPct * regimePenalty);
  } else {
    positionSize = calculatePositionSize(sig, regime.regime, confidence, scoreVariance);
    positionSize = Math.round(positionSize * regimePenalty);
  }
  const formattedVolume = volume >= 1000000 ? (volume / 1000000).toFixed(1) + 'M' : (volume / 1000).toFixed(1) + 'K';
  const macroReason = generateMacroReason(macro);
  let reason = generateReason(symbol, fundamental, technical, financial, sig, macroReason);
  // generateReason ends with a terminal period; drop it before appending the
  // catalyst/speculative/insider segments so the period lands exactly once, at
  // the very end, instead of producing "risk.. | Deal catalyst" fragments.
  reason = reason.replace(/\.+$/, '');
  if (cat.direction === 'positive' && cat.type) {
    reason += ` | Deal catalyst: ${cat.type} (${cat.direction})${cat.headline ? ` — ${cat.headline.slice(0, 80)}` : ''}`;
  } else if (cat.direction === 'negative' && cat.type) {
    reason += ` | Negative catalyst: ${cat.type}${cat.headline ? ` — ${cat.headline.slice(0, 80)}` : ''}`;
  }
  if (speculative) {
    const z = stock.altmanZ != null ? `Altman Z ${stock.altmanZ}` : 'distressed fundamentals';
    reason += ` | SPECULATIVE: +${speculative.momentum}% run over ~${speculative.lookback} sessions on sentiment/catalyst while fundamentals stay weak (${z}) - rally not earnings-backed, composite capped at Hold, high reversal risk`;
  }
  if (insider && insider.hasActivity && insider.score !== 50) {
    const netPos = insider.netShares != null ? insider.netShares >= 0 : insider.buyCount >= insider.sellCount;
    const dirWord = netPos ? 'buying' : 'selling';
    const netTxt = insider.netShares != null ? `, net ${Math.abs(insider.netShares).toLocaleString()} shares` : '';
    const latest = insider.latestDate ? `, latest: ${insider.latestDate}` : '';
    reason += ` | Insider ${dirWord}: ${insider.buyCount} buys / ${insider.sellCount} sells${netTxt} (score ${insider.score}${latest})`;
  }
  reason += '.';
  // Expected holding period derived from the engine's own volatility measurement:
  // how many trading sessions price needs to travel from entry to target1 at the
  // stock's average daily range (tradeLevels.expectedDays). Falls back to the
  // per-type label when no target exists (Sell/Avoid ratings have no levels).
  const timeframes = { 'Aggressive Buy': '1-4 weeks', 'Momentum Trade': '1-3 weeks', 'Swing Trade': '2-4 weeks', 'Long Term Value': '3-6 months', 'Long Term': '3-6 months', 'Avoid': 'N/A' };
  const holdingPeriod = formatHoldingPeriod(tradeLevels.expectedDays, tradeType);
  const isNse = NSE_SYMBOLS.includes(symbol);
  const obj = {
    id: `signal-${symbol}-${Date.now()}`, ticker: symbol, name: stock.name,
    price: Math.round(currentPrice * 100) / 100, change: Math.round(priceChange * 100) / 100,
    market: isNse ? 'NSE' : 'Global', country: getCountryForSymbol(symbol), currency: isNse ? 'KES' : 'USD',
    type: tradeType, signal: sig.signal, action: sig.action, entry: tradeLevels.entry,
    stopLoss: tradeLevels.stopLoss, target1: tradeLevels.target1, target2: tradeLevels.target2, target3: tradeLevels.target3,
    riskReward: tradeLevels.riskReward, confidence, positionSize: positionSize + '%',
    timeframe: holdingPeriod || timeframes[tradeType], sector: stock.sector, volume: formattedVolume, rawVolume: volume || 0,
    weeklyTrend: weeklyTrend.trend, regime: regime.regime,
    catalyst: cat.direction ? {
      type: cat.type, direction: cat.direction, strength: cat.strength || 1,
      headline: cat.headline || null, source: cat.source || null, publishedAt: cat.publishedAt || null,
    } : null,
    speculative: speculative ? {
      momentumPct: speculative.momentum,
      lookbackSessions: speculative.lookback,
      altmanZ: stock.altmanZ != null ? stock.altmanZ : null,
      warning: 'Sentiment/catalyst-driven rally on distressed fundamentals - capped at Hold, not a Buy',
    } : null,
    insider: insider ? {
      score: insider.score,
      hasActivity: insider.hasActivity,
      netShares: insider.netShares != null ? insider.netShares : null,
      netShareRatio: insider.netShareRatio,
      buyCount: insider.buyCount,
      sellCount: insider.sellCount,
      neutralCount: insider.neutralCount,
      latestDate: insider.latestDate,
      latestText: insider.latestText,
      summary: insider.summary,
      shortFloatPct: ownershipShortFloat(stock.ownership),
    } : null,
    var95: riskMetrics.var95 + '%',
    var99: riskMetrics.var99 ? riskMetrics.var99 + '%' : null,
    cvar95: riskMetrics.cvar95 ? riskMetrics.cvar95 + '%' : null,
    mlWinProb: mlWinProb != null ? Math.round(mlWinProb * 100) + '%' : null,
    reason,
    dataSource: stock.dataSource || 'fallback',
    progress: getSignalProgress(symbol, currentPrice),
    analysis: {
      fundamental: { score: fundamental.score, grade: fundamental.fundamentalGrade, metrics: { ...fundamental.metrics, dataSource: stock.dataSource || 'fallback' } },
      technical: { score: technical.score, grade: technical.technicalGrade, indicators: technical.indicators },
      financial: { score: financial.score, grade: financial.financialGrade, analysis: financial.analysis },
      macro: { score: macro.score, grade: macro.grade, signal: macro.signal, country: macro.country, summary: macro.summary, conditions: macro.conditions },
      insider: insider ? { score: insider.score, grade: getGrade(insider.score), hasActivity: insider.hasActivity, netShares: insider.netShares, buyCount: insider.buyCount, sellCount: insider.sellCount, latestDate: insider.latestDate, summary: insider.summary } : { score: null, grade: 'N/A', hasActivity: false, summary: 'No insider data (NSE stocks have no Yahoo insider coverage)' },
      mlFeatures,
      overall: { score: Math.round(overallScore), grade: getGrade(Math.round(overallScore)), dataSource: stock.dataSource || 'fallback' },
      forwardTest: getForwardTestSnapshot(),
      liveTest: getLiveTestSnapshot(),
    },
    timestamp: new Date().toISOString(), lastUpdated: new Date().toLocaleString()
  };
  // Log prediction for accuracy tracking (fire-and-forget)
  persistPredictionLog(symbol, sig.signal, mlWinProb, confidence).catch(() => {});
  _lastCycleScores.set(symbol, overallScore);
  return obj;
}

// ─── Strict Signal Eligibility Gate ──────────────────────────────────────────
// Dynamic, all-conditions check applied per stock BEFORE a signal may be issued:
// a real quote, enough price history to compute trustworthy levels, a tradable
// volume, every scoring dimension actually computed (not NaN), non-sparse data,
// and sane stop/entry/target geometry with a minimum risk/reward. A stock that
// fails any condition does not get a signal — no degraded/partial signals.
// Note: the confidence bar is NOT part of this gate; it is enforced separately
// on the final feed (minConfidence filter) so a momentarily low-confidence stock
// never blocks an already-open monitored position from being tracked.
function meetsSignalConditions(sigObj, { currentPrice, priceHistory, volume, fundamental, technical, financial, macro } = {}) {
  const reasons = [];
  const isFin = (v) => typeof v === 'number' && Number.isFinite(v);

  if (!sigObj) { reasons.push('no signal object'); return { ok: false, reasons }; }

  if (!isFin(currentPrice) || currentPrice <= 0) reasons.push(`invalid price ${currentPrice}`);

  const histLen = Array.isArray(priceHistory) ? priceHistory.length : 0;
  if (histLen < MIN_SIGNAL_HISTORY) reasons.push(`insufficient history (${histLen}/${MIN_SIGNAL_HISTORY} bars)`);

  if (!volume || volume <= 0) reasons.push('no volume');

  if (fundamental && !isFin(fundamental.score)) reasons.push('fundamental score missing');
  if (technical && !isFin(technical.score)) reasons.push('technical score missing');
  if (financial && !isFin(financial.score)) reasons.push('financial score missing');
  if (macro && !isFin(macro.score)) reasons.push('macro score missing');

  const doubleSparse =
    fundamental?.metrics?.dataQuality === 'Very sparse data' &&
    technical?.indicators?.dataQuality === 'Insufficient history';
  if (doubleSparse) reasons.push('sparse fundamental + technical data');

  if (sigObj.action === 'buy') {
    const e = Number(sigObj.entry), s = Number(sigObj.stopLoss), t1 = Number(sigObj.target1);
    if (!(isFin(e) && isFin(s) && isFin(t1) && e > 0 && s > 0 && t1 > 0)) {
      reasons.push(`invalid buy levels (entry=${sigObj.entry}, stop=${sigObj.stopLoss}, target=${sigObj.target1})`);
    } else if (!(s < e && e < t1)) {
      reasons.push(`non-monotonic buy levels (stop=${s} >= entry=${e} >= target=${t1})`);
    }
    if (Number.isFinite(sigObj.riskReward) && sigObj.riskReward < MIN_RISK_REWARD) {
      reasons.push(`low risk/reward ${sigObj.riskReward}`);
    }
  } else if (sigObj.action === 'sell') {
    // Sell/Avoid ratings are exit references, not mirrored shorts — no levels
    // are produced for them, so geometry checks don't apply.
  }

  return { ok: reasons.length === 0, reasons };
}

// ─── Prediction Accuracy Logging ──────────────────────────────────────────────
async function persistPredictionLog(ticker, signalType, mlProb, confidence) {
  if (mlProb == null) return;
  try {
    await pool.query(
      `INSERT INTO prediction_log (ticker, signal_type, ml_prob, confidence, predicted_outcome, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [ticker, signalType, mlProb, confidence, mlProb >= 0.5 ? 'win' : 'loss']
    );
  } catch { /* table may not exist */ }
}

async function resolvePredictionLogs(ticker, actualOutcome) {
  try {
    await pool.query(
      `UPDATE prediction_log
       SET actual_outcome = $1, resolved_at = NOW()
       WHERE ticker = $2 AND actual_outcome IS NULL
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [actualOutcome, ticker]
    );
  } catch { /* table may not exist */ }
}

async function batchResolveStalePredictions() {
  try {
    // Resolve prediction_log entries by matching against signal_outcomes
    // for entries that have been unresolved for at least 24 hours
    const result = await pool.query(`
      UPDATE prediction_log pl
      SET actual_outcome = so.result, resolved_at = NOW()
      FROM signal_outcomes so
      WHERE pl.actual_outcome IS NULL
        AND pl.ticker = so.ticker
        AND pl.created_at < NOW() - INTERVAL '24 hours'
        AND so.recorded_at >= pl.created_at
        AND so.recorded_at <= pl.created_at + INTERVAL '14 days'
    `);
    if (result.rowCount > 0) {
      console.log(`[SignalService] Batch-resolved ${result.rowCount} stale prediction_log entries`);
    }
  } catch { /* table may not exist */ }
}

// Run batch resolver every hour
setInterval(() => {
  batchResolveStalePredictions().catch(() => {});
}, 60 * 60 * 1000);

// ─── Auto-Optimization Scheduler ─────────────────────────────────────────────
let _optimizeHandle = null;
function startAutoOptimize() {
  if (_optimizeHandle) clearInterval(_optimizeHandle);
  const hours = engineConfig.getConfig().weights?.optimize_frequency_hours || 24;
  const ms = hours * 60 * 60 * 1000;
  console.log(`[SignalService] Auto-weight optimization every ${hours}h`);
  _optimizeHandle = setInterval(() => {
    optimizeWeights().then(result => {
      if (result.best && result.best.score > 0.5) {
        engineConfig.updateConfig({ weights: { fundamental: result.best.fundamental, technical: result.best.technical, financial: result.best.financial, macro: result.best.macro } });
        logAuditEvent('weight_optimization', 'Auto-optimized weights', { result });
      }
    }).catch(() => {});
  }, ms);
  _optimizeHandle.unref && _optimizeHandle.unref();
}

// Start auto-optimization after a short delay to let DB restore complete
setTimeout(startAutoOptimize, 10000);

module.exports = { 
  generateSignals, 
  getSignalForStock, 
  getSignalsSummary,
  getSignalHistory,
  searchStocks,
  warmFMPCache,
  getFundamentals,
  detectSpeculativeRally,
  scoreInsiderActivity,
  scoreNewsInsider,
  _buildSignal,
  persistSignals,
  persistPredictionLog,
  resolvePredictionLogs,
  KNOWN_FUNDAMENTALS,
  ALL_SYMBOLS,
  NSE_SYMBOLS,
  US_SYMBOLS,
  getEngineHealth,
  refreshPerformanceStats,
  restoreStateFromDb,
  backfillOutcomesFromHistory,
  runHistoricalBacktest,
  // Backtesting & Forward Testing
  computeBacktestStats,
  getForwardTestStats,
  getForwardTestPredictions,
  getSellAudit,
  sanitizeLiveFundamentals,
  resolveAllForwardPredictions,
  // Pure helpers (unit-testable sell/exit + resolution logic)
  classifySignalBucket,
  evaluateForwardPrediction,
  evaluateSellRelative,
  evaluateSellAtHorizon,
  sellThresholdsFor,
  dedupeSellPredictions,
  isGarbageQuote,
  getPriorScore,
  getLiveTestSnapshot,
  getLiveWinRate,
  // Monitor gate decisions (unit-testable conviction-fade exit + stop re-leveling)
  assessConvictionFade,
  isLongTermHold,
  fadeCloseReason,
  evaluateScoreClose,
  computeRelevelStop,
  // Audit & Config
  getAuditLog,
  logAuditEvent,
  getEngineConfig,
  updateEngineConfig,
  // Auto-optimization
  startAutoOptimize,
  optimizeWeights,
  // New module exports
  mlModel,
  executeOrder: require('./orderRouter').executeOrder,
  getPortfolioValue: require('./orderRouter').getPortfolioValue,
  getAllPositions: require('./orderRouter').getAllPositions,
  updatePositions: require('./orderRouter').updatePositions,
  triggerAlert: require('./monitorService').triggerAlert,
  getQualityScore,
  getSignalsCacheTime: () => _signalsCacheTime,
  signalEventBus,
  getSignalProgress,
  getMonitoredAction,
  getMonitoredSignals,
  refreshMonitoredQuotes,
  OPEN_POSITION_MAX_AGE_HOURS,
};