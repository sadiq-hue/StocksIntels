const { getQuotesBatch } = require('./marketService');
const axios = require('axios');
const { fetchNseIndicesFromSite } = require('./nseIndexScraper');

const CACHE_TTL_MS = 60 * 1000;
const cache = { indices: {}, sectors: {}, lastFetch: 0 };

const NSE_INDICES = {
  'NSE:NSE20': { name: 'NSE 20 Share Index', symbol: 'NSE:NSE20', market: 'NSE', currency: 'KES', yahooSymbol: null },
  'NSE:NSEASI': { name: 'NSE All Share Index', symbol: 'NSE:NSEASI', market: 'NSE', currency: 'KES', yahooSymbol: null },
  'NSE:NSE25': { name: 'NSE 25 Share Index', symbol: 'NSE:NSE25', market: 'NSE', currency: 'KES', yahooSymbol: null },
  'NSE:NSE10': { name: 'NSE 10 Share Index', symbol: 'NSE:NSE10', market: 'NSE', currency: 'KES', yahooSymbol: null },
};

const GLOBAL_INDICES = {
  '^GSPC': { name: 'S&P 500', symbol: '^GSPC', market: 'Global', currency: 'USD' },
  '^IXIC': { name: 'NASDAQ Composite', symbol: '^IXIC', market: 'Global', currency: 'USD' },
  '^DJI': { name: 'Dow Jones', symbol: '^DJI', market: 'Global', currency: 'USD' },
  '^NYA': { name: 'NYSE Composite', symbol: '^NYA', market: 'Global', currency: 'USD' },
  '^FTSE': { name: 'FTSE 100', symbol: '^FTSE', market: 'Global', currency: 'GBP' },
  '^N225': { name: 'Nikkei 225', symbol: '^N225', market: 'Global', currency: 'JPY' },
  '^GDAXI': { name: 'DAX', symbol: '^GDAXI', market: 'Global', currency: 'EUR' },
  '^HSI': { name: 'Hang Seng', symbol: '^HSI', market: 'Global', currency: 'HKD' },
  '^STOXX50E': { name: 'Euro Stoxx 50', symbol: '^STOXX50E', market: 'Global', currency: 'EUR' },
};

const ALL_INDICES = { ...NSE_INDICES, ...GLOBAL_INDICES };

const SECTORS = [
  'Technology', 'Banking', 'Financial', 'Telecommunications', 'Manufacturing',
  'Insurance', 'Energy', 'Healthcare', 'Consumer Goods', 'Utilities',
  'Real Estate', 'Media', 'Automobiles', 'Transport', 'Agriculture'
];

