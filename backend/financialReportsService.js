require('dotenv').config();
const marketService = require('./marketService');
const edgarService = require('./edgarService');
const yahooFinanceScraper = require('./yahooFinanceFinancialsScraper');

const FINANCIALS_PROVIDER = process.env.FINANCIALS_PROVIDER || 'yahoo-finance';
const CACHE_TTL = 24 * 60 * 60 * 1000;

const financialCache = new Map();

function cacheGet(key, ttl = CACHE_TTL) {
  const cached = financialCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > ttl) {
    financialCache.delete(key);
    return null;
  }
  return cached.data;
}

function cacheSet(key, data) {
  financialCache.set(key, { data, timestamp: Date.now() });
  return data;
}

function validateDateString(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string' || dateStr.trim() === '') {
    return null;
  }
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

async function getCompanyProfile(symbol) {
  const cacheKey = `${symbol}_profile`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const liveQuote = await marketService.getStockQuote(symbol);
  if (liveQuote) {
    return cacheSet(cacheKey, {
      symbol,
      companyName: liveQuote.company_name || symbol,
      industry: 'N/A',
      sector: 'N/A',
      country: symbol.startsWith('NSE:') ? 'Kenya' : 'USA',
      website: '',
      description: '',
      ceo: 'N/A',
      employees: 0,
      marketCap: liveQuote.marketCap || 0,
      exchange: liveQuote.exchange || (symbol.startsWith('NSE:') ? 'NSE' : 'NASDAQ/NYSE'),
      currency: liveQuote.currency || (symbol.startsWith('NSE:') ? 'KES' : 'USD'),
      isEtf: false,
      image: '',
      lastUpdated: new Date().toISOString()
    });
  }

  return cacheSet(cacheKey, {
    symbol,
    companyName: symbol,
    industry: 'N/A',
    sector: 'N/A',
    country: symbol.startsWith('NSE:') ? 'Kenya' : 'USA',
    website: '',
    description: '',
    ceo: 'N/A',
    employees: 0,
    marketCap: 0,
    exchange: symbol.startsWith('NSE:') ? 'NSE' : 'NASDAQ/NYSE',
    currency: symbol.startsWith('NSE:') ? 'KES' : 'USD',
    isEtf: false,
    image: '',
    lastUpdated: new Date().toISOString()
  });
}

async function getQuote(symbol) {
  const cacheKey = `${symbol}_quote`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const marketQuote = await marketService.getStockQuote(symbol);
    if (marketQuote) {
      return cacheSet(cacheKey, marketQuote);
    }
  } catch (err) {
    console.warn(`[FinancialReports] Quote fetch failed for ${symbol}`);
  }

  // Fallback: Twelve Data statistics for rich quote data
  try {
    const { fetchQuoteWithStats } = require('./twelveDataService');
    const tq = await fetchQuoteWithStats(symbol);
    if (tq) {
      const enriched = {
        symbol: symbol.toUpperCase(),
        price: tq.price,
        change: tq.change || 0,
        changesPercentage: tq.changePercent || 0,
        dayLow: tq.dayLow || tq.price,
        dayHigh: tq.dayHigh || tq.price,
        marketCap: tq.marketCap || 0,
        volume: tq.volume || 0,
        previousClose: tq.previousClose || tq.price,
        eps: tq.eps || 0,
        pe: tq.peRatio || 0,
        company_name: tq.company_name || symbol,
        currency: tq.currency || 'USD',
        exchange: tq.exchange || 'Global',
        lastUpdated: tq.lastUpdated || new Date().toISOString(),
      };
      return cacheSet(cacheKey, enriched);
    }
  } catch {}

  return null;
}

async function getIncomeStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_income_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return cacheSet(cacheKey, []);
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_balance_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return cacheSet(cacheKey, []);
}

async function getCashFlowStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_cashflow_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return cacheSet(cacheKey, []);
}

async function getKeyMetrics(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_metrics_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return cacheSet(cacheKey, []);
}

