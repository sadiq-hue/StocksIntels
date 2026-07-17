// ETF Service — Real-time prices via marketService pipeline (yahoo-finance2, RapidAPI, TwelveData), synthetic fallback

const axios = require('axios');

const ETF_LIST = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'US Equity', expenseRatio: 0.09, aum: 600000000000, dividendYield: 1.20, description: 'Tracks the S&P 500 Index', currency: 'USD' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', category: 'US Equity', expenseRatio: 0.20, aum: 300000000000, dividendYield: 0.55, description: 'Tracks the Nasdaq-100 Index', currency: 'USD' },
  { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', category: 'US Equity', expenseRatio: 0.03, aum: 450000000000, dividendYield: 1.25, description: 'Low-cost S&P 500 exposure', currency: 'USD' },
  { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', category: 'US Equity', expenseRatio: 0.03, aum: 400000000000, dividendYield: 1.30, description: 'Tracks the CRSP US Total Market Index', currency: 'USD' },
  { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', category: 'Bond', expenseRatio: 0.03, aum: 320000000000, dividendYield: 4.40, description: 'Broad US investment-grade bond exposure', currency: 'USD' },
  { ticker: 'AGG', name: 'iShares Core US Aggregate Bond ETF', category: 'Bond', expenseRatio: 0.03, aum: 110000000000, dividendYield: 4.50, description: 'Tracks the Bloomberg US Aggregate Bond Index', currency: 'USD' },
  { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', category: 'International', expenseRatio: 0.07, aum: 140000000000, dividendYield: 3.00, description: 'Total international stock market exposure', currency: 'USD' },
  { ticker: 'VEU', name: 'Vanguard FTSE All-World ex-US ETF', category: 'International', expenseRatio: 0.08, aum: 90000000000, dividendYield: 3.00, description: 'International developed + emerging markets', currency: 'USD' },
  { ticker: 'EEM', name: 'iShares MSCI Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.69, aum: 50000000000, dividendYield: 2.50, description: 'Emerging market equity exposure', currency: 'USD' },
  { ticker: 'IEMG', name: 'iShares Core MSCI Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.09, aum: 100000000000, dividendYield: 2.60, description: 'Low-cost emerging market exposure', currency: 'USD' },
  { ticker: 'XLF', name: 'Financial Select Sector SPDR Fund', category: 'Sector', expenseRatio: 0.09, aum: 48000000000, dividendYield: 1.70, description: 'US financial sector stocks', currency: 'USD' },
  { ticker: 'XLK', name: 'Technology Select Sector SPDR Fund', category: 'Sector', expenseRatio: 0.09, aum: 70000000000, dividendYield: 0.60, description: 'US technology sector stocks', currency: 'USD' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', category: 'Commodity', expenseRatio: 0.40, aum: 82000000000, dividendYield: 0, description: 'Gold bullion backed ETF', currency: 'USD' },
  { ticker: 'SLV', name: 'iShares Silver Trust', category: 'Commodity', expenseRatio: 0.50, aum: 16000000000, dividendYield: 0, description: 'Silver bullion backed ETF', currency: 'USD' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', category: 'Bond', expenseRatio: 0.15, aum: 58000000000, dividendYield: 4.50, description: 'Long-term US Treasury exposure', currency: 'USD' },
  { ticker: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', category: 'Bond', expenseRatio: 0.15, aum: 38000000000, dividendYield: 4.00, description: 'Short-term US Treasury exposure', currency: 'USD' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', category: 'Emerging Markets', expenseRatio: 0.08, aum: 115000000000, dividendYield: 2.70, description: 'Emerging market stock exposure', currency: 'USD' },
  { ticker: 'IVV', name: 'iShares Core S&P 500 ETF', category: 'US Equity', expenseRatio: 0.03, aum: 400000000000, dividendYield: 1.25, description: 'Core S&P 500 exposure', currency: 'USD' },
  { ticker: 'VUG', name: 'Vanguard Growth ETF', category: 'US Equity', expenseRatio: 0.04, aum: 140000000000, dividendYield: 0.48, description: 'US large-cap growth stocks', currency: 'USD' },
  { ticker: 'VTV', name: 'Vanguard Value ETF', category: 'US Equity', expenseRatio: 0.04, aum: 130000000000, dividendYield: 2.10, description: 'US large-cap value stocks', currency: 'USD' },
  { ticker: 'IJR', name: 'iShares Core S&P Small-Cap ETF', category: 'US Equity', expenseRatio: 0.06, aum: 90000000000, dividendYield: 1.40, description: 'US small-cap equity exposure', currency: 'USD' },
  { ticker: 'TIP', name: 'iShares TIPS Bond ETF', category: 'Bond', expenseRatio: 0.19, aum: 48000000000, dividendYield: 4.30, description: 'Treasury Inflation-Protected Securities', currency: 'USD' },
  { ticker: 'VNQ', name: 'Vanguard Real Estate ETF', category: 'Sector', expenseRatio: 0.12, aum: 58000000000, dividendYield: 3.90, description: 'US real estate investment trusts', currency: 'USD' },
  { ticker: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', category: 'US Equity', expenseRatio: 0.16, aum: 38000000000, dividendYield: 2.00, description: 'Tracks the Dow Jones Industrial Average', currency: 'USD' },
  { ticker: 'ARKK', name: 'ARK Innovation ETF', category: 'Sector', expenseRatio: 0.75, aum: 16000000000, dividendYield: 0, description: 'Disruptive innovation companies', currency: 'USD' },
  { ticker: 'EZA', name: 'iShares MSCI South Africa ETF', category: 'Africa', expenseRatio: 0.59, aum: 550000000, dividendYield: 3.40, description: 'South African equity exposure', currency: 'USD' },
  { ticker: 'AFK', name: 'VanEck Africa Index ETF', category: 'Africa', expenseRatio: 0.78, aum: 250000000, dividendYield: 2.70, description: 'Pan-African equity exposure', currency: 'USD' },
  { ticker: 'NSEQ', name: 'NSE Equity Index Fund', category: 'Africa', expenseRatio: 1.20, aum: 50000000, dividendYield: 4.50, description: 'Nairobi Securities Exchange tracker', currency: 'KES' },
];

const tickers = ETF_LIST.map(e => e.ticker);
const nseTickers = ETF_LIST.filter(e => e.currency === 'KES').map(e => e.ticker);

let quotesCache = {};
let cacheTime = 0;
const CACHE_TTL = 30000;

// NSE ETFs (KES) have no Yahoo coverage, so pull them from the MyStocks Africa
// Partner API (authoritative delayed NSE quotes: price, change, volume).
async function fetchNseEtQuotes() {
  if (nseTickers.length === 0) return {};
  try {
    const { getBatchQuotes } = require('./mystocksAfricaApi');
    const batch = await getBatchQuotes(nseTickers);
    const out = {};
    for (const [ticker, q] of Object.entries(batch)) {
      if (q && q.price != null) {
        const prevClose = q.previousClose || q.price;
        const change = q.price - prevClose;
        out[ticker] = {
          price: q.price,
          change: +change.toFixed(2),
          changePercent: q.changePercent ?? +((change / prevClose) * 100).toFixed(2),
          high: q.dayHigh ?? 0,
          low: q.dayLow ?? 0,
          volume: q.volume ?? 0,
          previousClose: prevClose,
          open: q.open ?? 0,
          dataSource: 'mystocksAfrica',
        };
      }
    }
    return out;
  } catch (e) {
    console.error('[ETFs] MyStocks Africa NSE batch failed:', e.message);
    return {};
  }
}

async function fetchLiveQuotes() {
  const now = Date.now();
  if (quotesCache && now - cacheTime < CACHE_TTL) return quotesCache;

  let result = {};

  // 0. NSE ETFs via MyStocks Africa Partner API (authoritative KES quotes)
  try {
    const nseQuotes = await fetchNseEtQuotes();
    Object.assign(result, nseQuotes);
  } catch (e) {
    console.error('[ETFs] NSE ETF fetch failed:', e.message);
  }

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

  // Keep any NSE Partner API quotes we already have; only clear cache if empty.
  if (Object.keys(result).length > 0) {
    quotesCache = result;
    cacheTime = now;
  }
  return result;
}

function getSyntheticQuote(ticker, basePrice, currency) {
  // KES (NSE) ETFs like NSEQ have no real-time feed from any provider, so we
  // keep them at a stable reference price and DO NOT fabricate movement/volume.
  if (currency === 'KES') {
    return {
      price: +basePrice.toFixed(2),
      change: 0,
      changePercent: 0,
      high: +basePrice.toFixed(2),
      low: +basePrice.toFixed(2),
      volume: 0,
      open: +basePrice.toFixed(2),
      previousClose: +basePrice.toFixed(2),
      dataSource: 'reference',
    };
  }
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
  SPY: 750.72, QQQ: 705.94, VOO: 690.14, VTI: 370.58, BND: 72.81,
  AGG: 98.13, VXUS: 84.06, VEU: 55.90, EEM: 41.91, IEMG: 53.43,
  XLF: 42.90, XLK: 217.77, GLD: 364.74, SLV: 31.14, TLT: 93.98,
  SHY: 83.27, VWO: 43.31, IVV: 549.42, VUG: 348.78, VTV: 168.21,
  IJR: 115.32, TIP: 108.57, VNQ: 91.94, DIA: 409.15, ARKK: 49.24,
  EZA: 42.45, AFK: 25.75, NSEQ: 125.00,
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
    const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100, etf.currency);
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
  const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100, etf.currency);
  return { ...etf, ...synth, lastUpdated: new Date().toISOString() };
}

async function getETFSummary() {
  const liveQuotes = await fetchLiveQuotes();
  const hasLiveData = Object.keys(liveQuotes).length > 0;

  const etfs = ETF_LIST.map(etf => {
    const live = liveQuotes[etf.ticker];
    if (live) return { ...etf, ...live };
    const synth = getSyntheticQuote(etf.ticker, BASE_PRICES[etf.ticker] || 100, etf.currency);
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
