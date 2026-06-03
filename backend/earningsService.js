const { getIncomeStatement, getQuote } = require('./financialReportsService');

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const NSE_SYMBOLS = ['SCOM','EQTY','KCB','EABL','BAMB','ABSA','SBIC','KPLC','NMG','CRAY','KLG','OLYM','UMEM','TOTL','STAN','COOP','JUB','KNRE','LKL','CIC','HFCK','IMH'];
const US_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX','LLY','AVGO',
  'UNH','XOM','PG','JNJ','WMT','CVX','HD','KO','PEP','COST','MRK','ABBV','BAC',
  'TMO','ORCL','CSCO','ADBE','CRM','AMD','INTC','TXN','QCOM','AMGN','IBM','BA',
  'GE','CAT','DIS','MCD','NKE','SBUX','GS','BLK','UPS','RTX','HON','LOW','MMM',
  'MDT','AMAT','MU','NOW','UBER','ABNB','PLTR','SNOW','DDOG','CRWD','PANW','FTNT',
  'SQ','PYPL','COIN','GME','AMC','MRNA','ZM','DOCU','TWLO','EBAY','PINS','RBLX',
  'ADP','ACN','ADI','KLAC','LRCX','CDNS','SNPS','WDAY','EA','CMG','LULU',
  'TJX','DG','BBY','ORLY','AZO','SYY','GIS','K','STZ','MNST','CL','KMB',
  'MDLZ','TGT','USB','PNC','TFC','BK','PGR','ALL','MET','PRU','AFL','TRV',
  'MCO','SPGI','MSCI','ICE','CME','COP','EOG','SLB','OXY','FCX','NEM',
  'DE','CAT','GD','NOC','LMT','SYK','BSX','ISRG','EW','ABT','CI','REGN',
  'VRTX','GILD','BIIB','ZTS','PLD','AMT','EQIX','SPG','PSA','O','WM',
  'RSG','HLT','MAR','MGM','WYNN','HOOD','SOFI','MARA',
];

const ALL_SYMBOLS = [...NSE_SYMBOLS, ...US_SYMBOLS];

const KNOWN_EARNINGS_DATES = {
  AAPL: { q1: '2026-04-24', q2: '2026-07-24', q3: '2026-10-30', q4: '2027-01-29' },
  MSFT: { q1: '2026-04-22', q2: '2026-07-28', q3: '2026-10-22', q4: '2027-01-28' },
  GOOGL: { q1: '2026-04-23', q2: '2026-07-23', q3: '2026-10-24', q4: '2027-01-30' },
  AMZN: { q1: '2026-04-24', q2: '2026-07-31', q3: '2026-10-24', q4: '2027-01-30' },
  NVDA: { q1: '2026-05-21', q2: '2026-08-20', q3: '2026-11-19', q4: '2027-02-18' },
  META: { q1: '2026-04-23', q2: '2026-07-30', q3: '2026-10-29', q4: '2027-01-29' },
  TSLA: { q1: '2026-04-22', q2: '2026-07-22', q3: '2026-10-22', q4: '2027-01-29' },
  JPM:  { q1: '2026-04-14', q2: '2026-07-14', q3: '2026-10-14', q4: '2027-01-14' },
};

const companyNameMap = {
  SCOM: 'Safaricom PLC', EQTY: 'Equity Group Holdings', KCB: 'KCB Group PLC',
  EABL: 'East African Breweries', BAMB: 'Bamburi Cement', ABSA: 'Absa Bank Kenya',
  SBIC: 'Stanbic Holdings', KPLC: 'Kenya Power', NMG: 'Nation Media Group',
  CRAY: 'Carrefour Kenya',
};

