require('dotenv').config();
const axios = require('axios');

const SEC_EDGAR_API_KEY = process.env.SEC_EDGAR_API_KEY || '';
const SEC_BASE_URL = 'https://data.sec.gov';
const USER_AGENT = 'StocksIntels/1.0 (contact@stockintel.app)';

// Direct axios instance for SEC EDGAR (bypasses generic client to avoid Bottleneck issues)
const edgarClient = axios.create({ timeout: 30000 });
edgarClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    console.error(`[EDGAR] ${err.config?.url?.substring(0, 80)} → ${status ? `HTTP ${status}` : err.code}`);
    return Promise.reject(err);
  }
);

const PersistentCache = require('./cacheService');
const cache = new PersistentCache('edgar', 24 * 60 * 60 * 1000);

function cacheGet(key) {
  return cache.get(key);
}

function cacheSet(key, data) {
  return cache.set(key, data);
}

function padCik(cik) {
  return String(cik).padStart(10, '0');
}

const CIK_MAP = {
  AAPL: 320193, MSFT: 789019, GOOGL: 1652044, GOOG: 1652044,
  AMZN: 1018724, NVDA: 1045810, META: 1326801, TSLA: 1318605,
  JPM: 19617, V: 1403161, NFLX: 1065280, LLY: 59478,
  AVGO: 1730168, UNH: 731766, XOM: 34088, PG: 80424,
  JNJ: 200406, WMT: 104169, CVX: 93410, HD: 354950,
  KO: 21344, PEP: 77476, COST: 909832, MRK: 310158,
  ABBV: 1551152, BAC: 70858, TMO: 1040502, ORCL: 1341439,
  CSCO: 858877, ADBE: 796343, CRM: 1108524, AMD: 2488,
  INTC: 50863, TXN: 97476, QCOM: 804328, AMGN: 318154,
  IBM: 51143, BA: 12927, GE: 40545, CAT: 18230,
  DIS: 1744489, MCD: 63908, NKE: 320187, SBUX: 829224,
  GS: 886982, MS: 895421, C: 831001, WFC: 72971,
  BLK: 1364742, SCHW: 316709, AXP: 4962, UPS: 1090727,
  RTX: 101829, HON: 773840, LOW: 60667, MMM: 66740,
  MDT: 1613103, AMAT: 6951, MU: 723125, NOW: 1373715,
  UBER: 1543151, ABNB: 1559720, PLTR: 1321655, SNOW: 1640147,
  DDOG: 1561550, CRWD: 1533656, PANW: 1327567, FTNT: 1262039,
  SQ: 1512673, PYPL: 1633917, COIN: 1679788,
  // Tech & Internet
  ARM: 1858050, RDDT: 1858003, HOOD: 1783879, SNAP: 1564408,
  PINS: 1506293, U: 1810997, AFRM: 1824521, DOCU: 1261333,
  ZM: 1585521, OKTA: 1660134, MDB: 1441816, NET: 1474437,
  WDAY: 1327811, TEAM: 1650372, HUBS: 1408105, TWLO: 1477720,
  DASH: 1792783, S: 1858017, IONQ: 1824925, RKLB: 1819994,
  SOFI: 1828015, UPST: 1647654,
  // Healthcare & Pharma
  PFE: 78003, BMY: 14272, GILD: 882095, VRTX: 875320,
  REGN: 872589, MRNA: 1682852, BIIB: 835915, CVS: 64803,
  HUM: 49071, CI: 701221, ELV: 1156039, ISRG: 1035267,
  SYK: 310764, EW: 874716, ZTS: 1555280, BSX: 885725,
  // Consumer & Retail
  TGT: 27419, KR: 56873, WBA: 104496, DG: 29534, DLTR: 935703,
  ROST: 745732, TJX: 109198, LOW: 60667, ORLY: 898174, AZO: 866787,
  // Industrials & Defense
  LMT: 936468, NOC: 1133421, GD: 40533, RTX: 101829, LHX: 552691,
  TXT: 217346, CARR: 1783180, OTIS: 1781335, EMR: 32604, MMM: 66740,
  // Energy
  COP: 1163165, EOG: 821189, SLB: 115805, OXY: 797468,
  HAL: 421236, BKR: 1704360, MPC: 1510295, PSX: 1534701,
  VLO: 103500, DVN: 1090012,
  // Financial Services
  ACGL: 1162290, MET: 1099219, PRU: 1137774, AIG: 5272,
  MMC: 62709, AON: 315293, AJG: 354190, BRO: 79282,
  TFC: 92230, USB: 36104, PNC: 713676, FITB: 35527,
  KEY: 1598026, HBAN: 731766, CFG: 798949, RF: 1281761,
};

