// News Service - Fetches real-time news from multiple sources for Kenyan stocks

const cheerio = require('cheerio');
const RssParser = require('rss-parser');
const rssParser = new RssParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});
const { newsapi, finnhub: finnhubClient, generic } = require('./apiClient');

// API Keys - can be overridden by environment variables
const NEWSAPI_KEY = process.env.VITE_NEWSAPI_KEY || '16eb777bdf469c92f9522c287a7e4d';
const FINNHUB_KEY = process.env.VITE_FINNHUB_KEY || 'd7ji2ihr01qhf13euuvgd7ji2ihr01qhf13euv00';

console.log('📰 News Service Loaded - API Keys Ready');

// Kenyan stock symbols and company names for filtering news
const KENYAN_STOCKS = {
  'SCOM': 'Safaricom',
  'EQTY': 'Equity Group',
  'KCB': 'KCB Group',
  'EABL': 'East African Breweries',
  'BAMB': 'Bamburi Cement',
  'ABSA': 'Absa Bank Kenya',
  'SBIC': 'Stanbic Holdings',
  'KLG': 'Kenya Airways',
  'KPLC': 'Kenya Power',
  'NMG': 'Nation Media Group',
  'CRAY': 'Crown Paints',
  'UMEM': 'Umeme',
  'TOTL': 'TotalEnergies Kenya',
  'BRDR': "Bird's Broilers",
  'OLYM': 'Olympia Capital',
  'SCBK': 'Standard Chartered Kenya',
  'TPS': 'TPS Serengeti Breweries',
  'ARM': 'ARM Cement'
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
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
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
const US_TICKERS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX',
  'LLY','AVGO','UNH','XOM','PG','JNJ','WMT','CVX','HD','KO',
  'PEP','COST','MRK','ABBV','BAC','TMO','ORCL','CSCO','ADBE','CRM',
  'AMD','INTC','TXN','QCOM','AMGN','IBM','BA','GE','CAT','DIS',
  'MCD','NKE','SBUX','GS','MS','C','WFC','BLK','PYPL','SQ',
  'UBER','ABNB','PLTR','SNOW','DDOG','CRWD','PANW','GME','AMC','HOOD',
  'SPOT','SNAP','RBLX','COIN','MRNA','ZM','NET','SOFI','AFRM','UPST',
];

// Combined ticker list for news matching
const ALL_NEWS_TICKERS = [...STOCK_SYMBOLS, ...US_TICKERS];

// Build word-boundary regex once
const tickerPattern = new RegExp(`\\b(${ALL_NEWS_TICKERS.join('|')})\\b`, 'gi');

function extractRelatedStocks(text) {
  const matches = text.match(tickerPattern);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.toUpperCase()))];
}

// Cache aggregated sentiment to avoid repeated API calls
let sentimentCache = null;
let sentimentCacheTime = 0;
const SENTIMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getAggregatedSentiment() {
  if (sentimentCache && Date.now() - sentimentCacheTime < SENTIMENT_CACHE_TTL) {
    return sentimentCache;
  }
  const news = await getAllNews();
  const sentimentCounts = {};

  for (const article of news) {
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
  sentimentCache = result;
  sentimentCacheTime = Date.now();
  return result;
}

// Determine if article is NSE-related or global
function classifyArticle(title, excerpt, relatedStocks) {
  if (relatedStocks.length > 0) return 'nse';
  const lower = (title + ' ' + excerpt).toLowerCase();
  const nseKeywords = ['nse', 'nairobi', 'kenya', 'nairobi securities exchange',
    'safaricom', 'equity bank', 'kcb', 'eabl', 'east african', 'central bank of kenya',
    'cbk', 'shilling', 'kenyan', 'nairobi stock'];
  if (nseKeywords.some(k => lower.includes(k))) return 'nse';
  return 'global';
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
      category: 'nse', relatedStocks, sentiment, excerpt, url, imageUrl: null };
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
    makeArticle('ke-business-8', 'Kenya Airways reports improved load factors in Q4', 'K24 TV', 16, ['KLG'], 'positive',
      'Kenya Airways has reported improved passenger load factors of 78% in Q4, up from 65% in the same period last year, driven by increased regional travel.', 'https://www.k24tv.co.ke'),
  ];
}