function formatIndexForResponse(symbol, data) {
  const meta = ALL_INDICES[symbol];
  if (!data) {
    return {
      name: meta?.name || symbol,
      symbol: meta?.symbol || symbol,
      market: meta?.market || 'Unknown',
      currency: meta?.currency || 'USD',
      value: '--',
      change: '0.00%',
      changeRaw: 0,
      isPositive: true,
      open: '--',
      high: '--',
      low: '--',
      volume: '0',
      previousClose: '--',
      lastUpdated: new Date().toISOString(),
    };
  }
  const pct = data.changePercent || 0;
  return {
    name: meta.name,
    symbol: meta.symbol,
    market: meta.market,
    currency: meta.currency,
    value: data.price?.toFixed?.(2) ?? '--',
    change: (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%',
    changeRaw: pct,
    isPositive: pct >= 0,
    open: data.open?.toFixed(2),
    high: data.dayHigh?.toFixed(2),
    low: data.dayLow?.toFixed(2),
    volume: formatCompact(data.volume || 0),
    previousClose: data.previousClose?.toFixed(2),
    lastUpdated: new Date().toISOString(),
  };
}

function formatCompact(v) {
  if (!v) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toString();
}

async function fetchIndexFromYahoo(symbol) {
  if (symbol.startsWith('NSE:')) return null; // Yahoo doesn't cover NSE indices
  try {
    const cleanSymbol = symbol.includes('.') ? symbol : symbol.replace('^', '%5E');
    const { data } = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?range=1d&interval=1m`,
      { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    if (!meta || !quotes) return null;
    const closes = quotes.close?.filter(c => c != null);
    const opens = quotes.open?.filter(o => o != null);
    const highs = quotes.high?.filter(h => h != null);
    const lows = quotes.low?.filter(l => l != null);
    const volumes = quotes.volume?.filter(v => v != null);
    const currentPrice = meta.regularMarketPrice || closes?.[closes.length - 1] || meta.previousClose || 0;
    const prevClose = meta.previousClose || currentPrice;
    const openPrice = meta.regularMarketOpen || opens?.[0] || prevClose;
    return {
      price: currentPrice,
      change: currentPrice - prevClose,
      changePercent: prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : 0,
      previousClose: prevClose,
      open: openPrice,
      dayHigh: meta.regularMarketDayHigh || Math.max(...(highs || [currentPrice])),
      dayLow: meta.regularMarketDayLow || Math.min(...(lows || [currentPrice])),
      volume: meta.regularMarketVolume || (volumes ? volumes.reduce((a, b) => a + b, 0) : 0),
    };
  } catch {
    return null;
  }
}

async function fetchIndexLive(symbol) {
  // For NSE indices, scrape NSE website directly (free, real-time)
  if (symbol.startsWith('NSE:')) {
    const nseData = await fetchNseIndicesFromSite().catch(() => null);
    if (nseData && nseData[symbol]) {
      return nseData[symbol];
    }
    // If scraper didn't return data for this symbol, try Yahoo with mapped symbol
    const meta = ALL_INDICES[symbol];
    if (meta?.yahooSymbol) {
      const data = await fetchIndexFromYahoo(meta.yahooSymbol);
      if (data) return data;
    }
    return null;
  }
  // Yahoo for global indices (free, real-time)
  const yahooData = await fetchIndexFromYahoo(symbol);
  if (yahooData) return yahooData;
  // Fallback to Twelve Data when Yahoo rate-limits
  try {
    const { fetchQuote } = require('./twelveDataService');
    const td = await fetchQuote(symbol);
    if (td?.price) {
      return {
        price: td.price,
        change: td.change || 0,
        changePercent: td.changePercent || 0,
        previousClose: td.previousClose || td.price,
        open: td.dayHigh ? undefined : undefined,
        dayHigh: td.dayHigh,
        dayLow: td.dayLow,
        volume: td.volume || 0,
      };
    }
  } catch {}
  return null;
}

async function getAllIndices() {
  const now = Date.now();
  if (cache.indices && cache.lastFetch && (now - cache.lastFetch) < CACHE_TTL_MS) {
    return cache.indices;
  }

  const symbols = Object.keys(ALL_INDICES);
  const results = {};
  await Promise.all(symbols.map(async (sym) => {
    const data = await fetchIndexLive(sym);
    results[sym] = formatIndexForResponse(sym, data);
  }));

  cache.indices = results;
  cache.lastFetch = now;
  return results;
}

async function getNseIndices() {
  const all = await getAllIndices();
  return Object.keys(NSE_INDICES).map(k => all[k]).filter(Boolean);
}

async function getGlobalIndices() {
  const all = await getAllIndices();
  return Object.keys(GLOBAL_INDICES).map(k => all[k]).filter(Boolean);
}

async function getSectorPerformance() {
  const now = Date.now();
  if (cache.sectors && cache.lastFetch && (now - cache.lastFetch) < CACHE_TTL_MS) {
    return cache.sectors;
  }

  const NSE_TICKERS = ['SCOM', 'EQTY', 'KCB', 'EABL', 'ABSA', 'SBIC', 'KLG', 'OLYM', 'CRAY', 'BAMB', 'UMEM', 'KPLC', 'NMG', 'TOTL', 'STAN', 'COOP', 'JUB', 'KNRE', 'LKL', 'CIC', 'HFCK', 'IMH', 'BAT', 'KUKZ', 'NCBA', 'KEGN', 'CTUM', 'BRIT', 'CARB', 'KQ', 'SASN', 'PORT', 'SCAN', 'WTK', 'EVOL', 'TPS', 'XPRS', 'HAFR', 'UMME', 'KAPC', 'TPRI', 'CGEN', 'CABL', 'LTC', 'AUTX', 'TRVL', 'NSE'];
  const GLOBAL_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'JPM', 'V', 'WMT', 'JNJ', 'PG', 'XOM', 'BAC', 'HD', 'DIS', 'CSCO', 'ADBE', 'CRM', 'INTC', 'AMD', 'PYPL', 'SNAP', 'UBER', 'SQ'];

  const allSymbols = [...NSE_TICKERS.map(t => 'NSE:' + t), ...GLOBAL_TICKERS];
  const quotes = await getQuotesBatch(allSymbols);

  if (!quotes || Object.keys(quotes).length === 0) {
    return [];
  }

  const sectorMap = {};
  const sectorAssign = getStockSectors();

  Object.entries(quotes).forEach(([symbol, q]) => {
    if (!q) return;
    const ticker = symbol.replace('NSE:', '');
    const sector = sectorAssign[ticker] || guessSector(ticker);
    if (!sectorMap[sector]) {
      sectorMap[sector] = { totalChange: 0, totalPrice: 0, count: 0, upCount: 0, downCount: 0 };
    }
    const c = q.changesPercentage || q.changePercent || 0;
    const p = q.price || 0;
    sectorMap[sector].totalChange += c;
    sectorMap[sector].totalPrice += p;
    sectorMap[sector].count += 1;
    if (c >= 0) sectorMap[sector].upCount += 1;
    else sectorMap[sector].downCount += 1;
  });

  if (Object.keys(sectorMap).length === 0) {
    return [];
  }

  const result = Object.entries(sectorMap).map(([sector, data]) => ({
    sector,
    avgChange: +(data.totalChange / data.count).toFixed(2),
    change: (data.totalChange / data.count).toFixed(2),
    count: data.count,
    upCount: data.upCount,
    downCount: data.downCount,
    totalPrice: +data.totalPrice.toFixed(2),
  })).sort((a, b) => b.avgChange - a.avgChange);

  cache.sectors = result;
  return result;
}

function getStockSectors() {
  return {
    'SCOM': 'Telecommunications', 'EQTY': 'Banking', 'KCB': 'Banking',
    'EABL': 'Manufacturing', 'ABSA': 'Banking', 'SBIC': 'Banking',
    'KLG': 'Transport', 'OLYM': 'Insurance', 'CRAY': 'Manufacturing',
    'BAMB': 'Manufacturing', 'UMEM': 'Utilities', 'KPLC': 'Utilities',
    'NMG': 'Media', 'TOTL': 'Energy', 'STAN': 'Banking', 'COOP': 'Banking',
    'JUB': 'Insurance', 'KNRE': 'Insurance', 'LKL': 'Insurance',
    'CIC': 'Insurance', 'HFCK': 'Banking', 'IMH': 'Manufacturing',
    'BAT': 'Manufacturing', 'KUKZ': 'Manufacturing', 'NCBA': 'Banking',
    'KEGN': 'Energy', 'CTUM': 'Technology', 'BRIT': 'Insurance',
    'CARB': 'Agriculture', 'KQ': 'Transport', 'SASN': 'Manufacturing',
    'PORT': 'Transport', 'SCAN': 'Insurance', 'WTK': 'Manufacturing',
    'EVOL': 'Technology', 'TPS': 'Energy', 'XPRS': 'Technology',
    'AAPL': 'Technology', 'MSFT': 'Technology', 'NVDA': 'Technology',
    'TSLA': 'Automobiles', 'AMZN': 'Consumer Goods', 'GOOGL': 'Technology',
    'META': 'Technology', 'NFLX': 'Technology', 'JPM': 'Financial',
    'V': 'Financial', 'WMT': 'Consumer Goods', 'JNJ': 'Healthcare',
    'PG': 'Consumer Goods', 'XOM': 'Energy', 'BAC': 'Financial',
    'HD': 'Consumer Goods', 'DIS': 'Media', 'CSCO': 'Technology',
    'ADBE': 'Technology', 'CRM': 'Technology', 'INTC': 'Technology',
    'AMD': 'Technology', 'PYPL': 'Financial', 'SNAP': 'Technology',
    'UBER': 'Technology', 'SQ': 'Financial',
  };
}

function guessSector(ticker) {
  if (!ticker) return 'Other';
  const t = ticker.toUpperCase();
  if (['SCOM', 'TIGO', 'AIR', 'ZIRA', 'ERIC'].includes(t)) return 'Telecommunications';
  if (['KCB', 'EQTY', 'COOP', 'ABSA', 'SBIC', 'STAN', 'NCBA', 'HFCK', 'JPM', 'BAC', 'WFC', 'C'].includes(t)) return 'Banking';
  if (['JUB', 'KNRE', 'LKL', 'CIC', 'BRIT', 'SCAN', 'UMME', 'PZU', 'MET'].includes(t)) return 'Insurance';
  if (['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'NFLX', 'CSCO', 'ADBE', 'CRM', 'INTC', 'AMD', 'SNAP', 'UBER', 'SQ', 'CTUM', 'EVOL', 'XPRS'].includes(t)) return 'Technology';
  if (['TSLA', 'F', 'GM', 'BMW', 'MBG', 'VOLV'].includes(t)) return 'Automobiles';
  if (['AMZN', 'WMT', 'PG', 'KO', 'PEP', 'COST', 'TGT'].includes(t)) return 'Consumer Goods';
  if (['XOM', 'CVX', 'TOTL', 'KEGN', 'TPS', 'BP', 'SHEL'].includes(t)) return 'Energy';
  if (['JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'ABT'].includes(t)) return 'Healthcare';
  if (['HD', 'LOW'].includes(t)) return 'Consumer Goods';
  if (['DIS', 'NMG', 'CMG', 'SPOT'].includes(t)) return 'Media';
  if (['EABL', 'CRAY', 'BAMB', 'BAT', 'KUKZ', 'IMH', 'SASN', 'WTK'].includes(t)) return 'Manufacturing';
  if (['KPLC', 'UMEM', 'NGE', 'CEPU'].includes(t)) return 'Utilities';
  if (['KLG', 'KQ', 'PORT'].includes(t)) return 'Transport';
  if (['V', 'PYPL', 'SQ', 'JPM', 'MA'].includes(t)) return 'Financial';
  if (['CARB', 'SASN', 'KAPC', 'TPRI'].includes(t)) return 'Agriculture';
  return 'Other';
}

function getAllSectors() {
  return SECTORS;
}

const INDICES_CACHE_KEY = 'indices:cache';

async function getCachedIndices() {
  if (cache.indices && cache.lastFetch && (Date.now() - cache.lastFetch) < CACHE_TTL_MS) {
    return cache.indices;
  }
  return null;
}

module.exports = {
  getAllIndices,
  getNseIndices,
  getGlobalIndices,
  getSectorPerformance,
  getAllSectors,
  getCachedIndices,
  NSE_INDICES,
  GLOBAL_INDICES,
  ALL_INDICES,
};