const US_GAAP_TAGS = {
  revenue: ['us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:Revenues', 'us-gaap:SalesRevenueNet', 'us-gaap:SalesRevenueGoodsNet', 'us-gaap:SalesRevenueServicesNet'],
  costOfRevenue: ['us-gaap:CostOfRevenue', 'us-gaap:CostOfGoodsSold'],
  grossProfit: ['us-gaap:GrossProfit'],
  operatingExpenses: ['us-gaap:OperatingExpenses'],
  operatingIncome: ['us-gaap:OperatingIncomeLoss'],
  netIncome: ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss'],
  epsBasic: ['us-gaap:EarningsPerShareBasic'],
  epsDiluted: ['us-gaap:EarningsPerShareDiluted'],
  incomeTax: ['us-gaap:IncomeTaxExpenseBenefit'],
  interestExpense: ['us-gaap:InterestExpense', 'us-gaap:InterestExpenseNonoperating'],
  ebitda: ['us-gaap:EarningsBeforeInterestTaxesDepreciationAndAmortization'],
  cash: ['us-gaap:CashAndCashEquivalentsAtCarryingValue'],
  inventory: ['us-gaap:InventoryNet'],
  currentAssets: ['us-gaap:AssetsCurrent'],
  nonCurrentAssets: ['us-gaap:AssetsNoncurrent'],
  totalAssets: ['us-gaap:Assets'],
  currentLiabilities: ['us-gaap:LiabilitiesCurrent'],
  nonCurrentLiabilities: ['us-gaap:LiabilitiesNoncurrent'],
  totalLiabilities: ['us-gaap:Liabilities'],
  retainedEarnings: ['us-gaap:RetainedEarningsAccumulatedDeficit'],
  stockholdersEquity: ['us-gaap:StockholdersEquity', 'us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  totalEquity: ['us-gaap:Equity', 'us-gaap:EquityAttributableToParent'],
  longTermDebt: ['us-gaap:LongTermDebt', 'us-gaap:LongTermDebtAndCapitalLeaseObligations', 'us-gaap:DebtLongtermAndShorttermCombinedAmount'],
  treasuryStock: ['us-gaap:TreasuryStockValue', 'us-gaap:TreasuryStock', 'us-gaap:TreasuryStockCommonValue'],
  additionalPaidInCapital: ['us-gaap:AdditionalPaidInCapitalCommonStock', 'us-gaap:AdditionalPaidInCapital', 'us-gaap:PaidInCapital'],
  operatingCashFlow: ['us-gaap:NetCashProvidedByUsedInOperatingActivities', 'us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['us-gaap:PaymentsToAcquireProductiveAssets', 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment'],
  dividendsPaid: ['us-gaap:DividendsPaid', 'us-gaap:PaymentsOfDividends'],
  shareRepurchases: ['us-gaap:PaymentsForRepurchaseOfCommonStock', 'us-gaap:RepurchaseOfCommonStock', 'us-gaap:StockRepurchased'],
  shareIssued: ['us-gaap:IssuanceOfCommonStock', 'us-gaap:ProceedsFromIssuanceOfCommonStock'],
  netCommonStockIssuance: ['us-gaap:ProceedsFromStockOptionsExercised', 'us-gaap:ProceedsFromIssuanceOfCommonStock'],
  sharesOutstanding: ['us-gaap:EntityCommonStockSharesOutstanding'],
  stockBasedCompensation: ['us-gaap:StockBasedCompensation', 'us-gaap:ShareBasedCompensation', 'us-gaap:AllocatedShareBasedCompensationExpense'],
  marketCap: [],  // calculated
};

function factLookup(facts, tag) {
  // SEC EDGAR API may return keys with or without the us-gaap: prefix
  return facts[tag] || facts[tag.replace('us-gaap:', '')] || null;
}

function getFiscalYear(facts, tagKeys) {
  for (const tag of tagKeys) {
    const entries = factLookup(facts, tag);
    if (!entries) continue;
    const units = entries.units;
    const usd = units?.USD || units?.USD_per_share || units?.['USD/shares'] || units?.shares || units?.pure;
    if (!usd || usd.length === 0) continue;
    const annual = usd.filter(e => e.frame && e.frame.endsWith('I') && e.fy);
    if (annual.length > 0) {
      const sorted = annual.sort((a, b) => b.fy - a.fy);
      return sorted;
    }
    const byFy = {};
    for (const e of usd) {
      if (e.fy) {
        const key = e.fy;
        if (!byFy[key] || e.fp === 'FY') byFy[key] = e;
      }
    }
    const years = Object.values(byFy).sort((a, b) => b.fy - a.fy);
    if (years.length > 0) return years;
    const allSorted = usd.filter(e => e.fy).sort((a, b) => b.fy - a.fy);
    if (allSorted.length > 0) return allSorted;
  }
  return [];
}

function getLatestValue(facts, tagKeys) {
  const entries = getFiscalYear(facts, tagKeys);
  return entries.length > 0 ? entries[0].val : null;
}

function pickAnnualEntries(entries) {
  const annual = entries.filter(e => e.fp === 'FY' || !e.fp);
  if (annual.length > 0) return annual.sort((a, b) => b.fy - a.fy);
  return entries.sort((a, b) => b.fy - a.fy);
}

const inflightFacts = new Map();
async function fetchCompanyFacts(cik) {
  const cacheKey = `edgar_facts_${cik}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (inflightFacts.has(cik)) return inflightFacts.get(cik);

  const promise = (async () => {
    const url = `${SEC_BASE_URL}/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
    console.log(`[EDGAR] Fetching company facts for CIK ${cik}...`);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await edgarClient.get(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
        });
        const usGaap = res.data?.facts?.['us-gaap'] || {};
        const dei = res.data?.facts?.['dei'] || {};
        // Merge dei facts into us-gaap so EntityCommonStockSharesOutstanding etc. are accessible
        for (const key of Object.keys(dei)) {
          if (!usGaap[key]) usGaap[key] = dei[key];
        }
        const tagCount = Object.keys(usGaap).length;
        const revenueTag = 'RevenueFromContractWithCustomerExcludingAssessedTax';
        console.log(`[EDGAR] Company facts for CIK ${cik}: ${tagCount} tags (incl ${Object.keys(dei).length} dei), revenue=${!!usGaap[revenueTag]}`);
        if (tagCount > 0) console.log(`[EDGAR] Sample tags: ${Object.keys(usGaap).slice(0, 3).join(', ')}...`);
        return cacheSet(cacheKey, res.data);
      } catch (err) {
        const status = err?.response?.status;
        const statusText = status ? `HTTP ${status}` : err.code;
        console.warn(`[EDGAR] Attempt ${attempt + 1}/3 for CIK ${cik}: ${statusText}`);
        if (attempt < 2) {
          const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error(`[EDGAR] Failed to fetch company facts for CIK ${cik} after 3 attempts`);
        }
      }
    }
    return null;
  })();

  inflightFacts.set(cik, promise);
  try {
    return await promise;
  } finally {
    inflightFacts.delete(cik);
  }
}

