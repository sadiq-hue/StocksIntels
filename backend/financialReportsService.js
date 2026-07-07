require('dotenv').config();
const marketService = require('./marketService');
const edgarService = require('./edgarService');
const yahooFinanceScraper = require('./yahooFinanceFinancialsScraper');
const { pool } = require('./db');

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

  // Fallback: Yahoo Finance chart API via proxy (for price)
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
  const totalAnnualDiv = divsValue.slice(0, 4).reduce((sum, d) => sum + Math.abs(d.dividend || d.adjDividend || 0), 0);
  const divYieldFromHistory = (price > 0 && totalAnnualDiv > 0) ? totalAnnualDiv / price : null;

  const enrichedKm = edgarKmHistory.map((km, idx) => {
    const incItem = edgarIncHistory[idx] || {};
    const eps = epsFromStats || km.netIncomePerShare ||
      (km.sharesOutstanding > 0 && incItem.netIncome ? incItem.netIncome / km.sharesOutstanding : 0);
    const pe = (price > 0 && eps > 0) ? price / eps : 0;
    const sharesOut = km.sharesOutstanding || 0;
    const computedMarketCap = marketCapFromQuote || (price > 0 && sharesOut > 0 ? price * sharesOut : 0);
    const divYield = divYieldFromHistory !== null ? divYieldFromHistory : (tds?.dividendYield || km.dividendYield || 0);
    return {
      ...km, marketCap: computedMarketCap,
      sharesOutstanding: sharesOut,
      peRatio: pe,
      priceToSalesRatio: (price > 0 && km.revenuePerShare > 0) ? price / km.revenuePerShare : km.priceToSalesRatio,
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

function toNum(v) { return v != null ? Number(v) : 0; }

async function buildLocalNseReport(symbol) {
  let ticker = symbol;
  if (ticker.startsWith('NSE:')) ticker = ticker.slice(4);
  try {
    const stockResult = await pool.query(
      'SELECT id, name, sector, currency FROM stocks WHERE UPPER(ticker) = $1 AND market = $2',
      [ticker, 'NSE']
    );
    if (stockResult.rows.length === 0) {
      console.log(`[buildLocalNseReport] No stock found for ${ticker} in stocks table`);
      return null;
    }
    const stock = stockResult.rows[0];
    console.log(`[buildLocalNseReport] Found stock: id=${stock.id}, name=${stock.name}, sector=${stock.sector}`);

    // Primary data source: financial_statements.parsed_data (populated by JSON upload / PDF parse)
    const stmtResult = await pool.query(
      `SELECT parsed_data, period_end_date FROM financial_statements
       WHERE stock_id = $1 AND status = 'completed' AND parsed_data IS NOT NULL
       ORDER BY period_end_date DESC NULLS LAST, uploaded_at DESC LIMIT 1`,
      [stock.id]
    );
    const statement = stmtResult.rows[0] || null;
    const parsed = statement?.parsed_data || null;
    console.log(`[buildLocalNseReport] financial_statements: rows=${stmtResult.rows.length}, hasParsed=${!!parsed}, keys=${parsed ? Object.keys(parsed).join(',') : 'none'}`);

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

    const now = new Date().toISOString();
    const periodDate = statement?.period_end_date || now;

    const incItem = parsed ? {
      date: periodDate, revenue: parsed.total_revenue, netIncome: parsed.net_income,
      grossProfit: parsed.total_revenue != null && parsed.cost_of_revenue != null ? parsed.total_revenue - parsed.cost_of_revenue : null,
      ebitda: null, eps: parsed.eps,
      costOfRevenue: parsed.cost_of_revenue, operatingExpenses: null,
      operatingIncome: parsed.operating_income,
    } : null;

    const balItem = parsed ? {
      date: periodDate, totalAssets: parsed.total_assets, totalLiabilities: parsed.total_liabilities,
      totalEquity: parsed.shareholders_equity, cashAndCashEquivalents: null,
      longTermDebt: null, totalDebt: parsed.total_debt,
      totalCurrentAssets: parsed.current_assets, totalCurrentLiabilities: parsed.current_liabilities,
      totalStockholdersEquity: parsed.shareholders_equity, retainedEarnings: parsed.retained_earnings,
    } : null;

    const cfItem = parsed?.cash_from_operations != null ? {
      date: periodDate, operatingCashFlow: parsed.cash_from_operations,
      freeCashFlow: null, capitalExpenditure: null, dividendsPaid: null, netChangeInCash: null,
    } : null;

    const f = fundamentals ? { market_cap: toNum(fundamentals.market_cap), pe_ratio: toNum(fundamentals.pe_ratio), pb_ratio: toNum(fundamentals.pb_ratio), dividend_yield: toNum(fundamentals.dividend_yield), roe: toNum(fundamentals.roe), revenue_growth: toNum(fundamentals.revenue_growth), eps_growth: toNum(fundamentals.eps_growth) } : null;

    const quote = await getQuote(symbol).catch(() => null);
    const price = quote?.price || 0;
    const sharesOut = parsed?.eps > 0 && parsed?.net_income > 0 ? Math.round(parsed.net_income / parsed.eps) : 0;

    const divYield = f?.dividend_yield || (parsed?.dividend_per_share && price > 0 ? parsed.dividend_per_share / price : 0);
    const mc = f?.market_cap || 0;
    const totalDebt = parsed?.total_debt || 0;
    const equity = parsed?.shareholders_equity || 0;
    const curAssets = parsed?.current_assets || 0;
    const curLiabs = parsed?.current_liabilities || 0;

    const kmItem = {
      date: periodDate, marketCap: mc,
      peRatio: f?.pe_ratio || 0, pbRatio: f?.pb_ratio || 0,
      dividendYield: divYield, dividendYieldPercentage: divYield * 100,
      roe: f?.roe || (parsed?.net_income && equity ? parsed.net_income / equity : 0),
      revenueGrowth: f?.revenue_growth || 0,
      epsGrowth: f?.eps_growth || parsed?.eps || 0, sharesOutstanding: sharesOut,
      earningsYield: f?.pe_ratio > 0 ? 1 / f.pe_ratio : 0,
      revenuePerShare: sharesOut > 0 && parsed?.total_revenue ? parsed.total_revenue / sharesOut : 0,
      netIncomePerShare: parsed?.eps || 0,
      priceToSalesRatio: mc > 0 && parsed?.total_revenue ? mc / parsed.total_revenue : 0,
      debtToEquity: totalDebt > 0 && equity > 0 ? totalDebt / equity : 0,
      currentRatio: curAssets > 0 && curLiabs > 0 ? curAssets / curLiabs : 0,
    };

    return {
      success: true, symbol: ticker, source: 'nse-upload',
      availableProviders: ['yahoo-finance'], lastUpdated: now,
      data: {
        profile: { symbol: ticker, companyName: stock.name, industry: stock.sector || 'N/A',
          sector: stock.sector || 'N/A', country: 'Kenya', website: '', description: '',
          ceo: 'N/A', employees: 0, marketCap: quote?.marketCap || mc,
          exchange: 'NSE', currency: stock.currency || 'KES', isEtf: false, image: '', lastUpdated: now },
        quote: quote || { symbol: ticker, price: 0, change: 0, changesPercentage: 0,
          dayLow: 0, dayHigh: 0, yearLow: 0, yearHigh: 0, avgVolume: 0, open: 0,
          marketCap: mc, volume: 0, previousClose: 0, sharesOutstanding: sharesOut,
          eps: parsed?.eps || 0, pe: f?.pe_ratio || 0, lastUpdated: now },
        incomeStatement: incItem, incomeStatementHistory: incItem ? [incItem] : [],
        balanceSheet: balItem, balanceSheetHistory: balItem ? [balItem] : [],
        cashFlowStatement: cfItem, cashFlowStatementHistory: cfItem ? [cfItem] : [],
        keyMetrics: kmItem, keyMetricsHistory: [kmItem],
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

async function getFinancialReport(symbol, period = 'annual', limit = 4, providerOverride = null) {
  try {
    const isUs = edgarService.isUsStock(symbol);
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
        const quote = await getQuote(symbol).catch(() => null);
        const price = quote?.price || 0;

        // Force USD for known US stocks (guard against wrong profile currency from API)
        if (isUs && yahooReport.data.profile) {
          yahooReport.data.profile.currency = 'USD';
          if (yahooReport.data.profile.exchange === 'NSE' || !yahooReport.data.profile.exchange) {
            yahooReport.data.profile.exchange = 'NASDAQ/NYSE';
          }
        }

        // Compute dividend yield from dividend history
        const divHist = yahooReport.data.dividendHistory || [];
        const totalAnnualDiv = divHist.slice(0, 4).reduce((sum, d) => sum + Math.abs(d.dividend || d.adjDividend || 0), 0);
        const divYieldFromHistory = (price > 0 && totalAnnualDiv > 0) ? totalAnnualDiv / price : null;

        // Enrich keyMetrics with real ratios from quote price + financial data
        const quoteMc = quote?.marketCap || 0;
        const incHist = yahooReport.data.incomeStatementHistory || [];
        const balHist = yahooReport.data.balanceSheetHistory || [];
        const enrichedKm = (yahooReport.data.keyMetricsHistory || []).map((km, idx) => {
          const inc = incHist[idx] || {};
          const bal = balHist[idx] || {};
          const netIncome = inc.netIncome || 0;
          const eps = inc.eps || 0;
          const sharesOut = (eps > 0 && netIncome > 0) ? netIncome / eps : 0;
          const mc = quoteMc || (price > 0 && sharesOut > 0 ? price * sharesOut : km.marketCap || 0);
          const revenue = inc.revenue || 0;
          const equity = bal.totalStockholdersEquity || bal.totalEquity || 0;
          const divYield = divYieldFromHistory !== null ? divYieldFromHistory : km.dividendYield || 0;
          return {
            ...km,
            marketCap: mc,
            peRatio: (price > 0 && eps > 0) ? price / eps : (netIncome > 0 && mc > 0 ? mc / netIncome : 0),
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

        return {
          ...yahooReport,
          symbol,
          source: 'yahoo-finance',
          availableProviders,
          data: {
            ...yahooReport.data,
            keyMetrics: enrichedKm[0] || null,
            keyMetricsHistory: enrichedKm,
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

    // SEC EDGAR — US stocks only
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
