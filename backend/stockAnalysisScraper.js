// StockAnalysis.com financials scraper.
//
// Used for exchanges that Yahoo Finance / SEC EDGAR do not cover — NGX (Nigeria),
// and as a fallback for JSE (South Africa) small caps. Financial data on
// stockanalysis.com is provided by S&P Global Market Intelligence.
//
// Symbol form: "NGX:DANGCEM" / "JSE:MTN".  Values on the page are in millions of
// the reporting currency; we scale to raw units to match the Yahoo path.
//
// The returned shape mirrors financialReportsService's Yahoo report so the
// frontend (FinancialMetrics) can render it: it needs BOTH the `*History` arrays
// AND the singular `incomeStatement` / `balanceSheet` / `cashFlowStatement` /
// `keyMetrics` objects (latest period).

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://stockanalysis.com/quote';
const BASE_STOCKS = 'https://stockanalysis.com/stocks';
const EXCHANGE_SLUG = { NGX: 'ngx', JSE: 'jse' };
const CURRENCY = { ngx: 'NGN', jse: 'ZAR' };
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

function toNumber(s) {
  if (s == null) return null;
  const t = String(s).replace(/[,\s]/g, '');
  if (t === '' || t === '-' || t === '\u2014') return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function parseDate(label) {
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const m = String(label || '').match(/([A-Za-z]{3})[a-z]*\.?\s*'?(\d{2,4})/);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    let yr = parseInt(m[2], 10);
    if (yr < 100) yr += 2000;
    if (mon != null) return new Date(Date.UTC(yr, mon + 1, 0)).toISOString().slice(0, 10);
  }
  const y = String(label || '').match(/(\d{4})/);
  return y ? `${y[1]}-12-31` : null;
}

async function fetchTable(slug, ticker, path, market = 'quote') {
  const isUs = market === 'us';
  const tablePath = isUs && path === 'income-statement' ? '' : path;
  const url = isUs
    ? `${BASE_STOCKS}/${encodeURIComponent(ticker)}/financials/${tablePath ? `${tablePath}/` : ''}`
    : `${BASE}/${slug}/${encodeURIComponent(ticker)}/financials/${path}/`;
  const resp = await axios.get(url, { timeout: 20000, headers: HEADERS });
  const $ = cheerio.load(resp.data);
  let periods = null;
  const rows = {};
  // Each page splits its data across several tables (assets / liabilities /
  // equity / debt for the balance sheet; cash / investing / financing for the
  // cash flow; ratios / valuation for the ratios page). Merge every table that
  // carries a Fiscal-Year header so every metric label is available.
  $('table').each((_, table) => {
    const parsed = [];
    $(table).find('tr').each((__, tr) => {
      parsed.push($(tr).find('th,td').map((___, c) => $(c).text().trim()).get());
    });
    const header = parsed.find(r => r[0] && /fiscal year/i.test(r[0]));
    if (!header || header.length <= 2) return;
    if (!periods) periods = header.slice(1);
    for (const r of parsed) {
      if (!r[0] || r[0] === '') continue;
      if (!rows[r[0]]) rows[r[0]] = r.slice(1);
    }
  });
  if (!periods) throw new Error(`no table found for ${ticker} ${path}`);
  return { periods, rows, url };
}

function pick(rows, labels) {
  const norm = (v) => String(v || '').replace(/[^a-z]/gi, '').toLowerCase();
  for (const l of labels) {
    const wanted = norm(l);
    if (!wanted) continue;
    const exact = Object.keys(rows).find(k => norm(k) === wanted);
    if (exact) return rows[exact];
    const prefixed = Object.keys(rows).find(k => norm(k).startsWith(wanted));
    if (prefixed) return rows[prefixed];
    const contained = Object.keys(rows).find(k => norm(k).includes(wanted));
    if (contained) return rows[contained];
  }
  return [];
}

async function getFinancialReport(symbol, period = 'annual', limit = 4) {
  const m = String(symbol).toUpperCase().match(/^([A-Z]+):(.+)$/);
  const exchange = m ? m[1] : 'US';
  const ticker = m ? m[2] : String(symbol).toUpperCase();
  const isUs = exchange === 'US' || exchange === 'STOCKS';
  const slug = isUs ? 'stocks' : (EXCHANGE_SLUG[exchange] || String(exchange).toLowerCase());
  if (!isUs && exchange !== 'NGX' && exchange !== 'JSE') {
    return { success: false, symbol: ticker, source: 'stockanalysis', error: `Unsupported exchange ${exchange}` };
  }
  const market = isUs ? 'us' : 'quote';

  try {
    const inc = await fetchTable(slug, ticker, 'income-statement', market);
    const bal = await fetchTable(slug, ticker, 'balance-sheet', market).catch(() => ({ periods: [], rows: {} }));
    const cf = await fetchTable(slug, ticker, 'cash-flow-statement', market).catch(() => ({ periods: [], rows: {} }));
    const ratios = await fetchTable(slug, ticker, 'ratios', market).catch(() => ({ periods: [], rows: {} }));
    const M = 1e6;

    const periods = inc.periods.slice(0, limit + 1); // TTM + limit fiscal years
    const dates = inc.rows['Period Ending'] || inc.rows['Period ending'] || [];
    const revRow = pick(inc.rows, ['Revenue']);
    const gpRow = pick(inc.rows, ['Gross Profit']);
    const niRow = pick(inc.rows, ['Net Income', 'Net Income to Common']);
    const epsRow = pick(inc.rows, ['EPS (Basic)', 'EPS (Diluted)', 'Earnings Per Share']);
    const opIncRow = pick(inc.rows, ['Operating Income']);
    const ebitdaRow = pick(inc.rows, ['EBITDA']);
    const taxRow = pick(inc.rows, ['Income Tax Expense', 'Income Tax']);
    const incomeStatementHistory = periods.map((p, i) => ({
      date: parseDate(dates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      revenue: (toNumber(revRow[i]) ?? 0) * M,
      grossProfit: (toNumber(gpRow[i]) ?? 0) * M,
      netIncome: (toNumber(niRow[i]) ?? 0) * M,
      eps: toNumber(epsRow[i]) ?? 0,
      operatingIncome: (toNumber(opIncRow[i]) ?? 0) * M,
      ebitda: (toNumber(ebitdaRow[i]) ?? 0) * M,
      incomeTaxExpense: (toNumber(taxRow[i]) ?? 0) * M,
    }));

    const balDates = bal.rows['Period Ending'] || [];
    const taRow = pick(bal.rows, ['Total Assets']);
    const tlRow = pick(bal.rows, ['Total Liabilities']);
    const teRow = pick(bal.rows, ['Total Equity', "Total Stockholders' Equity", 'Total Shareholders Equity', 'Shareholders Equity', 'Stockholders Equity', 'Shareholders\u0027 Equity']);
    const debtRow = pick(bal.rows, ['Total Debt']);
    const cashRow = pick(bal.rows, ['Cash & Investments', 'Cash & Cash Equivalents', 'Cash & Equivalents', 'Cash And Cash Equivalents']);
    const balanceSheetHistory = bal.periods.slice(0, limit + 1).map((p, i) => ({
      date: parseDate(balDates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      totalAssets: (toNumber(taRow[i]) ?? 0) * M,
      totalLiabilities: (toNumber(tlRow[i]) ?? 0) * M,
      totalStockholdersEquity: (toNumber(teRow[i]) ?? 0) * M,
      totalDebt: (toNumber(debtRow[i]) ?? 0) * M,
      cashAndCashEquivalents: (toNumber(cashRow[i]) ?? 0) * M,
    }));

    const cfDates = cf.rows['Period Ending'] || [];
    const ocfRow = pick(cf.rows, ['Operating Cash Flow', 'Cash From Operating Activities']);
    const fcfRow = pick(cf.rows, ['Free Cash Flow']);
    const cashflowStatementHistory = cf.periods.slice(0, limit + 1).map((p, i) => ({
      date: parseDate(cfDates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      totalCashFromOperatingActivities: (toNumber(ocfRow[i]) ?? 0) * M,
      freeCashFlow: (toNumber(fcfRow[i]) ?? 0) * M,
    }));

    const keyMetricsHistory = incomeStatementHistory.map((r) => ({
      date: r.date, revenue: r.revenue, netIncome: r.netIncome, eps: r.eps,
    }));

    if (incomeStatementHistory.every(r => !r.revenue && !r.netIncome)) {
      return { success: false, symbol: ticker, source: 'stockanalysis', error: `No financial rows parsed for ${ticker}` };
    }

    // ── Singular (latest period) objects the frontend FinancialMetrics reads ──
    const i0 = incomeStatementHistory[0] || {};
    const b0 = balanceSheetHistory[0] || {};
    const c0 = cashflowStatementHistory[0] || {};
    const rnum = (labels) => { const r = pick(ratios.rows, labels); return toNumber(r[0]); };

    const revenue = i0.revenue || 0;
    const netIncome = i0.netIncome || 0;
    const operatingIncome = i0.operatingIncome || 0;
    const divYieldPct = rnum(['Dividend Yield']);
    const fcfYieldPct = rnum(['Free Cash Flow Yield', 'FCF Yield']);
    const earnYieldPct = rnum(['Earnings Yield']);
    const mcapRaw = rnum(['Market Capitalization', 'Market Cap']);
    const revGrowthPct = toNumber(pick(inc.rows, ['Revenue Growth'])[0]) ?? rnum(['Revenue Growth']);
    const epsGrowthPct = toNumber(pick(inc.rows, ['EPS Growth'])[0]) ?? rnum(['EPS Growth']);
    const roePct = rnum(['Return on Equity (ROE)', 'Return on Equity', 'ROE']);
    const roaPct = rnum(['Return on Assets (ROA)', 'Return on Assets', 'ROA']);
    const evEbitda = rnum(['EV/EBITDA', 'EV / EBITDA']);
    const ebitda = i0.ebitda || null;

    const incomeStatement = {
      date: i0.date,
      revenue,
      grossProfit: i0.grossProfit || 0,
      netIncome,
      eps: i0.eps || 0,
      operatingIncome,
      ebitda,
      incomeTaxExpense: i0.incomeTaxExpense || 0,
      operatingIncomeRatio: revenue ? operatingIncome / revenue : null,
      grossMargin: revenue ? (i0.grossProfit || 0) / revenue : null,
      netIncomeRatio: revenue ? netIncome / revenue : null,
    };
    const balanceSheet = {
      date: b0.date,
      totalAssets: b0.totalAssets || 0,
      totalLiabilities: b0.totalLiabilities || 0,
      totalStockholdersEquity: b0.totalStockholdersEquity || 0,
      totalDebt: b0.totalDebt || 0,
      cashAndCashEquivalents: b0.cashAndCashEquivalents || 0,
    };
    const cashFlowStatement = {
      date: c0.date,
      freeCashFlow: c0.freeCashFlow || 0,
      totalCashFromOperatingActivities: c0.totalCashFromOperatingActivities || 0,
    };
    const keyMetrics = {
      date: i0.date,
      marketCap: mcapRaw != null ? mcapRaw * M : null,
      peRatio: rnum(['PE Ratio', 'P/E Ratio']),
      pbRatio: rnum(['PB Ratio', 'P/B Ratio', 'Price/Book']),
      priceToSalesRatio: rnum(['PS Ratio', 'Price/Sales']),
      debtToEquity: rnum(['Debt / Equity Ratio', 'Debt / Equity', 'Debt/Equity', 'Debt To Equity']),
      currentRatio: rnum(['Current Ratio']),
      roe: roePct != null ? roePct / 100 : null,
      roa: roaPct != null ? roaPct / 100 : null,
      evEbitda,
      grossMargin: revenue ? (i0.grossProfit || 0) / revenue : null,
      operatingMargin: revenue ? operatingIncome / revenue : null,
      profitMargin: revenue ? netIncome / revenue : null,
      ebitda,
      freeCashFlow: c0.freeCashFlow || 0,
      revenueGrowth: revGrowthPct != null ? revGrowthPct / 100 : null,
      epsGrowth: epsGrowthPct != null ? epsGrowthPct / 100 : null,
      dividendYield: divYieldPct != null ? divYieldPct / 100 : null,
      dividendYieldPercentage: divYieldPct,
      freeCashFlowYield: fcfYieldPct != null ? fcfYieldPct / 100 : null,
      earningsYield: earnYieldPct != null ? earnYieldPct / 100 : null,
    };

    return {
      success: true,
      symbol: ticker,
      source: 'stockanalysis',
      availableProviders: ['stockanalysis'],
      data: {
        incomeStatementHistory,
        balanceSheetHistory,
        cashflowStatementHistory,
        keyMetricsHistory,
        incomeStatement,
        balanceSheet,
        cashFlowStatement,
        keyMetrics,
        dividendHistory: [],
        profile: { symbol: ticker, companyName: ticker, exchange, currency: CURRENCY[slug] || 'USD' },
      },
    };
  } catch (e) {
    return { success: false, symbol: ticker, source: 'stockanalysis', error: e.message };
  }
}

function parseMetricValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s || /^(n\/a|upgrade|pro|-|�)$/i.test(s)) return null;
  const num = Number(s.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(num)) return null;
  const mult = /T$/i.test(s) ? 1e12 : /B$/i.test(s) ? 1e9 : /M$/i.test(s) ? 1e6 : /K$/i.test(s) ? 1e3 : 1;
  return num * mult;
}

async function fetchStatsPage(ticker, section) {
  const resp = await axios.get(`${BASE_STOCKS}/${encodeURIComponent(ticker)}/${section}/`, {
    timeout: 20000,
    headers: HEADERS,
  });
  return cheerio.load(resp.data);
}

async function getStatistics(symbol) {
  const m = String(symbol).toUpperCase().match(/^([A-Z]+):(.+)$/);
  const ticker = m ? m[2] : String(symbol).toUpperCase();
  const exchange = m ? m[1] : 'US';
  if (exchange !== 'US' && exchange !== 'STOCKS') return { success: false, source: 'stockanalysis', error: 'Statistics supported for US only' };
  try {
    const $ = await fetchStatsPage(ticker, 'statistics');
    const rows = new Map();
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('th,td').map((__, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
      if (cells.length >= 2 && cells[0] && !rows.has(cells[0])) rows.set(cells[0], cells[1]);
    });
    const raw = (labels) => {
      for (const label of labels) {
        if (rows.has(label)) return rows.get(label);
        const key = [...rows.keys()].find(k => k.toLowerCase().includes(String(label).toLowerCase()));
        if (key) return rows.get(key);
      }
      return null;
    };
    const value = (labels) => parseMetricValue(raw(labels));
    const pct = (labels) => value(labels);
    const data = {
      marketCap: value(['Market Cap']),
      enterpriseValue: value(['Enterprise Value']),
      sharesOutstanding: value(['Shares Outstanding']),
      floatShares: value(['Float']),
      insiderOwnershipPct: pct(['Owned by Insiders (%)', 'Owned by Insiders']),
      institutionalOwnershipPct: pct(['Owned by Institutions (%)', 'Owned by Institutions']),
      beta: value(['Beta (5Y)', 'Beta']),
      week52ChangePct: pct(['52-Week Price Change']),
      sma50: value(['50-Day Moving Average']),
      sma200: value(['200-Day Moving Average']),
      rsi: value(['Relative Strength Index (RSI)']),
      averageVolume20: value(['Average Volume (20 Days)']),
      peRatio: value(['PE Ratio']),
      forwardPE: value(['Forward PE']),
      psRatio: value(['PS Ratio']),
      pbRatio: value(['PB Ratio']),
      pegRatio: value(['PEG Ratio']),
      evEbitda: value(['EV / EBITDA']),
      evFcf: value(['EV / FCF']),
      currentRatio: value(['Current Ratio']),
      quickRatio: value(['Quick Ratio']),
      debtToEquity: value(['Debt / Equity']),
      interestCoverage: value(['Interest Coverage']),
      roePct: pct(['Return on Equity (ROE)', 'ROE']),
      roaPct: pct(['Return on Assets (ROA)', 'ROA']),
      roicPct: pct(['Return on Invested Capital (ROIC)', 'ROIC']),
      rocePct: pct(['Return on Capital Employed (ROCE)']),
      waccPct: pct(['Weighted Average Cost of Capital (WACC)']),
      assetTurnover: value(['Asset Turnover']),
      inventoryTurnover: value(['Inventory Turnover']),
      revenueTTM: value(['Revenue']),
      grossProfitTTM: value(['Gross Profit']),
      operatingIncomeTTM: value(['Operating Income']),
      netIncomeTTM: value(['Net Income']),
      ebitdaTTM: value(['EBITDA']),
      epsTTM: value(['Earnings Per Share (EPS)']),
      cashAndInvestments: value(['Cash & Marketable Securities', 'Cash & Investments']),
      totalDebt: value(['Total Debt']),
      netCash: value(['Net Cash']),
      bookEquity: value(['Equity (Book Value)']),
      workingCapital: value(['Working Capital']),
      operatingCashFlowTTM: value(['Operating Cash Flow']),
      capexTTM: value(['Capital Expenditures']),
      depreciationTTM: value(['Depreciation & Amortization']),
      freeCashFlowTTM: value(['Free Cash Flow']),
      grossMarginPct: pct(['Gross Margin']),
      operatingMarginPct: pct(['Operating Margin']),
      profitMarginPct: pct(['Profit Margin']),
      ebitdaMarginPct: pct(['EBITDA Margin']),
      fcfMarginPct: pct(['FCF Margin']),
      dividendPerShare: value(['Dividend Per Share']),
      dividendYieldPct: pct(['Dividend Yield']),
      payoutRatioPct: pct(['Payout Ratio']),
      fcfYieldPct: pct(['FCF Yield']),
      earningsYieldPct: pct(['Earnings Yield']),
      shortInterest: value(['Short Interest']),
      shortPreviousMonth: value(['Short Previous Month']),
      shortPctSharesOut: pct(['Short % of Shares Out']),
      shortPctFloat: pct(['Short % of Float']),
      shortRatio: value(['Short Ratio (days to cover)']),
      priceTarget: value(['Price Target']),
      analystConsensus: raw(['Analyst Consensus']),
      analystCount: value(['Analyst Count']),
      revenueGrowthForecast3Y: pct(['Revenue Growth Forecast (3Y)']),
      epsGrowthForecast3Y: pct(['EPS Growth Forecast (3Y)']),
      altmanZ: value(['Altman Z-Score']),
      piotroskiF: value(['Piotroski F-Score']),
      effectiveTaxRatePct: pct(['Effective Tax Rate']),
    };
    return { success: true, source: 'stockanalysis', providers: ['S&P Global Market Intelligence', 'TipRanks'], asOf: new Date().toISOString(), data };
  } catch (e) {
    return { success: false, source: 'stockanalysis', error: e.message };
  }
}

async function getForecast(symbol) {
  const m = String(symbol).toUpperCase().match(/^([A-Z]+):(.+)$/);
  const ticker = m ? m[2] : String(symbol).toUpperCase();
  const exchange = m ? m[1] : 'US';
  if (exchange !== 'US' && exchange !== 'STOCKS') return { success: false, source: 'stockanalysis', error: 'Forecast supported for US only' };
  try {
    const $ = await fetchStatsPage(ticker, 'forecast');
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const num = (re) => { const x = text.match(re); return x ? parseMetricValue(x[1]) : null; };
    const count = num(/According to\s+([\d,]+)\s+analysts/i);
    const consensus = (text.match(/consensus rating of\s+"([^"]+)"/i) || [])[1] || null;
    const average = num(/average price target of\s+\$?([\d,.]+)/i);
    const low = num(/lowest is\s+\$?([\d,.]+)/i);
    const high = num(/highest is\s+\$?([\d,.]+)/i);
    const revenueThisYear = num(/Revenue This Year\s+([\d.,]+[BM])/i);
    const revenueNextYear = num(/Revenue Next Year\s+([\d.,]+[BM])/i);
    const epsThisYear = num(/EPS This Year\s+([\d.,-]+)/i);
    const epsNextYear = num(/EPS Next Year\s+([\d.,-]+)/i);
    return {
      success: !!(average || revenueThisYear || epsThisYear),
      source: 'stockanalysis',
      providers: ['S&P Global Market Intelligence', 'TipRanks'],
      asOf: new Date().toISOString(),
      data: {
        analystCount: count,
        consensus,
        priceTarget: average,
        priceTargetLow: low,
        priceTargetHigh: high,
        revenueThisYear,
        revenueNextYear,
        epsThisYear,
        epsNextYear,
        reliability: 'secondary; S&P/TipRanks consensus, not a guarantee',
      },
    };
  } catch (e) {
    return { success: false, source: 'stockanalysis', error: e.message };
  }
}

module.exports = { getFinancialReport, getStatistics, getForecast };
