// Risk management — position sizing, trade levels, portfolio constraints, outcome tracking.
// Functions are stateless and take all required state as parameters.
const { calculateATR, findResistanceLevels } = require('./technicalIndicators');
const { kellyFraction, monteCarloVaR } = require('./portfolioOptimizer');

// ─── Kelly Criterion Position Sizing ────────────────────────────────────────
// Uses ML-predicted win probability + historical win/loss ratio.
function calculateKellyPositionSize(winProb, winLossRatio, maxFraction = 0.25) {
  if (winProb == null || winProb <= 0.5) return 0;
  const kelly = kellyFraction(winProb, winLossRatio || 1.5);
  return Math.round(Math.min(kelly, maxFraction) * 100);
}

// ─── Legacy Position Sizing (fallback when no ML prob available) ────────────
function calculatePositionSize(signal, regime, confidence, scoreVariance) {
  if (signal.action === 'hold') return 0;
  let baseSize = 0;
  if (signal.strength === 'strong') baseSize = 0.40;
  else if (signal.strength === 'moderate') baseSize = 0.25;
  else if (signal.strength === 'weak' && signal.action === 'buy') baseSize = 0.10;
  else if (signal.strength === 'weak' && signal.action === 'sell') baseSize = 0.15;
  if (regime === 'crash' && signal.action === 'buy') baseSize *= 0.3;
  else if (regime === 'bull' && signal.action === 'sell') baseSize *= 0.5;
  else if (regime === 'bear' && signal.action === 'buy') baseSize *= 0.6;
  const confFactor = confidence / 95;
  baseSize *= confFactor;
  if (scoreVariance > 20) baseSize *= 0.7;
  if (scoreVariance > 30) baseSize *= 0.5;
  return Math.round(Math.min(Math.max(baseSize, 0), 1) * 100);
}

// Stop distance scales with the trade's holding horizon: a momentum trade needs a
// tight stop (1.5x ATR) while a 3-6 month "Long Term Value" hold needs room to
// breathe (3x ATR) or it gets stopped out on ordinary noise.
const TRADE_TYPE_STOP_MULT = {
  'Momentum Trade': 1.5,
  'Aggressive Buy': 1.5,
  'Swing Trade': 2,
  'Long Term Value': 3,
  'Long Term': 3,
};
// Minimum stop distance (fraction of price). A pure ATR-scaled stop on a calm
// stock can shrink to ~2% (1% daily range x 2x), which is only two days of
// ordinary noise — one bad day or a small gap stops it out on noise, not thesis
// failure. The floor keeps the stop (and the 3x targets it sizes) at a realistic
// distance from entry. 5% proved too tight in production: a normal 2-4% daily
// range is barely 1-2 ATRs under a 5% stop, so ordinary intraday swings stopped
// out names before a move could play out (e.g. PINS stopped at -5.6% on noise).
// 10% is ~2.5-5 ATRs of room for typical US names — enough to breathe through a
// pullback while still capping a stop-out loss at a bounded 10%. The re-level
// pre-lock cap respects the same floor so live monitoring never tightens a calm
// stock's stop back into the noise.
const MIN_STOP_PCT = 0.10;
// Absolute stop ceiling (fraction of price). calculateATR clamps daily range at
// 15%, so the widest legitimate ATR-scaled stop is 2x that (30%) for a swing
// trade — a stop must always leave a high-volatility name at least ~2 daily
// ranges of room, or one bad day stops it out on noise. A tighter ceiling (the
// old 15%) truncated an 8%+ daily-range stock's stop to less than two ranges.
const MAX_STOP_PCT = 0.30;
// Target multiples anchor T1/T2/T3 to the actual stop distance, so the
// risk-reward profile holds at any stop width: T1 is the resolution target
// (touch = win) sized at 2x the risk (a guaranteed minimum 2:1 reward), while
// T2/T3 are informational upside at 4x / 6x the risk.
const TARGET1_MULT = 2;
const TARGET2_MULT = 4;
const TARGET3_MULT = 6;

