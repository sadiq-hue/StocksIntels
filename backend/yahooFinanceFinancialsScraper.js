const yahooFinanceCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheGet(key) {
  const hit = yahooFinanceCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) { yahooFinanceCache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  yahooFinanceCache.set(key, { data, ts: Date.now() });
  return data;
}

function getDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'string') return d.split('T')[0];
  return String(d);
}

function yearFromDate(d) {
  const s = getDateStr(d);
  if (!s) return null;
  const parts = s.split('-');
  return parts.length >= 1 ? parseInt(parts[0]) : null;
}

// Compute TTM (trailing 12 months) from quarterly items for each possible 4-quarter window
function computeTTM(items, valueKeys) {
  const withData = items
    .filter(i => i.periodType === '3M')
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return da.localeCompare(db);
    });

  const keySample = valueKeys[0];
  const populated = [];
  for (let i = withData.length - 1; i >= 0; i--) {
    if (withData[i][keySample] != null) {
      populated.unshift(withData[i]);
    }
  }
  // Also keep the single-most-recent if nothing is populated (partial data)
  const working = populated.length >= 4 ? populated : withData;

  if (working.length < 4) return [];

  const results = [];
  // Walk through all possible 4-quarter windows
  for (let start = 0; start + 3 < working.length; start++) {
    const window = working.slice(start, start + 4);
    const latestDate = getDateStr(window[3].date);
    const ttm = { date: latestDate, periodType: 'TTM' };
    for (const key of valueKeys) {
      const sum = window.reduce((acc, item) => {
        const val = item[key];
        return acc + (typeof val === 'number' ? val : 0);
      }, 0);
      ttm[key] = sum;
    }
    results.push(ttm);
  }
  return results.reverse(); // most recent first
}

async function getYahooFinanceClient() {
  const { default: YahooFinance } = await import('yahoo-finance2');
  return new YahooFinance({ suppressNotices: ['yahooSurvey'] });
}

