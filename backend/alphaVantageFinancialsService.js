const axios = require('axios');
const { pool } = require('./db');
const PersistentCache = require('./cacheService');

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = 'https://www.alphavantage.co/query';

const cache = new PersistentCache('alphavantage_fin', 24 * 60 * 60 * 1000);

// Alpha Vantage uses dash for class shares (BRK-B not BRK.B)
function toAlphaSymbol(symbol) {
  return symbol.replace(/\./g, '-').split(':')[0];
}

// Shared rate limiter: 5 calls/min free tier → 12s minimum interval.
// Uses a mutex so concurrent calls serialize properly (race-free).
let lastCallTime = 0;
let rateLimitMutex = Promise.resolve();
const MIN_INTERVAL_MS = 12000;

async function rateLimitedFetch(params) {
  if (!API_KEY) throw new Error('ALPHA_VANTAGE_API_KEY not set');

  // Serialize through the mutex so parallel calls don't skip the delay
  let release;
  const wait = new Promise(r => { release = r; });
  const prev = rateLimitMutex;
  rateLimitMutex = rateLimitMutex.then(() => wait);
  await prev;

  try {
    const now = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    lastCallTime = Date.now();
    const resp = await axios.get(BASE_URL, {
      params: { ...params, apikey: API_KEY },
      timeout: 20000,
    });
    if (resp.data?.['Error Message']) throw new Error(resp.data['Error Message']);
    if (resp.data?.['Note']) {
      const note = resp.data['Note'];
      if (note.includes('limit') || note.includes('frequency')) throw new Error(note);
    }
    return resp.data;
  } finally {
    release();
  }
}

