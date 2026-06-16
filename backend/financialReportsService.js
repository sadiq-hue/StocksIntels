const { fmp, withRetry } = require('./apiClient');
require('dotenv').config();
const marketService = require('./marketService');
const edgarService = require('./edgarService');
const simfinService = require('./simfinService');
const yahooFinanceScraper = require('./yahooFinanceFinancialsScraper');

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const FINANCIALS_PROVIDER = process.env.FINANCIALS_PROVIDER || 'yahoo-finance';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const QUOTE_CACHE_TTL = 5 * 60 * 1000;
let fmpRateLimited = false;

const NSE_TO_FMP_SYMBOLS = {
  KUKZ:'KUKZ.NR',KAPC:'KAPC.NR',LIMT:'LIMT.NR',WTK:'WTK.NR',SASN:'SASN.NR',REA:'REA.NR',EGAD:'EGAD.NR',CGEN:'CGEN.NR',
  EQTY:'EQTY.NR',KCB:'KCB.NR',COOP:'COOP.NR',ABSA:'ABSA.NR',SBIC:'SBIC.NR',NCBA:'NCBA.NR',IMH:'IMH.NR',DTK:'DTK.NR',
  SCBK:'SCBK.NR',BKG:'BKG.NR',HFCK:'HFCK.NR',NMG:'NMG.NR',SGL:'SGL.NR',TPSE:'TPSE.NR',SCAN:'SCAN.NR',KQ:'KQ.NR',
  XPRS:'XPRS.NR',SMER:'SMER.NR',BAMB:'BAMB.NR',PORT:'PORT.NR',CRWN:'CRWN.NR',ARM:'ARM.NR',KPLC:'KPLC.NR',KEGN:'KEGN.NR',
  TOTL:'TOTL.NR',UMME:'UMME.NR',JUB:'JUB.NR',KNRE:'KNRE.NR',CIC:'CIC.NR',BRIT:'BRIT.NR',LBTY:'LBTY.NR',SLAM:'SLAM.NR',
  CTUM:'CTUM.NR',OCH:'OCH.NR',HAFR:'HAFR.NR',NSE:'NSE.NR',AMAC:'AMAC.NR',EABL:'EABL.NR',BAT:'BAT.NR',BOC:'BOC.NR',
  CARB:'CARB.NR',UNGA:'UNGA.NR',MSC:'MSC.NR',FTGH:'FTGH.NR',EVRD:'EVRD.NR',SCOM:'SCOM.NR',
  LKL:'LKL.NR',NBV:'NBV.NR',UCHM:'UCHM.NR',ALP:'ALP.NR',CABL:'CABL.NR',DCON:'DCON.NR',GLD:'GLD.NR',HBE:'HBE.NR',
  KPC:'KPC.NR',KURV:'KURV.NR',LAPR:'LAPR.NR',SKL:'SKL.NR',SMWF:'SMWF.NR',TCL:'TCL.NR'
};

const companyProfiles = {
  SCOM: {
    companyName: 'Safaricom PLC',
    industry: 'Telecommunications',
    sector: 'Technology',
    country: 'Kenya',
    website: 'https://www.safaricom.co.ke',
    description: 'Leading telecommunications company in Kenya providing mobile and data services.',
    ceo: 'Peter Ndegwa',
    employees: 5000,
    marketCap: 1100000000000,
    exchange: 'NSE',
    currency: 'KES'
  },
  EQTY: {
    companyName: 'Equity Group Holdings',
    industry: 'Banking',
    sector: 'Financial Services',
    country: 'Kenya',
    website: 'https://www.equitygroupholdings.com',
    description: 'Regional banking group providing financial services across East Africa.',
    ceo: 'Dr. James Mwangi',
    employees: 12000,
    marketCap: 350000000000,
    exchange: 'NSE',
    currency: 'KES'
  },
  KCB: {
    companyName: 'KCB Group PLC',
    industry: 'Banking',
    sector: 'Financial Services',
    country: 'Kenya',
    website: 'https://www.kcbbankgroup.com',
    description: 'One of the largest banking groups in the Great Lakes region of Africa.',
    ceo: 'Joshua Oigara',
    employees: 8500,
    marketCap: 280000000000,
    exchange: 'NSE',
    currency: 'KES'
  },
  EABL: {
    companyName: 'East African Breweries',
    industry: 'Beverages',
    sector: 'Consumer Defensive',
    country: 'Kenya',
    website: 'https://www.eabl.com',
    description: 'Leading brewer in East Africa with a portfolio of alcoholic and non-alcoholic beverages.',
    ceo: 'Peter Njoroge',
    employees: 3500,
    marketCap: 130000000000,
    exchange: 'NSE',
    currency: 'KES'
  }
};

