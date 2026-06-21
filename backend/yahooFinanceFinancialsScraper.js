const axios = require('axios');
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

// Normalize Yahoo v10 API response: flatten { raw, fmt } → scalar values
function normalizeYahooResponse(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.raw !== undefined) return data.raw;
  const result = Array.isArray(data) ? [] : {};
  for (const [key, val] of Object.entries(data)) {
    result[key] = normalizeYahooResponse(val);
  }
  return result;
}

// Helper: call Yahoo Finance API directly through a proxy or CORS relay
async function fetchYahooViaProxy(symbol) {
  const proxyService = require('./proxyService');
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}`;

  // Try direct proxy agents first
  for (let attempt = 0; attempt < 3; attempt++) {
    const proxy = proxyService.getRandomProxy();
    if (!proxy) break;
    const agent = proxyService.createProxyAgent(proxy);
    if (!agent) continue;
    try {
      const resp = await axios.get(url, {
        params: { modules: 'assetProfile,financialData,defaultKeyStatistics,summaryProfile' },
        httpsAgent: agent,
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
      });
      const result = resp.data?.quoteSummary?.result?.[0];
      if (result?.financialData?.marketCap?.raw) return normalizeYahooResponse(result);
    } catch {}
  }

  // Fallback: try free CORS proxy relays (no agent needed)
  try {
    const params = new URLSearchParams({ modules: 'assetProfile,financialData,defaultKeyStatistics,summaryProfile' });
    const data = await proxyService.fetchViaCorsProxy(url + '?' + params.toString());
    const result = data?.quoteSummary?.result?.[0];
    if (result?.financialData?.marketCap?.raw) return normalizeYahooResponse(result);
  } catch {}

  return null;
}

// Fetch current price and basic trade data from Yahoo Finance chart API via proxy or CORS relay
async function fetchPriceViaProxy(symbol) {
  const proxyService = require('./proxyService');

  // Try direct proxy agents first
  for (let attempt = 0; attempt < 3; attempt++) {
    const proxy = proxyService.getRandomProxy();
    if (!proxy) break;
    const agent = proxyService.createProxyAgent(proxy);
    if (!agent) continue;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
      const resp = await axios.get(url, {
        params: { interval: '1d', range: '1d', includePreMarket: 'true' },
        httpsAgent: agent,
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      const result = resp.data?.chart?.result?.[0];
      const meta = result?.meta;
      if (meta?.regularMarketPrice) {
        return {
          price: meta.regularMarketPrice,
          previousClose: meta.chartPreviousClose || meta.regularMarketPrice,
          currency: meta.currency || 'USD',
          exchange: meta.exchangeName || '',
          marketCap: meta.marketCap || 0,
          symbol: symbol.toUpperCase(),
          companyName: meta.shortName || meta.longName || '',
          regularMarketPrice: meta.regularMarketPrice,
          regularMarketPreviousClose: meta.chartPreviousClose || meta.regularMarketPrice,
          preMarketPrice: meta.preMarketPrice ?? null,
          preMarketChange: meta.preMarketChange ?? null,
          preMarketChangePercent: meta.preMarketChangePercent ?? null,
          preMarketTime: meta.preMarketTime ?? null,
          postMarketPrice: meta.postMarketPrice ?? null,
          postMarketChange: meta.postMarketChange ?? null,
          postMarketChangePercent: meta.postMarketChangePercent ?? null,
          postMarketTime: meta.postMarketTime ?? null,
          currentTradingPeriod: result?.meta?.currentTradingPeriod || null,
          marketState: meta.marketState || 'REGULAR',
        };
      }
    } catch {}
  }

  // Fallback: try free CORS proxy relays (no agent needed)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const params = new URLSearchParams({ interval: '1d', range: '1d', includePreMarket: 'true' });
    const data = await proxyService.fetchViaCorsProxy(url + '?' + params.toString());
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (meta?.regularMarketPrice) {
      return {
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose || meta.regularMarketPrice,
        currency: meta.currency || 'USD',
        exchange: meta.exchangeName || '',
        marketCap: meta.marketCap || 0,
        symbol: symbol.toUpperCase(),
        companyName: meta.shortName || meta.longName || '',
        regularMarketPrice: meta.regularMarketPrice,
        regularMarketPreviousClose: meta.chartPreviousClose || meta.regularMarketPrice,
        preMarketPrice: meta.preMarketPrice ?? null,
        preMarketChange: meta.preMarketChange ?? null,
        preMarketChangePercent: meta.preMarketChangePercent ?? null,
        preMarketTime: meta.preMarketTime ?? null,
        postMarketPrice: meta.postMarketPrice ?? null,
        postMarketChange: meta.postMarketChange ?? null,
        postMarketChangePercent: meta.postMarketChangePercent ?? null,
        postMarketTime: meta.postMarketTime ?? null,
        currentTradingPeriod: result?.meta?.currentTradingPeriod || null,
        marketState: meta.marketState || 'REGULAR',
      };
    }
  } catch {}

  // Last resort: direct request to Yahoo chart API (may work from some cloud regions)
  try {
    const resp = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      params: { interval: '1d', range: '1d', includePreMarket: 'true' },
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    const result = resp.data?.chart?.result?.[0];
    const meta = result?.meta;
    if (meta?.regularMarketPrice) {
      return {
        price: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose || meta.regularMarketPrice,
        currency: meta.currency || 'USD',
        exchange: meta.exchangeName || '',
        marketCap: meta.marketCap || 0,
        symbol: symbol.toUpperCase(),
        companyName: meta.shortName || meta.longName || '',
        regularMarketPrice: meta.regularMarketPrice,
        regularMarketPreviousClose: meta.chartPreviousClose || meta.regularMarketPrice,
        preMarketPrice: meta.preMarketPrice ?? null,
        preMarketChange: meta.preMarketChange ?? null,
        preMarketChangePercent: meta.preMarketChangePercent ?? null,
        preMarketTime: meta.preMarketTime ?? null,
        postMarketPrice: meta.postMarketPrice ?? null,
        postMarketChange: meta.postMarketChange ?? null,
        postMarketChangePercent: meta.postMarketChangePercent ?? null,
        postMarketTime: meta.postMarketTime ?? null,
        currentTradingPeriod: result?.meta?.currentTradingPeriod || null,
        marketState: meta.marketState || 'REGULAR',
      };
    }
  } catch {}

  return null;
}

async function fetchPreMarketBatch(symbols) {
  if (!symbols || symbols.length === 0) return {};
  const results = {};
  const batches = [];
  for (let i = 0; i < symbols.length; i += 10) {
    batches.push(symbols.slice(i, i + 10));
  }
  for (const batch of batches) {
    const promises = batch.map(async (sym) => {
      try {
        const data = await fetchPriceViaProxy(sym);
        if (data) results[sym.toUpperCase()] = data;
      } catch {}
    });
    await Promise.all(promises);
    if (batches.length > 1) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// Fetch quote-like summary from multiple sources: Twelve Data → Yahoo via proxy → RapidAPI
async function fetchQuoteSummary(symbol, modules) {
  const cacheKey = `yh_quoteSummary_${symbol}_${modules.join(',')}`;
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

  // 2. Try Yahoo Finance API directly through a free proxy pool
  try {
    const yahooData = await fetchYahooViaProxy(symbol);
    if (yahooData) return cacheSet(cacheKey, yahooData);
  } catch {}

  // 3. Fallback: RapidAPI Yahoo proxy (may be exhausted)
  const key = process.env.RAPIDAPI_KEY;
  let host = (process.env.RAPIDAPI_HOST || 'yahoo-finance15.p.rapidapi.com').trim();
  host = host.replace(/^https?:\/\//, '');
  if (key && host) {
    try {
      const resp = await axios.get(`https://${host}/api/v1/markets/stock/modules`, {
        params: { symbol, module: 'financialData,defaultKeyStatistics,summaryProfile,assetProfile' },
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 10000,
      });
      if (resp.data?.financialData?.marketCap) {
        return cacheSet(cacheKey, resp.data);
      }
    } catch {}
  }

  // 4. Last resort: try yahoo-finance2 directly (may be blocked, but worth trying)
  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const qs = await yf.quoteSummary(symbol, { modules });
    if (qs?.financialData?.marketCap) return cacheSet(cacheKey, qs);
  } catch {}

  return null;
}