async function fetchSubmissions(cik) {
  const cacheKey = `edgar_submissions_${cik}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${SEC_BASE_URL}/submissions/CIK${padCik(cik)}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await edgarClient.get(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
      return cacheSet(cacheKey, res.data);
    } catch (err) {
      const status = err?.response?.status;
      if (attempt < 2) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`[EDGAR] Retrying submissions for CIK ${cik} (attempt ${attempt + 2}/3): ${status ? `HTTP ${status}` : err.code}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[EDGAR] Error fetching submissions for CIK ${cik} after 3 attempts: ${status ? `HTTP ${status}` : err.code}`);
      }
    }
  }
  return null;
}

function cikLookup(ticker) {
  const upper = ticker.toUpperCase().replace('NSE:', '');
  return CIK_MAP[upper] || null;
}

async function getIncomeStatementFromEdgar(symbol, period = 'annual', limit = 4) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || {};
  const revenueEntries = getFiscalYear(facts, US_GAAP_TAGS.revenue);
  if (revenueEntries.length === 0) return null;

  const selected = pickAnnualEntries(revenueEntries).slice(0, limit);
  const statements = [];

  for (const entry of selected) {
    const fy = entry.fy;
    const date = entry.filed || `${fy}-12-31`;

    const revenue = entry.val;
    const costOfRevenue = getLatestValueByFy(facts, US_GAAP_TAGS.costOfRevenue, fy) || 0;
    const grossProfit = getLatestValueByFy(facts, US_GAAP_TAGS.grossProfit, fy) || (revenue - costOfRevenue);
    const opEx = getLatestValueByFy(facts, US_GAAP_TAGS.operatingExpenses, fy) || 0;
    const opIncome = getLatestValueByFy(facts, US_GAAP_TAGS.operatingIncome, fy) || (grossProfit - opEx);
    const netIncome = getLatestValueByFy(facts, US_GAAP_TAGS.netIncome, fy) || 0;
    const eps = getLatestValueByFy(facts, US_GAAP_TAGS.epsBasic, fy) || 0;
    const epsDil = getLatestValueByFy(facts, US_GAAP_TAGS.epsDiluted, fy) || eps;
    const tax = getLatestValueByFy(facts, US_GAAP_TAGS.incomeTax, fy) || 0;
    const interest = getLatestValueByFy(facts, US_GAAP_TAGS.interestExpense, fy) || 0;

    statements.push({
      date,
      period,
      revenue,
      costOfRevenue,
      grossProfit,
      grossProfitRatio: revenue > 0 ? grossProfit / revenue : 0,
      operatingExpenses: opEx,
      operatingIncome: opIncome,
      operatingIncomeRatio: revenue > 0 ? opIncome / revenue : 0,
      netIncome,
      netIncomeRatio: revenue > 0 ? netIncome / revenue : 0,
      ebitda: getLatestValueByFy(facts, US_GAAP_TAGS.ebitda, fy) || Math.round(opIncome * 1.18),
      incomeTaxExpense: tax,
      interestExpense: interest,
      eps: eps,
      epsdiluted: epsDil,
    });
  }

  return statements;
}

function getLatestValueByFy(facts, tagKeys, fy) {
  for (const tag of tagKeys) {
    const entries = factLookup(facts, tag);
    if (!entries) continue;
    const units = entries.units;
    const usd = units?.USD || units?.USD_per_share || units?.['USD/shares'] || units?.shares || units?.pure;
    if (!usd) continue;
    const matches = usd.filter(e => e.fy === fy && (e.fp === 'FY' || true));
    if (matches.length > 0) {
      const sorted = matches.sort((a, b) => (b.filed || '').localeCompare(a.filed || ''));
      return sorted[0].val;
    }
  }
  return null;
}

async function getBalanceSheetFromEdgar(symbol, period = 'annual', limit = 4) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || {};
  const assetsEntries = getFiscalYear(facts, US_GAAP_TAGS.totalAssets);
  if (assetsEntries.length === 0) return null;

  const selected = pickAnnualEntries(assetsEntries).slice(0, limit);
  const statements = [];

  for (const entry of selected) {
    const fy = entry.fy;
    const date = entry.filed || `${fy}-12-31`;

    const totalAssets = entry.val;
    const cash = getLatestValueByFy(facts, US_GAAP_TAGS.cash, fy) || 0;
    const inventory = getLatestValueByFy(facts, US_GAAP_TAGS.inventory, fy) || 0;
    const currentAssets = getLatestValueByFy(facts, US_GAAP_TAGS.currentAssets, fy) || 0;
    const nonCurrentAssets = getLatestValueByFy(facts, US_GAAP_TAGS.nonCurrentAssets, fy) || (totalAssets - currentAssets);
    const totalLiabilities = getLatestValueByFy(facts, US_GAAP_TAGS.totalLiabilities, fy) || 0;
    const currentLiabilities = getLatestValueByFy(facts, US_GAAP_TAGS.currentLiabilities, fy) || 0;
    const nonCurrentLiabilities = getLatestValueByFy(facts, US_GAAP_TAGS.nonCurrentLiabilities, fy) || (totalLiabilities - currentLiabilities);
    const equity = getLatestValueByFy(facts, US_GAAP_TAGS.stockholdersEquity, fy) || getLatestValueByFy(facts, US_GAAP_TAGS.totalEquity, fy) || (totalAssets - totalLiabilities);
    const retainedEarnings = getLatestValueByFy(facts, US_GAAP_TAGS.retainedEarnings, fy) || 0;
    const longTermDebt = getLatestValueByFy(facts, US_GAAP_TAGS.longTermDebt, fy) || 0;
    const treasuryStock = getLatestValueByFy(facts, US_GAAP_TAGS.treasuryStock, fy) || 0;
    const additionalPaidInCapital = getLatestValueByFy(facts, US_GAAP_TAGS.additionalPaidInCapital, fy) || 0;

    statements.push({
      date,
      period,
      cashAndCashEquivalents: cash,
      inventory,
      totalCurrentAssets: currentAssets,
      totalNonCurrentAssets: nonCurrentAssets,
      totalAssets,
      totalCurrentLiabilities: currentLiabilities,
      totalNonCurrentLiabilities: nonCurrentLiabilities,
      totalLiabilities,
      retainedEarnings,
      totalStockholdersEquity: equity,
      totalEquity: equity,
      totalDebt: longTermDebt,
      netDebt: longTermDebt - cash,
      treasuryStock,
      additionalPaidInCapital,
    });
  }

  return statements;
}

async function getCashFlowFromEdgar(symbol, period = 'annual', limit = 4) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || {};
  const ocfEntries = getFiscalYear(facts, US_GAAP_TAGS.operatingCashFlow);
  if (ocfEntries.length === 0) return null;

  const selected = pickAnnualEntries(ocfEntries).slice(0, limit);
  const statements = [];

  for (const entry of selected) {
    const fy = entry.fy;
    const date = entry.filed || `${fy}-12-31`;

    const operatingCashFlow = entry.val;
    const netIncome = getLatestValueByFy(facts, US_GAAP_TAGS.netIncome, fy) || 0;
    const capex = getLatestValueByFy(facts, US_GAAP_TAGS.capex, fy) || 0;
    const dividends = getLatestValueByFy(facts, US_GAAP_TAGS.dividendsPaid, fy) || 0;
    const shareRepurchases = getLatestValueByFy(facts, US_GAAP_TAGS.shareRepurchases, fy) || 0;
    const shareIssued = getLatestValueByFy(facts, US_GAAP_TAGS.shareIssued, fy) || 0;
    const netCommonStockIssuance = getLatestValueByFy(facts, US_GAAP_TAGS.netCommonStockIssuance, fy) || 0;
    const stockBasedCompensation = getLatestValueByFy(facts, US_GAAP_TAGS.stockBasedCompensation, fy) || 0;

    statements.push({
      date,
      period,
      netIncome,
      operatingCashFlow,
      capitalExpenditure: Math.abs(capex) * -1,
      freeCashFlow: operatingCashFlow - Math.abs(capex),
      netCashProvidedByOperatingActivities: operatingCashFlow,
      netCashUsedForInvestingActivites: Math.abs(capex) * -1.2,
      netCashUsedProvidedByFinancingActivities: dividends,
      netChangeInCash: operatingCashFlow - Math.abs(capex) + dividends,
      cashAtEndOfPeriod: 0,
      cashAtBeginningOfPeriod: 0,
      dividendsPaid: Math.abs(dividends) * -1,
      repurchaseOfCapitalStock: Math.abs(shareRepurchases),
      shareIssued: shareIssued,
      netCommonStockIssuance: netCommonStockIssuance,
      stockBasedCompensation,
    });
  }

  return statements;
}

async function getCompanyProfileFromEdgar(symbol) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const cacheKey = `edgar_profile_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const submissions = await fetchSubmissions(cik);
    if (!submissions) return null;

    const sicDesc = submissions.sicDescription || '';
    const exchange = submissions.exchange || 'NASDAQ';
    let sector = 'N/A';
    const industry = submissions.description || submissions.industry || sicDesc || 'N/A';
    if (/TECHNOLOGY|SOFTWARE|SEMICONDUCTOR|COMPUTER|ELECTRONIC/i.test(sicDesc)) sector = 'Technology';
    else if (/BANK|FINANCIAL|INSURANCE|INVESTMENT/i.test(sicDesc)) sector = 'Financial Services';
    else if (/HEALTH|PHARMA|BIOTECH|MEDICAL/i.test(sicDesc)) sector = 'Healthcare';
    else if (/RETAIL|WHOLESALE|CONSUMER|APPAREL/i.test(sicDesc)) sector = 'Consumer Cyclical';
    else if (/ENERGY|OIL|GAS|UTILITY/i.test(sicDesc)) sector = 'Energy';
    else if (/INDUSTRIAL|MANUFACTURING|MACHINERY/i.test(sicDesc)) sector = 'Industrials';
    else if (/REAL|ESTATE|PROPERTY/i.test(sicDesc)) sector = 'Real Estate';
    else if (/TELECOMMUNICATION|MEDIA|ENTERTAINMENT/i.test(sicDesc)) sector = 'Communication Services';
    else if (/FOOD|BEVERAGE|AGRICULTURE/i.test(sicDesc)) sector = 'Consumer Defensive';
    else if (/TRANSPORT|LOGISTICS|AIRLINE/i.test(sicDesc)) sector = 'Transportation';
    else if (/EDUCATION|TRAINING/i.test(sicDesc)) sector = 'Education';
    else if (/BIOTECH|PHARMACEUTICAL/i.test(sicDesc)) sector = 'Healthcare';

    const profile = {
      symbol,
      companyName: submissions.name || symbol,
      industry,
      sector,
      country: submissions.address?.state ? 'USA' : 'USA',
      website: submissions.website || submissions.address?.state || '',
      description: submissions.description || sicDesc || '',
      ceo: submissions.officers?.[0]?.name || '',
      employees: submissions.employees || 0,
      marketCap: 0,
      exchange: exchange.includes('NASDAQ') ? 'NASDAQ' : exchange.includes('NYSE') ? 'NYSE' : exchange || 'NASDAQ/NYSE',
      currency: 'USD',
      cik: Number(cik),
      image: '',
      lastUpdated: new Date().toISOString(),
    };

    return cacheSet(cacheKey, profile);
  } catch (err) {
    console.error(`[EDGAR] Error fetching profile for ${symbol}:`, err.message);
    return null;
  }
}