async function fetchFundamentals(symbol, module = 'all') {
  const cacheKey = `yh_fundamentals_${module}_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const yf = await getYahooFinanceClient();
    const startDate = Math.floor(Date.now() / 1000) - 10 * 365 * 24 * 3600;
    const data = await yf.fundamentalsTimeSeries(symbol, {
      period1: startDate,
      module,
    });
    if (Array.isArray(data) && data.length > 0) {
      return cacheSet(cacheKey, data);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function fetchAllFundamentals(symbol) {
  // Try 'all' first (most comprehensive)
  const allData = await fetchFundamentals(symbol, 'all');
  if (allData && allData.some(item => item.totalRevenue != null || item.operatingRevenue != null)) {
    return allData;
  }
  // Fall back to 'financials' (income-specific)
  const finData = await fetchFundamentals(symbol, 'financials');
  if (finData && finData.length > 0) {
    return finData;
  }
  return allData || finData || null;
}

async function fetchQuoteSummary(symbol, modules) {
  const cacheKey = `yh_quoteSummary_${symbol}_${modules.join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let data = null;
  try {
    const yf = await getYahooFinanceClient();
    data = await yf.quoteSummary(symbol, { modules });
  } catch (err) {
    console.error(`[YahooFinanceScraper] quoteSummary failed for ${symbol}:`, err.message);
    data = null;
  }

  // If quoteSummary returned data but is missing key financial fields, supplement with quote()
  const fd = data?.financialData || {};
  const hasMarketData = fd.marketCap || fd.forwardPE || fd.dividendYield != null;
  if (!hasMarketData || !data) {
    try {
      const yf = await getYahooFinanceClient();
      const quote = await yf.quote(symbol);
      if (quote) {
        // quote() returns dividendYield as a percentage (0.35 = 0.35%),
        // convert to decimal for dividendYield to match quoteSummary convention
        const divYieldDecimal = quote.dividendYield != null ? quote.dividendYield / 100 : undefined;
        const existingProfile = data?.summaryProfile || {};
        const merged = {
          financialData: {
            marketCap: quote.marketCap,
            forwardPE: quote.forwardPE,
            dividendYield: divYieldDecimal,
            payoutRatio: quote.payoutRatio,
            priceToBook: quote.priceToBook,
            earningsPerShare: quote.epsTrailingTwelveMonths,
            financialCurrency: quote.currency,
          },
          defaultKeyStatistics: {
            marketCap: quote.marketCap,
            forwardPE: quote.forwardPE,
            sharesOutstanding: quote.sharesOutstanding,
          },
          summaryProfile: {
            longName: existingProfile.longName || quote.longName,
            shortName: existingProfile.shortName || quote.shortName,
            industry: existingProfile.industry || quote.industry,
            sector: existingProfile.sector || quote.sector,
            country: existingProfile.country,
            fullTimeEmployees: existingProfile.fullTimeEmployees,
            website: existingProfile.website || quote.website,
            longBusinessSummary: existingProfile.longBusinessSummary || quote.longBusinessSummary,
            companyOfficers: existingProfile.companyOfficers,
            exchange: quote.exchange,
            exchangeDisplay: quote.exchange,
          },
          price: { marketCap: quote.marketCap, currencySymbol: quote.currency, currency: quote.currency },
        };
        // Preserve any extra modules from the original response (e.g. assetProfile)
        if (data) {
          for (const key of Object.keys(data)) {
            if (!['financialData','defaultKeyStatistics','summaryProfile','price'].includes(key)) {
              merged[key] = data[key];
            }
          }
        }
        return cacheSet(cacheKey, merged);
      }
    } catch (fallbackErr) {
      console.error(`[YahooFinanceScraper] quote fallback also failed for ${symbol}:`, fallbackErr.message);
    }
  }

  if (data && hasMarketData) return cacheSet(cacheKey, data);
  return data || null;
}

async function getCompanyProfile(symbol) {
  const cacheKey = `yh_profile_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [qsResult, apResult] = await Promise.allSettled([
    fetchQuoteSummary(symbol, ['summaryProfile', 'financialData', 'defaultKeyStatistics']),
    fetchQuoteSummary(symbol, ['assetProfile']),
  ]);

  const qs = qsResult.status === 'fulfilled' ? qsResult.value : null;
  const apData = apResult.status === 'fulfilled' ? apResult.value : null;
  const ap = apData?.assetProfile || null;

  if (!qs && !ap) return null;

  const sp = qs?.summaryProfile || ap || {};
  const fd = qs?.financialData || {};
  const dk = qs?.defaultKeyStatistics || {};

  const officers = ap?.companyOfficers || [];
  const ceoOfficer = officers.find(o => o.title && /\bCEO\b|Chief Executive/i.test(o.title));
  const topOfficer = ceoOfficer || officers[0];
  const ceo = topOfficer?.name?.trim() || 'N/A';
  const ceoRole = topOfficer?.title || '';

  return cacheSet(cacheKey, {
    symbol,
    companyName: sp.longName || sp.shortName || symbol,
    industry: sp.industry || ap?.industry || '',
    sector: sp.sector || ap?.sector || '',
    country: sp.country || ap?.country || '',
    website: sp.website || ap?.website || '',
    description: (sp.longBusinessSummary || ap?.longBusinessSummary || '').slice(0, 500),
    ceo,
    ceoRole,
    employees: sp.fullTimeEmployees || ap?.fullTimeEmployees || 0,
    marketCap: fd.marketCap || dk.marketCap || 0,
    exchange: sp.exchange || sp.exchangeDisplay || '',
    currency: fd.financialCurrency || 'USD',
    image: '',
    lastUpdated: new Date().toISOString(),
  });
}

async function fetchAnnualIncomeHistory(symbol) {
  const cacheKey = `yh_annualInc_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const qs = await yf.quoteSummary(symbol, { modules: ['incomeStatementHistory'] });
    const hist = qs?.incomeStatementHistory?.incomeStatementHistory || [];
    return cacheSet(cacheKey, hist);
  } catch {
    return null;
  }
}

