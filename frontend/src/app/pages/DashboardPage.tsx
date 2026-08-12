import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Link, useNavigate } from "react-router";
import {
  TrendingUp, TrendingDown, Activity, ArrowUpRight, ArrowDownRight,
  DollarSign, PieChart, BarChart3, Newspaper, Star, Wallet,
  Globe2, ChevronRight, ArrowUp, Layers, X, Lightbulb,
  LayoutGrid, Briefcase, Brain, Scale, Banknote
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart as RePieChart, Pie, Cell,
} from "recharts";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { usePortfolioData } from "../contexts/PortfolioDataContext";
import { useBeginnerMode } from "../contexts/BeginnerModeContext";
import { kenyanStocks, globalStocks } from "../data/stockUniverses";
import { fetchAllNews, type NewsArticle } from "../services/newsService";
import { connectSocket } from "../services/socketService";
import type { Signal } from "../types/signals";
import { authFetch } from "../auth/tokenStore";
import { CURRENCIES, toDisplayCurrency, formatCurrencyValue, PORTFOLIO_CURRENCY_KEY } from "../utils/currency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function AnimatedCounter({ end, duration = 2000, prefix = "", suffix = "" }: { end: number; duration?: number; prefix?: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let startTime: number;
    let animationFrame: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);
  return <span>{prefix}{count.toLocaleString()}{suffix}</span>;
}

function SentimentBar({ label, score, labelText, color, onClick }: { label: string; score: number; labelText: string; color: string; onClick?: () => void }) {
  const sentColor = score >= 65 ? 'text-emerald-600' : score <= 40 ? 'text-red-500' : 'text-yellow-600';
  return (
    <div className={`rounded-lg bg-muted/50 p-4 border ${onClick ? 'cursor-pointer hover:bg-muted hover:border-[#0D7490] transition-all' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${sentColor}`}>{labelText}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 mb-2">
        <div className="bg-gradient-to-r from-red-400 via-yellow-400 to-emerald-400 h-2 rounded-full" style={{ width: `${Math.max(3, Math.min(97, score))}%` }}></div>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground/60">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
    </div>
  );
}

function normalizeMover(s: any) {
  const changeVal = parseFloat(String(s.change ?? s.changePercent ?? 0).replace('%', ''));
  return {
    ticker: s.ticker || s.symbol?.replace('NSE:', '') || '',
    name: s.name || s.company_name || '',
    price: parseFloat(String(s.price || 0)),
    change: isNaN(changeVal) ? 0 : changeVal,
    volume: s.volume || '0',
    currency: s.currency || 'KES',
    market: (s.symbol?.startsWith('NSE:') || s.market === 'NSE' || s.market === 'nse') ? 'nse' as const : 'global' as const,
  };
}

