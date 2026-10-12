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

async function fetchTable(slug, ticker, path) {
  const url = `${BASE}/${slug}/${encodeURIComponent(ticker)}/financials/${path}/`;
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
  for (const l of labels) {
    if (rows[l]) return rows[l];
    const key = Object.keys(rows).find(k => k.replace(/[^a-z]/gi, '').toLowerCase() === l.replace(/[^a-z]/gi, '').toLowerCase());
    if (key) return rows[key];
  }
  return [];
}

async function getFinancialReport(symbol, period = 'annual', limit = 4) {
  const m = String(symbol).toUpperCase().match(/^([A-Z]+):(.+)$/);
  const exchange = m ? m[1] : 'NGX';
  const ticker = m ? m[2] : String(symbol).toUpperCase();
  const slug = EXCHANGE_SLUG[exchange] || String(exchange).toLowerCase();
  if (exchange !== 'NGX' && exchange !== 'JSE') {
    return { success: false, symbol: ticker, source: 'stockanalysis', error: `Unsupported exchange ${exchange}` };
  }

  try {
    const inc = await fetchTable(slug, ticker, 'income-statement');
    const bal = await fetchTable(slug, ticker, 'balance-sheet').catch(() => ({ periods: [], rows: {} }));
    const cf = await fetchTable(slug, ticker, 'cash-flow-statement').catch(() => ({ periods: [], rows: {} }));
    const ratios = await fetchTable(slug, ticker, 'ratios').catch(() => ({ periods: [], rows: {} }));
    const M = 1e6;

    const periods = inc.periods.slice(0, limit + 1); // TTM + limit fiscal years
    const dates = inc.rows['Period Ending'] || inc.rows['Period ending'] || [];
    const revRow = pick(inc.rows, ['Revenue']);
    const niRow = pick(inc.rows, ['Net Income', 'Net Income to Common']);
    const epsRow = pick(inc.rows, ['EPS (Basic)', 'EPS (Diluted)', 'Earnings Per Share']);
    const opIncRow = pick(inc.rows, ['Operating Income']);
    const taxRow = pick(inc.rows, ['Income Tax Expense', 'Income Tax']);

    const incomeStatementHistory = periods.map((p, i) => ({
      date: parseDate(dates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      revenue: (toNumber(revRow[i]) ?? 0) * M,
      netIncome: (toNumber(niRow[i]) ?? 0) * M,
      eps: toNumber(epsRow[i]) ?? 0,
      operatingIncome: (toNumber(opIncRow[i]) ?? 0) * M,
      incomeTaxExpense: (toNumber(taxRow[i]) ?? 0) * M,
    }));

    const balDates = bal.rows['Period Ending'] || [];
    const taRow = pick(bal.rows, ['Total Assets']);
    const tlRow = pick(bal.rows, ['Total Liabilities']);
    const teRow = pick(bal.rows, ['Total Equity', "Total Stockholders' Equity", 'Total Shareholders Equity', 'Shareholders Equity', 'Stockholders Equity', 'Shareholders\u0027 Equity']);
    const debtRow = pick(bal.rows, ['Total Debt']);
    const cashRow = pick(bal.rows, ['Cash & Cash Equivalents', 'Cash & Equivalents', 'Cash And Cash Equivalents', 'Cash & Investments']);
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

    const incomeStatement = {
      date: i0.date,
      revenue,
      netIncome,
      eps: i0.eps || 0,
      operatingIncome,
      incomeTaxExpense: i0.incomeTaxExpense || 0,
      operatingIncomeRatio: revenue ? operatingIncome / revenue : null,
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
      peRatio: rnum(['PE Ratio', 'P/E Ratio']),
      pbRatio: rnum(['PB Ratio', 'P/B Ratio', 'Price/Book']),
      priceToSalesRatio: rnum(['PS Ratio', 'Price/Sales']),
      debtToEquity: rnum(['Debt / Equity Ratio', 'Debt / Equity', 'Debt/Equity', 'Debt To Equity']),
      currentRatio: rnum(['Current Ratio']),
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

module.exports = { getFinancialReport };
