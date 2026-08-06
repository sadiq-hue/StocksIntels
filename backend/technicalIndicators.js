// Technical indicator calculation functions
// All are pure functions with no external dependencies.

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = [];
  let losses = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMASeries(prices, period) {
  if (prices.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result = [];
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  return result;
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  
  const fastEMAs = calculateEMASeries(prices, fast);
  const slowEMAs = calculateEMASeries(prices, slow);
  
  const macdLine = fastEMAs[fastEMAs.length - 1] - slowEMAs[slowEMAs.length - 1];
  
  // Compute full MACD series for signal line (EMA of MACD)
  const macdLen = Math.min(fastEMAs.length, slowEMAs.length);
  const macdSeries = [];
  for (let i = 0; i < macdLen; i++) {
    macdSeries.push(fastEMAs[i] - slowEMAs[i]);
  }
  
  const signalLine = calculateEMA(macdSeries, signal);
  const histogram = macdLine - signalLine;
  
  return { macd: macdLine, signal: signalLine, histogram };
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) {
    return { upper: prices[prices.length - 1] * 1.02, middle: prices[prices.length - 1], lower: prices[prices.length - 1] * 0.98 };
  }
  
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b) / period;
  
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std
  };
}

function calculateSMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  return prices.slice(-period).reduce((a, b) => a + b) / period;
}

function calculateATR(prices) {
  if (!prices || prices.length < 14) return 0.05;
  // Use true intraday high-low ranges when OHLC data is available (attached as
  // prices.highs / prices.lows). Close-to-close ATR understates volatility for
  // stocks that swing widely intraday but close flat (thin NSE names, etc.), which
  // produced stops far tighter than the noise they had to survive.
  const hasRange = Array.isArray(prices.highs) && Array.isArray(prices.lows)
    && prices.highs.length === prices.length && prices.lows.length === prices.length;
  const periods = Math.min(14, prices.length - 1);
  const ranges = [];
  for (let i = prices.length - periods; i < prices.length; i++) {
    if (hasRange && prices.highs[i] != null && prices.lows[i] != null
        && prices.lows[i] > 0 && prices.highs[i] >= prices.lows[i]) {
      const prev = i > 0 && prices[i - 1] > 0 ? prices[i - 1] : prices[i];
      ranges.push((prices.highs[i] - prices.lows[i]) / prev);
    } else {
      ranges.push(Math.abs(prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  return Math.min(Math.max(atr, 0.01), 0.15);
}

// Find pivot-high resistance levels above a floor price from the recent price
// history. A pivot high is a bar whose high is the strict local max over +/-k
// bars; bars near the end of the window are skipped (an unconfirmed print is not
// a stable supply zone). Levels within ~2% of each other are clustered into one
// (keeping the highest), then returned ascending. Falls back to close prices
// when true intraday highs are unavailable (thin NSE names).
function findResistanceLevels(prices, floorPrice = null, pivotRadius = 3, clusterPct = 0.02) {
  if (!Array.isArray(prices) || prices.length < pivotRadius * 2 + 2) return [];
  const hasRange = Array.isArray(prices.highs) && prices.highs.length === prices.length;
  const val = (i) => hasRange ? prices.highs[i] : prices[i];
  const pivots = [];
  for (let i = pivotRadius; i < prices.length - pivotRadius; i++) {
    const h = val(i);
    if (h == null || !Number.isFinite(h) || h <= 0) continue;
    let isPivot = true;
    for (let j = i - pivotRadius; j <= i + pivotRadius; j++) {
      if (j === i) continue;
      const nj = val(j);
      if (nj == null || !Number.isFinite(nj) || nj >= h) { isPivot = false; break; }
    }
    if (isPivot) pivots.push(h);
  }
  pivots.sort((a, b) => a - b);
  const clustered = [];
  for (const p of pivots) {
    const last = clustered[clustered.length - 1];
    if (last != null && (p - last) / last <= clusterPct) {
      if (p > last) clustered[clustered.length - 1] = p;
    } else {
      clustered.push(p);
    }
  }
  return floorPrice != null
    ? clustered.filter(p => p > floorPrice)
    : clustered;
}

module.exports = {
  calculateRSI,
  calculateEMASeries,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateATR,
  findResistanceLevels,
};