async function getDividendHistory(symbol, limit = 8) {
  const cacheKey = `${symbol}_dividends_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return cacheSet(cacheKey, []);
}

async function buildEdgarReport(symbol, period, limit, availableProviders) {
  const edgarReport = await edgarService.getFinancialReportFromEdgar(symbol, period, limit);
  if (!edgarReport.success) {
    return { success: false, symbol, source: 'sec-edgar', error: edgarReport.error || 'SEC EDGAR data unavailable' };
  }
  const edgarIncHistory = edgarReport.data.incomeStatementHistory || [];
  if (edgarIncHistory.length === 0) {
    return { success: false, symbol, source: 'sec-edgar', error: 'SEC EDGAR returned no financial data for this symbol' };
  }

  const [quote, dividends, tdStats] = await Promise.allSettled([
    getQuote(symbol),
    getDividendHistory(symbol, Math.max(limit * 2, 8)),
    (() => {
      try { return require('./twelveDataService').fetchStatistics(symbol); } catch { return null; }
    })(),
  ]);

  const edgarBalHistory = edgarReport.data.balanceSheetHistory || [];
  const edgarCfHistory = edgarReport.data.cashFlowStatementHistory || [];
  const edgarKmHistory = edgarReport.data.keyMetricsHistory || [];
  const edgarFilings = edgarReport.data.filings || [];

  const quoteValue = quote.status === 'fulfilled' ? quote.value : null;
  const tds = tdStats.status === 'fulfilled' ? tdStats.value : null;
  const price = quoteValue?.price || tds?.price || 0;
  const marketCap = quoteValue?.marketCap || tds?.marketCap || 0;
  const epsFromStats = tds?.eps || 0;

  const enrichedKm = edgarKmHistory.map((km) => {
    const eps = epsFromStats || km.netIncomePerShare || 0;
    const pe = (price > 0 && eps > 0) ? price / eps : 0;
    return {
      ...km, marketCap: marketCap || km.marketCap,
      peRatio: pe,
      priceToSalesRatio: (price > 0 && km.revenuePerShare > 0) ? price / km.revenuePerShare : km.priceToSalesRatio,
      earningsYield: pe > 0 ? 1 / pe : 0,
      dividendYield: tds?.dividendYield || km.dividendYield || 0,
      dividendYieldPercentage: tds?.dividendYield ? tds.dividendYield * 100 : (km.dividendYieldPercentage || 0),
    };
  });
  if (enrichedKm.length > 0 && edgarBalHistory.length > 0 && marketCap > 0) {
    const latestBal = edgarBalHistory[0];
    const equity = latestBal.totalStockholdersEquity || latestBal.totalEquity || 0;
    if (equity > 0) enrichedKm[0].pbRatio = marketCap / equity;
  }

  const quoteResponse = quoteValue || (tds ? {
    symbol: symbol.toUpperCase(),
    price: tds.price || 0,
    change: 0,
    changesPercentage: 0,
    marketCap: tds.marketCap || 0,
    eps: tds.eps || 0,
    pe: tds.peRatio || 0,
    volume: 0,
    previousClose: 0,
    lastUpdated: new Date().toISOString(),
  } : { symbol, price: 0, change: 0, changesPercentage: 0, marketCap: 0 });

  return {
    success: true, symbol, source: 'sec-edgar', availableProviders,
    lastUpdated: new Date().toISOString(),
    data: {
      profile: edgarReport.data.profile || { symbol, companyName: symbol, exchange: 'NASDAQ', currency: 'USD' },
      quote: quoteResponse,
      incomeStatement: edgarIncHistory[0] || null,
      incomeStatementHistory: edgarIncHistory,
      balanceSheet: edgarBalHistory[0] || null,
      balanceSheetHistory: edgarBalHistory,
      cashFlowStatement: edgarCfHistory[0] || null,
      cashFlowStatementHistory: edgarCfHistory,
      keyMetrics: enrichedKm[0] || null,
      keyMetricsHistory: enrichedKm,
      dividendHistory: dividends.status === 'fulfilled' ? dividends.value : [],
      filings: edgarFilings,
    }
  };
}

async function getFinancialReport(symbol, period = 'annual', limit = 4, providerOverride = null) {
  try {
    const isUs = edgarService.isUsStock(symbol);
    const activeProvider = providerOverride || FINANCIALS_PROVIDER;

    const availableProviders = ['yahoo-finance'];
    if (isUs) availableProviders.push('sec-edgar');

    // Yahoo Finance — primary for all stocks
    if (activeProvider === 'yahoo-finance') {
      const yahooReport = await yahooFinanceScraper.getFinancialReport(symbol, period, limit);
      if (yahooReport.success && yahooReport.data.incomeStatementHistory?.length > 0) {
        const quote = await getQuote(symbol).catch(() => null);
        return {
          ...yahooReport,
          symbol,
          source: 'yahoo-finance',
          availableProviders,
          data: {
            ...yahooReport.data,
            quote: quote || { symbol, price: 0, change: 0, changesPercentage: 0, marketCap: 0 },
            dividendHistory: yahooReport.data.dividendHistory?.length
              ? yahooReport.data.dividendHistory
              : [],
          }
        };
      }
      // Fallback to SEC EDGAR for US stocks when Yahoo Finance has no data
      if (isUs) {
        console.log(`[FinancialReports] Yahoo Finance empty for ${symbol}; trying SEC EDGAR fallback`);
        return buildEdgarReport(symbol, period, limit, availableProviders);
      }
      return { success: false, symbol, source: 'yahoo-finance', error: `Yahoo Finance returned no data for ${symbol}` };
    }

    // SEC EDGAR — US stocks only, no synthetic fallback
    if (activeProvider === 'sec-edgar' && isUs) {
      return buildEdgarReport(symbol, period, limit, availableProviders);
    }

    return { success: false, symbol, error: `No provider available for ${symbol}` };
  } catch (error) {
    console.error(`Error generating financial report for ${symbol}:`, error.message);
    return {
      success: false,
      symbol,
      error: error.message,
      lastUpdated: new Date().toISOString()
    };
  }
}

function clearCache() {
  financialCache.clear();
}

module.exports = {
  getCompanyProfile,
  getQuote,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getKeyMetrics,
  getDividendHistory,
  getFinancialReport,
  yahooFinanceScraper,
  clearCache,
};
