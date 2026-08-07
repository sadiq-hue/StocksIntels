const axios = require('axios');
const yahooService = require('./yahooService');
const proxyService = require('./proxyService');
const PersistentCache = require('./cacheService');
const yahooFinanceCache = new PersistentCache('yahoo', 24 * 60 * 60 * 1000);

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

function cacheGet(key) {
  return yahooFinanceCache.get(key);
}

function flattenYahooObject(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.raw !== undefined) return data.raw;
  const result = Array.isArray(data) ? [] : {};
  for (const [key, val] of Object.entries(data)) {
    result[key] = flattenYahooObject(val);
  }
  return result;
}

function normalizeTxnDate(d) {
  if (!d) return '';
  if (d instanceof Date) return !Number.isNaN(d.getTime()) ? d.toISOString() : '';
  if (typeof d === 'number') {
    const dt = new Date(d);
    return !Number.isNaN(dt.getTime()) ? dt.toISOString() : '';
  }
  if (typeof d === 'object' && d.raw !== undefined) {
    return normalizeTxnDate(d.raw);
  }
  if (typeof d === 'string') return d.split('T')[0];
  return '';
}

function cacheSet(key, data) {
  return yahooFinanceCache.set(key, data);
}

function companyLogoUrl(website) {
  if (!website) return '';
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch { return ''; }
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



async function fetchPriceViaProxy(symbol) {
  return yahooService.fetchPriceViaProxy(symbol);
}

async function fetchPreMarketBatch(symbols) {
  return yahooService.fetchPreMarketBatch(symbols);
}

// Bump CACHE_VERSION when response shape changes to invalidate stale DB cache entries
const QUOTE_SUMMARY_CACHE_VERSION = 3;
async function fetchQuoteSummary(symbol, modules) {
  const cacheKey = `yh_qs_v${QUOTE_SUMMARY_CACHE_VERSION}_${symbol}_${modules.join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // 1. Try Twelve Data statistics first
  try {
    const tdModule = require('./twelveDataService');
    const tds = await tdModule.fetchStatistics(symbol);
    if (tds) {
      const data = twelveDataToQuoteSummary(tds, symbol);
      if (data) return cacheSet(cacheKey, data);
    }
  } catch {}

  // 2. Try consolidated Yahoo service (proxy pool → CORS relay → yahoo-finance2 → RapidAPI)
  try {
    const yahooData = await yahooService.fetchQuoteSummary(symbol, modules);
    if (yahooData) return cacheSet(cacheKey, yahooData);
  } catch {}

  // 3. Try yahoo-finance2 directly (bypasses yahooService circuit breaker)
  try {
    const yf = await createYf();
    const yf2qs = await yf.quoteSummary(symbol.replace(/\./g, '-'), { modules });
    if (yf2qs) {
      const normalized = flattenYahooObject(yf2qs);
      if (normalized?.financialData || normalized?.defaultKeyStatistics) {
        return cacheSet(cacheKey, normalized);
      }
    }
  } catch {}

  return null;
}

// Map Twelve Data statistics response to quoteSummary-like shape
function twelveDataToQuoteSummary(tds, symbol) {
  if (!tds) return null;
  return {
    financialData: {
      marketCap: tds.marketCap,
      trailingPE: tds.peRatio,
      forwardPE: tds.forwardPE,
      dividendYield: tds.dividendYield,
      payoutRatio: tds.payoutRatio,
      priceToBook: tds.pbRatio,
      earningsPerShare: tds.eps,
      financialCurrency: tds.currency || 'USD',
      totalRevenue: tds.revenueTTM,
      netIncome: tds.netIncomeTTM,
    },
    defaultKeyStatistics: {
      marketCap: tds.marketCap,
      forwardPE: tds.forwardPE,
      sharesOutstanding: tds.sharesOutstanding,
      floatShares: tds.floatShares || 0,
      enterpriseValue: tds.enterpriseValue,
      bookValue: tds.bookValuePerShare,
    },
    summaryProfile: {
      longName: tds.companyName || symbol,
      shortName: tds.companyName || symbol,
      exchange: tds.exchange || 'NASDAQ/NYSE',
      exchangeDisplay: tds.exchange || 'NASDAQ/NYSE',
    },
    price: { marketCap: tds.marketCap, currencySymbol: tds.currency || 'USD', currency: tds.currency || 'USD' },
  };
}

// Get fundamentals data from SEC EDGAR (income, balance, cash flow history)
const inflightFundamentals = new Map();
async function fetchAllFundamentals(symbol) {
  const cacheKey = `yh_fundamentals_v4_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (inflightFundamentals.has(symbol)) return inflightFundamentals.get(symbol);

  const promise = fetchAllFundamentalsInternal(symbol);
  inflightFundamentals.set(symbol, promise);
  try {
    return await promise;
  } finally {
    inflightFundamentals.delete(symbol);
  }
}

async function fetchAllFundamentalsInternal(symbol) {
  const cacheKey = `yh_fundamentals_v4_${symbol}`;

  // 1) SEC EDGAR (authoritative for US-domiciled stocks)
  try {
    const edgarService = require('./edgarService');
    const edgarReport = await edgarService.getFinancialReportFromEdgar(symbol, 'annual', 4);
    if (!edgarReport.success) return null;

    const incHist = edgarReport.data.incomeStatementHistory || [];
    const balHist = edgarReport.data.balanceSheetHistory || [];
    const cfHist = edgarReport.data.cashFlowStatementHistory || [];
    const kmHist = edgarReport.data.keyMetricsHistory || [];

    // Transform into array items matching yahoo-finance2 fundamentalsTimeSeries format
    const items = [];
    const maxLen = Math.max(incHist.length, balHist.length, cfHist.length);
    for (let i = 0; i < maxLen; i++) {
      const inc = incHist[i] || {};
      const bal = balHist[i] || {};
      const cf = cfHist[i] || {};
      const km = kmHist[i] || {};
      const date = inc.date || bal.date || cf.date || '';
      items.push({
        date,
        periodType: 'FY',
        totalRevenue: inc.revenue || inc.totalRevenue || 0,
        operatingRevenue: inc.revenue || inc.totalRevenue || 0,
        costOfRevenue: inc.costOfRevenue || 0,
        grossProfit: inc.grossProfit || 0,
        operatingIncome: inc.operatingIncome || inc.operatingProfit || 0,
        netIncome: inc.netIncome || 0,
        netIncomeCommonStockholders: inc.netIncome || 0,
        netIncomeApplicableToCommonShares: inc.netIncome || 0,
        EBITDA: inc.ebitda || 0,
        EBIT: inc.ebit || inc.ebitda || 0,
        pretaxIncome: inc.pretaxIncome || inc.incomeBeforeTax || 0,
        taxProvision: inc.incomeTaxExpense || 0,
        interestExpense: inc.interestExpense || 0,
        researchAndDevelopment: inc.researchAndDevelopment || inc.rAndD || 0,
        sellingGeneralAndAdministration: inc.sellingGeneralAndAdministrative || inc.sgaExpense || 0,
        totalExpenses: inc.totalExpenses || inc.operatingExpenses || 0,
        basicEPS: km.netIncomePerShare || inc.eps || (inc.netIncome && km.sharesOutstanding ? inc.netIncome / km.sharesOutstanding : 0),
        dilutedEPS: km.netIncomePerShare || inc.epsdiluted || inc.eps || 0,
        basicAverageShares: km.sharesOutstanding || 0,
        dilutedAverageShares: km.sharesOutstanding || 0,
        totalAssets: bal.totalAssets || 0,
        totalLiabilities: bal.totalLiabilities || 0,
        totalEquity: bal.totalStockholdersEquity || bal.totalEquity || 0,
        totalCurrentAssets: bal.totalCurrentAssets || bal.currentAssets || 0,
        totalCurrentLiabilities: bal.totalCurrentLiabilities || bal.currentLiabilities || 0,
        inventory: bal.inventory || 0,
        goodwill: bal.goodwill || 0,
        intangibleAssets: bal.intangibleAssets || 0,
        longTermDebt: bal.longTermDebt || 0,
        totalDebt: bal.totalDebt || 0,
        cashAndCashEquivalents: bal.cashAndCashEquivalents || bal.cash || 0,
        treasuryStock: bal.treasuryStock || 0,
        additionalPaidInCapital: bal.additionalPaidInCapital || 0,
        operatingCashFlow: cf.operatingCashFlow || 0,
        capitalExpenditure: cf.capitalExpenditure || 0,
        freeCashFlow: cf.freeCashFlow || 0,
        cashDividendsPaid: cf.dividendsPaid || 0,
        repurchaseOfCapitalStock: cf.repurchaseOfCapitalStock || 0,
        shareIssued: cf.shareIssued || 0,
        netCommonStockIssuance: cf.netCommonStockIssuance || 0,
        stockBasedCompensation: cf.stockBasedCompensation || 0,
        marketCap: km.marketCap || 0,
      });
    }
    if (items.length > 0) {
      const sample = items[0] || {};
      console.log(`[Fundamentals] ${symbol}: EDGAR items=${items.length}, ocf=${sample.operatingCashFlow || 0}, buyback=${sample.repurchaseOfCapitalStock || 0}, sbc=${sample.stockBasedCompensation || 0}, treasury=${sample.treasuryStock || 0}, apic=${sample.additionalPaidInCapital || 0}`);
      // Supplement EDGAR data with Yahoo balance-sheet fields when EDGAR has zeros
      const needsSupplement = items.some(it => !it.treasuryStock);
      if (needsSupplement) {
        try {
          const yf = await createYf();
          const periodEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const periodStart = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const fts = await Promise.race([
            yf.fundamentalsTimeSeries(symbol, { period1: periodStart, period2: periodEnd, module: 'balance-sheet' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('fundamentalsTimeSeries treasury timeout')), 10000)),
          ]);
          if (fts && fts.length > 0) {
            for (const item of items) {
              const match = fts.find(f => f.date && item.date && getDateStr(f.date) === item.date);
              if (match) {
                if (!item.treasuryStock && match.treasuryStock) item.treasuryStock = match.treasuryStock;
                if (!item.additionalPaidInCapital && match.additionalPaidInCapital) item.additionalPaidInCapital = match.additionalPaidInCapital;
              }
            }
          }
        } catch {}
      }
      return cacheSet(cacheKey, items);
    }
    console.log(`[Fundamentals] ${symbol}: EDGAR returned 0 items, falling through to Yahoo`);
  } catch (err) { console.warn(`[Fundamentals] ${symbol}: EDGAR error: ${err.message}`); }

  // 2) yahoo-finance2 fundamentalsTimeSeries (works for non-US stocks like GRAB, NIO, etc.)
  try {
    const yf = await createYf();
    const periodEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const periodStart = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const timeoutMs = 20000;
    const timeoutP = () => new Promise((_, reject) => setTimeout(() => reject(new Error('fundamentalsTimeSeries module timeout')), timeoutMs));
    const yfOpts = (module) => ({ period1: periodStart, period2: periodEnd, module });
    const [finItems, balItems, cfItems] = await Promise.all([
      Promise.race([yf.fundamentalsTimeSeries(symbol, yfOpts('financials')), timeoutP()]).catch(() => []),
      Promise.race([yf.fundamentalsTimeSeries(symbol, yfOpts('balance-sheet')), timeoutP()]).catch(() => []),
      Promise.race([yf.fundamentalsTimeSeries(symbol, yfOpts('cash-flow')), timeoutP()]).catch(() => []),
    ]);
    const allFundamentals = [...(finItems || []), ...(balItems || []), ...(cfItems || [])];
    if (!allFundamentals || allFundamentals.length === 0) return null;

    const mergedMap = new Map();
    for (const f of allFundamentals) {
      if (!f || !f.date) continue;
      const periodKey = f.periodType || 'FY';
      const key = `${getDateStr(f.date)}|${periodKey}`;
      mergedMap.set(key, { ...(mergedMap.get(key) || {}), ...f });
    }

    const items = [...mergedMap.values()]
      .filter(f => f.date)
      .sort((a, b) => (getDateStr(b.date) || '').localeCompare(getDateStr(a.date) || ''))
      .slice(0, 4)
      .map(f => ({
        date: getDateStr(f.date),
        periodType: f.periodType === '3M' ? '3M' : 'FY',
        totalRevenue: f.totalRevenue || 0,
        operatingRevenue: f.operatingRevenue || f.totalRevenue || 0,
        costOfRevenue: f.costOfRevenue || f.reconciledCostOfRevenue || 0,
        grossProfit: f.grossProfit || 0,
        operatingIncome: f.operatingIncome || f.totalOperatingIncomeAsReported || 0,
        netIncome: f.netIncome || 0,
        netIncomeCommonStockholders: f.netIncomeCommonStockholders || f.netIncome || 0,
        netIncomeApplicableToCommonShares: f.netIncomeApplicableToCommonShares || f.netIncome || 0,
        EBITDA: f.EBITDA || 0,
        EBIT: f.EBIT || f.EBITDA || 0,
        pretaxIncome: f.pretaxIncome || f.incomeBeforeTax || 0,
        taxProvision: f.taxProvision || f.incomeTaxExpense || 0,
        interestExpense: f.interestExpense || 0,
        researchAndDevelopment: f.researchAndDevelopment || f.rAndDExpense || 0,
        sellingGeneralAndAdministration: f.sellingGeneralAndAdministration || f.sgaExpense || 0,
        totalExpenses: f.totalExpenses || f.totalOperatingExpenses || 0,
        basicEPS: f.basicEPS || 0,
        dilutedEPS: f.dilutedEPS || f.basicEPS || 0,
        basicAverageShares: f.basicAverageShares || 0,
        dilutedAverageShares: f.dilutedAverageShares || f.basicAverageShares || 0,
        totalAssets: f.totalAssets || 0,
        totalLiabilities: f.totalLiabilities || f.totalLiabilitiesNetMinorityInterest || 0,
        totalEquity: f.totalEquity || f.commonStockEquity || f.stockholdersEquity || 0,
        totalCurrentAssets: f.totalCurrentAssets || f.currentAssets || 0,
        totalCurrentLiabilities: f.totalCurrentLiabilities || f.currentLiabilities || 0,
        inventory: f.inventory || 0,
        goodwill: f.goodwill || 0,
        intangibleAssets: f.intangibleAssets || 0,
        longTermDebt: f.longTermDebt || f.longTermDebtAndCapitalLeaseObligation || 0,
        totalDebt: f.totalDebt || f.longTermDebt || 0,
        cashAndCashEquivalents: f.cashAndCashEquivalents || f.cashCashEquivalentsAndShortTermInvestments || 0,
        operatingCashFlow: f.operatingCashFlow || 0,
        capitalExpenditure: f.capitalExpenditure || f.purchaseOfPPE || 0,
        freeCashFlow: f.freeCashFlow || 0,
        cashDividendsPaid: f.cashDividendsPaid || f.commonStockDividendPaid || 0,
        treasuryStock: f.treasuryStock || 0,
        additionalPaidInCapital: f.additionalPaidInCapital || 0,
        repurchaseOfCapitalStock: f.repurchaseOfCapitalStock || f.commonStockPayments || 0,
        shareIssued: f.shareIssued || 0,
        netCommonStockIssuance: f.netCommonStockIssuance || 0,
        stockBasedCompensation: f.stockBasedCompensation || 0,
        marketCap: f.marketCap || 0,
      }));
    if (items.length > 0) return cacheSet(cacheKey, items);
  } catch {}

  return null;
}