const companyQuotes = {
  SCOM: { price: 28.5, change: 0.4, changesPercentage: 1.42, marketCap: 1140000000000, volume: 18500000, avgVolume: 16200000, open: 28.15, previousClose: 28.1, dayLow: 27.95, dayHigh: 28.65, yearLow: 13.2, yearHigh: 29.4, eps: 1.14, pe: 25.0, sharesOutstanding: 40000000000 },
  EQTY: { price: 52.75, change: 1.1, changesPercentage: 2.13, marketCap: 198000000000, volume: 8200000, avgVolume: 6400000, open: 51.9, previousClose: 51.65, dayLow: 51.55, dayHigh: 53.1, yearLow: 38.5, yearHigh: 53.1, eps: 10.08, pe: 5.23, sharesOutstanding: 3750000000 },
  KCB: { price: 45.2, change: 0.3, changesPercentage: 0.67, marketCap: 145000000000, volume: 5600000, avgVolume: 4100000, open: 44.95, previousClose: 44.9, dayLow: 44.4, dayHigh: 45.45, yearLow: 28.8, yearHigh: 46.0, eps: 7.48, pe: 6.04, sharesOutstanding: 3210000000 },
  EABL: { price: 175.25, change: 2.15, changesPercentage: 1.24, marketCap: 139000000000, volume: 1200000, avgVolume: 950000, open: 173.5, previousClose: 173.1, dayLow: 172.4, dayHigh: 176.0, yearLow: 128.5, yearHigh: 181.0, eps: 10.75, pe: 16.3, sharesOutstanding: 793000000 }
};

const baseRevenue = {
  SCOM: 280000000000,
  EQTY: 65000000000,
  KCB: 55000000000,
  EABL: 95000000000,
  BAMB: 28000000000,
  ABSA: 35000000000,
  SBIC: 28000000000,
  KPLC: 120000000000,
  NMG: 12000000000,
  CRAY: 8000000000
};

const baseAssets = {
  SCOM: 450000000000,
  EQTY: 380000000000,
  KCB: 320000000000,
  EABL: 85000000000,
  BAMB: 45000000000,
  ABSA: 180000000000,
  SBIC: 150000000000,
  KPLC: 200000000000,
  NMG: 18000000000,
  CRAY: 12000000000
};

const baseCashFlow = {
  SCOM: 45000000000,
  EQTY: 12000000000,
  KCB: 10000000000,
  EABL: 15000000000,
  BAMB: 4000000000,
  ABSA: 6000000000,
  SBIC: 5000000000,
  KPLC: 8000000000,
  NMG: 2000000000,
  CRAY: 1500000000
};

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

// Helper to validate and format date strings
function validateDateString(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string' || dateStr.trim() === '') {
    return null;
  }
  const date = new Date(dateStr);
  // Return ISO string if valid, otherwise null
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function getFmpSymbol(symbol) {
  return NSE_TO_FMP_SYMBOLS[symbol] || symbol;
}

async function fetchFmp(path, params = {}) {
  if (fmpRateLimited) return null;
  try {
    const response = await withRetry(
      () => fmp.get(`${FMP_BASE_URL}${path}`, {
        params: { apikey: FMP_API_KEY, ...params },
        timeout: 10000
      }),
      { label: `fmp${path}`, maxRetries: 2, baseDelay: 2000,
        shouldRetry: e => {
          if (e?.response?.status === 429) {
            fmpRateLimited = true;
            setTimeout(() => { fmpRateLimited = false; }, 120000);
            console.warn(`[FinancialReports] FMP rate limited (429). Pausing FMP calls for 2min.`);
            return true;
          }
          return !e?.response || e.response.status >= 500;
        }
      }
    );
    return response.data;
  } catch {
    return null;
  }
}

