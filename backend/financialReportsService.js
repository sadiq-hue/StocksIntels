require('dotenv').config();
const marketService = require('./marketService');
const edgarService = require('./edgarService');
const proxyService = require('./proxyService');
const yahooFinanceScraper = require('./yahooFinanceFinancialsScraper');
const alphaVantageService = require('./alphaVantageFinancialsService');
const { pool } = require('./db');
const PersistentCache = require('./cacheService');
const { NSE_SYMBOLS } = require('./stockData');

async function createYf() {
  const { default: YahooFinance } = await import('yahoo-finance2');
  try {
    const proxy = proxyService.getNextProxy();
    if (proxy) {
      const agent = proxyService.createProxyAgent(proxy);
      return new YahooFinance({ suppressNotices: ['yahooSurvey'], fetchOptions: { agent } });
    }
  } catch {}
  return new YahooFinance({ suppressNotices: ['yahooSurvey'] });
}

const FINANCIALS_PROVIDER = process.env.FINANCIALS_PROVIDER || 'yahoo-finance';
const financialCache = new PersistentCache('finrep', 24 * 60 * 60 * 1000);

function companyLogoUrl(website) {
  if (!website) return '';
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch { return ''; }
}

function cacheGet(key) {
  return financialCache.get(key);
}

function cacheSet(key, data) {
  return financialCache.set(key, data);
}

function getDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'string') return d.split('T')[0];
  return String(d);
}

