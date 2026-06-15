const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export interface NewsArticle {
  id: string;
  headline: string;
  excerpt: string;
  source: string;
  timestamp: string;
  publishedAt: string;
  category: "nse" | "global";
  relatedStocks: string[];
  sentiment: "positive" | "negative" | "neutral";
  url: string;
  imageUrl?: string | null;
  hot?: boolean;
  hotType?: string | null;
}

export interface NewsSummary {
  total: number;
  nseCount: number;
  globalCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  hotCount: number;
  hotNews: NewsArticle[];
  sentimentRatio: number;
  trending: NewsArticle[];
  topSources: string[];
}

export async function fetchAllNews(category = "all", limit = 50): Promise<NewsArticle[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (category && category !== "all") params.set("category", category);
    const res = await fetch(`${API_BASE}/news?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("Failed to fetch news from backend:", e);
    return [];
  }
}

export async function fetchHotNews(limit = 20): Promise<NewsArticle[]> {
  try {
    const res = await fetch(`${API_BASE}/news/hot?limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("Failed to fetch hot news:", e);
    return [];
  }
}

export async function fetchNewsSummary(): Promise<NewsSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/news/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error("Failed to fetch news summary:", e);
    return null;
  }
}

export async function fetchAggregatedSentiment(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${API_BASE}/news/sentiment`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export function filterNewsByCategory(
  articles: NewsArticle[],
  category: "all" | "nse" | "global" | "trending" | "hot"
): NewsArticle[] {
  switch (category) {
    case "nse":
      return articles.filter(a =>
        a.category === "nse" ||
        (a.relatedStocks && a.relatedStocks.length > 0) ||
        a.headline.toLowerCase().includes("nse") ||
        a.source.toLowerCase().includes("nairobi")
      );
    case "global":
      return articles.filter(a =>
        a.category === "global" &&
        (!a.relatedStocks || a.relatedStocks.length === 0) &&
        !a.headline.toLowerCase().includes("nse")
      );
    case "trending":
      return articles.filter(a => a.sentiment === "positive").slice(0, 10);
    case "hot":
      return articles.filter(a => a.hot);
    default:
      return articles;
  }
}

export function filterNewsByStock(articles: NewsArticle[], symbol: string): NewsArticle[] {
  return articles.filter(a =>
    (a.relatedStocks || []).some(s => s.toUpperCase() === symbol.toUpperCase()) ||
    a.headline.toUpperCase().includes(symbol.toUpperCase())
  );
}

export async function searchNews(query: string): Promise<NewsArticle[]> {
  const all = await fetchAllNews("all", 100);
  const q = query.toLowerCase();
  return all.filter(a =>
    a.headline.toLowerCase().includes(q) ||
    (a.excerpt || "").toLowerCase().includes(q) ||
    (a.relatedStocks || []).some(s => s.toLowerCase().includes(q))
  );
}
