// StockAnalysis.com financials scraper.
//
// Used for exchanges that Yahoo Finance / SEC EDGAR do not cover — today that is
// NGX (Nigeria) and, as a fallback, JSE (South Africa). Financial data on
// stockanalysis.com is provided by S&P Global Market Intelligence.
//
// Symbol form: "NGX:DANGCEM" / "JSE:MTN".  Values on the page are in millions of
// the reporting currency; we scale to raw units to match the Yahoo path.

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://stockanalysis.com/quote';
const EXCHANGE_SLUG = { NGX: 'ngx', JSE: 'jse' };
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

// Parse the single financial table on a stockanalysis financials page into
// { periods: [...], rows: { label: [values per period] } }.
async function fetchTable(slug, ticker, path) {
  const url = `${BASE}/${slug}/${encodeURIComponent(ticker)}/financials/${path}/`;
  const resp = await axios.get(url, { timeout: 20000, headers: HEADERS });
  const $ = cheerio.load(resp.data);
  let periods = null;
  let rows = {};
  $('table').each((_, table) => {
    const parsed = [];
    $(table).find('tr').each((__, tr) => {
      parsed.push($(tr).find('th,td').map((___, c) => $(c).text().trim()).get());
    });
    const header = parsed.find(r => r[0] && /fiscal year/i.test(r[0]));
    if (header && header.length > 2) {
      periods = header.slice(1);
      rows = {};
      for (const r of parsed) {
        if (!r[0] || r[0] === '') continue;
        if (!rows[r[0]]) rows[r[0]] = r.slice(1);
      }
      return false;
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

const CURRENCY = { ngx: 'NGN', jse: 'ZAR' };

async function getFinancialReport(symbol, period = 'annual', limit = 4) {
  const m = String(symbol).toUpperCase().match(/^([A-Z]+):(.+)$/);
  const exchange = m ? m[1] : 'NGX';
  const ticker = m ? m[2] : String(symbol).toUpperCase();
  const slug = EXCHANGE_SLUG[exchange] || String(exchange).toLowerCase();
  if (!EXCHANGE_SLUG[exchange] && exchange !== 'NGX' && exchange !== 'JSE') {
    return { success: false, symbol: ticker, source: 'stockanalysis', error: `Unsupported exchange ${exchange}` };
  }

  try {
    const inc = await fetchTable(slug, ticker, 'income-statement');
    const bal = await fetchTable(slug, ticker, 'balance-sheet').catch(() => ({ periods: [], rows: {} }));
    const cf = await fetchTable(slug, ticker, 'cash-flow-statement').catch(() => ({ periods: [], rows: {} }));

    const periods = inc.periods.slice(0, limit + 1); // TTM + limit fiscal years
    const dates = inc.rows['Period Ending'] || inc.rows['Period ending'] || [];
    const revRow = pick(inc.rows, ['Revenue']);
    const niRow = pick(inc.rows, ['Net Income', 'Net Income to Common']);
    const epsRow = pick(inc.rows, ['EPS (Basic)', 'EPS (Diluted)', 'Earnings Per Share']);
    const M = 1e6;

    const incomeStatementHistory = periods.map((p, i) => ({
      date: parseDate(dates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      revenue: (toNumber(revRow[i]) ?? 0) * M,
      netIncome: (toNumber(niRow[i]) ?? 0) * M,
      eps: toNumber(epsRow[i]) ?? 0,
    }));

    const balDates = bal.rows['Period Ending'] || [];
    const taRow = pick(bal.rows, ['Total Assets']);
    const tlRow = pick(bal.rows, ['Total Liabilities']);
    const teRow = pick(bal.rows, ['Total Equity', "Total Stockholders' Equity", 'Total Shareholders Equity', 'Stockholders Equity']);
    const balanceSheetHistory = bal.periods.slice(0, limit + 1).map((p, i) => ({
      date: parseDate(balDates[i] || p),
      period: /TTM/i.test(p) ? 'ttm' : 'annual',
      totalAssets: (toNumber(taRow[i]) ?? 0) * M,
      totalLiabilities: (toNumber(tlRow[i]) ?? 0) * M,
      totalStockholdersEquity: (toNumber(teRow[i]) ?? 0) * M,
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
      date: r.date,
      revenue: r.revenue,
      netIncome: r.netIncome,
      eps: r.eps,
    }));

    if (incomeStatementHistory.every(r => !r.revenue && !r.netIncome)) {
      return { success: false, symbol: ticker, source: 'stockanalysis', error: `No financial rows parsed for ${ticker}` };
    }

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
        dividendHistory: [],
        profile: {
          symbol: ticker,
          companyName: ticker,
          exchange,
          currency: CURRENCY[slug] || 'USD',
        },
      },
    };
  } catch (e) {
    return { success: false, symbol: ticker, source: 'stockanalysis', error: e.message };
  }
}

module.exports = { getFinancialReport };
