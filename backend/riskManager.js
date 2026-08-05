// Risk management — position sizing, trade levels, portfolio constraints, outcome tracking.
// Functions are stateless and take all required state as parameters.
const { calculateATR } = require('./technicalIndicators');
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
// Target multiples keep a wide risk-reward profile at any stop width: the
// investor holds for the long term (weeks to months), so T1/T2/T3 are sized at
// 3x / 5x / 8x the stop distance instead of the old tight ~1.33x / ~2.33x.
// T1 is the resolution target (touch = win); T2/T3 are informational upside.
const TARGET1_MULT = 3;
const TARGET2_MULT = 5;
const TARGET3_MULT = 8;

function calculateTradeLevels(symbol, currentPrice, signal, priceHistory = null, stopLossPct = 0.05, tradeType = 'Swing Trade') {
  const volatility = calculateATR(priceHistory);
  const atr = currentPrice * volatility;
  const mult = TRADE_TYPE_STOP_MULT[tradeType] || 1.5;
  let entry, stopLoss, target1, target2, target3;
  if (signal.action === 'buy') {
    entry = currentPrice;
    stopLoss = currentPrice - (atr * mult);
    target1 = currentPrice + (atr * mult * TARGET1_MULT);
    target2 = currentPrice + (atr * mult * TARGET2_MULT);
    target3 = currentPrice + (atr * mult * TARGET3_MULT);
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
    target1 = currentPrice * (1 + stopLossPct);
    target2 = currentPrice * (1 + stopLossPct * 2);
    target3 = currentPrice * (1 + stopLossPct * 3);
  }
  // Cap stop distance at 2x the base stop, but never more than 15% of price so a
  // high-ATR name can't produce an absurd 45% stop. The 15% ceiling lets genuinely
  // volatile names keep a workable stop instead of clamping them to the flat 5%
  // fallback width.
  const maxStopDistance = Math.min(currentPrice * volatility * mult * 2, currentPrice * 0.15);
  if (signal.action === 'buy') {
    stopLoss = Math.max(stopLoss, currentPrice - maxStopDistance);
  } else if (signal.action === 'sell') {
    stopLoss = Math.min(stopLoss, currentPrice + maxStopDistance);
  }
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target1 - entry);
  const riskReward = risk > 0 ? (reward / risk).toFixed(1) : '1.0';
  return {
    entry: Math.round(entry * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    target1: Math.round(target1 * 100) / 100,
    target2: Math.round(target2 * 100) / 100,
    target3: Math.round(target3 * 100) / 100,
    riskReward: parseFloat(riskReward)
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

  if (previous && previous.action !== 'hold' && previous.stopLoss != null && previous.target1 != null && !previous.result) {
    const isPrevBuy = previous.action === 'buy';
    // Defensive guards: never resolve a position whose stop sits on the wrong side of
    // entry (broken/inverted levels) or when the price hasn't actually moved past the
    // level (stale/identical cached quote). Otherwise every broken position resolves
    // as an instant loss with entry == exit on the next cycle.
    const entry = previous.entryPrice;
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
      });
    }
  }

  if (signalOutcomes.size > 500) {
    const oldest = signalOutcomes.keys().next().value;
    signalOutcomes.delete(oldest);
  }
  return performanceStats;
}

module.exports = {
  calculatePositionSize,
  calculateKellyPositionSize,
  calculateTradeLevels,
  updatePortfolioRisk,
  applyPortfolioConstraints,
  trackSignalOutcomes,
};
