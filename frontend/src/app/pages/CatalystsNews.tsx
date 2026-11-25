import { useEffect, useState } from "react";
import { ExternalLink, Clock, ChevronRight, Tag, Globe, TrendingUp, BarChart3, AlertTriangle, Shield } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface NewsArticle {
  id: string;
  title: string;
  summary?: string;
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
        let response = await fetch(`${API_BASE}/market-intel?limit=20`);
        let data = await response.json();
        let allNews = Array.isArray(data) ? data : [];
        
        if (allNews.length === 0) {
          const blogResponse = await fetch(`${API_BASE}/blog?limit=20`);
          const blogData = await blogResponse.json();
          allNews = Array.isArray(blogData) ? blogData : (blogData.rows || []);
        }
        
        if (alive) {
          const catalysts = allNews
            .filter((a: any) => a.catalystScore && a.catalystScore > 30)
            .sort((a: any, b: any) => (b.catalystScore || 0) - (a.catalystScore || 0))
            .slice(0, 6);
          
          if (catalysts.length > 0) {
            setArticles(catalysts);
          } else {
            const recentNews = allNews
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
      {/* Featured Article - Compact */}
      {featured && (
        <article className="relative rounded-xl border border-white/10 overflow-hidden group max-h-[480px] md:max-h-[520px]">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{
              backgroundImage: 'linear-gradient(rgba(15, 15, 35, 0.85), rgba(15, 15, 35, 0.75)), url("https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1920&q=80")',
              backgroundPosition: 'center 55%',
            }} />
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.015\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 36v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 6V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40" />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/3 font-black text-7xl md:text-[10rem] lg:text-[12rem] font-mono leading-none select-none pointer-events-none" style={{ fontFamily: 'system-ui, sans-serif' }}>
              S&P
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-900/70 to-amber-900/30" />
            <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-amber-900/40 via-orange-800/20 to-transparent" />
          </div>
          <div className="relative z-10 p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-semibold tracking-[0.05em] bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Globe className="size-2.5" />
                Market Intelligence
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-semibold tracking-[0.05em] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <TrendingUp className="size-2.5" />
                Big Picture Outlook
              </span>
              <span className="text-[9px] text-slate-500 ml-auto">{formatTimeAgo(featured.publishedAt)}</span>
            </div>
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-400 mb-1">
                Special Report
              </p>
              <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-white leading-[1.1] mb-2 group-hover:text-blue-300 transition-colors">
                Big Picture Outlook 2027
              </h2>
              <p className="text-sm md:text-base text-slate-300 leading-relaxed mb-2 max-w-2xl font-medium">
                AI's Next Test
              </p>
            </div>
            
            <div className="space-y-1.5 mb-4 max-w-2xl text-slate-300 leading-relaxed">
              <p className="text-sm leading-relaxed">
                Can AI deliver on its promise in 2027? As attention shifts from AI investment to proof of returns,
                <em className="text-white font-semibold">Big Picture Outlook 2027</em> examines where AI ROI is becoming measurable.
              </p>
              <div className="grid gap-1.5 md:grid-cols-2 sm:max-w-2xl">
                <div className="flex items-start gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <TrendingUp className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-slate-300 leading-relaxed">Where AI ROI is becoming measurable across sectors</span>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <Globe className="size-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-slate-300 leading-relaxed">How markets are financing the AI infrastructure buildout</span>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <AlertTriangle className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-slate-300 leading-relaxed">What could constrain AI infrastructure growth</span>
                </div>
                <div className="flex items-start gap-2 p-2 rounded-lg bg-white/5 border border-white/5">
                  <Shield className="size-3.5 text-purple-400 shrink-0 mt-0.5" />
                  <span className="text-[12px] text-slate-300 leading-relaxed">Which businesses are defensible as AI reshapes M&A</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
              <span className="text-[9px] font-medium text-slate-500">Published by</span>
              <a href={featured.url || featured.slug ? `https://www.spglobal.com/marketintelligence/en/insights/${featured.slug}` : "#"} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-white/80 hover:text-blue-300 transition-colors flex items-center gap-1">
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
              <div className="mt-3 pt-3 border-t border-white/10">
                <a href={featured.url || featured.slug ? `https://www.spglobal.com/marketintelligence/en/insights/${featured.slug}` : "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg transition-all hover:shadow-lg hover:shadow-blue-500/20">
                  Read the full Big Picture Outlook 2027
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