// Annual income history from SEC EDGAR
async function fetchAnnualIncomeHistory(symbol) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;
  // Filter to items that have totalRevenue
  const withRevenue = allData.filter(i => i.totalRevenue);
  // Map to the format expected by getIncomeStatement
  return withRevenue.map(i => ({
    endDate: i.date,
    totalRevenue: i.totalRevenue,
    costOfRevenue: i.costOfRevenue,
    grossProfit: i.grossProfit,
    totalOperatingExpenses: i.totalExpenses,
    operatingIncome: i.operatingIncome,
    netIncomeApplicableToCommonShares: i.netIncome,
    netIncome: i.netIncome,
    netIncomeFromContinuingOps: i.netIncome,
    ebit: i.EBIT,
    interestExpense: i.interestExpense,
    incomeTaxExpense: i.taxProvision,
    researchDevelopment: i.researchAndDevelopment,
    sellingGeneralAdministrative: i.sellingGeneralAndAdministration,
  }));
}

async function getCompanyProfile(symbol) {
  const cacheKey = `yh_profile_v2_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [qsResult, apResult] = await Promise.allSettled([
    fetchQuoteSummary(symbol, ['summaryProfile', 'financialData', 'defaultKeyStatistics']),
    fetchQuoteSummary(symbol, ['assetProfile']),
  ]);

  const qs = qsResult.status === 'fulfilled' ? qsResult.value : null;
  const apData = apResult.status === 'fulfilled' ? apResult.value : null;
  const ap = apData?.assetProfile || null;

  const sp = qs?.summaryProfile || ap || {};
  const fd = qs?.financialData || {};
  const dk = qs?.defaultKeyStatistics || {};

  const officers = ap?.companyOfficers || [];
  const ceoOfficer = officers.find(o => o.title && /\bCEO\b|Chief Executive/i.test(o.title));
  const topOfficer = ceoOfficer || officers[0];
  const ceo = topOfficer?.name?.trim() || 'N/A';
  const ceoRole = topOfficer?.title || '';
  const cik = ap?.cik || '';

  // Always try EDGAR to fill missing profile data
  let edgarProfile = null;
  try {
    const edgarService = require('./edgarService');
    if (edgarService.cikLookup(symbol)) {
      edgarProfile = await edgarService.getCompanyProfileFromEdgar(symbol);
    }
  } catch {}

  const profile = {
    symbol,
    companyName: sp.longName || sp.shortName || edgarProfile?.companyName || symbol,
    industry: sp.industry || ap?.industry || edgarProfile?.industry || '',
    sector: sp.sector || ap?.sector || edgarProfile?.sector || '',
    country: sp.country || ap?.country || edgarProfile?.country || '',
    website: sp.website || ap?.website || edgarProfile?.website || '',
    description: (sp.longBusinessSummary || ap?.longBusinessSummary || edgarProfile?.description || '').slice(0, 500),
    ceo: ceo !== 'N/A' ? ceo : (edgarProfile?.ceo || 'N/A'),
    ceoRole,
    employees: sp.fullTimeEmployees || ap?.fullTimeEmployees || edgarProfile?.employees || 0,
    marketCap: fd.marketCap || dk.marketCap || 0,
    exchange: sp.exchange || sp.exchangeDisplay || ap?.exchange || edgarProfile?.exchange || '',
    // Force USD for known US stocks (CIK lookup succeeded)
    currency: edgarProfile ? 'USD' : (fd.financialCurrency || 'USD'),
    cik: cik ? Number(cik) : (edgarProfile?.cik || ''),
    image: companyLogoUrl(sp.website || ap?.website || edgarProfile?.website || ''),
    lastUpdated: new Date().toISOString(),
  };

  return cacheSet(cacheKey, profile);
}

async function fetchAnnualIncomeHistory(symbol) {
  const cacheKey = `yh_annualInc_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const yf = await createYf();
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
  // incomeStatementHistoryQuarterly has almost no data since Nov 2024 (only totalRevenue/netIncome
  // are populated). Use fundamentalsTimeSeries instead — it returns full financial fields (EPS,
  // EBITDA, grossProfit, etc.) when the required module parameter is provided.
  const [annualData, fts, yf2Quarterly] = await Promise.allSettled([
    fetchAnnualIncomeHistory(symbol),
    fetchAllFundamentals(symbol),
    (async () => {
      try {
        const yf = await createYf();
        const periodEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const periodStart = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const fts = await Promise.race([
          yf.fundamentalsTimeSeries(symbol, {
            period1: periodStart,
            period2: periodEnd,
            module: 'financials',
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('fundamentalsTimeSeries income timeout')), 15000)),
        ]);
        return fts || null;
      } catch { return null; }
    })(),
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

  // 2. Trailing TTM (most recent 4 quarters)
  // NOTE: basicAverageShares/dilutedAverageShares are per-period metrics (NOT additive);
  // summing them across 4 quarters produces ~4× the real share count.
  const ttmKeys = [
    'totalRevenue', 'reconciledCostOfRevenue', 'costOfRevenue',
    'grossProfit', 'operatingExpense', 'operatingIncome',
    'netIncome', 'netIncomeCommonStockholders',
    'netIncomeFromContinuingAndDiscontinuedOperation',
    'EBITDA', 'EBIT', 'pretaxIncome', 'taxProvision',
    'researchAndDevelopment', 'sellingGeneralAndAdministration',
    'totalExpenses', 'operatingRevenue', 'otherIncomeExpense',
    'interestExpense', 'reconciledDepreciation',
    'netIncomeContinuousOperations',
    'normalizedIncome', 'netIncomeIncludingNoncontrollingInterests',
    'totalOperatingIncomeAsReported', 'normalizedEBITDA',
  ];
  let ttmAdded = false;
  // a) Try yahoo-finance2 fundamentalsTimeSeries (replaced incomeStatementHistoryQuarterly which
  //    has returned almost no financial fields since Nov 2024)
  if (yf2Quarterly.status === 'fulfilled' && yf2Quarterly.value) {
    // fundamentalsTimeSeries returns items in ascending date order; sort descending first
    // so slice(0,4) takes the 4 most recent quarters
    const quarterly = yf2Quarterly.value
      .filter(item => item.totalRevenue != null)
      .sort((a, b) => (getDateStr(b.date) || '').localeCompare(getDateStr(a.date) || ''))
      .slice(0, 4)
      .map(item => ({
        ...item,
        periodType: '3M',
        date: getDateStr(item.date),
        netIncome: item.netIncome ?? 0,
        netIncomeCommonStockholders: item.netIncomeCommonStockholders ?? item.netIncome ?? 0,
        basicEPS: item.basicEPS ?? 0,
        dilutedEPS: item.dilutedEPS ?? 0,
        operatingRevenue: item.operatingRevenue ?? item.totalRevenue,
        totalExpenses: item.totalExpenses ?? item.totalOperatingExpenses ?? 0,
      }));
    if (quarterly.length >= 4) {
      const windows = computeTTM(quarterly, ttmKeys);
      if (windows.length > 0) {
        const ttmItem = { ...windows[0] };
        const mostRecent = quarterly[quarterly.length - 1];
        ttmItem.basicAverageShares = mostRecent.basicAverageShares || mostRecent.dilutedAverageShares || 0;
        ttmItem.dilutedAverageShares = mostRecent.dilutedAverageShares || mostRecent.basicAverageShares || 0;
        items.unshift(formatIncomeItem(ttmItem, 'ttm'));
        ttmAdded = true;
      }
    }
  }
  // b) Fallback: EDGAR quarterly data
  if (!ttmAdded && fts.status === 'fulfilled' && fts.value) {
    const quarterly = fts.value.filter(item =>
      item.periodType === '3M' && item.totalRevenue != null
    );
    if (quarterly.length >= 4) {
      const windows = computeTTM(quarterly, ttmKeys);
      if (windows.length > 0) {
        const ttmItem = { ...windows[0] };
        const mostRecent = quarterly[quarterly.length - 1];
        ttmItem.basicAverageShares = mostRecent.basicAverageShares || mostRecent.dilutedAverageShares || 0;
        ttmItem.dilutedAverageShares = mostRecent.dilutedAverageShares || mostRecent.basicAverageShares || 0;
        items.unshift(formatIncomeItem(ttmItem, 'ttm'));
      }
    }
  }

  // 3. Fallback: use FY annual data from SEC EDGAR when yahoo-finance2 is unavailable
  if (items.length === 0 && fts.status === 'fulfilled' && fts.value) {
    const fyData = fts.value
      .filter(item => item.periodType === 'FY' && item.totalRevenue != null)
      .sort((a, b) => ((b.date || '')).localeCompare(a.date || ''))
      .slice(0, limit);
    if (fyData.length > 0) {
      fyData.forEach(item => items.push(formatIncomeItem(item, 'fy')));
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
    basicAverageShares: item.basicAverageShares || 0,
    dilutedAverageShares: item.dilutedAverageShares || item.basicAverageShares || 0,
  };
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  const items = allData
    .filter(item =>
      (item.periodType === '3M' || item.periodType === 'FY') &&
      item.totalAssets != null && item.totalAssets > 0
    )
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return db.localeCompare(da);
    });
  if (items.length === 0) return null;

  return items.slice(0, limit).map(item => formatBalanceSheet(item, period));
}

