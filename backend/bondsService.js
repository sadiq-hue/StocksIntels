// Bonds Service — Fixed income data
// US Treasury yields: live via Yahoo proxy
// Non-US global bonds: live via Yahoo proxy when available, else latest known
// Kenyan bonds: CBK auction data (updated weekly/monthly), no simulation

const signalService = require('./signalService');

let fmpRateLimited = false;
let _lastKeSnapshot = null;
let _lastGlobalSnapshot = null;
let _lastFetch = 0;
const REFRESH_INTERVAL = 30000;

// ─── Yahoo Treasury Symbol Mapping ──────────────────────────────────────
const YAHOO_TREASURY_MAP = {
  'US-T-5Y': { symbol: '^FVX', name: 'CBOE 5-Year Treasury Yield' },
  'US-T-10Y': { symbol: '^TNX', name: 'CBOE 10-Year Treasury Yield' },
  'US-T-30Y': { symbol: '^TYX', name: 'CBOE 30-Year Treasury Yield' },
  'US-T-3M': { symbol: '^IRX', name: 'CBOE 13-Week T-Bill Yield' },
};

// ─── Kenyan Bond Inventory — June 2026 CBK Auction Data ────────────────
// Yields from CBK weekly/monthly auction results. Source: CBK, Mansa Markets, Cbonds
// T-bill yields: May 25 auction; Bond yields: latest reopenings
const KENYAN_BONDS = [
  { id: 'KE-GOV-2028', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 10-Year Government Bond', coupon: 12.00, maturity: '2032-11-01', ytm: 12.20, price: 103.21, currency: 'KES', rating: 'B+', amountIssued: 75000000000, description: 'Benchmark 10-year sovereign bond' },
  { id: 'KE-GOV-2030', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 15-Year Government Bond (FXD3/2019/015)', coupon: 12.34, maturity: '2034-07-01', ytm: 12.97, price: 96.50, currency: 'KES', rating: 'B+', amountIssued: 50000000000, description: '15-year reopening — May 2026 auction' },
  { id: 'KE-GOV-2033', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 20-Year Government Bond (FXD1/2021/020)', coupon: 13.44, maturity: '2041-07-01', ytm: 13.74, price: 97.80, currency: 'KES', rating: 'B+', amountIssued: 60000000000, description: '20-year reopening — May 2026 auction' },
  { id: 'KE-GOV-2040', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 25-Year Government Bond (FXD1/2021/025)', coupon: 13.92, maturity: '2046-04-01', ytm: 13.69, price: 102.00, currency: 'KES', rating: 'B+', amountIssued: 40000000000, description: '25-year reopening — May 2026 auction' },
  { id: 'KE-IFB-2027', type: 'Infrastructure', issuer: 'Republic of Kenya', name: 'Kenya Infrastructure Bond 2027', coupon: 12.50, maturity: '2027-11-20', ytm: 12.30, price: 101.50, currency: 'KES', rating: 'B+', amountIssued: 35000000000, description: 'Tax-free infrastructure bond' },
  { id: 'KE-IFB-2029', type: 'Infrastructure', issuer: 'Republic of Kenya', name: 'Kenya Infrastructure Bond 2029', coupon: 12.75, maturity: '2029-05-10', ytm: 12.60, price: 101.00, currency: 'KES', rating: 'B+', amountIssued: 45000000000, description: 'Infrastructure project financing' },
  { id: 'KE-TB-91D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '91-Day Treasury Bill', coupon: 0, maturity: '2026-09-17', ytm: 8.39, price: 97.86, currency: 'KES', rating: 'B+', amountIssued: 25000000000, description: 'Short-term government paper — May 2026 auction' },
  { id: 'KE-TB-182D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '182-Day Treasury Bill', coupon: 0, maturity: '2026-12-17', ytm: 8.21, price: 95.80, currency: 'KES', rating: 'B+', amountIssued: 30000000000, description: 'Medium-term government paper — May 2026 auction' },
  { id: 'KE-TB-364D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '364-Day Treasury Bill', coupon: 0, maturity: '2027-06-17', ytm: 8.59, price: 91.40, currency: 'KES', rating: 'B+', amountIssued: 40000000000, description: 'One-year government paper — May 2026 auction' },
  { id: 'KE-CORP-SAF-2028', type: 'Corporate', issuer: 'Safaricom PLC', name: 'Safaricom Corporate Bond 2028', coupon: 12.50, maturity: '2028-08-20', ytm: 11.80, price: 103.40, currency: 'KES', rating: 'AA-', amountIssued: 15000000000, description: 'Blue-chip telco corporate bond' },
  { id: 'KE-CORP-EQTY-2027', type: 'Corporate', issuer: 'Equity Group Holdings', name: 'Equity Bank Subordinated Bond', coupon: 13.00, maturity: '2027-04-15', ytm: 12.50, price: 102.60, currency: 'KES', rating: 'A+', amountIssued: 12000000000, description: 'Tier II subordinated bank bond' },
  { id: 'KE-CORP-KCB-2029', type: 'Corporate', issuer: 'KCB Group PLC', name: 'KCB Corporate Bond 2029', coupon: 12.75, maturity: '2029-10-30', ytm: 12.30, price: 101.80, currency: 'KES', rating: 'A', amountIssued: 10000000000, description: 'Senior unsecured bank bond' },
  { id: 'KE-CORP-KPLC-2028', type: 'Corporate', issuer: 'Kenya Power', name: 'Kenya Power Infrastructure Bond', coupon: 13.25, maturity: '2028-03-15', ytm: 13.80, price: 97.20, currency: 'KES', rating: 'BB+', amountIssued: 8000000000, description: 'Power sector corporate bond' },
  { id: 'KE-SUK-2027', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya Sukuk Bond 2027', coupon: 12.75, maturity: '2027-12-20', ytm: 12.60, price: 101.10, currency: 'KES', rating: 'B+', amountIssued: 20000000000, description: 'Islamic sovereign sukuk bond' },
];

const GLOBAL_BONDS = [
  { id: 'US-T-2Y', type: 'Government', issuer: 'US Treasury', name: 'US 2-Year Treasury Note', coupon: 4.00, maturity: '2028-05-31', ytm: 4.22, price: 99.60, currency: 'USD', rating: 'AAA', amountIssued: 250000000000, description: 'Short-term US Treasury note' },
  { id: 'US-T-5Y', type: 'Government', issuer: 'US Treasury', name: 'US 5-Year Treasury Note', coupon: 4.10, maturity: '2031-05-15', ytm: 4.36, price: 98.80, currency: 'USD', rating: 'AAA', amountIssued: 300000000000, description: 'Medium-term US Treasury note' },
  { id: 'US-T-10Y', type: 'Government', issuer: 'US Treasury', name: 'US 10-Year Treasury Note', coupon: 4.25, maturity: '2036-05-15', ytm: 4.44, price: 98.50, currency: 'USD', rating: 'AAA', amountIssued: 450000000000, description: 'Benchmark US 10-year Treasury' },
  { id: 'US-T-30Y', type: 'Government', issuer: 'US Treasury', name: 'US 30-Year Treasury Bond', coupon: 4.50, maturity: '2056-05-15', ytm: 4.87, price: 94.20, currency: 'USD', rating: 'AAA', amountIssued: 350000000000, description: 'Long-term US Treasury bond' },
  { id: 'UK-GILT-10Y', type: 'Government', issuer: 'UK Government', name: 'UK 10-Year Gilt', coupon: 4.00, maturity: '2036-06-07', ytm: 4.78, price: 93.80, currency: 'GBP', rating: 'AA', amountIssued: 200000000000, description: 'Benchmark UK government gilt' },
  { id: 'DE-BUND-10Y', type: 'Government', issuer: 'German Government', name: 'German 10-Year Bund', coupon: 2.60, maturity: '2036-02-15', ytm: 2.95, price: 97.10, currency: 'EUR', rating: 'AAA', amountIssued: 180000000000, description: 'Benchmark German bund' },
  { id: 'JP-GOV-10Y', type: 'Government', issuer: 'Japan Government', name: 'Japan 10-Year Government Bond', coupon: 0.80, maturity: '2036-03-20', ytm: 2.58, price: 84.60, currency: 'JPY', rating: 'A+', amountIssued: 300000000000, description: 'Japanese government bond' },
  { id: 'IN-GOV-10Y', type: 'Government', issuer: 'India Government', name: 'India 10-Year Government Bond', coupon: 7.10, maturity: '2036-04-15', ytm: 6.87, price: 101.20, currency: 'INR', rating: 'BBB-', amountIssued: 150000000000, description: 'Indian government bond' },
  { id: 'NG-GOV-10Y', type: 'Government', issuer: 'Nigeria Government', name: 'Nigeria 10-Year Government Bond', coupon: 18.50, maturity: '2036-01-30', ytm: 14.97, price: 121.50, currency: 'NGN', rating: 'B-', amountIssued: 20000000000, description: 'Nigerian sovereign bond' },
  { id: 'ZA-GOV-10Y', type: 'Government', issuer: 'South Africa Government', name: 'South Africa 10-Year Government Bond', coupon: 11.50, maturity: '2036-02-28', ytm: 8.35, price: 120.80, currency: 'ZAR', rating: 'BB-', amountIssued: 30000000000, description: 'South African sovereign bond' },
];

// ─── Market Access Information ──────────────────────────────────────────
const MARKET_ACCESS = {
  'Government': {
    kenya: [
      { method: 'CBK Primary Auction', description: 'Bid directly through Central Bank of Kenya weekly auctions (every Wednesday). Minimum investment KSh 50,000.', link: 'https://www.centralbank.go.ke/securities/' },
      { method: 'NSE Secondary Market', description: 'Trade on the Nairobi Securities Exchange via any licensed stockbroker.', link: 'https://www.nse.co.ke' },
      { method: 'M-Akiba', description: 'Purchase through M-Akiba mobile platform from KSh 3,000.', link: 'https://www.m-akiba.go.ke' },
    ],
    global: [
      { method: 'TreasuryDirect', description: 'Buy US Treasuries directly at TreasuryDirect.gov. Minimum $100.', link: 'https://www.treasurydirect.gov' },
      { method: 'Brokerage Platform', description: 'Trade via any major broker (IBKR, Schwab, Fidelity). Search by CUSIP.', link: null },
      { method: 'ETF Alternative', description: 'Buy bond ETFs (BND, AGG, TLT, SHY) on any stock exchange.', link: null },
    ],
  },
  'Infrastructure': {
    kenya: [
      { method: 'CBK Infrastructure Bond Auction', description: 'Dedicated infra bond auctions. Tax-free interest.', link: 'https://www.centralbank.go.ke/securities/' },
      { method: 'NSE Secondary Market', description: 'Listed on the NSE — trade through any licensed stockbroker.', link: 'https://www.nse.co.ke' },
    ],
    global: null,
  },
  'Corporate': {
    kenya: [
      { method: 'NSE FISOM', description: 'Corporate bonds trade on NSE Fixed Income Securities Market via any stockbroker.', link: 'https://www.nse.co.ke' },
    ],
    global: [
      { method: 'Brokerage Bond Desk', description: 'Search corporate bonds by issuer or rating on your broker\'s bond desk.', link: null },
      { method: 'OTC Market', description: 'Corporate bonds primarily trade OTC. Minimum lots $1,000-$100,000.', link: null },
    ],
  },
  'T-Bill': {
    kenya: [
      { method: 'CBK Weekly Auction', description: 'T-Bills auctioned every Wednesday. Maturities: 91, 182, 364 days.', link: 'https://www.centralbank.go.ke/securities/' },
      { method: 'M-Akiba', description: 'Buy T-Bills from KSh 3,000.', link: 'https://www.m-akiba.go.ke' },
    ],
    global: [
      { method: 'TreasuryDirect', description: 'Buy US T-Bills directly. Minimum $100. Terms: 4-52 weeks.', link: 'https://www.treasurydirect.gov' },
      { method: 'Brokerage', description: 'Trade T-Bills on secondary market through any broker.', link: null },
    ],
  },
};

// ─── Real-Time Bond Yields via Yahoo Proxy ──────────────────────────────
async function fetchRealYields() {
  try {
    const { fetchPriceViaProxy } = require('./yahooFinanceFinancialsScraper');

    const EXTRA_GLOBAL = {
      'UK-GILT-10Y': { symbol: '^UK10', name: 'UK 10-Year Gilt Yield' },
      'DE-BUND-10Y': { symbol: '^DE10YD', name: 'Germany 10-Year Bund Yield' },
      'JP-GOV-10Y': { symbol: '^JP10YT', name: 'Japan 10-Year JGB Yield' },
      'IN-GOV-10Y': { symbol: 'IN10YD.NS', name: 'India 10-Year Bond Yield' },
      'NG-GOV-10Y': { symbol: '^NG10YD', name: 'Nigeria 10-Year Bond Yield' },
      'ZA-GOV-10Y': { symbol: '^ZA10YD', name: 'South Africa 10-Year Bond Yield' },
    };

    const allSymbols = { ...YAHOO_TREASURY_MAP, ...EXTRA_GLOBAL };
    const yields = {};

    const entries = Object.entries(allSymbols);
    for (let i = 0; i < entries.length; i += 5) {
      const batch = entries.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async ([bondId, mapping]) => {
          const data = await fetchPriceViaProxy(mapping.symbol);
          if (data?.price && data.price > 0) {
            return { bondId, ytm: +data.price.toFixed(2), price: data.price, source: 'live' };
          }
          return null;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          yields[r.value.bondId] = { ytm: r.value.ytm, price: r.value.price, source: r.value.source };
        }
      }
    }

    return yields;
  } catch (e) {
    console.error('[Bonds] Proxy fetch failed:', e.message);
    return {};
  }
}

// ─── Snapshot Generation ────────────────────────────────────────────────
async function generateSnapshot(market) {
  const now = Date.now();

  if (market === 'global') {
    const realYields = await fetchRealYields();
    const hasLiveData = Object.keys(realYields).length > 0;

    const result = GLOBAL_BONDS.map(b => {
      const live = realYields[b.id];
      let ytm, price, source;

      if (live) {
        ytm = live.ytm;
        price = live.price;
        source = live.source;
      } else if (b.id === 'US-T-2Y' && realYields['US-T-5Y']) {
        const shortYtm = realYields['US-T-3M']?.ytm ?? b.ytm;
        const fiveYtm = realYields['US-T-5Y'].ytm;
        ytm = shortYtm + (fiveYtm - shortYtm) * (2 / 4.75);
        price = +(100 - (b.ytm - ytm) * 2).toFixed(2);
        source = 'live';
      } else {
        // Use baseline (latest known market data), no random jitter
        ytm = b.ytm;
        price = b.price;
        source = 'estimated';
      }

      return {
        ...b,
        ytm: Math.max(0, ytm),
        price: Math.max(50, Math.min(200, price)),
        lastUpdated: new Date().toISOString(),
        change: +(ytm - b.ytm).toFixed(2),
        changePercent: b.ytm > 0 ? +((ytm - b.ytm) / b.ytm * 100).toFixed(2) : 0,
        changeDirection: ytm > b.ytm ? 'up' : ytm < b.ytm ? 'down' : 'flat',
        dataSource: source,
      };
    });

    _lastGlobalSnapshot = result;
    _lastFetch = now;
    return { bonds: result, hasLiveData };
  }

  // Kenyan bonds — CBK auction data, no random jitter
  if (!_lastKeSnapshot || now - _lastFetch > REFRESH_INTERVAL) {
    _lastKeSnapshot = KENYAN_BONDS.map(b => ({
      ...b,
      lastUpdated: new Date().toISOString(),
      change: 0,
      changePercent: 0,
      changeDirection: 'flat',
      dataSource: 'cbk',
    }));
    _lastFetch = now;
  }

  return { bonds: _lastKeSnapshot, hasLiveData: false };
}

// ─── Public API ─────────────────────────────────────────────────────────
async function getBonds(market = 'kenya') {
  const { bonds } = await generateSnapshot(market === 'kenya' ? 'kenya' : 'global');
  return bonds;
}

async function getBondById(id) {
  const all = [...KENYAN_BONDS, ...GLOBAL_BONDS];
  const bond = all.find(b => b.id === id);
  if (!bond) return null;
  const market = id.startsWith('KE-') ? 'kenya' : 'global';
  const { bonds } = await generateSnapshot(market);
  return bonds.find(b => b.id === id) || null;
}

async function getBondSummary() {
  const keResult = await generateSnapshot('kenya');
  const globalResult = await generateSnapshot('global');
  const ke = keResult.bonds;
  const gl = globalResult.bonds;

  const kenya10Y = ke.find(b => b.id === 'KE-GOV-2028') || {};
  const us10Y = gl.find(b => b.id === 'US-T-10Y') || {};
  const kenyaTbill = ke.find(b => b.id === 'KE-TB-91D') || {};

  return {
    kenya10Y: kenya10Y.ytm || 12.20,
    kenya10YChange: kenya10Y.change || 0,
    us10Y: us10Y.ytm || 4.44,
    us10YChange: us10Y.change || 0,
    kenyaTbill91D: kenyaTbill.ytm || 8.39,
    kenyaTbill91DChange: kenyaTbill.change || 0,
    lastUpdated: new Date().toISOString(),
    hasLiveData: globalResult.hasLiveData,
    yieldCurve: [
      { term: '91d', kenya: ke.find(b => b.id === 'KE-TB-91D')?.ytm || 8.39, us: gl.find(b => b.id === 'US-T-3M')?.ytm || 3.67 },
      { term: '182d', kenya: ke.find(b => b.id === 'KE-TB-182D')?.ytm || 8.21, us: gl.find(b => b.id === 'US-T-3M')?.ytm || 3.67 },
      { term: '1y', kenya: ke.find(b => b.id === 'KE-TB-364D')?.ytm || 8.59, us: gl.find(b => b.id === 'US-T-2Y')?.ytm || 4.22 },
      { term: '2y', kenya: 9.46, us: gl.find(b => b.id === 'US-T-2Y')?.ytm || 4.22 },
      { term: '3y', kenya: 10.44, us: gl.find(b => b.id === 'US-T-2Y')?.ytm || 4.22 },
      { term: '5y', kenya: 9.59, us: gl.find(b => b.id === 'US-T-5Y')?.ytm || 4.36 },
      { term: '7y', kenya: 10.83, us: gl.find(b => b.id === 'US-T-10Y')?.ytm || 4.44 },
      { term: '10y', kenya: kenya10Y.ytm || 12.20, us: us10Y.ytm || 4.44 },
      { term: '15y', kenya: 12.97, us: gl.find(b => b.id === 'US-T-30Y')?.ytm || 4.87 },
      { term: '20y', kenya: ke.find(b => b.id === 'KE-GOV-2033')?.ytm || 13.74, us: gl.find(b => b.id === 'US-T-30Y')?.ytm || 4.87 },
      { term: '30y', kenya: ke.find(b => b.id === 'KE-GOV-2040')?.ytm || 13.69, us: gl.find(b => b.id === 'US-T-30Y')?.ytm || 4.87 },
    ],
  };
}

async function getMarketAccess(type, market) {
  const access = MARKET_ACCESS[type];
  if (!access) return null;
  return access[market] || access['global'] || null;
}

module.exports = { getBonds, getBondById, getBondSummary, getMarketAccess };
