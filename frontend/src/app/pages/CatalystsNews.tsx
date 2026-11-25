import { useEffect, useState } from "react";
import { ExternalLink, Clock, ChevronRight, Tag, Globe, TrendingUp, BarChart3, AlertTriangle, Shield } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface ApiNewsArticle {
  id: string;
  title: string;
  summary?: string;
  excerpt?: string;
  source?: string;
  publishedAt?: string;
  url?: string;
  slug?: string;
  catalystStrength?: number;
  catalystScore?: number;
  relatedStocks?: string[];
  tickers?: string[];
  sentiment?: "bullish" | "bearish" | "neutral";
  category?: string;
  hot?: boolean;
  hotType?: string;
  catalyst?: string;
  catalystDirection?: string;
}

interface NewsArticle {
  id: string;
  title: string;
  summary?: string;
  excerpt?: string;
  source?: string;
  publishedAt?: string;
  url?: string;
  slug?: string;
  catalystScore?: number;
  tickers?: string[];
  sentiment?: "bullish" | "bearish" | "neutral";
  category?: string;
}

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getCategoryTag(category?: string): { label: string; icon: React.ReactNode; className: string } {
  const cat = (category || "").toLowerCase();
  if (cat.includes("earnings") || cat.includes("results")) return { label: "Earnings", icon: <BarChart3 className="size-3" />, className: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
  if (cat.includes("macro") || cat.includes("fed") || cat.includes("rate")) return { label: "Macro", icon: <Globe className="size-3" />, className: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
  if (cat.includes("tech") || cat.includes("ai")) return { label: "Technology", icon: <TrendingUp className="size-3" />, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  return { label: "Markets", icon: <Tag className="size-3" />, className: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
}

function normalizeArticle(article: ApiNewsArticle): NewsArticle {
  const catalystScore = article.catalystScore ?? article.catalystStrength ?? 0;
  const tickers = article.tickers ?? article.relatedStocks ?? [];
  let category = article.category;
  
  // Infer category if not present
  if (!category) {
    const text = `${article.title || ''} ${article.excerpt || article.summary || ''} ${article.source || ''}`.toLowerCase();
    if (text.includes("earnings") || text.includes("results") || text.includes("dividend") || text.includes("profit") || text.includes("revenue")) {
      category = "Earnings";
    } else if (text.includes("fed") || text.includes("rate") || text.includes("cpi") || text.includes("inflation") || text.includes("macro") || text.includes("central bank")) {
      category = "Macro";
    } else if (text.includes("tech") || text.includes("ai") || text.includes("nvidia") || text.includes("ai infrastructure") || text.includes("semiconductor")) {
      category = "Technology";
    } else {
      category = "Markets";
    }
  }
  
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    excerpt: article.excerpt,
    source: article.source,
    publishedAt: article.publishedAt,
    url: article.url,
    slug: article.slug,
    catalystScore,
    tickers,
    sentiment: article.sentiment,
    category,
  };
}

const sampleCatalysts: NewsArticle[] = [
  {
    id: "sample-1",
    title: "AI's Next Test: Big Picture Outlook 2027",
    summary: "Can AI deliver on its promise in 2027? As attention shifts from AI investment to proof of returns, Big Picture Outlook 2027 examines where AI ROI is becoming measurable, how markets are financing the AI buildout, what could constrain AI infrastructure growth and which businesses are defensible as AI reshapes M&A.",
    source: "S&P Global Market Intelligence",
    publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    slug: "ai-big-picture-outlook-2027",
    catalystScore: 92,
    tickers: ["NVDA", "MSFT", "AMD", "TSM"],
    sentiment: "bullish",
    category: "Technology",
  },
  {
    id: "sample-2",
    title: "Safaricom FY24 Results: Mobile Money Revenue Surges 18%",
    summary: "Kenya's largest telco reports KES 310B M-Pesa revenue, beating analyst estimates. Dividend maintained at KES 1.40. M-Pesa ecosystem now contributes 42% of group revenue.",
    source: "NSE Announcements",
    publishedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    slug: "safaricom-fy24-results",
    catalystScore: 85,
    tickers: ["SCOM"],
    sentiment: "bullish",
    category: "Earnings",
  },
  {
    id: "sample-3",
    title: "Nigeria's NGX All-Share Index Hits 14-Month High on Banking Rally",
    summary: "GTCO, Zenith and Access lead gains as foreign inflows return. Index up 3.2% WoW. Banking sector P/E re-rating driven by FX reform optimism.",
    source: "NGX Market Wrap",
    publishedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    slug: "ngx-all-share-high",
    catalystScore: 72,
    tickers: ["GTCO", "ZENITHBANK", "ACCESS"],
    sentiment: "bullish",
    category: "Markets",
  },
  {
    id: "sample-4",
    title: "S&P 500 Nears Record as Fed Rate-Cut Bets Firm",
    summary: "Markets price 75% chance of September cut after soft CPI. Tech megacaps lead advance. Real yields at 2023 lows.",
    source: "Reuters",
    publishedAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    slug: "sp500-fed-cut-bets",
    catalystScore: 68,
    tickers: ["AAPL", "MSFT", "NVDA"],
    sentiment: "bullish",
    category: "Macro",
  },
  {
    id: "sample-5",
    title: "JSE Top 40 Extends Gains on Naspers/Prosus Discount Narrowing",
    summary: "Chinese tech recovery hopes boost Tencent proxy. ZAR strengthens to 18.2/USD. Discount to NAV compresses to 12% from 18% YTD.",
    source: "JSE Daily Brief",
    publishedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    slug: "jse-top40-naspers",
    catalystScore: 55,
    tickers: ["NPN", "PRX"],
    sentiment: "neutral",
    category: "Markets",
  },
  {
    id: "sample-6",
    title: "Ghana GSE Composite Slips as MTN Ghana Weighs",
    summary: "Regulatory uncertainty on SIM re-registration drags telecom sector. Index -1.8% MTD. MTN Ghana represents 35% of index weight.",
    source: "GSE Market Report",
    publishedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    slug: "gse-composite-mtn",
    catalystScore: 42,
    tickers: ["MTNGH"],
    sentiment: "bearish",
    category: "Markets",
  },
  {
    id: "sample-7",
    title: "East African Breweries Warns on Margin Pressure",
    summary: "Input cost inflation and excise hikes to compress FY25 margins. Shareholders approve KES 5.50 dividend. Raw material costs up 22% YoY.",
    source: "NSE Corporate Actions",
    publishedAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    slug: "eabl-margin-warning",
    catalystScore: 38,
    tickers: ["EABL"],
    sentiment: "bearish",
    category: "Earnings",
  },
];

export function CatalystsNews() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchNews = async () => {
      try {
        const response = await fetch(`${API_BASE}/news?limit=20`);
        const data = await response.json();
        let allNews = Array.isArray(data) ? data : [];
        
        // Normalize articles to handle API field differences
        const normalizedNews = allNews.map(normalizeArticle);
        
        if (alive) {
          const catalysts = normalizedNews
            .filter((a: any) => a.catalystScore && a.catalystScore > 30)
            .sort((a: any, b: any) => (b.catalystScore || 0) - (a.catalystScore || 0))
            .slice(0, 6);
          
          if (catalysts.length > 0) {
            setArticles(catalysts);
          } else {
            const recentNews = normalizedNews
              .sort((a: any, b: any) => new Date(b.publishedAt || b.published_at || 0).getTime() - new Date(a.publishedAt || a.published_at || 0).getTime())
              .slice(0, 6);
            setArticles(recentNews);
          }
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load news");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchNews();
    const timer = setInterval(fetchNews, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-48 rounded-2xl bg-white/[0.02] border border-white/10" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="h-4 w-1/3 bg-white/5 rounded mb-2" />
              <div className="h-4 w-3/4 bg-white/5 rounded mb-1" />
              <div className="h-4 w-1/2 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <ExternalLink className="size-10 text-slate-500 mx-auto mb-3 opacity-50" />
        <p className="text-slate-400 text-sm">Unable to load market intelligence</p>
        <p className="text-xs text-slate-500 mt-1">Please try again later</p>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="text-center py-8">
        <ExternalLink className="size-10 text-slate-500 mx-auto mb-3 opacity-50" />
        <p className="text-slate-400 text-sm">No market intelligence available</p>
      </div>
    );
  }

  const featured = articles[0];
  const secondary = articles.slice(1, 4);

  return (
    <div className="space-y-6">
      {/* Featured Article - Stock-focused */}
      {featured && (
        <article className="relative rounded-xl border border-white/10 overflow-hidden group max-h-[400px] md:max-h-[440px]">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{
              backgroundImage: 'linear-gradient(rgba(15, 15, 35, 0.85), rgba(15, 15, 35, 0.75)), url("https://images.unsplash.com/photo-1611974789895-a7e89e9c3b63?w=1920&q=80")',
              backgroundPosition: 'center center',
            }} />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-blue-900/30" />
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-blue-900/40 via-blue-800/20 to-transparent" />
          </div>
          <div className="relative z-10 p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {featured.category && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-semibold ${getCategoryTag(featured.category).className}`}>
                  {getCategoryTag(featured.category).icon}
                  {getCategoryTag(featured.category).label}
                </span>
              )}
              <span className="text-[9px] text-slate-500 ml-auto">{formatTimeAgo(featured.publishedAt)}</span>
            </div>
            <div className="mb-4">
              <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-white leading-[1.1] mb-2 group-hover:text-blue-300 transition-colors line-clamp-2">
                {featured.title}
              </h2>
            </div>
            
            {featured.summary && (
              <div className="space-y-1.5 mb-4 max-w-2xl text-slate-300 leading-relaxed">
                <p className="text-sm leading-relaxed line-clamp-3">
                  {featured.summary}
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
              <span className="text-[9px] font-medium text-slate-500">Published by</span>
              <a href={featured.url || "#"} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white/80 hover:text-blue-300 transition-colors flex items-center gap-1">
                {featured.source}
                <ExternalLink className="size-3 text-slate-400" />
              </a>
              <span className="text-slate-500">•</span>
              <span className="text-[9px] text-slate-500">{formatTimeAgo(featured.publishedAt)}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {featured.category && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-medium ${getCategoryTag(featured.category).className}`}>
                    {getCategoryTag(featured.category).icon}
                    {getCategoryTag(featured.category).label}
                  </span>
                )}
                {featured.catalystScore && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <TrendingUp className="size-2.5" />
                    Impact: {featured.catalystScore}
                  </span>
                )}
              </div>
              {featured.tickers && featured.tickers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {featured.tickers.slice(0, 4).map((ticker) => (
                    <span key={ticker} className="text-[9px] font-mono px-1.5 py-0.5 bg-white/5 rounded border border-white/10 text-cyan-300/80 hover:bg-white/10 transition-colors">
                      {ticker}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-white/10 w-full">
                <a href={featured.url || "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg transition-all hover:shadow-lg hover:shadow-blue-500/20 w-full justify-center">
                  Read full article
                  <ChevronRight className="size-3.5" />
                </a>
              </div>
            </div>
          </div>
        </article>
      )}
  
      {/* Secondary Articles Grid */}
      {secondary.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white">Latest Intelligence</h3>
            <span className="text-[9px] text-slate-500">{secondary.length} reports</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {secondary.map((article, index) => (
              <article key={article.id || index} className="relative rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-white/20 hover:bg-white/[0.03] hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-300 group overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative z-10">
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {article.category && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-medium ${getCategoryTag(article.category).className}`}>
                        {getCategoryTag(article.category).icon}
                        {getCategoryTag(article.category).label}
                      </span>
                    )}
                    <span className="text-[9px] text-slate-500 ml-auto">{formatTimeAgo(article.publishedAt)}</span>
                  </div>
                  <h3 className="text-sm md:text-base font-semibold text-white leading-snug mb-2 group-hover:text-blue-300 transition-colors line-clamp-2">
                    {article.title}
                  </h3>
                  {article.summary && (
                    <p className="text-[12px] text-slate-400 leading-relaxed mb-2 line-clamp-2">
                      {article.summary}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10">
                    <span className="text-[9px] font-medium text-slate-500">Published by</span>
                    <span className="text-sm font-semibold text-white/80 hover:text-blue-300 transition-colors flex items-center gap-1">
                      {article.source}
                      <ExternalLink className="size-2.5 text-slate-400" />
                    </span>
                    <span className="text-slate-500">•</span>
                    <span className="text-[9px] text-slate-500">{formatTimeAgo(article.publishedAt)}</span>
                    {article.catalystScore && (
                      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <TrendingUp className="size-2.5" />
                        Impact: {article.catalystScore}
                      </span>
                    )}
                  </div>
                  {article.tickers && article.tickers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {article.tickers.slice(0, 3).map((ticker) => (
                        <span key={ticker} className="text-[9px] font-mono px-1.5 py-0.5 bg-white/5 rounded border border-white/10 text-cyan-300/80 hover:bg-white/10 transition-colors">
                          {ticker}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}