function formatBalanceSheet(item, period) {
  const totalAssets = item.totalAssets || item.totalAssetsMm || 0;
  const totalLiabilities = item.totalLiabilitiesNetMinorityInterest || item.totalLiabilities || 0;
  const equity = item.commonStockEquity || item.totalEquityGrossMinorityInterest || item.stockholdersEquity || item.totalEquity || item.totalStockholdersEquity || (totalAssets - totalLiabilities);
  const currentAssets = item.currentAssets || item.totalCurrentAssets || 0;
  const currentLiabilities = item.currentLiabilities || item.totalCurrentLiabilities || 0;
  const longTermDebt = item.longTermDebt || item.longTermDebtAndCapitalLeaseObligation || 0;
  const cash = item.cashAndCashEquivalents || item.cashCashEquivalentsAndShortTermInvestments || 0;
  const inventory = item.inventory || 0;
  const retainedEarnings = item.retainedEarnings || 0;
  const treasuryStock = item.treasuryStock || item.treasuryShares || 0;
  const additionalPaidInCapital = item.additionalPaidInCapital || item.otherPaidInCapital || 0;

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
    treasuryStock,
    additionalPaidInCapital,
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

  const hasQuarterly = allData.some(item => item.periodType === '3M' && item.operatingCashFlow != null && item.operatingCashFlow !== 0);
  const items = allData
    .filter(item => (hasQuarterly ? item.periodType === '3M' : true) && item.operatingCashFlow != null && item.operatingCashFlow !== 0)
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return db.localeCompare(da);
    });
  if (items.length === 0) return null;

  if (period === 'quarter') {
    return items.slice(0, limit).map(item => formatCashFlow(item, period));
  }

  // For annual: prefer TTM from quarterly data when available, else use FY items directly
  if (hasQuarterly) {
    const ttmWindows = computeTTM(items, keys).slice(0, limit);
    if (ttmWindows.length > 0) return ttmWindows.map(item => formatCashFlow(item, 'ttm'));
  }

  return items.slice(0, limit).map(item => formatCashFlow(item, 'fy'));
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
    repurchaseOfCapitalStock: Math.abs(item.repurchaseOfCapitalStock || 0),
    shareIssued: item.shareIssued || 0,
    netCommonStockIssuance: item.netCommonStockIssuance || 0,
    stockBasedCompensation: item.stockBasedCompensation || 0,
  };
}

