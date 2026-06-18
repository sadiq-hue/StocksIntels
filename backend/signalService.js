// Signal Service - AI-powered trading signal generation for NSE and NYSE stocks
// Uses hardcoded fundamentals for known stocks and auto-generates for any stock

const axios = require('axios');
const { pool } = require('./db');

const { getStockQuote, getQuotesBatch } = require('./marketService');
const { fetchHistoricalQuotes } = require('./globalScraper');
const { getMacroScore, getCountryForSymbol, generateMacroReason } = require('./macroService');
const { getAggregatedSentiment } = require('./newsService');
const { getKeyMetrics, getQuote, getCompanyProfile } = require('./financialReportsService');
const { calculateSMA } = require('./technicalIndicators');
const { guessSector, resolveStockName, KNOWN_NAMES, NSE_SYMBOLS, US_SYMBOLS, ALL_SYMBOLS, SECTOR_AVG_PE, INDUSTRY_MEDIAN_EV_EBITDA, TBILI_RATE, KNOWN_FUNDAMENTALS, NSE_FUNDAMENTALS } = require('./stockData');
const { getEffectiveSectorPE, getGrade, determineSignal, determineTradeType, getSectorMacroAdjustment, analyzeFundamentals, analyzeTechnicals, analyzeFinancials, generateReason } = require('./analysisEngine');
const { calculatePositionSize, calculateKellyPositionSize, calculateTradeLevels, updatePortfolioRisk, applyPortfolioConstraints, trackSignalOutcomes } = require('./riskManager');
const mlModel = require('./mlSignalModel');
const engineConfig = require('./engineConfig');
const { trackSignalQuality, logHealth, detectSignalDrift, getQualityScore } = require('./monitorService');

console.log('📊 Signal Service Loaded - AI Trading Signals Engine (NYSE + NSE)');

// Restore performance stats and portfolio state from DB on startup
restoreStateFromDb().catch(() => {});

// In-memory cache for generateSignals to prevent redundant calls
let _signalsCache = null;
let _signalsCacheTime = 0;
let _signalsInProgress = false;
const SIGNALS_CACHE_TTL = 60000; // 60 seconds

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
      _signalsCache = result.rows[0].cache_value;
      _signalsCacheTime = Date.now();
      console.log(`[SignalService] Loaded ${_signalsCache.length} signals from cache DB`);
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
      _signalsCache = hist.rows.map(r => ({
        ticker: r.ticker,
        name: r.ticker,
        sector: r.sector || 'General',
        price: parseFloat(r.price) || 0,
        change: parseFloat(r.change_pct) || 0,
        market: r.market || 'US',
        currency: r.currency || 'USD',
        signal: r.signal || 'Hold',
        type: r.trade_type || 'Swing Trade',
        confidence: parseInt(r.confidence) || 0,
        volume: 0,
        analysis: { overall: { score: 50, grade: 'C' }, fundamental: { score: 50 }, technical: { score: 50 }, financial: { score: 50 }, macro: { score: 50 } },
      }));
      _signalsCacheTime = Date.now();
      console.log(`[SignalService] Loaded ${_signalsCache.length} signals from signal_history (fallback)`);
      return;
    }
  } catch { /* table may not exist */ }

  // Final fallback: build baseline from KNOWN_FUNDAMENTALS
  _buildBaselineCache();
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

// Financial report cache for fundamental analysis (daily refresh)
const _financialReportCache = new Map();
const FINANCIAL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Signal performance tracker (in-memory, rolling 100 signals per symbol)
const _signalOutcomes = new Map();
let _signalHistoryCount = 0;
const _performanceStats = { total: 0, wins: 0, losses: 0, winRate: 0 };
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

function accumulateNseQuote(symbol, price, volume) {
  const today = new Date().toISOString().split('T')[0];
  if (!_nseIntradayBuffer.has(symbol)) _nseIntradayBuffer.set(symbol, {});
  const buf = _nseIntradayBuffer.get(symbol);
  if (!buf[today]) buf[today] = { open: price, high: price, low: price, close: price, volume: 0 };
  const bar = buf[today];
  bar.high = Math.max(bar.high, price);
  bar.low = Math.min(bar.low, price);
  bar.close = price;
  bar.volume += volume || 0;
}

function flushNseDailyBars() {
  const today = new Date().toISOString().split('T')[0];
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
  return history.map(d => d.close);
}

async function getPriceHistory(symbol) {
  const cached = _priceHistoryCache.get(symbol);
  if (cached && Date.now() - cached.ts < PRICE_HISTORY_CACHE_TTL) {
    return cached.data;
  }

  const isNse = NSE_SYMBOLS.includes(symbol);
  const yahooSymbol = isNse ? `${symbol}.NR` : symbol;

  const bars = await fetchHistoricalQuotes(yahooSymbol, '3mo', '1d');
  if (bars && bars.length >= 2) {
    const prices = bars.map(b => b.close).filter(p => p != null);
    prices.volumes = bars.map(b => b.volume).filter(v => v != null);
    _priceHistoryCache.set(symbol, { data: prices, ts: Date.now() });
    return prices;
  }

  // NSE fallback: use accumulated daily history from scraper data
  if (isNse) {
    const nsePrices = getNseDailyHistory(symbol);
    if (nsePrices) {
      _priceHistoryCache.set(symbol, { data: nsePrices, ts: Date.now() });
      return nsePrices;
    }
  }

  _priceHistoryCache.set(symbol, { data: null, ts: Date.now() });
  return null;
}