async function getIncomeStatement(symbol, period = 'annual', limit = 4) {
  if (period === 'quarter') {
    const allData = await fetchAllFundamentals(symbol);
    if (!allData) return null;
    return allData.filter(item => item.periodType === '3M' && item.totalRevenue != null)
      .slice(0, limit)
      .reverse()
      .map(item => formatIncomeItem(item, period));
  }

  // Annual: combine fiscal years from quoteSummary + trailing TTM
  const [annualData, fts] = await Promise.allSettled([
    fetchAnnualIncomeHistory(symbol),
    fetchAllFundamentals(symbol),
  ]);

  const items = [];

  // 1. Fiscal years from quoteSummary.incomeStatementHistory
  if (annualData.status === 'fulfilled' && annualData.value) {
    for (const item of annualData.value.slice(0, limit)) {
      if (!item.totalRevenue) continue;
      items.push(formatIncomeItem({
        date: item.endDate,
        totalRevenue: item.totalRevenue,
        costOfRevenue: item.costOfRevenue,
        grossProfit: item.grossProfit,
        operatingExpense: item.totalOperatingExpenses,
        operatingIncome: item.operatingIncome,
        netIncome: item.netIncomeApplicableToCommonShares ?? item.netIncome,
        netIncomeCommonStockholders: item.netIncomeFromContinuingOps ?? item.netIncome,
        ebit: item.ebit,
        interestExpense: item.interestExpense,
        taxProvision: item.incomeTaxExpense,
        researchAndDevelopment: item.researchDevelopment,
        sellingGeneralAndAdministration: item.sellingGeneralAdministrative,
        totalExpenses: item.totalOperatingExpenses,
        periodType: 'FY',
      }, 'fy'));
    }
  }

  // 2. Trailing TTM (most recent 4 quarters) — only if it's a different year than the latest FY
  if (fts.status === 'fulfilled' && fts.value) {
    const keys = [
      'totalRevenue', 'reconciledCostOfRevenue', 'costOfRevenue',
      'grossProfit', 'operatingExpense', 'operatingIncome',
      'netIncome', 'netIncomeCommonStockholders',
      'netIncomeFromContinuingAndDiscontinuedOperation',
      'EBITDA', 'EBIT', 'pretaxIncome', 'taxProvision',
      'researchAndDevelopment', 'sellingGeneralAndAdministration',
      'basicEPS', 'dilutedEPS', 'basicAverageShares', 'dilutedAverageShares',
      'totalExpenses', 'operatingRevenue', 'otherIncomeExpense',
      'interestExpense', 'reconciledDepreciation',
      'netIncomeContinuousOperations',
      'normalizedIncome', 'netIncomeIncludingNoncontrollingInterests',
      'totalOperatingIncomeAsReported', 'normalizedEBITDA',
    ];
    const quarterly = fts.value.filter(item =>
      item.periodType === '3M' && item.totalRevenue != null
    );
    if (quarterly.length >= 4) {
      const windows = computeTTM(quarterly, keys);
      if (windows.length > 0) {
        const ttmYear = (getDateStr(windows[0].date) || '').slice(0, 4);
        // Only add TTM if it differs from the latest fiscal year
        const latestFY = items.length > 0 ? (items[0].date || '').slice(0, 4) : '';
        if (ttmYear !== latestFY) {
          items.unshift(formatIncomeItem(windows[0], 'ttm'));
        }
      }
    }
  }

  if (items.length === 0) return null;

  // Sort by date descending
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return items;
}

