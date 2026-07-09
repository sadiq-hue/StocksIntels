require('dotenv').config();
const marketService = require('./marketService');
const edgarService = require('./edgarService');
const yahooFinanceScraper = require('./yahooFinanceFinancialsScraper');
const { pool } = require('./db');
const PersistentCache = require('./cacheService');

const FINANCIALS_PROVIDER = process.env.FINANCIALS_PROVIDER || 'yahoo-finance';
const financialCache = new PersistentCache('finrep', 24 * 60 * 60 * 1000);

function cacheGet(key) {
  return financialCache.get(key);
}

function cacheSet(key, data) {
  return financialCache.set(key, data);
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

  // Fetch live quote and full stats in parallel for the most complete data
  const [marketQuote, tdResult] = await Promise.allSettled([
    marketService.getStockQuote(symbol).catch(() => null),
    symbol.startsWith('NSE:') ? Promise.resolve(null) : getTwelveDataStats(symbol),
  ]);
  const mq = marketQuote.status === 'fulfilled' ? marketQuote.value : null;
  const td = tdResult.status === 'fulfilled' ? tdResult.value : null;

  if (mq || td) {
    return cacheSet(cacheKey, {
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
    });
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
    const liveEps = quoteValue?.eps || tds?.eps || 0;
    const eps = liveEps || km.netIncomePerShare ||
      (km.sharesOutstanding > 0 && incItem.netIncome ? incItem.netIncome / km.sharesOutstanding : 0);
    const pe = quoteValue?.pe > 0 ? quoteValue.pe : ((price > 0 && eps > 0) ? price / eps : 0);
    const sharesOut = quoteValue?.sharesOutstanding || km.sharesOutstanding || 0;
    const computedMarketCap = marketCapFromQuote || (price > 0 && sharesOut > 0 ? price * sharesOut : 0);
    const divYield = quoteValue?.dividendYield || tds?.dividendYield || km.dividendYield || divYieldFromHistory || 0;
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

function computeMarketCap(price, netIncome, eps, sharesOutstanding) {
  if (!price || price <= 0) return 0;
  if (sharesOutstanding > 0) return Math.round(price * sharesOutstanding);
  if (netIncome && eps && (netIncome > 0 === eps > 0)) return Math.round(price * Math.abs(netIncome / eps));
  return 0;
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
      console.log(`[buildLocalNseReport] No stock found for ${ticker} in stocks table`);
      return null;
    }
    const stock = stockResult.rows[0];
    console.log(`[buildLocalNseReport] Found stock: id=${stock.id}, name=${stock.name}, sector=${stock.sector}`);

    // Primary data source: financial_statements.parsed_data (populated by JSON upload / PDF parse)
    const stmtResult = await pool.query(
      `SELECT DISTINCT ON (period_end_date) parsed_data, period_end_date FROM financial_statements
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
    const allParsed = statements.map(s => ({ parsed: normalizeParsed(s.parsed_data), periodDate: s.period_end_date }));
    const validParsed = allParsed.filter(p => p.parsed);
    const latest = validParsed[0] || {};
    const parsed = latest.parsed || null;
    const periodDate = latest.periodDate || now;
    console.log(`[buildLocalNseReport] financial_statements: rows=${stmtResult.rows.length}, valid=${validParsed.length}, latestKeys=${parsed ? Object.keys(parsed).join(',') : 'none'}`);

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

    // Build history arrays from all uploaded periods
    function buildIncItem(p, d) { return p ? { date: d, revenue: p.total_revenue, netIncome: p.net_income, netIncomeRatio: p.net_income > 0 && p.total_revenue > 0 ? p.net_income / p.total_revenue : 0, grossProfit: p.total_revenue != null && p.cost_of_revenue != null ? p.total_revenue - p.cost_of_revenue : null, ebitda: null, eps: p.eps, costOfRevenue: p.cost_of_revenue, operatingExpenses: null, operatingIncome: p.operating_income } : null; }
    function buildBalItem(p, d) { return p ? { date: d, totalAssets: p.total_assets, totalLiabilities: p.total_liabilities, totalEquity: p.shareholders_equity, cashAndCashEquivalents: p.cash_and_equivalents, longTermDebt: null, totalDebt: p.total_debt, totalCurrentAssets: p.current_assets, totalCurrentLiabilities: p.current_liabilities, totalStockholdersEquity: p.shareholders_equity, retainedEarnings: p.retained_earnings } : null; }
    function buildCfItem(p, d) { return p?.cash_from_operations != null ? { date: d, operatingCashFlow: p.cash_from_operations, freeCashFlow: null, capitalExpenditure: null, dividendsPaid: null, netChangeInCash: null } : null; }

    const incHistory = validParsed.map(v => buildIncItem(v.parsed, v.periodDate)).filter(Boolean);
    const balHistory = validParsed.map(v => buildBalItem(v.parsed, v.periodDate)).filter(Boolean);
    const cfHistory = validParsed.map(v => buildCfItem(v.parsed, v.periodDate)).filter(Boolean);

    // Latest single items for backward compatibility (KPI cards, summary)
    const incItem = incHistory[0] || null;
    const balItem = balHistory[0] || null;
    const cfItem = cfHistory[0] || null;

    const f = fundamentals ? { market_cap: toNum(fundamentals.market_cap), pe_ratio: toNum(fundamentals.pe_ratio), pb_ratio: toNum(fundamentals.pb_ratio), dividend_yield: toNum(fundamentals.dividend_yield), roe: toNum(fundamentals.roe), revenue_growth: toNum(fundamentals.revenue_growth), eps_growth: toNum(fundamentals.eps_growth) } : null;

    // NSE stocks need 'NSE:' prefix for marketService to trigger mystocks + AFX volume fallback
    const quoteSymbol = `NSE:${ticker}`;
    const quote = await getQuote(quoteSymbol).catch(() => null);
    const price = quote?.price || 0;
    const hasExactShares = parsed?.shares_outstanding != null && parsed.shares_outstanding > 0;
    const equityShares = (parsed?.shareholders_equity > 0 && parsed?.book_value_per_share > 0)
      ? Math.round(parsed.shareholders_equity / parsed.book_value_per_share) : 0;
    const incomeShares = (parsed?.net_income && parsed?.eps && (parsed.net_income > 0 === parsed.eps > 0))
      ? Math.round(Math.abs(parsed.net_income / parsed.eps)) : 0;
    const sharesOut = hasExactShares ? parsed.shares_outstanding : (equityShares || incomeShares);

    const divYield = f?.dividend_yield || (parsed?.dividend_per_share && price > 0 ? parsed.dividend_per_share / price : 0);
    const mc = quote?.marketCap
      || (hasExactShares && price > 0 ? Math.round(price * sharesOut) : 0)
      || (equityShares > 0 && price > 0 ? Math.round(price * equityShares) : 0)
      || f?.market_cap
      || (incomeShares > 0 && price > 0 ? Math.round(price * incomeShares) : 0)
      || 0;
    console.log(`[buildLocalNseReport] ${ticker}: quote.mc=${quote?.marketCap}, hasExactShares=${hasExactShares}, equityShares=${equityShares}, incomeShares=${incomeShares}, sharesOut=${sharesOut}, f.mc=${f?.market_cap}, price=${price}, mc=${mc}`);
    // Ensure changesPercentage is computed if quote has change but no percentage
    if (quote && !quote.changesPercentage && quote.change && price > 0) {
      quote.changesPercentage = (quote.change / (price - quote.change)) * 100;
      quote.changePercent = quote.changesPercentage;
    }
    const totalDebt = parsed?.total_debt || 0;
    const equity = parsed?.shareholders_equity || 0;
    const curAssets = parsed?.current_assets || 0;
    const curLiabs = parsed?.current_liabilities || 0;

    const bvps = parsed?.book_value_per_share || (equity > 0 && sharesOut > 0 ? equity / sharesOut : 0);

    function buildKmItem(p, d) {
      if (!p) return null;
      const pEquityShares = (p.shareholders_equity > 0 && p.book_value_per_share > 0)
        ? Math.round(p.shareholders_equity / p.book_value_per_share) : 0;
      const pIncomeShares = (p.net_income && p.eps && (p.net_income > 0 === p.eps > 0))
        ? Math.round(Math.abs(p.net_income / p.eps)) : 0;
      const pShares = p.shares_outstanding || pEquityShares || pIncomeShares;
      const pEquity = p.shareholders_equity || 0;
      const pBvps = p.book_value_per_share || (pEquity > 0 && pShares > 0 ? pEquity / pShares : 0);
      return {
        date: d, marketCap: mc,
        peRatio: price > 0 && p.eps > 0 ? price / p.eps : (f?.pe_ratio || 0),
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

    const metHistory = validParsed.map(v => buildKmItem(v.parsed, v.periodDate)).filter(Boolean);
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
          volume: 0, previousClose: 0, sharesOutstanding: sharesOut,
          eps: parsed?.eps || 0, pe: f?.pe_ratio || 0, lastUpdated: now }), marketCap: mc },
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
        const totalAnnualDiv = divHist.slice(0, 4).reduce((sum, d) => sum + Math.abs(d.dividend || d.adjDividend || 0), 0);
        const divYieldFromHistory = (price > 0 && totalAnnualDiv > 0) ? totalAnnualDiv / price : null;
        const incHist = yahooReport.data.incomeStatementHistory || [];
        const balHist = yahooReport.data.balanceSheetHistory || [];
        const enrichedKm = (yahooReport.data.keyMetricsHistory || []).map((km, idx) => {
          const inc = incHist[idx] || {};
          const bal = balHist[idx] || {};
          const netIncome = quote?.netIncomeTTM || inc.netIncome || 0;
          const eps = quote?.eps || inc.eps || 0;
          const sharesOut = quote?.sharesOutstanding || ((netIncome && eps && (netIncome > 0 === eps > 0)) ? Math.abs(netIncome / eps) : 0);
          const mc = quote?.marketCap || km.marketCap || computeMarketCap(price, netIncome, eps, sharesOut) || 0;
          const revenue = quote?.revenueTTM || inc.revenue || 0;
          const equity = bal.totalStockholdersEquity || bal.totalEquity || 0;
          const divYield = quote?.dividendYield || km.dividendYield || divYieldFromHistory || 0;
          return {
            ...km,
            marketCap: mc,
            peRatio: quote?.pe > 0 ? quote.pe : ((price > 0 && eps > 0) ? price / eps : (netIncome > 0 && mc > 0 ? mc / netIncome : 0)),
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
            quote: (() => {
              const q = quote || { symbol, price: 0, change: 0, changesPercentage: 0, marketCap: 0 };
              if (q.price > 0 && q.change && !q.changesPercentage) {
                q.changesPercentage = (q.change / (q.price - q.change)) * 100;
              }
              return { ...q, marketCap: enrichedKm[0]?.marketCap || q.marketCap || 0 };
            })(),
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
  yahooFinanceScraper,
  clearCache,
};
