// ETF Service — Real-time prices via marketService pipeline (yahoo-finance2, RapidAPI, TwelveData), synthetic fallback

const axios = require('axios');

const ETF_LIST = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'US Equity', expenseRatio: 0.09, aum: 545000000000, dividendYield: 1.32, description: 'Tracks the S&P 500 Index', currency: 'USD' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', category: 'US Equity', expenseRatio: 0.20, aum: 275000000000, dividendYield: 0.58, description: 'Tracks the Nasdaq-100 Index', currency: 'USD' },
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', category: 'US Equity', expenseRatio: 0.03, aum: 420000000000, dividendYield: 1.35, description: 'Low-cost S&P 500 exposure', currency: 'USD' },
  { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', category: 'US Equity', expenseRatio: 0.03, aum: 380000000000, dividendYield: 1.38, description: 'Tracks the CRSP US Total Market Index', currency: 'USD' },
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', category: 'Bond', expenseRatio: 0.03, aum: 310000000000, dividendYield: 4.20, description: 'Broad US investment-grade bond exposure', currency: 'USD' },
  { ticker: 'AGG', name: 'iShares Core US Aggregate Bond ETF', category: 'Bond', expenseRatio: 0.03, aum: 105000000000, dividendYield: 4.30, description: 'Tracks the Bloomberg US Aggregate Bond Index', currency: 'USD' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', category: 'International', expenseRatio: 0.07, aum: 130000000000, dividendYield: 2.90, description: 'Total international stock market exposure', currency: 'USD' },
  { ticker: 'VEU', name: 'Vanguard FTSE All-World ex-US ETF', category: 'International', expenseRatio: 0.08, aum: 85000000000, dividendYield: 2.85, description: 'International developed + emerging markets', currency: 'USD' },
  { ticker: 'EEM', name: 'iShares MSCI Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.69, aum: 45000000000, dividendYield: 2.40, description: 'Emerging market equity exposure', currency: 'USD' },
  { ticker: 'IEMG', name: 'iShares Core MSCI Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.09, aum: 95000000000, dividendYield: 2.50, description: 'Low-cost emerging market exposure', currency: 'USD' },
  { ticker: 'XLF', name: 'Financial Select Sector SPDR Fund', category: 'Sector', expenseRatio: 0.09, aum: 45000000000, dividendYield: 1.80, description: 'US financial sector stocks', currency: 'USD' },
  { ticker: 'XLK', name: 'Technology Select Sector SPDR Fund', category: 'Sector', expenseRatio: 0.09, aum: 65000000000, dividendYield: 0.65, description: 'US technology sector stocks', currency: 'USD' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', category: 'Commodity', expenseRatio: 0.40, aum: 75000000000, dividendYield: 0, description: 'Gold bullion backed ETF', currency: 'USD' },
  { ticker: 'SLV', name: 'iShares Silver Trust', category: 'Commodity', expenseRatio: 0.50, aum: 15000000000, dividendYield: 0, description: 'Silver bullion backed ETF', currency: 'USD' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', category: 'Bond', expenseRatio: 0.15, aum: 55000000000, dividendYield: 4.80, description: 'Long-term US Treasury exposure', currency: 'USD' },
  { ticker: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', category: 'Bond', expenseRatio: 0.15, aum: 35000000000, dividendYield: 3.90, description: 'Short-term US Treasury exposure', currency: 'USD' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.08, aum: 110000000000, dividendYield: 2.60, description: 'Emerging market stock exposure', currency: 'USD' },
  { ticker: 'IVV', name: 'iShares Core S&P 500 ETF', category: 'US Equity', expenseRatio: 0.03, aum: 380000000000, dividendYield: 1.33, description: 'Core S&P 500 exposure', currency: 'USD' },
  { ticker: 'VUG', name: 'Vanguard Growth ETF', category: 'US Equity', expenseRatio: 0.04, aum: 130000000000, dividendYield: 0.50, description: 'US large-cap growth stocks', currency: 'USD' },
  { ticker: 'VTV', name: 'Vanguard Value ETF', category: 'US Equity', expenseRatio: 0.04, aum: 120000000000, dividendYield: 2.20, description: 'US large-cap value stocks', currency: 'USD' },
  { ticker: 'IJR', name: 'iShares Core S&P Small-Cap ETF', category: 'US Equity', expenseRatio: 0.06, aum: 85000000000, dividendYield: 1.45, description: 'US small-cap equity exposure', currency: 'USD' },
  { ticker: 'TIP', name: 'iShares TIPS Bond ETF', category: 'Bond', expenseRatio: 0.19, aum: 45000000000, dividendYield: 4.10, description: 'Treasury Inflation-Protected Securities', currency: 'USD' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate ETF', category: 'Sector', expenseRatio: 0.12, aum: 55000000000, dividendYield: 3.80, description: 'US real estate investment trusts', currency: 'USD' },
  { ticker: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', category: 'US Equity', expenseRatio: 0.16, aum: 35000000000, dividendYield: 2.10, description: 'Tracks the Dow Jones Industrial Average', currency: 'USD' },
  { ticker: 'ARKK', name: 'ARK Innovation ETF', category: 'Sector', expenseRatio: 0.75, aum: 15000000000, dividendYield: 0, description: 'Disruptive innovation companies', currency: 'USD' },
  { ticker: 'EZA', name: 'iShares MSCI South Africa ETF', category: 'Africa', expenseRatio: 0.59, aum: 500000000, dividendYield: 3.50, description: 'South African equity exposure', currency: 'USD' },
  { ticker: 'AFK', name: 'VanEck Africa Index ETF', category: 'Africa', expenseRatio: 0.78, aum: 200000000, dividendYield: 2.80, description: 'Pan-African equity exposure', currency: 'USD' },
  { ticker: 'NSEQ', name: 'NSE Equity Index Fund', category: 'Africa', expenseRatio: 1.20, aum: 50000000, dividendYield: 4.50, description: 'Nairobi Securities Exchange tracker', currency: 'KES' },
];

const tickers = ETF_LIST.map(e => e.ticker);

let quotesCache = {};
let cacheTime = 0;
const CACHE_TTL = 30000;

async function fetchLiveQuotes() {
  const now = Date.now();
  if (quotesCache && now - cacheTime < CACHE_TTL) return quotesCache;

  let result = {};

  // 1. Use marketService batch pipeline (yahoo-finance2 + RapidAPI + TwelveData)
  try {
    const { getQuotesBatch } = require('./marketService');
    const batch = await getQuotesBatch(tickers);
    if (batch && Object.keys(batch).length > 0) {
      for (const [sym, q] of Object.entries(batch)) {
        if (q && q.price != null) {
          result[sym] = {
            price: q.price,
            change: q.change ?? 0,
            changePercent: q.changePercent ?? 0,
            high: q.dayHigh ?? 0,
            low: q.dayLow ?? 0,
            volume: q.volume ?? 0,
            previousClose: q.previousClose ?? q.price,
            open: q.open ?? 0,
            dataSource: q.provider || 'live',
          };
        }
      }
      if (Object.keys(result).length > 0) {
        quotesCache = result;
        cacheTime = now;
        return result;
      }
    }
  } catch (e) {
    console.error('[ETFs] marketService batch failed:', e.message);
  }

  // 2. Fallback: direct Yahoo Finance quote API
  try {
    const symbols = tickers.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
    const res = await axios.get(url, { timeout: 15000 });
    const quoteResult = res.data?.quoteResponse?.result;
    if (quoteResult && Array.isArray(quoteResult)) {
      for (const q of quoteResult) {
        if (!q || !q.symbol) continue;
        const price = q.regularMarketPrice;
        const prevClose = q.regularMarketPreviousClose;
        if (price == null || prevClose == null) continue;
        const change = price - prevClose;
        result[q.symbol] = {
          price,
          change: +change.toFixed(2),
          changePercent: +((change / prevClose) * 100).toFixed(2),
          high: q.regularMarketDayHigh || 0,
          low: q.regularMarketDayLow || 0,
          volume: q.regularMarketVolume || 0,
          previousClose: prevClose,
          open: q.regularMarketOpen || 0,
          dataSource: 'yahoo',
        };
      }
      if (Object.keys(result).length > 0) {
        quotesCache = result;
        cacheTime = now;
        return result;
      }
    }
  } catch (e) {
    console.error('[ETFs] Yahoo quote API fetch failed:', e.message);
  }

  return {};
}

function getSyntheticQuote(ticker, basePrice) {
  const drift = (Math.random() - 0.48) * 1.5;
  const price = +(basePrice + drift).toFixed(2);
  const change = +(drift).toFixed(2);
  const changePercent = +((change / (price - change)) * 100).toFixed(2);
  return {
    price, change, changePercent,
    high: +(price + Math.random()).toFixed(2),
    low: +(price - Math.random()).toFixed(2),
    volume: Math.floor(Math.random() * 5000000 + 500000),
    open: +(price - drift + (Math.random() - 0.5) * 0.5).toFixed(2),
    previousClose: +(price - change).toFixed(2),
    dataSource: 'simulated',
  };
}

const BASE_PRICES = {
  SPY: 548.20, QQQ: 480.15, VOO: 502.80, VTI: 268.40, BND: 72.30,
  AGG: 98.50, VXUS: 61.40, VEU: 55.80, EEM: 41.20, IEMG: 53.60,
  XLF: 42.30, XLK: 218.40, GLD: 235.50, SLV: 31.80, TLT: 94.20,
  SHY: 82.50, VWO: 43.80, IVV: 549.10, VUG: 348.60, VTV: 168.40,
  IJR: 115.20, TIP: 108.30, VNQ: 92.40, DIA: 408.70, ARKK: 49.80,
  EZA: 42.50, AFK: 17.80, NSEQ: 125.00,
};

async function getETFs(market) {
  const liveQuotes = await fetchLiveQuotes();
  const hasLiveData = Object.keys(liveQuotes).length > 0;

  const all = ETF_LIST.filter(e => {
    if (market === 'kenya') return e.currency === 'KES';
    if (market === 'global') return e.currency === 'USD';
    return true;
  });

  return all.map(etf => {
    const live = liveQuotes[etf.ticker];
    if (live) {
      return { ...etf, ...live, lastUpdated: new Date().toISOString() };
    }
    const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100);
    return { ...etf, ...synth, lastUpdated: new Date().toISOString() };
  });
}

async function getETFByTicker(ticker) {
  const etf = ETF_LIST.find(e => e.ticker === ticker.toUpperCase());
  if (!etf) return null;

  const liveQuotes = await fetchLiveQuotes();
  const live = liveQuotes[ticker.toUpperCase()];

  if (live) {
    return { ...etf, ...live, lastUpdated: new Date().toISOString() };
  }
  const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100);
  return { ...etf, ...synth, lastUpdated: new Date().toISOString() };
}

async function getETFSummary() {
  const liveQuotes = await fetchLiveQuotes();
  const hasLiveData = Object.keys(liveQuotes).length > 0;

  const etfs = ETF_LIST.map(etf => {
    const live = liveQuotes[etf.ticker];
    if (live) return { ...etf, ...live };
    const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100);
    return { ...etf, ...synth };
  });

  return {
    totalETFs: ETF_LIST.length,
    hasLiveData,
    topGainers: [...etfs].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5),
    topLosers: [...etfs].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5),
    largestAUM: [...etfs].sort((a, b) => b.aum - a.aum).slice(0, 5),
    categories: [...new Set(ETF_LIST.map(e => e.category))].map(cat => ({
      name: cat,
      count: ETF_LIST.filter(e => e.category === cat).length,
    })),
    totalVolume: etfs.reduce((s, e) => s + (e.volume || 0), 0),
    advancing: etfs.filter(e => (e.changePercent || 0) > 0).length,
    declining: etfs.filter(e => (e.changePercent || 0) < 0).length,
  };
}

module.exports = { getETFs, getETFByTicker, getETFSummary };
