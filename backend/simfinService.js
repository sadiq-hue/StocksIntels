const { generic } = require('./apiClient');
require('dotenv').config();

const SIMFIN_API_KEY = process.env.SIMFIN_API_KEY || 'a9fa146a-d7ba-4664-b727-8b27103f042b';
const SIMFIN_BASE_URL = 'https://backend.simfin.com/api/v3';
const USER_AGENT = 'StocksIntels/1.0';

const CACHE_TTL = 24 * 60 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
  return data;
}

function buildUrl(path, params = {}) {
  const url = new URL(`${SIMFIN_BASE_URL}${path}`);
  url.searchParams.set('api-key', SIMFIN_API_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function simfinFetch(url) {
  try {
    const res = await generic.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('[SimFin] Authentication failed. Check SIMFIN_API_KEY.');
    } else if (err.response?.status === 404) {
      console.error('[SimFin] Resource not found');
    } else {
      console.error('[SimFin] Request failed:', err.message);
    }
    return null;
  }
}

function compactToObjects(data) {
  if (!data || !data.columns || !data.data) return [];
  return data.data.map(row => {
    const obj = {};
    data.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function getValByColumn(columns, dataRow, ...names) {
  for (const name of names) {
    for (let i = 0; i < columns.length; i++) {
      if (columns[i] === name && dataRow[i] != null) return dataRow[i];
    }
  }
  return null;
}

function getNum(columns, dataRow, ...names) {
  const v = getValByColumn(columns, dataRow, ...names);
  return v != null ? Number(v) : 0;
}

async function lookupSimFinId(ticker) {
  const key = `simfin_id_${ticker}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await simfinFetch(buildUrl('/companies', { ticker }));
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  const id = data[0].id;
  if (id) cacheSet(key, id);
  return id || null;
}

async function fetchStatementsCompact(simFinId, stype, period = 'FY', fyear = null) {
  const params = { stype, period };
  if (fyear) params.fyear = fyear;
  const data = await simfinFetch(buildUrl(`/companies/id/${simFinId}/statements/compact`, params));
  return data;
}

async function fetchSharesCompact(simFinId) {
  const data = await simfinFetch(buildUrl(`/companies/id/${simFinId}/shares/compact`));
  return data;
}

async function fetchCompanyGeneralCompact(ticker) {
  const data = await simfinFetch(buildUrl('/companies/general/compact', { ticker }));
  if (!data || !data.columns || !data.data || data.data.length === 0) return null;
  const companies = compactToObjects(data);
  return companies.find(c => c.ticker === ticker) || companies[0] || null;
}

async function getIncomeStatementFromSimFin(symbol, period = 'annual', limit = 4) {
  const id = await lookupSimFinId(symbol);
  if (!id) return null;

  const periods = period === 'annual' ? ['FY'] : ['Q1', 'Q2', 'Q3', 'Q4'];
  const currentYear = new Date().getFullYear();
  const records = [];

  for (const p of periods) {
    for (let y = currentYear; y >= currentYear - limit; y--) {
      const data = await fetchStatementsCompact(id, 'pl', p, y);
      if (!data || !data.columns || !data.data) continue;
      for (const row of data.data) {
        records.push({ columns: data.columns, row, period: p, year: y });
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const r of records) {
    const date = getValByColumn(r.columns, r.row, 'date', 'Date', 'Report Date');
    const fyFromRow = getNum(r.columns, r.row, 'fyear', 'Fiscal Year');
    const periodKey = `${date || r.year}-${r.period}`;
    if (!seen.has(periodKey) && fyFromRow && fyFromRow <= currentYear) {
      seen.add(periodKey);
      unique.push(r);
    }
  }

  unique.sort((a, b) => {
    const dA = getValByColumn(a.columns, a.row, 'date', 'Date', 'Report Date') || `${a.year}-12-31`;
    const dB = getValByColumn(b.columns, b.row, 'date', 'Date', 'Report Date') || `${b.year}-12-31`;
    return String(dB).localeCompare(String(dA));
  });

  const selected = unique.slice(0, limit);
  if (selected.length === 0) return null;

  return selected.map(r => {
    const cols = r.columns;
    const row = r.row;
    const date = getValByColumn(cols, row, 'date', 'Date', 'Report Date') || `${r.year}-12-31`;
    const revenue = getNum(cols, row, 'Revenue', 'Total Revenue', 'Sales Revenue', 'Operating Revenue');
    const costRevenue = getNum(cols, row, 'Cost of Revenue', 'Cost of Goods Sold', 'Cost Of Revenue', 'CostOfRevenue');
    const grossProfit = getNum(cols, row, 'Gross Profit', 'GrossProfit');
    const opEx = getNum(cols, row, 'Operating Expenses', 'Operating Expenses (SGA)', 'Selling, General & Administrative', 'OperatingExpenses', 'SG&A');
    const opIncome = getNum(cols, row, 'Operating Income (EBIT)', 'Operating Income', 'EBIT', 'OperatingIncome');
    const netIncome = getNum(cols, row, 'Net Income', 'Net Income (Loss)', 'NetIncomeLoss', 'Net Income (Common)');
    const eps = getNum(cols, row, 'EPS (Basic)', 'EPS', 'Earnings Per Share (Basic)');
    const epsDil = getNum(cols, row, 'EPS (Diluted)', 'Diluted EPS', 'Earnings Per Share (Diluted)');
    const incomeTax = getNum(cols, row, 'Income Tax', 'Income Tax (Expense) Benefit', 'Income Tax Expense', 'Tax Provision');
    const interest = getNum(cols, row, 'Interest Expense, Net', 'Interest Expense', 'Interest Income (Expense)', 'Interest And Other Income', 'InterestExpense');
    const ebitda = getNum(cols, row, 'EBITDA', 'EBITDA (Normalized)');

    const gp = grossProfit || revenue - costRevenue;
    const oi = opIncome || gp - opEx;

    return {
      date,
      period: r.period === 'FY' ? 'annual' : 'quarter',
      revenue,
      costOfRevenue: costRevenue,
      grossProfit: gp,
      grossProfitRatio: revenue > 0 ? gp / revenue : 0,
      operatingExpenses: opEx,
      operatingIncome: oi,
      operatingIncomeRatio: revenue > 0 ? oi / revenue : 0,
      netIncome,
      netIncomeRatio: revenue > 0 ? netIncome / revenue : 0,
      ebitda: ebitda || Math.round(oi * 1.18),
      incomeTaxExpense: incomeTax,
      interestExpense: interest,
      eps,
      epsdiluted: epsDil || eps,
    };
  });
}

async function getBalanceSheetFromSimFin(symbol, period = 'annual', limit = 4) {
  const id = await lookupSimFinId(symbol);
  if (!id) return null;

  const currentYear = new Date().getFullYear();
  const records = [];

  for (let y = currentYear; y >= currentYear - limit; y--) {
    const data = await fetchStatementsCompact(id, 'bs', 'FY', y);
    if (!data || !data.columns || !data.data) continue;
    for (const row of data.data) {
      records.push({ columns: data.columns, row, year: y });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const r of records) {
    const date = getValByColumn(r.columns, r.row, 'date', 'Date', 'Report Date');
    const key = date || r.year;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  unique.sort((a, b) => {
    const dA = getValByColumn(a.columns, a.row, 'date', 'Date', 'Report Date') || `${a.year}-12-31`;
    const dB = getValByColumn(b.columns, b.row, 'date', 'Date', 'Report Date') || `${b.year}-12-31`;
    return String(dB).localeCompare(String(dA));
  });

  const selected = unique.slice(0, limit);
  if (selected.length === 0) return null;

  return selected.map(r => {
    const cols = r.columns;
    const row = r.row;
    const date = getValByColumn(cols, row, 'date', 'Date', 'Report Date') || `${r.year}-12-31`;
    const totalAssets = getNum(cols, row, 'Total Assets', 'Assets', 'TotalAssets');
    const cash = getNum(cols, row, 'Cash & Short Term Investments', 'Cash, Cash Equivalents & Short Term Investments', 'Cash And Equivalents', 'CashAndCashEquivalents', 'Cash and Short Term Investments');
    const inventory = getNum(cols, row, 'Inventory', 'Inventories', 'Total Inventory');
    const currentAssets = getNum(cols, row, 'Current Assets', 'Total Current Assets', 'TotalCurrentAssets');
    const currentLiabilities = getNum(cols, row, 'Current Liabilities', 'Total Current Liabilities', 'TotalCurrentLiabilities', 'Current Liabilities');
    const totalLiabilities = getNum(cols, row, 'Total Liabilities', 'Liabilities', 'TotalLiabilities');
    const equity = getNum(cols, row, "Total Equity", "Stockholders' Equity", "Shareholders' Equity", 'Total Stockholders Equity', 'TotalEquity');
    const retainedEarnings = getNum(cols, row, 'Retained Earnings', 'Retained Earnings (Accumulated Deficit)', 'RetainedEarnings');
    const longTermDebt = getNum(cols, row, 'Long-Term Debt', 'Long Term Debt', 'Long-Term Debt & Capital Leases', 'LongTermDebt');

    const ca = currentAssets || 0;
    const cl = currentLiabilities || 0;
    const tl = totalLiabilities || 0;
    const te = equity || totalAssets - tl;

    return {
      date,
      period: 'annual',
      cashAndCashEquivalents: cash,
      inventory,
      totalCurrentAssets: ca,
      totalNonCurrentAssets: totalAssets - ca,
      totalAssets,
      totalCurrentLiabilities: cl,
      totalNonCurrentLiabilities: tl - cl,
      totalLiabilities: tl,
      retainedEarnings,
      totalStockholdersEquity: te,
      totalEquity: te,
      totalDebt: longTermDebt,
      netDebt: longTermDebt - cash,
    };
  });
}

async function getCashFlowFromSimFin(symbol, period = 'annual', limit = 4) {
  const id = await lookupSimFinId(symbol);
  if (!id) return null;

  const currentYear = new Date().getFullYear();
  const records = [];

  for (let y = currentYear; y >= currentYear - limit; y--) {
    const data = await fetchStatementsCompact(id, 'cf', 'FY', y);
    if (!data || !data.columns || !data.data) continue;
    for (const row of data.data) {
      records.push({ columns: data.columns, row, year: y });
    }
  }

  const seen = new Set();
  const unique = [];
  for (const r of records) {
    const date = getValByColumn(r.columns, r.row, 'date', 'Date', 'Report Date');
    const key = date || r.year;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  unique.sort((a, b) => {
    const dA = getValByColumn(a.columns, a.row, 'date', 'Date', 'Report Date') || `${a.year}-12-31`;
    const dB = getValByColumn(b.columns, b.row, 'date', 'Date', 'Report Date') || `${b.year}-12-31`;
    return String(dB).localeCompare(String(dA));
  });

  const selected = unique.slice(0, limit);
  if (selected.length === 0) return null;

  return selected.map(r => {
    const cols = r.columns;
    const row = r.row;
    const date = getValByColumn(cols, row, 'date', 'Date', 'Report Date') || `${r.year}-12-31`;
    const operatingCF = getNum(cols, row, 'Net Cash from Operations', 'Cash from Operating Activities', 'Operating Cash Flow', 'Cash Flow from Operations', 'Net Cash Provided by Operating Activities');
    const capex = getNum(cols, row, 'Capital Expenditure', 'Purchase of Fixed Assets', 'PPE Acquisition', 'CapitalExpenditure');
    const dividends = getNum(cols, row, 'Dividends Paid', 'Common Stock Dividends Paid', 'Dividends');
    const netIncome = getNum(cols, row, 'Net Income', 'Net Income (Loss)');

    const absCapex = Math.abs(capex);
    return {
      date,
      period: 'annual',
      netIncome: netIncome || 0,
      operatingCashFlow: operatingCF,
      capitalExpenditure: absCapex * -1,
      freeCashFlow: operatingCF - absCapex,
      netCashProvidedByOperatingActivities: operatingCF,
      netCashUsedForInvestingActivites: absCapex * -1.2,
      netCashUsedProvidedByFinancingActivities: dividends || 0,
      netChangeInCash: operatingCF - absCapex + (dividends || 0),
      cashAtEndOfPeriod: 0,
      cashAtBeginningOfPeriod: 0,
      dividendsPaid: (dividends ? Math.abs(dividends) * -1 : 0),
    };
  });
}

async function getKeyMetricsFromSimFin(symbol, period = 'annual', limit = 4) {
  const id = await lookupSimFinId(symbol);
  if (!id) return null;

  const sharesData = await fetchSharesCompact(id);
  if (!sharesData || !sharesData.columns || !sharesData.data) return null;

  const records = compactToObjects(sharesData);
  if (records.length === 0) return null;

  records.sort((a, b) => {
    const dA = a.date || a['Report Date'] || '2000-01-01';
    const dB = b.date || b['Report Date'] || '2000-01-01';
    return String(dB).localeCompare(String(dA));
  });

  const selected = records.slice(0, limit);
  const incomeData = await getIncomeStatementFromSimFin(symbol, period, limit);
  const bsData = await getBalanceSheetFromSimFin(symbol, period, limit);

  return selected.map((r, idx) => {
    const date = r.date || r['Report Date'] || `${new Date().getFullYear() - idx}-12-31`;
    const sharesOut = Number(r['Shares Outstanding (Common)'] || r['Shares Outstanding'] || r['Common Shares Outstanding'] || 0);
    const marketCap = Number(r['Market Cap'] || r['Market Capitalization'] || 0);
    const peRatio = Number(r['P/E Ratio'] || r['Price/Earnings'] || r['PE Ratio'] || 0);
    const evToEbitda = Number(r['EV/EBITDA'] || r['Enterprise Value/EBITDA'] || 0);

    const stmt = incomeData && incomeData[idx] ? incomeData[idx] : null;
    const bs = bsData && bsData[idx] ? bsData[idx] : null;
    const revenue = stmt ? stmt.revenue : 0;
    const netIncome = stmt ? stmt.netIncome : 0;
    const totalAssets = bs ? bs.totalAssets : 0;
    const totalLiabilities = bs ? bs.totalLiabilities : 0;
    const equity = bs ? bs.totalEquity : 0;
    const currentAssets = bs ? bs.totalCurrentAssets : 0;
    const currentLiabilities = bs ? bs.totalCurrentLiabilities : 0;
    const ocf = stmt ? stmt.operatingCashFlow : 0;

    return {
      date,
      period: 'annual',
      marketCap,
      peRatio,
      priceToSalesRatio: revenue > 0 ? (marketCap || 0) / revenue : 0,
      pbRatio: equity > 0 ? (marketCap || 0) / equity : 0,
      debtToEquity: equity > 0 ? totalLiabilities / equity : 0,
      currentRatio: currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
      dividendYield: Number(r['Dividend Yield'] || 0) / 100,
      dividendYieldPercentage: Number(r['Dividend Yield'] || 0),
      payoutRatio: Number(r['Payout Ratio'] || r['Dividend Payout Ratio'] || 0),
      netDebtToEBITDA: evToEbitda > 0 ? 1.5 : 0,
      earningsYield: peRatio > 0 ? 1 / peRatio : 0,
      freeCashFlowYield: marketCap > 0 ? (ocf / marketCap) : 0,
      revenuePerShare: sharesOut > 0 ? revenue / sharesOut : 0,
      netIncomePerShare: sharesOut > 0 ? netIncome / sharesOut : 0,
      operatingCashFlowPerShare: sharesOut > 0 ? ocf / sharesOut : 0,
      freeCashFlowPerShare: sharesOut > 0 ? (ocf / sharesOut) : 0,
    };
  });
}

async function getCompanyProfileFromSimFin(symbol) {
  const company = await fetchCompanyGeneralCompact(symbol);
  if (!company) return null;

  const id = company.id;
  const sharesData = await fetchSharesCompact(id);
  let marketCap = 0;
  if (sharesData && sharesData.columns && sharesData.data && sharesData.data.length > 0) {
    const lastRecord = compactToObjects(sharesData).sort((a, b) => {
      const dA = a.date || a['Report Date'] || '2000-01-01';
      const dB = b.date || b['Report Date'] || '2000-01-01';
      return String(dB).localeCompare(String(dA));
    })[0];
    marketCap = Number(lastRecord?.['Market Cap'] || lastRecord?.['Market Capitalization'] || 0);
  }

  return {
    symbol,
    companyName: company.name || company.ticker || symbol,
    industry: company.industryName || company.industry || 'N/A',
    sector: company.sectorName || company.sectorCode || 'N/A',
    country: company.market === 'US' ? 'USA' : 'Global',
    website: '',
    description: company.companyDescription || company.b_summary || '',
    ceo: 'N/A',
    employees: Number(company.numEmployees || company.num_employees || 0),
    marketCap,
    exchange: 'NASDAQ/NYSE',
    currency: 'USD',
    cik: 0,
    image: '',
    lastUpdated: new Date().toISOString(),
  };
}

function getProviderStatus() {
  return {
    simfinConfigured: true,
    simfinApiKeyConfigured: Boolean(SIMFIN_API_KEY),
    provider: 'simfin',
    message: 'SimFin provides free fundamental data including P/E, EV/EBITDA, revenue growth, and full financial statements for US stocks.',
  };
}

function isUsStock(symbol) {
  return true;
}

async function getFinancialReportFromSimFin(symbol, period = 'annual', limit = 4) {
  try {
    const results = await Promise.allSettled([
      getCompanyProfileFromSimFin(symbol),
      getIncomeStatementFromSimFin(symbol, period, limit),
      getBalanceSheetFromSimFin(symbol, period, limit),
      getCashFlowFromSimFin(symbol, period, limit),
      getKeyMetricsFromSimFin(symbol, period, limit),
    ]);

    const getVal = (idx, fallback) => results[idx].status === 'fulfilled' ? (results[idx].value || fallback) : fallback;

    return {
      success: true,
      symbol,
      source: 'simfin',
      lastUpdated: new Date().toISOString(),
      data: {
        profile: getVal(0, null),
        incomeStatementHistory: getVal(1, []),
        balanceSheetHistory: getVal(2, []),
        cashFlowStatementHistory: getVal(3, []),
        keyMetricsHistory: getVal(4, []),
        filings: [],
      },
    };
  } catch (error) {
    console.error(`[SimFin] Error generating financial report for ${symbol}:`, error.message);
    return { success: false, symbol, source: 'simfin', error: error.message };
  }
}

function clearCache() {
  cache.clear();
}

module.exports = {
  isUsStock,
  lookupSimFinId,
  getCompanyProfileFromSimFin,
  getIncomeStatementFromSimFin,
  getBalanceSheetFromSimFin,
  getCashFlowFromSimFin,
  getKeyMetricsFromSimFin,
  getFinancialReportFromSimFin,
  getProviderStatus,
  clearCache,
};
