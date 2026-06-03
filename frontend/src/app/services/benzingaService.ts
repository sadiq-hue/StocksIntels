import type { NewsArticle } from "./newsService";

const BENZINGA_BASE = "https://api.benzinga.com/api/v2";
const BENZINGA_TOKEN = import.meta.env.VITE_BENZINGA_API_KEY;

interface BenzingaArticle {
  id: string;
  title: string;
  body: string;
  author: string;
  created: number;
  updated: number;
  url: string;
  image: string;
  channels: { name: string }[];
  tickers: { name: string }[];
  sentiment: string;
}

interface BenzingaResponse {
  news: BenzingaArticle[];
  pagination: { page: number; pagesize: number; total: number };
}

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

function mapSentiment(s: string): "positive" | "negative" | "neutral" {
  const lower = s.toLowerCase();
  if (lower === "positive" || lower === "bullish") return "positive";
  if (lower === "negative" || lower === "bearish") return "negative";
  return "neutral";
}

function extractStocks(tickers: { name: string }[]): string[] {
  return tickers.map(t => t.name.toUpperCase());
}

function classifyArticle(title: string, excerpt: string, relatedStocks: string[]): "nse" | "global" {
  if (relatedStocks.length > 0) return "nse";
  const lower = (title + " " + excerpt).toLowerCase();
  const keywords = ["nse", "nairobi", "kenya", "nairobi securities exchange",
    "safaricom", "equity bank", "kcb", "eabl", "east african", "central bank of kenya",
    "cbk", "shilling", "kenyan", "nairobi stock"];
  if (keywords.some(k => lower.includes(k))) return "nse";
  return "global";
}

export async function fetchBenzingaNews(): Promise<NewsArticle[]> {
  if (!BENZINGA_TOKEN) {
    console.warn("Benzinga API key not configured");
    return [];
  }

  try {
    const url = `${BENZINGA_BASE}/news?token=${BENZINGA_TOKEN}&pageSize=25&display_output=full`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Benzinga API error: ${res.status}`);
    const data: BenzingaResponse = await res.json();
    if (!data.news || data.news.length === 0) return [];

    return data.news.map((a) => {
      const pubDate = new Date(a.created * 1000);
      const excerpt = a.body ? a.body.substring(0, 300) : "";
      const relatedStocks = extractStocks(a.tickers || []);
      return {
        id: `bz-${a.id}`,
        headline: a.title,
        source: "Benzinga",
        timestamp: getTimeAgo(pubDate),
        publishedAt: pubDate.toISOString(),
        category: classifyArticle(a.title, excerpt, relatedStocks),
        relatedStocks,
        sentiment: mapSentiment(a.sentiment || "neutral"),
        excerpt,
        url: a.url,
        imageUrl: a.image || undefined,
      };
    });
  } catch (err) {
    console.error("Error fetching Benzinga news:", err);
    return [];
  }
}