async function getFilings(symbol, formTypes = ['10-K', '10-Q'], limit = 20) {
  const cik = cikLookup(symbol);
  if (!cik) return [];

  const cacheKey = `edgar_filings_${symbol}_${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const submissions = await fetchSubmissions(cik);
    if (!submissions) return [];

    const recent = submissions.filings?.recent || {};
    const forms = recent.form || [];
    const filingData = [];
    const cikPad = String(cik).padStart(10, '0');

    for (let i = 0; i < forms.length && filingData.length < limit; i++) {
      if (formTypes.includes(forms[i])) {
        const accNo = recent.accessionNumber?.[i] || '';
        const accNoClean = accNo.replace(/-/g, '');
        const primaryDoc = recent.primaryDocument?.[i] || '';
        const reportDate = recent.reportDate?.[i] || '';
        const filingDate = recent.filingDate?.[i] || '';

        // Calculate delay between period end and filing
        let delayDays = null;
        if (reportDate && filingDate) {
          const r = new Date(reportDate);
          const f = new Date(filingDate);
          delayDays = Math.round((f - r) / (1000 * 60 * 60 * 24));
        }

        filingData.push({
          form: forms[i],
          description: recent.primaryDocDescription?.[i] || '',
          filingDate,
          reportDate,
          acceptanceDate: recent.acceptanceDateTime?.[i] || '',
          documentUrl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${cik}/${accNoClean}/${primaryDoc}`,
          primaryDocument: primaryDoc,
          accessionNumber: accNo,
          filmNumber: recent.filmNumber?.[i] || '',
          fileNumber: recent.fileNumber?.[i] || '',
          size: recent.size?.[i] || null,
          isXBRL: recent.isXBRL?.[i] || 0,
          isInlineXBRL: recent.isInlineXBRL?.[i] || 0,
          items: recent.items?.[i] || '',
          delayDays,
        });
      }
    }

    return cacheSet(cacheKey, filingData);
  } catch (err) {
    console.error(`[EDGAR] Error fetching filings for ${symbol}:`, err.message);
    return [];
  }
}