function asArray(data) {
  return Array.isArray(data) ? data : [];
}

function getSyntheticProfile(symbol) {
  const isGlobal = !NSE_TO_FMP_SYMBOLS[symbol];
  return {
    symbol,
    ...(companyProfiles[symbol] || {
      companyName: symbol,
      industry: 'N/A',
      sector: 'N/A',
      country: isGlobal ? 'USA' : 'Kenya',
      website: '',
      description: '',
      ceo: 'N/A',
      employees: 0,
      marketCap: 0,
      exchange: isGlobal ? 'NASDAQ/NYSE' : 'NSE',
      currency: isGlobal ? 'USD' : 'KES'
    }),
    isEtf: false,
    image: '',
    lastUpdated: new Date().toISOString()
  };
}

function getSyntheticQuote(symbol) {
  const isGlobal = !NSE_TO_FMP_SYMBOLS[symbol];
  return {
    symbol,
    currency: isGlobal ? 'USD' : 'KES',
    ...(companyQuotes[symbol] || {
      price: 0,
      change: 0,
      changesPercentage: 0,
      marketCap: 0,
      volume: 0,
      avgVolume: 0,
      open: 0,
      previousClose: 0,
      dayLow: 0,
      dayHigh: 0,
      yearLow: 0,
      yearHigh: 0,
      eps: 0,
      pe: 0,
      sharesOutstanding: 0
    }),
    lastUpdated: new Date().toISOString()
  };
}

function getSyntheticIncomeStatement(symbol, period = 'annual', limit = 4) {
  const revenueBase = baseRevenue[symbol] || 50000000000;
  return Array.from({ length: limit }, (_, index) => {
    const year = 2025 - index;
    const revenue = Math.round(revenueBase * (1 - index * 0.04));
    const grossProfit = Math.round(revenue * 0.42);
    const operatingIncome = Math.round(revenue * 0.21);
    const netIncome = Math.round(revenue * 0.13);

    return {
      date: `${year}-12-31`,
      period,
      revenue,
      costOfRevenue: revenue - grossProfit,
      grossProfit,
      grossProfitRatio: grossProfit / revenue,
      operatingExpenses: grossProfit - operatingIncome,
      operatingIncome,
      operatingIncomeRatio: operatingIncome / revenue,
      netIncome,
      netIncomeRatio: netIncome / revenue,
      ebitda: Math.round(operatingIncome * 1.18),
      incomeTaxExpense: Math.round(netIncome * 0.28),
      interestExpense: Math.round(revenue * 0.02),
      eps: Number((netIncome / 1000000000).toFixed(2)),
      epsdiluted: Number((netIncome / 1000000000).toFixed(2))
    };
  });
}

function getSyntheticBalanceSheet(symbol, period = 'annual', limit = 4) {
  const assetsBase = baseAssets[symbol] || 100000000000;
  return Array.from({ length: limit }, (_, index) => {
    const year = 2025 - index;
    const totalAssets = Math.round(assetsBase * (1 - index * 0.03));
    const totalLiabilities = Math.round(totalAssets * 0.56);
    const totalEquity = totalAssets - totalLiabilities;

    return {
      date: `${year}-12-31`,
      period,
      cashAndCashEquivalents: Math.round(totalAssets * 0.12),
      inventory: Math.round(totalAssets * 0.08),
      totalCurrentAssets: Math.round(totalAssets * 0.4),
      totalNonCurrentAssets: Math.round(totalAssets * 0.6),
      totalAssets,
      totalCurrentLiabilities: Math.round(totalLiabilities * 0.42),
      totalNonCurrentLiabilities: Math.round(totalLiabilities * 0.58),
      totalLiabilities,
      retainedEarnings: Math.round(totalEquity * 0.58),
      totalStockholdersEquity: totalEquity,
      totalEquity,
      totalDebt: Math.round(totalLiabilities * 0.78),
      netDebt: Math.round(totalLiabilities * 0.66)
    };
  });
}

