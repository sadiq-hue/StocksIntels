// News Service - Fetches real-time news from multiple sources

export interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  timestamp: string;
  publishedAt?: string;
  category?: "nse" | "global";
  relatedStocks: string[];
  sentiment: "positive" | "negative" | "neutral";
  excerpt: string;
  url: string;
  imageUrl?: string;
}

const NEWSAPI_KEY = "16eb77177bdf469c92f9522c287a7e4d";
const FINNHUB_KEY = "d7ji2ihr01qhf13euuvgd7ji2ihr01qhf13euv00";

console.log("📰 News Service Loaded - API Keys Ready");

// Stock symbols for filtering news
const STOCK_SYMBOLS = ["SCOM", "EQTY", "KCB", "NSE", "BAMB", "EABL", "SCBK", "TPS", "ARM"];

// Get time ago string
function getTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Simple sentiment analysis based on keywords
function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  const positiveKeywords = [
    "growth", "surge", "rally", "gain", "profit", "up", "rise", "beat", "exceed",
    "outperform", "bullish", "strong", "success", "record", "expand", "positive"
  ];
  const negativeKeywords = [
    "decline", "fall", "loss", "crash", "down", "slump", "miss", "underperform",
    "bearish", "weak", "struggle", "pressure", "challenge", "cut", "negative"
  ];

  const lowerText = text.toLowerCase();
  const positiveCount = positiveKeywords.filter(keyword => lowerText.includes(keyword)).length;
  const negativeCount = negativeKeywords.filter(keyword => lowerText.includes(keyword)).length;

  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "neutral";
}

// Extract related stocks from article text
function extractRelatedStocks(text: string): string[] {
  const lowerText = text.toLowerCase();
  return STOCK_SYMBOLS.filter(symbol => lowerText.includes(symbol.toLowerCase()));
}

// Determine if article is NSE-related or global
function classifyArticle(title: string, excerpt: string, relatedStocks: string[]): "nse" | "global" {
  if (relatedStocks.length > 0) return "nse";
  const lower = (title + " " + excerpt).toLowerCase();
  const nseKeywords = ["nse", "nairobi", "kenya", "nairobi securities exchange",
    "safaricom", "equity bank", "kcb", "eabl", "east african", "central bank of kenya",
    "cbk", "shilling", "kenyan", "nairobi stock"];
  if (nseKeywords.some(k => lower.includes(k))) return "nse";
  return "global";
}

