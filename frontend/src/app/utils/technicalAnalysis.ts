export const calculateRSI = (prices: number[], period = 14): number => {
  if (prices.length < period) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
};

const calculateEMA = (prices: number[], period: number): number => {
  if (prices.length < period) return prices[prices.length - 1];
  const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const multiplier = 2 / (period + 1);
  let ema = sma;
  for (let i = prices.length - period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
};

export const calculateMACD = (prices: number[]) => {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([...prices.slice(-25), macd], 9);
  return {
    macd: parseFloat(macd.toFixed(4)),
    signal: parseFloat(signal.toFixed(4)),
    histogram: parseFloat((macd - signal).toFixed(4)),
  };
};

export const calculateSMA = (prices: number[], period: number): number => {
  if (prices.length < period) return prices[prices.length - 1];
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
};

export const calculateBollingerBands = (prices: number[], period = 20, stdDev = 2) => {
  const sma = calculateSMA(prices, period);
  const variance = prices.slice(-period).reduce((sq, n) => sq + Math.pow(n - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: parseFloat((sma + std * stdDev).toFixed(2)),
    middle: parseFloat(sma.toFixed(2)),
    lower: parseFloat((sma - std * stdDev).toFixed(2)),
  };
};

export const calculateATR = (data: { high: number; low: number; price: number }[], period = 14): number => {
  if (data.length < period) return 0;
  let trSum = 0;
  for (let i = data.length - period; i < data.length; i++) {
    trSum += Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].price),
      Math.abs(data[i].low - data[i - 1].price)
    );
  }
  return parseFloat((trSum / period).toFixed(2));
};

export const generateStockData = (basePrice: number, volatility = 0.02) => {
  const data = [];
  let price = basePrice;
  const startDate = new Date(2024, 0, 1);
  for (let i = 0; i < 180; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    price = Math.max(basePrice * 0.75, price * (1 + randomChange));
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      displayDate: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      price: parseFloat(price.toFixed(2)),
      high: parseFloat((price * (1 + Math.random() * 0.02)).toFixed(2)),
      low: parseFloat((price * (1 - Math.random() * 0.02)).toFixed(2)),
      volume: Math.floor(Math.random() * 5000000 + 1000000),
    });
  }
  return data;
};

export const generateFundamentalData = () => ({
  pe: Math.random() * 20 + 10,
  pb: Math.random() * 3 + 1,
  roe: Math.random() * 25 + 5,
  debt: Math.random() * 50,
  fcf: Math.random() * 100 + 50,
  revenue_growth: Math.random() * 30 - 5,
  earnings_growth: Math.random() * 35 - 10,
});

export const calculateFundamentalScore = (fundamentals: any) => {
  let score = 50;
  if (fundamentals.pe < 15) score += 15;
  else if (fundamentals.pe < 20) score += 10;
  else if (fundamentals.pe < 25) score += 5;
  else score -= 10;
  if (fundamentals.roe > 15) score += 15;
  else if (fundamentals.roe > 10) score += 10;
  else if (fundamentals.roe > 5) score += 5;
  if (fundamentals.revenue_growth > 10) score += 10;
  else if (fundamentals.revenue_growth > 0) score += 5;
  else score -= 5;
  if (fundamentals.earnings_growth > 15) score += 15;
  else if (fundamentals.earnings_growth > 0) score += 10;
  else score -= 10;
  if (fundamentals.debt < 30) score += 10;
  else if (fundamentals.debt < 50) score += 5;
  else score -= 5;
  return Math.max(0, Math.min(100, score));
};