function getSyntheticCashFlowStatement(symbol, period = 'annual', limit = 4) {
  const operatingBase = baseCashFlow[symbol] || 8000000000;
  return Array.from({ length: limit }, (_, index) => {
    const year = 2025 - index;
    const operatingCashFlow = Math.round(operatingBase * (1 - index * 0.05));
    const capitalExpenditure = Math.round(operatingCashFlow * -0.34);
    const freeCashFlow = operatingCashFlow + capitalExpenditure;

    return {
      date: `${year}-12-31`,
      period,
      netIncome: Math.round(operatingCashFlow * 0.78),
      operatingCashFlow,
      capitalExpenditure,
      freeCashFlow,
      netCashProvidedByOperatingActivities: operatingCashFlow,
      netCashUsedForInvestingActivites: Math.round(capitalExpenditure * 1.2),
      netCashUsedProvidedByFinancingActivities: Math.round(operatingCashFlow * -0.24),
      netChangeInCash: Math.round(operatingCashFlow * 0.12),
      cashAtEndOfPeriod: Math.round(operatingCashFlow * 1.95),
      cashAtBeginningOfPeriod: Math.round(operatingCashFlow * 1.75),
      dividendsPaid: Math.round(operatingCashFlow * -0.2)
    };
  });
}

function getSyntheticKeyMetrics(symbol, period = 'annual', limit = 4) {
  const quote = getSyntheticQuote(symbol);
  return Array.from({ length: limit }, (_, index) => {
    const year = 2025 - index;
    return {
      date: `${year}-12-31`,
      period,
      marketCap: Math.round(quote.marketCap * (1 - index * 0.03)),
      peRatio: Number((quote.pe || 8 + index).toFixed(2)),
      priceToSalesRatio: Number((1.8 + index * 0.1).toFixed(2)),
      pbRatio: Number((1.2 + index * 0.08).toFixed(2)),
      debtToEquity: Number((0.6 + index * 0.05).toFixed(2)),
      currentRatio: Number((1.25 - index * 0.03).toFixed(2)),
      dividendYield: Number((0.03 + index * 0.002).toFixed(4)),
      dividendYieldPercentage: Number((3 + index * 0.2).toFixed(2)),
      payoutRatio: Number((0.38 + index * 0.03).toFixed(2)),
      netDebtToEBITDA: Number((1.45 + index * 0.06).toFixed(2)),
      earningsYield: Number((0.08 - index * 0.004).toFixed(4)),
      freeCashFlowYield: Number((0.05 - index * 0.003).toFixed(4)),
      revenuePerShare: Number((18 - index * 0.7).toFixed(2)),
      netIncomePerShare: Number((3.4 - index * 0.18).toFixed(2)),
      operatingCashFlowPerShare: Number((4.2 - index * 0.2).toFixed(2)),
      freeCashFlowPerShare: Number((2.8 - index * 0.16).toFixed(2))
    };
  });
}

function getSyntheticDividendHistory(symbol, limit = 8) {
  return Array.from({ length: limit }, (_, index) => {
    const year = 2025 - index;
    const dividend = symbol === 'SCOM' ? 0.65 + index * 0.02 : 1.1 + index * 0.08;
    return {
      date: `${year}-06-30`,
      adjDividend: Number(dividend.toFixed(2)),
      dividend: Number(dividend.toFixed(2)),
      recordDate: `${year}-06-10`,
      paymentDate: `${year}-07-15`,
      declarationDate: `${year}-05-18`
    };
  });
}