async function getKeyMetricsFromEdgar(symbol, period = 'annual', limit = 4) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || {};
  const revenueEntries = getFiscalYear(facts, US_GAAP_TAGS.revenue);
  if (revenueEntries.length === 0) return null;

  const selected = pickAnnualEntries(revenueEntries).slice(0, limit);
  const metrics = [];

  for (const entry of selected) {
    const fy = entry.fy;
    const date = entry.filed || `${fy}-12-31`;

    const revenue = entry.val;
    const netIncome = getLatestValueByFy(facts, US_GAAP_TAGS.netIncome, fy) || 0;
    const equity = getLatestValueByFy(facts, US_GAAP_TAGS.stockholdersEquity, fy) || 0;
    const totalAssets = getLatestValueByFy(facts, US_GAAP_TAGS.totalAssets, fy) || 0;
    const totalLiabilities = getLatestValueByFy(facts, US_GAAP_TAGS.totalLiabilities, fy) || 0;
    const currentAssets = getLatestValueByFy(facts, US_GAAP_TAGS.currentAssets, fy) || 0;
    const currentLiabilities = getLatestValueByFy(facts, US_GAAP_TAGS.currentLiabilities, fy) || 0;
    const ocf = getLatestValueByFy(facts, US_GAAP_TAGS.operatingCashFlow, fy) || 0;
    const capex = Math.abs(getLatestValueByFy(facts, US_GAAP_TAGS.capex, fy) || 0);
    const fcf = ocf - capex;
    const longTermDebt = getLatestValueByFy(facts, US_GAAP_TAGS.longTermDebt, fy) || 0;
    const cash = getLatestValueByFy(facts, US_GAAP_TAGS.cash, fy) || 0;
    const netDebt = Math.max(0, longTermDebt - cash);
    const dividends = Math.abs(getLatestValueByFy(facts, US_GAAP_TAGS.dividendsPaid, fy) || 0);
    const shares = getLatestValueByFy(facts, US_GAAP_TAGS.sharesOutstanding, fy) || 0;

    const peRatio = 0;
    const priceToSales = 0;
    const pbRatio = 0;
    const debtToEquity = equity !== 0 ? (totalLiabilities / equity) : 0;
    const currentRatio = currentLiabilities !== 0 ? (currentAssets / currentLiabilities) : 0;
    const dividendYieldPct = 0;
    const payoutRatio = netIncome !== 0 ? (dividends / netIncome) : 0;
    const ebitda = getLatestValueByFy(facts, US_GAAP_TAGS.ebitda, fy) || 0;

    metrics.push({
      date,
      period,
      marketCap: 0,
      sharesOutstanding: shares,
      floatShares: 0,
      peRatio,
      priceToSalesRatio: priceToSales,
      pbRatio,
      debtToEquity,
      currentRatio,
      dividendYield: dividendYieldPct / 100,
      dividendYieldPercentage: dividendYieldPct,
      payoutRatio,
      netDebtToEBITDA: ebitda > 0 ? netDebt / ebitda : 0,
      earningsYield: 0,
      freeCashFlowYield: 0,
      revenuePerShare: shares > 0 ? revenue / shares : 0,
      netIncomePerShare: shares > 0 ? netIncome / shares : 0,
      operatingCashFlowPerShare: shares > 0 ? ocf / shares : 0,
      freeCashFlowPerShare: shares > 0 ? fcf / shares : 0,
    });
  }

  return metrics;
}