function formatIncomeItem(item, period) {
  return {
    date: getDateStr(item.date),
    period,
    revenue: item.totalRevenue || item.operatingRevenue || 0,
    costOfRevenue: item.costOfRevenue || item.reconciledCostOfRevenue || 0,
    grossProfit: item.grossProfit || 0,
    grossProfitRatio: item.totalRevenue ? (item.grossProfit / item.totalRevenue) : 0,
    operatingExpenses: item.operatingExpense || 0,
    operatingIncome: item.operatingIncome || 0,
    operatingIncomeRatio: item.totalRevenue ? (item.operatingIncome / item.totalRevenue) : 0,
    netIncome: item.netIncome || item.netIncomeCommonStockholders || 0,
    netIncomeRatio: item.totalRevenue ? ((item.netIncome || item.netIncomeCommonStockholders || 0) / item.totalRevenue) : 0,
    ebitda: item.EBITDA || item.normalizedEBITDA || 0,
    incomeTaxExpense: item.taxProvision || 0,
    interestExpense: item.interestExpense || 0,
    eps: item.basicEPS || 0,
    epsdiluted: item.dilutedEPS || item.basicEPS || 0,
  };
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  const quarterly = allData
    .filter(item => item.periodType === '3M' && item.totalAssets != null)
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return db.localeCompare(da);
    });
  if (quarterly.length === 0) return null;

  if (period === 'quarter') {
    return quarterly.slice(0, limit).map(item => formatBalanceSheet(item, period));
  }

  // Annual: use quarterly snapshots (balance sheets are point-in-time)
  return quarterly.slice(0, limit).map(item => formatBalanceSheet(item, period));
}

function formatBalanceSheet(item, period) {
  const totalAssets = item.totalAssets || item.totalAssetsMm || 0;
  const totalLiabilities = item.totalLiabilitiesNetMinorityInterest || 0;
  const equity = item.commonStockEquity || item.totalEquityGrossMinorityInterest || item.stockholdersEquity || (totalAssets - totalLiabilities);
  const currentAssets = item.currentAssets || 0;
  const currentLiabilities = item.currentLiabilities || 0;
  const longTermDebt = item.longTermDebt || item.longTermDebtAndCapitalLeaseObligation || 0;
  const cash = item.cashAndCashEquivalents || item.cashCashEquivalentsAndShortTermInvestments || 0;
  const inventory = item.inventory || 0;
  const retainedEarnings = item.retainedEarnings || 0;

  return {
    date: getDateStr(item.date),
    period,
    cashAndCashEquivalents: cash,
    inventory,
    totalCurrentAssets: currentAssets,
    totalNonCurrentAssets: totalAssets - currentAssets,
    totalAssets,
    totalCurrentLiabilities: currentLiabilities,
    totalNonCurrentLiabilities: totalLiabilities - currentLiabilities,
    totalLiabilities,
    retainedEarnings,
    totalStockholdersEquity: equity,
    totalEquity: equity,
    totalDebt: longTermDebt,
    netDebt: longTermDebt - cash,
  };
}

async function getCashFlowStatement(symbol, period = 'annual', limit = 4) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  const keys = [
    'operatingCashFlow', 'freeCashFlow', 'capitalExpenditure',
    'cashDividendsPaid', 'financingCashFlow', 'investingCashFlow',
    'endCashPosition', 'beginningCashPosition',
    'netIncome', 'depreciationAndAmortization',
    'depreciationAmortizationDepletion',
    'stockBasedCompensation',
    'changeInWorkingCapital',
    'accountsReceivable', 'changeInReceivables', 'changeInAccountPayable',
    'changesInCash', 'cashFlowFromContinuingOperatingActivities',
    'cashFlowFromContinuingInvestingActivities',
    'cashFlowFromContinuingFinancingActivities',
    'repurchaseOfCapitalStock', 'commonStockPayments',
    'commonStockDividendPaid', 'netOtherFinancingCharges',
    'netIssuancePaymentsOfDebt',
    'netLongTermDebtIssuance', 'netShortTermDebtIssuance',
    'netCommonStockIssuance', 'shareIssued',
    'saleOfInvestment', 'purchaseOfInvestment',
    'purchaseOfPPE', 'netPPEPurchaseAndSale',
    'repaymentOfDebt', 'shortTermDebtPayments', 'longTermDebtPayments',
    'changeInPayablesAndAccruedExpense',
    'changeInInventory', 'changeInOtherCurrentAssets', 'changeInOtherCurrentLiabilities',
    'changeInPayable',
    'netDebt',
  ];

  if (period === 'quarter') {
    return allData.filter(item => item.periodType === '3M' && item.operatingCashFlow != null)
      .slice(0, limit)
      .map(item => formatCashFlow(item, period));
  }

  const quarterly = allData.filter(item =>
    item.periodType === '3M' && item.operatingCashFlow != null
  );
  if (quarterly.length === 0) return null;

  const ttmWindows = computeTTM(quarterly, keys).slice(0, limit);
  if (ttmWindows.length === 0) return null;

  return ttmWindows.map(item => formatCashFlow(item, 'ttm'));
}