async function getCompanyProfile(symbol) {
  const cacheKey = `${symbol}_profile`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Check if we have a live quote to grab basic info (Name, Currency, Exchange)
  const liveQuote = await getQuote(symbol);

  if (!FMP_API_KEY) {
    const baseProfile = getSyntheticProfile(symbol);
    if (liveQuote && liveQuote.provider !== 'synthetic') {
      baseProfile.companyName = liveQuote.company_name || baseProfile.companyName;
      baseProfile.currency = liveQuote.currency || baseProfile.currency;
      baseProfile.exchange = liveQuote.exchange || baseProfile.exchange;
    }
    return cacheSet(cacheKey, baseProfile);
  }

  try {
    const profileData = await fetchFmp('/profile', { symbol: getFmpSymbol(symbol) });
    const profile = Array.isArray(profileData) ? profileData[0] : profileData;
    if (profile && profile.symbol) {
      return cacheSet(cacheKey, {
        symbol,
        companyName: profile.companyName || symbol,
        industry: profile.industry || 'N/A',
        sector: profile.sector || 'N/A',
        country: profile.country === 'US' ? 'USA' : (profile.country || 'Kenya'),
        website: profile.website || '',
        description: profile.description || '',
        ceo: profile.ceo || 'N/A',
        employees: Number(profile.fullTimeEmployees) || 0,
        marketCap: profile.marketCap || 0,
        exchange: profile.exchange || 'NSE',
        currency: profile.currency || (NSE_TO_FMP_SYMBOLS[symbol] ? 'KES' : 'USD'),
        isEtf: profile.isEtf || false,
        image: profile.image || '',
        lastUpdated: new Date().toISOString()
      });
    }
  } catch (error) {
    if (error.response?.status === 403) {
      console.warn(`[FinancialReports] 403 Forbidden for ${symbol} profile. Using synthetic fallback.`);
    }
    console.error(`Error fetching profile for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticProfile(symbol));
}

async function getQuote(symbol) {
  const cacheKey = `${symbol}_quote`;
  const cached = cacheGet(cacheKey, QUOTE_CACHE_TTL);
  if (cached) return cached;

  try {
    const marketQuote = await marketService.getStockQuote(symbol);
    if (marketQuote && marketQuote.provider !== 'synthetic') {
      return cacheSet(cacheKey, marketQuote);
    }
  } catch (err) {
    console.warn(`[FinancialReports] Unified market quote fetch failed for ${symbol}`);
  }

  try {
    const quoteData = await fetchFmp('/quote', { symbol: getFmpSymbol(symbol) });
    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
    if (quote && quote.symbol) {
      return cacheSet(cacheKey, {
        symbol,
        price: Number(quote.price) || 0,
        currency: NSE_TO_FMP_SYMBOLS[symbol] ? 'KES' : 'USD',
        change: Number(quote.change) || 0,
        changesPercentage: Number(quote.changePercentage ?? quote.changesPercentage) || 0,
        dayLow: quote.dayLow || 0,
        dayHigh: quote.dayHigh || 0,
        yearLow: quote.yearLow || 0,
        yearHigh: quote.yearHigh || 0,
        marketCap: quote.marketCap || 0,
        volume: quote.volume || 0,
        avgVolume: quote.avgVolume || 0,
        open: quote.open || 0,
        previousClose: quote.previousClose || 0,
        eps: quote.eps || 0,
        pe: quote.pe || 0,
        sharesOutstanding: quote.sharesOutstanding || 0,
        lastUpdated: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`Error fetching quote for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, marketService.getSyntheticQuote(symbol));
}

async function getIncomeStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_income_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!FMP_API_KEY) {
    console.warn(`[FinancialReportsService] FMP_API_KEY is missing. Using synthetic income statement for ${symbol}.`);
    return cacheSet(cacheKey, getSyntheticIncomeStatement(symbol, period, limit));
  }

  try {
    const data = asArray(await fetchFmp('/income-statement', { symbol: getFmpSymbol(symbol), period, limit }));
    if (data.length > 0) {
      return cacheSet(cacheKey, data.map((stmt) => ({
        date: validateDateString(stmt.date),
        period,
        revenue: stmt.revenue || 0,
        costOfRevenue: stmt.costOfRevenue || 0,
        grossProfit: stmt.grossProfit || 0,
        grossProfitRatio: stmt.grossProfitRatio || 0,
        operatingExpenses: stmt.operatingExpenses || 0,
        operatingIncome: stmt.operatingIncome || 0,
        operatingIncomeRatio: stmt.operatingIncomeRatio || 0,
        netIncome: stmt.netIncome || 0,
        netIncomeRatio: stmt.netIncomeRatio || 0,
        ebitda: stmt.ebitda || 0,
        incomeTaxExpense: stmt.incomeTaxExpense || 0,
        interestExpense: stmt.interestExpense || 0,
        eps: stmt.eps || 0,
        epsdiluted: stmt.epsdiluted || 0
      })));
    }
  } catch (error) {
    console.error(`Error fetching income statement for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticIncomeStatement(symbol, period, limit));
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_balance_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!FMP_API_KEY) {
    console.warn(`[FinancialReportsService] FMP_API_KEY is missing. Using synthetic balance sheet for ${symbol}.`);
    return cacheSet(cacheKey, getSyntheticBalanceSheet(symbol, period, limit));
  }

  try {
    const data = asArray(await fetchFmp('/balance-sheet-statement', { symbol: getFmpSymbol(symbol), period, limit }));
    if (data.length > 0) {
      return cacheSet(cacheKey, data.map((stmt) => ({
        date: validateDateString(stmt.date),
        period,
        cashAndCashEquivalents: stmt.cashAndCashEquivalents || 0,
        inventory: stmt.inventory || 0,
        totalCurrentAssets: stmt.totalCurrentAssets || 0,
        totalNonCurrentAssets: stmt.totalNonCurrentAssets || 0,
        totalAssets: stmt.totalAssets || 0,
        totalCurrentLiabilities: stmt.totalCurrentLiabilities || 0,
        totalNonCurrentLiabilities: stmt.totalNonCurrentLiabilities || 0,
        totalLiabilities: stmt.totalLiabilities || 0,
        retainedEarnings: stmt.retainedEarnings || 0,
        totalStockholdersEquity: stmt.totalStockholdersEquity || 0,
        totalEquity: stmt.totalEquity || 0,
        totalDebt: stmt.totalDebt || 0,
        netDebt: stmt.netDebt || 0
      })));
    }
  } catch (error) {
    console.error(`Error fetching balance sheet for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticBalanceSheet(symbol, period, limit));
}