async function getKeyMetrics(symbol, period = 'annual', limit = 4, cashFlowHistory = null) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  const income = await getIncomeStatement(symbol, period, limit);
  const balance = await getBalanceSheet(symbol, period, limit);
  if (!cashFlowHistory) {
    cashFlowHistory = await getCashFlowStatement(symbol, period, limit);
  }

  // Get current market data from quoteSummary
  let qs = await fetchQuoteSummary(symbol, ['financialData', 'defaultKeyStatistics']);
  let fd = qs?.financialData || {};
  let dk = qs?.defaultKeyStatistics || {};
  let currentMarketCap = fd.marketCap || dk.marketCap || 0;
  let forwardPE = fd.forwardPE || dk.forwardPE || 0;
  let trailingPE = fd.trailingPE || dk.trailingPE || 0;
  const floatShares = typeof dk.floatShares === 'number' ? dk.floatShares : 0;
  const sharesOutstanding = typeof dk.sharesOutstanding === 'number' ? dk.sharesOutstanding : 0;
  const sharesShortPriorMonth = (typeof dk.sharesShortPriorMonth === 'number' && dk.sharesShortPriorMonth > 0) ? dk.sharesShortPriorMonth : (typeof dk.sharesShort === 'number' && dk.sharesShort > 0 ? dk.sharesShort : 0);

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
    const cfItem = cashFlowHistory?.[i] || {};
    if (!incItem.date && !balItem.date) continue;
    const yr = incItem.date || balItem.date || new Date().toISOString().split('T')[0];
    const revenue = incItem.revenue || 0;
    const netIncome = incItem.netIncome || 0;
    const totalAssets = balItem.totalAssets || 0;
    const totalLiabilities = balItem.totalLiabilities || 0;
    const equity = balItem.totalEquity || 0;
    const currentAssets = balItem.totalCurrentAssets || 0;
    const currentLiabilities = balItem.totalCurrentLiabilities || 0;
    const longTermDebt = balItem.longTermDebt || balItem.totalDebt || 0;
    const cash = balItem.cashAndCashEquivalents || 0;
    const netDebt = Math.max(0, longTermDebt - cash);
    const ocf = cfItem.operatingCashFlow || incItem.ebitda || 0;
    const eps = incItem.eps || 0;
    const freeCashFlow = cfItem.freeCashFlow || 0;
    const ebitda = incItem.ebitda || 0;

    // Use real marketCap when available; don't estimate
    const cap = currentMarketCap;

    const divYieldDecimal = fd.dividendYield ?? 0;
    const divYieldPct = divYieldDecimal * 100;

    const isCurrent = metricsArray.length === 0;
    metricsArray.push({
      date: yr,
      period,
      marketCap: cap,
      peRatio: isCurrent && trailingPE > 0 ? trailingPE : (netIncome > 0 ? cap / netIncome : (forwardPE > 0 ? forwardPE : 0)),
      priceToSalesRatio: revenue > 0 ? cap / revenue : 0,
      pbRatio: equity > 0 ? cap / equity : 0,
      debtToEquity: equity > 0 ? totalLiabilities / equity : 0,
      currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      dividendYield: divYieldDecimal,
      dividendYieldPercentage: divYieldPct,
      payoutRatio: fd.payoutRatio || 0,
      netDebtToEBITDA: ebitda > 0 ? netDebt / ebitda : 0,
      earningsYield: (netIncome > 0 && cap > 0) ? netIncome / cap : 0,
      freeCashFlowYield: cap > 0 ? freeCashFlow / cap : 0,
      revenuePerShare: eps > 0 && netIncome > 0 ? revenue / (netIncome / eps) : 0,
      netIncomePerShare: eps || 0,
      operatingCashFlowPerShare: isCurrent && ocf > 0 && sharesOutstanding > 0 ? ocf / sharesOutstanding : 0,
      freeCashFlowPerShare: isCurrent && freeCashFlow > 0 && sharesOutstanding > 0 ? freeCashFlow / sharesOutstanding : 0,
      sharesOutstanding: isCurrent ? sharesOutstanding : 0,
      floatShares: isCurrent ? floatShares : 0,
      sharesShortPriorMonth: isCurrent ? sharesShortPriorMonth : 0,
    });
  }

  return metricsArray;
}