function formatCashFlow(item, period) {
  const ocf = item.operatingCashFlow || 0;
  const capex = item.capitalExpenditure || item.purchaseOfPPE || 0;
  const netIncome = item.netIncome || 0;
  const dividendsPaid = item.cashDividendsPaid || item.commonStockDividendPaid || 0;
  const freeCashFlow = item.freeCashFlow || (ocf - Math.abs(capex));
  const depAmort = item.depreciationAndAmortization || item.depreciationAmortizationDepletion || 0;

  return {
    date: getDateStr(item.date),
    period,
    netIncome,
    operatingCashFlow: ocf,
    capitalExpenditure: Math.abs(capex) * -1,
    freeCashFlow,
    netCashProvidedByOperatingActivities: ocf,
    netCashUsedForInvestingActivites: (item.investingCashFlow || Math.abs(capex) * -1.2),
    netCashUsedProvidedByFinancingActivities: (item.financingCashFlow || dividendsPaid || 0),
    netChangeInCash: item.changesInCash || (ocf - Math.abs(capex) + (Math.abs(dividendsPaid))),
    cashAtEndOfPeriod: item.endCashPosition || 0,
    cashAtBeginningOfPeriod: item.beginningCashPosition || 0,
    dividendsPaid: Math.abs(dividendsPaid) * -1,
  };
}

async function getKeyMetrics(symbol, period = 'annual', limit = 4) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  const income = await getIncomeStatement(symbol, period, limit);
  const balance = await getBalanceSheet(symbol, period, limit);

  // Get current market data from quoteSummary
  let qs = await fetchQuoteSummary(symbol, ['financialData', 'defaultKeyStatistics']);
  let fd = qs?.financialData || {};
  let dk = qs?.defaultKeyStatistics || {};
  let currentMarketCap = fd.marketCap || dk.marketCap || 0;
  let forwardPE = fd.forwardPE || dk.forwardPE || 0;

  // Fallback: scan fundamentals data for marketCap/price fields
  if (!currentMarketCap && allData) {
    for (const item of allData) {
      if (item.marketCap) { currentMarketCap = item.marketCap; break; }
    }
  }

  // Build metrics from available data
  if (!income && !balance) return null;

  const count = Math.max(income?.length || 0, balance?.length || 0);
  const metricsArray = [];

  for (let i = 0; i < count; i++) {
    const incItem = income?.[i] || {};
    const balItem = balance?.[i] || {};
    if (!incItem.date && !balItem.date) continue;
    const yr = incItem.date || balItem.date || new Date().toISOString().split('T')[0];
    const revenue = incItem.revenue || 0;
    const netIncome = incItem.netIncome || 0;
    const totalAssets = balItem.totalAssets || 0;
    const totalLiabilities = balItem.totalLiabilities || 0;
    const equity = balItem.totalEquity || 0;
    const currentAssets = balItem.totalCurrentAssets || 0;
    const currentLiabilities = balItem.totalCurrentLiabilities || 0;
    const ocf = incItem.ebitda || 0;
    const eps = incItem.eps || 0;

    // Estimate marketCap for each historical period
    let cap = currentMarketCap;
    if (netIncome > 0 && eps > 0 && !cap) {
      const sharesOut = netIncome / eps;
      cap = sharesOut * (forwardPE || 15);
    }

    const divYieldDecimal = fd.dividendYield ?? 0;
    const divYieldPct = divYieldDecimal * 100;

    metricsArray.push({
      date: yr,
      period,
      marketCap: cap,
      peRatio: netIncome > 0 ? cap / netIncome : (forwardPE > 0 ? forwardPE : 0),
      priceToSalesRatio: revenue > 0 ? cap / revenue : 0,
      pbRatio: equity > 0 ? cap / equity : 0,
      debtToEquity: equity > 0 ? totalLiabilities / equity : 0,
      currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      dividendYield: divYieldDecimal,
      dividendYieldPercentage: divYieldPct,
      payoutRatio: fd.payoutRatio || 0,
      netDebtToEBITDA: ocf > 0 ? totalLiabilities / ocf : 0,
      earningsYield: netIncome > 0 ? netIncome / cap : 0,
      freeCashFlowYield: cap > 0 ? (incItem.ebitda || 0) / cap : 0,
      revenuePerShare: eps > 0 && netIncome > 0 ? revenue / (netIncome / eps) : 0,
      netIncomePerShare: eps || 0,
      operatingCashFlowPerShare: 0,
      freeCashFlowPerShare: 0,
    });
  }

  return metricsArray;
}