function getProviderStatus() {
  return {
    edgarConfigured: true,
    edgarApiKeyConfigured: Boolean(SEC_EDGAR_API_KEY),
    provider: 'sec-edgar',
    message: 'SEC EDGAR public API provides XBRL financial data from 10-K/10-Q filings for US stocks',
  };
}

function isUsStock(symbol) {
  return !!CIK_MAP[symbol.toUpperCase().replace('NSE:', '')];
}

async function getFinancialReportFromEdgar(symbol, period = 'annual', limit = 4) {
  try {
    const results = await Promise.allSettled([
      getCompanyProfileFromEdgar(symbol),
      getIncomeStatementFromEdgar(symbol, period, limit),
      getBalanceSheetFromEdgar(symbol, period, limit),
      getCashFlowFromEdgar(symbol, period, limit),
      getKeyMetricsFromEdgar(symbol, period, limit),
      getFilings(symbol, ['10-K', '10-Q'], Math.max(limit * 2, 8)),
    ]);

    const getVal = (idx, fallback) => results[idx].status === 'fulfilled' ? (results[idx].value || fallback) : fallback;

    return {
      success: true,
      symbol,
      source: 'sec-edgar',
      lastUpdated: new Date().toISOString(),
      data: {
        profile: getVal(0, null),
        incomeStatementHistory: getVal(1, []),
        balanceSheetHistory: getVal(2, []),
        cashFlowStatementHistory: getVal(3, []),
        keyMetricsHistory: getVal(4, []),
        filings: getVal(5, []),
      },
    };
  } catch (error) {
    console.error(`[EDGAR] Error generating financial report for ${symbol}:`, error.message);
    return { success: false, symbol, source: 'sec-edgar', error: error.message };
  }
}

