// News Service - Fetches real-time news from multiple sources for Kenyan stocks

const cheerio = require('cheerio');
const axios = require('axios');
const RssParser = require('rss-parser');
const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});
const { newsapi, finnhub: finnhubClient, generic } = require('./apiClient');
const sentimentHistory = require('./sentimentHistoryService');
const { US_SYMBOLS } = require('./stockData');

// API Keys - can be overridden by environment variables
const NEWSAPI_KEY = process.env.VITE_NEWSAPI_KEY || '16eb777bdf469c92f9522c287a7e4d';
const FINNHUB_KEY = process.env.VITE_FINNHUB_KEY || 'd7ji2ihr01qhf13euuvgd7ji2ihr01qhf13euv00';
const BENZINGA_KEY = process.env.VITE_BENZINGA_API_KEY || process.env.BENZINGA_API_KEY || '';

// Cache
let newsCache = [];
let newsCacheTime = 0;
const NEWS_CACHE_TTL = 60000;

console.log('📰 News Service Loaded');

// Kenyan stock symbols and company names for filtering news
const KENYAN_STOCKS = {
  'SCOM': 'Safaricom PLC',
  'EQTY': 'Equity Group Holdings',
  'KCB': 'KCB Group',
  'EABL': 'East African Breweries',
  'BAMB': 'Bamburi Cement PLC',
  'ABSA': 'Absa Bank Kenya PLC',
  'SBIC': 'Stanbic Holdings PLC',
  'KPLC': 'Kenya Power & Lighting Co PLC',
  'NMG': 'Nation Media Group PLC',
  'TOTL': 'TotalEnergies Marketing Kenya PLC',
  'SCBK': 'Standard Chartered Bank Kenya Ltd',
  'ARM': 'ARM Cement PLC',
  'KUKZ': 'Kakuzi PLC',
  'KAPC': 'Kapchorua Tea Kenya PLC',
  'LIMT': 'Limuru Tea Plc',
  'WTK': 'Williamson Tea Kenya PLC',
  'SASN': 'Sasini PLC',
  'REA': 'Rea Vipingo Plantations Ltd',
  'EGAD': 'Eaagads Ltd',
  'CGEN': 'Car & General (Kenya) PLC',
  'COOP': 'Co-operative Bank of Kenya Ltd',
  'NCBA': 'NCBA Group PLC',
  'IMH': 'I&M Group PLC',
  'DTK': 'Diamond Trust Bank Kenya Ltd',
  'BKG': 'BK Group PLC',
  'HFCK': 'HF Group PLC',
  'SGL': 'Standard Group PLC',
  'TPSE': 'TPS Eastern Africa Ltd',
  'SCAN': 'WPP Scangroup Ltd',
  'KQ': 'Kenya Airways PLC',
  'XPRS': 'Express Kenya Ltd',
  'SMER': 'Sameer Africa PLC',
  'PORT': 'E.A. Portland Cement Co. Ltd',
  'CRWN': 'Crown Paints Kenya PLC',
  'KEGN': 'KenGen Co. PLC',
  'UMME': 'Umeme Ltd',
  'JUB': 'Jubilee Holdings Ltd',
  'KNRE': 'Kenya Re-Insurance Corp Ltd',
  'CIC': 'CIC Insurance Group PLC',
  'BRIT': 'Britam Holdings PLC',
  'LBTY': 'Liberty Kenya Holdings Ltd',
  'SLAM': 'Sanlam Kenya PLC',
  'CTUM': 'Centum Investment Company PLC',
  'OCH': 'Olympia Capital Holdings Ltd',
  'HAFR': 'Home Afrika Ltd',
  'NSE': 'Nairobi Securities Exchange PLC',
  'AMAC': 'Africa Mega Agricorp PLC',
  'BAT': 'British American Tobacco Kenya PLC',
  'BOC': 'B.O.C Kenya Ltd',
  'CARB': 'Carbacid Investments Ltd',
  'UNGA': 'Unga Group PLC',
  'MSC': 'Mumias Sugar Co. Ltd',
  'FTGH': 'Flame Tree Group Holdings Ltd',
  'EVRD': 'Eveready East Africa PLC',
  'LKL': 'Longhorn Publishers Ltd',
  'NBV': 'Nairobi Business Ventures Ltd',
  'UCHM': 'Uchumi Supermarkets PLC',
  'ALP': 'ALP Real Estate Investment Trust',
  'CABL': 'East African Cables',
  'DCON': 'Deacons East Africa',
  'GLD': 'Absa NewGold ETF',
  'HBE': 'Homeboyz Entertainment',
  'KPC': 'Kenya Pipeline Company',
  'KPLC-P4': 'Kenya Power 4% Preference Shares',
  'KPLC-P7': 'Kenya Power 7% Preference Shares',
  'KURV': 'Kurwitu Ventures Ltd',
  'LAPR': 'Laptrust Imara Income-REIT',
  'SKL': 'Shri Krishana Overseas Ltd',
  'SMWF': 'Satrix MSCI World Feeder ETF',
  'TCL': 'TransCentury Plc',
  KLG: 'Kenya Airways',
  BRDR: "Bird's Broilers",
  OLYM: 'Olympia Capital',
  TPS: 'TPS Serengeti Breweries',
  CRAY: 'Crown Paints',
  UMEM: 'Umeme'
};

const STOCK_SYMBOLS = Object.keys(KENYAN_STOCKS);

// Kenyan news sources for better local coverage
const KENYAN_NEWS_SOURCES = [
  'businessdailyafrica.com',
  'nation.africa',
  'standardmedia.co.ke',
  'the-star.co.ke',
  'citizentv.co.ke',
  'k24tv.co.ke',
  'ntv.co.ke',
  'kbc.co.ke',
  'kenyanews.go.ke'
];

// Global financial news RSS feeds
const GLOBAL_RSS_FEEDS = [
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories', source: 'MarketWatch' },
  { url: 'https://www.ft.com/rss/home', source: 'Financial Times' },
  { url: 'https://www.theguardian.com/business/rss', source: 'The Guardian' },
];

// Parse relative time strings ("2 days ago", "4h ago") into Date
function parseRelativeTime(str) {
  const now = new Date();
  const m = str.match(/(\d+)\s*(minute|hour|day|week|month|d|h|m|s)/);
  if (!m) return now;
  const n = parseInt(m[1]);
  switch (m[2]) {
    case 's': return new Date(now - n * 1000);
    case 'm': case 'minute': return new Date(now - n * 60000);
    case 'h': case 'hour': return new Date(now - n * 3600000);
    case 'd': case 'day': return new Date(now - n * 86400000);
    case 'week': return new Date(now - n * 604800000);
    case 'month': return new Date(now - n * 2592000000);
    default: return now;
  }
}

