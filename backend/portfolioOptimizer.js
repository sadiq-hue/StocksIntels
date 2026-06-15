// Portfolio Optimizer — Kelly criterion sizing, covariance analysis, Monte Carlo VaR.
// Provides risk-calibrated position sizes and portfolio-level risk metrics.

const { pool } = require('./db');

// ─── Kelly Criterion ────────────────────────────────────────────────────────
// f* = (p * b - q) / b  where p=winProb, q=1-p, b=winLossRatio
function kellyFraction(winProb, winLossRatio) {
  if (winProb <= 0 || winProb >= 1) return 0;
  const q = 1 - winProb;
  const b = Math.max(winLossRatio, 0.1);
  const f = (winProb * b - q) / b;
  // Half-Kelly for safety, clamped to [0, 0.25]
  return Math.max(0, Math.min(f * 0.5, 0.25));
}

// ─── Covariance Matrix ──────────────────────────────────────────────────────
// Computes covariance matrix from historical return series for a set of symbols.
async function computeCovarianceMatrix(symbols) {
  if (symbols.length < 2) return null;
  try {
    const result = await pool.query(`
      SELECT ticker, entry_price, generated_at
      FROM signal_history
      WHERE ticker = ANY($1::varchar[])
        AND entry_price > 0
        AND generated_at > NOW() - INTERVAL '90 days'
      ORDER BY ticker, generated_at
    `, [symbols]);
    if (!result.rows.length) return null;

    // Group prices by ticker
    const series = {};
    for (const row of result.rows) {
      if (!series[row.ticker]) series[row.ticker] = [];
      series[row.ticker].push(parseFloat(row.entry_price));
    }

    // Compute daily returns for each symbol
    const returns = {};
    for (const [sym, prices] of Object.entries(series)) {
      if (prices.length < 10) continue;
      returns[sym] = [];
      for (let i = 1; i < prices.length; i++) {
        returns[sym].push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }

    const symList = Object.keys(returns);
    if (symList.length < 2) return null;

    // Compute covariance and correlation matrices
    const n = symList.length;
    const cov = Array.from({ length: n }, () => new Array(n).fill(0));
    const corr = Array.from({ length: n }, () => new Array(n).fill(0));
    const means = symList.map(sym => returns[sym].reduce((a, b) => a + b, 0) / returns[sym].length);

    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const ri = returns[symList[i]];
        const rj = returns[symList[j]];
        const minLen = Math.min(ri.length, rj.length);
        let sum = 0;
        for (let k = 0; k < minLen; k++) sum += (ri[k] - means[i]) * (rj[k] - means[j]);
        const c = sum / Math.max(minLen - 1, 1);
        cov[i][j] = cov[j][i] = c;
        const denom = Math.sqrt((ri.reduce((s, v) => s + (v - means[i]) ** 2, 0) / Math.max(ri.length - 1, 1)) *
                                (rj.reduce((s, v) => s + (v - means[j]) ** 2, 0) / Math.max(rj.length - 1, 1)));
        corr[i][j] = corr[j][i] = denom > 0 ? c / denom : 0;
      }
    }

    return {
      symbols: symList,
      covariance: cov,
      correlation: corr,
    };
  } catch { return null; }
}

// ─── Monte Carlo VaR ────────────────────────────────────────────────────────
// Simulates N portfolio paths from historical return distribution.
// Returns 95% and 99% Value at Risk as fraction of portfolio.
function monteCarloVaR(historicalReturns, portfolioValue = 1, simulations = 10000, confidence95 = 0.95, confidence99 = 0.99) {
  if (!historicalReturns || historicalReturns.length < 20) {
    return { var95: 0.02, var99: 0.05, cvar95: 0.03, simulations: 0 };
  }

  const mean = historicalReturns.reduce((a, b) => a + b, 0) / historicalReturns.length;
  const variance = historicalReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / historicalReturns.length;
  const std = Math.sqrt(variance);

  // Simple parametric Monte Carlo: sample from normal distribution
  const losses = [];
  for (let i = 0; i < simulations; i++) {
    // Box-Muller transform
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const simReturn = mean + z * std;
    losses.push(-simReturn); // negative return = loss
  }

  losses.sort((a, b) => b - a); // descending (largest loss first)

  const idx95 = Math.floor(simulations * (1 - confidence95));
  const idx99 = Math.floor(simulations * (1 - confidence99));

  const var95 = Math.max(losses[Math.min(idx95, losses.length - 1)], 0);
  const var99 = Math.max(losses[Math.min(idx99, losses.length - 1)], 0);

  // CVaR (Expected Shortfall) at 95%
  let cvarSum = 0;
  for (let i = 0; i <= idx95; i++) cvarSum += losses[Math.min(i, losses.length - 1)];
  const cvar95 = cvarSum / Math.max(idx95 + 1, 1);

  return {
    var95: Math.round(var95 * 1000) / 10,
    var99: Math.round(var99 * 1000) / 10,
    cvar95: Math.round(cvar95 * 1000) / 10,
    simulations,
  };
}

// ─── Mean-Variance Optimization ────────────────────────────────────────────
// Finds the portfolio allocation that maximizes Sharpe ratio given expected
// returns and covariance matrix.
function meanVarianceOptimize(expectedReturns, covariance, riskFreeRate = 0.05) {
  const n = expectedReturns.length;
  if (n < 2 || !covariance || covariance.length !== n) return null;

  // Brute-force grid search over allocation weights (simplified for speed)
  const candidates = [];
  const steps = n <= 3 ? 20 : 10;

  function rec(idx, remaining, current) {
    if (idx === n - 1) {
      current.push(remaining);
      const weights = current;
      const portReturn = weights.reduce((s, w, i) => s + w * expectedReturns[i], 0);
      let portVar = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          portVar += weights[i] * weights[j] * covariance[i][j];
        }
      }
      const portStd = Math.sqrt(portVar);
      const sharpe = portStd > 0 ? (portReturn - riskFreeRate) / portStd : 0;
      candidates.push({ weights: [...weights], return: portReturn, risk: portStd, sharpe });
      current.pop();
      return;
    }
    for (let s = 0; s <= steps; s++) {
      const w = s / steps;
      if (w <= remaining) {
        current.push(w);
        rec(idx + 1, remaining - w, current);
        current.pop();
      }
    }
  }

  rec(0, 1, []);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.sharpe - a.sharpe);
  const best = candidates[0];
  return {
    weights: best.weights.map(w => Math.round(w * 100)),
    expectedReturn: Math.round(best.return * 1000) / 10,
    expectedRisk: Math.round(best.risk * 1000) / 10,
    sharpe: Math.round(best.sharpe * 100) / 100,
  };
}

module.exports = { kellyFraction, computeCovarianceMatrix, monteCarloVaR, meanVarianceOptimize };