async function getTTMFromEdgar(symbol) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || {};

  // Collect entries from ALL revenue tags for debugging
  function dumpEntries(facts, tagKeys) {
    const all = [];
    for (const tag of tagKeys) {
      const entries = factLookup(facts, tag);
      if (!entries) continue;
      const units = entries.units;
      for (const unitName of Object.keys(units)) {
        const arr = units[unitName];
        if (Array.isArray(arr)) {
          for (const e of arr) {
            all.push({ ...e, unit: unitName });
          }
        }
      }
    }
    return all;
  }

  const revRaw = dumpEntries(facts, US_GAAP_TAGS.revenue);
  const epsRaw = dumpEntries(facts, US_GAAP_TAGS.epsBasic);

  // Helper: get entries from USD unit, preferring the tag with the most quarterly entries
  function getBestEntries(facts, tagKeys) {
    let best = [];
    let bestQuarterCount = -1;
    for (const tag of tagKeys) {
      const entries = factLookup(facts, tag);
      if (!entries) continue;
      const unitNames = Object.keys(entries.units);
      for (const unitName of unitNames) {
        if (!unitName.includes('USD') && !unitName.includes('shares') && !unitName.includes('pure')) continue;
        const arr = entries.units[unitName];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const quarterCount = arr.filter(e => e.fp && e.fp.startsWith('Q')).length;
        if (bestQuarterCount === -1 || quarterCount > bestQuarterCount) {
          best = arr;
          bestQuarterCount = quarterCount;
        }
      }
    }
    return best;
  }

  const revUsd = getBestEntries(facts, US_GAAP_TAGS.revenue);
  const niUsd = getBestEntries(facts, US_GAAP_TAGS.netIncome);
  const epsUsd = getBestEntries(facts, US_GAAP_TAGS.epsBasic);

  // For each metric, group by fy+fp, prefer entries with frame ending in 'I',
  // then prefer entries without frame (current period) over entries with frame (comparisons),
  // then prefer larger values (YTD cumulative > restated prior), then de-cumulate
  function bestPerQuarter(entries) {
    const best = {};
    for (const e of entries) {
      if (!e.fy || !e.fp) continue;
      const key = `${e.fy}_${e.fp}`;
      const existing = best[key];
      if (!existing) {
        best[key] = e;
      } else if (e.frame && e.frame.endsWith('I')) {
        best[key] = e;
      } else if (!e.frame && existing.frame) {
        best[key] = e;
      } else if (e.val > existing.val) {
        // Prefer larger value — current-period YTD cumulative is always >= any restated entry
        best[key] = e;
      }
    }
    return Object.values(best);
  }

  function computeTtm(entries) {
    const q = entries.filter(e => e.fp && e.fp.startsWith('Q'));
    const fyMap = {};
    for (const e of entries) {
      if (e.fp === 'FY') fyMap[e.fy] = e;
    }

    // Group quarters by fy, sort
    const byFy = {};
    for (const e of q) {
      if (!byFy[e.fy]) byFy[e.fy] = [];
      byFy[e.fy].push(e);
    }

    const standalone = [];
    const order = { Q1: 1, Q2: 2, Q3: 3 };

    for (const [fyStr, list] of Object.entries(byFy)) {
      const fyNum = parseInt(fyStr);
      // Deduplicate by fp (keep last one which is most recently filed)
      const deduped = {};
      for (const e of list) {
        deduped[e.fp] = e;
      }
      const sorted = Object.values(deduped).sort((a, b) => (order[a.fp] || 0) - (order[b.fp] || 0));
      if (sorted.length === 0) continue;

      // Check if cumulative by looking if values are non-decreasing
      let isCumulative = sorted.length > 1;
      let prevC = 0;
      for (const e of sorted) {
        if (e.val < prevC) { isCumulative = false; break; }
        prevC = e.val;
      }

      let prev = 0;
      for (const e of sorted) {
        const val = isCumulative ? Math.max(0, e.val - prev) : e.val;
        standalone.push({ fy: fyNum, fp: e.fp, val, filed: e.filed || '' });
        prev = e.val;
      }

      // Q4 from FY
      if (isCumulative) {
        const fyEnt = fyMap[fyNum];
        if (fyEnt && fyEnt.val > prev) {
          standalone.push({ fy: fyNum, fp: 'Q4', val: fyEnt.val - prev, filed: fyEnt.filed || '' });
        }
      } else {
        const fyEnt = fyMap[fyNum];
        const sumQ = sorted.reduce((s, e) => s + e.val, 0);
        if (fyEnt && fyEnt.val > sumQ) {
          standalone.push({ fy: fyNum, fp: 'Q4', val: fyEnt.val - sumQ, filed: fyEnt.filed || '' });
        }
      }
    }

    // Sort by fy desc, fp desc, take last 4 unique quarters
    const fpOrder = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };
    standalone.sort((a, b) => {
      if (a.fy !== b.fy) return b.fy - a.fy;
      return (fpOrder[b.fp] || 0) - (fpOrder[a.fp] || 0);
    });

    // Deduplicate (fy+fp) and take first 4
    const seen = new Set();
    const result = [];
    for (const e of standalone) {
      const key = `${e.fy}_${e.fp}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(e);
        if (result.length === 4) break;
      }
    }
    return result.length === 4 ? result : null;
  }

  const revBest = bestPerQuarter(revUsd);
  const niBest = bestPerQuarter(niUsd);
  const epsBest = bestPerQuarter(epsUsd);

  const revTtm = computeTtm(revBest);
  const niTtm = computeTtm(niBest);
  const epsTtm = computeTtm(epsBest);

  // Debug: summarize raw data
  const revSummary = revUsd
    .filter(e => e.fy)
    .sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))
    .slice(0, 10)
    .map(e => `fy${e.fy}_${e.fp || '?'}_${(e.val / 1e9).toFixed(1)}B_frame=${e.frame || '?'}`);

  const epsSummary = epsUsd
    .filter(e => e.fy)
    .sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))
    .slice(0, 10)
    .map(e => `fy${e.fy}_${e.fp || '?'}_${e.val}_frame=${e.frame || '?'}`);

  if (!revTtm) {
    return {
      revenue: 0, netIncome: 0, eps: 0,
      periods: `FAIL: revBest=${revBest.length} niBest=${niBest.length} epsBest=${epsBest.length} revRaw=${revRaw.length} revSample:${revSummary.join('|')} epsSample:${epsSummary.join('|')}`
    };
  }

  return {
    revenue: revTtm.reduce((s, i) => s + i.val, 0),
    netIncome: niTtm ? niTtm.reduce((s, i) => s + i.val, 0) : 0,
    eps: epsTtm ? epsTtm.reduce((s, i) => s + i.val, 0) : 0,
    periods: revTtm.map(i => `FY${i.fy}_${i.fp}_${(i.val/1e9).toFixed(1)}B`).join(', '),
  };
}

async function getQuarterlyShareCountHistory(symbol) {
  const cik = cikLookup(symbol);
  if (!cik) return null;

  const cacheKey = `edgar_qshares_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchCompanyFacts(cik);
  if (!data) return null;

  const facts = data.facts?.['us-gaap'] || data.facts?.['dei'] || {};
  const tagKeys = US_GAAP_TAGS.sharesOutstanding;
  const entries = factLookup(facts, tagKeys[0]) || factLookup(facts, tagKeys[1]) || null;
  if (!entries) return null;

  const units = entries.units;
  const shares = units?.shares || units?.['USD/shares'] || null;
  if (!shares || shares.length === 0) return null;

  const result = shares
    .filter(e => e.val && e.filed)
    .sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))
    .slice(0, 20)
    .map(e => ({
      date: e.filed || '',
      sharesOutstanding: e.val,
      frame: e.frame || '',
      fy: e.fy || 0,
      fp: e.fp || '',
    }));

  if (result.length === 0) return null;
  return cacheSet(cacheKey, result);
}

function clearCache() {
  cache.clear();
}

// Load persisted cache from DB on startup
cache.loadFromDb().then(count => {
  if (count > 0) console.log(`[EDGAR] Restored ${count} cached entries from DB`);
}).catch(() => {});

module.exports = {
  isUsStock,
  cikLookup,
  getCompanyProfileFromEdgar,
  getIncomeStatementFromEdgar,
  getBalanceSheetFromEdgar,
  getCashFlowFromEdgar,
  getKeyMetricsFromEdgar,
  getFilings,
  getFinancialReportFromEdgar,
  getProviderStatus,
  getTTMFromEdgar,
  getQuarterlyShareCountHistory,
  clearCache,
};