// Get time ago string
function getTimeAgo(date) {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Simple sentiment analysis based on keywords
function analyzeSentiment(text) {
  const positiveKeywords = [
    'growth', 'surge', 'rally', 'gain', 'profit', 'up', 'rise', 'beat', 'exceed',
    'outperform', 'bullish', 'strong', 'success', 'record', 'expand', 'positive'
  ];
  const negativeKeywords = [
    'decline', 'fall', 'loss', 'crash', 'down', 'slump', 'miss', 'underperform',
    'bearish', 'weak', 'struggle', 'pressure', 'challenge', 'cut', 'negative'
  ];

  const lowerText = text.toLowerCase();
  const positiveCount = positiveKeywords.filter(keyword => lowerText.includes(keyword)).length;
  const negativeCount = negativeKeywords.filter(keyword => lowerText.includes(keyword)).length;

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

// Major US tickers for news matching (curated to avoid common-word collisions)
// Full US signal universe for news matching. Only tickers of length >= 3 go in
// the word-boundary regex: shorter tickers collide with everyday words (F-16,
// T-Mobile, "on", "so", "tm", "ip") and would mint false catalyst/sentiment tags
// that swing scores. Every other 1- and 2-character ticker is recovered via a
// distinctive company-name alias below (e.g. 'at&t', 'citigroup', 'kroger').
// LEGACY_SHORT_TICKERS were already in production's regex; they're kept so
// literal-ticker headlines ("GE reports earnings") keep matching.
const LEGACY_SHORT_TICKERS = ['PG', 'HD', 'KO', 'BA', 'GE', 'GS', 'MS', 'SQ', 'ZM'];
const US_TICKERS = [...US_SYMBOLS.filter(t => t.length >= 3), ...LEGACY_SHORT_TICKERS];

// Alpha Vantage NEWS_SENTIMENT caps each query at 50 tickers.
const AV_QUERY_TICKERS = US_TICKERS.slice(0, 50);

// Combined ticker list for news matching
const ALL_NEWS_TICKERS = [...STOCK_SYMBOLS, ...US_TICKERS];
const ALL_NEWS_TICKER_SET = new Set(ALL_NEWS_TICKERS.map(t => t.toUpperCase()));

// Match only literal all-caps symbols ("NVDA jumped", "$SCOM", "EQTY"). Tickers
// are deliberately NOT matched case-insensitively: lowercase common words that
// happen to be tickers ("has", "are", "low", "key") used to mint false tags that
// dominated picks. A title-case "Are"/"Has" at sentence start is excluded too.

// Company-name aliases -> ticker. Headlines almost always use company names
// ("Kenya Airways", "Safaricom") rather than tickers ("KQ", "SCOM"), so the
// symbol regex alone misses nearly every fetched Kenyan article and the
// sentiment map collapses to empty. Match distinctive full names/fragments.
// Aliases are chosen to be specific enough to avoid common-word collisions
// (e.g. "equity group" instead of bare "equity").
const NAME_ALIASES = {
  'safaricom': 'SCOM',
  'equity group': 'EQTY',
  'equity bank': 'EQTY',
  'kcb group': 'KCB',
  'east african breweries': 'EABL',
  'bamburi': 'BAMB',
  'absa bank': 'ABSA',
  'absa': 'ABSA',
  'stanbic': 'SBIC',
  'kenya power': 'KPLC',
  'nation media': 'NMG',
  'totalenergies': 'TOTL',
  'total energies': 'TOTL',
  'standard chartered': 'SCBK',
  'kakuzi': 'KUKZ',
  'kapchorua': 'KAPC',
  'williamson tea': 'WTK',
  'sasini': 'SASN',
  'rea vipingo': 'REA',
  'eaagads': 'EGAD',
  'car & general': 'CGEN',
  'car and general': 'CGEN',
  'co-operative bank': 'COOP',
  'cooperative bank': 'COOP',
  'ncba': 'NCBA',
  'i&m group': 'IMH',
  'i & m group': 'IMH',
  'diamond trust': 'DTK',
  'bk group': 'BKG',
  'hf group': 'HFCK',
  'standard group': 'SGL',
  'tps eastern africa': 'TPSE',
  'scangroup': 'SCAN',
  'kenya airways': 'KQ',
  'express kenya': 'XPRS',
  'sameer africa': 'SMER',
  'portland cement': 'PORT',
  'crown paints': 'CRWN',
  'kengen': 'KEGN',
  'umeme': 'UMME',
  'jubilee holdings': 'JUB',
  'jubilee insurance': 'JUB',
  'kenya re': 'KNRE',
  'cic insurance': 'CIC',
  'britam': 'BRIT',
  'liberty kenya': 'LBTY',
  'sanlam': 'SLAM',
  'centum': 'CTUM',
  'olympia capital': 'OCH',
  'home afrika': 'HAFR',
  'africa mega': 'AMAC',
  'british american tobacco': 'BAT',
  'carbacid': 'CARB',
  'unga': 'UNGA',
  'mumias': 'MSC',
  'flame tree': 'FTGH',
  'eveready': 'EVRD',
  'longhorn publishers': 'LKL',
  'uchumi': 'UCHM',
  'east african cables': 'CABL',
  'deacons': 'DCON',
  'homeboyz': 'HBE',
  'kenya pipeline': 'KPC',
  'kurwitu': 'KURV',
  'laptrust': 'LAPR',
  'transcentury': 'TCL',
  'nairobi securities exchange': 'NSE',
  // US mega-caps (distinctive names only, to keep the global feed useful)
  'apple': 'AAPL',
  'microsoft': 'MSFT',
  'alphabet': 'GOOGL',
  'nvidia': 'NVDA',
  'meta': 'META',
  'facebook': 'META',
  'tesla': 'TSLA',
  'netflix': 'NFLX',
  'jpmorgan': 'JPM',
  'walmart': 'WMT',
  'exxon': 'XOM',
  'johnson & johnson': 'JNJ',
  'visa': 'V',
  'salesforce': 'CRM',
  'adobe': 'ADBE',
  'intel': 'INTC',
  'boeing': 'BA',
  'goldman sachs': 'GS',
  'morgan stanley': 'MS',
  // 1- and 2-character US tickers can't use the word-boundary regex (F-16,
  // T-Mobile, "on", "so" collisions), so recover them via distinctive company
  // names. Chosen to be specific enough to avoid common-word collisions.
  'ford motor': 'F',
  'citigroup': 'C',
  'at&t': 'T',
  'realty income': 'O',
  'wayfair': 'W',
  'kellogg': 'K',
  'kellanova': 'K',
  'procter & gamble': 'PG',
  'procter and gamble': 'PG',
  'home depot': 'HD',
  'coca-cola': 'KO',
  'general electric': 'GE',
  'micron': 'MU',
  'block inc': 'SQ',
  'verizon': 'VZ',
  'colgate': 'CL',
  'zoom': 'ZM',
  'electronic arts': 'EA',
  'dollar general': 'DG',
  'kroger': 'KR',
  'deere': 'DE',
  'waste management': 'WM',
  'bank of new york': 'BK',
  'bny': 'BK',
  'general motors': 'GM',
  'zscaler': 'ZS',
  'cigna': 'CI',
  'edwards lifesciences': 'EW',
  'fiserv': 'FI',
  'chubb': 'CB',
  'southern company': 'SO',
  'consolidated edison': 'ED',
  'general dynamics': 'GD',
  'dupont': 'DD',
  'trane technologies': 'TT',
  'trane': 'TT',
  'parker hannifin': 'PH',
  'ingersoll rand': 'IR',
  'international paper': 'IP',
  'cf industries': 'CF',
  'onsemi': 'ON',
  'on semiconductor': 'ON',
  'regions financial': 'RF',
  'toyota': 'TM',
  'nubank': 'NU',
  'planet labs': 'PL',
};

// Longest alias first so "kenya power" isn't shadowed by a shorter subset.
const NAME_ALIAS_ENTRIES = Object.entries(NAME_ALIASES).sort((a, b) => b[0].length - a[0].length);

function extractRelatedStocks(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const found = new Set();
  // Distinctive company names ("Safaricom", "Kenya Airways") can't collide with
  // everyday words, so they always tag.
  for (const [name, ticker] of NAME_ALIAS_ENTRIES) {
    if (lower.includes(name)) found.add(ticker);
  }
  // Literal all-caps symbol mentions only. Case-sensitive, so the word "has" or
  // "Are" never tags a stock; a genuine symbol like "NVDA" always does.
  const words = raw.match(/\$?[A-Z]{2,6}\b/g) || [];
  for (const w of words) {
    const t = w.startsWith('$') ? w.slice(1) : w;
    if (ALL_NEWS_TICKER_SET.has(t)) found.add(t);
  }
  return [...found];
}

// Cache aggregated sentiment to avoid repeated API calls
let sentimentCache = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getAggregatedSentiment() {
  if (sentimentCache && Date.now() - sentimentCacheTime < SENTIMENT_CACHE_TTL) {
    return sentimentCache;
  }
  const news = await Promise.race([
    getAllNews(),
    new Promise(resolve => setTimeout(() => resolve([]), 20000)),
  ]);
  const realNews = news.filter(a => !a.isMock);
  const sentimentCounts = {};

  for (const article of realNews) {
    for (const ticker of article.relatedStocks) {
      if (!sentimentCounts[ticker]) {
        sentimentCounts[ticker] = { positive: 0, negative: 0, neutral: 0 };
      }
      sentimentCounts[ticker][article.sentiment]++;
    }
  }

  const result = {};
  for (const [ticker, counts] of Object.entries(sentimentCounts)) {
    if (counts.positive > counts.negative && counts.positive > counts.neutral) {
      result[ticker] = 'positive';
    } else if (counts.negative > counts.positive && counts.negative > counts.neutral) {
      result[ticker] = 'negative';
    } else {
      result[ticker] = 'neutral';
    }
  }

  // Persist today's real articles so quiet days keep a recent sentiment, then merge
  // recent history back in to fill gaps (live wins over historical).
  sentimentHistory.persist(realNews).catch(() => {});
  try {
    const historical = await sentimentHistory.getHistorical(sentimentHistory.HISTORY_WINDOW_DAYS);
    Object.assign(result, sentimentHistory.mergeSentimentMaps(result, historical));
  } catch { /* sentiment history unavailable; live map still valid */ }

  sentimentCache = result;
  sentimentCacheTime = Date.now();
  return result;
}

// ─── Catalyst aggregation ────────────────────────────────────────────────────
// Per-symbol strongest deal/narrative catalyst (M&A talk, capital injection,
// crisis...). Historical rows fill gaps so a catalyst survives quiet days.
// Returns { [SYMBOL]: { direction, type, strength, headline, source, publishedAt } }.
let catalystCache = null;
let catalystCacheTime = 0;

async function getCatalysts() {
  if (catalystCache && Date.now() - catalystCacheTime < SENTIMENT_CACHE_TTL) {
    return catalystCache;
  }
  const news = await Promise.race([
    getAllNews(),
    new Promise(resolve => setTimeout(() => resolve([]), 20000)),
  ]);
  const realNews = news.filter(a => !a.isMock && a.catalyst && a.catalystDirection);
  const result = {};
  for (const a of realNews) {
    for (const ticker of a.relatedStocks || []) {
      const t = String(ticker).toUpperCase();
      if (!t) continue;
      const strength = Number(a.catalystStrength) || 1;
      const prev = result[t];
      const prevTime = prev ? new Date(prev.publishedAt).getTime() : 0;
      const thisTime = new Date(a.publishedAt).getTime() || 0;
      if (!prev || strength > prev.strength || (strength === prev.strength && thisTime > prevTime)) {
        result[t] = {
          direction: a.catalystDirection,
          type: a.catalyst,
          strength,
          headline: String(a.headline || '').slice(0, 200),
          source: a.source || '',
          publishedAt: a.publishedAt || null,
        };
      }
    }
  }

  try {
    const historical = await sentimentHistory.getCatalystHistorical(sentimentHistory.HISTORY_WINDOW_DAYS);
    for (const [t, h] of Object.entries(historical)) {
      if (!result[t]) result[t] = h;
    }
  } catch { /* history unavailable; live map still valid */ }

  catalystCache = result;
  catalystCacheTime = Date.now();
  return result;
}

// Per-symbol news-derived insider/director activity. Combines today's live feed
// (articles whose headlines classify as insider buys/sells) with persisted
// history, so the insider dimension for a symbol survives quiet days the same
// way catalysts do. Returns { [SYMBOL]: { buys, sells, latestTs, latestDate,
// latestText, latestSource } }.
let insiderNewsCache = null;
let insiderNewsCacheTime = 0;

async function getInsiderNewsSignals() {
  if (insiderNewsCache && Date.now() - insiderNewsCacheTime < SENTIMENT_CACHE_TTL) {
    return insiderNewsCache;
  }
  const news = await Promise.race([
    getAllNews(),
    new Promise(resolve => setTimeout(() => resolve([]), 20000)),
  ]);
  // Persist classified articles so they count across days (idempotent).
  sentimentHistory.persist(news.filter(a => !a.isMock && a.insiderDirection)).catch(() => {});
  const result = {};
  for (const a of news) {
    if (a.isMock) continue;
    const dir = a.insiderDirection;
    if (dir !== 'buy' && dir !== 'sell') continue;
    const ts = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    for (const ticker of a.relatedStocks || []) {
      const t = String(ticker).toUpperCase();
      if (!t) continue;
      if (!result[t]) result[t] = { buys: 0, sells: 0, latestTs: 0, latestDate: null, latestText: null, latestSource: null };
      const e = result[t];
      if (dir === 'buy') e.buys++;
      else e.sells++;
      if (ts > e.latestTs) {
        e.latestTs = ts;
        e.latestDate = a.publishedAt ? a.publishedAt.slice(0, 10) : null;
        e.latestText = String(a.headline || '').slice(0, 160);
        e.latestSource = a.source || null;
      }
    }
  }
  try {
    const historical = await sentimentHistory.getInsiderHistorical(sentimentHistory.HISTORY_WINDOW_DAYS);
    for (const [t, h] of Object.entries(historical)) {
      if (!result[t]) result[t] = h;
      else {
        result[t].buys += h.buys;
        result[t].sells += h.sells;
        if (h.latestTs > result[t].latestTs) {
          result[t].latestTs = h.latestTs;
          result[t].latestDate = h.latestDate;
          result[t].latestText = h.latestText;
          result[t].latestSource = h.latestSource;
        }
      }
    }
  } catch { /* history unavailable; live map still valid */ }
  insiderNewsCache = result;
  insiderNewsCacheTime = Date.now();
  return result;
}

// Determine if article is NSE-related or global
// Only classify as NSE if article text contains NSE/Kenyan context keywords
function classifyArticle(title, excerpt, relatedStocks) {
  const lower = (title + ' ' + excerpt).toLowerCase();
  const nseKeywords = ['nse', 'nairobi', 'kenya', 'nairobi securities exchange',
    'safaricom', 'equity bank', 'kcb', 'eabl', 'east african', 'central bank of kenya',
    'cbk', 'shilling', 'kenyan', 'nairobi stock'];
  if (nseKeywords.some(k => lower.includes(k))) return 'nse';
  return 'global';
}

// Hot news keywords that could drive prices
const HOT_NEWS_KEYWORDS = {
  'IPO': ['ipo', 'initial public offering', 'going public', 'listing', 'debut'],
  'Earnings': ['earnings', 'quarterly results', 'profit', 'revenue', 'loss', 'annual results', 'half-year', 'half year', 'financial results', 'turnover', 'dividend'],
  'Merger': ['merger', 'acquisition', 'acquire', 'takeover', 'buyout', 'merged', 'acquiring', 'buys'],
  'Partnership': ['partnership', 'alliance', 'collaboration', 'joint venture', 'deal with', 'agreement with', 'strategic partnership'],
  'Regulatory': ['regulatory', 'approval', 'license', 'central bank', 'cbk', 'cma', 'sec', 'court ruling', 'government', 'policy', 'tax', 'tariff', 'sanction'],
  'Expansion': ['expansion', 'new market', 'entering', 'launch', 'new product', 'new service', 'unveils', 'opens', 'new branch', 'new plant', 'new factory', 'expands'],
  'Funding': ['funding', 'investment', 'raised', 'capital', 'financing', 'loan', 'bond', 'securities', 'shares', 'rights issue', 'bonus'],
  'Leadership': ['ceo', 'appointed', 'resigned', 'board', 'chairman', 'director', 'executive', 'management', 'leadership change'],
  'Crisis': ['crisis', 'scandal', 'fraud', 'investigation', 'probe', 'lawsuit', 'litigation', 'bankruptcy', 'default', 'audit', 'irregularities']
};

function classifyHotNews(title, excerpt) {
  const text = (title + ' ' + excerpt).toLowerCase();
  for (const [type, keywords] of Object.entries(HOT_NEWS_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      return { hot: true, hotType: type };
    }
  }
  return { hot: false, hotType: null };
}

// ─── Directed deal/narrative catalysts ───────────────────────────────────────
// Distinct from daily sentiment: a catalyst is a specific market-moving event
// (M&A / strategic-investor talk, capital injection, crisis, deal collapse).
// These routinely drive rallies independent of the company's last audited
// financials — KQ's strategic-investor talks, NCBA's takeover bid — so the
// signal engine treats them as a separate overlay instead of a generic
// ±sentiment tick. Only one (strongest) catalyst is reported per article.
const CATALYST_RULES = [
  { type: 'M&A', direction: 'positive', strength: 2, keywords: [
    'acqui', 'takeover', 'buyout', 'merger', 'merged', 'merging', 'merges with',
    'bid for', 'bid to', 'offer for', 'offer to', 'expression of interest', ' eoi ',
    'strategic investor', 'strategic partner', 'strategic sale', 'talks to', 'in talks',
    'investor talks', 'investor to', 'potential investor', 'new investor', 'foreign investor',
    'to sell', 'sale of', 'stake in', 'sell its stake', 'selling its stake',
    'pursuit', 'considers', 'mulling', 'reportedly interested', 'exploring options',
  ]},
  { type: 'Capital', direction: 'positive', strength: 2, keywords: [
    'capital injection', 'recapitali', 'rights issue', 'private placement',
    'fresh capital', 'raise capital', 'funding round', 'debt conversion',
    'debt-to-equity', 'capital raise', 'equity injection',
    'rescue deal', 'bailout', 'bail out', 'rescue',
  ]},
  { type: 'Regulatory', direction: 'positive', strength: 1, keywords: [
    'approved', 'approval', 'licensed', 'cbk approval', 'cma approval', 'green light',
  ]},
  { type: 'Crisis', direction: 'negative', strength: 2, keywords: [
    'fraud', 'investigation', 'probe', 'lawsuit', 'litigation', 'scandal',
    'bankruptcy', 'insolven', 'default', 'profit warning', 'loss warning',
    'suspended', 'delist', 'irregularit', 'embezzlement', 'money laundering',
  ]},
  { type: 'DealCollapse', direction: 'negative', strength: 2, keywords: [
    'talks collapse', 'deal collapses', 'walked away', 'shelved', 'rejected bid',
    'withdrew', 'withdraws', 'abandon', 'stalled', 'no deal', 'called off',
  ]},
  { type: 'Capital', direction: 'positive', strength: 1, keywords: [
    'accumulat', 'shareholder buys', 'shareholder raises stake', 'buys stake in',
  ], regex: [
    /\b(buys?|bought|purchases|purchased|accumulates|accumulating)\b.{0,60}?\bshares?\b/i,
    /\b(buys?|bought|purchases|purchased)\b.{0,40}?\bstake\b/i,
  ]},
  { type: 'Operational', direction: 'positive', strength: 1, keywords: [
    'load factor', 'turnaround', 'passenger traffic', 'passenger volumes',
    'record passenger', 'improved load', 'return to profit', 'record revenue',
    'record earnings', 'soaring passenger',
  ]},
];

function classifyCatalyst(title, excerpt) {
  const text = (title + ' ' + excerpt).toLowerCase();
  let best = null;
  for (const rule of CATALYST_RULES) {
    const kwHit = rule.keywords.some(k => text.includes(k));
    const rxHit = rule.regex ? rule.regex.some(r => r.test(text)) : false;
    if (kwHit || rxHit) {
      // Strongest first; keep the first (highest-strength) match.
      if (!best || rule.strength > best.strength) {
        best = { catalyst: rule.type, direction: rule.direction, strength: rule.strength };
      }
    }
  }
  if (best) return best;
  return { catalyst: null, direction: null, strength: 0 };
}

// ─── Insider/director-transaction detection from news ────────────────────────
// NSE stocks have no Yahoo insider ownership coverage, so the engine derives
// the insider dimension for them from reported transactions: director/CEO/
// major-shareholder purchases and sales, and the "Acquisition/Disposal of
// shares by director" phrasing NSE director-dealings notices use. Every match
// carries a direction so the signal builder can score conviction like the
// Yahoo-based scorer does for US symbols.
const INSIDER_RULES = [
  { direction: 'buy', type: 'insider-buy', regex: [
    /\b(director|directors|chairman|chairwoman|chairperson|ceo|managing director|\bmd\b|executive|executives|founder|board member|board|insider|insiders|major shareholder|largest shareholder|controlling shareholder|tycoon|billionaire)\b.{0,70}?\b(buys?|bought|purchases?|purchased|acquires?|acquired|accumulates?|accumulating|raises? stake|increases? stake|increases? (his|her|its|their) holding|adds? to|takes? (a )?stake)\b/i,
    /\b(buys?|bought|purchases?|purchased|acquires?|acquired|accumulates?)\b.{0,45}?\b(shares?|stake|stock|holding)\b.{0,60}?\b(by a director|by the chairman|by the ceo|by executives|by insiders|by the board|by management|by the founder)\b/i,
    /(acquisition|acquisitions|acquires?|acquired) of shares (by|from) (a )?(director|chairman|ceo|executive|insider|the board|management)/i,
  ]},
  { direction: 'sell', type: 'insider-sell', regex: [
    /\b(director|directors|chairman|chairwoman|chairperson|ceo|managing director|\bmd\b|executive|executives|founder|board member|board|insider|insiders|major shareholder|largest shareholder|controlling shareholder|tycoon|billionaire)\b.{0,70}?\b(sells?|sold|offloads?|offloaded|disposes?|disposed|reduces? stake|trims?|cuts? stake|exits?|sheds?)\b/i,
    /\b(sells?|sold|offloads?|offloaded|disposes?|disposed)\b.{0,45}?\b(shares?|stake|stock|holding)\b.{0,60}?\b(by a director|by the chairman|by the ceo|by executives|by insiders|by the board|by management|by the founder)\b/i,
    /(disposal|disposals|disposes?|disposed) of shares (by|of) (a )?(director|chairman|ceo|executive|insider|the board|management)/i,
    /sale of shares (by|of) (a )?(director|chairman|ceo|executive|insider|the board|management)/i,
  ]},
];

function classifyInsider(title, excerpt) {
  const text = (String(title || '') + ' ' + String(excerpt || '')).toLowerCase();
  for (const rule of INSIDER_RULES) {
    if (rule.regex.some(r => r.test(text))) {
      return { direction: rule.direction, type: rule.type };
    }
  }
  return { direction: null, type: null };
}

// Fetch news from NewsAPI with Kenyan focus
async function fetchFromNewsAPI() {
  if (!NEWSAPI_KEY || NEWSAPI_KEY === 'your_newsapi_key_here') {
    console.log('⚠️ NewsAPI key not configured, skipping NewsAPI fetch');
    return [];
  }

  try {
    // Search for Kenyan business and stock market news
    const queries = [
      'Kenya stock market',
      'Nairobi Securities Exchange',
      'Safaricom',
      'Equity Group Kenya',
      'KCB Group',
      'Kenya business news',
      'NSE Kenya'
    ];

    const newsPromises = queries.map(query =>
      newsapi.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 5,
          apiKey: NEWSAPI_KEY
        },
        timeout: 5000
      })
    );

    const results = await Promise.allSettled(newsPromises);
    const articles = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.data.status === 'ok') {
        result.value.data.articles.forEach(article => {
          // Filter for relevant Kenyan business news
          if (article.title && article.description) {
            const relatedStocks = extractRelatedStocks(article.title + ' ' + article.description);
            const pubDate = new Date(article.publishedAt);
            articles.push({
              id: `newsapi-${Date.now()}-${Math.random()}`,
              headline: article.title,
              source: article.source.name,
              timestamp: getTimeAgo(pubDate),
              publishedAt: pubDate.toISOString(),
              category: classifyArticle(article.title, article.description, relatedStocks),
              relatedStocks,
              sentiment: analyzeSentiment(article.title + ' ' + article.description),
              excerpt: article.description || article.content?.substring(0, 200) || '',
              url: article.url,
              imageUrl: article.urlToImage
            });
          }
        });
      }
    });

    return articles;
  } catch (error) {
    console.error('Error fetching from NewsAPI:', error.message);
    return [];
  }
}