function parseVolume(vol: string): number {
  const num = parseFloat(vol.replace("M", "").replace("K", "").replace("B", ""));
  if (vol.includes("B")) return num * 1000000000;
  if (vol.includes("M")) return num * 1000000;
  if (vol.includes("K")) return num * 1000;
  return num;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

const allStocks = [...kenyanStocks, ...globalStocks];

const indices = [
  { name: "NSE 20", value: "1,847.56", change: "+0.87%", isPositive: true, volume: "156M", market: "NSE" },
  { name: "S&P 500", value: "5,204.34", change: "+1.15%", isPositive: true, volume: "3.8B", market: "Global" },
  { name: "NASDAQ", value: "16,332.24", change: "+1.54%", isPositive: true, volume: "4.2B", market: "Global" },
  { name: "NYSE Composite", value: "17,842.15", change: "+0.72%", isPositive: true, volume: "2.1B", market: "Global" },
  { name: "FTSE 100", value: "8,245.60", change: "+0.53%", isPositive: true, volume: "1.8B", market: "Global" },
  { name: "NSE All Share", value: "112.45", change: "+1.08%", isPositive: true, volume: "450M", market: "NSE" },
];

interface PerformanceDataPoint {
  month: string;
  portfolio: number;
  nse20: number;
  sp500: number;
  portfolioRaw: number;
  nse20Raw: number;
  sp500Raw: number;
}

interface PerformanceResponse {
  data: PerformanceDataPoint[];
  period: string;
  hasHistory: boolean;
  currentValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  fxRate: number;
}

interface PerformanceMeta {
  totalReturn: number;
  totalReturnPercent: number;
  currentValue: number;
  hasHistory: boolean;
}

interface MarketPulseData {
  nse: { label: string; score: number; idxPositive: number; idxTotal: number };
  global: { label: string; score: number; idxPositive: number; idxTotal: number };
  summary: string;
  indices: { nse: { value: string; change: string } | null; sp500: { value: string; change: string } | null };
  topSector: { name: string; change: string } | null;
}

const fallbackNews: NewsArticle[] = [
  { id: "fallback-1", headline: "Safaricom reports record M-Pesa growth", source: "Business Daily", timestamp: "2h ago", publishedAt: new Date().toISOString(), category: "nse", relatedStocks: ["SCOM"], sentiment: "positive", excerpt: "", url: "#" },
  { id: "fallback-2", headline: "Central Bank holds rates steady at 10.5%", source: "Reuters", timestamp: "4h ago", publishedAt: new Date().toISOString(), category: "nse", relatedStocks: [], sentiment: "neutral", excerpt: "", url: "#" },
  { id: "fallback-3", headline: "Nvidia gains 4.5% after AI summit highlights", source: "CNBC", timestamp: "3h ago", publishedAt: new Date().toISOString(), category: "global", relatedStocks: ["NVDA"], sentiment: "positive", excerpt: "", url: "#" },
  { id: "fallback-4", headline: "Equity Group Q2 profit up 23%", source: "NSE", timestamp: "6h ago", publishedAt: new Date().toISOString(), category: "nse", relatedStocks: ["EQTY"], sentiment: "positive", excerpt: "", url: "#" },
  { id: "fallback-5", headline: "New regulations for digital lenders announced", source: "Capital FM", timestamp: "8h ago", publishedAt: new Date().toISOString(), category: "nse", relatedStocks: [], sentiment: "neutral", excerpt: "", url: "#" },
];

export function DashboardPage() {
  const { user } = useAuth();
  const { totals, enhancedTotals, topHoldings, allocation, holdings, brokerTotals } = usePortfolioData();
  const { beginnerMode } = useBeginnerMode();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedTimeRange, setSelectedTimeRange] = useState("6M");
  const [perfData, setPerfData] = useState<PerformanceDataPoint[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfMeta, setPerfMeta] = useState({ totalReturn: 0, totalReturnPercent: 0, currentValue: 0, hasHistory: false });
  const [pulse, setPulse] = useState<MarketPulseData | null>(null);
  const [movers, setMovers] = useState<{ gainers: any[]; losers: any[] }>({ gainers: [], losers: [] });
  const [activeStocks, setActiveStocks] = useState<any[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<any[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => localStorage.getItem(PORTFOLIO_CURRENCY_KEY) || "USD");

  const fxRate = enhancedTotals.fxRate || 130;
  const dc = displayCurrency;
  const fmtKes = (kesAmount: number) => formatCurrencyValue(toDisplayCurrency(kesAmount, "KES", dc, fxRate), dc);
  const fmtUsd = (usdAmount: number) => formatCurrencyValue(toDisplayCurrency(usdAmount, "USD", dc, fxRate), dc);

  const handleCurrencyChange = (code: string) => {
    setDisplayCurrency(code);
    localStorage.setItem(PORTFOLIO_CURRENCY_KEY, code);
  };

  const fetchPerformance = useCallback(async (period: string) => {
    if (!user?.id) return;
    setPerfLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/portfolio/performance?userId=${user.id}&period=${period}`);
      const json: PerformanceResponse = await res.json();
      if (json.data?.length) {
        setPerfData(json.data);
        setPerfMeta({ totalReturn: json.totalReturn, totalReturnPercent: json.totalReturnPercent, currentValue: json.currentValue, hasHistory: json.hasHistory });
      }
    } catch {} finally {
      setPerfLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPerformance(selectedTimeRange);
    const perfInterval = setInterval(() => fetchPerformance(selectedTimeRange), 60000);
    return () => clearInterval(perfInterval);
  }, [selectedTimeRange, fetchPerformance]);

  useEffect(() => {
    let cancelled = false;
    const fetchPulse = () =>
      authFetch(`${API_BASE}/market/pulse`)
        .then(r => r.json())
        .then(data => { if (!cancelled) setPulse(data); })
        .catch(() => {});
    fetchPulse();
    const pulseInterval = setInterval(fetchPulse, 60000);
    return () => { cancelled = true; clearInterval(pulseInterval); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchMovers = async () => {
      try {
        const res = await authFetch(`${API_BASE}/market/movers`);
        const data = await res.json();
        if (cancelled) return;
        const combined = data.combined || { gainers: [], losers: [] };
        setMovers({
          gainers: (combined.gainers || []).slice(0, 5).map((s: any) => normalizeMover(s)),
          losers: (combined.losers || []).slice(0, 5).map((s: any) => normalizeMover(s)),
        });
        setActiveStocks((data.active || []).slice(0, 6));
      } catch {}
    };
    fetchMovers();
    const interval = setInterval(fetchMovers, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    authFetch(`${API_BASE}/watchlist?userId=${user.id}`)
      .then(r => r.json())
      .then(items => { if (!cancelled) setWatchlistItems(items || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.full_name?.split(" ")[0] || "Trader";

  const timeRanges = ["1D", "1W", "1M", "3M", "6M", "1Y", "ALL"];

  const topGainers = useMemo(() =>
    movers.gainers.length > 0 ? movers.gainers
      : allStocks.filter(s => s.change > 0).sort((a, b) => b.change - a.change).slice(0, 5),
    [movers.gainers]
  );

  const topLosers = useMemo(() =>
    movers.losers.length > 0 ? movers.losers
      : allStocks.filter(s => s.change < 0).sort((a, b) => a.change - b.change).slice(0, 5),
    [movers.losers]
  );

  const sectorData = useMemo(() => {
    const map = new Map<string, { totalChange: number; count: number; marketCaps: string[] }>();
    for (const s of allStocks) {
      const existing = map.get(s.sector) || { totalChange: 0, count: 0, marketCaps: [] };
      existing.totalChange += s.change;
      existing.count += 1;
      existing.marketCaps.push(s.marketCap);
      map.set(s.sector, existing);
    }
    return Array.from(map.entries()).map(([sector, data]) => ({
      sector,
      change: (data.totalChange / data.count).toFixed(1),
      avgChange: data.totalChange / data.count,
      count: data.count,
    })).sort((a, b) => b.avgChange - a.avgChange);
  }, []);


  const watchlist = useMemo(() => {
    const activeMap = new Map(activeStocks.map(s => [s.ticker, s]));
    const built: any[] = [];

    // Show user's watchlist items first (with live data if available)
    if (watchlistItems.length > 0) {
      for (const item of watchlistItems) {
        const live = activeMap.get(item.symbol);
        built.push({
          ticker: item.symbol,
          name: item.company_name || live?.name || item.symbol,
          price: live?.price || '-',
          change: live?.change || '-',
          isPositive: live ? live.isPositive : true,
          alert: live ? Math.abs(parseFloat(live.change)) > 5 : false,
          market: live?.symbol?.startsWith('NSE:') ? 'nse' : 'global',
          currency: live?.currency || 'KES',
          volume: live?.volume || '0',
        });
      }
    }

    // Fill remaining slots with most active stocks (avoid duplicates)
    if (activeStocks.length > 0) {
      const seen = new Set(built.map(s => s.ticker));
      for (const s of activeStocks) {
        if (seen.has(s.ticker)) continue;
        built.push({
          ticker: s.ticker,
          name: s.name || s.ticker,
          price: s.price,
          change: s.change,
          isPositive: s.isPositive,
          alert: Math.abs(parseFloat(s.change)) > 5,
          market: s.symbol?.startsWith('NSE:') ? 'nse' : 'global',
          currency: s.currency || 'KES',
          volume: s.volume || '0',
        });
        if (built.length >= 6) break;
      }
    }

    // Fall back to static universe data
    if (built.length === 0) {
      return allStocks
        .sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume))
        .slice(0, 6)
        .map(s => ({
          ticker: s.ticker,
          name: s.name,
          price: s.price.toFixed(2),
          change: `${s.change > 0 ? "+" : ""}${s.change.toFixed(2)}%`,
          isPositive: s.change >= 0,
          alert: Math.abs(s.change) > 5,
          market: s.market,
          currency: s.currency || "KES",
        }));
    }

    return built;
  }, [activeStocks, watchlistItems]);

  const nseIndices = indices.filter(i => i.market === "NSE");
  const globalIndices = indices.filter(i => i.market === "Global");

  const [newsItems, setNewsItems] = useState<NewsArticle[]>(fallbackNews);
  const [newsLoading, setNewsLoading] = useState(true);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);

  interface StockPopoverInfo {
    ticker: string; name: string; price: number; change: number;
    volume: string; market: string; currency: string; signal?: Signal;
  }
  const [selectedStock, setSelectedStock] = useState<StockPopoverInfo | null>(null);
  const [pulseDetail, setPulseDetail] = useState<'nse' | 'global' | 'sector' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchNews = () => {
      setNewsLoading(true);
      fetchAllNews().then(articles => {
        if (cancelled) return;
        setNewsItems(articles.length > 0 ? articles.slice(0, 5) : fallbackNews);
        setNewsLoading(false);
      });
    };
    fetchNews();
    const newsInterval = setInterval(fetchNews, 120000);
    return () => { cancelled = true; clearInterval(newsInterval); };
  }, []);

  const fetchSignals = useCallback(() => {
    const userIdParam = user?.id ? `?userId=${user.id}` : '';
    authFetch(`${import.meta.env.VITE_API_URL || "/api"}/signals${userIdParam}`)
      .then(r => r.json())
      .then(data => { if (data.success) setSignals(data.signals); })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    setSignalsLoading(true);
    fetchSignals();
    setSignalsLoading(false);
    const signalsInterval = setInterval(fetchSignals, 60000);
    return () => { cancelled = true; clearInterval(signalsInterval); };
  }, [fetchSignals]);

  // Real-time socket subscriptions
  useEffect(() => {
    if (!user?.id) return;
    let socket: any;
    socket = connectSocket(user.id, user.full_name || "");
    socket.on("market:update", (quote: any) => { /* triggers re-render via context refresh */ });
    socket.on("indices:update", (indices: any) => {
      setPulse(prev => prev ? { ...prev, indices } : prev);
    });
    socket.on("signal:batch_update", (batch: any) => {
      if (batch?.signals) setSignals(batch.signals);
    });
    socket.on("signal:updates", (updates: any) => {
      if (Array.isArray(updates)) setSignals(updates);
    });
    return () => {
      if (socket) {
        socket.off("market:update");
        socket.off("indices:update");
        socket.off("signal:batch_update");
        socket.off("signal:updates");
      }
    };
  }, [user?.id]);

  const signalSummary = useMemo(() => {
    const counts: Record<string, number> = { "Strong Buy": 0, Buy: 0, Hold: 0, Sell: 0, "Strong Sell": 0 };
    signals.forEach(s => { if (counts[s.signal] !== undefined) counts[s.signal]++; });
    const total = signals.length;
    const avgConf = total ? Math.round(signals.reduce((a, b) => a + b.confidence, 0) / total) : 0;
    const peakConf = total ? Math.round(signals.reduce((a, b) => Math.max(a, b.confidence), 0)) : 0;
    const strongBuy = signals.filter(s => s.signal === "Strong Buy" || s.signal === "Buy").length;
    const strongSell = signals.filter(s => s.signal === "Sell" || s.signal === "Strong Sell").length;
    return { total, avgConf, peakConf, strongBuy, strongSell, counts };
  }, [signals]);

  const benchmarkMetrics = useMemo(() => {
    const d = perfData;
    if (d.length < 2) return { nseReturn: 0, spReturn: 0, blended: 0, alpha: 0, vsNseAlpha: 0, vsSpAlpha: 0 };
    const first = d[0], last = d[d.length - 1];
    const nseRet = first.nse20 !== 0 ? ((last.nse20 - first.nse20) / first.nse20) * 100 : 0;
    const spRet = first.sp500 !== 0 ? ((last.sp500 - first.sp500) / first.sp500) * 100 : 0;
    const totalVal = enhancedTotals.nseValue + enhancedTotals.globalValue;
    const nseW = totalVal > 0 ? enhancedTotals.nseValue / totalVal : 0.5;
    const blended = nseW * nseRet + (1 - nseW) * spRet;
    const portRet = perfMeta.totalReturnPercent;
    return {
      nseReturn: nseRet, spReturn: spRet, blended,
      alpha: portRet - blended,
      vsNseAlpha: portRet - nseRet,
      vsSpAlpha: portRet - spRet,
    };
  }, [perfData, perfMeta.totalReturnPercent, enhancedTotals.nseValue, enhancedTotals.globalValue]);

  const topSignals = useMemo(() =>
    signals
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4)
      .map(s => ({
        ...s,
        ticker: s.ticker,
        name: s.name,
        signal: s.signal,
        confidence: s.confidence,
        change: `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)}%`,
        trend: s.change >= 0 ? "up" as const : "down" as const,
        market: s.market,
      })),
    [signals]
  );

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-6">

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 dark:bg-muted/20 border rounded-lg w-full sm:w-auto overflow-x-auto">
        {[
          { id: "overview", label: "Overview", icon: LayoutGrid },
          { id: "markets", label: "Markets", icon: TrendingUp },
          { id: "portfolio", label: "Portfolio", icon: Briefcase },
          { id: "signals", label: "Market Intelligence", icon: Brain },
          { id: "news", label: "News", icon: Newspaper },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === "overview") { setActiveTab("overview"); }
              else { navigate(`/app/${tab.id}`); }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="size-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] rounded-xl p-6 text-white relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/[0.15] rounded-full blur-xl animate-bubble-float" />
        <div className="absolute top-4 right-20 w-12 h-12 bg-white/20 rounded-full animate-bubble-float" style={{ animationDelay: "1.5s" }} />
        <div className="absolute -bottom-8 -right-2 w-32 h-32 bg-cyan-200/20 rounded-full animate-bubble-float" style={{ animationDelay: "3s" }} />
        <div className="absolute bottom-0 left-8 w-8 h-8 bg-white/[0.15] rounded-full animate-bubble-float" style={{ animationDelay: "2s" }} />
        <div className="absolute -top-4 left-12 w-6 h-6 bg-white/20 rounded-full animate-bubble-float" style={{ animationDelay: "4s" }} />
        <div className="absolute top-1/3 -left-6 w-20 h-20 bg-white/[0.12] rounded-full animate-bubble-float" style={{ animationDelay: "5s" }} />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm mb-1">
              {greeting}, {firstName}
              {brokerTotals.activeBrokerCount > 0 && (
                <span className="ml-3 inline-flex items-center gap-1 bg-white/20 rounded-full px-2.5 py-0.5 text-[11px] font-medium">
                  <span className="size-1.5 rounded-full bg-green-300" />
                  {brokerTotals.activeBrokerCount} Account{brokerTotals.activeBrokerCount !== 1 ? 's' : ''} linked
                </span>
              )}
            </p>
            <h2 className="text-lg sm:text-xl font-bold">Your portfolio is {enhancedTotals.pnlPercent >= 0 ? 'up' : 'down'} <span className={enhancedTotals.pnlPercent >= 0 ? 'text-green-300' : 'text-red-300'}>{enhancedTotals.pnlPercent >= 0 ? '+' : ''}{enhancedTotals.pnlPercent}%</span> today</h2>
            <p className="text-white/70 text-sm mt-1">
              NSE 20: {indices[0].value} ({indices[0].change}) &middot; S&P 500: {indices[1].value} ({indices[1].change})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={dc} onValueChange={handleCurrencyChange}>
              <SelectTrigger className="w-[110px] bg-white/20 border-white/30 text-white h-9 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => (
                  <SelectItem key={c.code} value={c.code}>{c.symbol} {c.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Link to="/app/markets" className="w-full sm:w-auto">
              <Button className="bg-card text-[#0D7490] hover:bg-muted shadow-sm w-full sm:w-auto">
                <Globe2 className="size-4 mr-2" />
                View Markets
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" data-tour="portfolio-cards">
        <Card className="col-span-2 md:col-span-1 border-0 bg-gradient-to-br from-[#0D7490] via-[#0B6A87] to-[#0A5F7A] p-5 text-white relative overflow-hidden shadow-lg shadow-[#0D7490]/20">
          {/* Floating bubbles */}
          <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full blur-[1px] animate-bubble-float" />
          <div className="absolute top-2 right-16 w-10 h-10 bg-white/15 rounded-full animate-bubble-float" style={{ animationDelay: "1.5s" }} />
          <div className="absolute -bottom-8 -right-2 w-24 h-24 bg-emerald-300/15 rounded-full animate-bubble-float" style={{ animationDelay: "3s" }} />
          <div className="absolute bottom-0 left-8 w-6 h-6 bg-white/10 rounded-full animate-bubble-float" style={{ animationDelay: "2s" }} />
          <div className="absolute -top-2 left-10 w-5 h-5 bg-white/10 rounded-full animate-bubble-float" style={{ animationDelay: "4s" }} />
          <div className="absolute top-1/2 -left-4 w-14 h-14 bg-indigo-300/10 rounded-full animate-bubble-float" style={{ animationDelay: "5s" }} />
          {/* Soft radial glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_60%)]" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-6 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center">
                <Wallet className="size-3.5 text-white" />
              </div>
              <span className="text-[11px] font-medium text-white/90">Portfolio Value</span>
              <span className="ml-auto flex items-center gap-1.5 text-[9px] font-semibold text-white/80 bg-white/10 rounded-full px-2 py-0.5">
                <span className="size-1.5 rounded-full bg-emerald-300 animate-pulse-slow" /> Live
              </span>
            </div>
            <div className="text-2xl font-black tracking-tight text-white drop-shadow-sm">
              {fmtKes(enhancedTotals.totalValue)}
            </div>
            <div className={`flex items-center gap-1 text-xs mt-2 ${enhancedTotals.pnlPercent >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              <div className={`size-4 rounded-full flex items-center justify-center ${enhancedTotals.pnlPercent >= 0 ? 'bg-emerald-400/20' : 'bg-red-400/20'}`}>
                {enhancedTotals.pnlPercent >= 0 ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
              </div>
              <span className="font-semibold">{enhancedTotals.pnlPercent >= 0 ? '+' : ''}{enhancedTotals.pnlPercent}% today</span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/20 flex justify-between text-[11px] text-white/70">
              <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-white/50" />NSE: {fmtKes(enhancedTotals.nseValue)}</span>
              <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-white/50" />Global: {fmtUsd(enhancedTotals.globalValue)}</span>
            </div>
          </div>
        </Card>

        {[
          { icon: Banknote, color: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400", label: "NSE Portfolio", value: fmtKes(enhancedTotals.nseValue), sub: `${enhancedTotals.nsePnLPercent >= 0 ? '+' : ''}${enhancedTotals.nsePnLPercent}% (${enhancedTotals.nseCount} holdings)`, valColor: "text-foreground" },
          { icon: Globe2, color: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400", label: "Global Portfolio", value: fmtUsd(enhancedTotals.globalValue), sub: `${enhancedTotals.globalPnLPercent >= 0 ? '+' : ''}${enhancedTotals.globalPnLPercent}% (${enhancedTotals.globalCount} pos)`, valColor: "text-foreground" },
          { icon: PieChart, color: "bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400", label: "Holdings", value: `${enhancedTotals.holdingsCount}`, sub: `${enhancedTotals.nseCount} NSE · ${enhancedTotals.globalCount} Global stocks`, valColor: "text-foreground" },
          { icon: Brain, color: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-600 dark:text-yellow-400", label: "Market Intelligence", value: `${signalSummary.total}`, sub: `${signalSummary.strongBuy} Buy · ${signalSummary.strongSell} Sell · peak ${signalSummary.peakConf}%`, valColor: "text-foreground" },
          { icon: Scale, color: "bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400", label: "vs Benchmarks", value: perfMeta.hasHistory ? `${benchmarkMetrics.alpha >= 0 ? '+' : ''}${benchmarkMetrics.alpha.toFixed(1)}%` : '—', sub: perfMeta.hasHistory ? `Portfolio ${perfMeta.totalReturnPercent >= 0 ? '+' : ''}${perfMeta.totalReturnPercent.toFixed(1)}% · NSE 20 ${benchmarkMetrics.nseReturn >= 0 ? '+' : ''}${benchmarkMetrics.nseReturn.toFixed(1)}% · S&P 500 ${benchmarkMetrics.spReturn >= 0 ? '+' : ''}${benchmarkMetrics.spReturn.toFixed(1)}%` : `NSE 20 ${benchmarkMetrics.nseReturn >= 0 ? '+' : ''}${benchmarkMetrics.nseReturn.toFixed(1)}% · S&P 500 ${benchmarkMetrics.spReturn >= 0 ? '+' : ''}${benchmarkMetrics.spReturn.toFixed(1)}%`, valColor: perfMeta.hasHistory ? (benchmarkMetrics.alpha >= 0 ? "text-emerald-600" : "text-red-500") : "text-muted-foreground" },
        ].map((m, i) => (
          <Card key={i} className="border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={`size-8 rounded-lg flex items-center justify-center ${m.color}`}>
                <m.icon className="size-4" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
            </div>
            <div className={`text-xl font-bold ${m.valColor}`}>{m.value}</div>
            <div className="text-xs text-muted-foreground mt-2">{m.sub}</div>
          </Card>
        ))}
      </div>

      {beginnerMode && (
        <Card className="mt-4 p-4 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20 border-amber-200 dark:border-amber-800/50">
          <div className="flex items-start gap-3">
            <Lightbulb className="size-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-amber-800 dark:text-amber-200">Beginner Mode Active.</span>{' '}
              <strong>Portfolio Value</strong> = total worth of your investments. <strong>NSE / Global</strong> = which market your stocks trade on.
              <strong> Holdings</strong> = number of different stocks you own. <strong>Market Intelligence</strong> = automated buy/sell suggestions.
              <strong>vs Benchmarks</strong> = how your portfolio compares to market indexes like the NSE 20 or S&P 500.
            </div>
          </div>
        </Card>
      )}

      {/* Market Indices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-tour="market-indices">
        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                <BarChart3 className="size-4 text-[#0D7490]" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">NSE Indices</h3>
            </div>
            <Link to="/app/markets" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              All markets <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-3">
            {nseIndices.map((index) => (
              <div key={index.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 dark:bg-muted/30 hover:bg-muted/80 dark:hover:bg-muted/50 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{index.name}</span>
                    <span className="text-[11px] text-muted-foreground">Vol: {index.volume}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-foreground">{index.value}</div>
                  <div className={`flex items-center gap-0.5 justify-end text-xs font-medium ${index.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {index.isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    <span>{index.change}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center">
                <Globe2 className="size-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Global Indices</h3>
            </div>
            <Link to="/app/markets" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              View all <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-3">
            {globalIndices.map((index) => (
              <div key={index.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 dark:bg-muted/30 hover:bg-muted/80 dark:hover:bg-muted/50 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{index.name}</span>
                    <span className="text-[11px] text-muted-foreground">Vol: {index.volume}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-foreground">{index.value}</div>
                  <div className={`flex items-center gap-0.5 justify-end text-xs font-medium ${index.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {index.isPositive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    <span>{index.change}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border shadow-sm p-5 lg:col-span-1" data-tour="sector-performance">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-[#0D7490]" />
              <h3 className="text-sm font-semibold text-foreground">Sector Performance</h3>
            </div>
            <Link to="/app/markets" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              All sectors <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-2">
            {sectorData.slice(0, 6).map((s) => (
              <div key={s.sector} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <div className={`size-2 rounded-full ${s.avgChange >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{s.sector}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${s.avgChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {s.avgChange >= 0 ? "+" : ""}{s.avgChange.toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">({s.count})</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Portfolio vs Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Scale className="size-4 text-[#0D7490]" />
              <h3 className="text-sm font-semibold text-foreground">Portfolio vs NSE 20 &amp; S&P 500</h3>
            </div>
            <div className="flex flex-wrap items-center gap-1 bg-muted rounded-lg p-0.5">
              {timeRanges.map((range) => (
                <button
                  key={range}
                  onClick={() => setSelectedTimeRange(range)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                    selectedTimeRange === range
                      ? "bg-card text-foreground shadow-sm border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          {perfLoading && perfData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">Loading performance data...</div>
          ) : perfData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">No data available</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={perfData}>
                  <defs>
                    <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="nseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6B7280" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#6B7280" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="spGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={['dataMin - 5', 'dataMax + 5']} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(0)} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} formatter={(value: number) => value.toFixed(1) + '%'} />
                  <Area type="monotone" dataKey="portfolio" name="Portfolio" stroke="#10B981" strokeWidth={2} fill="url(#portfolioGrad)" dot={{ fill: '#10B981', r: 4 }} />
                  <Area type="monotone" dataKey="sp500" name="S&P 500" stroke="#6366F1" strokeWidth={2} strokeDasharray="5 5" fill="url(#spGrad)" dot={{ fill: '#6366F1', r: 3 }} />
                  <Area type="monotone" dataKey="nse20" name="NSE 20" stroke="#6B7280" strokeWidth={2} strokeDasharray="5 5" fill="url(#nseGrad)" dot={{ fill: '#6B7280', r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full bg-emerald-500"></div>
                  <span className="text-xs text-muted-foreground">Portfolio {perfMeta.hasHistory ? `${perfMeta.totalReturnPercent >= 0 ? '+' : ''}${perfMeta.totalReturnPercent.toFixed(1)}%` : 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full bg-indigo-400"></div>
                  <span className="text-xs text-muted-foreground">S&P 500 {benchmarkMetrics.spReturn >= 0 ? '+' : ''}{benchmarkMetrics.spReturn.toFixed(1)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full bg-muted-foreground/40"></div>
                  <span className="text-xs text-muted-foreground">NSE 20 {benchmarkMetrics.nseReturn >= 0 ? '+' : ''}{benchmarkMetrics.nseReturn.toFixed(1)}%</span>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card className="border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="size-4 text-[#0D7490]" />
            <h3 className="text-sm font-semibold text-foreground">Market Pulse</h3>
          </div>
          <div className="space-y-4">
            {pulse ? (
              <>
                <SentimentBar
                  label="NSE Sentiment"
                  score={pulse.nse.score}
                  labelText={pulse.nse.label}
                  color="text-emerald-600"
                  onClick={() => setPulseDetail('nse')}
                />
                <SentimentBar
                  label="Global Sentiment"
                  score={pulse.global.score}
                  labelText={pulse.global.label}
                  color="text-indigo-600"
                  onClick={() => setPulseDetail('global')}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {pulse.summary}
                </p>
                {pulse.topSector && (
                  <div onClick={() => setPulseDetail('sector')} className="flex items-center justify-between text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted/50 hover:border hover:border-[#0D7490]/30 transition-all">
                    <span>Leading sector</span>
                    <span className="font-semibold text-emerald-600">{pulse.topSector.name} ({pulse.topSector.change}%)</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Loading market data...</p>
            )}
            <Link to="/app/markets" className="w-full py-2 bg-foreground text-background text-xs font-medium rounded-lg text-center hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <Globe2 size={14} />
              Full Market Overview
            </Link>
          </div>
        </Card>
      </div>

      {/* Top Movers — Combined NSE & Global */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-tour="top-movers">
        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Top Gainers</h3>
            </div>
            <Link to="/app/markets" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              All gainers <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-1">
            {topGainers.map((stock) => {
              const sig = signals.find(s => s.ticker === stock.ticker);
              return (
                  <div key={stock.ticker} onClick={() => setSelectedStock({
                    ticker: stock.ticker, name: stock.name, price: stock.price,
                    change: stock.change, volume: stock.volume,
                    market: stock.market === 'nse' ? 'nse' : 'global',
                    currency: stock.currency || 'KES', signal: sig,
                  })} className="flex items-center justify-between p-3 rounded-lg hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 transition-all border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800/50 cursor-pointer gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-gradient-to-br from-emerald-100 to-green-100 flex items-center justify-center shrink-0">
                        <span className="text-emerald-700 font-bold text-xs">{stock.ticker}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{stock.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {stock.currency === "USD" ? "$" : "KES "}{stock.price} &middot; Vol: {stock.volume}
                          <span className={`ml-1.5 text-[10px] font-medium uppercase ${stock.market === "nse" ? "text-[#0D7490]" : "text-indigo-500"}`}>
                            {stock.market === "nse" ? "NSE" : "Global"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-emerald-600 font-bold text-sm shrink-0">{stock.change > 0 ? "+" : ""}{stock.change.toFixed(2)}%</div>
                  </div>
              );
            })}
          </div>
        </Card>

        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                <TrendingDown className="size-4 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Top Losers</h3>
            </div>
            <Link to="/app/markets" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              All losers <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-1">
            {topLosers.map((stock) => {
              const sig = signals.find(s => s.ticker === stock.ticker);
              return (
                <div key={stock.ticker} onClick={() => setSelectedStock({
                  ticker: stock.ticker, name: stock.name, price: stock.price,
                  change: stock.change, volume: stock.volume,
                  market: stock.market === 'nse' ? 'nse' : 'global',
                  currency: stock.currency || 'KES', signal: sig,
                  })} className="flex items-center justify-between p-3 rounded-lg hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all border border-transparent hover:border-red-200 dark:hover:border-red-800/50 cursor-pointer gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-gradient-to-br from-red-100 to-rose-100 flex items-center justify-center shrink-0">
                        <span className="text-red-700 font-bold text-xs">{stock.ticker}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{stock.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {stock.currency === "USD" ? "$" : "KES "}{stock.price} &middot; Vol: {stock.volume}
                          <span className={`ml-1.5 text-[10px] font-medium uppercase ${stock.market === "nse" ? "text-[#0D7490]" : "text-indigo-500"}`}>
                            {stock.market === "nse" ? "NSE" : "Global"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-red-500 font-bold text-sm shrink-0">{stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%</div>
                  </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Watchlist & Market Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                <Star className="size-4 text-[#0D7490]" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Watchlist / Most Active</h3>
            </div>
            <Link to="/app/watchlist" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              Manage watchlist <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-1">
            {watchlist.map((stock) => {
              const fullStock = allStocks.find(s => s.ticker === stock.ticker);
              const sig = signals.find(s => s.ticker === stock.ticker);
              return (
                  <div key={stock.ticker} onClick={() => setSelectedStock({
                    ticker: stock.ticker,
                    name: stock.name || fullStock?.name || stock.ticker,
                    price: parseFloat(stock.price),
                    change: parseFloat(stock.change),
                    volume: stock.volume || fullStock?.volume || '0',
                    market: stock.market === 'nse' ? 'nse' : 'global',
                    currency: stock.currency || 'KES',
                    signal: sig,
                  })} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-all border border-transparent hover:border-border cursor-pointer gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 flex items-center justify-center relative shrink-0">
                        <span className="text-[#0D7490] font-bold text-xs">{stock.ticker}</span>
                        {stock.alert && (
                          <span className="absolute -top-0.5 -right-0.5 size-2.5 bg-red-500 rounded-full border-2 border-card" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{stock.name || stock.ticker}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {stock.currency === "USD" ? "$" : "KES "}{stock.price}
                          {stock.volume && stock.volume !== '0' && <span className="ml-1.5">· Vol: {stock.volume}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-1 rounded-md text-xs font-semibold ${stock.isPositive ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400'}`}>
                        {stock.change}
                      </span>
                      <span className={`text-[10px] font-medium uppercase ${stock.market === "nse" ? "text-[#0D7490]" : "text-indigo-500"}`}>
                        {stock.market === "nse" ? "NSE" : "Global"}
                      </span>
                    </div>
                  </div>
              );
            })}
          </div>
        </Card>

        <Card className="border-0 bg-gradient-to-br from-[#0D7490] via-[#0B6A87] to-[#0A5F7A] p-5 text-white relative overflow-hidden shadow-lg shadow-[#0D7490]/20" data-tour="ai-signals-section">
          {/* Floating bubbles */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full animate-bubble-float" />
          <div className="absolute top-4 right-20 w-8 h-8 bg-white/10 rounded-full animate-bubble-float" style={{ animationDelay: "2s" }} />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-300/10 rounded-full animate-bubble-float" style={{ animationDelay: "3.5s" }} />
          <div className="absolute bottom-6 left-24 w-5 h-5 bg-white/10 rounded-full animate-bubble-float" style={{ animationDelay: "1s" }} />
          {/* Soft radial glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_60%)]" />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-white/20 flex items-center justify-center">
                  <Brain className="size-4" />
                </div>
                <h3 className="text-sm font-semibold">Top Market Intelligence</h3>
              </div>
              <Link to="/app/signals" className="text-xs font-medium text-white/80 hover:text-white hover:underline flex items-center gap-0.5">
                All signals <ChevronRight className="size-3.5" />
              </Link>
            </div>

            {signalsLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-white/10 rounded-lg p-3.5 border border-white/20 animate-pulse">
                    <div className="h-4 bg-white/20 rounded w-1/3 mb-2" />
                    <div className="h-2 bg-white/20 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Signal Distribution */}
                {signalSummary.total > 0 && (
                  <div className="bg-white/10 rounded-lg p-3 border border-white/20 mb-3">
                    <div className="flex items-center justify-between text-[11px] text-white/70 mb-2">
                      <span>{signalSummary.total} signals</span>
                      <span className="text-white/60">Avg {signalSummary.avgConf}% confidence</span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-white/10">
                      {(["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"] as const).map(type => {
                        const count = signalSummary.counts[type];
                        if (!count) return null;
                        const colors: Record<string, string> = {
                          "Strong Buy": "bg-emerald-400",
                          "Buy": "bg-emerald-300",
                          "Hold": "bg-yellow-300",
                          "Sell": "bg-red-300",
                          "Strong Sell": "bg-red-400",
                        };
                        return <div key={type} className={colors[type]} style={{ width: `${(count / signalSummary.total) * 100}%` }} title={`${type}: ${count}`} />;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-white/60">
                      {(["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"] as const).map(type => {
                        const count = signalSummary.counts[type];
                        if (!count) return null;
                        return <span key={type}>{type}: {count}</span>;
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {topSignals.map((signal) => (
                    <Link key={signal.ticker} to={`/app/signals?ticker=${signal.ticker}`}>
                      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3.5 border border-white/20 hover:bg-white/20 transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{signal.ticker}</span>
                            <span className="text-[10px] font-medium text-white/60 uppercase">{signal.market === "NSE" ? "NSE" : "Global"}</span>
                            <Badge className={
                              signal.signal === "Strong Buy" ? "bg-emerald-400 text-emerald-900 border-0 text-[11px] font-semibold" :
                              signal.signal === "Buy" ? "bg-emerald-300 text-emerald-800 border-0 text-[11px] font-semibold" :
                              signal.signal === "Sell" ? "bg-red-300 text-red-800 border-0 text-[11px] font-semibold" :
                              signal.signal === "Strong Sell" ? "bg-red-400 text-red-900 border-0 text-[11px] font-semibold" :
                              "bg-blue-300 text-blue-800 border-0 text-[11px] font-semibold"
                            }>
                              {signal.signal}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1" style={{ color: signal.trend === "up" ? "#6EE7B7" : "#FCA5A5" }}>
                            {signal.trend === "up" ? <ArrowUp className="size-3" /> : <ArrowDownRight className="size-3" />}
                            <span className="text-xs font-medium">{signal.change}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${signal.confidence >= 80 ? 'bg-emerald-400' : signal.confidence >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${signal.confidence}%` }}></div>
                          </div>
                          <span className="text-xs text-white/70">{signal.confidence}% confidence</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {signal.mlWinProb && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300">ML: {signal.mlWinProb}</span>}
                          {signal.regime && <span className="text-[10px] px-1 py-0.5 rounded bg-white/10 text-white/60">{signal.regime}</span>}
                          {signal.weeklyTrend && <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${signal.weeklyTrend === "Bullish" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>{signal.weeklyTrend}</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Holdings & Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center">
                <Layers className="size-4 text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Portfolio Holdings</h3>
            </div>
            <Link to="/app/portfolio" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              Manage portfolio <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-2">
              {topHoldings.map((holding) => {
                const isNse = ["SCOM", "EQTY", "KCB", "EABL"].includes(holding.ticker);
                return (
                <Link key={holding.ticker} to={`/app/stock/${holding.ticker}`}>
                  <div className="flex items-center justify-between p-3.5 rounded-lg hover:bg-muted/50 transition-all border border-transparent hover:border-border">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ background: holding.color }}>
                        {holding.ticker}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{holding.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {isNse ? fmtKes(parseFloat(holding.value.replace(",", ""))) : fmtUsd(parseFloat(holding.value.replace(",", "")))}
                          <span className={`ml-1.5 text-[10px] font-medium uppercase ${isNse ? "text-[#0D7490]" : "text-indigo-500"}`}>
                            {isNse ? "NSE" : "Global"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className={`text-sm font-bold ${holding.pnl.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>
                          {holding.pnl}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{holding.weight}% of portfolio</div>
                      </div>
                      <div className="w-20">
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${holding.weight}%`, background: holding.color }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
                );
            })}
          </div>
        </Card>

        <Card className="border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                <PieChart className="size-4 text-[#0D7490]" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Allocation</h3>
            </div>
          </div>

          <div className="flex items-center justify-center mb-4">
            <RePieChart width={170} height={170}>
              <Pie
                data={allocation}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
              >
                {allocation.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </RePieChart>
          </div>

          <div className="space-y-2">
            {allocation.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full" style={{ background: item.color }}></div>
                  <span className="text-xs text-muted-foreground">{item.name}</span>
                </div>
                <span className="text-xs font-medium text-foreground">{item.value}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* News & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                <Newspaper className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">Market News</h3>
            </div>
            <Link to="/app/news" className="text-xs font-medium text-[#0D7490] hover:underline flex items-center gap-0.5">
              All news <ChevronRight className="size-3.5" />
            </Link>
          </div>
          {newsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-3.5 rounded-lg animate-pulse">
                  <div className="size-8 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : newsItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No news available.</p>
          ) : (
          <div className="space-y-2">
            {newsItems.map((item) => (
              <Link key={item.id} to={item.relatedStocks[0] ? `/app/stock/${item.relatedStocks[0]}` : "/app/news"}>
                <div className="flex items-start gap-3 p-3.5 rounded-lg hover:bg-muted/50 transition-all border border-transparent hover:border-border">
                  <div className="p-2.5 rounded-lg bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 shrink-0">
                    <Newspaper className="size-4 text-[#0D7490]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-medium text-foreground line-clamp-1">{item.headline}</h4>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span className="font-medium">{item.source}</span>
                      <span className="text-border">|</span>
                      <span>{item.timestamp}</span>
                      {item.relatedStocks.length > 0 && (
                        <>
                          <span className="text-border">|</span>
                          <Badge className="bg-[#0D7490]/10 text-[#0D7490] border-0 text-[11px] font-medium px-2">
                            {item.relatedStocks[0]}
                          </Badge>
                        </>
                      )}
                      <Badge className={`text-[10px] border-0 px-1.5 ${item.sentiment === "positive" ? "bg-green-100 text-green-700" : item.sentiment === "negative" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
                        {item.sentiment}
                      </Badge>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          )}
        </Card>

        <Card className="border-0 bg-gradient-to-br from-gray-900 to-gray-800 dark:from-[#0a0a0b] dark:to-[#141518] p-5 text-white shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <div className="size-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Activity className="size-4" />
            </div>
            <h3 className="text-sm font-semibold">Portfolio &amp; Watchlist</h3>
          </div>

          <div className="space-y-4">
            <div className="bg-white/10 rounded-lg p-4 border border-white/10">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-white/70">Portfolio Summary</span>
                <Link to="/app/portfolio" className="text-[10px] font-medium text-emerald-400 hover:underline">View all <ChevronRight className="size-3 inline" /></Link>
              </div>
              <div className="text-white/80 text-sm leading-relaxed">
                <div className="flex justify-between py-1">
                  <span>Total Value</span>
                  <span className="font-medium">{fmtKes(enhancedTotals.totalValue)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>NSE Value</span>
                  <span className="font-medium">{fmtKes(enhancedTotals.nseValue)} ({enhancedTotals.nsePnLPercent >= 0 ? '+' : ''}{enhancedTotals.nsePnLPercent}%)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Linked Accounts</span>
                  <span className="font-medium">{fmtUsd(enhancedTotals.globalValue)} ({enhancedTotals.globalPnLPercent >= 0 ? '+' : ''}{enhancedTotals.globalPnLPercent}%)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Total P&amp;L</span>
                  <span className={`font-medium ${enhancedTotals.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{enhancedTotals.pnlPercent >= 0 ? '+' : ''}{enhancedTotals.pnlPercent}%</span>
                </div>
              <div className="flex justify-between py-1">
                <span>Holdings</span>
                <span className="font-medium">{enhancedTotals.holdingsCount} ({enhancedTotals.nseCount} NSE · {enhancedTotals.globalCount} Global)</span>
              </div>
              </div>
            </div>

            <div className="bg-white/10 rounded-lg p-4 border border-white/10">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-white/70">Universe Summary</span>
                <span className="font-semibold text-emerald-400">{allStocks.length} stocks</span>
              </div>
              <div className="text-white/80 text-sm leading-relaxed">
                <div className="flex justify-between py-1"><span>NSE stocks</span><span className="font-medium">{kenyanStocks.length}</span></div>
                <div className="flex justify-between py-1"><span>Global stocks</span><span className="font-medium">{globalStocks.length}</span></div>
                <div className="flex justify-between py-1"><span>Sectors tracked</span><span className="font-medium">{sectorData.length}</span></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Link to="/app/watchlist" className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg px-3 py-2.5 text-center text-xs font-medium flex items-center justify-center gap-1">
                <Star className="size-3" /> Watchlist
              </Link>
              <Link to="/app/portfolio" className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg px-3 py-2.5 text-center text-xs font-medium flex items-center justify-center gap-1">
                <PieChart className="size-3" /> Portfolio
              </Link>
              <Link to="/app/markets" className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg px-3 py-2.5 text-center text-xs font-medium">
                Market Data
              </Link>
              <Link to="/app/signals" className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg px-3 py-2.5 text-center text-xs font-medium">
                Market Intelligence
              </Link>
            </div>
          </div>
        </Card>
      </div>

      {/* Stock detail popover */}
      {selectedStock && (() => {
        const s = selectedStock;
        const sig = s.signal;
        const signalStyles: Record<string, string> = {
          "Strong Buy": "bg-emerald-400 text-emerald-900",
          "Buy": "bg-emerald-300 text-emerald-800",
          "Hold": "bg-yellow-300 text-yellow-800",
          "Sell": "bg-red-300 text-red-800",
          "Strong Sell": "bg-red-400 text-red-900",
        };
        return (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedStock(null)}>
            <div className="bg-card rounded-xl max-w-md w-full shadow-xl border border-border overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="bg-gradient-to-r from-[#0D7490] to-[#0A5F7A] p-4 text-white relative">
                <button onClick={() => setSelectedStock(null)} className="absolute top-2 right-2 p-1 hover:bg-white/20 rounded-md transition-colors"><X className="size-4" /></button>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl font-bold">{s.ticker}</span>
                  <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${s.market === 'nse' ? 'bg-white/20 text-white' : 'bg-indigo-300/30 text-indigo-200'}`}>{s.market === 'nse' ? 'NSE' : 'Global'}</span>
                  {sig && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${signalStyles[sig.signal] || 'bg-white/20 text-white'}`}>{sig.signal}</span>}
                </div>
                <p className="text-sm text-white/80 truncate pr-6">{s.name}</p>
              </div>

              <div className="p-4 space-y-4">
                {/* Price row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted rounded-lg p-3 border border-border">
                    <p className="text-[10px] text-muted-foreground font-medium">Price</p>
                    <p className="text-lg font-bold text-foreground">{s.currency === 'USD' ? '$' : 'KES '}{s.price.toFixed(2)}</p>
                  </div>
                  <div className={`rounded-lg p-3 border ${s.change >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <p className="text-[10px] text-muted-foreground font-medium">Change</p>
                    <p className={`text-lg font-bold flex items-center gap-1 ${s.change >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {s.change >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
                    </p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 border border-border">
                    <p className="text-[10px] text-muted-foreground font-medium">Volume</p>
                    <p className="text-lg font-bold text-foreground">{s.volume}</p>
                  </div>
                </div>

                {/* Signal details */}
                {sig && (
                  <>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-2">Trading Parameters</h4>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-blue-50 rounded-md p-2 text-center border border-blue-100"><p className="text-[9px] font-medium text-blue-600 uppercase">Entry</p><p className="text-xs font-bold text-blue-900 font-mono">${sig.price.toFixed(2)}</p></div>
                        <div className="bg-red-50 rounded-md p-2 text-center border border-red-100"><p className="text-[9px] font-medium text-red-600 uppercase">Stop</p><p className="text-xs font-bold text-red-900 font-mono">${sig.price?.toFixed(2)}</p></div>
                        <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">Conf</p><p className={`text-xs font-bold ${sig.confidence >= 80 ? 'text-emerald-700' : sig.confidence >= 60 ? 'text-yellow-700' : 'text-red-700'}`}>{sig.confidence}%</p></div>
                        <div className="bg-purple-50 rounded-md p-2 text-center border border-purple-100"><p className="text-[9px] font-medium text-purple-600 uppercase">R:R</p><p className="text-xs font-bold text-purple-900 font-mono">1:{sig.riskReward?.toFixed(1) || 'N/A'}</p></div>
                      </div>
                    </div>
                    {sig.reason && (
                      <div className="bg-[#0D7490]/5 rounded-lg p-3 border border-[#0D7490]/20">
                        <p className="text-[10px] font-semibold text-[#0D7490] uppercase mb-1">Signal Reason</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{sig.reason}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Link to={`/app/stock/${s.ticker}`} onClick={() => setSelectedStock(null)} className="flex-1 bg-[#0D7490] hover:bg-[#0A5F7A] text-white text-sm font-medium text-center py-2 px-4 rounded-lg transition-colors">
                    Full Analysis
                  </Link>
                  <Link to={`/app/signals?ticker=${s.ticker}`} onClick={() => setSelectedStock(null)} className="flex-1 bg-muted hover:bg-muted/80 dark:hover:bg-muted/50 text-muted-foreground text-sm font-medium text-center py-2 px-4 rounded-lg transition-colors border border-border">
                    View Signal
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Market Pulse detail popover */}
      {pulseDetail && pulse && (() => {
        const isNse = pulseDetail === 'nse';
        const isGlobal = pulseDetail === 'global';
        const isSector = pulseDetail === 'sector';
        const sent = isNse ? pulse.nse : pulse.global;
        const idx = isNse ? pulse.indices.nse : pulse.indices.sp500;
        const sentColor = sent.score >= 65 ? 'text-emerald-600' : sent.score <= 40 ? 'text-red-500' : 'text-yellow-600';
        const sentBg = sent.score >= 65 ? 'bg-emerald-50 border-emerald-200' : sent.score <= 40 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200';
        return (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setPulseDetail(null)}>
            <div className="bg-card rounded-xl max-w-md w-full shadow-xl border border-border overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="bg-gradient-to-r from-[#0D7490] to-[#0A5F7A] p-4 text-white relative">
                <button onClick={() => setPulseDetail(null)} className="absolute top-2 right-2 p-1 hover:bg-white/20 rounded-md transition-colors"><X className="size-4" /></button>
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="size-5" />
                  <h3 className="text-lg font-bold">
                    {isSector ? 'Sector Performance' : `${isNse ? 'NSE' : 'Global'} Market Pulse`}
                  </h3>
                </div>
                {!isSector && <p className="text-sm text-white/70">Sentiment & index overview</p>}
                {isSector && <p className="text-sm text-white/70">All sectors ranked by performance</p>}
              </div>

              <div className="p-4 space-y-4">
                {!isSector && (
                  <>
                    {/* Sentiment score */}
                    <div className={`rounded-lg p-3 ${sentBg}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-muted-foreground">Sentiment Score</span>
                        <span className={`text-sm font-bold ${sentColor}`}>{sent.label} ({sent.score}/100)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${sent.score >= 65 ? 'bg-emerald-500' : sent.score <= 40 ? 'bg-red-500' : 'bg-yellow-500'}`} style={{ width: `${sent.score}%` }} />
                      </div>
                    </div>

                    {/* Index data */}
                    {idx && (
                      <div className="bg-muted rounded-lg p-3 border border-border">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Index</p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-foreground">{idx.value}</span>
                          <span className={`text-xs font-semibold ${idx.change.startsWith('+') ? 'text-emerald-600' : 'text-red-600'}`}>{idx.change}</span>
                        </div>
                      </div>
                    )}

                    {/* Positive / Total stocks */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center">
                        <p className="text-[10px] font-medium text-emerald-600 uppercase">Positive</p>
                        <p className="text-xl font-bold text-emerald-700">{sent.idxPositive}</p>
                      </div>
                      <div className="bg-muted rounded-lg p-3 border border-border text-center">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Tracked</p>
                        <p className="text-xl font-bold text-foreground">{sent.idxTotal}</p>
                      </div>
                    </div>
                  </>
                )}

                {isSector && (
                  <div className="space-y-1">
                    {sectorData.map((sec: any) => {
                      const avg = sec.avgChange;
                      return (
                        <div key={sec.sector} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">{sec.sector}</span>
                            <span className="text-[10px] text-muted-foreground">({sec.count})</span>
                          </div>
                          <span className={`text-xs font-semibold ${avg >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{avg >= 0 ? '+' : ''}{avg.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Action */}
                <Link to="/app/markets" onClick={() => setPulseDetail(null)} className="block w-full py-2.5 bg-[#0D7490] hover:bg-[#0A5F7A] text-white text-sm font-medium text-center rounded-lg transition-colors">
                  Full Market Overview
                </Link>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