async function getCashFlowStatement(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_cashflow_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!FMP_API_KEY) {
    console.warn(`[FinancialReportsService] FMP_API_KEY is missing. Using synthetic cash flow statement for ${symbol}.`);
    return cacheSet(cacheKey, getSyntheticCashFlowStatement(symbol, period, limit));
  }

  try {
    const data = asArray(await fetchFmp('/cash-flow-statement', { symbol: getFmpSymbol(symbol), period, limit }));
    if (data.length > 0) {
      return cacheSet(cacheKey, data.map((stmt) => ({
        date: validateDateString(stmt.date),
        period,
        netIncome: stmt.netIncome || 0,
        operatingCashFlow: stmt.operatingCashFlow || 0,
        capitalExpenditure: stmt.capitalExpenditure || 0,
        freeCashFlow: stmt.freeCashFlow || 0,
        netCashProvidedByOperatingActivities: stmt.netCashProvidedByOperatingActivities || 0,
        netCashUsedForInvestingActivites: stmt.netCashUsedForInvestingActivites || 0,
        netCashUsedProvidedByFinancingActivities: stmt.netCashUsedProvidedByFinancingActivities || 0,
        netChangeInCash: stmt.netChangeInCash || 0,
        cashAtEndOfPeriod: stmt.cashAtEndOfPeriod || 0,
        cashAtBeginningOfPeriod: stmt.cashAtBeginningOfPeriod || 0,
        dividendsPaid: stmt.dividendsPaid || 0
      })));
    }
  } catch (error) {
    console.error(`Error fetching cash flow statement for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticCashFlowStatement(symbol, period, limit));
}

async function getKeyMetrics(symbol, period = 'annual', limit = 4) {
  const cacheKey = `${symbol}_metrics_${period}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!FMP_API_KEY) {
    console.warn(`[FinancialReportsService] FMP_API_KEY is missing. Using synthetic key metrics for ${symbol}.`);
    return cacheSet(cacheKey, getSyntheticKeyMetrics(symbol, period, limit));
  }

  try {
    const data = asArray(await fetchFmp('/key-metrics', { symbol: getFmpSymbol(symbol), period, limit }));
    if (data.length > 0) {
      return cacheSet(cacheKey, data.map((metric) => ({
        date: validateDateString(metric.date),
        period,
        marketCap: metric.marketCap || 0,
        peRatio: metric.peRatio || 0,
        priceToSalesRatio: metric.priceToSalesRatio || 0,
        pbRatio: metric.pbRatio || 0,
        debtToEquity: metric.debtToEquity || 0,
        currentRatio: metric.currentRatio || 0,
        dividendYield: metric.dividendYield || 0,
        dividendYieldPercentage: metric.dividendYieldPercentage || 0,
        payoutRatio: metric.payoutRatio || 0,
        netDebtToEBITDA: metric.netDebtToEBITDA || 0,
        earningsYield: metric.earningsYield || 0,
        freeCashFlowYield: metric.freeCashFlowYield || 0,
        revenuePerShare: metric.revenuePerShare || 0,
        netIncomePerShare: metric.netIncomePerShare || 0,
        operatingCashFlowPerShare: metric.operatingCashFlowPerShare || 0,
        freeCashFlowPerShare: metric.freeCashFlowPerShare || 0
      })));
    }
  } catch (error) {
    console.error(`Error fetching key metrics for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticKeyMetrics(symbol, period, limit));
}

async function getDividendHistory(symbol, limit = 8) {
  const cacheKey = `${symbol}_dividends_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!FMP_API_KEY) {
    console.warn(`[FinancialReportsService] FMP_API_KEY is missing. Using synthetic dividend history for ${symbol}.`);
    return cacheSet(cacheKey, getSyntheticDividendHistory(symbol, limit));
  }

  try {
    const data = asArray(await fetchFmp('/dividends', { symbol: getFmpSymbol(symbol) }));
    const history = data.slice(0, limit);
    if (history.length > 0) {
      return cacheSet(cacheKey, history.map((item) => ({
        date: validateDateString(item.date),
        adjDividend: item.adjDividend || 0,
        dividend: item.dividend || 0,
        recordDate: validateDateString(item.recordDate),
        paymentDate: validateDateString(item.paymentDate),
        declarationDate: validateDateString(item.declarationDate)
      })));
    }
  } catch (error) {
    console.error(`Error fetching dividends for ${symbol}:`, error.message);
  }

  return cacheSet(cacheKey, getSyntheticDividendHistory(symbol, limit));
}

async function getFinancialReport(symbol, period = 'annual', limit = 4, providerOverride = null) {
  try {
    const isUs = edgarService.isUsStock(symbol);
    const isNse = NSE_TO_FMP_SYMBOLS[symbol];
    const activeProvider = providerOverride || FINANCIALS_PROVIDER;

    // available providers for this symbol
    const availableProviders = ['fmp', 'yahoo-finance'];
    if (isUs) availableProviders.push('sec-edgar');
    if (!FMP_API_KEY) availableProviders.push('synthetic');

    // 1) Yahoo Finance — primary for all stocks
    if (activeProvider === 'yahoo-finance') {
      const yahooSymbol = NSE_TO_FMP_SYMBOLS[symbol] || symbol;
      const yahooReport = await yahooFinanceScraper.getFinancialReport(yahooSymbol, period, limit);
      if (yahooReport.success && (yahooReport.data.incomeStatementHistory?.length > 0 || yahooReport.data.profile)) {
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
              : (await getDividendHistory(symbol, Math.max(limit * 2, 8)).catch(() => [])),
          }
        };
      }
      console.warn(`[FinancialReports] Yahoo Finance returned no data for ${symbol}, falling back to FMP/synthetic`);
      // Fall through to FMP/synthetic below instead of erroring out
    }

    // 2) SEC EDGAR — US stocks only, no synthetic fallback
    if (activeProvider === 'sec-edgar' && isUs) {
      const edgarReport = await edgarService.getFinancialReportFromEdgar(symbol, period, limit);
      if (!edgarReport.success) {
        return { success: false, symbol, source: 'sec-edgar', error: edgarReport.error || 'SEC EDGAR data unavailable' };
      }
      const edgarIncHistory = edgarReport.data.incomeStatementHistory || [];
      if (edgarIncHistory.length === 0) {
        return { success: false, symbol, source: 'sec-edgar', error: 'SEC EDGAR returned no financial data for this symbol' };
      }

      const [quote, dividends] = await Promise.allSettled([
        getQuote(symbol),
        getDividendHistory(symbol, Math.max(limit * 2, 8)),
      ]);

      const edgarBalHistory = edgarReport.data.balanceSheetHistory || [];
      const edgarCfHistory = edgarReport.data.cashFlowStatementHistory || [];
      const edgarKmHistory = edgarReport.data.keyMetricsHistory || [];
      const edgarFilings = edgarReport.data.filings || [];

      const quoteValue = quote.status === 'fulfilled' ? quote.value : null;
      const price = quoteValue?.price || 0;
      const marketCap = quoteValue?.marketCap || 0;
      const enrichedKm = edgarKmHistory.map((km) => {
        const pe = (price > 0 && km.netIncomePerShare > 0) ? price / km.netIncomePerShare : 0;
        return {
          ...km, marketCap: marketCap || km.marketCap,
          peRatio: pe,
          priceToSalesRatio: (price > 0 && km.revenuePerShare > 0) ? price / km.revenuePerShare : km.priceToSalesRatio,
          earningsYield: pe > 0 ? 1 / pe : 0,
        };
      });
      if (enrichedKm.length > 0 && edgarBalHistory.length > 0 && marketCap > 0) {
        const latestBal = edgarBalHistory[0];
        const equity = latestBal.totalStockholdersEquity || latestBal.totalEquity || 0;
        if (equity > 0) enrichedKm[0].pbRatio = marketCap / equity;
      }

      return {
        success: true, symbol, source: 'sec-edgar', availableProviders,
        lastUpdated: new Date().toISOString(),
        data: {
          profile: edgarReport.data.profile || { symbol, companyName: symbol, exchange: 'NASDAQ', currency: 'USD' },
          quote: quoteValue || { symbol, price: 0, change: 0, changesPercentage: 0, marketCap: 0 },
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

    // FMP / synthetic fallback
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const tasks = [
      () => getCompanyProfile(symbol),                            // 0
      () => getQuote(symbol),                                     // 1
      () => getIncomeStatement(symbol, period, limit),            // 2
      () => getBalanceSheet(symbol, period, limit),               // 3
      () => getCashFlowStatement(symbol, period, limit),           // 4
      () => getKeyMetrics(symbol, period, limit),                 // 5
      () => getDividendHistory(symbol, Math.max(limit * 2, 8)),    // 6
    ];
    const results = [];
    for (const task of tasks) {
      try {
        results.push({ status: 'fulfilled', value: await task() });
      } catch (e) {
        results.push({ status: 'rejected', reason: e });
      }
      await delay(300);
    }

    const getValue = (index, fallback) => results[index].status === 'fulfilled' ? results[index].value : fallback;

    const incHistory = getValue(2, []);
    const balHistory = getValue(3, []);
    const cfHistory = getValue(4, []);
    const kmHistory = getValue(5, []);
    // If FMP returned no data and this is a global non-US stock, try Yahoo Finance as fallback
    let yahooFallbackUsed = false;
    if (incHistory.length === 0 && balHistory.length === 0 && !isUs && !isNse) {
      const yahooReport = await yahooFinanceScraper.getFinancialReport(symbol, period, limit).catch(() => null);
      if (yahooReport?.success && yahooReport.data.incomeStatementHistory?.length > 0) {
        yahooFallbackUsed = true;
        return {
          ...yahooReport,
          source: 'yahoo-finance',
          availableProviders,
          data: {
            ...yahooReport.data,
            quote: getValue(1, marketService.getSyntheticQuote(symbol)),
            dividendHistory: getValue(6, []),
          }
        };
      }
    }

    const report = {
      success: true,
      symbol,
      source: yahooFallbackUsed ? 'yahoo-finance' : 'synthetic',
      availableProviders,
      lastUpdated: new Date().toISOString(),
      data: {
        profile: getValue(0, getSyntheticProfile(symbol)),
        quote: getValue(1, marketService.getSyntheticQuote(symbol)),
        incomeStatement: incHistory[0] || null,
        incomeStatementHistory: incHistory,
        balanceSheet: balHistory[0] || null,
        balanceSheetHistory: balHistory,
        cashFlowStatement: cfHistory[0] || null,
        cashFlowStatementHistory: cfHistory,
        keyMetrics: kmHistory[0] || null,
        keyMetricsHistory: kmHistory,
        dividendHistory: getValue(6, []),
        filings: [],
      }
    };

    // Supplement with EDGAR filings for US stocks regardless of provider
    if (isUs) {
      const filings = await edgarService.getFilings(symbol, ['10-K', '10-Q'], 8).catch(() => []);
      if (filings.length > 0) report.data.filings = filings;
    }

    return report;
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

function isSimFinSupported(symbol) {
  return true;
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
  simfinService,
  yahooFinanceScraper,
  clearCache,
};