// Fetch news from Finnhub (if available)
async function fetchFromFinnhub() {
  if (!FINNHUB_KEY || FINNHUB_KEY === 'your_finnhub_key_here') {
    console.log('⚠️ Finnhub key not configured, skipping Finnhub fetch');
    return [];
  }

  try {
    // Finnhub doesn't have great coverage for NSE stocks, but we can try general market news
    const response = await finnhubClient.get('https://finnhub.io/api/v1/news', {
      params: {
        category: 'general',
        token: FINNHUB_KEY
      },
      timeout: 5000
    });

    return response.data.slice(0, 10).map(article => {
      const pubDate = new Date(article.datetime * 1000);
      const excerpt = article.summary || '';
      return {
        id: `finnhub-${article.id || Date.now()}`,
        headline: article.headline,
        source: article.source || 'Finnhub',
        timestamp: getTimeAgo(pubDate),
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(article.headline, excerpt, extractRelatedStocks(article.headline + ' ' + excerpt)),
        relatedStocks: extractRelatedStocks(article.headline + ' ' + excerpt),
        sentiment: analyzeSentiment(article.headline + ' ' + excerpt),
        excerpt,
        url: article.url,
        imageUrl: article.image
      };
    });
  } catch (error) {
    console.error('Error fetching from Finnhub:', error.message);
    return [];
  }
}

