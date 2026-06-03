import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Newspaper, TrendingUp, Clock, ExternalLink, RefreshCw, Globe, MapPin } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  fetchAllNews,
  filterNewsByCategory,
  type NewsArticle,
} from "../services/newsService";

export function NewsPage() {
  const [newsItems, setNewsItems] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch news on component mount
  useEffect(() => {
    loadNews();
  }, []);

  const loadNews = async () => {
    try {
      setError(null);
      setLoading(true);
      const articles = await fetchAllNews();
      setNewsItems(articles);
      setLastUpdated(new Date());
    } catch (err) {
      setError("Failed to fetch news. Please try again.");
      console.error("News fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadNews();
    setRefreshing(false);
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "positive":
        return "bg-green-100 text-green-700 border-green-200";
      case "negative":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const renderNewsItem = (news: NewsArticle) => (
    <Card
      key={news.id}
      className="bg-white border-gray-200 p-6 hover:border-[#0D7490] transition-all cursor-pointer group"
      onClick={() => window.open(news.url, "_blank")}
    >
      <div className="flex items-start gap-4">
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 group-hover:border-[#0D7490] transition-colors">
          <Newspaper className="w-6 h-6 text-[#0D7490]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <h3 className="text-gray-900 text-lg font-semibold group-hover:text-[#0D7490] transition-colors line-clamp-2">
              {news.headline}
            </h3>
            <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </div>

          <p className="text-gray-600 text-sm mb-3 line-clamp-2">{news.excerpt}</p>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Clock className="w-4 h-4" />
              <span>{news.timestamp}</span>
            </div>

            <span className="text-gray-400">•</span>
            <span className="text-gray-500 text-sm">{news.source}</span>

            {news.relatedStocks.length > 0 && (
              <div className="flex items-center gap-2">
                {news.relatedStocks.map((stock) => (
                  <Badge
                    key={stock}
                    className="bg-[#0D7490]/10 text-[#0D7490] border-[#0D7490]/20"
                  >
                    {stock}
                  </Badge>
                ))}
              </div>
            )}

            <Badge
              className={news.category === "nse"
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : "bg-blue-100 text-blue-700 border-blue-200"
              }
            >
              <span className="flex items-center gap-1">
                {news.category === "nse" ? <MapPin className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                {news.category === "nse" ? "NSE" : "Global"}
              </span>
            </Badge>

            <Badge className={getSentimentColor(news.sentiment)}>
              {news.sentiment}
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );

  const renderLoadingState = () => (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i} className="bg-white border-gray-200 p-6 animate-pulse">
          <div className="space-y-3">
            <div className="h-5 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-full"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </Card>
      ))}
    </div>
  );

  const renderErrorState = () => (
    <Card className="bg-red-50 border-red-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-red-900 font-semibold">Failed to load news</h3>
          <p className="text-red-700 text-sm mt-1">
            {error || "Please check your API keys are configured correctly."}
          </p>
          <p className="text-red-600 text-xs mt-2">
            Set VITE_NEWSAPI_KEY, VITE_FINNHUB_KEY, or VITE_NEWSDATA_KEY in your .env file
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="ml-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 flex-shrink-0"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    </Card>
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 text-2xl mb-1">Financial News</h2>
          <p className="text-gray-600">
            Latest market updates and NSE news
            {lastUpdated && (
              <span className="text-xs text-gray-500 ml-2">
                Updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2 bg-[#0D7490] text-white rounded-lg hover:bg-[#0D7490]/90 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && renderErrorState()}

      <Tabs defaultValue="all" className="mb-6">
        <TabsList className="bg-white border border-gray-200">
          <TabsTrigger
            value="all"
            className="data-[state=active]:bg-[#0D7490] data-[state=active]:text-white"
          >
            All News
          </TabsTrigger>
          <TabsTrigger
            value="nse"
            className="data-[state=active]:bg-[#0D7490] data-[state=active]:text-white"
          >
            NSE Specific
          </TabsTrigger>
          <TabsTrigger
            value="global"
            className="data-[state=active]:bg-[#0D7490] data-[state=active]:text-white"
          >
            Global Markets
          </TabsTrigger>
          <TabsTrigger
            value="trending"
            className="data-[state=active]:bg-[#0D7490] data-[state=active]:text-white"
          >
            Trending
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          {loading ? (
            renderLoadingState()
          ) : newsItems.length === 0 ? (
            <Card className="bg-gray-50 border-gray-200 p-6">
              <p className="text-gray-600">No news available. Configure API keys to fetch real-time news.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {filterNewsByCategory(newsItems, "all").map((news) => renderNewsItem(news))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="nse" className="mt-6">
          {loading ? (
            renderLoadingState()
          ) : (
            <div className="space-y-4">
              {filterNewsByCategory(newsItems, "nse").length === 0 ? (
                <Card className="bg-gray-50 border-gray-200 p-6">
                  <p className="text-gray-600">No NSE-specific news available.</p>
                </Card>
              ) : (
                filterNewsByCategory(newsItems, "nse").map((news) => renderNewsItem(news))
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="global" className="mt-6">
          {loading ? (
            renderLoadingState()
          ) : (
            <div className="space-y-4">
              {filterNewsByCategory(newsItems, "global").length === 0 ? (
                <Card className="bg-gray-50 border-gray-200 p-6">
                  <p className="text-gray-600">No global news available.</p>
                </Card>
              ) : (
                filterNewsByCategory(newsItems, "global").map((news) => renderNewsItem(news))
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="trending" className="mt-6">
          {loading ? (
            renderLoadingState()
          ) : (
            <div className="space-y-4">
              {filterNewsByCategory(newsItems, "trending").length === 0 ? (
                <Card className="bg-gray-50 border-gray-200 p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-[#0D7490]" />
                    <Badge className="bg-[#0D7490]/10 text-[#0D7490] border-[#0D7490]/20">
                      Trending
                    </Badge>
                  </div>
                  <p className="text-gray-600">No trending news available yet.</p>
                </Card>
              ) : (
                filterNewsByCategory(newsItems, "trending").map((news) => (
                  <Card
                    key={news.id}
                    className="bg-white border-gray-200 p-6 hover:border-[#0D7490] transition-all"
                    onClick={() => window.open(news.url, "_blank")}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-[#0D7490]" />
                      <Badge className="bg-[#0D7490]/10 text-[#0D7490] border-[#0D7490]/20">
                        Trending
                      </Badge>
                    </div>
                    <h3 className="text-gray-900 text-lg font-semibold mb-2">{news.headline}</h3>
                    <p className="text-gray-600 text-sm">{news.excerpt}</p>
                  </Card>
                ))
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