// Fetch from NewsAPI (General news about stocks)
export async function fetchNewsFromNewsAPI(): Promise<NewsArticle[]> {
  if (!NEWSAPI_KEY) {
    console.warn("NewsAPI key not configured");
    return [];
  }

  try {
    const queries = [
      "NSE Kenya stock market",
      "East Africa financial markets",
      "Safaricom Equity KCB EQTY",
      "African technology stocks"
    ];

    const allArticles: NewsArticle[] = [];

    for (const query of queries) {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=en&pageSize=10&apiKey=${NEWSAPI_KEY}`
      );

      if (!response.ok) throw new Error(`NewsAPI error: ${response.statusText}`);
      const data = await response.json();

      if (data.articles) {
        const articles = data.articles.map((article: any, index: number) => {
          const pubDate = new Date(article.publishedAt);
          const excerpt = article.description || article.content?.substring(0, 200) || "";
          const relatedStocks = extractRelatedStocks(article.title + " " + (article.description || ""));
          return {
            id: `newsapi-${Date.now()}-${index}`,
            headline: article.title,
            source: article.source.name || "NewsAPI",
            timestamp: getTimeAgo(pubDate),
            publishedAt: pubDate.toISOString(),
            category: classifyArticle(article.title, excerpt, relatedStocks),
            relatedStocks,
            sentiment: analyzeSentiment(article.title + " " + (article.description || "")),
            excerpt,
            url: article.url,
            imageUrl: article.urlToImage,
          };
        });

        allArticles.push(...articles);
      }
    }

    return allArticles.slice(0, 20);
  } catch (error) {
    console.error("Error fetching from NewsAPI:", error);
    return [];
  }
}

// Fetch from Finnhub (Financial news)
export async function fetchNewsFromFinnhub(): Promise<NewsArticle[]> {
  if (!FINNHUB_KEY) {
    console.warn("Finnhub key not configured");
    return [];
  }

  try {
    const categories = ["general", "technology", "finance"];
    const allArticles: NewsArticle[] = [];

    for (const category of categories) {
      const response = await fetch(
        `https://finnhub.io/api/v1/news?category=${category}&minId=0&token=${FINNHUB_KEY}`
      );

      if (!response.ok) throw new Error(`Finnhub error: ${response.statusText}`);
      const data = await response.json();

      if (Array.isArray(data)) {
        const articles = data.slice(0, 5).map((article: any, index: number) => {
          const pubDate = new Date(article.datetime * 1000);
          const excerpt = article.summary || "";
          const relatedStocks = extractRelatedStocks(article.headline + " " + excerpt);
          return {
            id: `finnhub-${Date.now()}-${index}`,
            headline: article.headline,
            source: article.source || "Finnhub",
            timestamp: getTimeAgo(pubDate),
            publishedAt: pubDate.toISOString(),
            category: classifyArticle(article.headline, excerpt, relatedStocks),
            relatedStocks,
            sentiment: analyzeSentiment(article.headline + " " + excerpt),
            excerpt,
            url: article.url,
            imageUrl: article.image,
          };
        });

        allArticles.push(...articles);
      }
    }

    return allArticles;
  } catch (error) {
    console.error("Error fetching from Finnhub:", error);
    return [];
  }
}

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// Fetch news from backend API (KWS scraper + aggregated)
async function fetchFromBackend(): Promise<NewsArticle[]> {
  try {
    const response = await fetch(`${API_BASE}/news`);
    if (!response.ok) throw new Error(`Backend news API error: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map((article: any) => ({
      id: article.id,
      headline: article.headline,
      source: article.source,
      timestamp: article.timestamp,
      publishedAt: article.publishedAt,
      category: article.category || classifyArticle(article.headline, article.excerpt, article.relatedStocks || []),
      relatedStocks: article.relatedStocks || [],
      sentiment: article.sentiment || "neutral",
      excerpt: article.excerpt || "",
      url: article.url,
      imageUrl: article.imageUrl,
    }));
  } catch (error) {
    console.error("Error fetching from backend news API:", error);
    return [];
  }
}

// Main function to fetch all news
export async function fetchAllNews(): Promise<NewsArticle[]> {
  try {
    const [benzingaArticles, newsApiArticles, finnhubArticles, backendArticles] = await Promise.all([
      import("./benzingaService").then(m => m.fetchBenzingaNews()),
      fetchNewsFromNewsAPI(),
      fetchNewsFromFinnhub(),
      fetchFromBackend(),
    ]);

    // Combine and deduplicate articles — Benzinga takes priority
    const allArticles = [...benzingaArticles, ...backendArticles, ...newsApiArticles, ...finnhubArticles];
    const uniqueArticles = Array.from(
      new Map(allArticles.map(article => [article.headline, article])).values()
    );

    // Sort by publishedAt (most recent first)
    return uniqueArticles.sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bTime - aTime;
    });
  } catch (error) {
    console.error("Error fetching all news:", error);
    return [];
  }
}

// Filter news by category
export function filterNewsByCategory(
  articles: NewsArticle[],
  category: "all" | "nse" | "global" | "trending"
): NewsArticle[] {
  switch (category) {
    case "nse":
      return articles.filter(article =>
        article.category === "nse" ||
        (!article.category && (article.relatedStocks.length > 0 ||
          article.headline.includes("NSE") ||
          article.source.toLowerCase().includes("nairobi")))
      );
    case "global":
      return articles.filter(article =>
        article.category === "global" ||
        (!article.category && article.relatedStocks.length === 0 &&
          !article.headline.includes("NSE"))
      );
    case "trending":
      return articles.filter(article => article.sentiment === "positive").slice(0, 10);
    case "all":
    default:
      return articles;
  }
}

// Filter news by stock symbol
export function filterNewsByStock(articles: NewsArticle[], symbol: string): NewsArticle[] {
  return articles.filter(article => 
    article.relatedStocks.includes(symbol) ||
    article.headline.toLowerCase().includes(symbol.toLowerCase())
  );
}