// Fetch news from Kenyan business sources (simulated for now, would need RSS feeds or scraping)
function getKenyanBusinessNews() {
  const now = Date.now();
  const makeArticle = (id, headline, source, hoursAgo, relatedStocks, sentiment, excerpt, url) => {
    const pubDate = new Date(now - hoursAgo * 3600000);
    return { id, headline, source, timestamp: getTimeAgo(pubDate), publishedAt: pubDate.toISOString(),
      category: 'nse', relatedStocks, sentiment, excerpt, url, imageUrl: null, isMock: true };
  };
  return [
    makeArticle('ke-business-1', 'NSE 20 Share Index gains 2.3% on banking sector rally', 'Business Daily Africa', 2, ['EQTY', 'KCB', 'SBIC'], 'positive',
      'The Nairobi Securities Exchange 20 Share Index closed higher on Tuesday, driven by strong gains in banking stocks including Equity Group, KCB, and Stanbic Holdings.', 'https://www.businessdailyafrica.com'),
    makeArticle('ke-business-2', 'Safaricom unveils new M-Pesa features to boost digital lending', 'Nation Africa', 4, ['SCOM'], 'positive',
      'Safaricom has launched new M-Pesa features aimed at expanding its digital lending portfolio, including Fuliza enhancements and new merchant payment solutions.', 'https://nation.africa'),
    makeArticle('ke-business-3', 'Kenya Power reports reduced losses in half-year results', 'The Star', 6, ['KPLC'], 'positive',
      'Kenya Power and Lighting Company reported a 40% reduction in losses for the half-year period, citing improved collections and reduced operational costs.', 'https://www.the-star.co.ke'),
    makeArticle('ke-business-4', 'East African Breweries launches new premium brand', 'Standard Media', 8, ['EABL'], 'positive',
      'East African Breweries has unveiled a new premium beer brand targeting the growing middle-class market in Kenya and the wider East African region.', 'https://www.standardmedia.co.ke'),
    makeArticle('ke-business-5', 'Nation Media Group expands digital subscription services', 'Citizen TV', 10, ['NMG'], 'positive',
      'Nation Media Group has announced the expansion of its digital subscription services, aiming to increase revenue from digital platforms by 50% this year.', 'https://citizentv.co.ke'),
    makeArticle('ke-business-6', 'Central Bank of Kenya maintains benchmark rate at 10.5%', 'KBC', 12, ['SCBK', 'EQTY', 'KCB', 'ABSA'], 'neutral',
      'The Central Bank of Kenya Monetary Policy Committee has decided to maintain the Central Bank Rate at 10.5%, citing stable inflation and exchange rate conditions.', 'https://www.kbc.co.ke'),
    makeArticle('ke-business-7', 'Bamburi Cement invests in green manufacturing initiatives', 'NTV Kenya', 14, ['BAMB'], 'positive',
      'Bamburi Cement has announced a $15 million investment in green manufacturing technologies as part of its sustainability commitment.', 'https://ntv.co.ke'),
    makeArticle('ke-business-8', 'Kenya Airways reports improved load factors in Q4', 'K24 TV', 16, ['KQ'], 'positive',
      'Kenya Airways has reported improved passenger load factors of 78% in Q4, up from 65% in the same period last year, driven by increased regional travel.', 'https://www.k24tv.co.ke'),
  ];
}

