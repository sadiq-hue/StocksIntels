const axios = require('axios');

const BASE_URL = 'https://api.twelvedata.com';
const CACHE_TTL = 15 * 60 * 1000;
const STATS_CACHE_TTL = 60 * 60 * 1000;

const quoteCache = new Map();
const statsCache = new Map();

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttl) { map.delete(key); return null; }
  return hit.data;
}

function cacheSet(map, key, data) {
  map.set(key, { data, ts: Date.now() });
  return data;
}

function getApiKey() {
  return process.env.TWELVE_DATA_API_KEY;
}

async function fetchQuote(symbol) {
  const key = getApiKey();
  if (!key) return null;

  const clean = symbol.toUpperCase().replace(/\./g, '-');
  const cached = cacheGet(quoteCache, clean, CACHE_TTL);
  if (cached) return cached;

  try {
    const resp = await axios.get(`${BASE_URL}/quote`, {
      params: { symbol: clean, apikey: key },
      timeout: 8000,
    });
    const d = resp.data;
    if (d.status === 'error' || !d.symbol) return null;

    const price = Number(d.close || d.previous_close || 0);
    if (!price) return null;

    const result = {
      symbol: clean,
      company_name: d.name || clean,
      price,
      currency: d.currency || 'USD',
      change: Number(d.change || 0),
      changePercent: Number(d.percent_change || 0),
      volume: Number(d.volume || 0),
      dayHigh: Number(d.high || price),
      dayLow: Number(d.low || price),
      previousClose: Number(d.previous_close || price),
      exchange: d.exchange || 'Global',
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      provider: 'twelvedata',
    };
    return cacheSet(quoteCache, clean, result);
  } catch {
    return null;
  }
}

async function fetchStatistics(symbol) {
  const key = getApiKey();
  if (!key) return null;

  const clean = symbol.toUpperCase().replace(/\./g, '-');
  const cached = cacheGet(statsCache, clean, STATS_CACHE_TTL);
  if (cached) return cached;

  try {
    const resp = await axios.get(`${BASE_URL}/statistics`, {
      params: { symbol: clean, apikey: key },
      timeout: 10000,
    });
    const d = resp.data;
    if (d.status === 'error' || !d.statistics) return null;

    const svm = d.statistics.valuations_metrics || {};
    const fin = d.statistics.financials || {};
    const inc = fin.income_statement || {};
    const bal = fin.balance_sheet || {};
    const sss = d.statistics.stock_statistics || {};
    const dps = d.statistics.dividends_and_splits || {};
    const sps = d.statistics.stock_price_summary || {};

    // Complement with quote data to get price
    let price = 0;
    try {
      const qd = await fetchQuote(symbol);
      if (qd) price = qd.price;
    } catch {}

    // Compute price from marketCap / sharesOutstanding if quote unavailable
    if (!price && svm.market_capitalization && sss.shares_outstanding) {
      price = Math.round(svm.market_capitalization / sss.shares_outstanding * 100) / 100;
    }

    const result = {
      symbol: clean,
      companyName: d.name || clean,
      currency: d.currency || 'USD',
      exchange: d.exchange || 'Global',
      price,
      marketCap: svm.market_capitalization || 0,
      peRatio: svm.trailing_pe || 0,
      forwardPE: svm.forward_pe || 0,
      pbRatio: svm.price_to_book_mrq || 0,
      priceToSales: svm.price_to_sales_ttm || 0,
      enterpriseValue: svm.enterprise_value || 0,
      enterpriseToRevenue: svm.enterprise_to_revenue || 0,
      enterpriseToEbitda: svm.enterprise_to_ebitda || 0,
      eps: inc.diluted_eps_ttm || 0,
      revenueTTM: inc.revenue_ttm || 0,
      grossProfitTTM: inc.gross_profit_ttm || 0,
      ebitda: inc.ebitda || 0,
      netIncomeTTM: inc.net_income_to_common_ttm || 0,
      totalCash: bal.total_cash_mrq || 0,
      totalDebt: bal.total_debt_mrq || 0,
      totalDebtToEquity: bal.total_debt_to_equity_mrq || 0,
      currentRatio: bal.current_ratio_mrq || 0,
      bookValuePerShare: bal.book_value_per_share_mrq || 0,
      operatingCashFlowTTM: fin.cash_flow?.operating_cash_flow_ttm || 0,
      freeCashFlowTTM: fin.cash_flow?.levered_free_cash_flow_ttm || 0,
      dividendRate: dps.forward_annual_dividend_rate || 0,
      dividendYield: dps.forward_annual_dividend_yield || 0,
      payoutRatio: dps.payout_ratio || 0,
      dividendFrequency: dps.dividend_frequency || '',
      exDividendDate: dps.ex_dividend_date || '',
      sharesOutstanding: sss.shares_outstanding || 0,
      beta: sps.beta || 0,
      fiftyTwoWeekLow: sps.fifty_two_week_low || 0,
      fiftyTwoWeekHigh: sps.fifty_two_week_high || 0,
      fiftyTwoWeekChange: sps.fifty_two_week_change || 0,
      day50MA: sps.day_50_ma || 0,
      day200MA: sps.day_200_ma || 0,
      lastUpdated: new Date().toISOString(),
    };
    return cacheSet(statsCache, clean, result);
  } catch {
    return null;
  }
}

async function fetchQuoteWithStats(symbol) {
  const [quote, stats] = await Promise.allSettled([
    fetchQuote(symbol),
    fetchStatistics(symbol),
  ]);

  const q = quote.status === 'fulfilled' ? quote.value : null;
  const s = stats.status === 'fulfilled' ? stats.value : null;

  if (!q && s) {
    // Use statistics as standalone quote (price may be computed from marketCap/sharesOutstanding)
    return s;
  }

  if (!q) return null;

  if (s) {
    q.marketCap = s.marketCap;
    q.peRatio = s.peRatio;
    q.forwardPE = s.forwardPE;
    q.pbRatio = s.pbRatio;
    q.eps = s.eps;
    q.dividendYield = s.dividendYield;
    q.sharesOutstanding = s.sharesOutstanding;
    q.enterpriseValue = s.enterpriseValue;
    q.beta = s.beta;
  }

  return q;
}

async function fetchBatchQuotes(symbols) {
  const results = {};
  const uncached = [];

  for (const sym of symbols) {
    const clean = sym.toUpperCase().replace(/\./g, '-');
    const cached = cacheGet(quoteCache, clean, CACHE_TTL);
    if (cached) results[sym] = cached;
    else uncached.push(clean);
  }

  if (uncached.length === 0) return results;

  const key = getApiKey();
  if (!key) return results;

  for (const sym of uncached) {
    try {
      const q = await fetchQuote(sym);
      if (q) results[sym] = q;
    } catch {}
  }

  return results;
}

async function fetchBatchStatistics(symbols) {
  const results = {};

  for (const sym of symbols) {
    const clean = sym.toUpperCase().replace(/\./g, '-');
    const cached = cacheGet(statsCache, clean, STATS_CACHE_TTL);
    if (cached) results[sym] = cached;
    else {
      const s = await fetchStatistics(sym);
      if (s) results[sym] = s;
    }
  }

  return results;
}

function clearCache() {
  quoteCache.clear();
  statsCache.clear();
}

module.exports = {
  fetchQuote,
  fetchStatistics,
  fetchQuoteWithStats,
  fetchBatchQuotes,
  fetchBatchStatistics,
  clearCache,
};