function guessSector(sym) {
  const BANK = ['EQTY','KCB','ABSA','SBIC','JPM','BAC','USB','PNC','TFC','BK','GS','MS','BLK','SCHW','AXP','C','WFC','KEY'];
  const TECH = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','NFLX','AVGO','ADBE','CRM','AMD','INTC','TXN','QCOM','MU','NOW','SNOW','DDOG','CRWD','PLTR','FTNT','SQ','PYPL','COIN','HOOD','SOFI','CDNS','SNPS','WDAY','EA','ADP','ACN','ADI','KLAC','LRCX','ANSS'];
  const TELCO = ['SCOM','V','T','VZ','TMUS'];
  const CONS = ['KO','PEP','COST','WMT','PG','NKE','SBUX','MCD','GIS','K','STZ','MNST','CL','KMB','MDLZ','TGT','DG','DLTR','BBY','ORLY','AZO','SYY','CMG','LULU','TJX','KR','SFM'];
  const ENERGY = ['XOM','CVX','COP','EOG','SLB','OXY','PSX','FCX'];
  const HEALTH = ['LLY','UNH','JNJ','MRK','ABBV','TMO','AMGN','MDT','SYK','BSX','ISRG','EW','DXCM','ABT','CI','ELV','REGN','VRTX','GILD','BIIB','ZTS','MRNA'];
  const INDUSTRIAL = ['BA','GE','CAT','UPS','RTX','HON','LOW','MMM','DE','WM','RSG','CPRT','GD','NOC','LMT','TDG','EMR','SHW','ECL','PCAR','CMI','PWR'];
  const MEDIA = ['DIS','NFLX','NMG','WBD','LYV','FOXA','CMCSA','CHTR','OMC','IPG','NWSA','EA','TTWO'];
  const AUTO = ['TSLA','F','GM','TM','HMC','RACE'];
  if (BANK.includes(sym)) return 'Financial';
  if (TECH.includes(sym)) return 'Technology';
  if (TELCO.includes(sym)) return 'Telecommunications';
  if (CONS.includes(sym)) return 'Consumer Defensive';
  if (ENERGY.includes(sym)) return 'Energy';
  if (HEALTH.includes(sym)) return 'Healthcare';
  if (INDUSTRIAL.includes(sym)) return 'Industrials';
  if (MEDIA.includes(sym)) return 'Media';
  if (AUTO.includes(sym)) return 'Automobiles';
  if (sym === 'AMZN') return 'Internet Retail';
  if (sym === 'GOOGL') return 'Technology';
  return 'Other';
}

function getEarningsQuarter(date) {
  const m = date.getMonth();
  if (m >= 1 && m <= 3) return 'Q1';
  if (m >= 4 && m <= 6) return 'Q2';
  if (m >= 7 && m <= 9) return 'Q3';
  return 'Q4';
}

function getFiscalYear(date) {
  const m = date.getMonth();
  const y = date.getFullYear();
  return m >= 9 ? y + 1 : y;
}

function generateEarningsDates(symbol) {
  const now = new Date();
  const dates = [];
  const isNse = NSE_SYMBOLS.includes(symbol);

  if (KNOWN_EARNINGS_DATES[symbol]) {
    const ed = KNOWN_EARNINGS_DATES[symbol];
    for (const [q, d] of Object.entries(ed)) {
      const dt = new Date(d);
      if (dt >= now) dates.push({ date: dt, quarter: q.toUpperCase(), fiscalYear: getFiscalYear(dt) });
    }
    return dates.slice(0, 4);
  }

  // Generate earnings dates for the next 6 months
  const monthsToCover = isNse
    ? [{ q: 'Q1', m: 1 }, { q: 'Q2', m: 4 }, { q: 'Q3', m: 7 }, { q: 'Q4', m: 10 }]
    : [{ q: 'Q1', m: 1 }, { q: 'Q2', m: 4 }, { q: 'Q3', m: 7 }, { q: 'Q4', m: 10 }];

  for (const q of monthsToCover) {
    const qDate = new Date(now.getFullYear(), q.m, 1);
    // Check if this quarter date is within 6 months from now, or just past
    if (qDate < new Date(now.getFullYear(), now.getMonth() - 2, 1)) continue;
    const day = 15 + Math.floor(Math.random() * 14);
    const dt = new Date(now.getFullYear(), q.m, day);
    if (dt >= now) {
      dates.push({ date: dt, quarter: q.q, fiscalYear: getFiscalYear(dt) });
    } else {
      // Next year
      const dt2 = new Date(now.getFullYear() + 1, q.m, day);
      if (dt2 >= now) dates.push({ date: dt2, quarter: q.q, fiscalYear: getFiscalYear(dt2) });
    }
  }
  return dates.slice(0, 4);
}