// Fetch article dates from KWS sitemap (cached)
let kwsDateCache = null;
let kwsDateCacheTime = 0;
const KWS_DATE_CACHE_TTL = 3600000; // 1 hour

async function fetchKwsSitemapDates() {
  const now = Date.now();
  if (kwsDateCache && now - kwsDateCacheTime < KWS_DATE_CACHE_TTL) return kwsDateCache;

  try {
    const smRes = await generic.get('https://kenyanwallstreet.com/sitemap.xml', { timeout: 10000 });
    const $ = cheerio.load(smRes.data, { xmlMode: true });
    const postSitemaps = [];
    $('sitemap loc').each(function() {
      var loc = $(this).text();
      if (loc.includes('/posts-')) postSitemaps.push(loc);
    });

    var dateMap = {};
    for (var sitemapUrl of postSitemaps.slice(0, 3)) {
      try {
        const res = await generic.get(sitemapUrl, { timeout: 10000 });
        const $$ = cheerio.load(res.data, { xmlMode: true });
        $$('url').each(function() {
          var loc = $$(this).find('loc').text().trim();
          var lastmod = $$(this).find('lastmod').text().trim();
          if (loc && lastmod) {
            dateMap[loc.replace('https://kenyanwallstreet.com', '')] = lastmod;
          }
        });
      } catch (e) { /* skip failed sitemap */ }
    }
    kwsDateCache = dateMap;
    kwsDateCacheTime = now;
    console.log(`  KWS sitemap: ${Object.keys(dateMap).length} dates cached`);
    return dateMap;
  } catch (e) {
    console.error('  KWS sitemap fetch failed:', e.message);
    return kwsDateCache || {};
  }
}

// Fetch news from Kenyan Wall Street by scraping SSR HTML
async function fetchFromKWS() {
  try {
    const [response, sitemapDates] = await Promise.all([
      generic.get('https://kenyanwallstreet.com/', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }),
      fetchKwsSitemapDates(),
    ]);

    const $ = cheerio.load(response.data);
    const articles = [];
    const seen = new Set();

    $('a[href]').each(function() {
      var href = $(this).attr('href');

      if (!href || !href.match(/^\/[a-z0-9-]+$/) ||
          href === '/' ||
          href.startsWith('/shows/') ||
          href.startsWith('/partnerships/') ||
          href.startsWith('/category/') ||
          href.startsWith('/author/') ||
          href.startsWith('/tag/')) return;

      if (seen.has(href)) return;
      seen.add(href);

      var img = $(this).find('img[alt]').first();
      var title = img.attr('alt');
      if (!title || title.length < 10) return;

      var excerpt = $(this).text().trim();
      if (excerpt.length > 300) excerpt = excerpt.substring(0, 300);

      // Get date from sitemap, fall back to current time
      var lastmod = sitemapDates[href];
      var pubDate = lastmod ? new Date(lastmod) : new Date();
      var timeAgo = getTimeAgo(pubDate);

      articles.push({
        id: 'kws-' + href.replace(/\//g, '') + '-' + Date.now(),
        headline: title.substring(0, 200),
        source: 'Kenyan Wall Street',
        timestamp: timeAgo,
        publishedAt: pubDate.toISOString(),
        category: 'nse',
        relatedStocks: extractRelatedStocks(title + ' ' + excerpt),
        sentiment: analyzeSentiment(title + ' ' + excerpt),
        excerpt: excerpt,
        url: 'https://kenyanwallstreet.com' + href,
        imageUrl: null
      });
    });

    console.log('  Fetched ' + articles.length + ' articles from Kenyan Wall Street');
    return articles.slice(0, 20);
  } catch (error) {
    console.error('  KWS fetch error:', error.message);
    return [];
  }
}

