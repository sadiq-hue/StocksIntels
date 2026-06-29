import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";

import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Progress } from "../components/ui/progress";
import {
  AreaChart, Area, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link, useParams, useNavigate } from "react-router";
import {
  TrendingUp, TrendingDown, Search, Star, BarChart3, Building2,
  DollarSign, Activity, ArrowUpDown, Sparkles, TrendingUpIcon,
  ChevronLeft, ChevronRight, Loader2, ExternalLink, X, Zap,
} from "lucide-react";
import { globalStocks, kenyanStocks, type StockListItem, type StockMarket } from "../data/stockUniverses";
import {
  calculateRSI, calculateMACD, calculateSMA, calculateATR, calculateBollingerBands,
} from "../utils/technicalAnalysis";
import { fetchStockHistory, type PriceBar } from "../services/marketDataService";
import { useRealtimeQuotes } from "../contexts/RealtimeQuotesContext";
import type { Signal as SharedSignal } from "../types/signals";
import { TradingViewChart } from "../components/TradingViewChart";
import { FinancialMetrics } from "../components/FinancialMetrics";
import { useAuth } from "../auth/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const formatCurrency = (stock: StockListItem) => stock.currency === "USD" ? "$" : "KES ";

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0.00";
  const abs = Math.abs(value);
  if (abs < 0.0001) return value.toFixed(6);
  if (abs < 0.01) return value.toFixed(4);
  if (abs < 1) return value.toFixed(3);
  return value.toFixed(2);
}

interface LiveQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  provider?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  preMarketPrice?: number | null;
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
  preMarketTime?: number | null;
  postMarketPrice?: number | null;
  postMarketChange?: number | null;
  postMarketChangePercent?: number | null;
  postMarketTime?: number | null;
  marketState?: string;
  currentTradingPeriod?: {
    pre?: { start?: number; end?: number; timezone?: string; gmtoffset?: number };
    regular?: { start?: number; end?: number; timezone?: string; gmtoffset?: number };
    post?: { start?: number; end?: number; timezone?: string; gmtoffset?: number };
  };
  exchange?: string;
  currency?: string;
}

interface StockSignal extends Partial<SharedSignal> {
  fundamental?: { score?: number };
  technical?: { score?: number };
}