// Map Twelve Data statistics response to quoteSummary-like shape
function twelveDataToQuoteSummary(tds, symbol) {
  if (!tds) return null;
  return {
    financialData: {
      marketCap: tds.marketCap,
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
async function fetchAllFundamentals(symbol) {
  const cacheKey = `yh_fundamentals_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
        operatingCashFlow: cf.operatingCashFlow || 0,
        capitalExpenditure: cf.capitalExpenditure || 0,
        freeCashFlow: cf.freeCashFlow || 0,
        cashDividendsPaid: cf.dividendsPaid || 0,
        marketCap: km.marketCap || 0,
      });
    }
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
    image: '',
    lastUpdated: new Date().toISOString(),
  };

  return cacheSet(cacheKey, profile);
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
  };
}

async function getBalanceSheet(symbol, period = 'annual', limit = 4) {
  const allData = await fetchAllFundamentals(symbol);
  if (!allData) return null;

  // Accept both 3M (quarterly) and FY (annual) period types
  const items = allData
    .filter(item => (item.periodType === '3M' || item.periodType === 'FY') && item.totalAssets != null)
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

  // Accept both 3M (quarterly) and FY (annual) period types
  const hasQuarterly = allData.some(item => item.periodType === '3M' && item.operatingCashFlow != null);
  const items = allData
    .filter(item => (hasQuarterly ? item.periodType === '3M' : true) && item.operatingCashFlow != null)
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
    const ocf = incItem.ebitda || 0;
    const eps = incItem.eps || 0;
    const freeCashFlow = cfItem.freeCashFlow || 0;

    // Use real marketCap when available; don't estimate
    const cap = currentMarketCap;

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
      earningsYield: (netIncome > 0 && cap > 0) ? netIncome / cap : 0,
      freeCashFlowYield: cap > 0 ? freeCashFlow / cap : 0,
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

module.exports = {
  getCompanyProfile,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getKeyMetrics,
  getDividendHistory,
  getFinancialReport,
  fetchPriceViaProxy,
  fetchPreMarketBatch,
  fetchQuoteSummary,
  clearCache,
};