// Fetch news from global financial RSS feeds
async function fetchFromGlobalRSS() {
  const results = await Promise.allSettled(
    GLOBAL_RSS_FEEDS.map(feed =>
      rssParser.parseURL(feed.url).then(data => ({ feed, data }))
    )
  );

  const articles = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.log(`⚠️ RSS feed failed: ${result.reason?.message?.substring(0, 60)}`);
      continue;
    }
    const { feed, data } = result.value;
    if (!data.items?.length) continue;

    for (const item of data.items.slice(0, 8)) {
      const title = item.title?.trim();
      const excerpt = (item.contentSnippet || item.content || '').trim();
      if (!title || title.length < 10) continue;

      const pubDate = item.isoDate ? new Date(item.isoDate) : new Date();
      const relatedStocks = extractRelatedStocks(title + ' ' + excerpt);
      articles.push({
        id: `rss-${feed.source.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        headline: title.substring(0, 200),
        source: feed.source,
        timestamp: item.isoDate ? getTimeAgo(pubDate) : 'just now',
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(title, excerpt, relatedStocks),
        relatedStocks,
        sentiment: analyzeSentiment(title + ' ' + excerpt),
        excerpt: excerpt.substring(0, 300),
        url: item.link || '#',
        imageUrl: null,
      });
    }
  }

  console.log(`✅ Fetched ${articles.length} articles from global RSS feeds`);
  return articles;
}

// ─── Kenyan markets sources (Business Daily, Bizna Kenya) ───────────────────
// Business Daily is the primary Kenyan corporate/markets paper and routinely
// breaks the NSE deal/M&A/strategic-investor stories (KQ strategic-investor
// talks, NCBA takeover bid) that the other feeds miss. Listing pages carry the
// headline + URL but no date, so for articles that tag a stock we fetch the
// article page and read the JSON-LD datePublished (capped).
const KENYAN_MARKET_PAGES = [
  { url: 'https://www.businessdailyafrica.com/bd/markets', source: 'Business Daily', type: 'bd' },
  { url: 'https://www.businessdailyafrica.com/bd/markets/capital-markets', source: 'Business Daily', type: 'bd' },
  { url: 'https://biznakenya.com/', source: 'Bizna Kenya', type: 'bizna' },
];

function cleanKenyanTitle(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[A-Z][a-z]{2} [0-9]{1,2} - [0-9]+ min read\s*(PRIME\s*)?/i, '');
  t = t.replace(/^(capital markets|markets|market news|currencies|corporate|companies)\s+prime\s+/i, '');
  t = t.replace(/^prime\s+/i, '');
  if (/\b(min read|read more)\b/i.test(t) && t.length < 40) return '';
  return t;
}

async function fetchKenyanMarketPage({ url, source, type }) {
  try {
    const res = await generic.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(res.data);
    const articles = [];
    const seen = new Set();

    if (type === 'bd') {
      // Article cards are anchors whose URL ends in a numeric id; title is the
      // anchor text (possibly prefixed with a section label + "PRIME").
      $('a[href]').each(function() {
        const href = $(this).attr('href') || '';
        if (!href.match(/\/bd\/.+-[0-9]+$/)) return;
        if (seen.has(href)) return;
        seen.add(href);
        const heading = $(this).find('h1,h2,h3,h4').first().text();
        const title = cleanKenyanTitle(heading) || cleanKenyanTitle($(this).text());
        if (!title || title.length < 15) return;
        const relStocks = extractRelatedStocks(title);
        articles.push({
          id: 'bd-' + href.replace(/[^0-9]/g, '').slice(-14) + '-' + Date.now(),
          headline: title.substring(0, 200),
          source,
          publishedAt: null,
          category: 'nse',
          relatedStocks: relStocks,
          sentiment: analyzeSentiment(title),
          excerpt: '',
          url: 'https://www.businessdailyafrica.com' + href,
          imageUrl: null,
        });
      });
    } else if (type === 'bizna') {
      // Bizna cards expose <time datetime="..."> with the title + link nearby.
      $('time[datetime]').each(function() {
        const pubDate = new Date($(this).attr('datetime'));
        if (isNaN(pubDate.getTime())) return;
        let link = $(this).closest('a[href]').attr('href') || '';
        let title = '';
        let anc = $(this).parent();
        for (let i = 0; i < 5 && anc.length; i++) {
          const a = anc.find('a[href]').first();
          if (a.attr('href')) link = a.attr('href');
          const t = anc.find('h1,h2,h3,h4,[class*=title]').first().text().replace(/\s+/g, ' ').trim();
          if (t.length >= 10) { title = t; break; }
          anc = anc.parent();
        }
        if (!link || seen.has(link)) return;
        seen.add(link);
        if (title.length < 10) return;
        const relStocks = extractRelatedStocks(title);
        articles.push({
          id: 'bizna-' + link.replace(/[^a-z0-9]/gi, '').slice(-16) + '-' + Date.now(),
          headline: title.substring(0, 200),
          source,
          publishedAt: pubDate.toISOString(),
          category: 'nse',
          relatedStocks: relStocks,
          sentiment: analyzeSentiment(title),
          excerpt: '',
          url: link,
          imageUrl: null,
        });
      });
    }

    // Business Daily listing pages carry no dates; fetch the JSON-LD date for
    // stock-tagged articles only, so catalysts age correctly in history.
    const tagged = articles.filter(a => a.relatedStocks.length > 0 && !a.publishedAt).slice(0, 8);
    const withDates = await Promise.allSettled(tagged.map(async a => {
      try {
        const page = await generic.get(a.url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const m = String(page.data).match(/"datePublished"\s*:\s*"([^"]+)"/);
        const d = m ? new Date(m[1]) : null;
        if (d && !isNaN(d.getTime())) a.publishedAt = d.toISOString();
      } catch { /* keep null -> falls back to now */ }
      return a;
    }));
    for (const r of withDates) if (r.status === 'fulfilled' && r.value) r.value.publishedAt = r.value.publishedAt || new Date().toISOString();

    // Untagged Business Daily articles and any stragglers default to now.
    for (const a of articles) if (!a.publishedAt) a.publishedAt = new Date().toISOString();
    return articles;
  } catch (error) {
    console.error(`  ${source} fetch error:`, error.message);
    return [];
  }
}

async function fetchFromKenyanMarkets() {
  const results = await Promise.allSettled(KENYAN_MARKET_PAGES.map(p => fetchKenyanMarketPage(p)));
  const articles = [];
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) articles.push(...r.value);
  console.log(`✅ Fetched ${articles.length} articles from Kenyan markets sources`);
  return articles;
}

// Mock news data for demo purposes (fallback)
function getMockNews() {
  return [
    {
      id: 'news-1',
      headline: 'Safaricom reports record M-Pesa growth in Q1',
      source: 'Business Daily',
      timestamp: '1h ago',
      relatedStocks: ['SCOM'],
      sentiment: 'positive',
      excerpt: 'Safaricom\'s M-Pesa service saw unprecedented growth in Q1 with transactions up 25% year over year.',
      url: '#',
      imageUrl: null
    },
    {
      id: 'news-2',
      headline: 'Central Bank holds rates steady at 10.5%',
      source: 'Reuters',
      timestamp: '3h ago',
      relatedStocks: [],
      sentiment: 'neutral',
      excerpt: 'The Central Bank of Kenya maintained its benchmark rate at 10.5% as inflation pressures ease.',
      url: '#',
      imageUrl: null
    },
    {
      id: 'news-3',
      headline: 'Equity Group Q2 profit up 23% YoY',
      source: 'NSE',
      timestamp: '5h ago',
      relatedStocks: ['EQTY'],
      sentiment: 'positive',
      excerpt: 'Equity Group reported a 23% increase in profit for Q2, driven by strong loan growth and interest income.',
      url: '#',
      imageUrl: null
    },
    {
      id: 'news-4',
      headline: 'Kenya Airways gains 9% on strong traffic',
      source: 'Bloomberg',
      timestamp: '6h ago',
      relatedStocks: ['KQ'],
      sentiment: 'positive',
      excerpt: 'Kenya Airways shares rose 9% after reporting strong passenger traffic for the quarter.',
      url: '#',
      imageUrl: null
    },
    {
      id: 'news-5',
      headline: 'KCB Group expands into new markets',
      source: 'Financial Times',
      timestamp: '8h ago',
      relatedStocks: ['KCB'],
      sentiment: 'positive',
      excerpt: 'KCB Group announced expansion into three new East African markets.',
      url: '#',
      imageUrl: null
    }
  ].map(a => ({ ...a, isMock: true }));
}

// Fetch from Benzinga API (if configured)
async function fetchFromBenzinga() {
  if (!BENZINGA_KEY) return [];
  try {
    const res = await axios.get(`https://api.benzinga.com/api/v2/news`, {
      params: { token: BENZINGA_KEY, pageSize: 25, display_output: 'full' },
      timeout: 8000,
    });
    if (!res.data?.news) return [];
    return res.data.news.map(a => {
      const pubDate = new Date(a.created * 1000);
      const excerpt = a.body ? a.body.substring(0, 300) : '';
      const relatedStocks = (a.tickers || []).map(t => t.name.toUpperCase());
      const s = (a.sentiment || '').toLowerCase();
      const sentiment = s === 'positive' || s === 'bullish' ? 'positive' : s === 'negative' || s === 'bearish' ? 'negative' : 'neutral';
      return {
        id: `bz-${a.id}`,
        headline: a.title,
        source: 'Benzinga',
        timestamp: getTimeAgo(pubDate),
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(a.title, excerpt, relatedStocks),
        relatedStocks,
        sentiment,
        excerpt,
        url: a.url,
        imageUrl: a.image || null,
      };
    });
  } catch (e) {
    console.error('Error fetching from Benzinga:', e.message);
    return [];
  }
}