export function StockAnalysisPage() {
  const { ticker: urlTicker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();

  // Resolve ticker from URL — find in universe or create placeholder entry
  const resolveUrlTicker = () => {
    if (urlTicker) {
      const inNse = kenyanStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      const inGlobal = globalStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      if (inNse) return { stock: inNse, market: "nse" as StockMarket };
      if (inGlobal) return { stock: inGlobal, market: "global" as StockMarket };
      // Unknown ticker — create a placeholder entry
      return {
        stock: {
          ticker: urlTicker.toUpperCase(),
          name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0, market: "global" as StockMarket,
          currency: "USD",
        },
        market: "global" as StockMarket,
      };
    }
    return null;
  };
  const initialUrl = resolveUrlTicker();

  const [activeMarket, setActiveMarket] = useState<StockMarket>(initialUrl?.market || "nse");
  const stockUniverse = activeMarket === "nse" ? kenyanStocks : globalStocks;
  const [selectedStock, setSelectedStock] = useState<StockListItem>(initialUrl?.stock || stockUniverse[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"ticker" | "price" | "change" | "volume">("ticker");
  const [filterSector, setFilterSector] = useState("All");
  const [favorites, setFavorites] = useState<string[]>(["SCOM", "EQTY", "KCB", "AAPL", "MSFT"]);
  const [page, setPage] = useState(1);
  const itemsPerPage = 15;

  const parseVolume = (vol: string): number => {
    const num = parseFloat(vol.replace("M", "").replace("K", ""));
    return vol.includes("M") ? num * 1000000 : vol.includes("K") ? num * 1000 : num;
  };

  const filteredStocks = useMemo(() => {
    return stockUniverse
      .filter((s) => {
        const q = searchTerm.toLowerCase();
        return (s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) &&
          (filterSector === "All" || s.sector === filterSector);
      })
      .sort((a, b) => {
        if (sortBy === "price") return b.price - a.price;
        if (sortBy === "change") return b.change - a.change;
        if (sortBy === "volume") return parseVolume(b.volume) - parseVolume(a.volume);
        return a.ticker.localeCompare(b.ticker);
      });
  }, [stockUniverse, searchTerm, filterSector, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredStocks.length / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedStocks = filteredStocks.slice((safePage - 1) * itemsPerPage, safePage * itemsPerPage);

  useEffect(() => { setPage(1); }, [searchTerm, filterSector, sortBy, activeMarket]);

  // Yahoo Finance search fallback for sidebar
  const [yahooResults, setYahooResults] = useState<any[]>([]);
  const [yahooSearching, setYahooSearching] = useState(false);
  const yahooRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (yahooRef.current) clearTimeout(yahooRef.current);
    if (searchTerm.length > 0 && filteredStocks.length === 0) {
      yahooRef.current = setTimeout(async () => {
        setYahooSearching(true);
        try {
          const res = await fetch(`${API_URL}/stocks/search/yahoo?q=${encodeURIComponent(searchTerm)}`);
          if (res.ok) {
            const data = await res.json();
            setYahooResults((data || []).slice(0, 8));
          }
        } catch { /* ignore */ }
        setYahooSearching(false);
      }, 400);
    } else {
      setYahooResults([]);
    }
    return () => { if (yahooRef.current) clearTimeout(yahooRef.current); };
  }, [searchTerm, filteredStocks.length]);

  // Re-sync when URL ticker changes (e.g. from notification click)
  useEffect(() => {
    if (urlTicker) {
      const inNse = kenyanStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      const inGlobal = globalStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      if (inNse) { setActiveMarket("nse"); setSelectedStock(inNse); }
      else if (inGlobal) { setActiveMarket("global"); setSelectedStock(inGlobal); }
      else {
        setActiveMarket("global");
        setSelectedStock({
          ticker: urlTicker.toUpperCase(), name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0, market: "global", currency: "USD",
        });
      }
    }
  }, [urlTicker]);

  // Live data states
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [stockSignal, setStockSignal] = useState<StockSignal | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  const [yahooPremarket, setYahooPremarket] = useState<Record<string, any> | null>(null);

  // Holders data
  interface Holder {
    holder: string;
    shares: number;
    dateOfReport?: string;
    pctHeld?: number;
    value?: number;
  }
  const [holders, setHolders] = useState<Holder[]>([]);
  const [etfHolders, setEtfHolders] = useState<Holder[]>([]);

  const { getQuote, quotes } = useRealtimeQuotes();

  const activeSelection = stockUniverse.find((s) => s.ticker === selectedStock.ticker) || selectedStock;

  const sectors = useMemo(
    () => ["All", ...Array.from(new Set(stockUniverse.map((s) => s.sector)))],
    [stockUniverse]
  );

  // Sync liveQuote from RealtimeQuotesContext reactively (updates whenever context polls)
  useEffect(() => {
    const q = getQuote(activeSelection.ticker);
    if (q && q.price > 0) {
      setLiveQuote(q as LiveQuote);
    }
  }, [activeSelection.ticker, quotes]);

  // Fetch holders when selected stock changes
  useEffect(() => {
    const ticker = activeSelection.ticker;
    let active = true;
    fetch(`${API_URL}/stock/${encodeURIComponent(ticker)}/holders`)
      .then(r => r.json())
      .then(data => {
        if (!active) return;
        setHolders(data.topHolders || []);
        setEtfHolders(data.etfHolders || []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [activeSelection.ticker]);

  // Direct fallback: poll stock-specific endpoint for live data (bypasses context)
  useEffect(() => {
    const ticker = activeSelection.ticker;
    const market = activeSelection.market === "nse" ? "nse" : "us";
    let active = true;
    const pollLive = async () => {
      try {
        const res = await fetch(`${API_URL}/stock/${encodeURIComponent(ticker)}?market=${market}`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data && data.price > 0) {
          setLiveQuote(data as LiveQuote);
        }
      } catch { /* silent */ }
    };
    pollLive();
    const id = setInterval(pollLive, 30000);
    return () => { active = false; clearInterval(id); };
  }, [activeSelection.ticker]);

  // Yahoo Finance pre-market data (separate endpoint for real pre/after-hours data)
  useEffect(() => {
    const ticker = activeSelection.ticker;
    if (activeSelection.market === "nse") return;
    let active = true;
    const fetchPremarket = async () => {
      try {
        const res = await fetch(`${API_URL}/market/premarket?symbols=${encodeURIComponent(ticker)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && data && data[ticker]) {
          setYahooPremarket(data);
        }
      } catch { /* silent */ }
    };
    fetchPremarket();
    const id = setInterval(fetchPremarket, 60000);
    return () => { active = false; clearInterval(id); };
  }, [activeSelection.ticker]);

  // ── Stock view tracking for conversion prompts ──
  const { user } = useAuth();
  const [showProPrompt, setShowProPrompt] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [promptTicker, setPromptTicker] = useState<string | null>(null);

  useEffect(() => {
    const ticker = activeSelection.ticker;
    if (!ticker || !user) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch(`${API_URL}/stock-tracking/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ticker }),
        });
        if (cancelled) return;
        const statusRes = await fetch(`${API_URL}/stock-tracking/prompt-status?ticker=${encodeURIComponent(ticker)}`, {
          credentials: 'include',
        });
        const statusData = await statusRes.json();
        if (statusData.dismissed) {
          setPromptDismissed(true);
          return;
        }
        const res = await fetch(`${API_URL}/stock-tracking/consecutive-days?ticker=${encodeURIComponent(ticker)}`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (!cancelled && data.qualifiesForPrompt && !statusData.dismissed) {
          setShowProPrompt(true);
          setPromptTicker(data.ticker);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [activeSelection.ticker, user]);

  const dismissPrompt = useCallback(async () => {
    setShowProPrompt(false);
    setPromptDismissed(true);
    try {
      await fetch(`${API_URL}/stock-tracking/dismiss-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticker: promptTicker }),
      });
    } catch { /* silent */ }
  }, [promptTicker]);

  // Yahoo pre-market data for the current ticker (from Yahoo Finance directly, never generic)
  const yahooData = (yahooPremarket && activeSelection.ticker ? yahooPremarket[activeSelection.ticker] : null) || null;
  const yahooMarketState = yahooData?.marketState || liveQuote?.marketState || 'CLOSED';
  const yahooRegularPrice = yahooData?.regularMarketPrice ?? yahooData?.regularMarketPreviousClose ?? null;

  // Derived market-state helpers (yahoo takes priority when available)
  const marketState = yahooData?.marketState ? yahooData.marketState : (liveQuote?.marketState || 'CLOSED');
  const isPreMarket = marketState === 'PRE';
  const isPostMarket = marketState === 'POST';
  const isRegular = marketState === 'REGULAR';
  const regularPrice = yahooRegularPrice ?? liveQuote?.regularMarketPrice ?? liveQuote?.price ?? liveQuote?.previousClose ?? activeSelection.price;
  const prePrice = yahooData?.preMarketPrice ?? liveQuote?.preMarketPrice;
  const postPrice = yahooData?.postMarketPrice ?? liveQuote?.postMarketPrice;
  const altPrice = prePrice ?? postPrice ?? null;
  const altChange = isPreMarket ? (yahooData?.preMarketChange ?? liveQuote?.preMarketChange) : isPostMarket ? (yahooData?.postMarketChange ?? liveQuote?.postMarketChange) : null;
  const altChangePct = isPreMarket ? (yahooData?.preMarketChangePercent ?? liveQuote?.preMarketChangePercent) : isPostMarket ? (yahooData?.postMarketChangePercent ?? liveQuote?.postMarketChangePercent) : null;
  const altTime = isPreMarket ? (yahooData?.preMarketTime ?? liveQuote?.preMarketTime) : isPostMarket ? (yahooData?.postMarketTime ?? liveQuote?.postMarketTime) : null;
  const yahooTradingPeriod = yahooData?.currentTradingPeriod;

  function formatSessionTime(unixSeconds?: number | null): string {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const min = minutes.toString().padStart(2, '0');
    const tz = yahooTradingPeriod?.regular?.timezone || liveQuote?.currentTradingPeriod?.regular?.timezone || 'EDT';
    return `${month} ${day} at ${h12}:${min}:${String(d.getSeconds()).padStart(2, '0')} ${ampm} ${tz}`;
  }

  function formatAltTime(unixSeconds?: number | null): string {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const min = minutes.toString().padStart(2, '0');
    const tz = yahooTradingPeriod?.pre?.timezone || yahooTradingPeriod?.post?.timezone || liveQuote?.currentTradingPeriod?.pre?.timezone || 'EDT';
    return `${h12}:${min}:${String(d.getSeconds()).padStart(2, '0')} ${ampm} ${tz}`;
  }

  const sessionLabel = isPreMarket
    ? 'At close'
    : isPostMarket
    ? 'At close'
    : isRegular
    ? 'Real-time'
    : 'Previous close';
  const altSessionLabel = isPreMarket ? 'Overnight' : isPostMarket ? 'After Hours' : null;

  // Fetch signal and profile
  useEffect(() => {
    const ticker = activeSelection.ticker;
    let cancelled = false;
    const fetchData = async () => {
      setLoadingData(true);
      try {
        const signalRes = await fetch(`${API_URL}/signal/${ticker}`).then(r => r.ok ? r.json() : null);
        if (!cancelled && signalRes) setStockSignal(signalRes);
      } catch { /* silent */ }
      try {
        const res = await fetch(`${API_URL}/company/${ticker}/profile`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCompanyProfile(data);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoadingData(false);
    };
    fetchData();
    return () => { cancelled = true; };
  }, [activeSelection.ticker]);

  const displayPrice = regularPrice;
  const displayChange = liveQuote?.changePercent ?? activeSelection.change;

  // Chart data — live from Yahoo Finance
  const [chartHistory, setChartHistory] = useState<PriceBar[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartPeriod, setChartPeriod] = useState("6M");
  const historySource = chartHistory.length > 0 ? 'live' : 'none';

  const periodToRange = (period: string): string => {
    switch (period) {
      case "1M": return "1mo";
      case "3M": return "3mo";
      case "6M": return "6mo";
      case "1Y": return "1y";
      default: return "6mo";
    }
  };

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    const symbol = activeSelection.market === "nse"
      ? `${activeSelection.ticker}.NSE`
      : activeSelection.ticker;
    const fetchHistory = async () => {
      try {
        const bars = await fetchStockHistory(symbol, periodToRange(chartPeriod));
        if (!cancelled && bars.length > 0) {
          setChartHistory(bars);
        }
      } catch { /* ignore */ }
      if (!cancelled) setChartLoading(false);
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, [activeSelection.ticker, chartPeriod]);

  const chartData = useMemo(() => {
    if (chartHistory.length === 0) return [];
    const prices = chartHistory.map(b => b.close ?? 0);
    return chartHistory.map((bar, i) => {
      const sma20 = i >= 19 ? prices.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20 : null;
      const sma50 = i >= 49 ? prices.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50 : null;
      const d = new Date(bar.date + 'T00:00:00');
      return {
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        fullDate: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        price: bar.close ?? 0,
        open: bar.open ?? 0,
        high: bar.high ?? 0,
        low: bar.low ?? 0,
        volume: bar.volume,
        sma20: sma20 !== null ? sma20 : null,
        sma50: sma50 !== null ? sma50 : null,
      };
    });
  }, [chartHistory]);

  const { rsi, atr, atrPct, sma20, sma50, macdLine, macdSignal, macdHistogram, bbUpper, bbLower, bbPosition } = useMemo(() => {
    const prices = chartData.map((d: any) => d.price);
    if (prices.length === 0) return { rsi: 50, atr: 0, atrPct: 0, sma20: displayPrice, sma50: displayPrice, macdLine: 0, macdSignal: "Neutral", macdHistogram: 0, bbUpper: displayPrice, bbLower: displayPrice, bbPosition: 50 };
    const macd = calculateMACD(prices);
    const atrVal = calculateATR(chartData);
    const sma20Val = calculateSMA(prices, 20);
    const sma50Val = calculateSMA(prices, 50);
    const bb = calculateBollingerBands(prices);
    const lastPrice = prices[prices.length - 1];
    const bbPos = bb.upper !== bb.lower ? ((lastPrice - bb.lower) / (bb.upper - bb.lower)) * 100 : 50;
    return {
      rsi: calculateRSI(prices),
      atr: atrVal,
      atrPct: displayPrice > 0 ? parseFloat(((atrVal / displayPrice) * 100).toFixed(2)) : 0,
      sma20: sma20Val,
      sma50: sma50Val,
      macdLine: macd.macd,
      macdSignal: macd.macd > macd.signal ? "Bullish" : "Bearish",
      macdHistogram: macd.histogram,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      bbPosition: parseFloat(bbPos.toFixed(1)),
    };
  }, [chartData, displayPrice]);

  const displaySignal = stockSignal?.signal || (displayChange > 2 ? "Buy" : displayChange < -2 ? "Sell" : "Hold");
  const displayConfidence = stockSignal?.confidence ?? Math.min(95, 70 + Math.abs(displayChange) * 5);

  const toggleFavorite = (ticker: string) => {
    setFavorites((prev) =>
      prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker]
    );
  };

  const prices = chartData.map((d: any) => d.price);
  const currentPrice = liveQuote?.price ?? (prices.length > 0 ? prices[prices.length - 1] : displayPrice);
  const highPrice = prices.length > 0 ? Math.max(...prices) : displayPrice;
  const lowPrice = prices.length > 0 ? Math.min(...prices) : displayPrice;
  const avgPrice = prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : displayPrice;
  const periodChange = prices.length > 1 ? ((currentPrice - prices[0]) / prices[0] * 100).toFixed(2) : "0.00";

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]">
              <TrendingUpIcon className="size-5 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Stock Analysis</h1>
          </div>
          <p className="text-sm text-muted-foreground">Explore markets with advanced analytics &amp; signals</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-card border shadow-sm">
            <Sparkles className="size-4 text-[#0D7490]" />
            <span className="text-sm font-medium text-muted-foreground">{liveQuote?.provider === 'afx' ? 'AFX Live' : liveQuote?.provider ? 'Live' : 'Real-time Data'}</span>
          </div>
          <Link
            to="/app/stocks"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card text-xs font-semibold text-muted-foreground hover:text-[#0D7490] hover:border-[#0D7490]/30 transition-colors"
          >
            <BarChart3 className="size-3.5" /> Stock Screener
          </Link>
        </div>
      </div>

      {/* Market Tabs */}
      <Tabs
        value={activeMarket}
        onValueChange={(v) => {
          const market = v as StockMarket;
          setActiveMarket(market);
          setFilterSector("All");
          setSelectedStock((market === "nse" ? kenyanStocks : globalStocks)[0]);
        }}
      >
        <TabsList className="bg-muted/50 border p-1 w-full sm:w-auto">
          <TabsTrigger value="nse" className="flex-1 sm:flex-none data-[state=active]:bg-[#0D7490] data-[state=active]:text-white rounded-md transition-all">
            Kenyan Stocks
          </TabsTrigger>
          <TabsTrigger value="global" className="flex-1 sm:flex-none data-[state=active]:bg-[#0D7490] data-[state=active]:text-white rounded-md transition-all">
            Global Stocks
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="xl:col-span-1">
          <Card className="border shadow-sm xl:sticky xl:top-6 xl:max-h-[calc(100vh-5rem)] flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm text-foreground">
                  {activeMarket === "nse" ? "Kenyan Stocks" : "Global Stocks"}
                </h3>
                <Badge variant="secondary" className="rounded-full text-xs font-medium">
                  {stockUniverse.length}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search stocks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={filterSector} onValueChange={setFilterSector}>
                    <SelectTrigger className="flex-1 h-9 text-sm">
                      <SelectValue placeholder="Sector" />
                    </SelectTrigger>
                    <SelectContent>
                      {sectors.map((s) => (
                        <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => setSortBy((prev) =>
                      prev === "ticker" ? "change" : prev === "change" ? "price" : prev === "price" ? "volume" : "ticker"
                    )}
                    className="flex items-center gap-1 px-3 h-9 rounded-lg border bg-background hover:bg-accent transition-colors"
                    title={`Sort by ${sortBy}`}
                  >
                    <ArrowUpDown className="size-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
                      {sortBy === "ticker" ? "A-Z" : sortBy === "price" ? "Price" : sortBy === "change" ? "Change" : "Vol"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div className="p-2 space-y-1 min-h-0 flex-1 overflow-y-auto">
              {paginatedStocks.length > 0 ? (
                paginatedStocks.map((stock) => {
                  const isActive = activeSelection.ticker === stock.ticker;
                  const live = getQuote(stock.ticker);
                  const listPrice = live?.price && live.price > 0 ? live.price : stock.price;
                  const listChange = live?.changePercent ?? stock.change;
                  return (
                    <button
                      key={stock.ticker}
                      onClick={() => setSelectedStock(stock)}
                      className={`w-full rounded-lg p-3 text-left transition-all ${
                        isActive
                          ? "bg-[#0D7490] text-white shadow-sm"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.ticker); }}
                            className={`shrink-0 transition-colors ${
                              isActive ? "text-yellow-300" : "text-muted-foreground hover:text-yellow-500"
                            }`}
                          >
                            <Star className={`size-3.5 ${favorites.includes(stock.ticker) ? "fill-current" : ""}`} />
                          </button>
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold truncate ${isActive ? "text-white" : "text-foreground"}`}>
                              {stock.ticker}
                            </div>
                            <div className={`text-[11px] truncate ${isActive ? "text-white/70" : "text-muted-foreground"}`}>
                              {stock.name}
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold ${isActive ? "text-white" : "text-foreground"}`}>
                            {formatPrice(listPrice)}
                          </div>
                          <div className={`flex items-center justify-end gap-0.5 text-[11px] font-medium ${
                            listChange >= 0 ? "text-emerald-600" : "text-red-500"
                          }`}>
                            {listChange >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                            {listChange > 0 ? "+" : ""}{listChange.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground">
                  <Search size={20} className="mb-2 opacity-30" />
                  No stocks found
                </div>
              )}
              {/* Yahoo search results when local finds nothing */}
              {searchTerm.length > 0 && filteredStocks.length === 0 && yahooSearching && (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin mr-2" />
                  Searching Yahoo Finance...
                </div>
              )}
              {searchTerm.length > 0 && filteredStocks.length === 0 && yahooResults.length > 0 && !yahooSearching && (
                <div className="space-y-0.5">
                  <div className="px-3 py-2 text-[10px] font-semibold text-[#0D7490] uppercase tracking-wider flex items-center gap-1">
                    <ExternalLink size={10} />
                    Yahoo Finance results
                  </div>
                  {yahooResults.map((r: any) => (
                    <button
                      key={r.symbol}
                      onClick={() => navigate(`/app/stock/${r.symbol}`)}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{r.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate flex-1">{r.name}</span>
                        <span className="text-[10px] text-muted-foreground">{r.exchange}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-border p-3">
              <span className="text-xs text-muted-foreground">
                {filteredStocks.length} results
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="flex items-center justify-center size-8 rounded-md border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-xs font-medium text-muted-foreground px-2 min-w-[4rem] text-center">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="flex items-center justify-center size-8 rounded-md border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </Card>

          {/* Holders */}
          {holders.length > 0 && (
            <Card className="border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="size-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm text-foreground">Top Holders</h3>
              </div>
              <div className="space-y-2">
                {holders.map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{h.holder}</p>
                      <p className="text-muted-foreground">
                        {h.pctHeld ? `${h.pctHeld.toFixed(1)}%` : `${(h.shares || 0).toLocaleString()} shares`}
                      </p>
                    </div>
                    <span className="text-muted-foreground ml-2">{h.dateOfReport?.slice(0, 10) || ''}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Main Content */}
        <div className="xl:col-span-3 space-y-6">
          {/* Pro upgrade prompt */}
          {showProPrompt && promptTicker && (
            <div className="bg-gradient-to-r from-[#0D7490] to-[#0a5f8a] rounded-lg shadow-lg p-4 flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <Zap className="size-5 text-yellow-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">
                  You've been watching {promptTicker} — Pro users get real-time signals and sentiment alerts on this stock.
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <Link
                    to="/pricing"
                    className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#0D7490] hover:bg-yellow-300 transition-colors"
                  >
                    <Zap className="size-3.5" />
                    See Pro Plans
                  </Link>
                  <button
                    onClick={dismissPrompt}
                    className="text-xs text-white/70 hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <button
                onClick={dismissPrompt}
                className="shrink-0 text-white/50 hover:text-white transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {/* Stock Header */}
          <Card className="border shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-sm">
                    <TrendingUp className="size-7 text-white" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <h2 className="text-xl sm:text-2xl font-bold text-foreground">{activeSelection.ticker}</h2>
                      <button
                        onClick={() => toggleFavorite(activeSelection.ticker)}
                        className="transition-transform hover:scale-110"
                      >
                        <Star className={`size-5 ${
                          favorites.includes(activeSelection.ticker)
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground"
                        }`} />
                      </button>
                      <Badge variant="secondary" className="rounded-full text-xs">
                        {activeSelection.market === "nse" ? "Kenyan" : "Global"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{activeSelection.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-foreground">
                    {formatCurrency(activeSelection)}{formatPrice(regularPrice)}
                  </div>
                  <div className={`flex items-center justify-end gap-1.5 mt-0.5 ${
                    displayChange >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}>
                    {displayChange >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    <span className="font-semibold">{liveQuote?.change != null ? `${liveQuote.change > 0 ? "+" : ""}${liveQuote.change.toFixed(2)}` : ""}</span>
                    <span className="font-semibold">({displayChange > 0 ? "+" : ""}{displayChange.toFixed(2)}%)</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {sessionLabel}: {formatSessionTime(liveQuote?.currentTradingPeriod?.regular?.end)}
                  </div>
                  {altPrice != null && (
                    <>
                      <div className="text-2xl font-bold text-foreground mt-3">
                        {formatCurrency(activeSelection)}{formatPrice(altPrice)}
                      </div>
                      <div className={`flex items-center justify-end gap-1.5 ${
                        (altChangePct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"
                      }`}>
                        {altChangePct != null && altChangePct >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                        <span className="font-semibold">{altChange != null ? `${altChange > 0 ? "+" : ""}${altChange.toFixed(2)}` : ""}</span>
                        <span className="font-semibold">({altChangePct != null ? `${altChangePct > 0 ? "+" : ""}${altChangePct.toFixed(2)}%` : ""})</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {altSessionLabel}: {formatAltTime(altTime)}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { icon: Building2, label: "Sector", value: activeSelection.sector },
                  { icon: BarChart3, label: "Volume", value: liveQuote?.volume ? `${(liveQuote.volume / 1000000).toFixed(1)}M` : activeSelection.volume },
                  { icon: DollarSign, label: "Market Cap", value: companyProfile?.marketCap ? `$${(companyProfile.marketCap / 1e9).toFixed(1)}B` : activeSelection.marketCap },
                  { icon: Activity, label: "P/E", value: companyProfile?.peRatio?.toFixed(1) || (activeSelection.pe > 0 ? activeSelection.pe.toFixed(1) : "N/A") },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg bg-muted/50 p-3 border">
                    <div className="flex items-center gap-1.5 mb-1">
                      <m.icon className="size-3.5 text-[#0D7490]" />
                      <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Chart */}
          <Card className="border shadow-sm overflow-hidden">
            <div className="p-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Price Trend</h3>
                  <p className="text-xs text-muted-foreground">
                    {chartPeriod} price movement
                    {historySource === 'none' ? ' (no historical data)' : ''}
                    {historySource === 'live' ? ' — Yahoo Finance' : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {["1M", "3M", "6M", "1Y"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setChartPeriod(p)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        chartPeriod === p
                          ? "bg-[#0D7490] text-white shadow-sm"
                          : "bg-muted text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Key Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-6">
                <div className="sm:col-span-1 md:col-span-2 rounded-lg bg-muted/50 p-3 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">Current Price</div>
                  <div className={`text-xl md:text-2xl font-bold ${displayChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatCurrency(activeSelection)}{formatPrice(currentPrice)}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 ${displayChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {displayChange >= 0 ? '▲ +' : '▼ '}{displayChange.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Prev Close</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(activeSelection)}{formatPrice(liveQuote?.previousClose ?? (chartData.length > 1 ? chartData[chartData.length - 2]?.price : displayPrice))}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Open</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(activeSelection)}{formatPrice(chartData.length > 0 ? chartData[chartData.length - 1]?.open : displayPrice)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">High</div>
                  <div className="text-sm font-semibold text-emerald-600">{formatCurrency(activeSelection)}{formatPrice(highPrice)}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Low</div>
                  <div className="text-sm font-semibold text-red-500">{formatCurrency(activeSelection)}{formatPrice(lowPrice)}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-2.5 border">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Avg</div>
                  <div className="text-sm font-semibold text-blue-600">{formatCurrency(activeSelection)}{formatPrice(avgPrice)}</div>
                </div>
              </div>

              {/* Chart */}
              {activeSelection.market === "global" ? (
                <TradingViewChart symbol={activeSelection.ticker} market={activeSelection.market} />
              ) : chartLoading && chartHistory.length === 0 ? (
                <div className="flex items-center justify-center h-[340px] text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin mr-2" /> Loading price history...
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-[340px] text-sm text-muted-foreground">
                  No historical price data available
                </div>
              ) : (
                <div className="space-y-0">
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0D7490" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#0D7490" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" hide />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        domain={["dataMin - 1", "dataMax + 1"]}
                        width={55}
                        tickFormatter={(v: number) => `${v.toFixed(0)}`}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0]?.payload;
                          const isUp = d?.price >= d?.open;
                          return (
                            <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs space-y-1" style={{ fontSize: 12, minWidth: 160 }}>
                              <div className="font-semibold text-foreground mb-1.5 border-b border-border pb-1">{d?.fullDate || label}</div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Open</span>
                                <span className="font-medium">{d?.open != null ? formatPrice(d.open) : '—'}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">High</span>
                                <span className="font-medium text-emerald-600">{d?.high != null ? formatPrice(d.high) : '—'}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Low</span>
                                <span className="font-medium text-red-500">{d?.low != null ? formatPrice(d.low) : '—'}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Close</span>
                                <span className={`font-bold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>{d?.price != null ? formatPrice(d.price) : '—'}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">Volume</span>
                                <span className="font-medium">{d?.volume ? `${(d.volume / 1000000).toFixed(2)}M` : '—'}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#0D7490"
                        strokeWidth={2}
                        fill="url(#priceGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: "#0D7490", stroke: "#fff", strokeWidth: 2 }}
                      />
                      {chartData.some((d: any) => d.sma20 != null) && (
                        <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                      )}
                      {chartData.some((d: any) => d.sma50 != null) && (
                        <Line type="monotone" dataKey="sma50" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
                      )}
                      {stockSignal?.entry && (
                        <ReferenceLine y={stockSignal.entry} stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'Entry', position: 'right', fill: '#8b5cf6', fontSize: 10 }} />
                      )}
                      {stockSignal?.stopLoss && (
                        <ReferenceLine y={stockSignal.stopLoss} stroke="#dc2626" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'SL', position: 'right', fill: '#dc2626', fontSize: 10 }} />
                      )}
                      {stockSignal?.target1 && (
                        <ReferenceLine y={stockSignal.target1} stroke="#059669" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'T1', position: 'right', fill: '#059669', fontSize: 10 }} />
                      )}
                      {stockSignal?.target2 && (
                        <ReferenceLine y={stockSignal.target2} stroke="#0D7490" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'T2', position: 'right', fill: '#0D7490', fontSize: 10 }} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={chartData} margin={{ top: 0, right: 12, left: 0, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        interval={Math.floor(chartData.length / 7)}
                        height={16}
                      />
                      <Area
                        type="monotone"
                        dataKey="volume"
                        stroke="#0EA5E9"
                        strokeWidth={1}
                        fill="#0EA5E9"
                        fillOpacity={0.5}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {activeSelection.market !== "global" && chartData.length > 0 && (
                <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-sm bg-[#0D7490]" />
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground">PRICE</div>
                      <div className="text-sm font-semibold text-foreground">{formatPrice(currentPrice)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-sm bg-[#0EA5E9]" />
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground">{chartPeriod} RANGE</div>
                      <div className="text-sm font-semibold text-foreground">{formatPrice(lowPrice)} &mdash; {formatPrice(highPrice)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`size-3 rounded-sm ${displayChange >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground">CHANGE</div>
                      <div className={`text-sm font-semibold ${displayChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {displayChange >= 0 ? '+' : ''}{displayChange.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {chartData.some((d: any) => d.sma20 != null) && (
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-sm bg-[#f59e0b]" />
                      <div>
                        <div className="text-[11px] font-medium text-muted-foreground">SMA 20</div>
                        <div className="text-sm font-semibold text-foreground">{formatPrice(sma20)}</div>
                      </div>
                    </div>
                  )}
                  {chartData.some((d: any) => d.sma50 != null) && (
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-sm bg-[#ef4444]" />
                      <div>
                        <div className="text-[11px] font-medium text-muted-foreground">SMA 50</div>
                        <div className="text-sm font-semibold text-foreground">{formatPrice(sma50)}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Analytics Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Signal */}
            <Card className="border shadow-sm">
              <div className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Trading Signal</h3>
                {loadingData ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div>
                    <div className={`rounded-lg border-2 p-4 ${
                      stockSignal?.signal === "Strong Buy" || stockSignal?.signal === "Buy" || displayChange > 2
                        ? "border-emerald-200 bg-emerald-50/50"
                        : stockSignal?.signal === "Strong Sell" || stockSignal?.signal === "Sell" || displayChange < -2
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200 bg-amber-50/50"
                    }`}>
                      <div className={`text-xl font-bold mb-1 ${
                        stockSignal?.signal === "Strong Buy" || stockSignal?.signal === "Buy" || displayChange > 2 ? "text-emerald-700" :
                        stockSignal?.signal === "Strong Sell" || stockSignal?.signal === "Sell" || displayChange < -2 ? "text-red-700" : "text-amber-700"
                      }`}>
                        {displaySignal}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            displayConfidence >= 70 ? "bg-emerald-500" : displayConfidence >= 50 ? "bg-amber-500" : "bg-red-500"
                          }`} style={{ width: `${displayConfidence}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">{displayConfidence}%</span>
                      </div>
                      {stockSignal?.reason && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{stockSignal.reason}</p>
                      )}
                    </div>
                    {(stockSignal?.entry || stockSignal?.stopLoss || stockSignal?.target1) && (
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        {stockSignal?.entry && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Entry</div>
                            <div className="text-xs font-semibold text-foreground">{formatCurrency(activeSelection)}{formatPrice(stockSignal.entry)}</div>
                          </div>
                        )}
                        {stockSignal?.stopLoss && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Stop Loss</div>
                            <div className="text-xs font-semibold text-red-500">{formatCurrency(activeSelection)}{formatPrice(stockSignal.stopLoss)}</div>
                          </div>
                        )}
                        {stockSignal?.target1 && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Target 1</div>
                            <div className="text-xs font-semibold text-emerald-600">{formatCurrency(activeSelection)}{formatPrice(stockSignal.target1)}</div>
                          </div>
                        )}
                        {stockSignal?.target2 && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Target 2</div>
                            <div className="text-xs font-semibold text-emerald-600">{formatCurrency(activeSelection)}{formatPrice(stockSignal.target2)}</div>
                          </div>
                        )}
                        {stockSignal?.riskReward && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">R/R Ratio</div>
                            <div className="text-xs font-semibold text-foreground">1:{stockSignal.riskReward.toFixed(1)}</div>
                          </div>
                        )}
                        {stockSignal?.type && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Trade Type</div>
                            <div className="text-xs font-semibold text-foreground">{stockSignal.type}</div>
                          </div>
                        )}
                        {stockSignal?.timeframe && (
                          <div className="bg-muted/50 rounded-lg p-2 border">
                            <div className="text-[10px] font-medium text-muted-foreground">Timeframe</div>
                            <div className="text-xs font-semibold text-foreground">{stockSignal.timeframe}</div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {stockSignal?.mlWinProb && <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-medium">ML: {stockSignal.mlWinProb}</span>}
                      {stockSignal?.regime && <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border">{stockSignal.regime}</span>}
                      {stockSignal?.weeklyTrend && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${stockSignal.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{stockSignal.weeklyTrend}</span>}
                      {stockSignal?.positionSize && <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700 border border-purple-100 font-medium">Size: {stockSignal.positionSize}</span>}
                      {stockSignal?.var95 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-50 text-orange-700 border border-orange-100">VaR: {stockSignal.var95}</span>}
                      {stockSignal?.cvar95 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-50 text-orange-700 border border-orange-100">CVaR: {stockSignal.cvar95}</span>}
                    </div>
                    {stockSignal?.sector && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Sector: {stockSignal.sector} {stockSignal.market ? `· ${stockSignal.market}` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Technical Indicators */}
            <Card className="border shadow-sm">
              <div className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Key Indicators</h3>
                <div className="space-y-4">
                  {/* RSI */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground">RSI (14)</span>
                      <span className={`text-xs font-semibold ${
                        rsi > 70 ? "text-red-500" : rsi < 30 ? "text-emerald-600" : "text-amber-600"
                      }`}>{rsi.toFixed(1)}</span>
                    </div>
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-0 flex">
                        <div className="h-full bg-red-200/50" style={{ width: '30%' }} />
                        <div className="h-full bg-amber-200/50" style={{ width: '40%' }} />
                        <div className="h-full bg-emerald-200/50" style={{ width: '30%' }} />
                      </div>
                      <div
                        className="h-full bg-current rounded-full transition-all duration-300 relative"
                        style={{
                          width: `${Math.min(100, Math.max(0, rsi))}%`,
                          color: rsi > 70 ? '#dc2626' : rsi < 30 ? '#059669' : '#d97706',
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>0</span>
                      <span>30</span>
                      <span>70</span>
                      <span>100</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {rsi > 70 ? 'Overbought — price may be due for a pullback' : rsi < 30 ? 'Oversold — potential bounce opportunity' : 'Neutral — no extreme momentum detected'}
                    </div>
                  </div>

                  {/* MACD */}
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-muted-foreground">MACD</span>
                      <Badge className={`text-[11px] rounded-full font-medium ${
                        macdSignal === "Bullish" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>{macdSignal}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-muted/50 rounded p-1.5">
                        <span className="text-muted-foreground">MACD Line</span>
                        <div className="font-semibold text-foreground">{macdLine.toFixed(4)}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-1.5">
                        <span className="text-muted-foreground">Signal</span>
                        <div className="font-semibold text-foreground">{(macdLine - macdHistogram).toFixed(4)}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-1.5 col-span-2">
                        <span className="text-muted-foreground">Histogram</span>
                        <div className={`font-semibold ${macdHistogram >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {macdHistogram >= 0 ? '+' : ''}{macdHistogram.toFixed(4)}
                          <span className="text-muted-foreground font-normal ml-1">
                            {macdHistogram >= 0 ? '↑ gaining momentum' : '↓ losing momentum'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Moving Averages */}
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Moving Averages</span>
                      <span className={`text-xs font-semibold ${sma20 > sma50 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {sma20 > sma50 ? 'Golden Cross' : 'Death Cross'}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#f59e0b]" /> SMA 20</span>
                        <div className="text-right">
                          <span className="font-semibold text-foreground">{formatPrice(sma20)}</span>
                          <span className={`ml-1.5 ${currentPrice >= sma20 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {currentPrice >= sma20 ? 'above' : 'below'}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#ef4444]" /> SMA 50</span>
                        <div className="text-right">
                          <span className="font-semibold text-foreground">{formatPrice(sma50)}</span>
                          <span className={`ml-1.5 ${currentPrice >= sma50 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {currentPrice >= sma50 ? 'above' : 'below'}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span>Gap</span>
                        <span className="font-medium">{formatPrice(Math.abs(sma20 - sma50))} ({Math.abs(sma20 - sma50) / displayPrice > 0 ? (Math.abs(sma20 - sma50) / displayPrice * 100).toFixed(1) : '0.0'}%)</span>
                      </div>
                    </div>
                  </div>

                  {/* Bollinger Bands */}
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Bollinger Bands (20,2)</span>
                      <span className={`text-[11px] font-medium ${bbPosition > 80 ? 'text-red-500' : bbPosition < 20 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {bbPosition > 80 ? 'Near Upper' : bbPosition < 20 ? 'Near Lower' : 'Middle Zone'}
                      </span>
                    </div>
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/30 via-amber-400/30 to-red-400/30" />
                      <div className="absolute left-0 right-0 top-0 h-full flex items-center justify-center">
                        <div className="w-px h-full bg-foreground/20" />
                      </div>
                      <div
                        className="size-3 rounded-full border-2 border-white shadow-md transition-all absolute top-1/2 -translate-y-1/2"
                        style={{
                          left: `${Math.min(95, Math.max(5, bbPosition))}%`,
                          backgroundColor: bbPosition > 80 ? '#dc2626' : bbPosition < 20 ? '#059669' : '#d97706',
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>{bbLower.toFixed(0)}</span>
                      <span className="font-medium text-foreground">{((bbUpper + bbLower) / 2).toFixed(0)}</span>
                      <span>{bbUpper.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* ATR */}
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-muted-foreground">Volatility (ATR)</span>
                      <div className="text-right">
                        <span className="text-xs font-semibold text-foreground">{formatPrice(atr)}</span>
                        <span className="text-[11px] text-muted-foreground ml-1">({atrPct}%)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${atrPct > 3 ? 'bg-red-500' : atrPct > 1.5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min(100, atrPct * 20)}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-medium ${atrPct > 3 ? 'text-red-500' : atrPct > 1.5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {atrPct > 3 ? 'High' : atrPct > 1.5 ? 'Normal' : 'Low'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Financial Health */}
            <FinancialMetrics symbol={activeSelection.ticker} sector={activeSelection.sector} />
          </div>
        </div>
      </div>
    </div>
  );
}