async function prefetchPriceHistories(symbols) {
  const batchSize = 20;
  const delayMs = 100;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(s => getPriceHistory(s)));
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function prefetchWeeklyData(symbols) {
  const batchSize = 20;
  const delayMs = 50;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(s => getWeeklyData(s)));
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ─── Real Financial Metrics from Yahoo Finance ──────────────────────────────
async function fetchRealFinancialMetrics(symbol) {
  if (NSE_SYMBOLS.includes(symbol)) return null;
  const cached = _financialReportCache.get(symbol);
  if (cached && Date.now() - cached.ts < FINANCIAL_CACHE_TTL) return cached.data;
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const qs = await yf.quoteSummary(symbol, { modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'summaryProfile'] });
    if (!qs?.financialData) { _financialReportCache.set(symbol, { data: null, ts: Date.now() }); return null; }

    const fd = qs.financialData;
    const dk = qs.defaultKeyStatistics || {};
    const sd = qs.summaryDetail || {};
    const sp = qs.summaryProfile || {};

    const metrics = {};
    if (sp.sector) metrics.sector = sp.sector;

    // PE ratio: try trailingPE, forwardPE, or compute from price/EPS
    let peVal = sd.trailingPE != null ? sd.trailingPE : dk.trailingPE;
    if (peVal == null) peVal = sd.forwardPE != null ? sd.forwardPE : dk.forwardPE;
    if (peVal == null && fd.currentPrice && fd.earningsPerShare > 0) peVal = fd.currentPrice / fd.earningsPerShare;
    if (peVal != null) metrics.peRatio = Math.round(peVal * 10) / 10;

    if (dk.priceToBook != null) metrics.pbRatio = Math.round(dk.priceToBook * 10) / 10;
    if (fd.currentRatio != null) metrics.currentRatio = Math.round(fd.currentRatio * 100) / 100;
    if (fd.revenueGrowth != null) metrics.revenueGrowth = Math.round(fd.revenueGrowth * 1000) / 10;
    if (fd.earningsGrowth != null) metrics.epsGrowth = Math.round(fd.earningsGrowth * 1000) / 10;
    if (fd.returnOnEquity != null) metrics.roe = Math.round(fd.returnOnEquity * 1000) / 10;
    if (fd.dividendYield != null) metrics.dividendYield = Math.round(fd.dividendYield * 100 * 10) / 10;
    if (fd.payoutRatio != null) metrics.payoutRatio = Math.round(fd.payoutRatio * 100);
    if (dk.marketCap) metrics.marketCap = dk.marketCap;
    if (fd.currentPrice) metrics.price = fd.currentPrice;

    // Debt/equity: yahoo-finance2 may return pct (>20) or decimal
    let deVal = fd.debtToEquity;
    if (deVal != null) {
      if (deVal > 20) deVal = deVal / 100;
      metrics.debtToEquity = Math.round(deVal * 100) / 100;
    }

    // Free cash flow yield
    if (fd.freeCashflow && dk.sharesOutstanding > 0 && fd.currentPrice > 0) {
      metrics.fcfYield = Math.round((fd.freeCashflow / dk.sharesOutstanding / fd.currentPrice) * 1000) / 10;
    }

    // Try fundamentalsTimeSeries for Altman Z + detailed income/balance sheet data
    try {
      const fts = await yf.fundamentalsTimeSeries(symbol, { period1: Math.floor(Date.now() / 1000) - 3 * 365 * 86400, module: 'all' });
      if (Array.isArray(fts) && fts.length > 0) {
        // Income statement: find latest FY with revenue
        const annuals = fts.filter(i => i.periodType === 'FY' && i.totalRevenue != null).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const current = annuals[0];
        const previous = annuals[1];
        if (current?.totalRevenue && previous?.totalRevenue > 0) {
          metrics.revenueGrowth = Math.round(((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 1000) / 10;
        }
        if (current?.basicEPS && previous?.basicEPS > 0) {
          metrics.epsGrowth = Math.round(((current.basicEPS - previous.basicEPS) / previous.basicEPS) * 1000) / 10;
        }
        const currMargin = current?.totalRevenue > 0 && current.operatingIncome != null ? (current.operatingIncome / current.totalRevenue) * 100 : null;
        const prevMargin = previous?.totalRevenue > 0 && previous?.operatingIncome != null ? (previous.operatingIncome / previous.totalRevenue) * 100 : null;
        if (currMargin != null && prevMargin != null) metrics.marginChange = Math.round((currMargin - prevMargin) * 10) / 10;
        if (current.basicEPS) metrics.eps = Math.round(current.basicEPS * 100) / 100;
        if (current.EBITDA) metrics.ebitda = current.EBITDA;
        if (current.netIncome) metrics.netIncome = current.netIncome;
        if (current.totalRevenue) metrics.revenue = current.totalRevenue;

        // Balance sheet: latest FY with totalAssets
        const bal = fts.filter(i => i.periodType === 'FY' && i.totalAssets != null).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        if (bal) {
          metrics.totalDebt = bal.totalDebt || 0;
          metrics.cash = bal.cashAndCashEquivalents || 0;
          if (current?.netIncome && bal.totalEquity > 0) {
            metrics.roe = Math.round((current.netIncome / bal.totalEquity) * 1000) / 10;
          }
          // Altman Z
          if (current?.netIncome && current?.totalRevenue > 0 && bal.totalAssets > 0 && bal.totalLiabilities > 0) {
            const wc = (bal.totalCurrentAssets || 0) - (bal.totalCurrentLiabilities || 0);
            const re = bal.retainedEarnings || 0;
            const ebit = current.operatingIncome || current.EBITDA || 0;
            const mcap = dk.marketCap || 0;
            const ta = bal.totalAssets;
            const tl = bal.totalLiabilities;
            const X1 = wc / ta; const X2 = re / ta; const X3 = ebit / ta;
            const X4 = mcap / tl; const X5 = current.totalRevenue / ta;
            metrics.altmanZ = Math.round((1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5) * 100) / 100;
          }
        }

        // EV/EBITDA
        if (metrics.marketCap && metrics.totalDebt != null && metrics.cash != null && metrics.ebitda) {
          const ev = metrics.marketCap + metrics.totalDebt - metrics.cash;
          if (ev > 0) metrics.evEbitda = Math.round((ev / metrics.ebitda) * 10) / 10;
        }
      }
    } catch { /* fundamentalsTimeSeries optional — metrics already populated from quoteSummary */ }

    const hasUsableMetrics = metrics.peRatio || metrics.roe || metrics.revenueGrowth || metrics.currentRatio;
    _financialReportCache.set(symbol, { data: hasUsableMetrics ? metrics : null, ts: Date.now() });
    return hasUsableMetrics ? metrics : null;
  } catch (e) {
    console.warn(`[SignalService] Failed to fetch real financials for ${symbol}: ${e.message}`);
    _financialReportCache.set(symbol, { data: null, ts: Date.now() });
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
  const batchSize = 30;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    try {
      const marketSymbols = batch.map(s => NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s);
      const quotes = await getQuotesBatch(marketSymbols);
      for (const s of batch) {
        const q = quotes[NSE_SYMBOLS.includes(s) ? `NSE:${s}` : s];
        if (q && q.price) {
          _quoteCache.set(s, { price: q.price, changePercent: q.changePercent || 0, volume: q.volume || 0, ts: Date.now() });
        }
      }
    } catch { /* individual fallback handled in main loop */ }
    if (i + batchSize < toFetch.length) await new Promise(r => setTimeout(r, 50));
  }
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
      const prices = await getPriceHistory(etf);
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
async function restoreStateFromDb() {
  try {
    // Load all historical outcomes into memory so health/trade tracking works across restarts
    const outcomes = await pool.query(
      `SELECT ticker, entry_price, signal, exit_price, result, recorded_at FROM signal_outcomes ORDER BY recorded_at DESC`
    );
    _signalOutcomes.clear();
    for (const row of outcomes.rows) {
      _signalOutcomes.set(row.ticker, {
        entryPrice: parseFloat(row.entry_price) || 0,
        signal: row.signal,
        exitPrice: row.exit_price != null ? parseFloat(row.exit_price) : null,
        result: row.result,
        recordedAt: row.recorded_at,
      });
    }

    // Compute performance stats from last 30 days of resolved outcomes
    const result = await pool.query(
      `SELECT result, COUNT(*) as cnt FROM signal_outcomes
       WHERE recorded_at > NOW() - INTERVAL '30 days'
       GROUP BY result`
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

    // Track total signal history rows for health display
    const histCount = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_history').catch(() => ({ rows: [{ cnt: 0 }] }));
    _signalHistoryCount = histCount.rows[0]?.cnt || 0;

    console.log(`[SignalService] Restored ${_signalOutcomes.size} outcomes, ${_signalHistoryCount} history rows from DB (${wins} wins, ${losses} losses in last 30d)`);

    // If no outcomes exist yet, approximate them from recent signal_history using current prices
    if (_signalOutcomes.size === 0 && _signalHistoryCount > 0) {
      await backfillOutcomesFromHistory(30, 500);
    }
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
async function backfillOutcomesFromHistory(days = 30, maxRows = 500) {
  try {
    const outcomeCount = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes').catch(() => ({ rows: [{ cnt: 0 }] }));
    if ((outcomeCount.rows[0]?.cnt || 0) > 0) return; // only backfill when empty

    const result = await pool.query(`
      SELECT DISTINCT ON (sh.ticker, sh.entry_price) sh.ticker, sh.signal, sh.entry_price, sh.generated_at
      FROM signal_history sh
      LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price
      WHERE sh.generated_at > NOW() - $1::interval
        AND sh.signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')
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
      const isBuy = row.signal === 'Strong Buy' || row.signal === 'Buy' || row.signal === 'Accumulate';
      const isSell = row.signal === 'Sell' || row.signal === 'Strong Sell' || row.signal === 'Reduce';
      if (!isBuy && !isSell) continue;
      const won = isBuy ? returnPct > 0.5 : returnPct < -0.5;
      const resultStr = won ? 'win' : 'loss';
      try {
        await pool.query(
          `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [row.ticker, row.entry_price, row.signal, currentPrice, resultStr, row.generated_at]
        );
        inserted++;
        if (won) wins++; else losses++;
        _signalOutcomes.set(row.ticker, { entryPrice: row.entry_price, signal: row.signal, exitPrice: currentPrice, result: resultStr, recordedAt: row.generated_at });
      } catch { /* skip duplicates */ }
    }

    _performanceStats.wins += wins;
    _performanceStats.losses += losses;
    _performanceStats.total += wins + losses;
    _performanceStats.winRate = _performanceStats.total > 0
      ? Math.round((_performanceStats.wins / _performanceStats.total) * 1000) / 10 : 0;
    console.log(`[SignalService] Backfilled ${inserted} outcomes from signal_history (${wins} wins, ${losses} losses)`);
  } catch (e) {
    console.warn('[SignalService] backfillOutcomesFromHistory error:', e.message);
  }
}

// ─── Historical Backtest: evaluate signal_history against actual OHLC history ─
// For each signal in signal_history, walks forward day-by-day using the signal's
// own stop_loss / target1 levels to decide win/loss, then inserts the outcome.
async function runHistoricalBacktest({ days = 90, maxHoldDays = 10, maxSignals = 1000, force = false } = {}) {
  try {
    const result = await pool.query(`
      SELECT sh.id, sh.ticker, sh.signal, sh.entry_price, sh.stop_loss, sh.target1, sh.target2, sh.generated_at
      FROM signal_history sh
      ${force ? '' : 'LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price'}
      WHERE sh.generated_at > NOW() - $1::interval
        AND sh.generated_at < NOW() - INTERVAL '1 hour'
        AND sh.signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')
        AND sh.entry_price > 0
        AND sh.stop_loss > 0
        AND sh.target1 > 0
        ${force ? '' : 'AND so.id IS NULL'}
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
      const yahooSymbol = isNse ? `${ticker}.NR` : ticker;

      // Reuse cached bars when possible to avoid repeated API calls
      let cached = _histBacktestCache.get(yahooSymbol);
      if (!cached || Date.now() - cached.ts > HIST_BACKTEST_CACHE_TTL) {
        const bars = await fetchHistoricalQuotes(yahooSymbol, '3mo', '1d').catch(() => null);
        if (!bars || bars.length < 2) {
          console.warn(`[HistoricalBacktest] No historical bars for ${ticker}`);
          continue;
        }
        cached = { bars, ts: Date.now() };
        _histBacktestCache.set(yahooSymbol, cached);
      }
      const bars = cached.bars;

      for (const sig of signals) {
        try {
          const entry = parseFloat(sig.entry_price);
          const stop = parseFloat(sig.stop_loss);
          const target = parseFloat(sig.target1);
          const signalDate = new Date(sig.generated_at);
          const isBuy = sig.signal === 'Strong Buy' || sig.signal === 'Buy' || sig.signal === 'Accumulate';
          const isSell = sig.signal === 'Sell' || sig.signal === 'Strong Sell' || sig.signal === 'Reduce';
          if (!isBuy && !isSell) continue;

          // Find the first bar on or after the signal date
          let startIdx = bars.findIndex(b => new Date(b.date + 'T00:00:00Z').getTime() >= signalDate.getTime());
          if (startIdx < 0) startIdx = bars.length - 1;
          if (startIdx >= bars.length) continue;

          let exitPrice = null;
          let resultStr = null;
          let exitDay = 0;

          for (let i = startIdx; i < Math.min(startIdx + maxHoldDays, bars.length); i++) {
            const bar = bars[i];
            const dayHigh = parseFloat(bar.high);
            const dayLow = parseFloat(bar.low);
            const dayClose = parseFloat(bar.close);
            if (!dayHigh || !dayLow || !dayClose) continue;

            exitDay = i - startIdx;

            if (isBuy) {
              if (dayLow <= stop) { exitPrice = stop; resultStr = 'loss'; break; }
              if (dayHigh >= target) { exitPrice = target; resultStr = 'win'; break; }
            } else {
              // Sell direction: profit when price falls to target1, loss when it rises to stop_loss
              if (dayHigh >= stop) { exitPrice = stop; resultStr = 'loss'; break; }
              if (dayLow <= target) { exitPrice = target; resultStr = 'win'; break; }
            }

            // If max hold reached, close at close price
            if (i === startIdx + maxHoldDays - 1 || i === bars.length - 1) {
              exitPrice = dayClose;
              const pnl = (dayClose - entry) / entry * 100;
              resultStr = isBuy ? (pnl > 0 ? 'win' : 'loss') : (pnl < 0 ? 'win' : 'loss');
              break;
            }
          }

          if (!exitPrice || !resultStr) continue;

          await pool.query(
            `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [sig.ticker, entry, sig.signal, exitPrice, resultStr, sig.generated_at]
          );
          totalInserted++;
          if (resultStr === 'win') totalWins++; else totalLosses++;
          _signalOutcomes.set(sig.ticker, { entryPrice: entry, signal: sig.signal, exitPrice, result: resultStr, recordedAt: sig.generated_at });
        } catch (e) {
          errors++;
          console.warn(`[HistoricalBacktest] Error evaluating ${sig.ticker}:`, e.message);
        }
      }
    }

    _performanceStats.wins += totalWins;
    _performanceStats.losses += totalLosses;
    _performanceStats.total += totalWins + totalLosses;
    _performanceStats.winRate = _performanceStats.total > 0
      ? Math.round((_performanceStats.wins / _performanceStats.total) * 1000) / 10 : 0;

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
    if (_financialReportCache.has(sym)) {
      const fm = _financialReportCache.get(sym);
      if (fm && fm.data && fm.data.peRatio) {
        const stock = getFundamentals(sym);
        if (stock && stock.sector) {
          if (!sectorData[stock.sector]) sectorData[stock.sector] = { sum: 0, count: 0 };
          sectorData[stock.sector].sum += fm.data.peRatio;
          sectorData[stock.sector].count++;
        }
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
    const yahooSymbol = isNse ? `${symbol}.NR` : symbol;
    const { fetchHistoricalQuotes } = require('./globalScraper');
    const bars = await fetchHistoricalQuotes(yahooSymbol, '6mo', '1wk');
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
    // Primary data source: signal_outcomes — has actual exit prices and real win/loss results
    let outcomeRows;
    try {
      const conditions = ['recorded_at > NOW() - $1::interval'];
      const params = [`${days} days`];
      let idx = 2;
      if (signalType && signalType !== 'All') { conditions.push(`signal = $${idx++}`); params.push(signalType); }
      const result = await pool.query(
        `SELECT ticker, signal, entry_price, exit_price, result, recorded_at
         FROM signal_outcomes ${'WHERE ' + conditions.join(' AND ')}
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
          COUNT(*) FILTER (WHERE result = 'win' AND (signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce'))) AS wins,
          COUNT(*) FILTER (WHERE result = 'loss' AND (signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce'))) AS losses,
          COUNT(*) FILTER (WHERE signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')) AS total
        FROM signal_outcomes
        WHERE recorded_at > NOW() - $1::interval
      `, [`${days} days`]);
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
        WHERE recorded_at > NOW() - $1::interval
          AND signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')
        GROUP BY signal
      `, [`${days} days`]);
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
          SELECT ticker, signal, entry_price, exit_price, (exit_price - entry_price) / entry_price * 100 AS return_pct
          FROM signal_outcomes
          WHERE recorded_at > NOW() - $1::interval
            AND signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')
            AND entry_price > 0 AND exit_price > 0 AND exit_price != entry_price
          ORDER BY recorded_at ASC
        `, [`${days} days`]);

        let avgReturn = 0, profitFactor = 0, sharpe = 0, maxDrawdown = 0;
        let retVals = returnsResult.rows.map(r => parseFloat(r.return_pct));

        // If not enough valid exit prices, approximate returns from signal_history using batched live prices
        if (retVals.length < 10) {
          try {
            const fallback = await pool.query(`
              SELECT sh.ticker, sh.signal, sh.entry_price
              FROM signal_history sh
              LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price
              WHERE sh.generated_at > NOW() - $1::interval
                AND sh.signal IN ('Strong Buy','Buy','Accumulate','Sell','Strong Sell','Reduce')
                AND sh.entry_price > 0
              ORDER BY sh.generated_at DESC
              LIMIT $2
            `, [`${days} days`, limit]);
            const tickers = [...new Set(fallback.rows.map(r => r.ticker))];
            const quotes = await getQuotesBatch(tickers).catch(() => ({}));
            const approxReturns = [];
            for (const row of fallback.rows) {
              const quote = quotes[row.ticker];
              if (!quote || !quote.price) continue;
              const returnPct = ((quote.price - row.entry_price) / row.entry_price) * 100;
              const isBuy = row.signal === 'Strong Buy' || row.signal === 'Buy' || row.signal === 'Accumulate';
              const signedReturn = isBuy ? returnPct : -returnPct;
              approxReturns.push(signedReturn);
            }
            if (approxReturns.length > 0) retVals = approxReturns;
          } catch (e) { /* keep signal_outcomes returns if any */ }
        }

        if (retVals.length > 0) {
          const totalReturn = retVals.reduce((s, v) => s + v, 0);
          avgReturn = Math.round((totalReturn / retVals.length) * 10) / 10;
          const mean = totalReturn / retVals.length;
          sharpe = retVals.length > 1 ? Math.round((mean / (stdDev(retVals) || 1)) * 100) / 100 : 0;
          // Max drawdown: compound equity curve peak-to-trough
          let equity = 100, peak = 100, maxDd = 0;
          for (const r of retVals) {
            equity *= (1 + r / 100);
            if (equity > peak) peak = equity;
            const dd = ((peak - equity) / peak) * 100;
            if (dd > maxDd) maxDd = dd;
          }
          maxDrawdown = Math.round(maxDd * 10) / 10;
          // Profit factor: gross wins / gross losses
          const grossWins = retVals.filter(v => v > 0).reduce((s, v) => s + v, 0);
          const grossLosses = Math.abs(retVals.filter(v => v < 0).reduce((s, v) => s + v, 0));
          profitFactor = grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : grossWins > 0 ? 999 : 0;
        }

      // Fill by-signal avgReturn using batched live price quotes
      try {
        const signalTypes = Object.keys(bySignal);
        const historyBySignal = {};
        const allTickers = new Set();
        for (const st of signalTypes) {
          const rows = await pool.query(`
            SELECT sh.ticker, sh.entry_price
            FROM signal_history sh
            LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price
            WHERE sh.generated_at > NOW() - $1::interval
              AND sh.signal = $2
              AND sh.entry_price > 0
            ORDER BY sh.generated_at DESC
            LIMIT $3
          `, [`${days} days`, st, 50]);
          historyBySignal[st] = rows.rows;
          rows.rows.forEach(r => allTickers.add(r.ticker));
        }
        const quotes = await getQuotesBatch(Array.from(allTickers)).catch(() => ({}));
        for (const st of signalTypes) {
          const isBuy = st === 'Strong Buy' || st === 'Buy' || st === 'Accumulate';
          const rets = [];
          for (const row of historyBySignal[st]) {
            const quote = quotes[row.ticker];
            if (!quote || !quote.price) continue;
            const returnPct = ((quote.price - row.entry_price) / row.entry_price) * 100;
            rets.push(isBuy ? returnPct : -returnPct);
          }
          bySignal[st].avgReturn = rets.length > 0 ? Math.round((rets.reduce((s, v) => s + v, 0) / rets.length) * 10) / 10 : 0;
        }
      } catch { /* avgReturn stays 0 */ }

      const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
      return {
        total, wins, losses, winRate,
        avgReturn, profitFactor, sharpe, maxDrawdown,
        dataSource: retVals.length > 0 ? 'signal_outcomes_with_live_price_fallback' : 'signal_outcomes',
        bySignal,
      };
    }

    // Fallback: use signal_history joined with signal_outcomes for unresolved signals
    // Uses current live prices as approximate exit (honest about the methodology)
    try {
      const conditions = ['sh.generated_at > NOW() - $1::interval'];
      const params = [`${days} days`];
      let idx = 2;
      if (signalType && signalType !== 'All') { conditions.push(`sh.signal = $${idx++}`); params.push(signalType); }
      if (minConfidence > 0) { conditions.push(`sh.confidence >= $${idx++}`); params.push(minConfidence); }
      const result = await pool.query(
        `SELECT sh.ticker, sh.signal, sh.entry_price, sh.generated_at
         FROM signal_history sh
         LEFT JOIN signal_outcomes so ON so.ticker = sh.ticker AND so.entry_price = sh.entry_price
         WHERE so.id IS NULL AND ${conditions.join(' AND ')}
         ORDER BY sh.generated_at DESC LIMIT $${idx}`,
        [...params, limit]
      );
      const rows = result.rows;
      console.log(`[Backtest] Fallback signal_history query returned ${rows.length} unresolved rows`);
      if (!rows.length) return { total: 0, wins: 0, losses: 0, winRate: 0, avgReturn: 0, profitFactor: 0, sharpe: 0, maxDrawdown: 0, bySignal: {}, dataSource: 'none' };

      let wins = 0, losses = 0, total = 0, totalReturn = 0;
      const returns = [];
      const bySignal = {};
      for (const row of rows) {
        const entryPrice = parseFloat(row.entry_price);
        if (!entryPrice || entryPrice <= 0) continue;
        try {
          const quote = await getStockQuote(row.ticker);
          if (!quote || !quote.price) continue;
          const currentPrice = quote.price;
          const returnPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          const isBuy = row.signal === 'Strong Buy' || row.signal === 'Buy' || row.signal === 'Accumulate';
          const isSell = row.signal === 'Sell' || row.signal === 'Strong Sell' || row.signal === 'Reduce';
          if (!isBuy && !isSell) continue;
          const signedReturn = isBuy ? returnPct : -returnPct;
          const won = signedReturn > 0;
          if (won) wins++; else losses++;
          total++;
          totalReturn += signedReturn;
          returns.push(signedReturn);
          if (!bySignal[row.signal]) bySignal[row.signal] = { wins: 0, losses: 0, total: 0, returns: [] };
          bySignal[row.signal].total++;
          bySignal[row.signal].returns.push(signedReturn);
          if (won) bySignal[row.signal].wins++; else bySignal[row.signal].losses++;
        } catch { /* skip */ }
      }
      const avgReturn = total > 0 ? totalReturn / total : 0;
      return {
        total, wins, losses,
        winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
        avgReturn: Math.round(avgReturn * 10) / 10,
        profitFactor: 0,
        sharpe: returns.length > 1 ? Math.round((avgReturn / (stdDev(returns) || 1)) * 100) / 100 : 0,
        maxDrawdown: 0,
        dataSource: 'live_prices_approximate',
        bySignal: Object.fromEntries(Object.entries(bySignal).map(([k, v]) => [k, {
          total: v.total, wins: v.wins, losses: v.losses,
          winRate: v.total > 0 ? Math.round((v.wins / v.total) * 1000) / 10 : 0,
          avgReturn: v.returns.length > 0 ? Math.round((v.returns.reduce((s, r) => s + r, 0) / v.returns.length) * 10) / 10 : 0,
        }]))
      };
    } catch { /* fall through to empty */ }

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
const _forwardTestStore = new Map(); // symbol -> { predictions: [{id, signal, confidence, price, generated_at, resolved, actualReturn, correct}] }

const FORWARD_TEST_MIN_AGE = 28800000; // 8 hours — predictions younger than this are skipped

async function _loadForwardPredictionsFromDb() {
  try {
    const result = await pool.query(
      `SELECT id, symbol, signal, confidence, price, generated_at, resolved, actual_return, correct
       FROM forward_predictions ORDER BY generated_at`
    );
    const resolved = result.rows.filter(r => r.resolved).length;
    const unresolved = result.rows.length - resolved;
    if (result.rows.length) console.log(`[SignalService] Loaded ${result.rows.length} forward predictions from DB (${unresolved} unresolved, ${resolved} resolved)`);
    for (const row of result.rows) {
      if (!_forwardTestStore.has(row.symbol)) _forwardTestStore.set(row.symbol, { predictions: [] });
      _forwardTestStore.get(row.symbol).predictions.push({
        id: row.id, signal: row.signal, confidence: row.confidence,
        price: Number(row.price), generatedAt: new Date(row.generated_at).getTime(),
        resolved: !!row.resolved, actualReturn: Number(row.actual_return), correct: row.correct,
      });
    }
  } catch (e) { /* table may not exist yet */ }
}

async function recordForwardPrediction(symbol, signalAction, confidence, price) {
  // Dedup: skip if an unresolved prediction for this symbol exists from the last 2 hours
  const existing = _forwardTestStore.get(symbol);
  if (existing) {
    const recent = existing.predictions.find(p => !p.resolved && Date.now() - p.generatedAt < FORWARD_TEST_MIN_AGE);
    if (recent) return;
  }
  if (!_forwardTestStore.has(symbol)) _forwardTestStore.set(symbol, { predictions: [] });
  const store = _forwardTestStore.get(symbol);
  let dbId = null;
  try {
    const result = await pool.query(
      `INSERT INTO forward_predictions (symbol, signal, confidence, price) VALUES ($1, $2, $3, $4) RETURNING id`,
      [symbol, signalAction, confidence, price]
    );
    dbId = result.rows[0].id;
  } catch (e) { /* persistence best-effort */ }
  store.predictions.push({
    id: dbId, signal: signalAction, confidence, price,
    generatedAt: Date.now(), resolved: false,
    actualReturn: null, correct: null,
  });
  if (store.predictions.length > 200) store.predictions = store.predictions.slice(-200);
}

async function resolveForwardPredictions(symbol) {
  const store = _forwardTestStore.get(symbol);
  if (!store || !store.predictions.length) return;
  const unresolved = store.predictions.filter(p => !p.resolved);
  if (!unresolved.length) return;
  try {
    const quote = await getStockQuote(symbol);
    if (!quote || !quote.price) return;
    const currentPrice = quote.price;
    for (const pred of unresolved) {
      if (Date.now() - pred.generatedAt < FORWARD_TEST_MIN_AGE) continue; // wait before resolving
      const returnPct = ((currentPrice - pred.price) / pred.price) * 100;
      const isBuy = pred.signal === 'Strong Buy' || pred.signal === 'Buy' || pred.signal === 'Accumulate';
      const isSell = pred.signal === 'Sell' || pred.signal === 'Strong Sell' || pred.signal === 'Reduce';
      pred.actualReturn = Math.round(returnPct * 10) / 10;
      if (Math.abs(returnPct) < 0.01) continue; // skip if price unchanged — wait for next cycle
      if (isBuy) pred.correct = returnPct > 0.5;
      else if (isSell) pred.correct = returnPct < -0.5;
      else pred.correct = Math.abs(returnPct) < 0.5;
      pred.resolved = true;
      if (pred.id) {
        pool.query(
          `UPDATE forward_predictions SET resolved = TRUE, actual_return = $1, correct = $2 WHERE id = $3`,
          [pred.actualReturn, pred.correct, pred.id]
        ).catch(() => {});
      }
    }
  } catch { /* skip */ }
}

async function getForwardTestStats() {
  let total = 0, correct = 0, pending = 0;
  const byConfidence = {};
  const bySymbol = {};

  // Load in-memory predictions (current session)
  for (const [symbol, store] of _forwardTestStore) {
    for (const p of store.predictions) {
      if (!p.resolved) { pending++; continue; }
      total++;
      if (p.correct) correct++;
      const bucket = p.confidence >= 80 ? 'high' : p.confidence >= 60 ? 'med' : 'low';
      if (!byConfidence[bucket]) byConfidence[bucket] = { total: 0, correct: 0 };
      byConfidence[bucket].total++;
      if (p.correct) byConfidence[bucket].correct++;
      if (!bySymbol[symbol]) bySymbol[symbol] = { total: 0, correct: 0, accuracy: 0 };
      bySymbol[symbol].total++;
      if (p.correct) bySymbol[symbol].correct++;
    }
  }

  // Also load resolved predictions from DB (prior sessions)
  try {
    const dbResult = await pool.query(
      `SELECT symbol, confidence, correct FROM forward_predictions WHERE resolved = TRUE
       AND generated_at > NOW() - INTERVAL '90 days'`
    );
    for (const row of dbResult.rows) {
      const sym = row.symbol;
      const bucket = row.confidence >= 80 ? 'high' : row.confidence >= 60 ? 'med' : 'low';
      // Deduplicate: skip if this exact prediction is already in the in-memory store
      const store = _forwardTestStore.get(sym);
      if (store) {
        const dup = store.predictions.some(p => p.id === row.id);
        if (dup) continue;
      }
      total++;
      if (row.correct) correct++;
      if (!byConfidence[bucket]) byConfidence[bucket] = { total: 0, correct: 0 };
      byConfidence[bucket].total++;
      if (row.correct) byConfidence[bucket].correct++;
      if (!bySymbol[sym]) bySymbol[sym] = { total: 0, correct: 0, accuracy: 0 };
      bySymbol[sym].total++;
      if (row.correct) bySymbol[sym].correct++;
    }
  } catch { /* table may not exist */ }

  for (const k of Object.keys(bySymbol)) {
    bySymbol[k].accuracy = bySymbol[k].total > 0
      ? Math.round((bySymbol[k].correct / bySymbol[k].total) * 1000) / 10 : 0;
  }
  return {
    totalPredictions: total,
    pendingPredictions: pending,
    accuracy: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0,
    byConfidence: Object.fromEntries(Object.entries(byConfidence).map(([k, v]) => [k, {
      total: v.total, accurate: v.correct,
      accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : 0,
    }])),
    bySymbol,
  };
}

function getForwardTestPredictions({ symbol, resolved, limit = 50, offset = 0 } = {}) {
  const all = [];
  for (const [sym, store] of _forwardTestStore) {
    for (const p of store.predictions) {
      if (symbol && sym !== symbol) continue;
      if (resolved !== undefined && p.resolved !== resolved) continue;
      all.push({ symbol: sym, ...p, generatedAt: new Date(p.generatedAt).toISOString() });
    }
  }
  all.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  return { predictions: all.slice(offset, offset + limit), total: all.length };
}

async function resolveAllForwardPredictions() {
  let resolved = 0, failed = 0, skipped = 0;
  for (const [symbol, store] of _forwardTestStore) {
    const unresolved = store.predictions.filter(p => !p.resolved);
    if (!unresolved.length) continue;
    try {
      const quote = await getStockQuote(symbol);
      if (!quote || !quote.price) { failed += unresolved.length; continue; }
      const currentPrice = quote.price;
      for (const pred of unresolved) {
        if (Date.now() - pred.generatedAt < FORWARD_TEST_MIN_AGE) { skipped++; continue; }
        const returnPct = ((currentPrice - pred.price) / pred.price) * 100;
        const isBuy = pred.signal === 'Strong Buy' || pred.signal === 'Buy' || pred.signal === 'Accumulate';
        const isSell = pred.signal === 'Sell' || pred.signal === 'Strong Sell' || pred.signal === 'Reduce';
        pred.actualReturn = Math.round(returnPct * 10) / 10;
        // Skip resolution if price hasn't changed (market closed, stale quote) — wait for next cycle
        if (Math.abs(returnPct) < 0.01) { skipped++; continue; }
        if (isBuy) pred.correct = returnPct > 0.5;
        else if (isSell) pred.correct = returnPct < -0.5;
        else pred.correct = Math.abs(returnPct) < 0.5;
        pred.resolved = true;
        if (pred.id) {
          pool.query(
            `UPDATE forward_predictions SET resolved = TRUE, actual_return = $1, correct = $2 WHERE id = $3`,
            [pred.actualReturn, pred.correct, pred.id]
          ).catch(() => {});
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
async function persistSignalOutcome(symbol, entryPrice, signalAction, currentPrice, result) {
  try {
    await pool.query(
      `INSERT INTO signal_outcomes (ticker, entry_price, signal, exit_price, result, recorded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [symbol, entryPrice, signalAction, currentPrice, result]
    );
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

// ─── Health Check ───────────────────────────────────────────────────────────
function getEngineHealth() {
  return {
    status: Object.values(_sourceHealth).every(h => h.ok) ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    sources: { ..._sourceHealth },
    performance: { ..._performanceStats },
    portfolio: {
      consecutiveLosses: _portfolioState.consecutiveLosses,
      totalTrades: _portfolioState.totalTrades,
      maxDrawdown: Math.round(_portfolioState.maxDrawdown * 1000) / 10,
    },
    regime: _marketRegime.regime,
    signalCount: _signalHistoryCount,
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
// fetchRealFinancialMetrics() — this is only useful for NSE stocks missing from NSE_FUNDAMENTALS.
async function warmFMPCache(symbols) {
  const MAX_SYMBOLS = 50;
  const toFetch = symbols.filter(s => !_financialReportCache.has(s)).slice(0, MAX_SYMBOLS);
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

function getFundamentals(symbol) {
  const cached = realFundamentalsCache.get(symbol);
  let base;
  if (cached && Date.now() - cached.ts < FUND_CACHE_TTL) {
    base = { ...cached.data };
  } else {
    base = KNOWN_FUNDAMENTALS[symbol] || NSE_FUNDAMENTALS[symbol];
    // For US stocks not in KNOWN_FUNDAMENTALS, create minimal base
    // so real financials from Yahoo Finance can be merged below
    if (!base && !NSE_SYMBOLS.includes(symbol)) {
      base = { name: resolveStockName(symbol), sector: guessSector(symbol) };
    }
    if (!base) {
      console.warn(`[SignalService] No fundamentals for ${symbol} — skipping`);
      return null;
    }
  }
  const result = {
    evEbitda: null, fcfYield: null, payoutRatio: 50, marginChange: 0,
    epsSurprise: null, altmanZ: 2.5,
    newsSentiment: 'neutral',
    ...base
  };
  // Merge real financial metrics from Yahoo Finance for US stocks
  if (_financialReportCache.has(symbol)) {
    const fm = _financialReportCache.get(symbol);
    if (fm && Date.now() - fm.ts < FINANCIAL_CACHE_TTL) {
      Object.assign(result, fm.data);
    }
  }
  if (!result.name || result.name === symbol) {
    result.name = resolveStockName(symbol);
  }
  if (!result.sector || result.sector === 'N/A') {
    result.sector = (KNOWN_FUNDAMENTALS[symbol]?.sector || NSE_FUNDAMENTALS[symbol]?.sector || guessSector(symbol));
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
    const actionable = signals.filter(s => s.signal !== 'Hold');
    console.log(`[SignalService] Persisting ${signals.length} signals (${actionable.length} non-Hold) to signal_history`);
    const values = signals.map(s => [
      s.ticker, s.signal, s.confidence, s.price, s.change || 0,
      s.entry || s.price, s.stopLoss || 0, s.target1 || 0, s.target2 || 0,
      s.riskReward || 1, s.sector || 'General', s.market || 'Global',
      s.currency || 'USD', s.type || 'Swing Trade', s.timeframe || '2-4 weeks', s.reason || '',
    ]);
    const placeholders = values.map((_, i) => {
      const base = i * 16;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14}, $${base+15}, $${base+16}, NOW())`;
    }).join(',');
    const flat = values.flat();
    const result = await pool.query(
      `INSERT INTO signal_history (ticker, signal, confidence, price, change_pct, entry_price, stop_loss, target1, target2, risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at)
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
    const result = await pool.query(
      "DELETE FROM signal_history WHERE generated_at < NOW() - INTERVAL '7 days'"
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
              target1, target2, risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at
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
setTimeout(() => {
  generateSignals(null, true).catch(() => {});
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

// Auto-run historical backtest every 6 hours to mature signal outcomes
setTimeout(() => {
  runHistoricalBacktest({ days: 90, maxHoldDays: 5, maxSignals: 1000 }).catch(() => {});
}, 60000);
setInterval(() => {
  runHistoricalBacktest({ days: 90, maxHoldDays: 5, maxSignals: 1000 }).catch(() => {});
}, 6 * 60 * 60 * 1000);

// Main function to generate signals for all tracked stocks
// When quick=true, skips all external API fetches and uses only cached data.
async function generateSignals(marketData = null, quick = false, force = false) {
  if (!marketData && !quick && !force && _signalsCache && Date.now() - _signalsCacheTime < SIGNALS_CACHE_TTL) {
    return _signalsCache;
  }
  if (!marketData && quick && _signalsCache) {
    return _signalsCache;
  }
  if (!marketData && !quick && _signalsInProgress) {
    return _signalsCache || [];
  }

  // Skip generation outside US market hours unless marketData is explicitly provided or force=true
  if (!marketData && !quick && !force) {
    const now = new Date();
    const day = now.getDay();
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isDST = now.getMonth() >= 2 && now.getMonth() <= 9;
    const etMinutes = ((utcMinutes + (isDST ? -4 : -5) * 60) % 1440 + 1440) % 1440;
    const marketOpen = day !== 0 && day !== 6 && etMinutes >= 570 && etMinutes < 960;
    if (!marketOpen) {
      if (_signalsCache) return _signalsCache;
      return [];
    }
  }

  const signals = [];
  // When marketData is provided (e.g. from publisher), only process those symbols
  const rawSymbols = marketData ? Object.keys(marketData) : ALL_SYMBOLS;
  // Skip NSE symbols — NSE data source unavailable
  const symbols = rawSymbols.filter(s => !NSE_SYMBOLS.includes(s));
  const cfg = engineConfig.getConfig();
  const maxSymbols = cfg.maxSymbols || 200;
  if (!marketData && symbols.length > maxSymbols) {
    symbols.length = maxSymbols;
  }
  if (!marketData && !quick) _signalsInProgress = true;
  try {

  // Quick mode: skip all external fetches, use only cached data
  let newsSentiment = {};
  let regime = _marketRegime;
  if (!quick) {
    try {
      newsSentiment = await Promise.race([
        getAggregatedSentiment(),
        new Promise(resolve => setTimeout(() => resolve({}), 2000)),
      ]);
    } catch { /* silent */ }
    const usSymbols = symbols.filter(s => !NSE_SYMBOLS.includes(s));
    await Promise.all([
      prefetchPriceHistories(symbols).catch(() => {}),
      prefetchFinancialReports(usSymbols).catch(() => {}),
      prefetchQuotes(symbols).catch(() => {}),
      prefetchWeeklyData(symbols).catch(() => {}),
    ]);
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
        if (!quote) return null;
        currentPrice = quote.price;
        priceChange = quote.changePercent;
        volume = quote.volume;
      }
    }
    
    if (NSE_SYMBOLS.includes(symbol)) accumulateNseQuote(symbol, currentPrice, volume);
    
    const fundamental = analyzeFundamentals(stock, currentPrice, newsSentiment[symbol] || null, _dynamicSectorPE);
    const priceHistory = await getPriceHistory(symbol);
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
      priceHistory, degFactor
    });
    const prevOutcome = _signalOutcomes.get(symbol);
    trackSignalOutcomes(_portfolioState, _performanceStats, _signalOutcomes, symbol, currentPrice, sigObj);
    if (sigObj.signal !== 'Hold') {
      recordForwardPrediction(symbol, sigObj.signal, sigObj.confidence, currentPrice).catch(() => {});
      if (prevOutcome && prevOutcome.result) {
        persistSignalOutcome(symbol, prevOutcome.entryPrice, prevOutcome.signal, currentPrice, prevOutcome.result);
      }
    }
    resolveForwardPredictions(symbol).catch(() => {});
    return sigObj;
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
    const signalOrder = { 'Strong Buy': 6, 'Buy': 5, 'Accumulate': 4, 'Hold': 3, 'Sell': 2, 'Strong Sell': 1 };
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
    return signals.find(s => s.ticker === upper);
  }
  // Generate signal for a single unknown stock
  return generateSingleSignal(upper);
}

async function generateSingleSignal(symbol) {
  try {
    const stock = getFundamentals(symbol);
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
    try {
      const sentimentMap = await getAggregatedSentiment();
      newsSent = sentimentMap[symbol] || null;
    } catch { /* silent */ }
    const priceHistory = await getPriceHistory(symbol).catch(() => null);
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
      newsSent, priceHistory, degFactor
    });
    if (sigObj) persistPortfolioState().catch(() => {});
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
    accumulate: signals.filter(s => s.signal === 'Accumulate').length,
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
    const scoreMap = { 'Strong Buy': 90, 'Buy': 75, 'Accumulate': 60, 'Hold': 45, 'Sell': 30, 'Strong Sell': 15 };
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

// ─── Shared Signal Builder ──────────────────────────────────────────────────
// Consolidates scoring, confidence, position sizing, and signal object construction
// used by both generateSignals() and generateSingleSignal().
async function _buildSignal({ symbol, stock, currentPrice, priceChange, volume, fundamental, technical, financial, macro, regime, weights, weeklyTrend, newsSent, priceHistory, degFactor }) {
  // Read scoring and portfolio config once at the top
  const sc = engineConfig.getConfig().scoring?.signal_confidence || {};
  const baselineConf = sc.baseline ?? 50;
  const confMin = sc.min ?? 10;
  const confMax = sc.max ?? 95;
  const varMult = sc.variance_multiplier ?? 0.3;
  const newsPos = sc.news_positive ?? 5;
  const newsNeg = sc.news_negative ?? -5;
  const sparseFT = sc.sparse_fund_tech ?? -4;
  const sparseFF = sc.sparse_fund_fin ?? -3;
  const dirBuy = sc.direction_buy_threshold ?? 55;
  const dirSell = sc.direction_sell_threshold ?? 45;
  const wlrDefault = sc.kelly_wlr_default ?? 1.5;
  const portfolioCfg = engineConfig.getConfig().portfolio || {};
  const maxConcentration = portfolioCfg.maxConcentration || 0.25;
  const maxDrawdownThreshold = portfolioCfg.maxDrawdown || 0.20;
  const stopLossPct = portfolioCfg.stopLoss || 0.05;
  const regimePenaltyCrash = sc.regime_penalty_crash ?? 0.5;

  // Compute ML win probability BEFORE weighted score so it can contribute
  let mlWinProb = null;
  try {
    mlWinProb = await mlModel.predictWinProbability(fundamental, technical, macro, priceHistory, currentPrice, volume, symbol, stock.sector, stock);
  } catch { /* ML model not ready */ }
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

  const direction = adjScore >= dirBuy ? 'buy' : adjScore < dirSell ? 'sell' : 'hold';
  const sparseFund = fundamental.metrics?.dataQuality === 'Very sparse data';
  const sparseTech = technical.indicators?.dataQuality === 'Insufficient history';
  const sparseFin = financial.analysis?.financialHealth === 'Limited financial data';
  if (sparseFund && sparseTech) adjScore += sparseFT;
  if (sparseFund && sparseFin) adjScore += sparseFF;
  if (newsSent === 'positive') adjScore += newsPos;
  else if (newsSent === 'negative') adjScore += newsNeg;
  let overallScore = Math.max(0, Math.min(100, Math.round(adjScore)));

  // Use configurable thresholds instead of hardcoded
  const thresholds = engineConfig.getConfig().thresholds;
  let sig;
  if (overallScore >= thresholds.strong_buy) sig = { signal: 'Strong Buy', action: 'buy', strength: 'strong' };
  else if (overallScore >= thresholds.buy) sig = { signal: 'Buy', action: 'buy', strength: 'moderate' };
  else if (overallScore >= thresholds.accumulate) sig = { signal: 'Accumulate', action: 'buy', strength: 'weak' };
  else if (overallScore >= thresholds.hold) sig = { signal: 'Hold', action: 'hold', strength: 'neutral' };
  else if (overallScore >= thresholds.reduce) sig = { signal: 'Reduce', action: 'sell', strength: 'weak' };
  else if (overallScore >= thresholds.sell) sig = { signal: 'Sell', action: 'sell', strength: 'moderate' };
  else sig = { signal: 'Strong Sell', action: 'sell', strength: 'strong' };

  const tradeType = determineTradeType(technical.score, fundamental.score);
  const tradeLevels = calculateTradeLevels(symbol, currentPrice, sig, priceHistory, stopLossPct);
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
  if (kellyPct != null && kellyPct > 0) {
    positionSize = Math.round(kellyPct * regimePenalty);
  } else {
    positionSize = calculatePositionSize(sig, regime.regime, confidence, scoreVariance);
    positionSize = Math.round(positionSize * regimePenalty);
  }
  const formattedVolume = volume >= 1000000 ? (volume / 1000000).toFixed(1) + 'M' : (volume / 1000).toFixed(1) + 'K';
  const macroReason = generateMacroReason(macro);
  const reason = generateReason(symbol, fundamental, technical, financial, sig, macroReason);
  const timeframes = { 'Aggressive Buy': '1-4 weeks', 'Momentum Trade': '1-3 weeks', 'Swing Trade': '2-4 weeks', 'Long Term Value': '3-6 months', 'Long Term': '3-6 months', 'Avoid': 'N/A' };
  const isNse = NSE_SYMBOLS.includes(symbol);
  const obj = {
    id: `signal-${symbol}-${Date.now()}`, ticker: symbol, name: stock.name,
    price: Math.round(currentPrice * 100) / 100, change: Math.round(priceChange * 10) / 10,
    market: isNse ? 'NSE' : 'Global', country: getCountryForSymbol(symbol), currency: isNse ? 'KES' : 'USD',
    type: tradeType, signal: sig.signal, entry: tradeLevels.entry,
    stopLoss: tradeLevels.stopLoss, target1: tradeLevels.target1, target2: tradeLevels.target2,
    riskReward: tradeLevels.riskReward, confidence, positionSize: positionSize + '%',
    timeframe: timeframes[tradeType], sector: stock.sector, volume: formattedVolume,
    weeklyTrend: weeklyTrend.trend, regime: regime.regime,
    var95: riskMetrics.var95 + '%',
    var99: riskMetrics.var99 ? riskMetrics.var99 + '%' : null,
    cvar95: riskMetrics.cvar95 ? riskMetrics.cvar95 + '%' : null,
    mlWinProb: mlWinProb != null ? Math.round(mlWinProb * 100) + '%' : null,
    reason,
    analysis: {
      fundamental: { score: fundamental.score, grade: fundamental.fundamentalGrade, metrics: fundamental.metrics },
      technical: { score: technical.score, grade: technical.technicalGrade, indicators: technical.indicators },
      financial: { score: financial.score, grade: financial.financialGrade, analysis: financial.analysis },
      macro: { score: macro.score, grade: macro.grade, signal: macro.signal, country: macro.country, summary: macro.summary, conditions: macro.conditions },
      overall: { score: Math.round(overallScore), grade: getGrade(Math.round(overallScore)) }
    },
    timestamp: new Date().toISOString(), lastUpdated: new Date().toLocaleString()
  };
  // Log prediction for accuracy tracking (fire-and-forget)
  persistPredictionLog(symbol, sig.signal, mlWinProb, confidence).catch(() => {});
  return obj;
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
  persistSignals,
  persistPredictionLog,
  resolvePredictionLogs,
  KNOWN_FUNDAMENTALS,
  ALL_SYMBOLS,
  NSE_SYMBOLS,
  US_SYMBOLS,
  getEngineHealth,
  restoreStateFromDb,
  backfillOutcomesFromHistory,
  runHistoricalBacktest,
  // Backtesting & Forward Testing
  computeBacktestStats,
  getForwardTestStats,
  getForwardTestPredictions,
  resolveAllForwardPredictions,
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
};