// Fetch news & sentiment from Alpha Vantage NEWS_SENTIMENT endpoint
async function fetchFromAlphaVantage() {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!alphaKey) return [];
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&apikey=${alphaKey}&limit=50`;
    const res = await axios.get(url, { timeout: 12000 });
    const feed = res.data?.feed;
    if (!Array.isArray(feed) || feed.length === 0) return [];
    return feed.map(a => {
      const pubDate = a.time_published
        ? new Date(
            `${a.time_published.slice(0,4)}-${a.time_published.slice(4,6)}-${a.time_published.slice(6,8)}T${a.time_published.slice(9,11)}:${a.time_published.slice(11,13)}:${a.time_published.slice(13,15)}`
          )
        : new Date();
      if (isNaN(pubDate.getTime())) pubDate = new Date();

      const label = (a.overall_sentiment_label || '').toLowerCase();
      let sentiment = 'neutral';
      if (label.includes('bullish')) sentiment = 'positive';
      else if (label.includes('bearish')) sentiment = 'negative';

      const relatedStocks = Array.isArray(a.ticker_sentiment)
        ? a.ticker_sentiment.map(t => (t.ticker || '').toUpperCase()).filter(Boolean)
        : [];

      const title = a.title || '';
      const excerpt = a.summary || '';

      return {
        id: `av-${a.url ? a.url.replace(/[^a-z0-9]/gi, '').slice(-24) : Math.random().toString(36).slice(2)}`,
        headline: title.substring(0, 200),
        source: a.source || 'Alpha Vantage',
        timestamp: getTimeAgo(pubDate),
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(title, excerpt, relatedStocks),
        relatedStocks,
        sentiment,
        sentimentScore: typeof a.overall_sentiment_score === 'number' ? a.overall_sentiment_score : null,
        excerpt: excerpt.substring(0, 300),
        url: a.url || '#',
        imageUrl: a.banner_image || null,
      };
    });
  } catch (e) {
    console.error('Error fetching from Alpha Vantage news:', e.message);
    return [];
  }
}

// Fetch the article page and extract a real meta description excerpt
const https = require('https');
const yahooAgent = new https.Agent({ maxHeaderSize: 100000000 });
async function fetchYahooExcerpt(url) {
  if (!url || url === '#') return null;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      httpsAgent: yahooAgent,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const $ = cheerio.load(res.data);
    let desc =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';
    if (!desc || desc.length < 20) {
      desc = JSON.stringify($('script[type="application/ld+json"]').map((i, el) => {
        try { return JSON.parse($(el).contents().text()).description; } catch { return null; }
      }).get()).replace(/[\[\]"]/g, ' ').trim();
    }
    if (!desc || desc.length < 20) {
      desc = $('p').first().text().trim();
    }
    const clean = desc.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > 20 ? clean.substring(0, 300) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Historical sentiment backfill
// ---------------------------------------------------------------------------
// Walks the Kenyan Wall Street sitemap for the last N days and scrapes each
// article page (title + body), tags companies via extractRelatedStocks, then
// persists the rows. Combined with per-cycle persistence this gives symbols a
// recent sentiment even on days when the live feed has no article for them.
let kwsBackfillGuard = false;

async function backfillKwsHistory(days = 14, maxPages = 100) {
  const since = new Date(Date.now() - days * 864e5);
  const sitemapDates = await fetchKwsSitemapDates(); // { path: lastmod }
  const paths = Object.keys(sitemapDates)
    .filter(p => {
      const d = new Date(sitemapDates[p]);
      return !isNaN(d.getTime()) && d >= since;
    })
    .sort((a, b) => String(sitemapDates[b]).localeCompare(String(sitemapDates[a])))
    .slice(0, maxPages);

  if (paths.length === 0) return 0;

  const articles = [];
  const concurrency = 4;
  const seen = new Set();
  for (let i = 0; i < paths.length; i += concurrency) {
    const chunk = paths.slice(i, i + concurrency);
    await Promise.all(chunk.map(async path => {
      try {
        const res = await generic.get('https://kenyanwallstreet.com' + path, { timeout: 15000 });
        const $ = cheerio.load(res.data);
        const title = ($('h1').first().text().trim() || $('title').text().split('|')[0].trim()).substring(0, 200);
        const body = $('article, .entry-content, .post-content').first().text().replace(/\s+/g, ' ').trim();
        if (!title || title.length < 10) return;
        const text = title + ' ' + body.slice(0, 600);
        const relatedStocks = extractRelatedStocks(text);
        if (relatedStocks.length === 0) return;
        const pubDate = new Date(sitemapDates[path]);
        if (isNaN(pubDate.getTime())) return;
        const key = path + '|' + pubDate.toISOString();
        if (seen.has(key)) return;
        seen.add(key);
        articles.push({
          id: 'kws-hist-' + path.replace(/\//g, ''),
          headline: title,
          source: 'Kenyan Wall Street',
          publishedAt: pubDate.toISOString(),
          relatedStocks,
          sentiment: analyzeSentiment(text),
          sentimentScore: null,
          hot: classifyHotNews(title, excerpt || '').hot,
          hotType: classifyHotNews(title, excerpt || '').hotType,
          catalyst: classifyCatalyst(title, excerpt || '').catalyst,
          catalystDirection: classifyCatalyst(title, excerpt || '').direction,
          catalystStrength: classifyCatalyst(title, excerpt || '').strength,
          insiderDirection: classifyInsider(title, excerpt || '').direction,
          insiderType: classifyInsider(title, excerpt || '').type,
        });
      } catch { /* skip failed page */ }
    }));
  }
  const inserted = await sentimentHistory.persist(articles);
  if (inserted > 0) console.log(`[SentimentHistory] Backfilled ${articles.length} KWS articles (${inserted} rows) over last ${days}d`);
  return inserted;
}

// Optional deep US history via Alpha Vantage NEWS_SENTIMENT for all US tickers
// in a single call. Opt-in (NEWS_AV_BACKFILL=1) to protect the 25 req/day quota.
async function backfillAvUsHistory(days = 30) {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!alphaKey) return 0;
  const fmt = d => d.toISOString().slice(0, 10);
  const from = fmt(new Date(Date.now() - days * 864e5)) + 'T0000';
  const to = fmt(new Date()) + 'T2359';
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${AV_QUERY_TICKERS.join(',')}&time_from=${from}&time_to=${to}&limit=1000&apikey=${alphaKey}`;
  try {
    const res = await generic.get(url, { timeout: 30000 });
    const feed = res.data?.feed;
    if (!Array.isArray(feed) || feed.length === 0) return 0;
    const articles = feed.map(a => {
      const t = a.time_published || '';
      const pubDate = t ? new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(9,11)}:${t.slice(11,13)}:${t.slice(13,15)}`) : new Date();
      const label = (a.overall_sentiment_label || '').toLowerCase();
      let sentiment = 'neutral';
      if (label.includes('bullish')) sentiment = 'positive';
      else if (label.includes('bearish')) sentiment = 'negative';
      return {
        id: 'av-hist-' + (a.url ? a.url.replace(/[^a-z0-9]/gi, '').slice(-24) : ''),
        headline: (a.title || '').substring(0, 200),
        source: a.source || 'Alpha Vantage',
        publishedAt: isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString(),
        relatedStocks: Array.isArray(a.ticker_sentiment)
          ? a.ticker_sentiment.map(x => (x.ticker || '').toUpperCase()).filter(t => US_TICKERS.includes(t))
          : [],
        sentiment,
        sentimentScore: typeof a.overall_sentiment_score === 'number' ? a.overall_sentiment_score : null,
      };
    }).filter(a => a.relatedStocks.length > 0);
    const inserted = await sentimentHistory.persist(articles);
    if (inserted > 0) console.log(`[SentimentHistory] Backfilled ${articles.length} Alpha Vantage articles (${inserted} rows) over last ${days}d`);
    return inserted;
  } catch (e) {
    console.error('[SentimentHistory] AV backfill failed:', e.message);
    return 0;
  }
}

// One-time non-blocking backfill at startup (re-runs guarded for 6h).
async function backfillSentimentHistory() {
  if (kwsBackfillGuard) return 0;
  kwsBackfillGuard = true;
  let total = 0;
  try {
    total += await backfillKwsHistory(14, 100);
    if (process.env.NEWS_AV_BACKFILL === '1') total += await backfillAvUsHistory(30);
  } finally {
    setTimeout(() => { kwsBackfillGuard = false; }, 6 * 3600 * 1000);
  }
  return total;
}

// Init: ensure the table exists, prune old rows, then kick off a backfill.
async function initNewsHistory() {
  await sentimentHistory.ensureTable().catch(() => {});
  sentimentHistory.prune().catch(() => {});
  backfillSentimentHistory().catch(() => {});
}

// Fetch news from Yahoo Finance RSS (reliable, no API key)
async function fetchFromYahoo() {
  try {
    const feed = await rssParser.parseURL('https://finance.yahoo.com/news/rssindex');
    if (!feed?.items?.length) return [];
    const articles = [];
    for (const item of feed.items.slice(0, 30)) {
      const title = item.title?.trim();
      if (!title || title.length < 10) continue;
      const pubDate = item.isoDate ? new Date(item.isoDate) : new Date();
      const relatedStocks = extractRelatedStocks(title);
      articles.push({
        id: `yahoo-${item.guid || item.link || Math.random().toString(36).slice(2)}`,
        headline: title.substring(0, 200),
        source: 'Yahoo Finance',
        timestamp: getTimeAgo(pubDate),
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(title, '', relatedStocks),
        relatedStocks,
        sentiment: analyzeSentiment(title),
        excerpt: 'Read the full story on Yahoo Finance.',
        url: item.link || '#',
        imageUrl: item.mediaContent?.url || null,
      });
    }
    console.log(`✅ Fetched ${articles.length} articles from Yahoo Finance RSS`);
    return articles;
  } catch (e) {
    console.error('Error fetching from Yahoo Finance RSS:', e.message);
    return [];
  }
}

// Wrapper that aborts slow calls (rate-limiters can queue for minutes)
async function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve([]), ms)),
  ]);
}

// Main function to get all news
async function getAllNews(limit = 50, categoryFilter) {
  const now = Date.now();
  if (newsCache.length > 0 && now - newsCacheTime < NEWS_CACHE_TTL) {
    return filterNews(newsCache, limit, categoryFilter);
  }

  try {
    const [kenyanBusinessNews, kwsNews, globalRssNews, newsApiNews, finnhubNews, benzingaNews, alphaVantageNews, yahooNews, kenyanMarketsNews] = await Promise.allSettled([
      getKenyanBusinessNews(),
      withTimeout(fetchFromKWS(), 12000),
      withTimeout(fetchFromGlobalRSS(), 12000),
      withTimeout(fetchFromNewsAPI(), 8000),
      withTimeout(fetchFromFinnhub(), 8000),
      withTimeout(fetchFromBenzinga(), 8000),
      withTimeout(fetchFromAlphaVantage(), 12000),
      withTimeout(fetchFromYahoo(), 12000),
      withTimeout(fetchFromKenyanMarkets(), 18000),
    ]);

    const extract = r => r.status === 'fulfilled' ? r.value : [];
    let allNews = [
      ...extract(benzingaNews),
      ...extract(kwsNews),
      ...extract(kenyanBusinessNews),
      ...extract(kenyanMarketsNews),
      ...extract(globalRssNews),
      ...extract(alphaVantageNews),
      ...extract(yahooNews),
      ...extract(newsApiNews),
      ...extract(finnhubNews),
    ];

    // Deduplicate by headline
    const seen = new Set();
    const unique = [];
    for (const a of allNews) {
      const key = a.headline.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(key)) { seen.add(key); unique.push(a); }
    }

    // Classify hot news + directed catalysts
    unique.forEach(a => {
      const hot = classifyHotNews(a.headline, a.excerpt);
      a.hot = hot.hot;
      a.hotType = hot.hotType;
      const cat = classifyCatalyst(a.headline, a.excerpt);
      a.catalyst = cat.catalyst;
      a.catalystDirection = cat.direction;
      a.catalystStrength = cat.strength;
      const ins = classifyInsider(a.headline, a.excerpt);
      a.insiderDirection = ins.direction;
      a.insiderType = ins.type;
    });

    unique.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    if (unique.length === 0) {
      console.log('⚠️ No news fetched from APIs, using mock data');
      return getMockNews();
    }

    newsCache = unique;
    newsCacheTime = now;
    console.log(`✅ Fetched ${unique.length} news articles (${unique.filter(a => a.hot).length} hot)`);
    return filterNews(unique, limit, categoryFilter);
  } catch (error) {
    console.error('Error in getAllNews:', error.message);
    return newsCache.length > 0 ? filterNews(newsCache, limit, categoryFilter) : getMockNews();
  }
}

function filterNews(articles, limit, category) {
  let filtered = articles;
  if (category && category !== 'all') {
    filtered = articles.filter(a => a.category === category);
  }
  return filtered.slice(0, limit);
}

// Get news summary with stats
async function getNewsSummary() {
  const news = await getAllNews(200);
  const nseCount = news.filter(a => a.category === 'nse' || (a.relatedStocks && a.relatedStocks.length > 0)).length;
  const globalCount = news.filter(a => a.category !== 'nse' && (!a.relatedStocks || a.relatedStocks.length === 0)).length;
  const posCount = news.filter(a => a.sentiment === 'positive').length;
  const negCount = news.filter(a => a.sentiment === 'negative').length;
  const neutralCount = news.filter(a => a.sentiment === 'neutral').length;
  const hotCount = news.filter(a => a.hot).length;
  const hotNews = news.filter(a => a.hot).slice(0, 10);

  // Trending: recency × sentiment intensity boost
  const now = Date.now();
  const scored = news.map(a => {
    const ageHours = (now - new Date(a.publishedAt).getTime()) / 3600000;
    const sentimentBoost = a.sentiment === 'positive' ? 2 : a.sentiment === 'negative' ? 1.5 : 1;
    const recencyScore = Math.max(0, 1 - ageHours / 72);
    const stockBoost = (a.relatedStocks?.length || 0) > 0 ? 1.3 : 1;
    const hotBoost = a.hot ? 1.5 : 1;
    const score = recencyScore * sentimentBoost * stockBoost * hotBoost;
    return { ...a, trendingScore: +score.toFixed(3) };
  });
  scored.sort((a, b) => b.trendingScore - a.trendingScore);

  return {
    total: news.length,
    nseCount,
    globalCount,
    positiveCount: posCount,
    negativeCount: negCount,
    neutralCount: neutralCount,
    hotCount,
    hotNews,
    trending: scored.slice(0, 10),
    topSources: [...new Set(news.map(a => a.source))].slice(0, 8),
  };
}

module.exports = { getAllNews, getNewsSummary, getAggregatedSentiment, getCatalysts, getInsiderNewsSignals, classifyHotNews,
    classifyCatalyst, classifyInsider, extractRelatedStocks, backfillSentimentHistory, initNewsHistory, KENYAN_STOCKS,
    STOCK_SYMBOLS };