async function getOwnershipData(symbol) {
  const cacheKey = `yh_ownership_v5_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[Ownership] Cache hit for ${symbol}: inst=${cached.institutionalHolders?.length || 0}, insiders=${cached.insiderTransactions?.length || 0}, short=${cached.shortInterest || 0}`);
    return cached;
  }

  try {
    // Bypass fetchQuoteSummary (Twelve Data doesn't have institutional/insider data)
    let qs = null;
    for (let attempt = 0; attempt < 2 && !qs; attempt++) {
      try {
        console.log(`[Ownership] Attempt ${attempt + 1}/2 calling yahoo-finance2 for ${symbol}...`);
        const yf = await createYf();
        const raw = await yf.quoteSummary(symbol.replace(/\./g, '-'), {
          modules: ['institutionOwnership', 'insiderTransactions', 'defaultKeyStatistics'],
        });
        qs = raw ? flattenYahooObject(raw) : null;
        if (qs) {
          const instCount = qs.institutionOwnership?.institutionOwnership?.length || 0;
          const dkKeys = Object.keys(qs.defaultKeyStatistics || {});
          console.log(`[Ownership] ${symbol} yahoo-finance2 success: inst=${instCount}, dk_keys=${dkKeys.length}`);
        } else {
          console.warn(`[Ownership] ${symbol} yahoo-finance2 returned null/empty`);
        }
      } catch (err) {
        console.warn(`[Ownership] Attempt ${attempt + 1}/2 for ${symbol}: ${err.message || err.code}`);
        if (!qs && attempt < 1) await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (!qs) {
      try {
        console.log(`[Ownership] Trying yahooService fallback for ${symbol}...`);
        qs = await yahooService.fetchQuoteSummary(symbol, ['institutionOwnership', 'insiderTransactions', 'defaultKeyStatistics']);
        if (!qs) console.warn(`[Ownership] yahooService fallback returned null for ${symbol}`);
      } catch (err) {
        console.warn(`[Ownership] yahooService fallback error for ${symbol}: ${err.message || err.code}`);
      }
    }
    if (!qs) { console.warn(`[Ownership] No data available for ${symbol} from any source`); return null; }

    const instRaw = qs.institutionOwnership?.ownershipList || qs.institutionOwnership?.institutionOwnership || [];
    const insidersRaw = qs.insiderTransactions?.transactions || qs.insiderTransactions?.insiderTransactions || [];
    const dk = qs.defaultKeyStatistics || {};

    const institutionalHolders = instRaw.slice(0, 10).map(h => ({
      name: h.organization || h.filerName || '',
      pctHeld: typeof h.pctHeld === 'number' ? h.pctHeld : (h.pctHeld?.raw ?? 0),
      shares: typeof h.position === 'number' ? h.position : (h.position?.raw ?? 0),
      value: typeof h.value === 'number' ? h.value : (h.value?.raw ?? 0),
      dateReported: h.reportDate || '',
    }));

    const insiderTransactions = insidersRaw.slice(0, 15).map(t => ({
      name: t.filerName || t.insiderName || '',
      shares: typeof t.shares === 'number' ? t.shares : (t.shares?.raw ?? 0),
      value: typeof t.value === 'number' ? t.value : (t.value?.raw ?? 0),
      text: t.transactionText || t.text || '',
      startDate: normalizeTxnDate(t.startDate || t.startDatetOfInterval),
    }));

    const shortInterest = (typeof dk.sharesShortPriorMonth === 'number' && dk.sharesShortPriorMonth > 0) ? dk.sharesShortPriorMonth : (typeof dk.sharesShort === 'number' && dk.sharesShort > 0 ? dk.sharesShort : 0);
    const shortRatio = typeof dk.shortRatio === 'number' ? dk.shortRatio : 0;
    const floatShares = typeof dk.floatShares === 'number' ? dk.floatShares : 0;
    const yahooSharesOutstanding = typeof dk.sharesOutstanding === 'number' ? dk.sharesOutstanding : 0;
    console.log(`[Ownership] ${symbol} dk keys: ${Object.keys(dk).join(', ')} | shortInterest=${shortInterest} (sSPM_type=${typeof dk.sharesShortPriorMonth}, sS_type=${typeof dk.sharesShort}), float=${floatShares}, shortRatio=${shortRatio}`);
    const shortFloatPct = shortInterest && floatShares
      ? (shortInterest / floatShares) * 100 : 0;

    const result = {
      institutionalHolders,
      insiderTransactions,
      shortInterest,
      shortRatio,
      shortFloatPct,
      floatShares,
      yahooSharesOutstanding,
    };
    console.log(`[Ownership] ${symbol}: inst=${institutionalHolders.length}, insiders=${insiderTransactions.length}, short=${shortInterest}, float=${floatShares}`);
    return cacheSet(cacheKey, result);
  } catch {
    return null;
  }
}

async function getDividendHistory(symbol, limit = 8) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return [];

  // Get shares outstanding from fundamentals data
  let sharesOut = 0;
  for (const item of allData) {
    if (item.basicAverageShares) { sharesOut = item.basicAverageShares; break; }
  }

  // Extract actual dividend payments from fundamentals cashDividendsPaid
  const divPayments = allData
    .filter(i => i.periodType === 'FY' && i.cashDividendsPaid != null && i.cashDividendsPaid !== 0)
    .sort((a, b) => {
      const da = getDateStr(a.date) || '';
      const db = getDateStr(b.date) || '';
      return db.localeCompare(da);
    })
    .slice(0, limit)
    .map(i => {
      const perShareShares = i.basicAverageShares || i.basicEPS > 0 && i.netIncome > 0 ? i.netIncome / i.basicEPS : sharesOut;
      const perShare = perShareShares > 0 ? Math.abs(i.cashDividendsPaid) / perShareShares : 0;
      return {
        date: getDateStr(i.date),
        adjDividend: perShare,
        dividend: perShare,
        currency: 'USD',
      };
    });

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

    const km = await getKeyMetrics(symbol, period, limit, cfHistory);

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

// Load persisted cache from DB on startup
yahooFinanceCache.loadFromDb().then(count => {
  if (count > 0) console.log(`[YahooFinance] Restored ${count} cached entries from DB`);
}).catch(() => {});

module.exports = {
  getCompanyProfile,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getKeyMetrics,
  getDividendHistory,
  getFinancialReport,
  getOwnershipData,
  fetchPriceViaProxy,
  fetchPreMarketBatch,
  fetchQuoteSummary,
  clearCache,
};