// T1 is the near-term resolution target, anchored to the real stop distance so
// the 2:1 reward floor is a genuine guarantee for every name (calm or volatile).
// T2/T3 are then snapped onto real pivot-high resistance when a suitable level
// exists, so the informational targets line up with actual supply zones instead
// of arbitrary prices. A level is accepted when it sits no more than
// RESISTANCE_SNAP_TOLERANCE above the raw risk-multiple target (chasing a
// distant historical print would blow the spacing out of proportion). When no
// resistance is close enough the raw multiple is kept, but MIN_TARGET_SPACING
// guarantees each target sits at least that far above the previous one so
// T1 < T2 < T3 always holds strictly.
const RESISTANCE_SNAP_TOLERANCE = 0.30;
const MIN_TARGET_SPACING = 0.15;

function calculateTradeLevels(symbol, currentPrice, signal, priceHistory = null, stopLossPct = MIN_STOP_PCT, tradeType = 'Swing Trade') {
  const volatility = calculateATR(priceHistory);
  const mult = TRADE_TYPE_STOP_MULT[tradeType] || 1.5;
  const baseDistancePct = Math.max(volatility * mult, MIN_STOP_PCT);
  let entry, stopLoss;
  if (signal.action === 'buy') {
    entry = currentPrice;
    stopLoss = currentPrice - (currentPrice * baseDistancePct);
  } else if (signal.action === 'sell') {
    // Exit/avoid semantics: a Sell is a rating ("the fundamentals/technical/
    // financial/sentiment no longer support holding"), not a mirrored short
    // position. There are no short-style stop/target levels — the rating is
    // validated by whether the stock declines vs this reference price.
    return {
      entry: Math.round(currentPrice * 100) / 100,
      stopLoss: null, target1: null, target2: null, target3: null, riskReward: null,
    };
  } else {
    entry = currentPrice;
    stopLoss = currentPrice * (1 - stopLossPct);
  }
  // Cap stop distance at 2x the base stop, but never more than MAX_STOP_PCT of
  // price so an extreme name can't produce an absurd 60%+ stop. The 30% ceiling
  // still covers the full ATR-scaled range (ATR is clamped at 15%, so a swing
  // stop is at most 2 x 15% = 30%) — it only bites for genuinely pathological
  // cases. Sizing the cap off the floored base distance keeps the 10% minimum
  // stop intact for calm names.
  const maxStopDistance = Math.min(currentPrice * baseDistancePct * 2, currentPrice * MAX_STOP_PCT);
  if (signal.action === 'buy') {
    stopLoss = Math.max(stopLoss, currentPrice - maxStopDistance);
  }

  // Targets anchor to the final stop distance, so the 2:1 / 4:1 / 6:1 ladder is
  // exact even when the cap widens the stop on a pathological name.
  let target1, target2, target3;
  if (signal.action !== 'sell') {
    const risk = Math.abs(entry - stopLoss);
    target1 = entry + risk * TARGET1_MULT;
    target2 = entry + risk * TARGET2_MULT;
    target3 = entry + risk * TARGET3_MULT;
  }

  // Resistance-aware T2/T3 (buy/hold only — sells have no levels). T1 stays at
  // its 2x-risk anchor; each informational target is pushed onto the next real
  // pivot-high resistance at or above the raw multiple (which already enforces
  // MIN_TARGET_SPACING), so the exit map matches chart structure. Falls back to
  // the spacing-guaranteed multiple when no level is close enough.
  if (signal.action !== 'sell' && priceHistory) {
    const levels = findResistanceLevels(priceHistory, entry);
    const snapUp = (raw, prev) => {
      const floor = Math.max(raw, prev * (1 + MIN_TARGET_SPACING));
      const lvl = levels.find(p => p >= floor);
      if (lvl != null && lvl <= raw * (1 + RESISTANCE_SNAP_TOLERANCE)) return lvl;
      return floor;
    };
    target2 = snapUp(target2, target1);
    target3 = snapUp(target3, target2);
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target1 - entry);
  const riskReward = risk > 0 ? (reward / risk).toFixed(1) : '1.0';
  // Expected holding period (trading sessions) for the trade to play out: the
  // distance price must travel to hit target1, divided by the stock's own average
  // daily range. Uses the real volatility the stop was sized from, so a calm name
  // shows a longer horizon than a fast mover instead of a static per-type label.
  const expectedDays = signal.action === 'buy' && target1 > entry && volatility > 0
    ? Math.max(1, Math.ceil((target1 - entry) / (currentPrice * volatility)))
    : null;
  return {
    entry: Math.round(entry * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    target1: Math.round(target1 * 100) / 100,
    target2: Math.round(target2 * 100) / 100,
    target3: Math.round(target3 * 100) / 100,
    riskReward: parseFloat(riskReward),
    expectedDays,
  };
}

// ─── Monte Carlo VaR Risk Assessment ────────────────────────────────────────
// Replaces the simple percentile-VaR with a full Monte Carlo simulation.
// Falls back to the historical sort method when simulation data is insufficient.
function updatePortfolioRisk(portfolioState, symbol, currentPrice, priceHistory, signalAction) {
  let var95 = 0.02, var99 = 0.05, cvar95 = 0.03;

  if (priceHistory && priceHistory.length >= 20) {
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
    }
    // Use Monte Carlo simulation
    const mc = monteCarloVaR(returns, 1, 5000);
    var95 = mc.var95 / 100;
    var99 = mc.var99 / 100;
    cvar95 = mc.cvar95 / 100;
  }

  let circuitBreaker = 1;
  if (portfolioState.consecutiveLosses >= 3) circuitBreaker = 0.5;
  if (portfolioState.consecutiveLosses >= 5) circuitBreaker = 0.25;
  if (portfolioState.consecutiveLosses >= 8) circuitBreaker = 0;

  return { var95: Math.round(var95 * 1000) / 10, var99: Math.round(var99 * 1000) / 10, cvar95: Math.round(cvar95 * 1000) / 10, circuitBreaker, sharpe: null };
}

