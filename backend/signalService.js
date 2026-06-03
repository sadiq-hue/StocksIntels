// Signal Service - AI-powered trading signal generation for NSE and NYSE stocks
// Uses hardcoded fundamentals for known stocks and auto-generates for any stock

const axios = require('axios');
const { pool } = require('./db');

const { getMacroScore, getCountryForSymbol, generateMacroReason } = require('./macroService');
const { getAggregatedSentiment } = require('./newsService');
const { getKeyMetrics, getQuote, getCompanyProfile } = require('./financialReportsService');

console.log('📊 Signal Service Loaded - AI Trading Signals Engine (NYSE + NSE)');

// ─── Sector & Industry Reference Data ───────────────────────────────────────
const TBILI_RATE = 0.16; // Kenya 364-day T-bill rate (~16%)

const SECTOR_AVG_PE = {
  'Telecommunications': 15, 'Banking': 10, 'Manufacturing': 18,
  'Media': 12, 'Utilities': 14, 'Technology': 30, 'Financial': 14,
  'Healthcare': 25, 'Consumer': 22, 'Energy': 12, 'Real Estate': 35,
  'Semiconductors': 25, 'Software': 35, 'Insurance': 12, 'Agricultural': 14,
  'Construction': 16, 'Transportation': 15, 'Automobiles': 18,
  'Internet Services': 28, 'Internet Retail': 35, 'Streaming Media': 40,
  'Payments': 28, 'Hospitality': 22, 'Investment': 15,
  'Investment Services': 15, 'Commercial Services': 18, 'Other': 18
};

const INDUSTRY_MEDIAN_EV_EBITDA = {
  'Telecommunications': 8, 'Banking': 7, 'Manufacturing': 10,
  'Media': 8, 'Utilities': 12, 'Technology': 18, 'Financial': 9,
  'Healthcare': 16, 'Consumer': 14, 'Energy': 8, 'Real Estate': 25,
  'Semiconductors': 15, 'Software': 22, 'Insurance': 8, 'Agricultural': 9,
  'Construction': 10, 'Transportation': 10, 'Automobiles': 10,
  'Internet Services': 20, 'Internet Retail': 22, 'Streaming Media': 25,
  'Payments': 20, 'Hospitality': 14, 'Investment': 10,
  'Investment Services': 10, 'Commercial Services': 12, 'Other': 12
};

