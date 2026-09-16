import { useEffect, useState, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Newspaper, TrendingUp, Clock, ExternalLink, RefreshCw,
  Globe2, MapPin, Search, AlertCircle, Flame,
} from "lucide-react";
import {
  fetchAllNews, fetchNewsSummary,
  filterNewsByCategory,
  searchNews, fetchArticleExcerpt, generateSummary,
  type NewsArticle, type NewsSummary,
} from "../services/newsService";

// Relative publish time derived from the ISO publishedAt (authoritative), with
// the backend's pre-formatted `timestamp` as a fallback. Kenyan/Business Daily
// articles used to have neither, so the time rendered blank.
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const getSentimentColor = (s: string) => {
  switch (s) {
    case "positive": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "negative": return "bg-red-100 text-red-700 border-red-200";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

const getHotTypeColor = (type: string | null) => {
  switch (type) {
    case 'IPO': return 'bg-violet-100 text-violet-700 border-violet-200';
    case 'Earnings': return 'bg-[#0D7490]/10 text-[#0D7490] border-[#0D7490]/20';
    case 'Merger': return 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200';
    case 'Partnership': return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    case 'Regulatory': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'Expansion': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'Funding': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'Leadership': return 'bg-lime-100 text-lime-700 border-lime-200';
    case 'Crisis': return 'bg-red-100 text-red-700 border-red-200';
    default: return 'bg-muted text-muted-foreground border-border';
  }
};

// Defined at module scope (not inside NewsPage) so its identity is stable across
// re-renders. An inline component would be a new type on every render, forcing
// React to unmount/remount every card — resetting each card's loaded excerpt and
// producing a visible flash on the 60s background refresh.
function ArticleCard({ article }: { article: NewsArticle }) {
  const [excerpt, setExcerpt] = useState<string | null>(null);
  const [loadingExcerpt, setLoadingExcerpt] = useState(false);

  const loadExcerpt = async () => {
    if (excerpt !== null || loadingExcerpt || !article.url || article.url === "#") return;
    setLoadingExcerpt(true);
    const text = await fetchArticleExcerpt(article.url);
    setExcerpt(text || generateSummary(article));
    setLoadingExcerpt(false);
  };

  const isFallback = !excerpt || excerpt === "Read the full story on Yahoo Finance.";
  const showExcerpt = excerpt !== null && !isFallback;

  return (
    <Card
      className={`p-5 hover:border-[#0D7490]/50 transition-all cursor-pointer group ${article.hot ? 'border-amber-300/50 bg-amber-50/30' : ''}`}
      onClick={() => window.open(article.url, "_blank")}
    >
      <div className="flex items-start gap-4">
        <div className={`p-2.5 rounded-lg shrink-0 ${article.hot ? 'bg-amber-100' : 'bg-muted'}`}>
          {article.hot ? <TrendingUp className="size-5 text-amber-600" /> : <Newspaper className="size-5 text-[#0D7490]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-1.5">
            <h3 className="text-foreground font-semibold group-hover:text-[#0D7490] transition-colors line-clamp-2 text-sm">
              {article.headline}
            </h3>
            <ExternalLink className="size-3.5 text-muted-foreground shrink-0 mt-1" />
          </div>

          {showExcerpt ? (
            <p className="text-xs text-muted-foreground mb-2.5 line-clamp-3">{excerpt}</p>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); loadExcerpt(); }}
              className="mb-2.5 text-xs font-medium text-[#0D7490] hover:underline inline-flex items-center gap-1"
            >
              {loadingExcerpt ? (
                <>Loading summary…</>
              ) : (
                <><Newspaper className="size-3" /> Read summary</>
              )}
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground" title={article.publishedAt ? new Date(article.publishedAt).toLocaleString() : article.timestamp}>
              <Clock className="size-3" /> {timeAgo(article.publishedAt) || article.timestamp}
            </span>
            {article.readingTimeMin ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{article.readingTimeMin} min read</span>
              </>
            ) : null}
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{article.source}</span>
            {(article.relatedStocks || []).length > 0 && (
              <div className="flex items-center gap-1">
                {(article.relatedStocks || []).slice(0, 3).map(s => (
                  <Badge key={s} variant="outline" className="text-[9px] px-1.5 py-0">{s}</Badge>
                ))}
              </div>
            )}
            {article.hot && article.hotType && (
              <Badge className={`${getHotTypeColor(article.hotType)} text-[9px] px-1.5 py-0 font-semibold`}>
                {article.hotType}
              </Badge>
            )}
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${article.category === "nse" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-blue-100 text-blue-700 border-blue-200"}`}>
              <span className="flex items-center gap-1">
                {article.category === "nse" ? <MapPin className="size-2.5" /> : <Globe2 className="size-2.5" />}
                {article.category === "nse" ? "NSE" : "Global"}
              </span>
            </Badge>
            <Badge className={`${getSentimentColor(article.sentiment)} text-[9px] px-1.5 py-0`}>
              {article.sentiment}
            </Badge>
            {article.sentimentScore != null && (
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 bg-white/60"
                title={`Alpha Vantage sentiment score: ${article.sentimentScore.toFixed(3)}`}
              >
                AV {article.sentimentScore >= 0 ? "+" : ""}{article.sentimentScore.toFixed(2)}
              </Badge>
            )}
          </div>
        </div>
        {article.imageUrl && (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            className="hidden sm:block w-28 h-20 object-cover rounded-lg shrink-0 bg-muted"
          />
        )}
      </div>
    </Card>
  );
}

export function NewsPage() {
  const [newsItems, setNewsItems] = useState<NewsArticle[]>([]);
  const [summary, setSummary] = useState<NewsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NewsArticle[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [visible, setVisible] = useState(24);

  // `silent` = background auto-refresh: update data in place with no visible
  // loading state (no skeleton swap, no error banner). Only the initial load and
  // the user-initiated Refresh show their indicators.
  const load = useCallback(async (silent = false) => {
    try {
      setError(null);
      const [articles, summ] = await Promise.all([
        fetchAllNews("all", 200),
        fetchNewsSummary(),
      ]);
      setNewsItems(articles);
      setSummary(summ);
    } catch (err) {
      if (!silent) setError("Failed to fetch news. Please try again.");
      console.error("News fetch error:", err);
    }
  }, []);

  // Initial load — the only time the skeleton placeholders should appear.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(false).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  // Silent background refresh every 60s — the user never sees it happen.
  useEffect(() => {
    const interval = setInterval(() => { load(true); }, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults(null); return; }
    setSearching(true);
    const results = await searchNews(q);
    setSearchResults(results);
    setSearching(false);
  };

  const sources = Array.from(new Set(newsItems.map(a => a.source).filter(Boolean))).sort();
  const currentArticles = (searchResults !== null ? searchResults : filterNewsByCategory(newsItems, tab as any))
    .filter(a => sourceFilter === "all" || a.source === sourceFilter);
  const shownArticles = currentArticles.slice(0, visible);

  // Reset pagination whenever the user switches tab/source or searches.
  useEffect(() => { setVisible(24); }, [tab, sourceFilter, searchResults]);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Financial News</h2>
          <p className="text-sm text-muted-foreground">Latest market updates and NSE news</p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-4 bg-red-50 border-red-200">
          <div className="flex flex-wrap items-center gap-2">
            <AlertCircle className="size-4 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={handleRefresh} className="ml-auto shrink-0 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">Retry</button>
          </div>
        </Card>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total</p>
            <p className="text-xl font-bold text-foreground">{summary.total}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">NSE</p>
            <p className="text-xl font-bold text-emerald-600">{summary.nseCount}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Global</p>
            <p className="text-xl font-bold text-blue-600">{summary.globalCount}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Sentiment</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-emerald-600 font-medium">{summary.positiveCount}</span>
              <span className="text-[9px] text-muted-foreground">/</span>
              <span className="text-xs text-red-600 font-medium">{summary.negativeCount}</span>
              <span className="text-[9px] text-muted-foreground">/</span>
              <span className="text-xs text-muted-foreground font-medium">{summary.neutralCount}</span>
            </div>
          </Card>
          <Card className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Sentiment Ratio</p>
            <p className={`text-xl font-bold ${summary.sentimentRatio >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {summary.sentimentRatio >= 0 ? "+" : ""}{summary.sentimentRatio}%
            </p>
          </Card>
          <Card className={`p-3 ${summary.hotCount > 0 ? 'bg-amber-50 border-amber-200' : ''}`}>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Hot News</p>
            <p className={`text-xl font-bold ${summary.hotCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
              {summary.hotCount || 0}
            </p>
          </Card>
        </div>
      )}

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="size-3" /> Auto-refreshes every 60s</span>
        {summary?.topSources && summary.topSources.length > 0 && (
          <span>Sources: {summary.topSources.slice(0, 5).join(", ")}</span>
        )}
      </div>

      {/* Search + source filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search news, tickers, keywords..."
            className="pl-9"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground"
        >
          <option value="all">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">
          {currentArticles.length} article{currentArticles.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="all">All News</TabsTrigger>
          <TabsTrigger value="hot" className="relative">
            <Flame className="size-3 mr-1 text-amber-500" />
            Hot
            {summary && summary.hotCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {summary.hotCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="nse">NSE Specific</TabsTrigger>
          <TabsTrigger value="global">Global Markets</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
        </TabsList>

        {["all", "hot", "nse", "global", "trending"].map(t => (
          <TabsContent key={t} value={t} className="mt-4 space-y-3">
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <Card key={i} className="p-5 animate-pulse">
                    <div className="space-y-2"><div className="h-4 bg-muted rounded w-3/4" /><div className="h-3 bg-muted rounded w-full" /><div className="h-3 bg-muted rounded w-1/2" /></div>
                  </Card>
                ))}
              </div>
            ) : currentArticles.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground text-sm">
                  {searchQuery ? "No articles match your search." : t === "nse" ? "No NSE-specific news available." : t === "trending" ? "No trending news available yet." : t === "hot" ? "No hot news available yet." : "No news available."}
                </p>
              </Card>
            ) : (
              <>
                {shownArticles.map(a => <ArticleCard key={a.id} article={a} />)}
                {currentArticles.length > visible && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => setVisible(v => v + 24)}
                      className="px-4 py-2 text-sm border rounded-lg hover:bg-muted transition-colors"
                    >
                      Load more ({currentArticles.length - visible} left)
                    </button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}