function applyPortfolioConstraints(signals) {
  if (!signals || signals.length === 0) return signals;
  const sectorExposure = {};
  for (const s of signals) {
    if (s.signal === 'Strong Buy' || s.signal === 'Buy') {
      sectorExposure[s.sector] = (sectorExposure[s.sector] || 0) + 1;
    }
  }
  const totalBuySignals = Object.values(sectorExposure).reduce((a, b) => a + b, 0);
  return signals.map(s => {
    let adjusted = { ...s };
    if (totalBuySignals > 0 && s.sector) {
      const sectorPct = ((sectorExposure[s.sector] || 0) / totalBuySignals) * 100;
      if (sectorPct > 30) {
        adjusted.sectorWarning = `High concentration in ${s.sector} (${Math.round(sectorPct)}% of buy signals)`;
        const penalty = 1 - ((sectorPct - 30) / 100);
        if (adjusted.positionSize) {
          const sizeNum = parseInt(adjusted.positionSize) || 0;
          adjusted.positionSize = Math.round(sizeNum * Math.max(penalty, 0.5)) + '%';
        }
        adjusted.confidence = Math.max(40, Math.round((adjusted.confidence || 50) * Math.max(penalty, 0.7)));
      }
    }
    return adjusted;
  });
}

function trackSignalOutcomes(portfolioState, performanceStats, signalOutcomes, symbol, currentPrice, newSignal, marketOpen = true) {
  let previous = signalOutcomes.get(symbol);
  const posSize = parseInt(newSignal.positionSize) || 25;
  // Only open Buy-direction positions are tracked. Sell/Strong Sell are exit/avoid
  // ratings, not mirrored shorts — they have no stop/target levels and must never
  // enter the monitored map. Storing Holds or ratings inflated "Monitored Signals",
  // refreshed their timestamp every cycle (so they never aged out), and could evict
  // real positions under the 500-entry cap.
  const monitorable = newSignal.action === 'buy' && newSignal.stopLoss != null && newSignal.target1 != null;

  // Minimum signal age before stop/target resolution can fire. A position that
  // resolves within its first few minutes of life (or minutes after a restart
  // restore) was almost certainly created with a stale/expired entry price that
  // diverges from the fresh quote fetched during the current cycle. Without this
  // gate, every stale-signal-on-restart becomes an instant ±10% / ±20% resolved
  // outcome with zero real market participation.
  const MIN_SIGNAL_AGE_MS = 5 * 60 * 1000; // 5 minutes

  if (previous && previous.action !== 'hold' && previous.stopLoss != null && previous.target1 != null && !previous.result) {
    const isPrevBuy = previous.action === 'buy';
    // Defensive guards: never resolve a position whose stop sits on the wrong side of
    // entry (broken/inverted levels) or when the price hasn't actually moved past the
    // level (stale/identical cached quote). Otherwise every broken position resolves
    // as an instant loss with entry == exit on the next cycle.
    const entry = previous.entryPrice;
    const signalAge = Date.now() - (previous.timestamp || 0);
    if (signalAge < MIN_SIGNAL_AGE_MS) {
      // Young signals (freshly created this cycle or restored moments ago) cannot
      // resolve via stop/target — their entry price may not yet reflect a
      // confirmed live-market level. A defer here is a no-op; the position
      // simply waits one more cycle.
      console.warn(`[RiskManager] ${symbol} deferring resolution — signal only ${Math.round(signalAge / 1000)}s old (min ${MIN_SIGNAL_AGE_MS / 1000}s)`);
    } else {
    const saneLevels = entry > 0 && isPrevBuy
      ? previous.stopLoss < entry && previous.target1 > entry
      : entry > 0 && previous.stopLoss > entry && previous.target1 < entry;
    const pctMove = entry > 0 ? Math.abs(currentPrice - entry) / entry : 0;
    // Require a real move past the level but reject impossible single-cycle moves
    // (garbage quotes) that would record absurd outcomes.
    const moved = pctMove > 0.0005 && pctMove < 0.5;
    if (marketOpen && saneLevels && moved) {
      if (isPrevBuy) {
        // Long positions: the hard stop still caps downside, but a winner is no
        // longer banked the moment target1 is touched. On the first touch the
        // stop ratchets up to breakeven and then trails one stop-distance below
        // the highest print, so the position can keep running while never giving
        // back the gain. It resolves as a win when the price pulls back into the
        // trailing stop (or the trade-type expiry closes it at the market).
        if (currentPrice <= previous.stopLoss) {
          previous.result = 'loss'; performanceStats.losses++; performanceStats.total++;
          portfolioState.consecutiveLosses++;
        } else if (!previous.trailing && currentPrice >= previous.target1) {
          const trailDist = Math.max(entry - previous.stopLoss, entry * 0.005);
          previous.trailing = true;
          previous.trailStop = Math.max(entry, currentPrice - trailDist);
          previous.trailedAt = Date.now();
        } else if (previous.trailing) {
          const trailDist = Math.max(entry - previous.stopLoss, entry * 0.005);
          const ratchet = currentPrice - trailDist;
          if (ratchet > previous.trailStop) previous.trailStop = ratchet;
          if (currentPrice <= previous.trailStop) {
            previous.result = 'win'; performanceStats.wins++; performanceStats.total++;
            portfolioState.consecutiveLosses = 0;
          }
        }
      } else {
        if (currentPrice >= previous.stopLoss) {
          previous.result = 'loss'; performanceStats.losses++; performanceStats.total++;
          portfolioState.consecutiveLosses++;
        } else if (currentPrice <= previous.target1) {
          previous.result = 'win'; performanceStats.wins++; performanceStats.total++;
          portfolioState.consecutiveLosses = 0;
        }
      }
    } else if (!marketOpen) {
      // A stop/target can only trigger during the exchange's live session. When the
      // market is closed, the quote is a stale/after-hours value — resolving on it
      // fabricates stop-fills (e.g. a 15:56 UTC "stop hit" for an NSE stock that
      // closed at 12:00 UTC). Defer until the next session where a live quote decides.
      console.warn(`[RiskManager] ${symbol} deferring stop/target resolution - market closed (entry=${entry} stop=${previous.stopLoss} t1=${previous.target1} price=${currentPrice})`);
    } else {
      console.warn(`[RiskManager] Skipping resolution for ${symbol} ${previous.signal} (${previous.action}) entry=${entry} stop=${previous.stopLoss} t1=${previous.target1} price=${currentPrice} saneLevels=${saneLevels} moved=${moved}`);    }
    } // end signal-age guard
    if (previous.result) {
      previous.resolvedAt = Date.now();
      // Record the level that actually resolved the trade (stop for a loss,
      // the trailing stop once engaged / target otherwise for a win) so the
      // persisted outcome shows the true exit, not the market price at the
      // check moment.
      previous.exitPrice = previous.result === 'win'
        ? (previous.trailStop != null ? previous.trailStop : previous.target1)
        : previous.stopLoss;
      portfolioState.totalTrades++;
      performanceStats.winRate = performanceStats.total > 0
        ? Math.round((performanceStats.wins / performanceStats.total) * 1000) / 10 : 0;
    }
    // Clear the resolved entry; re-seed only if the fresh signal is itself a new
    // monitored position (a Buy re-rating). Hold/Sell-after-close means the symbol
    // is no longer tracked rather than lingering as a stale entry.
    if (previous.result) {
      signalOutcomes.delete(symbol);
      if (monitorable) {
        signalOutcomes.set(symbol, {
          entryPrice: currentPrice, signal: newSignal.signal, action: newSignal.action,
          stopLoss: newSignal.stopLoss, target1: newSignal.target1,
          timestamp: Date.now(), result: null, positionSize: posSize, lastProgressAlert: 0,
          type: newSignal.type,
          reason: newSignal.reason || '', analysis: newSignal.analysis || null,
          confidence: newSignal.confidence != null ? newSignal.confidence : null,
          timeframe: newSignal.timeframe || null,
        });
      }
    }
  } else {
    // Covers: no previous entry, a non-monitored entry, or an entry already resolved
    // by the monitor gate before this call. Drop a stale resolved entry and only
    // store a fresh position when the new signal is itself monitorable.
    if (previous && previous.result) signalOutcomes.delete(symbol);
    if (monitorable) {
      signalOutcomes.set(symbol, {
        entryPrice: currentPrice, signal: newSignal.signal, action: newSignal.action,
        stopLoss: newSignal.stopLoss, target1: newSignal.target1,
        timestamp: Date.now(), result: null, positionSize: posSize, lastProgressAlert: 0,
        type: newSignal.type,
        reason: newSignal.reason || '', analysis: newSignal.analysis || null,
        confidence: newSignal.confidence != null ? newSignal.confidence : null,
        timeframe: newSignal.timeframe || null,
      });
    }
  }

  if (signalOutcomes.size > 500) {
    // Evict resolved or Hold entries first — never evict a monitored position
    // that hasn't resolved yet. A live monitored Buy that gets evicted by the
    // FIFO flush becomes a zombie: its stop/target is forgotten and the position
    // can never resolve. Only as a last resort do we trim the oldest entry.
    let evicted = false;
    for (const [key, val] of signalOutcomes) {
      if (val.result) { signalOutcomes.delete(key); evicted = true; break; }
    }
    if (!evicted && signalOutcomes.size > 500) {
      for (const [key, val] of signalOutcomes) {
        if (val.action === 'hold' || !val.stopLoss) { signalOutcomes.delete(key); evicted = true; break; }
      }
    }
    if (!evicted && signalOutcomes.size > 500) {
      const oldest = signalOutcomes.keys().next().value;
      signalOutcomes.delete(oldest);
    }
  }
  return performanceStats;
}

module.exports = {
  MIN_STOP_PCT,
  MAX_STOP_PCT,
  calculatePositionSize,
  calculateKellyPositionSize,
  calculateTradeLevels,
  updatePortfolioRisk,
  applyPortfolioConstraints,
  trackSignalOutcomes,
};