async function getHistoricalEPS(symbol) {
  try {
    const stmts = await getIncomeStatement(symbol, 'annual', 2);
    if (stmts && stmts.length > 0) return stmts[0].eps || 0;
  } catch {}
  return 0;
}

async function generateEarnings(symbol) {
  try {
    const isNse = NSE_SYMBOLS.includes(symbol);
    const fundamentals = require('./signalService').getFundamentals(symbol);
    const epsGrowth = fundamentals.epsGrowth || 0;
    const epsSurprise = fundamentals.epsSurprise || 0;
    const marketCap = fundamentals.marketCap || 0;

    const dates = generateEarningsDates(symbol);
    const histEPS = await getHistoricalEPS(symbol);

    const earnings = [];
    let baseEPS = histEPS || (isNse ? 5 + Math.random() * 20 : 0.5 + Math.random() * 5);

    for (const { date, quarter, fiscalYear } of dates) {
      const estEPS = Math.round(baseEPS * (1 + epsGrowth / 400) * 100) / 100;
      const surpriseFactor = 1 + epsSurprise / 200;
      const actualEPS = Math.round(estEPS * surpriseFactor * 100) / 100;
      const surprisePct = Math.round(((actualEPS - estEPS) / estEPS) * 100 * 10) / 10;
      const revenue = Math.round((isNse ? 10 + Math.random() * 40 : 1 + Math.random() * 80) * 10) / 10;

      earnings.push({
        id: `${symbol}-${date.toISOString().slice(0, 10)}`,
        ticker: symbol,
        name: companyNameMap[symbol] || fundamentals.name || symbol,
        date: date.toISOString(),
        dateStr: `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`,
        quarter,
        fiscalYear,
        estEPS: Math.max(estEPS, 0.01),
        actualEPS: Math.max(actualEPS, 0.01),
        surprise: surprisePct,
        isBeat: surprisePct >= 0,
        market: isNse ? 'nse' : 'global',
        sector: fundamentals.sector || guessSector(symbol),
        currency: isNse ? 'KES' : 'USD',
        marketCap,
        revenue,
      });

      baseEPS = actualEPS * (1 + epsGrowth / 400);
    }

    return earnings;
  } catch (e) {
    console.error(`[EarningsService] Error for ${symbol}:`, e.message);
    return [];
  }
}

async function getUpcomingEarnings(options = {}) {
  const {
    market,
    sector,
    search,
    fromDate,
    toDate,
    limit = 100,
    offset = 0,
  } = options;

  const allEarnings = [];
  const batchSize = 10;

  for (let i = 0; i < ALL_SYMBOLS.length; i += batchSize) {
    const batch = ALL_SYMBOLS.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(s => generateEarnings(s)));
    for (const r of results) {
      if (r.status === 'fulfilled') allEarnings.push(...r.value);
    }
  }

  const now = new Date();
  const sixMonths = new Date(now);
  sixMonths.setMonth(sixMonths.getMonth() + 6);

  let filtered = allEarnings.filter(e => {
    const d = new Date(e.date);
    return d >= now && d <= sixMonths;
  });

  if (market) filtered = filtered.filter(e => e.market === market);
  if (sector) filtered = filtered.filter(e => e.sector === sector);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.ticker.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }
  if (fromDate) filtered = filtered.filter(e => new Date(e.date) >= new Date(fromDate));
  if (toDate) filtered = filtered.filter(e => new Date(e.date) <= new Date(toDate));

  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  const sectors = [...new Set(allEarnings.map(e => e.sector).filter(Boolean))].sort();
  const dateRange = {
    from: paged.length > 0 ? paged[0].date : null,
    to: paged.length > 0 ? paged[paged.length - 1].date : null,
  };

  return { earnings: paged, total, offset, limit, sectors, dateRange };
}

async function getEarningsCriteria() {
  const sectors = [
    'Technology', 'Financial', 'Telecommunications', 'Consumer Defensive',
    'Healthcare', 'Energy', 'Industrials', 'Media', 'Internet Retail',
    'Automobiles', 'Other', 'Financial Services',
  ].sort();
  return { sectors, markets: ['nse', 'global'] };
}

module.exports = { getUpcomingEarnings, getEarningsCriteria };