function isNseSymbol(symbol) {
  return symbol.startsWith('NSE:') || symbol.includes('.NR');
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
async function fetchOverview(symbol) {
  const cacheKey = `${symbol}_overview`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (isNseSymbol(symbol)) return null;

  try {
    const data = await rateLimitedFetch({ function: 'OVERVIEW', symbol: toAlphaSymbol(symbol) });
    if (!data || !data.Symbol) return null;
    const result = normalizeOverview(data, symbol);
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[AlphaVantage] OVERVIEW failed for ${symbol}:`, e.message);
    return null;
  }
}

function normalizeOverview(data, symbol) {
  const toNum = (v) => v != null && v !== 'None' ? Number(v) : 0;
  const toStr = (v) => v && v !== 'None' ? String(v) : '';
  const marketCap = toNum(data.MarketCapitalization);
  const price = toNum(data.AnalystTargetPrice);
  return {
    symbol: toStr(data.Symbol) || symbol,
    assetType: toStr(data.AssetType),
    name: toStr(data.Name),
    description: toStr(data.Description),
    cik: toStr(data.CIK),
    exchange: toStr(data.Exchange),
    currency: toStr(data.Currency) || 'USD',
    country: toStr(data.Country),
    sector: toStr(data.Sector),
    industry: toStr(data.Industry),
    address: toStr(data.Address),
    fiscalYearEnd: toStr(data.FiscalYearEnd),
    latestQuarter: toStr(data.LatestQuarter),
    marketCap,
    ebitda: toNum(data.EBITDA),
    peRatio: toNum(data.PERatio),
    pegRatio: toNum(data.PEGRatio),
    bookValue: toNum(data.BookValue),
    dividendPerShare: toNum(data.DividendPerShare),
    dividendYield: toNum(data.DividendYield),
    eps: toNum(data.EPS),
    revenuePerShareTTM: toNum(data.RevenuePerShareTTM),
    profitMargin: toNum(data.ProfitMargin),
    operatingMarginTTM: toNum(data.OperatingMarginTTM),
    returnOnAssetsTTM: toNum(data.ReturnOnAssetsTTM),
    returnOnEquityTTM: toNum(data.ReturnOnEquityTTM),
    revenueTTM: toNum(data.RevenueTTM),
    grossProfitTTM: toNum(data.GrossProfitTTM),
    dilutedEPSTTM: toNum(data.DilutedEPSTTM),
    quarterlyEarningsGrowthYOY: toNum(data.QuarterlyEarningsGrowthYOY),
    quarterlyRevenueGrowthYOY: toNum(data.QuarterlyRevenueGrowthYOY),
    analystTargetPrice: toNum(data.AnalystTargetPrice),
    analystRatingStrongBuy: toNum(data.AnalystRatingStrongBuy),
    analystRatingBuy: toNum(data.AnalystRatingBuy),
    analystRatingHold: toNum(data.AnalystRatingHold),
    analystRatingSell: toNum(data.AnalystRatingSell),
    analystRatingStrongSell: toNum(data.AnalystRatingStrongSell),
    sharesOutstanding: toNum(data.SharesOutstanding),
    forwardPE: toNum(data.ForwardPE),
    priceToSalesRatioTTM: toNum(data.PriceToSalesRatioTTM),
    dividendDate: toStr(data.DividendDate),
    exDividendDate: toStr(data.ExDividendDate),
    lastUpdated: new Date().toISOString(),
  };
}

// ─── INCOME STATEMENT ─────────────────────────────────────────────────────────
async function fetchIncomeStatement(symbol, period = 'annual') {
  const isAnnual = period !== 'quarterly';
  const cacheKey = `${symbol}_income_${period}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (isNseSymbol(symbol)) return [];

  try {
    const data = await rateLimitedFetch({ function: 'INCOME_STATEMENT',  symbol: toAlphaSymbol(symbol) });
    const reports = isAnnual ? data?.annualReports : data?.quarterlyReports;
    if (!reports || !Array.isArray(reports) || reports.length === 0) return [];
    const result = reports.map(r => normalizeIncomeItem(r));
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[AlphaVantage] INCOME_STATEMENT failed for ${symbol}:`, e.message);
    return [];
  }
}

function normalizeIncomeItem(r) {
  const toNum = (v) => v != null && v !== 'None' ? Number(v) : 0;
  const revenue = toNum(r.totalRevenue);
  const netIncome = toNum(r.netIncome);
  return {
    date: r.fiscalDateEnding,
    period: r.fiscalDateEnding ? 'annual' : '',
    revenue,
    costOfRevenue: toNum(r.costOfRevenue),
    grossProfit: toNum(r.grossProfit),
    grossProfitRatio: revenue > 0 ? toNum(r.grossProfit) / revenue : 0,
    operatingExpenses: toNum(r.operatingExpenses),
    operatingIncome: toNum(r.operatingIncome),
    operatingIncomeRatio: revenue > 0 ? toNum(r.operatingIncome) / revenue : 0,
    netIncome,
    netIncomeRatio: revenue > 0 ? netIncome / revenue : 0,
    ebitda: toNum(r.ebitda) || undefined,
    incomeTaxExpense: toNum(r.incomeTaxExpense),
    interestExpense: toNum(r.interestExpense),
    eps: toNum(r.eps) || undefined,
    epsdiluted: toNum(r.epsdiluted) || undefined,
    basicAverageShares: 0,
    dilutedAverageShares: 0,
    currency: r.reportedCurrency || 'USD',
  };
}

// ─── BALANCE SHEET ────────────────────────────────────────────────────────────
async function fetchBalanceSheet(symbol, period = 'annual') {
  const isAnnual = period !== 'quarterly';
  const cacheKey = `${symbol}_balance_${period}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (isNseSymbol(symbol)) return [];

  try {
    const data = await rateLimitedFetch({ function: 'BALANCE_SHEET',  symbol: toAlphaSymbol(symbol) });
    const reports = isAnnual ? data?.annualReports : data?.quarterlyReports;
    if (!reports || !Array.isArray(reports) || reports.length === 0) return [];
    const result = reports.map(r => normalizeBalanceItem(r));
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[AlphaVantage] BALANCE_SHEET failed for ${symbol}:`, e.message);
    return [];
  }
}

function normalizeBalanceItem(r) {
  const toNum = (v) => v != null && v !== 'None' ? Number(v) : 0;
  return {
    date: r.fiscalDateEnding,
    period: r.fiscalDateEnding ? 'annual' : '',
    cashAndCashEquivalents: toNum(r.cashAndCashEquivalentsAtCarryingValue) || toNum(r.cashAndShortTermInvestments),
    inventory: toNum(r.inventory),
    totalCurrentAssets: toNum(r.totalCurrentAssets),
    totalNonCurrentAssets: toNum(r.totalNonCurrentAssets) || (toNum(r.totalAssets) - toNum(r.totalCurrentAssets)) || undefined,
    totalAssets: toNum(r.totalAssets),
    totalCurrentLiabilities: toNum(r.totalCurrentLiabilities),
    totalNonCurrentLiabilities: toNum(r.totalNonCurrentLiabilities) || (toNum(r.totalLiabilities) - toNum(r.totalCurrentLiabilities)) || undefined,
    totalLiabilities: toNum(r.totalLiabilities),
    retainedEarnings: toNum(r.retainedEarnings),
    totalStockholdersEquity: toNum(r.totalShareholderEquity) || toNum(r.totalStockholdersEquity),
    totalEquity: toNum(r.totalShareholderEquity) || toNum(r.totalStockholdersEquity),
    totalDebt: toNum(r.longTermDebt) || toNum(r.shortTermDebt) || 0,
    netDebt: (toNum(r.longTermDebt) > 0 || toNum(r.shortTermDebt) > 0)
      ? (toNum(r.longTermDebt) + toNum(r.shortTermDebt) - toNum(r.cashAndCashEquivalentsAtCarryingValue) || 0)
      : undefined,
    treasuryStock: 0,
    additionalPaidInCapital: 0,
    shortTermDebt: toNum(r.shortTermDebt) || undefined,
    longTermDebt: toNum(r.longTermDebt) || undefined,
    currentRatio: toNum(r.totalCurrentLiabilities) > 0
      ? toNum(r.totalCurrentAssets) / toNum(r.totalCurrentLiabilities) : undefined,
    currency: r.reportedCurrency || 'USD',
  };
}

// ─── CASH FLOW ────────────────────────────────────────────────────────────────
async function fetchCashFlow(symbol, period = 'annual') {
  const isAnnual = period !== 'quarterly';
  const cacheKey = `${symbol}_cashflow_${period}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (isNseSymbol(symbol)) return [];

  try {
    const data = await rateLimitedFetch({ function: 'CASH_FLOW', symbol: toAlphaSymbol(symbol) });
    const reports = isAnnual ? data?.annualReports : data?.quarterlyReports;
    if (!reports || !Array.isArray(reports) || reports.length === 0) return [];
    const result = reports.map(r => normalizeCashFlowItem(r));
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[AlphaVantage] CASH_FLOW failed for ${symbol}:`, e.message);
    return [];
  }
}

function normalizeCashFlowItem(r) {
  const toNum = (v) => v != null && v !== 'None' ? Number(v) : 0;
  const operatingCf = toNum(r.operatingCashflow);
  const capex = toNum(r.capitalExpenditures);
  return {
    date: r.fiscalDateEnding,
    period: r.fiscalDateEnding ? 'annual' : '',
    netIncome: toNum(r.netIncome),
    operatingCashFlow: operatingCf,
    capitalExpenditure: capex || undefined,
    freeCashFlow: (operatingCf > 0 || capex < 0) ? operatingCf + capex : undefined,
    dividendsPaid: toNum(r.dividendPayout) || toNum(r.dividendPayoutCommonStock) || undefined,
    depreciationAndAmortization: toNum(r.depreciationDepletionAndAmortization) || undefined,
    netChangeInCash: toNum(r.changeInCashAndCashEquivalents) || undefined,
    cashFromFinancing: toNum(r.cashflowFromFinancing) || undefined,
    cashFromInvesting: toNum(r.cashflowFromInvestment) || undefined,
    repurchaseOfCapitalStock: toNum(r.commonStockRepurchased) || toNum(r.repurchaseOfCapitalStock) || 0,
    shareIssued: toNum(r.commonStockIssued) || toNum(r.shareIssued) || 0,
    netCommonStockIssuance: 0,
    stockBasedCompensation: toNum(r.stockBasedCompensation) || 0,
    currency: r.reportedCurrency || 'USD',
  };
}

// ─── COMPOSITE: build a full financial report shape ───────────────────────────
async function buildFinancialReport(symbol, period, limit) {
  const isAnnual = period !== 'quarterly';

  const [overview, incHist, balHist, cfHist] = await Promise.all([
    fetchOverview(symbol),
    fetchIncomeStatement(symbol, period),
    fetchBalanceSheet(symbol, period),
    fetchCashFlow(symbol, period),
  ]);

  if (!overview && incHist.length === 0 && balHist.length === 0 && cfHist.length === 0) {
    return null;
  }

  const truncatedInc = incHist.slice(0, limit);
  const truncatedBal = balHist.slice(0, limit);
  const truncatedCf = cfHist.slice(0, limit);
  const latestInc = truncatedInc[0] || null;
  const latestBal = truncatedBal[0] || null;
  const latestCf = truncatedCf[0] || null;

  const price = overview?.analystTargetPrice || 0;
  const marketCap = overview?.marketCap || 0;
  const eps = overview?.eps || overview?.dilutedEPSTTM || latestInc?.eps || 0;
  const peRatio = overview?.peRatio || (price > 0 && eps > 0 ? price / eps : 0);
  const revenue = overview?.revenueTTM || latestInc?.revenue || 0;
  const netIncome = overview?.revenueTTM ? (overview.profitMargin > 0 ? overview.revenueTTM * overview.profitMargin : 0) : latestInc?.netIncome || 0;
  const equity = latestBal?.totalStockholdersEquity || latestBal?.totalEquity || 0;

  const keyMetrics = {
    marketCap,
    peRatio,
    priceToSalesRatio: marketCap > 0 && revenue > 0 ? marketCap / revenue : 0,
    pbRatio: marketCap > 0 && equity > 0 ? marketCap / equity : 0,
    debtToEquity: equity > 0 ? (latestBal?.totalDebt || 0) / equity : 0,
    currentRatio: latestBal?.currentRatio || 0,
    dividendYield: overview?.dividendYield || 0,
    dividendYieldPercentage: (overview?.dividendYield || 0) * 100,
    earningsYield: peRatio > 0 ? 1 / peRatio : 0,
    returnOnEquity: overview?.returnOnEquityTTM || 0,
    returnOnAssets: overview?.returnOnAssetsTTM || 0,
    profitMargin: overview?.profitMargin || 0,
    operatingMargin: overview?.operatingMarginTTM || 0,
    revenueGrowth: overview?.quarterlyRevenueGrowthYOY || 0,
    earningsGrowth: overview?.quarterlyEarningsGrowthYOY || 0,
    sharesOutstanding: overview?.sharesOutstanding || 0,
    revenuePerShare: overview?.revenuePerShareTTM || (overview?.sharesOutstanding > 0 ? revenue / overview.sharesOutstanding : 0),
    netIncomePerShare: eps || (overview?.sharesOutstanding > 0 ? netIncome / overview.sharesOutstanding : 0),
    bookValue: overview?.bookValue || (equity > 0 && equity > 0 ? equity / (overview?.sharesOutstanding || 1) : 0),
    forwardPE: overview?.forwardPE || 0,
    targetPrice: overview?.analystTargetPrice || 0,
    dividendPerShare: overview?.dividendPerShare || 0,
  };

  const profile = overview ? {
    symbol: overview.symbol,
    companyName: overview.name,
    industry: overview.industry,
    sector: overview.sector,
    country: overview.country,
    website: '',
    description: overview.description,
    ceo: 'N/A',
    employees: 0,
    marketCap: overview.marketCap,
    exchange: overview.exchange,
    currency: overview.currency,
    cik: overview.cik,
  } : null;

  const quoteData = {
    symbol,
    price,
    marketCap,
    eps,
    pe: peRatio,
    dividendYield: overview?.dividendYield || 0,
    currency: overview?.currency || 'USD',
    exchange: overview?.exchange || '',
    source: 'alphavantage',
  };

  // Build keyMetricsHistory from combined data
  const keyMetricsHistory = truncatedInc.map((incItem, idx) => {
    const balItem = truncatedBal[idx] || {};
    const itemMc = marketCap || 0;
    const itemEps = incItem.eps || eps || 0;
    const itemRevenue = incItem.revenue || 0;
    const itemEquity = balItem.totalStockholdersEquity || balItem.totalEquity || 0;
    return {
      date: incItem.date,
      period: incItem.period,
      marketCap: itemMc,
      peRatio: itemEps > 0 && price > 0 ? price / itemEps : peRatio,
      pbRatio: itemEquity > 0 && price > 0 ? (marketCap || price * (overview?.sharesOutstanding || 1)) / itemEquity : 0,
      priceToSalesRatio: itemRevenue > 0 && marketCap > 0 ? marketCap / itemRevenue : 0,
      debtToEquity: itemEquity > 0 ? (balItem.totalDebt || 0) / itemEquity : 0,
      currentRatio: balItem.currentRatio || 0,
      dividendYield: overview?.dividendYield || 0,
      dividendYieldPercentage: (overview?.dividendYield || 0) * 100,
      earningsYield: itemEps > 0 && price > 0 ? itemEps / price : 0,
      returnOnEquity: overview?.returnOnEquityTTM || 0,
      returnOnAssets: overview?.returnOnAssetsTTM || 0,
      profitMargin: itemRevenue > 0 ? (incItem.netIncome || 0) / itemRevenue : 0,
      operatingMargin: itemRevenue > 0 ? (incItem.operatingIncome || 0) / itemRevenue : 0,
      revenuePerShare: (overview?.sharesOutstanding || 1) > 0 ? itemRevenue / (overview?.sharesOutstanding || 1) : 0,
      netIncomePerShare: itemEps || (itemRevenue > 0 && (overview?.sharesOutstanding || 1) > 0 ? (incItem.netIncome || 0) / (overview?.sharesOutstanding || 1) : 0),
      sharesOutstanding: overview?.sharesOutstanding || 0,
    };
  });

  return {
    profile,
    quote: quoteData,
    incomeStatement: latestInc,
    incomeStatementHistory: truncatedInc,
    balanceSheet: latestBal,
    balanceSheetHistory: truncatedBal,
    cashFlowStatement: latestCf,
    cashFlowStatementHistory: truncatedCf,
    keyMetrics,
    keyMetricsHistory,
    dividendHistory: overview?.dividendPerShare ? [{
      date: overview.dividendDate || overview.exDividendDate || '',
      dividend: overview.dividendPerShare,
      adjDividend: overview.dividendPerShare,
    }] : [],
    filings: [],
    overview,
  };
}

// ─── QUEUE FOR LAZY BACKFILL ─────────────────────────────────────────────────
let backfillQueue = [];
let backfillRunning = false;

function enqueueBackfill(symbols) {
  for (const s of symbols) {
    if (!backfillQueue.includes(s)) backfillQueue.push(s);
  }
  if (!backfillRunning) processBackfillQueue();
}

async function processBackfillQueue() {
  if (backfillRunning || backfillQueue.length === 0) return;
  backfillRunning = true;
  while (backfillQueue.length > 0) {
    const symbol = backfillQueue.shift();
    try {
      // Check if already cached
      const overviewKey = `${symbol}_overview`;
      const incKey = `${symbol}_income_annual`;
      if (!cache.get(overviewKey) || !cache.get(incKey)) {
        await buildFinancialReport(symbol, 'annual', 4);
        console.log(`[AlphaVantage] Backfilled ${symbol}`);
      }
    } catch (e) {
      console.error(`[AlphaVantage] Backfill failed for ${symbol}:`, e.message);
    }
  }
  backfillRunning = false;
}

function clearCache() {
  cache.clear();
}

// Load persisted cache from DB on startup
cache.loadFromDb().then(count => {
  if (count > 0) console.log(`[AlphaVantageFinancials] Restored ${count} cached entries from DB`);
}).catch(() => {});

module.exports = {
  fetchOverview,
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchCashFlow,
  buildFinancialReport,
  enqueueBackfill,
  clearCache,
};