async function getDividendHistory(symbol, limit = 8) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return [];

  // Get shares outstanding from quote() for per-share calculation
  let sharesOut = 0;
  try {
    const yf = await getYahooFinanceClient();
    const q = await yf.quote(symbol);
    sharesOut = q.sharesOutstanding || 0;
  } catch {}

  // Extract actual dividend payments from fundamentals cashDividendsPaid
  const divPayments = allData
    .filter(i => i.periodType === '3M' && i.cashDividendsPaid != null && i.cashDividendsPaid < 0)
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return db.localeCompare(da);
    })
    .slice(0, limit)
    .map(i => ({
      date: getDateStr(i.date),
      adjDividend: sharesOut > 0 ? Math.abs(i.cashDividendsPaid) / sharesOut : 0,
      dividend: sharesOut > 0 ? Math.abs(i.cashDividendsPaid) / sharesOut : 0,
    }));

  return divPayments;
}

async function getFinancialReport(symbol, period = 'annual', limit = 4) {
  try {
    const [profile, income, balance, cf, divs] = await Promise.allSettled([
      getCompanyProfile(symbol),
      getIncomeStatement(symbol, period, limit),
      getBalanceSheet(symbol, period, limit),
      getCashFlowStatement(symbol, period, limit),
      getDividendHistory(symbol, Math.max(limit * 2, 8)),
    ]);

    const profileVal = profile.status === 'fulfilled' ? profile.value : null;
    const incomeHistory = income.status === 'fulfilled' ? income.value : null;
    const balanceHistory = balance.status === 'fulfilled' ? balance.value : null;
    const cfHistory = cf.status === 'fulfilled' ? cf.value : null;
    const dividendHistory = divs.status === 'fulfilled' ? divs.value : [];

    if (!incomeHistory && !balanceHistory && !cfHistory && !profileVal) {
      return { success: false, symbol, error: 'No financial data available from Yahoo Finance for this symbol' };
    }

    const km = await getKeyMetrics(symbol, period, limit);

    return {
      success: true,
      symbol,
      source: 'yahoo-finance',
      availableProviders: ['yahoo-finance', 'synthetic'],
      lastUpdated: new Date().toISOString(),
      data: {
        profile: profileVal,
        quote: null,
        incomeStatement: incomeHistory?.[0] || null,
        incomeStatementHistory: incomeHistory || [],
        balanceSheet: balanceHistory?.[0] || null,
        balanceSheetHistory: balanceHistory || [],
        cashFlowStatement: cfHistory?.[0] || null,
        cashFlowStatementHistory: cfHistory || [],
        keyMetrics: km?.[0] || null,
        keyMetricsHistory: km || [],
        dividendHistory,
        filings: [],
      },
    };
  } catch (error) {
    console.error(`[YahooFinanceScraper] Error generating report for ${symbol}:`, error.message);
    return { success: false, symbol, error: error.message };
  }
}

function clearCache() {
  yahooFinanceCache.clear();
}

module.exports = {
  getCompanyProfile,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getKeyMetrics,
  getDividendHistory,
  getFinancialReport,
  clearCache,
};