// Fetch news from Kenyan Wall Street by scraping SSR HTML
async function fetchFromKWS() {
  try {
    const response = await generic.get('https://kenyanwallstreet.com/', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const articles = [];
    const seen = new Set();

    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');

      // Only match article-like slugs: /some-article-slug
      if (!href || !href.match(/^\/[a-z0-9-]+$/) ||
          href === '/' ||
          href.startsWith('/shows/') ||
          href.startsWith('/partnerships/') ||
          href.startsWith('/category/') ||
          href.startsWith('/author/') ||
          href.startsWith('/tag/')) return;

      if (seen.has(href)) return;
      seen.add(href);

      const img = $(el).find('img[alt]').first();
      const title = img.attr('alt');
      if (!title || title.length < 10) return;

      // Extract timestamp if present
      const tsSpan = $(el).find('.text-muted-background').first();
      const rawTimestamp = tsSpan.text().trim();

      // Get full text content, remove timestamp from end
      let excerpt = $(el).text().trim();
      if (rawTimestamp && excerpt.endsWith(rawTimestamp)) {
        excerpt = excerpt.substring(0, excerpt.length - rawTimestamp.length).trim();
      }
      if (excerpt.length > 300) excerpt = excerpt.substring(0, 300);

      const now = new Date();
      const pubDate = rawTimestamp ? parseRelativeTime(rawTimestamp) : now;

      articles.push({
        id: `kws-${href.replace(/\//g, '')}-${Date.now()}`,
        headline: title.substring(0, 200),
        source: 'Kenyan Wall Street',
        timestamp: rawTimestamp || 'just now',
        publishedAt: pubDate.toISOString(),
        category: 'nse',
        relatedStocks: extractRelatedStocks(title + ' ' + excerpt),
        sentiment: analyzeSentiment(title + ' ' + excerpt),
        excerpt,
        url: `https://kenyanwallstreet.com${href}`,
        imageUrl: null
      });
    });

    console.log(`✅ Fetched ${articles.length} articles from Kenyan Wall Street`);
    return articles.slice(0, 20);
  } catch (error) {
    console.error('Error fetching from Kenyan Wall Street:', error.message);
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
  ];
}

// Main function to get all news
async function getAllNews() {
  try {
    // Try to fetch from multiple sources
    const [newsApiNews, finnhubNews, kenyanBusinessNews, kwsNews, globalRssNews] = await Promise.all([
      fetchFromNewsAPI(),
      fetchFromFinnhub(),
      getKenyanBusinessNews(),
      fetchFromKWS(),
      fetchFromGlobalRSS()
    ]);

    // Combine all news sources
    let allNews = [...kwsNews, ...kenyanBusinessNews, ...globalRssNews, ...newsApiNews, ...finnhubNews];

    // Remove duplicates based on headline
    const uniqueNews = [];
    const seenHeadlines = new Set();
    for (const article of allNews) {
      const headlineKey = article.headline.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seenHeadlines.has(headlineKey)) {
        seenHeadlines.add(headlineKey);
        uniqueNews.push(article);
      }
    }

    // Sort by publishedAt (most recent first)
    uniqueNews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // If no news from APIs, fall back to mock data
    if (uniqueNews.length === 0) {
      console.log('⚠️ No news fetched from APIs, using mock data');
      return getMockNews();
    }

    console.log(`✅ Fetched ${uniqueNews.length} news articles from multiple sources`);
    return uniqueNews;
  } catch (error) {
    console.error('Error in getAllNews:', error.message);
    return getMockNews();
  }
}

module.exports = { getAllNews, getAggregatedSentiment, KENYAN_STOCKS, STOCK_SYMBOLS };