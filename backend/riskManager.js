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

function calculateTradeLevels(symbol, currentPrice, signal, priceHistory = null, stopLossPct = 0.05) {
  const volatility = calculateATR(priceHistory);
  const atr = currentPrice * volatility;
  let entry, stopLoss, target1, target2;
  if (signal.action === 'buy') {
    entry = currentPrice;
    stopLoss = currentPrice - (atr * 1.5);
    target1 = currentPrice + (atr * 2);
    target2 = currentPrice + (atr * 3.5);
  } else if (signal.action === 'sell') {
    entry = currentPrice;
    stopLoss = currentPrice + (atr * 1.5);
    target1 = currentPrice - (atr * 2);
    target2 = currentPrice - (atr * 3.5);
  } else {
    entry = currentPrice;
    stopLoss = currentPrice * (1 - stopLossPct);
    target1 = currentPrice * (1 + stopLossPct);
    target2 = currentPrice * (1 + stopLossPct * 2);
  }
  const maxStopDistance = currentPrice * volatility * 3;
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
    if (s.signal === 'Strong Buy' || s.signal === 'Buy' || s.signal === 'Accumulate') {
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

function trackSignalOutcomes(portfolioState, performanceStats, signalOutcomes, symbol, currentPrice, newSignal) {
  let previous = signalOutcomes.get(symbol);
  const outcome = { entryPrice: currentPrice, signal: newSignal.signal, action: newSignal.action, timestamp: Date.now(), result: null };
  if (previous && previous.action !== 'hold') {
    const priceChange = ((currentPrice - previous.entryPrice) / previous.entryPrice) * 100;
    let won;
    if (previous.action === 'buy' && priceChange > 2) won = true;
    else if (previous.action === 'buy' && priceChange < -3) won = false;
    else if (previous.action === 'sell' && priceChange < -2) won = true;
    else if (previous.action === 'sell' && priceChange > 3) won = false;
    if (won === true) {
      previous.result = 'win';
      performanceStats.wins++;
      performanceStats.total++;
      portfolioState.consecutiveLosses = 0;
    } else if (won === false) {
      previous.result = 'loss';
      performanceStats.losses++;
      performanceStats.total++;
      portfolioState.consecutiveLosses++;
    }
    portfolioState.totalTrades++;
    if (performanceStats.total > 0) {
      performanceStats.winRate = Math.round((performanceStats.wins / performanceStats.total) * 1000) / 10;
    }
  }
  signalOutcomes.set(symbol, outcome);
  if (signalOutcomes.size > 200) {
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