// ─── Known Stock Fundamentals ────────────────────────────────────────────────
const KNOWN_FUNDAMENTALS = {
  'SCOM': {
    name: 'Safaricom PLC',
    sector: 'Telecommunications',
    peRatio: 15.2,
    pbRatio: 3.8,
    dividendYield: 4.2,
    marketCap: 1100000000000,
    epsGrowth: 8.5,
    revenueGrowth: 12.3,
    debtToEquity: 0.35,
    roe: 25.1,
    currentRatio: 1.2,
    evEbitda: 8.5,
    fcfYield: 6.5,
    payoutRatio: 80,
    marginChange: 1.2,
    epsSurprise: 5.0,
    altmanZ: 3.5,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'EQTY': {
    name: 'Equity Group Holdings',
    sector: 'Banking',
    peRatio: 8.5,
    pbRatio: 1.8,
    dividendYield: 3.8,
    marketCap: 350000000000,
    epsGrowth: 15.2,
    revenueGrowth: 18.5,
    debtToEquity: 0.85,
    roe: 21.3,
    currentRatio: 1.1,
    evEbitda: 7.2,
    fcfYield: 10.0,
    payoutRatio: 40,
    marginChange: 2.5,
    epsSurprise: 8.0,
    altmanZ: 2.2,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'KCB': {
    name: 'KCB Group PLC',
    sector: 'Banking',
    peRatio: 7.8,
    pbRatio: 1.5,
    dividendYield: 4.5,
    marketCap: 280000000000,
    epsGrowth: 12.1,
    revenueGrowth: 14.2,
    debtToEquity: 0.92,
    roe: 19.8,
    currentRatio: 1.05,
    evEbitda: 6.5,
    fcfYield: 9.0,
    payoutRatio: 35,
    marginChange: 1.8,
    epsSurprise: 12.0,
    altmanZ: 2.0,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'EABL': {
    name: 'East African Breweries',
    sector: 'Manufacturing',
    peRatio: 22.5,
    pbRatio: 5.2,
    dividendYield: 3.2,
    marketCap: 130000000000,
    epsGrowth: 6.8,
    revenueGrowth: 9.5,
    debtToEquity: 0.25,
    roe: 23.5,
    currentRatio: 1.3,
    evEbitda: 12.5,
    fcfYield: 3.5,
    payoutRatio: 55,
    marginChange: 0.5,
    epsSurprise: 3.0,
    altmanZ: 3.2,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'BAMB': {
    name: 'Bamburi Cement',
    sector: 'Manufacturing',
    peRatio: 18.2,
    pbRatio: 2.1,
    dividendYield: 2.8,
    marketCap: 65000000000,
    epsGrowth: -5.2,
    revenueGrowth: 3.1,
    debtToEquity: 0.45,
    roe: 11.5,
    currentRatio: 1.4,
    evEbitda: 10.5,
    fcfYield: 4.0,
    payoutRatio: 40,
    marginChange: -2.5,
    epsSurprise: -8.0,
    altmanZ: 2.8,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'negative'
  },
  'ABSA': {
    name: 'Absa Bank Kenya',
    sector: 'Banking',
    peRatio: 9.2,
    pbRatio: 1.6,
    dividendYield: 5.1,
    marketCap: 120000000000,
    epsGrowth: 10.5,
    revenueGrowth: 11.8,
    debtToEquity: 0.88,
    roe: 17.2,
    currentRatio: 1.08,
    evEbitda: 7.5,
    fcfYield: 8.5,
    payoutRatio: 38,
    marginChange: 1.5,
    epsSurprise: 6.0,
    altmanZ: 2.1,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'SBIC': {
    name: 'Stanbic Holdings',
    sector: 'Banking',
    peRatio: 10.5,
    pbRatio: 1.9,
    dividendYield: 4.8,
    marketCap: 95000000000,
    epsGrowth: 14.2,
    revenueGrowth: 16.5,
    debtToEquity: 0.82,
    roe: 18.5,
    currentRatio: 1.12,
    evEbitda: 8.0,
    fcfYield: 7.5,
    payoutRatio: 42,
    marginChange: 2.0,
    epsSurprise: 10.0,
    altmanZ: 2.3,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'KPLC': {
    name: 'Kenya Power',
    sector: 'Utilities',
    peRatio: -15.5,
    pbRatio: 0.8,
    dividendYield: 0,
    marketCap: 28000000000,
    epsGrowth: -25.5,
    revenueGrowth: -2.1,
    debtToEquity: 2.5,
    roe: -5.2,
    currentRatio: 0.65,
    evEbitda: 15.0,
    fcfYield: -5.0,
    payoutRatio: 0,
    marginChange: -5.0,
    epsSurprise: -20.0,
    altmanZ: 0.85,
    insiderBuy: false,
    insiderSell: true,
    newsSentiment: 'negative'
  },
  'NMG': {
    name: 'Nation Media Group',
    sector: 'Media',
    peRatio: 12.8,
    pbRatio: 2.2,
    dividendYield: 3.5,
    marketCap: 22000000000,
    epsGrowth: 8.2,
    revenueGrowth: 5.5,
    debtToEquity: 0.15,
    roe: 17.2,
    currentRatio: 1.8,
    evEbitda: 7.5,
    fcfYield: 6.0,
    payoutRatio: 50,
    marginChange: -1.5,
    epsSurprise: -5.0,
    altmanZ: 2.5,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'CRAY': {
    name: 'Crown Paints Kenya',
    sector: 'Manufacturing',
    peRatio: 28.5,
    pbRatio: 6.5,
    dividendYield: 2.1,
    marketCap: 15000000000,
    epsGrowth: 18.5,
    revenueGrowth: 22.3,
    debtToEquity: 0.12,
    roe: 22.8,
    currentRatio: 2.1,
    evEbitda: 14.0,
    fcfYield: 2.0,
    payoutRatio: 30,
    marginChange: 1.0,
    epsSurprise: 5.0,
    altmanZ: 3.0,
    insiderBuy: true,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  // Global stocks
  'AAPL': {
    name: 'Apple Inc.',
    sector: 'Technology',
    peRatio: 31.4,
    pbRatio: 48.2,
    dividendYield: 0.5,
    marketCap: 3200000000000,
    epsGrowth: 12.5,
    revenueGrowth: 8.2,
    debtToEquity: 1.5,
    roe: 150.0,
    currentRatio: 0.98,
    evEbitda: 22.0,
    fcfYield: 3.8,
    payoutRatio: 25,
    marginChange: 1.5,
    epsSurprise: 6.0,
    altmanZ: 4.5,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'MSFT': {
    name: 'Microsoft Corp.',
    sector: 'Technology',
    peRatio: 35.6,
    pbRatio: 12.8,
    dividendYield: 0.7,
    marketCap: 3100000000000,
    epsGrowth: 18.3,
    revenueGrowth: 15.6,
    debtToEquity: 0.35,
    roe: 38.5,
    currentRatio: 1.3,
    evEbitda: 25.0,
    fcfYield: 2.8,
    payoutRatio: 30,
    marginChange: 2.5,
    epsSurprise: 8.5,
    altmanZ: 4.8,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'NVDA': {
    name: 'NVIDIA Corp.',
    sector: 'Technology',
    peRatio: 58.2,
    pbRatio: 32.5,
    dividendYield: 0.03,
    marketCap: 2900000000000,
    epsGrowth: 85.2,
    revenueGrowth: 120.5,
    debtToEquity: 0.28,
    roe: 65.0,
    currentRatio: 3.5,
    evEbitda: 48.0,
    fcfYield: 1.5,
    payoutRatio: 10,
    marginChange: 8.5,
    epsSurprise: 22.0,
    altmanZ: 5.2,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'TSLA': {
    name: 'Tesla Inc.',
    sector: 'Automobiles',
    peRatio: 52.1,
    pbRatio: 14.2,
    dividendYield: 0,
    marketCap: 562000000000,
    epsGrowth: 25.8,
    revenueGrowth: 18.5,
    debtToEquity: 0.15,
    roe: 28.0,
    currentRatio: 1.8,
    evEbitda: 35.0,
    fcfYield: 0.8,
    payoutRatio: 0,
    marginChange: -1.2,
    epsSurprise: 15.0,
    altmanZ: 4.2,
    insiderBuy: false,
    insiderSell: true,
    newsSentiment: 'neutral'
  },
  'AMZN': {
    name: 'Amazon.com Inc.',
    sector: 'Technology',
    peRatio: 41.3,
    pbRatio: 8.5,
    dividendYield: 0,
    marketCap: 1900000000000,
    epsGrowth: 35.2,
    revenueGrowth: 12.8,
    debtToEquity: 0.65,
    roe: 22.0,
    currentRatio: 1.1,
    evEbitda: 18.0,
    fcfYield: 3.2,
    payoutRatio: 0,
    marginChange: 3.5,
    epsSurprise: 18.0,
    altmanZ: 3.8,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'GOOGL': {
    name: 'Alphabet Inc.',
    sector: 'Technology',
    peRatio: 26.2,
    pbRatio: 7.1,
    dividendYield: 0.4,
    marketCap: 2100000000000,
    epsGrowth: 22.5,
    revenueGrowth: 15.3,
    debtToEquity: 0.12,
    roe: 28.5,
    currentRatio: 2.2,
    evEbitda: 16.0,
    fcfYield: 4.2,
    payoutRatio: 15,
    marginChange: 2.8,
    epsSurprise: 12.0,
    altmanZ: 5.0,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'META': {
    name: 'Meta Platforms',
    sector: 'Technology',
    peRatio: 28.7,
    pbRatio: 8.9,
    dividendYield: 0.4,
    marketCap: 1300000000000,
    epsGrowth: 42.1,
    revenueGrowth: 24.5,
    debtToEquity: 0.18,
    roe: 32.0,
    currentRatio: 2.8,
    evEbitda: 14.0,
    fcfYield: 5.5,
    payoutRatio: 12,
    marginChange: 4.2,
    epsSurprise: 20.0,
    altmanZ: 4.8,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  },
  'JPM': {
    name: 'JPMorgan Chase',
    sector: 'Financial',
    peRatio: 12.8,
    pbRatio: 1.9,
    dividendYield: 2.2,
    marketCap: 570000000000,
    epsGrowth: 15.8,
    revenueGrowth: 12.2,
    debtToEquity: 2.5,
    roe: 15.0,
    currentRatio: 0.85,
    evEbitda: 11.0,
    fcfYield: 4.5,
    payoutRatio: 40,
    marginChange: 1.2,
    epsSurprise: 7.0,
    altmanZ: 1.9,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'V': {
    name: 'Visa Inc.',
    sector: 'Financial',
    peRatio: 31.8,
    pbRatio: 14.5,
    dividendYield: 0.8,
    marketCap: 575000000000,
    epsGrowth: 16.5,
    revenueGrowth: 11.2,
    debtToEquity: 0.45,
    roe: 45.0,
    currentRatio: 1.6,
    evEbitda: 26.0,
    fcfYield: 2.2,
    payoutRatio: 22,
    marginChange: 1.8,
    epsSurprise: 8.5,
    altmanZ: 4.5,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  },
  'NFLX': {
    name: 'Netflix Inc.',
    sector: 'Technology',
    peRatio: 44.6,
    pbRatio: 15.8,
    dividendYield: 0,
    marketCap: 268000000000,
    epsGrowth: 55.2,
    revenueGrowth: 22.5,
    debtToEquity: 0.55,
    roe: 35.0,
    currentRatio: 1.4,
    evEbitda: 30.0,
    fcfYield: 2.0,
    payoutRatio: 0,
    marginChange: 5.5,
    epsSurprise: 25.0,
    altmanZ: 4.0,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'positive'
  }
};

// ─── Auto-generate fundamentals for unknown stocks ─────────────────────────
function generateFundamentals(symbol) {
  const seed = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const r = (min, max) => {
    const pseudo = ((seed * 9301 + 49297) * (symbol.length + 1)) % 233280;
    return min + (pseudo / 233280) * (max - min);
  };
  return {
    name: symbol, sector: guessSector(symbol),
    peRatio: Math.round(r(8, 42) * 10) / 10,
    pbRatio: Math.round(r(0.5, 15) * 10) / 10,
    dividendYield: Math.round(r(0, 4.5) * 10) / 10,
    marketCap: Math.round(r(200000000, 1500000000000)),
    epsGrowth: Math.round(r(-8, 28) * 10) / 10,
    revenueGrowth: Math.round(r(2, 22) * 10) / 10,
    debtToEquity: Math.round(r(0.15, 2.8) * 100) / 100,
    roe: Math.round(r(5, 42) * 10) / 10,
    currentRatio: Math.round(r(0.5, 3.0) * 100) / 100,
    evEbitda: Math.round(r(5, 25) * 10) / 10,
    fcfYield: Math.round(r(0, 10) * 10) / 10,
    payoutRatio: Math.round(r(0, 60)),
    marginChange: Math.round(r(-3, 4) * 10) / 10,
    epsSurprise: Math.round(r(-8, 15) * 10) / 10,
    altmanZ: Math.round(r(1.5, 4.0) * 100) / 100,
    insiderBuy: false,
    insiderSell: false,
    newsSentiment: 'neutral'
  };
}

function guessSector(symbol) {
  const tech = 'ACDEFIMNOPQSTZ'; const fin = 'BGJKUW'; const hc = 'HL'; const re = 'R';
  const first = symbol.charAt(0).toUpperCase();
  if (tech.includes(first)) return 'Technology'; if (fin.includes(first)) return 'Financial';
  if (hc.includes(first)) return 'Healthcare'; if (re.includes(first)) return 'Real Estate';
  return 'Other';
}

// ─── Stock Name Resolution ──────────────────────────────────────────────────
const KNOWN_NAMES = {
  'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'GOOGL': 'Alphabet Inc.',
  'AMZN': 'Amazon.com Inc.', 'NVDA': 'NVIDIA Corp.', 'META': 'Meta Platforms',
  'TSLA': 'Tesla Inc.', 'BRK.B': 'Berkshire Hathaway B', 'JPM': 'JPMorgan Chase',
  'V': 'Visa Inc.', 'UNH': 'UnitedHealth Group', 'LLY': 'Eli Lilly & Co.',
  'WMT': 'Walmart Inc.', 'XOM': 'Exxon Mobil', 'PG': 'Procter & Gamble',
  'JNJ': 'Johnson & Johnson', 'CVX': 'Chevron Corp.', 'HD': 'Home Depot',
  'KO': 'Coca-Cola Co.', 'PEP': 'PepsiCo Inc.', 'MRK': 'Merck & Co.',
  'ABBV': 'AbbVie Inc.', 'BAC': 'Bank of America', 'PFE': 'Pfizer Inc.',
  'TMO': 'Thermo Fisher Scientific', 'COST': 'Costco Wholesale', 'AVGO': 'Broadcom Inc.',
  'INTC': 'Intel Corp.', 'AMD': 'Advanced Micro Devices', 'CRM': 'Salesforce Inc.',
  'ADBE': 'Adobe Inc.', 'NFLX': 'Netflix Inc.', 'DIS': 'Walt Disney Co.',
  'MCD': "McDonald's Corp.", 'NKE': 'Nike Inc.', 'SBUX': 'Starbucks Corp.',
  'GS': 'Goldman Sachs', 'MS': 'Morgan Stanley', 'C': 'Citigroup Inc.',
  'WFC': 'Wells Fargo & Co.', 'UPS': 'United Parcel Service', 'BA': 'Boeing Co.',
  'GE': 'General Electric', 'CAT': 'Caterpillar Inc.', 'RTX': 'RTX Corp.',
  'HON': 'Honeywell International', 'LOW': "Lowe's Companies", 'T': 'AT&T Inc.',
  'VZ': 'Verizon Communications', 'IBM': 'International Business Machines',
  'ORCL': 'Oracle Corp.', 'CSCO': 'Cisco Systems', 'ACN': 'Accenture PLC',
  'TXN': 'Texas Instruments', 'QCOM': 'Qualcomm Inc.', 'AMGN': 'Amgen Inc.',
  'BLK': 'BlackRock Inc.', 'SCHW': 'Charles Schwab', 'AXP': 'American Express',
  'MMM': '3M Co.', 'MDT': 'Medtronic PLC', 'AMAT': 'Applied Materials',
  'MU': 'Micron Technology', 'NOW': 'ServiceNow Inc.', 'UBER': 'Uber Technologies',
  'ABNB': 'Airbnb Inc.', 'SPOT': 'Spotify Technology', 'SNAP': 'Snap Inc.',
  'PLTR': 'Palantir Technologies', 'SNOW': 'Snowflake Inc.', 'DDOG': 'Datadog Inc.',
  'CRWD': 'CrowdStrike Holdings', 'PANW': 'Palo Alto Networks', 'FTNT': 'Fortinet Inc.',
  'SQ': 'Block Inc.', 'PYPL': 'PayPal Holdings', 'COIN': 'Coinbase Global',
  'GME': 'GameStop Corp.', 'AMC': 'AMC Entertainment', 'MRNA': 'Moderna Inc.',
  'SCOM': 'Safaricom PLC', 'EQTY': 'Equity Group Holdings', 'KCB': 'KCB Group PLC',
  'EABL': 'East African Breweries', 'NMG': 'Nation Media Group',
  'KLG': 'Kengen', 'OLYM': 'Olympia Capital', 'UMEM': 'Umeme',
  'TOTL': 'Total Energies Kenya', 'STAN': 'Standard Chartered Kenya',
  'COOP': 'Co-operative Bank', 'JUB': 'Jubilee Insurance', 'KNRE': 'Kenya Reinsurance',
  'LKL': 'Liberty Kenya Holdings', 'CIC': 'CIC Insurance',
  'HFCK': 'HF Group', 'IMH': 'I&M Holdings',
};

function resolveStockName(symbol) {
  if (KNOWN_FUNDAMENTALS[symbol] && KNOWN_FUNDAMENTALS[symbol].name !== symbol) return KNOWN_FUNDAMENTALS[symbol].name;
  return KNOWN_NAMES[symbol] || `${symbol}`;
}

// ─── Stock Universe ─────────────────────────────────────────────────────────
const NSE_SYMBOLS = ['SCOM','EQTY','KCB','EABL','BAMB','ABSA','SBIC','KPLC','NMG','CRAY','KLG','OLYM','UMEM','TOTL','STAN','COOP','JUB','KNRE','LKL','CIC','HFCK','IMH'];

const US_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','BRK.B','LLY','AVGO',
  'JPM','V','UNH','XOM','PG','JNJ','WMT','CVX','HD','KO','PEP','COST',
  'MRK','ABBV','BAC','TMO','ORCL','CSCO','NFLX','ADBE','AMD','CRM','INTC',
  'TXN','QCOM','AMGN','IBM','BA','GE','CAT','DIS','MCD','NKE','SBUX',
  'GS','MS','C','WFC','BLK','SCHW','AXP','UPS','RTX','HON','LOW','MMM',
  'MDT','AMAT','MU','NOW','UBER','ABNB','SPOT','SNAP','PLTR','SNOW',
  'DDOG','CRWD','PANW','FTNT','NET','SQ','PYPL','COIN','GME','AMC',
  'MRNA','ZM','DOCU','TWLO','EBAY','ETSY','SIRI','PINS','RBLX',
  'ADP','ACN','ADI','APH','TEL','GLW','KLAC','LRCX','MCHP','ON','NXPI',
  'STX','WDC','SWKS','QRVO','TER','ENTG','CDNS','SNPS','ANSS','PTC',
  'WDAY','EA','TTWO','CMG','LULU','DHI','LEN','NVR','PHM','TSCO','ROST',
  'TJX','DG','DLTR','BBY','ORLY','AZO','CTAS','SYY','GIS','K','HSY',
  'STZ','MNST','CL','KMB','CHD','KHC','MDLZ','TGT','KR','SFM',
  'USB','PNC','TFC','BK','RF','HBAN','KEY','FITB','STT','NTRS',
  'MTB','CFG','CMA','PGR','ALL','MET','PRU','AFL','TRV','CB','AIG',
  'ACGL','MCO','SPGI','MSCI','ICE','CME','NDAQ','FDS','FIS','GPN','FI',
  'COP','EOG','SLB','OXY','PSX','FCX','NEM','DOW','DD','APD','EMR',
  'SHW','PPG','ECL','IFF','DE','PCAR','CMI','PWR','VMC','MLM','TDG',
  'GD','NOC','LMT','LHX','SYK','BSX','ISRG','EW','DXCM','IDXX','ALGN',
  'ABT','CI','ELV','HCA','MCK','REGN','VRTX','GILD','BIIB','DHR','BDX',
  'ZTS','WST','PLD','AMT','EQIX','SPG','PSA','O','DLR','WELL','AVB',
  'WBD','LYV','FOXA','CMCSA','CHTR','PARA','OMC','IPG','NWSA',
  'WM','RSG','CPRT','GPC','F','GM','TM','HMC','AAL','DAL','UAL','LUV',
  'HLT','MAR','MGM','WYNN','LVS','CZR','DKNG','W','CHWY',
  'HOOD','AFRM','UPST','SOFI','MARA','RIOT','CLSK',
];

const ALL_SYMBOLS = [...NSE_SYMBOLS, ...US_SYMBOLS];

// ─── Real Fundamentals from FMP ─────────────────────────────────────────────
const realFundamentalsCache = new Map();
const FUND_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchRealFundamentals(symbol) {
  try {
    const [metricsArr, quote, profile] = await Promise.all([
      getKeyMetrics(symbol, 'annual', 2),
      getQuote(symbol),
      getCompanyProfile(symbol),
    ]);

    if (!metricsArr || metricsArr.length === 0) return null;

    const m = metricsArr[0];
    const prev = metricsArr.length > 1 ? metricsArr[1] : null;

    const revenueGrowth = prev && m.revenuePerShare && prev.revenuePerShare
      ? ((m.revenuePerShare - prev.revenuePerShare) / prev.revenuePerShare) * 100 : null;

    const epsGrowth = prev && m.netIncomePerShare && prev.netIncomePerShare
      ? ((m.netIncomePerShare - prev.netIncomePerShare) / prev.netIncomePerShare) * 100 : null;

    return {
      name: profile?.companyName || symbol,
      sector: profile?.sector || guessSector(symbol),
      peRatio: m.peRatio || quote?.pe || 0,
      pbRatio: m.pbRatio || 0,
      dividendYield: m.dividendYieldPercentage || m.dividendYield || 0,
      marketCap: quote?.marketCap || m.marketCap || 0,
      epsGrowth: epsGrowth != null ? Math.round(epsGrowth * 10) / 10 : 0,
      revenueGrowth: revenueGrowth != null ? Math.round(revenueGrowth * 10) / 10 : 0,
      debtToEquity: m.debtToEquity || 0,
      currentRatio: m.currentRatio || 0,
      fcfYield: (m.freeCashFlowYield || 0) * 100,
      payoutRatio: m.payoutRatio || 0,
      roe: 0,
    };
  } catch {
    return null;
  }
}

// Warm cache in background batches (non-blocking)
async function warmFMPCache(symbols) {
  const batchSize = 3;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(s => fetchRealFundamentals(s)));
    batch.forEach((s, j) => {
      if (results[j].status === 'fulfilled' && results[j].value) {
        realFundamentalsCache.set(s, { data: results[j].value, ts: Date.now() });
      }
    });
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

function getFundamentals(symbol) {
  const cached = realFundamentalsCache.get(symbol);
  if (cached && Date.now() - cached.ts < FUND_CACHE_TTL) {
    return {
      evEbitda: 12, fcfYield: 3, payoutRatio: 50, marginChange: 0,
      epsSurprise: 0, altmanZ: 2.5, insiderBuy: false, insiderSell: false,
      newsSentiment: 'neutral',
      ...cached.data
    };
  }
  const base = KNOWN_FUNDAMENTALS[symbol] || generateFundamentals(symbol);
  return {
    evEbitda: 12, fcfYield: 3, payoutRatio: 50, marginChange: 0,
    epsSurprise: 0, altmanZ: 2.5, insiderBuy: false, insiderSell: false,
    newsSentiment: 'neutral',
    ...base
  };
}

// Technical indicator calculation functions
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = [];
  let losses = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return { macd: 0, signal: 0, histogram: 0 };
  
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  const macdLine = fastEMA - slowEMA;
  
  // Simplified signal line calculation
  const signalLine = macdLine * 0.8; // Simplified
  const histogram = macdLine - signalLine;
  
  return { macd: macdLine, signal: signalLine, histogram };
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) {
    return { upper: prices[prices.length - 1] * 1.02, middle: prices[prices.length - 1], lower: prices[prices.length - 1] * 0.98 };
  }
  
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b) / period;
  
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std
  };
}

function calculateSMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  return prices.slice(-period).reduce((a, b) => a + b) / period;
}

// Generate synthetic price history for technical analysis
function generatePriceHistory(currentPrice, days = 30) {
  const prices = [];
  let price = currentPrice * 0.9; // Start 10% lower
  
  for (let i = 0; i < days; i++) {
    const volatility = 0.02; // 2% daily volatility
    const change = (Math.random() - 0.48) * volatility * price;
    price = Math.max(price + change, currentPrice * 0.8);
    prices.push(price);
  }
  
  prices.push(currentPrice); // Add current price
  return prices;
}

// Fundamental Analysis Score (0-100) - Condition-based signal logic
function analyzeFundamentals(symbol, currentPrice, overrideNewsSentiment = null) {
  const stock = getFundamentals(symbol);
  let score = 50;
  const metrics = {};
  let suppressed = false;

  // ── P/E vs sector average ──────────────────────────────────────────────
  // <70% of sector avg → BUY; >140% → SELL
  if (stock.peRatio > 0) {
    const sectorAvg = SECTOR_AVG_PE[stock.sector] || 18;
    const peRatio = stock.peRatio / sectorAvg;
    if (peRatio < 0.7) {
      score += 12;
      metrics.peSignal = 'BUY';
      metrics.peRating = `P/E ${stock.peRatio} is ${Math.round((1 - peRatio) * 100)}% below sector avg ${sectorAvg}`;
    } else if (peRatio > 1.4) {
      score -= 12;
      metrics.peSignal = 'SELL';
      metrics.peRating = `P/E ${stock.peRatio} is ${Math.round((peRatio - 1) * 100)}% above sector avg ${sectorAvg}`;
    } else {
      metrics.peSignal = 'NEUTRAL';
      metrics.peRating = `P/E ${stock.peRatio} in line with sector avg ${sectorAvg}`;
    }
  }

  // ── EV/EBITDA vs industry median ───────────────────────────────────────
  if (stock.evEbitda > 0) {
    const median = INDUSTRY_MEDIAN_EV_EBITDA[stock.sector] || 12;
    if (stock.evEbitda < median) {
      score += 10;
      metrics.evSignal = 'BUY';
      metrics.evRating = `EV/EBITDA ${stock.evEbitda} below industry median ${median}`;
    } else {
      metrics.evSignal = 'NEUTRAL';
      metrics.evRating = `EV/EBITDA ${stock.evEbitda} at or above median ${median}`;
    }
  }

  // ── P/B with ROE (deep value for NSE banking stocks) ───────────────────
  if (stock.pbRatio > 0 && stock.pbRatio < 1.0 && stock.roe > 0) {
    score += 15;
    metrics.pbSignal = 'BUY';
    metrics.pbRating = `Deep value: P/B ${stock.pbRatio} < 1.0 with positive ROE ${stock.roe}%`;
  } else if (stock.pbRatio > 5) {
    score -= 5;
    metrics.pbSignal = 'NEUTRAL';
    metrics.pbRating = `P/B ${stock.pbRatio} elevated`;
  }

  // ── Dividend yield vs T-bill ───────────────────────────────────────────
  // yield > 2x T-bill rate AND payout ratio < 80% → income BUY
  if (stock.dividendYield > 0) {
    const tbillThreshold = TBILI_RATE * 100 * 2;
    if (stock.dividendYield > tbillThreshold && (stock.payoutRatio < 80 || stock.payoutRatio === 0)) {
      score += 10;
      metrics.divSignal = 'BUY';
      metrics.divRating = `Income BUY: yield ${stock.dividendYield}% > 2x T-bill rate, payout ${stock.payoutRatio}%`;
    } else if (stock.dividendYield > TBILI_RATE * 100) {
      score += 5;
      metrics.divSignal = 'NEUTRAL';
      metrics.divRating = `Dividend ${stock.dividendYield}% above T-bill rate`;
    } else {
      metrics.divSignal = 'NEUTRAL';
      metrics.divRating = `Dividend yield ${stock.dividendYield}%`;
    }
  } else if (stock.dividendYield === 0) {
    metrics.divSignal = 'NEUTRAL';
    metrics.divRating = 'No dividend';
  }

  // ── Revenue growth YoY > 15% ──────────────────────────────────────────
  if (stock.revenueGrowth > 15) {
    score += 12;
    metrics.revSignal = 'BUY';
    metrics.revRating = `Strong revenue growth ${stock.revenueGrowth}% > 15%`;
  } else if (stock.revenueGrowth > 10) {
    score += 5;
    metrics.revSignal = 'NEUTRAL';
    metrics.revRating = `Moderate revenue growth ${stock.revenueGrowth}%`;
  } else if (stock.revenueGrowth < 0) {
    score -= 10;
    metrics.revSignal = 'SELL';
    metrics.revRating = `Declining revenue ${stock.revenueGrowth}%`;
  } else {
    metrics.revSignal = 'NEUTRAL';
    metrics.revRating = `Revenue growth ${stock.revenueGrowth}%`;
  }

  // ── Earnings surprise > 10% → momentum ───────────────────────────────
  if (stock.epsSurprise > 10) {
    score += 10;
    metrics.epsSignal = 'BUY';
    metrics.epsRating = `Earnings beat estimates by ${stock.epsSurprise}% - momentum`;
  } else if (stock.epsSurprise < -10) {
    score -= 10;
    metrics.epsSignal = 'SELL';
    metrics.epsRating = `Earnings miss by ${stock.epsSurprise}%`;
  } else if (stock.epsSurprise > 0) {
    score += 3;
    metrics.epsSignal = 'NEUTRAL';
    metrics.epsRating = `Positive earnings surprise ${stock.epsSurprise}%`;
  } else {
    metrics.epsSignal = 'NEUTRAL';
    metrics.epsRating = stock.epsSurprise !== 0 ? `EPS surprise ${stock.epsSurprise}%` : 'EPS in line';
  }

  // ── Margin expansion/contraction ──────────────────────────────────────
  // > 2pp YoY expansion = efficiency; < -3pp = WATCH
  if (stock.marginChange > 2) {
    score += 10;
    metrics.mgnSignal = 'BUY';
    metrics.mgnRating = `Margin expanded ${stock.marginChange}pp YoY - efficiency gain`;
  } else if (stock.marginChange < -3) {
    score -= 5;
    metrics.mgnSignal = 'WATCH';
    metrics.mgnRating = `Margin contracted ${stock.marginChange}pp YoY - caution`;
  } else if (stock.marginChange > 0) {
    score += 3;
    metrics.mgnSignal = 'NEUTRAL';
    metrics.mgnRating = `Margin improved ${stock.marginChange}pp YoY`;
  } else {
    metrics.mgnSignal = 'NEUTRAL';
    metrics.mgnRating = stock.marginChange !== 0 ? `Margin -${Math.abs(stock.marginChange)}pp YoY` : 'Margin stable';
  }

  // ── FCF yield > 5% ────────────────────────────────────────────────────
  if (stock.fcfYield > 5) {
    score += 10;
    metrics.fcfSignal = 'BUY';
    metrics.fcfRating = `Strong FCF yield ${stock.fcfYield}% > 5%`;
  } else if (stock.fcfYield > 0) {
    score += 3;
    metrics.fcfSignal = 'NEUTRAL';
    metrics.fcfRating = `FCF yield ${stock.fcfYield}%`;
  } else if (stock.fcfYield < 0) {
    score -= 8;
    metrics.fcfSignal = 'SELL';
    metrics.fcfRating = `Negative FCF yield ${stock.fcfYield}%`;
  }

  // ── Debt-to-Equity ────────────────────────────────────────────────────
  // < 0.5 = low leverage (BUY); > 2.0 = risk flag (SELL)
  if (stock.debtToEquity < 0.5) {
    score += 8;
    metrics.deSignal = 'BUY';
    metrics.debtRating = `Low leverage D/E ${stock.debtToEquity} < 0.5`;
  } else if (stock.debtToEquity > 2.0) {
    score -= 12;
    metrics.deSignal = 'SELL';
    metrics.debtRating = `High debt risk D/E ${stock.debtToEquity} > 2.0`;
  } else if (stock.debtToEquity < 1.0) {
    score += 3;
    metrics.deSignal = 'NEUTRAL';
    metrics.debtRating = `Manageable debt D/E ${stock.debtToEquity}`;
  } else {
    metrics.deSignal = 'NEUTRAL';
    metrics.debtRating = `Elevated debt D/E ${stock.debtToEquity}`;
  }

  // ── Current Ratio ─────────────────────────────────────────────────────
  // > 1.5 = healthy; < 1.0 = solvency risk
  if (stock.currentRatio > 1.5) {
    score += 5;
    metrics.crSignal = 'BUY';
    metrics.crRating = `Healthy liquidity CR ${stock.currentRatio} > 1.5`;
  } else if (stock.currentRatio < 1.0) {
    score -= 5;
    metrics.crSignal = 'WATCH';
    metrics.crRating = `Low liquidity CR ${stock.currentRatio} < 1.0`;
  } else {
    metrics.crSignal = 'NEUTRAL';
    metrics.crRating = `Current ratio ${stock.currentRatio}`;
  }

  // ── ROE > 15% consistently ────────────────────────────────────────────
  if (stock.roe > 15) {
    score += 8;
    metrics.roeSignal = 'BUY';
    metrics.roeRating = `Strong ROE ${stock.roe}% > 15%`;
  } else if (stock.roe < 5) {
    score -= 8;
    metrics.roeSignal = 'SELL';
    metrics.roeRating = `Weak ROE ${stock.roe}% < 5%`;
  } else {
    metrics.roeSignal = 'NEUTRAL';
    metrics.roeRating = `ROE ${stock.roe}%`;
  }

  // ── Altman Z-Score ────────────────────────────────────────────────────
  // < 1.81 = financial distress → SUPPRESS all BUY signals
  if (stock.altmanZ < 1.81) {
    suppressed = true;
    metrics.altSignal = 'SUPPRESS';
    metrics.altRating = `Altman Z ${stock.altmanZ} < 1.81 - financial distress - BUY suppressed`;
  } else if (stock.altmanZ > 3.0) {
    score += 5;
    metrics.altSignal = 'NEUTRAL';
    metrics.altRating = `Altman Z ${stock.altmanZ} > 3.0 - safe zone`;
  } else {
    metrics.altSignal = 'NEUTRAL';
    metrics.altRating = `Altman Z ${stock.altmanZ} - grey zone`;
  }

  // ── Insider Activity ──────────────────────────────────────────────────
  // Director open-market purchase → strongest non-technical BUY
  if (stock.insiderBuy) {
    score += 20;
    metrics.insiderSignal = 'STRONG BUY';
    metrics.insiderRating = 'Director open-market purchase - strongest signal';
  }
  // Clustered insider selling by 2+ executives within 30 days → SELL
  if (stock.insiderSell) {
    score -= 15;
    metrics.insiderSignal = 'SELL';
    metrics.insiderRating = 'Clustered insider selling - high conviction caution';
  }

  // ── News Sentiment (real-time from newsService if available) ──────────
  const newsSent = overrideNewsSentiment || stock.newsSentiment;
  if (newsSent === 'positive') {
    score += 5;
    metrics.newsSignal = 'BUY';
    metrics.newsRating = 'Positive news sentiment';
  } else if (newsSent === 'negative') {
    score -= 5;
    metrics.newsSignal = 'SELL';
    metrics.newsRating = 'Negative news sentiment';
  } else {
    metrics.newsSignal = 'NEUTRAL';
    metrics.newsRating = 'Neutral news sentiment';
  }

  // If Altman Z triggered suppression, cap score at neutral (50)
  if (suppressed) {
    score = Math.min(score, 50);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, metrics, fundamentalGrade: getGrade(score), suppressed };
}

// Technical Analysis Score (0-100)
function analyzeTechnicals(symbol, currentPrice, priceHistory = null) {
  if (!priceHistory) {
    priceHistory = generatePriceHistory(currentPrice);
  }
  
  let score = 50; // Start neutral
  const indicators = {};
  
  // RSI Analysis
  const rsi = calculateRSI(priceHistory);
  indicators.rsi = rsi.toFixed(1);
  
  if (rsi < 30) {
    score += 15;
    indicators.rsiSignal = 'Oversold - Bullish';
  } else if (rsi < 40) {
    score += 5;
    indicators.rsiSignal = 'Approaching Oversold';
  } else if (rsi > 70) {
    score -= 15;
    indicators.rsiSignal = 'Overbought - Bearish';
  } else if (rsi > 60) {
    score -= 5;
    indicators.rsiSignal = 'Approaching Overbought';
  } else {
    indicators.rsiSignal = 'Neutral';
  }
  
  // MACD Analysis
  const macd = calculateMACD(priceHistory);
  indicators.macd = macd.macd.toFixed(3);
  
  if (macd.histogram > 0 && macd.macd > 0) {
    score += 15;
    indicators.macdSignal = 'Bullish';
  } else if (macd.histogram > 0) {
    score += 5;
    indicators.macdSignal = 'Turning Bullish';
  } else if (macd.histogram < 0 && macd.macd < 0) {
    score -= 15;
    indicators.macdSignal = 'Bearish';
  } else if (macd.histogram < 0) {
    score -= 5;
    indicators.macdSignal = 'Turning Bearish';
  } else {
    indicators.macdSignal = 'Neutral';
  }
  
  // Moving Average Analysis
  const sma20 = calculateSMA(priceHistory, 20);
  const sma50 = calculateSMA(priceHistory, 50);
  indicators.sma20 = sma20.toFixed(2);
  indicators.sma50 = sma50.toFixed(2);
  
  if (currentPrice > sma20 && sma20 > sma50) {
    score += 15;
    indicators.trendSignal = 'Strong Uptrend';
  } else if (currentPrice > sma20) {
    score += 5;
    indicators.trendSignal = 'Uptrend';
  } else if (currentPrice < sma50 && sma20 < sma50) {
    score -= 15;
    indicators.trendSignal = 'Strong Downtrend';
  } else if (currentPrice < sma20) {
    score -= 5;
    indicators.trendSignal = 'Downtrend';
  } else {
    indicators.trendSignal = 'Sideways';
  }
  
  // Bollinger Bands Analysis
  const bb = calculateBollingerBands(priceHistory);
  indicators.bbUpper = bb.upper.toFixed(2);
  indicators.bbLower = bb.lower.toFixed(2);
  
  if (currentPrice <= bb.lower) {
    score += 10;
    indicators.bbSignal = 'Near Lower Band - Potential Reversal';
  } else if (currentPrice >= bb.upper) {
    score -= 10;
    indicators.bbSignal = 'Near Upper Band - Potential Pullback';
  } else if (currentPrice <= bb.middle) {
    score += 3;
    indicators.bbSignal = 'Below Middle Band';
  } else {
    indicators.bbSignal = 'Above Middle Band';
  }
  
  // Volume Analysis (simplified)
  const recentVolume = Math.random() > 0.5 ? 'High' : 'Average';
  indicators.volume = recentVolume;
  if (recentVolume === 'High') {
    score += 5;
    indicators.volumeSignal = 'High Volume Confirming Trend';
  } else {
    indicators.volumeSignal = 'Average Volume';
  }
  
  // Price momentum
  const priceChange = ((currentPrice - priceHistory[0]) / priceHistory[0]) * 100;
  indicators.momentum = priceChange.toFixed(1) + '%';
  
  if (priceChange > 10) {
    score += 10;
    indicators.momentumSignal = 'Strong Positive';
  } else if (priceChange > 5) {
    score += 5;
    indicators.momentumSignal = 'Positive';
  } else if (priceChange < -10) {
    score -= 10;
    indicators.momentumSignal = 'Strong Negative';
  } else if (priceChange < -5) {
    score -= 5;
    indicators.momentumSignal = 'Negative';
  } else {
    indicators.momentumSignal = 'Neutral';
  }
  
  score = Math.max(0, Math.min(100, score));
  
  return { score, indicators, technicalGrade: getGrade(score) };
}

// Financial Analysis based on condition signals (25% weight)
function analyzeFinancials(symbol) {
  const stock = getFundamentals(symbol);
  
  let score = 50;
  const analysis = {};
  
  // Profitability: ROE + margin trend
  if (stock.roe > 15 && stock.marginChange > 0) {
    score += 12;
    analysis.profitability = 'Strong and improving';
  } else if (stock.roe > 15) {
    score += 8;
    analysis.profitability = 'Strong';
  } else if (stock.roe > 10) {
    score += 3;
    analysis.profitability = 'Moderate';
  } else if (stock.roe < 5) {
    score -= 8;
    analysis.profitability = 'Weak';
  } else {
    analysis.profitability = 'Adequate';
  }
  
  // Growth: revenue + EPS surprise
  const growthScore = (stock.revenueGrowth > 0 ? 1 : 0) + (stock.epsSurprise > 0 ? 1 : 0);
  const avgGrowth = (stock.epsGrowth + stock.revenueGrowth) / 2;
  if (avgGrowth > 15 && stock.epsSurprise > 10) {
    score += 12;
    analysis.growth = 'High Growth with positive momentum';
  } else if (avgGrowth > 10) {
    score += 8;
    analysis.growth = 'Solid Growth';
  } else if (avgGrowth > 5) {
    score += 3;
    analysis.growth = 'Moderate Growth';
  } else if (avgGrowth < -5) {
    score -= 12;
    analysis.growth = 'Declining';
  } else {
    analysis.growth = 'Low Growth';
  }
  
  // Financial Health: D/E + CR + Altman Z
  let healthScore = 0;
  if (stock.debtToEquity < 0.5) healthScore++;
  if (stock.currentRatio > 1.5) healthScore++;
  if (stock.altmanZ > 3.0) healthScore++;
  if (stock.debtToEquity > 2.0) healthScore--;
  if (stock.currentRatio < 1.0) healthScore--;
  if (stock.altmanZ < 1.81) healthScore -= 2;
  
  if (healthScore >= 2) {
    score += 10;
    analysis.financialHealth = 'Excellent balance sheet';
  } else if (healthScore >= 1) {
    score += 5;
    analysis.financialHealth = 'Good financial health';
  } else if (healthScore <= 0) {
    score -= 10;
    analysis.financialHealth = 'Concerning financial position';
  } else {
    analysis.financialHealth = 'Adequate';
  }
  
  // Valuation: P/E vs sector + EV/EBITDA + P/B
  let valScore = 0;
  if (stock.peRatio > 0) {
    const sectorAvg = SECTOR_AVG_PE[stock.sector] || 18;
    if (stock.peRatio / sectorAvg < 0.7) valScore++;
    if (stock.peRatio / sectorAvg > 1.4) valScore--;
  }
  if (stock.evEbitda > 0) {
    const median = INDUSTRY_MEDIAN_EV_EBITDA[stock.sector] || 12;
    if (stock.evEbitda < median) valScore++;
  }
  if (stock.pbRatio > 0 && stock.pbRatio < 1.0 && stock.roe > 0) valScore++;
  
  if (valScore >= 2) {
    score += 12;
    analysis.valuation = 'Undervalued across multiple metrics';
  } else if (valScore >= 1) {
    score += 5;
    analysis.valuation = 'Fairly valued';
  } else if (valScore <= 0) {
    score -= 5;
    analysis.valuation = 'Potentially overvalued';
  } else {
    analysis.valuation = 'Neutral';
  }
  
  // Suppress if Altman Z in distress
  if (stock.altmanZ < 1.81) {
    score = Math.min(score, 45);
    analysis.financialHealth = 'FINANCIAL DISTRESS - BUY suppressed';
  }
  
  score = Math.max(0, Math.min(100, score));
  
  return { score, analysis, financialGrade: getGrade(score) };
}

// Get letter grade from score
function getGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D+';
  if (score >= 40) return 'D';
  return 'F';
}

// Determine overall signal
function determineSignal(overallScore) {
  if (overallScore >= 85) return { signal: 'Strong Buy', action: 'buy', strength: 'strong' };
  if (overallScore >= 75) return { signal: 'Buy', action: 'buy', strength: 'moderate' };
  if (overallScore >= 65) return { signal: 'Accumulate', action: 'buy', strength: 'weak' };
  if (overallScore >= 45) return { signal: 'Hold', action: 'hold', strength: 'neutral' };
  if (overallScore >= 35) return { signal: 'Sell', action: 'sell', strength: 'weak' };
  if (overallScore >= 25) return { signal: 'Sell', action: 'sell', strength: 'moderate' };
  return { signal: 'Strong Sell', action: 'sell', strength: 'strong' };
}

// Determine trade type based on analysis
function determineTradeType(technicalScore, fundamentalScore) {
  // High technical, any fundamental = Intraday/Swing
  if (technicalScore >= 75) {
    return 'Intraday';
  } else if (technicalScore >= 65) {
    return 'Swing Trade';
  } else if (fundamentalScore >= 70) {
    return 'Long Term';
  } else if (fundamentalScore >= 60) {
    return 'Swing Trade';
  }
  return 'Swing Trade';
}

// Calculate entry, targets, and stop loss
function calculateTradeLevels(symbol, currentPrice, signal) {
  const volatility = 0.05; // 5% base volatility
  const atr = currentPrice * volatility;
  
  let entry, stopLoss, target1, target2;
  
  if (signal.action === 'buy') {
    entry = currentPrice;
    stopLoss = currentPrice - (atr * 1.5);
    target1 = currentPrice + (atr * 2);
    target2 = currentPrice + (atr * 3.5);
  } else if (signal.action === 'sell') {
    entry = currentPrice;
    stopLoss = currentPrice + (atr * 1.5);
    target1 = currentPrice - (atr * 2);
    target2 = currentPrice - (atr * 3.5);
  } else {
    entry = currentPrice;
    stopLoss = currentPrice * 0.95;
    target1 = currentPrice * 1.05;
    target2 = currentPrice * 1.10;
  }
  
  // Ensure stop loss is reasonable
  stopLoss = Math.max(stopLoss, currentPrice * 0.85);
  if (signal.action === 'sell') {
    stopLoss = Math.min(stopLoss, currentPrice * 1.15);
  }
  
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target1 - entry);
  const riskReward = risk > 0 ? (reward / risk).toFixed(1) : '1.0';
  
  return {
    entry: Math.round(entry * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    target1: Math.round(target1 * 100) / 100,
    target2: Math.round(target2 * 100) / 100,
    riskReward: parseFloat(riskReward)
  };
}

// Generate reason for signal
function generateReason(symbol, fundamental, technical, financial, signal, macroReason = '') {
  const reasons = [];
  const m = fundamental.metrics || {};
  
  // Valuation signals
  if (m.peSignal === 'BUY') reasons.push(m.peRating);
  else if (m.peSignal === 'SELL') reasons.push(m.peRating);
  if (m.evSignal === 'BUY') reasons.push(m.evRating);
  if (m.pbSignal === 'BUY') reasons.push(m.pbRating);
  
  // Growth signals
  if (m.revSignal === 'BUY') reasons.push(m.revRating);
  else if (m.revSignal === 'SELL') reasons.push(m.revRating);
  if (m.epsSignal === 'BUY') reasons.push(m.epsRating);
  if (m.mgnSignal === 'BUY') reasons.push(m.mgnRating);
  else if (m.mgnSignal === 'WATCH') reasons.push(m.mgnRating);
  if (m.fcfSignal === 'BUY') reasons.push(m.fcfRating);
  
  // Balance sheet
  if (m.deSignal === 'BUY') reasons.push(m.debtRating);
  else if (m.deSignal === 'SELL') reasons.push(m.debtRating);
  if (m.roeSignal === 'BUY') reasons.push(m.roeRating);
  
  // Insider signals
  if (m.insiderSignal === 'STRONG BUY') reasons.push(m.insiderRating);
  if (m.insiderSignal === 'SELL') reasons.push(m.insiderRating);
  
  // Altman Z suppression
  if (m.altSignal === 'SUPPRESS') reasons.push(m.altRating);
  
  // News
  if (m.newsSignal === 'BUY') reasons.push(m.newsRating);
  else if (m.newsSignal === 'SELL') reasons.push(m.newsRating);
  
  // Technical reasons
  if (technical.score >= 75) {
    reasons.push('bullish technical setup');
    if (technical.indicators.rsiSignal && technical.indicators.rsiSignal.includes('Oversold')) {
      reasons.push('oversold conditions');
    }
    if (technical.indicators.macdSignal && technical.indicators.macdSignal.includes('Bullish')) {
      reasons.push('positive MACD momentum');
    }
  } else if (technical.score <= 40) {
    reasons.push('bearish technical indicators');
    if (technical.indicators.rsiSignal && technical.indicators.rsiSignal.includes('Overbought')) {
      reasons.push('overbought conditions');
    }
  }
  
  // Signal-specific reasons
  if (signal.signal === 'Strong Buy') {
    reasons.push('high conviction setup');
  } else if (signal.signal === 'Strong Sell') {
    reasons.push('significant downside risks');
  }
  
  // Macro reasons (if available)
  if (macroReason) {
    reasons.push(`Macro: ${macroReason}`);
  }
  
  return reasons.length > 0 ? reasons.join(', ') + '.' : 'Based on comprehensive analysis of fundamental, technical, and financial factors.';
}

// Main function to generate signals for all tracked stocks
async function generateSignals(marketData = null) {
  const signals = [];
  const symbols = ALL_SYMBOLS;

  // Fetch real-time news sentiment once for all stocks
  let newsSentiment = {};
  try {
    newsSentiment = await getAggregatedSentiment();
  } catch { /* silent — falls back to hardcoded neutral */ }
  
  for (const symbol of symbols) {
    try {
      const stock = getFundamentals(symbol);
      
      // Get current price (from market data or generate synthetic)
      let currentPrice;
      let priceChange;
      let volume;
      
      if (marketData && marketData[symbol]) {
        currentPrice = marketData[symbol].price;
        priceChange = marketData[symbol].changePercent;
        volume = marketData[symbol].volume;
      } else {
        // Generate realistic synthetic data
        const basePrices = {
          'SCOM': 28.5, 'EQTY': 52.0, 'KCB': 45.0, 'EABL': 165.0,
          'BAMB': 85.0, 'ABSA': 18.5, 'SBIC': 140.0, 'KPLC': 2.15,
          'NMG': 12.5, 'CRAY': 395.0,
          'AAPL': 270.1, 'MSFT': 428.16, 'NVDA': 118.74, 'TSLA': 176.43,
          'AMZN': 182.21, 'GOOGL': 171.54, 'META': 498.62, 'JPM': 198.74,
          'V': 281.15, 'NFLX': 622.47, 'LLY': 485.0, 'AVGO': 150.0,
          'UNH': 550.0, 'XOM': 118.0, 'PG': 168.0, 'JNJ': 155.0,
          'WMT': 68.0, 'CVX': 155.0, 'HD': 395.0, 'KO': 65.0,
          'PEP': 175.0, 'COST': 880.0, 'MRK': 120.0, 'ABBV': 180.0,
          'BAC': 38.0, 'TMO': 540.0, 'ORCL': 140.0, 'CSCO': 52.0,
          'ADBE': 540.0, 'CRM': 265.0, 'INTC': 25.0, 'TXN': 195.0,
          'QCOM': 170.0, 'AMGN': 320.0, 'IBM': 195.0, 'BA': 180.0,
          'GE': 170.0, 'CAT': 350.0, 'DIS': 105.0, 'MCD': 285.0,
          'NKE': 78.0, 'SBUX': 82.0, 'GS': 520.0, 'MS': 105.0,
          'C': 60.0, 'WFC': 60.0, 'BLK': 950.0, 'SCHW': 68.0,
          'AXP': 250.0, 'UPS': 155.0, 'RTX': 105.0, 'HON': 210.0,
          'LOW': 240.0, 'MMM': 120.0, 'MDT': 82.0, 'AMAT': 185.0,
          'MU': 120.0, 'NOW': 850.0, 'UBER': 72.0, 'ABNB': 140.0,
          'PLTR': 22.0, 'SNOW': 160.0, 'DDOG': 125.0, 'CRWD': 350.0,
          'PANW': 310.0, 'FTNT': 72.0, 'SQ': 75.0, 'PYPL': 65.0,
          'COIN': 200.0, 'GME': 25.0, 'AMC': 5.0, 'MRNA': 65.0,
        };
        currentPrice = basePrices[symbol] || 50 + Math.random() * 100;
        priceChange = (Math.random() - 0.45) * 8; // -3.6% to +4.4%
        volume = Math.floor(Math.random() * 5000000) + 100000;
      }
      
      // Perform analysis with real news sentiment
      const fundamental = analyzeFundamentals(symbol, currentPrice, newsSentiment[symbol] || null);
      const technical = analyzeTechnicals(symbol, currentPrice);
      const financial = analyzeFinancials(symbol);
      
      // Macro analysis for the stock's country
      const country = getCountryForSymbol(symbol);
      const macro = getMacroScore(country);
      
      // Calculate overall score (weighted average) - now includes macro
      const overallScore = (fundamental.score * 0.30) + (technical.score * 0.35) + (financial.score * 0.20) + (macro.score * 0.15);
      
      // Determine signal
      const signal = determineSignal(overallScore);
      const tradeType = determineTradeType(technical.score, fundamental.score);
      const tradeLevels = calculateTradeLevels(symbol, currentPrice, signal);
      
      // Calculate confidence based on score convergence
      const scoreVariance = Math.max(
        Math.abs(fundamental.score - overallScore),
        Math.abs(technical.score - overallScore),
        Math.abs(financial.score - overallScore),
        Math.abs(macro.score - overallScore)
      );
      const confidence = Math.min(95, Math.max(40, Math.round(overallScore - scoreVariance * 0.3)));
      
      // Generate reason
      const macroReason = generateMacroReason(macro);
      const reason = generateReason(symbol, fundamental, technical, financial, signal, macroReason);
      
      // Format volume
      const formattedVolume = volume >= 1000000 
        ? (volume / 1000000).toFixed(1) + 'M' 
        : (volume / 1000).toFixed(1) + 'K';
      
      // Determine timeframe based on trade type
      const timeframes = {
        'Intraday': 'Today',
        'Swing Trade': '2-4 weeks',
        'Long Term': '3-6 months'
      };
      
      const isNse = NSE_SYMBOLS.includes(symbol);
      signals.push({
        id: `signal-${symbol}-${Date.now()}`,
        ticker: symbol,
        name: stock.name,
        price: Math.round(currentPrice * 100) / 100,
        change: Math.round(priceChange * 10) / 10,
        market: isNse ? 'NSE' : 'Global',
        country,
        currency: isNse ? 'KES' : 'USD',
        type: tradeType,
        signal: signal.signal,
        entry: tradeLevels.entry,
        stopLoss: tradeLevels.stopLoss,
        target1: tradeLevels.target1,
        target2: tradeLevels.target2,
        riskReward: tradeLevels.riskReward,
        confidence,
        timeframe: timeframes[tradeType],
        sector: stock.sector,
        volume: formattedVolume,
        reason,
        analysis: {
          fundamental: {
            score: fundamental.score,
            grade: fundamental.fundamentalGrade,
            metrics: fundamental.metrics
          },
          technical: {
            score: technical.score,
            grade: technical.technicalGrade,
            indicators: technical.indicators
          },
          financial: {
            score: financial.score,
            grade: financial.financialGrade,
            analysis: financial.analysis
          },
          macro: {
            score: macro.score,
            grade: macro.grade,
            signal: macro.signal,
            country: macro.country,
            summary: macro.summary,
            conditions: macro.conditions
          },
          overall: {
            score: Math.round(overallScore),
            grade: getGrade(Math.round(overallScore))
          }
        },
        timestamp: new Date().toISOString(),
        lastUpdated: new Date().toLocaleString()
      });
      
    } catch (error) {
      console.error(`Error generating signal for ${symbol}:`, error.message);
    }
  }
  
  // Sort by confidence and signal strength
  signals.sort((a, b) => {
    const signalOrder = { 'Strong Buy': 6, 'Buy': 5, 'Accumulate': 4, 'Hold': 3, 'Sell': 2, 'Strong Sell': 1 };
    const aOrder = signalOrder[a.signal] || 3;
    const bOrder = signalOrder[b.signal] || 3;
    if (aOrder !== bOrder) return bOrder - aOrder;
    return b.confidence - a.confidence;
  });
  
  return signals;
}

// Get signal for a specific stock (works for ANY stock symbol)
async function getSignalForStock(symbol) {
  const upper = symbol.toUpperCase();
  // First check if it's in our main list
  if (ALL_SYMBOLS.includes(upper)) {
    const signals = await generateSignals();
    return signals.find(s => s.ticker === upper);
  }
  // Generate signal for a single unknown stock
  return generateSingleSignal(upper);
}

async function generateSingleSignal(symbol) {
  try {
    const stock = getFundamentals(symbol);
    const currentPrice = 50 + Math.random() * 100;
    const priceChange = (Math.random() - 0.45) * 8;
    const volume = Math.floor(Math.random() * 5000000) + 100000;
    // Fetch real news sentiment for this ticker
    let newsSent = null;
    try {
      const sentimentMap = await getAggregatedSentiment();
      newsSent = sentimentMap[symbol] || null;
    } catch { /* silent */ }
    const fundamental = analyzeFundamentals(symbol, currentPrice, newsSent);
    const technical = analyzeTechnicals(symbol, currentPrice);
    const financial = analyzeFinancials(symbol);
    const country = getCountryForSymbol(symbol);
    const macro = getMacroScore(country);
    const overallScore = (fundamental.score * 0.30) + (technical.score * 0.35) + (financial.score * 0.20) + (macro.score * 0.15);
    const sig = determineSignal(overallScore);
    const tradeType = determineTradeType(technical.score, fundamental.score);
    const tradeLevels = calculateTradeLevels(symbol, currentPrice, sig);
    const scoreVariance = Math.max(
      Math.abs(fundamental.score - overallScore),
      Math.abs(technical.score - overallScore),
      Math.abs(financial.score - overallScore),
      Math.abs(macro.score - overallScore)
    );
    const confidence = Math.min(95, Math.max(40, Math.round(overallScore - scoreVariance * 0.3)));
    const macroReason = generateMacroReason(macro);
    const reason = generateReason(symbol, fundamental, technical, financial, sig, macroReason);
    const formattedVolume = volume >= 1000000 ? (volume / 1000000).toFixed(1) + 'M' : (volume / 1000).toFixed(1) + 'K';
    const timeframes = { 'Intraday': 'Today', 'Swing Trade': '2-4 weeks', 'Long Term': '3-6 months' };
    const isNse = NSE_SYMBOLS.includes(symbol);
    return {
      id: `signal-${symbol}-${Date.now()}`, ticker: symbol, name: stock.name,
      price: Math.round(currentPrice * 100) / 100, change: Math.round(priceChange * 10) / 10,
      market: isNse ? 'NSE' : 'Global', country, currency: isNse ? 'KES' : 'USD',
      type: tradeType, signal: sig.signal, entry: tradeLevels.entry,
      stopLoss: tradeLevels.stopLoss, target1: tradeLevels.target1, target2: tradeLevels.target2,
      riskReward: tradeLevels.riskReward, confidence, timeframe: timeframes[tradeType],
      sector: stock.sector, volume: formattedVolume, reason,
      analysis: {
        fundamental: { score: fundamental.score, grade: fundamental.fundamentalGrade, metrics: fundamental.metrics },
        technical: { score: technical.score, grade: technical.technicalGrade, indicators: technical.indicators },
        financial: { score: financial.score, grade: financial.financialGrade, analysis: financial.analysis },
        macro: {
          score: macro.score, grade: macro.grade, signal: macro.signal,
          country: macro.country, summary: macro.summary, conditions: macro.conditions
        },
        overall: { score: Math.round(overallScore), grade: getGrade(Math.round(overallScore)) }
      },
      timestamp: new Date().toISOString(), lastUpdated: new Date().toLocaleString()
    };
  } catch (error) {
    console.error(`Error generating signal for ${symbol}:`, error.message);
    return null;
  }
}

// Get signals summary
async function getSignalsSummary() {
  const signals = await generateSignals();
  
  const summary = {
    total: signals.length,
    strongBuy: signals.filter(s => s.signal === 'Strong Buy').length,
    buy: signals.filter(s => s.signal === 'Buy').length,
    accumulate: signals.filter(s => s.signal === 'Accumulate').length,
    hold: signals.filter(s => s.signal === 'Hold').length,
    sell: signals.filter(s => s.signal === 'Sell').length,
    strongSell: signals.filter(s => s.signal === 'Strong Sell').length,
    avgConfidence: Math.round(signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length),
    topGainers: signals.sort((a, b) => b.change - a.change).slice(0, 5),
    highConfidence: signals.filter(s => s.confidence >= 80).length,
    bySector: {}
  };
  
  // Group by sector
  signals.forEach(s => {
    if (!summary.bySector[s.sector]) {
      summary.bySector[s.sector] = { count: 0, avgScore: 0, signals: [] };
    }
    summary.bySector[s.sector].count++;
    summary.bySector[s.sector].signals.push(s.signal);
  });
  
  // Calculate average score per sector
  Object.keys(summary.bySector).forEach(sector => {
    const sectorSignals = summary.bySector[sector].signals;
    const scoreMap = { 'Strong Buy': 90, 'Buy': 75, 'Accumulate': 60, 'Hold': 45, 'Sell': 30, 'Strong Sell': 15 };
    const totalScore = sectorSignals.reduce((sum, sig) => sum + (scoreMap[sig] || 45), 0);
    summary.bySector[sector].avgScore = Math.round(totalScore / sectorSignals.length);
  });
  
  return summary;
}

function searchStocks(query) {
  const q = query.toUpperCase().trim();
  if (!q || q.length < 1) return [];
  const results = [];
  const seen = new Set();

  // Search by ticker
  for (const sym of ALL_SYMBOLS) {
    if (sym.startsWith(q) || sym.includes(q)) {
      const fund = KNOWN_FUNDAMENTALS[sym] || generateFundamentals(sym);
      seen.add(sym);
      results.push({
        ticker: sym,
        name: fund.name || sym,
        sector: fund.sector || 'Other',
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }

  // Search by company name
  const nameMap = { ...KNOWN_NAMES };
  for (const sym of ALL_SYMBOLS) {
    const fund = KNOWN_FUNDAMENTALS[sym];
    if (fund && fund.name && fund.name.toUpperCase().includes(q) && !seen.has(sym)) {
      seen.add(sym);
      results.push({
        ticker: sym,
        name: fund.name,
        sector: fund.sector || 'Other',
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }
  for (const [sym, name] of Object.entries(nameMap)) {
    if (name.toUpperCase().includes(q) && !seen.has(sym)) {
      seen.add(sym);
      results.push({
        ticker: sym,
        name,
        market: NSE_SYMBOLS.includes(sym) ? 'NSE' : 'Global',
      });
    }
  }

  return results.slice(0, 20);
}

module.exports = { 
  generateSignals, 
  getSignalForStock, 
  getSignalsSummary,
  analyzeFundamentals,
  analyzeTechnicals,
  analyzeFinancials,
  searchStocks,
  warmFMPCache,
  getFundamentals,
  KNOWN_FUNDAMENTALS,
  generateFundamentals,
  ALL_SYMBOLS,
  NSE_SYMBOLS,
  US_SYMBOLS,
};