// Compute TTM from SEC EDGAR as primary source (delayed but authoritative).
// Only falls back to scraper cache when EDGAR fails entirely.
async function ensureTTMValues(symbol, incHist) {
  let ttmRevenue = 0;
  let ttmNetIncome = 0;
  let ttmEps = 0;
  let ttmPeriods = '';
  let sharesOut = 0;
  let forwardPE = 0;

  // Get shares outstanding & forwardPE from defaultKeyStatistics
  try {
    const yf = await createYf();
    const qs = await yf.quoteSummary(symbol, { modules: ['defaultKeyStatistics'] });
    const raw = qs?.defaultKeyStatistics?.sharesOutstanding;
    sharesOut = raw?.raw ?? raw ?? 0;
    const fwdRaw = qs?.defaultKeyStatistics?.forwardPE;
    forwardPE = fwdRaw?.raw ?? fwdRaw ?? 0;
  } catch {}

  // Primary source: SEC EDGAR quarterly data (free, authoritative, works on Railway)
  try {
    const edgarTtm = await edgarService.getTTMFromEdgar(symbol);
    if (edgarTtm && edgarTtm.revenue > 0 && edgarTtm.netIncome > 0) {
      ttmRevenue = edgarTtm.revenue;
      ttmNetIncome = edgarTtm.netIncome;
      ttmEps = edgarTtm.eps > 0 ? edgarTtm.eps : 0;
      ttmPeriods = edgarTtm.periods || '';
    } else if (edgarTtm?.periods) {
      ttmPeriods = edgarTtm.periods;
    }
  } catch { ttmPeriods = 'EXCEPTION in getTTMFromEdgar'; }

  // If we still have no EPS but have sharesOutstanding and TTM netIncome, compute EPS
  if (!ttmEps && ttmNetIncome > 0 && sharesOut > 0) {
    ttmEps = ttmNetIncome / sharesOut;
  }

  // Fallback: scraper data only when EDGAR returned nothing AND scraper data is recent
  if (!ttmRevenue && !ttmNetIncome) {
    const scraperItem = incHist?.[0];
    if (scraperItem) {
      const scraperDate = scraperItem.date || scraperItem.endDate;
      const isRecent = scraperDate && (Date.now() - new Date(scraperDate).getTime()) < 15 * 30 * 24 * 60 * 60 * 1000;
      if (isRecent) {
        ttmRevenue = scraperItem.revenue || 0;
        ttmNetIncome = scraperItem.netIncome || 0;
        if (!ttmEps && scraperItem.eps > 0) ttmEps = scraperItem.eps;
        ttmPeriods = ttmPeriods || `scraper_fallback_fy${scraperDate}`;
      } else {
        ttmPeriods = ttmPeriods || `SCRAPER_STALE: ${scraperDate || 'unknown'} >15 months old`;
      }
    }
  }

  return { revenue: ttmRevenue, netIncome: ttmNetIncome, eps: ttmEps, forwardPE, periods: ttmPeriods };
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

  const isNse = await isNseStock(symbol);
  const exchange = isNse ? 'NSE' : 'NASDAQ/NYSE';
  const currency = isNse ? 'KES' : 'USD';
  const country = isNse ? 'Kenya' : 'USA';

  const liveQuote = await marketService.getStockQuote(symbol);
  if (liveQuote) {
    return cacheSet(cacheKey, {
      symbol,
      companyName: liveQuote.company_name || symbol,
      industry: 'N/A',
      sector: 'N/A',
      country,
      website: '',
      description: '',
      ceo: 'N/A',
      employees: 0,
      marketCap: liveQuote.marketCap || 0,
      exchange: liveQuote.exchange || exchange,
      currency: liveQuote.currency || currency,
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
    country,
    website: '',
    description: '',
    ceo: 'N/A',
    employees: 0,
    marketCap: 0,
    exchange,
    currency,
    isEtf: false,
    image: '',
    lastUpdated: new Date().toISOString()
  });
}

async function getQuote(symbol) {
  const cacheKey = `${symbol}_quote`;
  const cached = cacheGet(cacheKey);
  // A cached NSE quote with no price is useless (it masks a working fallback); don't serve it.
  // Also skip cache if quote is older than 60s (stale price)
  if (cached && !(symbol.startsWith('NSE:') && !cached.price)) {
    const age = Date.now() - new Date(cached.lastUpdated || 0).getTime();
    if (age < 60000) return cached;
  }

  // Fetch live quote and full stats in parallel for the most complete data
  const [marketQuote, tdResult] = await Promise.allSettled([
    marketService.getStockQuote(symbol).catch(() => null),
    symbol.startsWith('NSE:') ? Promise.resolve(null) : getTwelveDataStats(symbol),
  ]);
  const mq = marketQuote.status === 'fulfilled' ? marketQuote.value : null;
  const td = tdResult.status === 'fulfilled' ? tdResult.value : null;

  if (mq || td) {
    const result = {
      symbol: symbol.toUpperCase(),
      price: mq?.price || td?.price || 0,
      change: mq?.change || 0,
      changesPercentage: mq?.changesPercentage || mq?.changePercent || 0,
      dayLow: mq?.dayLow || td?.dayLow || 0,
      dayHigh: mq?.dayHigh || td?.dayHigh || 0,
      marketCap: mq?.marketCap || td?.marketCap || 0,
      volume: mq?.volume || 0,
      previousClose: mq?.previousClose || 0,
      eps: td?.eps || mq?.eps || 0,
      pe: td?.peRatio || 0,
      forwardPE: td?.forwardPE || 0,
      dividendYield: td?.dividendYield || 0,
      netIncomeTTM: td?.netIncomeTTM || 0,
      revenueTTM: td?.revenueTTM || 0,
      sharesOutstanding: td?.sharesOutstanding || 0,
      company_name: mq?.company_name || td?.company_name || symbol,
      currency: mq?.currency || td?.currency || 'USD',
      exchange: mq?.exchange || td?.exchange || 'Global',
      lastUpdated: new Date().toISOString(),
    };
    // Don't cache NSE quotes that failed to resolve a price — let the next call retry the fallback chain.
    if (!(symbol.startsWith('NSE:') && !result.price)) cacheSet(cacheKey, result);
    return result;
  }

  // Last-resort fallback: Yahoo proxy
  if (!symbol.startsWith('NSE:')) {
    try {
      const yf = require('./yahooFinanceFinancialsScraper');
      const yp = await yf.fetchPriceViaProxy(symbol);
      if (yp?.price) {
        return cacheSet(cacheKey, {
          symbol: yp.symbol || symbol.toUpperCase(),
          price: yp.price,
          change: 0,
          changesPercentage: 0,
          dayLow: yp.price,
          dayHigh: yp.price,
          marketCap: 0,
          volume: 0,
          previousClose: yp.previousClose || yp.price,
          eps: 0,
          pe: 0,
          company_name: symbol,
          currency: yp.currency || 'USD',
          exchange: yp.exchange || '',
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch {}
  }

  return null;
}

// Fetch Twelve Data statistics (separate helper so both quote paths run in parallel)
async function getTwelveDataStats(symbol) {
  try {
    const { fetchQuoteWithStats } = require('./twelveDataService');
    return await fetchQuoteWithStats(symbol);
  } catch {
    return null;
  }
}

async function getIncomeStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_income_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (symbol.startsWith('NSE:') || await isNseStock(symbol)) return cacheSet(cacheKey, []);

  // 1. Yahoo scraper
  try {
    const result = await yahooFinanceScraper.getIncomeStatement(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result);
  } catch {}

  // 2. Alpha Vantage fallback
  try {
    const result = await alphaVantageService.fetchIncomeStatement(symbol, period);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  return cacheSet(cacheKey, []);
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_balance_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (symbol.startsWith('NSE:') || await isNseStock(symbol)) return cacheSet(cacheKey, []);

  try {
    const result = await yahooFinanceScraper.getBalanceSheet(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result);
  } catch {}

  try {
    const result = await alphaVantageService.fetchBalanceSheet(symbol, period);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  // SEC EDGAR fallback for US stocks
  try {
    const result = await edgarService.getBalanceSheetFromEdgar(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  return cacheSet(cacheKey, []);
}

async function getCashFlowStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_cashflow_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (symbol.startsWith('NSE:') || await isNseStock(symbol)) return cacheSet(cacheKey, []);

  try {
    const result = await yahooFinanceScraper.getCashFlowStatement(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result);
  } catch {}

  try {
    const result = await alphaVantageService.fetchCashFlow(symbol, period);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  // SEC EDGAR fallback for US stocks
  try {
    const result = await edgarService.getCashFlowFromEdgar(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  return cacheSet(cacheKey, []);
}

async function getKeyMetrics(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_metrics_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (symbol.startsWith('NSE:') || await isNseStock(symbol)) return cacheSet(cacheKey, []);

  // Yahoo scraper first (fast, works for most stocks, uses yahoo-finance2)
  try {
    const result = await yahooFinanceScraper.getKeyMetrics(symbol, period, limit);
    if (result && result.length > 0) {
      // Enrich with live quote data (fills marketCap, PE ratio from current price)
      try {
        const quote = await getQuote(symbol);
        if (quote) {
          for (const km of result) {
            const price = quote.price || 0;
            const eps = km.netIncomePerShare || quote.eps || 0;
            const sharesOut = quote.sharesOutstanding || ((km.revenuePerShare > 0 && quote.revenueTTM > 0) ? Math.round(quote.revenueTTM / km.revenuePerShare) : 0);
            const mc = quote.marketCap || computeMarketCap(price, km.netIncomePerShare * sharesOut, eps, sharesOut) || 0;
            if (mc > 0) km.marketCap = mc;
            if (quote.pe > 0 && !km.peRatio) km.peRatio = quote.pe;
            if (!km.peRatio && price > 0 && eps > 0) km.peRatio = price / eps;
            if (!km.forwardPE && quote.forwardPE > 0) km.forwardPE = quote.forwardPE;
            if (mc > 0 && km.revenuePerShare > 0 && sharesOut > 0) km.priceToSalesRatio = mc / (km.revenuePerShare * sharesOut);
            if (mc > 0 && eps > 0) km.earningsYield = eps * (sharesOut || 1) / mc;
          }
        }
      } catch {}
      return cacheSet(cacheKey, result);
    }
  } catch {}

  // Alpha Vantage fallback (richest single-source for key metrics)
  try {
    const overview = await alphaVantageService.fetchOverview(symbol);
    if (overview) {
      const price = overview.analystTargetPrice || 0;
      const eps = overview.eps || overview.dilutedEPSTTM || 0;
      const marketCap = overview.marketCap || 0;
      const revenue = overview.revenueTTM || 0;
      const equity = 0;
      const item = {
        date: overview.latestQuarter || '',
        period: 'ttm',
        marketCap,
        peRatio: overview.peRatio || (price > 0 && eps > 0 ? price / eps : 0),
        pbRatio: overview.marketCap > 0 && overview.bookValue > 0 && (overview.sharesOutstanding || 0) > 0
          ? overview.marketCap / (overview.bookValue * (overview.sharesOutstanding || 1)) : 0,
        priceToSalesRatio: marketCap > 0 && revenue > 0 ? marketCap / revenue : 0,
        debtToEquity: 0,
        currentRatio: 0,
        dividendYield: overview.dividendYield || 0,
        dividendYieldPercentage: (overview.dividendYield || 0) * 100,
        earningsYield: eps > 0 && price > 0 ? eps / price : 0,
        returnOnEquity: overview.returnOnEquityTTM || 0,
        returnOnAssets: overview.returnOnAssetsTTM || 0,
        profitMargin: overview.profitMargin || 0,
        operatingMargin: overview.operatingMarginTTM || 0,
        revenueGrowth: overview.quarterlyRevenueGrowthYOY || 0,
        earningsGrowth: overview.quarterlyEarningsGrowthYOY || 0,
        sharesOutstanding: overview.sharesOutstanding || 0,
        revenuePerShare: overview.revenuePerShareTTM || 0,
        netIncomePerShare: eps,
        bookValue: overview.bookValue || 0,
        forwardPE: overview.forwardPE || 0,
        targetPrice: overview.analystTargetPrice || 0,
        dividendPerShare: overview.dividendPerShare || 0,
        source: 'alphavantage',
      };
      return cacheSet(cacheKey, [item]);
    }
  } catch {}

  // SEC EDGAR fallback for US stocks
  try {
    const result = await edgarService.getKeyMetricsFromEdgar(symbol, period, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result.slice(0, limit));
  } catch {}

  return cacheSet(cacheKey, []);
}

async function getDividendHistory(symbol, limit = 8) {
  const cacheKey = `${symbol}_dividends_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (symbol.startsWith('NSE:') || await isNseStock(symbol)) return cacheSet(cacheKey, []);

  // 1. Yahoo scraper
  try {
    const result = await yahooFinanceScraper.getDividendHistory(symbol, limit);
    if (result && result.length > 0) return cacheSet(cacheKey, result);
  } catch {}

  // 2. Alpha Vantage overview (dividend per share + dates)
  try {
    const overview = await alphaVantageService.fetchOverview(symbol);
    if (overview?.dividendPerShare) {
      return cacheSet(cacheKey, [{
        date: overview.dividendDate || overview.exDividendDate || '',
        dividend: overview.dividendPerShare,
        adjDividend: overview.dividendPerShare,
        currency: overview.currency || 'USD',
        source: 'alphavantage',
      }]);
    }
  } catch {}

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
    yahooFinanceScraper.getDividendHistory(symbol, Math.max(limit * 2, 8)),
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
  const divsValue = dividends.status === 'fulfilled' ? dividends.value : [];
  const price = quoteValue?.price || tds?.price || 0;
  const marketCapFromQuote = quoteValue?.marketCap || tds?.marketCap || 0;
  const epsFromStats = tds?.eps || 0;

  // Compute dividend yield from dividend history
  const totalAnnualDiv = divsValue.length > 0 ? Math.abs(divsValue[0].dividend || divsValue[0].adjDividend || 0) : 0;
  const divYieldFromHistory = (price > 0 && totalAnnualDiv > 0) ? totalAnnualDiv / price : null;

  const ttm = await ensureTTMValues(symbol, edgarIncHistory);

  const enrichedKm = edgarKmHistory.map((km, idx) => {
    const incItem = edgarIncHistory[idx] || {};
    const isCurrent = idx === 0;
    const liveEps = quoteValue?.eps || tds?.eps || 0;
    const eps = liveEps || (isCurrent ? (ttm.eps || 0) : 0) || km.netIncomePerShare ||
      (km.sharesOutstanding > 0 && incItem.netIncome ? incItem.netIncome / km.sharesOutstanding : 0);
    const netIncome = (isCurrent ? (ttm.netIncome || 0) : incItem.netIncome) || incItem.netIncome || 0;
    const revenue = (isCurrent ? (ttm.revenue || 0) : incItem.revenue) || incItem.revenue || 0;
    const pe = quoteValue?.pe > 0 ? quoteValue.pe : ((price > 0 && eps > 0) ? price / eps : 0);
    const sharesOut = quoteValue?.sharesOutstanding || km.sharesOutstanding || 0;
    const computedMarketCap = marketCapFromQuote || (price > 0 && sharesOut > 0 ? price * sharesOut : 0);
    const divYield = quoteValue?.dividendYield || tds?.dividendYield || km.dividendYield || divYieldFromHistory || 0;
    return {
      ...km, marketCap: computedMarketCap,
      sharesOutstanding: sharesOut,
      peRatio: pe,
      priceToSalesRatio: (price > 0 && revenue > 0 && km.revenuePerShare > 0) ? price / km.revenuePerShare : (revenue > 0 && computedMarketCap > 0 ? computedMarketCap / revenue : km.priceToSalesRatio),
      earningsYield: pe > 0 ? 1 / pe : 0,
      dividendYield: divYield,
      dividendYieldPercentage: divYield * 100,
    };
  });
  if (enrichedKm.length > 0 && edgarBalHistory.length > 0) {
    const latestBal = edgarBalHistory[0];
    const equity = latestBal.totalStockholdersEquity || latestBal.totalEquity || 0;
    const mc = enrichedKm[0].marketCap || 0;
    if (equity > 0 && mc > 0) enrichedKm[0].pbRatio = mc / equity;
  }

  // Override incomeStatement[0] with TTM values
  const ttmIncome = edgarIncHistory[0] ? {
    ...edgarIncHistory[0],
    period: 'ttm',
    revenue: ttm.revenue || edgarIncHistory[0].revenue,
    netIncome: ttm.netIncome || edgarIncHistory[0].netIncome,
    eps: ttm.eps || edgarIncHistory[0].eps,
    epsdiluted: ttm.eps || edgarIncHistory[0].epsdiluted || edgarIncHistory[0].eps,
    netIncomeRatio: ttm.revenue > 0 ? (ttm.netIncome || 0) / ttm.revenue : edgarIncHistory[0].netIncomeRatio,
  } : null;
  const ttmIncHist = ttmIncome ? [ttmIncome, ...edgarIncHistory.slice(1)] : edgarIncHistory;

  const computedCap = enrichedKm[0]?.marketCap || 0;
  const quoteResponse = quoteValue || (tds ? {
    symbol: symbol.toUpperCase(),
    price: tds.price || 0,
    change: 0,
    changesPercentage: 0,
    marketCap: computedCap || tds.marketCap || 0,
    eps: tds.eps || 0,
    pe: tds.peRatio || 0,
    volume: 0,
    previousClose: 0,
    lastUpdated: new Date().toISOString(),
  } : { symbol, price: price || 0, change: 0, changesPercentage: 0, marketCap: computedCap });

  return {
    success: true, symbol, source: 'sec-edgar', availableProviders,
    lastUpdated: new Date().toISOString(),
    data: {
      profile: edgarReport.data.profile || { symbol, companyName: symbol, exchange: 'NASDAQ', currency: 'USD' },
      quote: quoteResponse,
      incomeStatement: ttmIncome || edgarIncHistory[0] || null,
      incomeStatementHistory: ttmIncHist,
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

function toNum(v) { return v != null ? Number(v) : 0; }

function computeMarketCap(price, netIncome, eps, sharesOutstanding) {
  if (!price || price <= 0) return 0;
  if (sharesOutstanding > 0) return Math.round(price * sharesOutstanding);
  if (netIncome && eps && (netIncome > 0 === eps > 0)) return Math.round(price * Math.abs(netIncome / eps));
  return 0;
}

function enrichReportData(result, ownership, quarterlyShares, validationWarnings) {
  if (!result?.success || !result?.data) return result;
  const data = { ...result.data };
  data.ownership = ownership || null;
  data.quarterlyShareCountHistory = quarterlyShares || [];
  data.validationWarnings = validationWarnings || [];

  // Build patch from ownership — always apply regardless of keyMetrics state
  const patch = {};
  if (ownership) {
    if (ownership.shortInterest > 0) patch.sharesShortPriorMonth = ownership.shortInterest;
    if (ownership.floatShares > 0) patch.floatShares = ownership.floatShares;
    if (ownership.yahooSharesOutstanding > 0) patch.sharesOutstanding = ownership.yahooSharesOutstanding;
  }

  if (Object.keys(patch).length > 0) {
    console.log(`[Enrich] ${result.symbol}: patching keyMetrics with short=${patch.sharesShortPriorMonth || 0}, float=${patch.floatShares || 0}, sharesOut=${patch.sharesOutstanding || 0}`);
    // Patch existing keyMetrics or create a minimal one so the Supply tab has data
    if (data.keyMetrics) {
      data.keyMetrics = { ...data.keyMetrics, ...patch };
    } else if (data.keyMetricsHistory?.length > 0) {
      data.keyMetrics = { ...data.keyMetricsHistory[0], ...patch };
    } else {
      data.keyMetrics = { ...patch };
    }
    if (data.keyMetricsHistory?.length > 0) {
      data.keyMetricsHistory = data.keyMetricsHistory.map((km, i) =>
        i === 0 ? { ...km, ...patch } : km
      );
    } else {
      data.keyMetricsHistory = [{ ...patch }];
    }
  }

  return { ...result, data };
}

async function buildLocalNseReport(symbol) {
  let ticker = symbol;
  if (ticker.startsWith('NSE:')) ticker = ticker.slice(4);
  try {
    const stockResult = await pool.query(
      'SELECT id, name, sector, currency FROM stocks WHERE UPPER(ticker) = $1 AND market = $2',
      [ticker, 'NSE']
    );
    if (stockResult.rows.length === 0) {
      return null;
    }
    const stock = stockResult.rows[0];

    // Primary data source: financial_statements.parsed_data (populated by JSON upload / PDF parse)
    const stmtResult = await pool.query(
      `SELECT DISTINCT ON (period_end_date) parsed_data, period_end_date, period_type FROM financial_statements
       WHERE stock_id = $1 AND status = 'completed' AND parsed_data IS NOT NULL
       ORDER BY period_end_date DESC NULLS LAST, uploaded_at DESC`,
      [stock.id]
    );
    const statements = stmtResult.rows;
    const now = new Date().toISOString();
    // Normalize each statement's parsed_data (alternative key names)
    function normalizeParsed(raw) {
      if (!raw) return null;
      const p = typeof raw === 'string' ? JSON.parse(raw) : { ...raw };
      const keyMap = { net_income_pat: 'net_income', earnings_per_share: 'eps', profit_after_tax: 'net_income', pat: 'net_income', dividend_per_share: 'dps', shares_outstanding_millions: 'shares_outstanding' };
      for (const [src, dest] of Object.entries(keyMap)) {
        if (p[src] !== undefined && p[dest] === undefined) {
          p[dest] = src === 'shares_outstanding_millions' ? p[src] * 1000000 : p[src];
        }
      }
      return p;
    }
    function normalizeDate(d) { if (!d) return d; if (d instanceof Date) return d.toISOString().split('T')[0]; const s = String(d); const m = s.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : s.slice(0, 10); }
    const allParsed = statements.map(s => ({ parsed: normalizeParsed(s.parsed_data), periodDate: normalizeDate(s.period_end_date), periodType: s.period_type }));
    const validParsed = allParsed.filter(p => p.parsed);
    const latest = validParsed[0] || {};
    const parsed = latest.parsed || null;
    const periodDate = latest.periodDate || now;

    // When latest period is non-annual, prefer annual data for summary KPI cards
    const latestPeriodType = (latest.periodType || '').toLowerCase();
    const summaryParsed = (latestPeriodType && latestPeriodType !== 'annual')
      ? (validParsed.find(v => (v.periodType || '').toLowerCase() === 'annual')?.parsed || parsed)
      : parsed;

    // Supplementary: stock_fundamentals (may have different schema on Railway; errors are non-fatal)
    let fundamentals = null;
    try {
      const fundResult = await pool.query('SELECT * FROM stock_fundamentals WHERE symbol = $1', [ticker]);
      if (fundResult.rows.length > 0) {
        fundamentals = fundResult.rows[0];
      } else {
        const nsResult = await pool.query('SELECT id FROM nse_stocks WHERE UPPER(ticker) = UPPER($1)', [ticker]);
        if (nsResult.rows.length > 0) {
          const fundResult2 = await pool.query('SELECT * FROM stock_fundamentals WHERE stock_id = $1', [nsResult.rows[0].id]);
          fundamentals = fundResult2.rows[0] || null;
        }
      }
    } catch (fundErr) {
      console.log(`[buildLocalNseReport] fundamentals lookup skipped (non-fatal): ${fundErr.message}`);
    }

    if (!fundamentals && !parsed) return null;

    // When annual records exist, use only annual for the main history grids to
    // prevent mixed quarterly/annual columns from corrupting YoY comparisons.
    const hasAnnual = validParsed.some(v => (v.periodType || '').toLowerCase() === 'annual');
    const gridParsed = hasAnnual
      ? validParsed.filter(v => (v.periodType || '').toLowerCase() === 'annual')
      : validParsed;

    // Build history arrays from filtered periods
    function buildIncItem(p, d, pt) { return p ? { date: d, periodType: pt, revenue: p.revenue || p.total_revenue, totalRevenue: p.total_revenue || null, netIncome: p.net_income, netIncomeRatio: p.net_income > 0 && p.total_revenue > 0 ? p.net_income / p.total_revenue : 0, grossProfit: p.total_revenue != null && p.cost_of_revenue != null ? p.total_revenue - p.cost_of_revenue : null, ebitda: null, eps: p.eps, costOfRevenue: p.cost_of_revenue, operatingExpenses: null, operatingIncome: p.operating_income, netInterestIncome: p.net_interest_income || null } : null; }
    function buildBalItem(p, d, pt) { return p ? { date: d, periodType: pt, totalAssets: p.total_assets, totalLiabilities: p.total_liabilities, totalEquity: p.shareholders_equity, cashAndCashEquivalents: p.cash_and_equivalents, longTermDebt: null, totalDebt: p.total_debt, totalCurrentAssets: p.current_assets, totalCurrentLiabilities: p.current_liabilities, totalStockholdersEquity: p.shareholders_equity, retainedEarnings: p.retained_earnings } : null; }
    function buildCfItem(p, d, pt) { return p?.cash_from_operations != null ? { date: d, periodType: pt, operatingCashFlow: p.cash_from_operations, freeCashFlow: null, capitalExpenditure: null, dividendsPaid: null, netChangeInCash: null } : null; }

    const incHistory = gridParsed.map(v => buildIncItem(v.parsed, v.periodDate, v.periodType)).filter(Boolean);
    const balHistory = gridParsed.map(v => buildBalItem(v.parsed, v.periodDate, v.periodType)).filter(Boolean);
    const cfHistory = gridParsed.map(v => buildCfItem(v.parsed, v.periodDate, v.periodType)).filter(Boolean);

    // Latest single items for backward compatibility (KPI cards, summary)
    // When latest period is non-annual (e.g. half_year, quarterly), use the latest
    // annual period for summary KPI so interim 6-month data isn't shown as "Trailing 12M".
    const latestIncType = (validParsed[0]?.periodType || '').toLowerCase();
    const isLatestAnnual = latestIncType === 'annual' || latestIncType === '';
    const incItem = isLatestAnnual ? (incHistory[0] || null) : (incHistory.find(h => (h.periodType || '').toLowerCase() === 'annual') || incHistory[0] || null);
    const balItem = isLatestAnnual ? (balHistory[0] || null) : (balHistory.find(h => (h.periodType || '').toLowerCase() === 'annual') || balHistory[0] || null);
    const cfItem = cfHistory[0] || null;

    const f = fundamentals ? { market_cap: toNum(fundamentals.market_cap), pe_ratio: toNum(fundamentals.pe_ratio), pb_ratio: toNum(fundamentals.pb_ratio), dividend_yield: toNum(fundamentals.dividend_yield), roe: toNum(fundamentals.roe), revenue_growth: toNum(fundamentals.revenue_growth), eps_growth: toNum(fundamentals.eps_growth) } : null;

    // NSE stocks need 'NSE:' prefix for marketService to trigger mystocks + AFX volume fallback
    const quoteSymbol = `NSE:${ticker}`;
    const quote = await getQuote(quoteSymbol).catch(() => null);
    const price = quote?.price || 0;

    // Prefer an ANNUAL statement for per-share figures (shares outstanding, trailing P/E)
    // so a quarterly latest period doesn't 4x the P/E or mismatch the share count.
    const annualStmt = validParsed.find(v => v.periodType && String(v.periodType).toLowerCase() === 'annual' && v.parsed && v.parsed.eps > 0) || null;
    const sharesSrc = annualStmt ? annualStmt.parsed : parsed;

    const hasExactShares = sharesSrc?.shares_outstanding != null && sharesSrc.shares_outstanding > 0;
    const equityShares = (sharesSrc?.shareholders_equity > 0 && sharesSrc?.book_value_per_share > 0)
      ? Math.round(sharesSrc.shareholders_equity / sharesSrc.book_value_per_share) : 0;
    const incomeShares = (sharesSrc?.net_income && sharesSrc?.eps && (sharesSrc.net_income > 0 === sharesSrc.eps > 0))
      ? Math.round(Math.abs(sharesSrc.net_income / sharesSrc.eps)) : 0;
    const sharesOut = hasExactShares ? sharesSrc.shares_outstanding : (equityShares || incomeShares);

    const annualEps = annualStmt ? annualStmt.parsed.eps : (parsed?.eps || 0);
    const peRatio = (price > 0 && annualEps > 0) ? price / annualEps : (f?.pe_ratio || 0);

    const divYield = f?.dividend_yield || (sharesSrc?.dividend_per_share && price > 0 ? sharesSrc.dividend_per_share / price : 0);
    const mc = quote?.marketCap
      || (hasExactShares && price > 0 ? Math.round(price * sharesOut) : 0)
      || (equityShares > 0 && price > 0 ? Math.round(price * equityShares) : 0)
      || f?.market_cap
      || (incomeShares > 0 && price > 0 ? Math.round(price * incomeShares) : 0)
      || 0;
    // Ensure changesPercentage is computed if quote has change but no percentage
    if (quote && !quote.changesPercentage && price > 0) {
      const pc = quote.previousClose || (price - (quote.change || 0));
      quote.changesPercentage = pc > 0 ? ((price - pc) / pc) * 100 : 0;
      quote.changePercent = quote.changesPercentage;
    }
    const totalDebt = summaryParsed?.total_debt || 0;
    const equity = summaryParsed?.shareholders_equity || 0;
    const curAssets = summaryParsed?.current_assets || 0;
    const curLiabs = summaryParsed?.current_liabilities || 0;

    const bvps = summaryParsed?.book_value_per_share || (equity > 0 && sharesOut > 0 ? equity / sharesOut : 0);

    function buildKmItem(p, d, pt) {
      if (!p) return null;
      const pEquityShares = (p.shareholders_equity > 0 && p.book_value_per_share > 0)
        ? Math.round(p.shareholders_equity / p.book_value_per_share) : 0;
      const pIncomeShares = (p.net_income && p.eps && (p.net_income > 0 === p.eps > 0))
        ? Math.round(Math.abs(p.net_income / p.eps)) : 0;
      const pShares = p.shares_outstanding || pEquityShares || pIncomeShares;
      const pEquity = p.shareholders_equity || 0;
      const pBvps = p.book_value_per_share || (pEquity > 0 && pShares > 0 ? pEquity / pShares : 0);
      return {
        date: d, periodType: pt, marketCap: mc,
        peRatio: price > 0 && annualEps > 0 ? price / annualEps : (price > 0 && p.eps > 0 ? price / p.eps : (f?.pe_ratio || 0)),
        pbRatio: price > 0 && pBvps > 0 ? price / pBvps : (f?.pb_ratio || 0),
        dividendYield: divYield, dividendYieldPercentage: divYield * 100,
        roe: p.net_income && pEquity ? p.net_income / pEquity : (f?.roe || 0),
        revenueGrowth: f?.revenue_growth || 0,
        epsGrowth: f?.eps_growth || p.eps || 0,
        sharesOutstanding: Math.round(pShares),
        earningsYield: price > 0 && p.eps > 0 ? p.eps / price : 0,
        revenuePerShare: pShares > 0 && p.total_revenue ? p.total_revenue / pShares : 0,
        netIncomePerShare: p.eps || 0,
        priceToSalesRatio: mc > 0 && p.total_revenue ? mc / p.total_revenue : 0,
        debtToEquity: (p.total_debt || 0) > 0 && pEquity > 0 ? p.total_debt / pEquity : 0,
        currentRatio: (p.current_assets || 0) > 0 && (p.current_liabilities || 0) > 0 ? p.current_assets / p.current_liabilities : 0,
      };
    }

    const metHistory = gridParsed.map(v => buildKmItem(v.parsed, v.periodDate, v.periodType)).filter(Boolean);
    const kmItem = metHistory[0] || null;

    return {
      success: true, symbol: ticker, source: 'nse-upload',
      availableProviders: ['yahoo-finance'], lastUpdated: now,
      data: {
        profile: { symbol: ticker, companyName: stock.name, industry: stock.sector || 'N/A',
          sector: stock.sector || 'N/A', country: 'Kenya', website: '', description: '',
          ceo: 'N/A', employees: 0, marketCap: mc || quote?.marketCap,
          exchange: 'NSE', currency: stock.currency || 'KES', isEtf: false, image: '', lastUpdated: now },
        quote: { ...(quote || { symbol: ticker, price: 0, change: 0, changesPercentage: 0,
          dayLow: 0, dayHigh: 0, yearLow: 0, yearHigh: 0, avgVolume: 0, open: 0,
          volume: 0, previousClose: 0, sharesOutstanding: 0,
          eps: 0, pe: 0, lastUpdated: now }), marketCap: mc,
          sharesOutstanding: sharesOut, eps: summaryParsed?.eps || 0, pe: peRatio },
        incomeStatement: incItem, incomeStatementHistory: incHistory,
        balanceSheet: balItem, balanceSheetHistory: balHistory,
        cashFlowStatement: cfItem, cashFlowStatementHistory: cfHistory,
        keyMetrics: kmItem, keyMetricsHistory: metHistory,
        dividendHistory: parsed?.dividend_per_share
          ? [{ date: periodDate, dividend: parsed.dividend_per_share, adjDividend: parsed.dividend_per_share }] : [],
        filings: [],
      }
    };
  } catch (err) {
    console.error(`[FinancialReports] NSE local fallback error for ${symbol}:`, err.message);
    return null;
  }
}

// Detect NSE-listed stocks so we never fall through to Yahoo Finance / SEC EDGAR
// (which have no NSE coverage). Matches the `NSE:` prefix or a stocks row with market='NSE'.
async function isNseStock(symbol) {
  let ticker = symbol;
  if (ticker.startsWith('NSE:')) ticker = ticker.slice(4);
  // Authoritative source: a stocks row with market='NSE'
  try {
    const r = await pool.query(
      'SELECT 1 FROM stocks WHERE UPPER(ticker) = $1 AND market = $2 LIMIT 1',
      [ticker, 'NSE']
    );
    if (r.rows.length > 0) return true;
  } catch { /* fall through to list check */ }
  // Fallback: canonical NSE ticker list (covers newly listed stocks like KPC
  // that may not yet have a stocks row, so we never mis-route them to Yahoo)
  return NSE_SYMBOLS.includes(ticker.toUpperCase());
}

async function getFinancialReport(symbol, period = 'annual', limit = 4, providerOverride = null) {
  try {
    const isUs = edgarService.isUsStock(symbol);

    // NSE-listed stocks: serve local NSE data only. Yahoo Finance / SEC EDGAR have
    // no NSE coverage, so falling through to them just produces a failed Yahoo fetch
    // (or wrong US data) instead of the authoritative NSE source.
    const isNse = symbol.toUpperCase().startsWith('NSE:') || await isNseStock(symbol);
    if (isNse) {
      const nseLocal = await buildLocalNseReport(symbol);
      if (nseLocal) return nseLocal;
      const clean = symbol.toUpperCase().startsWith('NSE:') ? symbol.slice(4) : symbol;
      return {
        success: false,
        symbol: clean,
        source: 'nse-upload',
        availableProviders: ['nse-upload'],
        error: `No NSE financial data available yet for ${clean}.`,
      };
    }

    const activeProvider = providerOverride || FINANCIALS_PROVIDER;

    // For stocks with locally uploaded financial data (e.g. JSON upload for NSE),
    // serve local data first — it's authoritative and user-curated
    const nseLocal = await buildLocalNseReport(symbol);
    if (nseLocal) return nseLocal;

    const availableProviders = ['yahoo-finance'];
    if (isUs) availableProviders.push('sec-edgar');

    // Yahoo Finance — primary for all stocks (uses Twelve Data + SEC EDGAR internally on Railway)
    if (activeProvider === 'yahoo-finance') {
      const yahooReport = await yahooFinanceScraper.getFinancialReport(symbol, period, limit);
      if (yahooReport.success && yahooReport.data.incomeStatementHistory?.length > 0) {
        // Try NSE: prefix for mystocks quote (has marketCap, changePercent) on NSE stocks
        let quote = await getQuote(symbol).catch(() => null);
        if (!quote || !quote.marketCap) {
          const nseQuote = await getQuote('NSE:' + symbol).catch(() => null);
          if (nseQuote) quote = nseQuote;
        }
        const price = quote?.price || 0;

        // Force USD for known US stocks (guard against wrong profile currency from API)
        if (isUs && yahooReport.data.profile) {
          yahooReport.data.profile.currency = 'USD';
          if (yahooReport.data.profile.exchange === 'NSE' || !yahooReport.data.profile.exchange) {
            yahooReport.data.profile.exchange = 'NASDAQ/NYSE';
          }
        }

        // Enrich keyMetrics with real ratios from quote price + financial data
        const divHist = yahooReport.data.dividendHistory || [];
        const totalAnnualDiv = divHist.length > 0 ? Math.abs(divHist[0].dividend || divHist[0].adjDividend || 0) : 0;
        const divYieldFromHistory = (price > 0 && totalAnnualDiv > 0) ? totalAnnualDiv / price : null;
        const incHist = yahooReport.data.incomeStatementHistory || [];
        const balHist = yahooReport.data.balanceSheetHistory || [];
        // Multi-layer TTM safety net: if the scraper didn't produce TTM data with EPS
        // (e.g. fundamentalsTimeSeries blocked on Railway), try alternative sources
        const ttm = await ensureTTMValues(symbol, incHist);
        const enrichedKm = (yahooReport.data.keyMetricsHistory || []).map((km, idx) => {
          const inc = incHist[idx] || {};
          const bal = balHist[idx] || {};
          const isCurrent = idx === 0;
          // Use TTM fallback values for the current (latest) period; historical periods use inc directly
          const netIncome = quote?.netIncomeTTM || (isCurrent ? ttm.netIncome : inc.netIncome) || inc.netIncome || 0;
          // EPS priority: Twelve Data → TTM fallback → scraper → forwardPE-derived → 0
          let eps = quote?.eps || (isCurrent ? ttm.eps : inc.eps) || inc.eps || 0;
          if (eps <= 0 && isCurrent && ttm.forwardPE > 0 && price > 0) {
            eps = price / ttm.forwardPE;
          }
          const sharesOut = quote?.sharesOutstanding || ((netIncome && eps && (netIncome > 0 === eps > 0)) ? Math.abs(netIncome / eps) : 0);
          const mc = quote?.marketCap || km.marketCap || computeMarketCap(price, netIncome, eps, sharesOut) || 0;
          const revenue = quote?.revenueTTM || (isCurrent ? ttm.revenue : inc.revenue) || inc.revenue || 0;
          const equity = bal.totalStockholdersEquity || bal.totalEquity || 0;
          const divYield = quote?.dividendYield || km.dividendYield || divYieldFromHistory || 0;
          return {
            ...km,
            marketCap: mc,
            peRatio: quote?.pe > 0 ? quote.pe : (km.peRatio > 0 ? km.peRatio : ((price > 0 && eps > 0) ? price / eps : (netIncome > 0 && mc > 0 ? mc / netIncome : 0))),
            priceToSalesRatio: (mc > 0 && revenue > 0) ? mc / revenue : 0,
            pbRatio: (mc > 0 && equity > 0) ? mc / equity : 0,
            earningsYield: (price > 0 && eps > 0) ? eps / price : 0,
            dividendYield: divYield,
            dividendYieldPercentage: divYield * 100,
            sharesOutstanding: Math.round(sharesOut),
            revenuePerShare: sharesOut > 0 ? revenue / sharesOut : 0,
            netIncomePerShare: eps || (sharesOut > 0 ? netIncome / sharesOut : 0),
          };
        });

        // Override incomeStatement[0] with TTM values so the frontend KPI row shows TTM data
        const ttmIncome = incHist[0] ? {
          ...incHist[0],
          date: incHist[0].date,
          period: 'ttm',
          revenue: ttm.revenue || incHist[0].revenue,
          netIncome: ttm.netIncome || incHist[0].netIncome,
          eps: ttm.eps || incHist[0].eps,
          epsdiluted: ttm.eps || incHist[0].epsdiluted || incHist[0].eps,
          netIncomeRatio: ttm.revenue > 0 ? (ttm.netIncome || 0) / ttm.revenue : incHist[0].netIncomeRatio,
        } : null;
        const ttmIncHist = ttmIncome ? [ttmIncome, ...incHist.slice(1)] : incHist;

        const yahooResult = {
          ...yahooReport,
          symbol,
          source: 'yahoo-finance',
          availableProviders,
          data: {
            ...yahooReport.data,
            incomeStatement: ttmIncome || yahooReport.data.incomeStatement,
            incomeStatementHistory: ttmIncHist,
            keyMetrics: enrichedKm[0] || null,
            keyMetricsHistory: enrichedKm,
            quote: (() => {
              const q = quote || { symbol, price: 0, change: 0, changesPercentage: 0, marketCap: 0 };
              if (q.price > 0 && !q.changesPercentage) {
                const pc = q.previousClose || (q.price - (q.change || 0));
                q.changesPercentage = pc > 0 ? ((q.price - pc) / pc) * 100 : 0;
              }
              return { ...q, marketCap: enrichedKm[0]?.marketCap || q.marketCap || 0 };
            })(),
            dividendHistory: yahooReport.data.dividendHistory?.length
              ? yahooReport.data.dividendHistory
              : [],
          }
        };

        const [ownership, quarterlyShares] = await Promise.allSettled([
          getOwnershipData(symbol),
          getQuarterlyShareCountHistory(symbol),
        ]);
        const ownershipVal = ownership.status === 'fulfilled' ? ownership.value : null;
        const quarterlyVal = quarterlyShares.status === 'fulfilled' ? quarterlyShares.value : null;
        return enrichReportData(yahooResult, ownershipVal, quarterlyVal, validateFinancialData(yahooResult));
      }
      // Alpha Vantage fallback when Yahoo Finance has no data (1 quick OVERVIEW call)
      console.log(`[FinancialReports] Yahoo Finance empty for ${symbol}; trying Alpha Vantage fallback`);
      const alphaOverview = await alphaVantageService.fetchOverview(symbol).catch(() => null);
      if (alphaOverview) {
        availableProviders.push('alphavantage');
        // Try to pull already-cached statement data too
        const [cachedInc, cachedBal, cachedCf] = await Promise.all([
          alphaVantageService.fetchIncomeStatement(symbol, period).catch(() => []),
          alphaVantageService.fetchBalanceSheet(symbol, period).catch(() => []),
          alphaVantageService.fetchCashFlow(symbol, period).catch(() => []),
        ]);
        const price = alphaOverview.analystTargetPrice || 0;
        const eps = alphaOverview.eps || alphaOverview.dilutedEPSTTM || 0;
        const marketCap = alphaOverview.marketCap || 0;
        const revenue = alphaOverview.revenueTTM || 0;
        const netIncome = alphaOverview.revenueTTM && alphaOverview.profitMargin
          ? alphaOverview.revenueTTM * alphaOverview.profitMargin : 0;
        const overviewQuote = await getQuote(symbol).catch(() => null);
        const livePrice = overviewQuote?.price || price;
        const liveMc = overviewQuote?.marketCap || marketCap;

        const alphaProfile = {
          symbol, companyName: alphaOverview.name || symbol,
          industry: alphaOverview.industry || '', sector: alphaOverview.sector || '',
          country: alphaOverview.country || 'USA', website: '', description: alphaOverview.description || '',
          ceo: 'N/A', employees: 0, marketCap: liveMc || marketCap,
          exchange: alphaOverview.exchange || '', currency: alphaOverview.currency || 'USD',
          cik: alphaOverview.cik, isEtf: false, image: companyLogoUrl(alphaOverview.website || ''), lastUpdated: new Date().toISOString(),
        };
        const alphaKeyMetrics = {
          marketCap: liveMc || marketCap, sharesOutstanding: alphaOverview.sharesOutstanding || 0,
          peRatio: alphaOverview.peRatio || (livePrice > 0 && eps > 0 ? livePrice / eps : 0),
          priceToSalesRatio: revenue > 0 && marketCap > 0 ? marketCap / revenue : 0,
          pbRatio: 0, debtToEquity: 0, currentRatio: 0,
          dividendYield: alphaOverview.dividendYield || 0,
          dividendYieldPercentage: (alphaOverview.dividendYield || 0) * 100,
          earningsYield: eps > 0 && livePrice > 0 ? eps / livePrice : 0,
          returnOnEquity: alphaOverview.returnOnEquityTTM || 0,
          returnOnAssets: alphaOverview.returnOnAssetsTTM || 0,
          profitMargin: alphaOverview.profitMargin || 0,
          operatingMargin: alphaOverview.operatingMarginTTM || 0,
          revenueGrowth: alphaOverview.quarterlyRevenueGrowthYOY || 0,
          earningsGrowth: alphaOverview.quarterlyEarningsGrowthYOY || 0,
          revenuePerShare: alphaOverview.revenuePerShareTTM || 0,
          netIncomePerShare: eps, bookValue: alphaOverview.bookValue || 0,
          forwardPE: alphaOverview.forwardPE || 0, targetPrice: alphaOverview.analystTargetPrice || 0,
          dividendPerShare: alphaOverview.dividendPerShare || 0,
        };
        const alphaQuote = {
          symbol, price: livePrice || 0, change: overviewQuote?.change || 0,
          changesPercentage: overviewQuote?.changesPercentage || 0,
          marketCap: liveMc || marketCap, eps, pe: alphaKeyMetrics.peRatio,
          dividendYield: alphaOverview.dividendYield || 0,
          currency: alphaOverview.currency || 'USD', exchange: alphaOverview.exchange || '',
          lastUpdated: new Date().toISOString(), source: 'alphavantage',
        };

        const result = {
          success: true, symbol, source: 'alphavantage', availableProviders,
          lastUpdated: new Date().toISOString(),
          data: {
            profile: alphaProfile, quote: alphaQuote,
            incomeStatement: cachedInc[0] || null,
            incomeStatementHistory: cachedInc.slice(0, limit),
            balanceSheet: cachedBal[0] || null,
            balanceSheetHistory: cachedBal.slice(0, limit),
            cashFlowStatement: cachedCf[0] || null,
            cashFlowStatementHistory: cachedCf.slice(0, limit),
            keyMetrics: alphaKeyMetrics, keyMetricsHistory: [alphaKeyMetrics],
            dividendHistory: alphaOverview.dividendPerShare
              ? [{ date: alphaOverview.dividendDate || alphaOverview.exDividendDate || '',
                  dividend: alphaOverview.dividendPerShare,
                  adjDividend: alphaOverview.dividendPerShare,
                  currency: alphaOverview.currency || 'USD' }] : [],
            filings: [],
          }
        };

        // Background-fill income/balance/cashflow if none were cached
        if (cachedInc.length === 0 && cachedBal.length === 0 && cachedCf.length === 0) {
          alphaVantageService.buildFinancialReport(symbol, period, limit)
            .then(fullReport => {
              if (fullReport) {
                console.log(`[AlphaVantage] Background backfill complete for ${symbol}`);
              }
            }).catch(() => {});
        }

        const [avOwnership, avQshares] = await Promise.allSettled([
          getOwnershipData(symbol),
          getQuarterlyShareCountHistory(symbol),
        ]);
        return enrichReportData(result, avOwnership.status === 'fulfilled' ? avOwnership.value : null, avQshares.status === 'fulfilled' ? avQshares.value : null, validateFinancialData(result));
      }
      // Fallback to SEC EDGAR for US stocks when Yahoo / AlphaVantage has no data
      if (isUs) {
        console.log(`[FinancialReports] Yahoo/AlphaVantage empty for ${symbol}; trying SEC EDGAR fallback`);
        const edgarResult = await buildEdgarReport(symbol, period, limit, availableProviders);
        const [edOwnership, edQshares] = await Promise.allSettled([
          getOwnershipData(symbol),
          getQuarterlyShareCountHistory(symbol),
        ]);
        return enrichReportData(edgarResult, edOwnership.status === 'fulfilled' ? edOwnership.value : null, edQshares.status === 'fulfilled' ? edQshares.value : null, validateFinancialData(edgarResult));
      }
      return { success: false, symbol, source: 'yahoo-finance', error: `No data for ${symbol} from Yahoo, Alpha Vantage, or EDGAR` };
    }

    // SEC EDGAR — US stocks only
    if (activeProvider === 'sec-edgar' && isUs) {
      const edgarResult = await buildEdgarReport(symbol, period, limit, availableProviders);
      const [edOwnership2, edQshares2] = await Promise.allSettled([
        getOwnershipData(symbol),
        getQuarterlyShareCountHistory(symbol),
      ]);
      return enrichReportData(edgarResult, edOwnership2.status === 'fulfilled' ? edOwnership2.value : null, edQshares2.status === 'fulfilled' ? edQshares2.value : null, validateFinancialData(edgarResult));
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

function validateFinancialData(report) {
  if (!report?.success || !report?.data) return [];

  const warnings = [];
  const km = report.data.keyMetrics;
  const inc = report.data.incomeStatement;
  const bal = report.data.balanceSheet;
  const cf = report.data.cashFlowStatement;

  if (km) {
    if (km.sharesOutstanding > 0 && km.floatShares > 0 && km.floatShares > km.sharesOutstanding) {
      warnings.push({ field: 'floatShares', message: 'Float shares exceed shares outstanding', severity: 'warning' });
    }
    if (km.sharesShortPriorMonth > 0 && km.sharesOutstanding > 0 && km.sharesShortPriorMonth > km.sharesOutstanding * 0.5) {
      warnings.push({ field: 'shortInterest', message: 'Short interest exceeds 50% of shares outstanding — data may be stale or incorrect', severity: 'warning' });
    }
    if (km.peRatio < 0 && km.earningsYield > 0) {
      warnings.push({ field: 'peRatio', message: 'Negative P/E ratio — company may be unprofitable', severity: 'info' });
    }
    if (km.marketCap > 0 && km.marketCap < 1e8) {
      warnings.push({ field: 'marketCap', message: 'Micro-cap stock — financial data may be less reliable', severity: 'info' });
    }
  }

  if (inc) {
    if (inc.revenue > 0 && inc.netIncome < 0 && Math.abs(inc.netIncome) > inc.revenue) {
      warnings.push({ field: 'netIncome', message: 'Net loss exceeds revenue — unusual loss magnitude', severity: 'warning' });
    }
    if (inc.revenue > 0 && inc.grossProfit < 0) {
      warnings.push({ field: 'grossProfit', message: 'Negative gross profit — may indicate data error', severity: 'warning' });
    }
  }

  if (bal) {
    if (bal.totalAssets > 0 && bal.totalLiabilities > bal.totalAssets) {
      warnings.push({ field: 'balanceSheet', message: 'Total liabilities exceed total assets — potential solvency concern', severity: 'warning' });
    }
  }

  if (cf) {
    if (cf.operatingCashFlow < 0 && inc && inc.netIncome > 0) {
      warnings.push({ field: 'cashFlow', message: 'Positive net income but negative operating cash flow', severity: 'info' });
    }
  }

  return warnings;
}

async function getOwnershipData(symbol) {
  if (symbol.startsWith('NSE:')) return null;
  try {
    return await yahooFinanceScraper.getOwnershipData(symbol);
  } catch { return null; }
}

async function getQuarterlyShareCountHistory(symbol) {
  if (symbol.startsWith('NSE:')) return null;
  try {
    return await edgarService.getQuarterlyShareCountHistory(symbol);
  } catch { return null; }
}

function clearCache() {
  financialCache.clear();
}

// Load persisted cache from DB on startup
financialCache.loadFromDb().then(count => {
  if (count > 0) console.log(`[FinancialReports] Restored ${count} cached entries from DB`);
}).catch(() => {});

module.exports = {
  getCompanyProfile,
  getQuote,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getKeyMetrics,
  getDividendHistory,
  getFinancialReport,
  getOwnershipData,
  getQuarterlyShareCountHistory,
  validateFinancialData,
  yahooFinanceScraper,
  ensureTTMValues,
  clearCache,
};
