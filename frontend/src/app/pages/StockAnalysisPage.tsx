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
import {
  AreaChart, Area, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import {
  TrendingUp, Search, Star, BarChart3, Building2,
  DollarSign, Activity, ArrowUpDown, Sparkles, TrendingUpIcon,
  ChevronLeft, ChevronRight, Loader2, ExternalLink, X, Zap,
  Info, Shield, Wallet, Target, LineChart,
  ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { globalStocks, kenyanStocks, formatMarketCap, type StockListItem, type StockMarket } from "../data/stockUniverses";

// NSE trading hours: Mon–Fri 09:30–15:30 EAT (UTC+3). Provider marketState is
// unreliable for NSE, so derive open/closed from exchange time on the client.
function isNseMarketOpen(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const eatMin = utcMin + 180;
  return eatMin >= 570 && eatMin < 930;
}

import {
  calculateRSI, calculateMACD, calculateSMA, calculateATR, calculateBollingerBands,
} from "../utils/technicalAnalysis";
import { fetchStockHistory, type PriceBar } from "../services/marketDataService";
import { useRealtimeQuotes } from "../contexts/RealtimeQuotesContext";
import type { Signal as SharedSignal } from "../types/signals";

import { FinancialMetrics } from "../components/FinancialMetrics";
import { TradingViewChart } from "../components/TradingViewChart";
import { useAuth } from "../auth/AuthContext";
import { fetchFinancialReport, type FinancialReport } from "../services/financialsService";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const formatCurrency = (stock: StockListItem, liveCurrency?: string) => {
  const cur = liveCurrency || stock.currency;
  return cur === "USD" ? "$" : cur === "KES" ? "KES " : `${cur} `;
};

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
  marketCap?: number;
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
  const [searchParams] = useSearchParams();
  const urlMarket = searchParams.get("market")?.toLowerCase() || "";
  const navigate = useNavigate();

  // Resolve ticker from URL — find in universe or create placeholder entry
  const resolveUrlTicker = () => {
    if (urlTicker) {
      const inNse = kenyanStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      const inGlobal = globalStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      if (inNse) return { stock: inNse, market: "nse" as StockMarket };
      if (inGlobal) return { stock: inGlobal, market: "global" as StockMarket };
      const isNseFromUrl = urlMarket === "nse";
      return {
        stock: {
          ticker: urlTicker.toUpperCase(),
          name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0,
          market: isNseFromUrl ? "nse" as StockMarket : "global" as StockMarket,
          currency: isNseFromUrl ? "KES" : "USD",
        },
        market: isNseFromUrl ? "nse" as StockMarket : "global" as StockMarket,
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
  const [nseInsights, setNseInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
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
        const isNse = urlMarket === "nse";
        setActiveMarket(isNse ? "nse" : "global");
        setSelectedStock({
          ticker: urlTicker.toUpperCase(), name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0,
          market: isNse ? "nse" : "global", currency: isNse ? "KES" : "USD",
        });
      }
    }
  }, [urlTicker]);

  // Live data states
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [stockSignal, setStockSignal] = useState<StockSignal | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [financialReport, setFinancialReport] = useState<FinancialReport | null>(null);
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

  // NSE-specific insights (liquidity, health, earnings, corporate actions)
  useEffect(() => {
    if (activeSelection.market !== "nse") { setNseInsights(null); return; }
    let active = true;
    setInsightsLoading(true);
    fetch(`${API_URL}/nse/insights/${encodeURIComponent(activeSelection.ticker)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (active) { setNseInsights(data); setInsightsLoading(false); } })
      .catch(() => { if (active) setInsightsLoading(false); });
    return () => { active = false; };
  }, [activeSelection.ticker]);

  // Direct fallback: poll stock-specific endpoint for live data (bypasses context)
  useEffect(() => {
    const ticker = activeSelection.ticker;
    const market = activeSelection.market === "nse" ? "nse" : "us";
    let active = true;
    setLiveQuote(null);
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
  const isNse = activeSelection.market === "nse";
  // For NSE, trust exchange hours over the (unreliable) provider marketState.
  const isRegular = isNse ? isNseMarketOpen() : marketState === 'REGULAR';
  const isPreMarket = !isNse && marketState === 'PRE';
  const isPostMarket = !isNse && marketState === 'POST';
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
    setFinancialReport(null);
    setStockSignal(null);
    const fetchData = async () => {
      setLoadingData(true);
      const [signalRes, finRes] = await Promise.allSettled([
        fetch(`${API_URL}/signal/${ticker}`).then(r => r.ok ? r.json() : null),
        fetchFinancialReport(ticker, "annual", 2),
      ]);
      if (!cancelled) {
        if (signalRes.status === 'fulfilled' && signalRes.value) setStockSignal(signalRes.value);
        if (finRes.status === 'fulfilled') setFinancialReport(finRes.value);
        setLoadingData(false);
      }
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
  const [tvFailed, setTvFailed] = useState(false);
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
    setTvFailed(false);
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

  const { rsi, atr, atrPct, sma20, sma50, macdLine, macdSignal, macdSignalLine, macdHistogram, bbUpper, bbLower, bbPosition } = useMemo(() => {
    const prices = chartData.map((d: any) => d.price);
    if (prices.length === 0) return { rsi: 50, atr: 0, atrPct: 0, sma20: displayPrice, sma50: displayPrice, macdLine: 0, macdSignal: "Neutral", macdSignalLine: 0, macdHistogram: 0, bbUpper: displayPrice, bbLower: displayPrice, bbPosition: 50 };
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
      macdSignalLine: macd.signal,
      macdHistogram: macd.histogram,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      bbPosition: parseFloat(bbPos.toFixed(1)),
    };
  }, [chartData, displayPrice]);

  const displaySignal = stockSignal?.signal || (displayChange > 2 ? "Buy" : displayChange < -2 ? "Sell" : "Hold");
  const displayConfidence = Math.round(stockSignal?.confidence ?? Math.min(95, 70 + Math.abs(displayChange) * 5));

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

  const isPositive = displayChange >= 0;
  const signalIsBullish = displaySignal === "Strong Buy" || displaySignal === "Buy" || displayChange > 2;
  const signalIsBearish = displaySignal === "Strong Sell" || displaySignal === "Sell" || displayChange < -2;

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-sm">
              <TrendingUpIcon className="size-5 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Stock Analysis</h1>
          </div>
          <p className="text-sm text-muted-foreground">Explore markets with advanced analytics &amp; signals</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-card border shadow-sm">
            <Sparkles className="size-4 text-[#0D7490]" />
            <span className="text-sm font-medium text-muted-foreground">
              {liveQuote?.provider === 'afx' ? 'AFX Live' : liveQuote?.provider ? 'Live' : 'Real-time Data'}
            </span>
          </div>
          <Link
            to="/app/stocks"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card text-xs font-semibold text-muted-foreground hover:text-[#0D7490] hover:border-[#0D7490]/30 transition-colors"
          >
            <BarChart3 className="size-3.5" /> Stock Screener
          </Link>
        </div>
      </div>

      {/* ── Market Tabs ── */}
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

      {/* ── Pro Upgrade Prompt ── */}
      {showProPrompt && promptTicker && (
        <div className="bg-gradient-to-r from-[#0D7490] to-[#0a5f8a] rounded-lg shadow-lg p-4 flex items-start gap-3 animate-fade-in">
          <div className="shrink-0 mt-0.5">
            <Zap className="size-5 text-yellow-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">
              You&apos;ve been watching {promptTicker} — Pro users get real-time signals and sentiment alerts on this stock.
            </p>
            <div className="flex items-center gap-3 mt-2">
              <Link
                to="/pricing"
                className="inline-flex items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-xs font-semibold text-[#0D7490] hover:bg-yellow-300 transition-colors"
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

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        {/* ═══ Sidebar ═══ */}
        <div className="xl:col-span-1 space-y-4">
          <Card className="border border-border shadow-sm xl:sticky xl:top-6 xl:max-h-[calc(100vh-8rem)] flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
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
            <div className="p-2 space-y-0.5 min-h-0 flex-1 overflow-y-auto">
              {paginatedStocks.length > 0 ? (
                paginatedStocks.map((stock) => {
                  const isActive = activeSelection.ticker === stock.ticker;
                  const live = getQuote(stock.ticker);
                  const listPrice = live?.price && live.price > 0 ? live.price : stock.price;
                  const listChange = live?.changePercent ?? stock.change;
                  const isPos = listChange >= 0;
                  return (
                    <button
                      key={stock.ticker}
                      onClick={() => setSelectedStock(stock)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-all ${
                        isActive
                          ? "bg-[#0D7490] text-white shadow-sm"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.ticker); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFavorite(stock.ticker); } }}
                            className={`shrink-0 cursor-pointer transition-colors ${
                              isActive ? "text-yellow-300" : "text-muted-foreground hover:text-yellow-500"
                            }`}
                          >
                            <Star className={`size-3 ${favorites.includes(stock.ticker) ? "fill-current" : ""}`} />
                          </span>
                          <div className={`size-7 shrink-0 rounded-lg flex items-center justify-center text-[9px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-[#0D7490]/10 text-[#0D7490]"}`}>
                            {stock.ticker.slice(0, 2)}
                          </div>
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
                            isPos ? "text-emerald-400" : "text-red-400"
                          }`}>
                            {isPos ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
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

          {/* Top Movers */}
          <Card className="border border-border shadow-sm">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><TrendingUp className="size-3.5" /></span>
                <h3 className="font-semibold text-sm text-foreground">Top Movers</h3>
                <Badge variant="secondary" className="rounded-full text-[10px] ml-auto">{activeMarket === "nse" ? "NSE" : "Global"}</Badge>
              </div>
              <div className="space-y-1">
                {[...stockUniverse]
                  .map((s) => {
                    const q = getQuote(s.ticker);
                    return {
                      ...s,
                      price: q?.price && q.price > 0 ? q.price : s.price,
                      chg: q?.changePercent ?? s.change,
                    };
                  })
                  .sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg))
                  .slice(0, 5)
                  .map((m, i) => (
                    <button
                      key={m.ticker}
                      onClick={() => setSelectedStock(m)}
                      className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-accent transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-muted-foreground w-4 text-right tabular-nums">{i + 1}</span>
                        <div className={`size-6 shrink-0 rounded-md flex items-center justify-center text-[8px] font-bold ${m.chg >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                          {m.ticker.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">{m.ticker}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{m.name}</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-foreground tabular-nums">{formatPrice(m.price)}</div>
                        <div className={`text-[11px] font-medium ${m.chg >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {m.chg > 0 ? "+" : ""}{m.chg.toFixed(2)}%
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </Card>
        </div>

        {/* ═══ Main Content ═══ */}
        <div className="xl:col-span-3 space-y-5">

          {/* ── Stock Header (Hero) ── */}
          <Card className="relative overflow-hidden border border-border shadow-sm">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#0D7490]/10 via-card to-[#0EA5E9]/10" />
            <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-[#0EA5E9]/15 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 -bottom-20 size-48 rounded-full bg-[#0D7490]/10 blur-3xl" />
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
            <div className="relative p-5 sm:p-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                {/* Identity */}
                <div className="flex items-center gap-4">
                  <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0D7490] via-[#0EA5E9] to-[#1e3a5f] shadow-lg shadow-[#0D7490]/20 ring-2 ring-[#0EA5E9]/30 ring-offset-2 ring-offset-card">
                    <span className="text-sm font-black text-white/90 tracking-tight select-none">[{activeSelection.ticker}]</span>
                    <div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-400 border-2 border-card" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] bg-clip-text text-2xl sm:text-3xl font-extrabold tracking-tight text-transparent">{activeSelection.ticker}</h2>
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
                        {activeSelection.market === "nse" ? "NSE" : "Global"}
                      </Badge>
                      <Badge className={`rounded-full text-xs border ${
                        isRegular
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : isPreMarket
                          ? "bg-amber-100 text-amber-700 border-amber-200"
                          : isPostMarket
                          ? "bg-blue-100 text-blue-700 border-blue-200"
                          : "bg-muted text-muted-foreground border-border"
                      }`}>
                        <span className={`size-1.5 rounded-full mr-1.5 ${
                          isRegular ? "bg-emerald-500 animate-pulse" : isPreMarket ? "bg-amber-500" : isPostMarket ? "bg-blue-500" : "bg-gray-400"
                        }`} />
                        {isRegular ? "Market Open" : isPreMarket ? "Pre-Market" : isPostMarket ? "After Hours" : "Closed"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{activeSelection.name}</p>
                  </div>
                </div>

                {/* Price + sparkline */}
                <div className="flex items-end gap-4">
                  {chartData.length > 1 && (
                    <div className="hidden h-14 w-28 sm:block">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData.slice(-30)} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={isPositive ? "#059669" : "#dc2626"} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={isPositive ? "#059669" : "#dc2626"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Area type="monotone" dataKey="price" stroke={isPositive ? "#059669" : "#dc2626"} strokeWidth={2} fill="url(#sparkGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="text-left lg:text-right">
                    <div className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl tabular-nums">
                      {formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(regularPrice)}
                    </div>
                    <div className="flex items-center justify-start gap-1.5 mt-1.5 lg:justify-end">
                      {isPositive ? <ChevronUp className="size-4 text-emerald-600" /> : <ChevronDown className="size-4 text-red-500" />}
                      {liveQuote?.change != null && (
                        <span className={`font-semibold ${isPositive ? "text-emerald-600" : "text-red-500"}`}>{liveQuote.change > 0 ? "+" : ""}{liveQuote.change.toFixed(2)}</span>
                      )}
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isPositive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                        {displayChange > 0 ? "+" : ""}{displayChange.toFixed(2)}%
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {sessionLabel}: {formatSessionTime(liveQuote?.currentTradingPeriod?.regular?.end)}
                    </div>
                    {altPrice != null && altSessionLabel && (
                      <div className="mt-2 border-t border-border pt-2">
                        <div className="flex items-center justify-start gap-1.5 lg:justify-end">
                          <span className="text-[11px] text-muted-foreground">{altSessionLabel}:</span>
                          <span className={`text-sm font-semibold ${(altChangePct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(altPrice)}
                          </span>
                          <span className={`text-[11px] font-medium ${(altChangePct ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            ({altChangePct != null ? `${altChangePct > 0 ? "+" : ""}${altChangePct.toFixed(2)}%` : ""})
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{formatAltTime(altTime)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { icon: Building2, label: "Sector", value: activeSelection.sector, color: "text-foreground" },
                  { icon: Activity, label: "Volume", value: liveQuote?.volume ? `${(liveQuote.volume / 1000000).toFixed(1)}M` : activeSelection.volume, color: "text-foreground" },
                  { icon: Wallet, label: "Market Cap", value: (() => { const cur = liveQuote?.currency || activeSelection.currency; const cap = financialReport?.data?.quote?.marketCap || financialReport?.data?.keyMetrics?.marketCap || liveQuote?.marketCap || 0; return cap > 0 ? formatMarketCap(cap, cur) : activeSelection.marketCap; })(), color: "text-foreground" },
                  { icon: BarChart3, label: "P/E Ratio", value: financialReport?.data?.quote?.pe?.toFixed(1) || financialReport?.data?.keyMetrics?.peRatio?.toFixed(1) || (activeSelection.pe > 0 ? activeSelection.pe.toFixed(1) : "N/A"), color: "text-foreground" },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl bg-card/60 p-3 border border-border shadow-sm backdrop-blur">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <m.icon className="size-3.5 text-[#0D7490]" />
                      <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
                    </div>
                    <div className={`text-sm font-semibold ${m.color}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {activeSelection.market === "nse" && nseInsights && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-medium">
                    <DollarSign className="size-3" />
                    KES/USD: 1 USD = {nseInsights.fxRate || 130} KES
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border text-[11px]">
                    <Info className="size-3" />
                    Dollar-adjusted returns may differ due to FX volatility
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* ── Price Chart ── */}
              <Card className="border border-border shadow-sm overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
            <div className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-foreground"><LineChart className="size-4 text-[#0D7490]" />Price Trend</h3>
                  <p className="text-xs text-muted-foreground">
                    {chartPeriod} price movement
                    {historySource === 'none' ? ' (no historical data)' : ''}
                    {historySource === 'live' ? ' — Yahoo Finance' : ''}
                  </p>
                </div>
                <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border/50">
                  {["1M", "3M", "6M", "1Y"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setChartPeriod(p)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        chartPeriod === p
                          ? "bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-card"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Key Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
                <div className="rounded-lg bg-muted/40 p-3 border border-border/50 sm:col-span-1">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Price</div>
                  <div className={`text-lg md:text-xl font-bold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(currentPrice)}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {isPositive ? <ChevronUp className="size-3 inline-block" /> : <ChevronDown className="size-3 inline-block" />}
                    {' '}{displayChange > 0 ? "+" : ""}{displayChange.toFixed(2)}%
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Prev Close</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(liveQuote?.previousClose ?? (chartData.length > 1 ? chartData[chartData.length - 2]?.price : displayPrice))}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Open</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(chartData.length > 0 ? chartData[chartData.length - 1]?.open : displayPrice)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">High</div>
                  <div className="text-sm font-semibold text-emerald-600">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(highPrice)}</div>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 border border-border/50">
                  <div className="text-[11px] font-medium text-muted-foreground mb-0.5">Low</div>
                  <div className="text-sm font-semibold text-red-500">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(lowPrice)}</div>
                </div>
              </div>

              {/* Chart Area — TradingView only for global (US) markets; NSE Kenya uses
                  our own Recharts chart backed by Yahoo Finance (TradingView free widget
                  does not resolve XNSE symbols). */}
              {activeSelection.market === "global" && !tvFailed ? (
                <TradingViewChart symbol={activeSelection.ticker} market={activeSelection.market} onError={() => setTvFailed(true)} />
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
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0D7490" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#0D7490" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
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
                            <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs space-y-1" style={{ minWidth: 180 }}>
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
                      {stockSignal?.target3 && (
                        <ReferenceLine y={stockSignal.target3} stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 4" label={{ value: 'T3', position: 'right', fill: '#8b5cf6', fontSize: 10 }} />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>

                  {/* Volume Chart */}
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
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
                        fill="url(#volGrad)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Chart Legend */}
              {chartData.length > 0 && (
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
                    <div className={`size-3 rounded-sm ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground">CHANGE</div>
                      <div className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
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

          {/* ── NSE Insights ── */}
          {activeSelection.market === "nse" && (
              <Card className="border border-border shadow-sm overflow-hidden">
              <div className="h-1 w-full bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">NSE Insights</h3>
                  {insightsLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground ml-1" />}
                </div>
                {nseInsights ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* Financial Health */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className={`size-2.5 rounded-full ${nseInsights.financialHealth.level === 'good' ? 'bg-emerald-500' : nseInsights.financialHealth.level === 'watch' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Financial Health</span>
                      </div>
                      <div className={`text-lg font-bold ${nseInsights.financialHealth.level === 'good' ? 'text-emerald-600' : nseInsights.financialHealth.level === 'watch' ? 'text-amber-600' : 'text-red-600'}`}>
                        {nseInsights.financialHealth.label}
                      </div>
                      {nseInsights.financialHealth.issues.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {nseInsights.financialHealth.issues.slice(0, 2).map((issue: string, i: number) => (
                            <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                              <AlertTriangle className="size-3 text-red-400 mt-0.5 shrink-0" />
                              <span>{issue}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Liquidity Risk */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className={`size-2.5 rounded-full ${nseInsights.liquidity.score >= 70 ? 'bg-emerald-500' : nseInsights.liquidity.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Liquidity Risk</span>
                      </div>
                      <div className={`text-lg font-bold ${nseInsights.liquidity.score >= 70 ? 'text-emerald-600' : nseInsights.liquidity.score >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                        {nseInsights.liquidity.label}
                      </div>
                      <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Avg Vol</span>
                          <span className="font-medium text-foreground">{(nseInsights.liquidity.avgDailyVolume / 1000).toFixed(0)}K</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Spread</span>
                          <span className="font-medium text-foreground">{nseInsights.liquidity.bidAskSpread}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Exit (500K)</span>
                          <span className="font-medium text-foreground">~{nseInsights.liquidity.daysToExit}d</span>
                        </div>
                      </div>
                    </div>

                    {/* Earnings Countdown */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <CalendarIcon className="size-3 text-muted-foreground" />
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Next Earnings</span>
                      </div>
                      {nseInsights.earnings.length > 0 ? (
                        <div>
                          <div className="text-lg font-bold text-foreground">{nseInsights.earnings[0].daysUntil}d</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {nseInsights.earnings[0].quarter}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {nseInsights.earnings[0].date}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-medium mt-1">
                            EPS est: KES {nseInsights.earnings[0].epsEstimate}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No upcoming dates</div>
                      )}
                    </div>

                    {/* Corporate Actions */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Bell className="size-3 text-muted-foreground" />
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Corporate Actions</span>
                      </div>
                      {nseInsights.corporateActions.length > 0 ? (
                        <div className="space-y-1.5">
                          {nseInsights.corporateActions.map((ca: any, i: number) => (
                            <div key={i} className="text-[11px]">
                              <div className="flex items-center gap-1">
                                <span className={`size-1.5 rounded-full shrink-0 ${
                                  ca.type === 'suspension' ? 'bg-red-500' : ca.type === 'dividend' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`} />
                                <span className="font-medium text-foreground truncate">{ca.title}</span>
                              </div>
                              <div className="text-muted-foreground ml-2.5">{ca.date}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">None pending</div>
                      )}
                    </div>
                  </div>
                ) : !insightsLoading ? (
                  <div className="text-xs text-muted-foreground text-center py-4">No NSE insights available</div>
                ) : null}
              </div>
            </Card>
          )}

          {/* ── Analytics Grid ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
            {/* Narrow column: Trading Signal + Key Indicators */}
            <div className="xl:col-span-1 flex flex-col gap-5">
            {/* Trading Signal */}
            <Card className="relative overflow-hidden border border-border shadow-sm flex-1 min-h-0">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
                  <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><Target className="size-3.5" /></span>
                  Trading Signal
                </h3>
                {loadingData ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="space-y-3">
                    {/* Signal + Confidence Gauge */}
                    <div className={`rounded-xl border-2 p-4 flex items-center gap-4 ${
                      signalIsBullish
                        ? "border-emerald-200 bg-emerald-50/50"
                        : signalIsBearish
                        ? "border-red-200 bg-red-50/50"
                        : "border-amber-200 bg-amber-50/50"
                    }`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`text-2xl font-extrabold ${
                            signalIsBullish ? "text-emerald-700" :
                            signalIsBearish ? "text-red-700" : "text-amber-700"
                          }`}>
                            {displaySignal}
                          </span>
                          {stockSignal?.type && (
                            <Badge variant="outline" className="text-[10px] rounded-full shrink-0">{stockSignal.type}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              displayConfidence >= 70 ? "bg-emerald-500" : displayConfidence >= 50 ? "bg-amber-500" : "bg-red-500"
                            }`} style={{ width: `${displayConfidence}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-muted-foreground shrink-0">{displayConfidence}% confidence</span>
                        </div>
                        {stockSignal?.reason && (
                          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{stockSignal.reason}</p>
                        )}
                      </div>
                      <div className="relative flex size-20 shrink-0 items-center justify-center">
                        <svg className="size-20 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-border" />
                          <circle
                            cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                            stroke={displayConfidence >= 70 ? "#059669" : displayConfidence >= 50 ? "#d97706" : "#dc2626"}
                            strokeDasharray={`${(displayConfidence / 100) * 97.39} 97.39`}
                          />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                          <span className="text-base font-bold text-foreground tabular-nums">{displayConfidence}%</span>
                        </div>
                      </div>
                    </div>

                    {/* What's driving this signal */}
                    <div className="rounded-xl border border-border bg-muted/30 p-3">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">What&apos;s driving this</div>
                      <div className="space-y-2">
                        {[
                          { label: "RSI (14)", value: rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral", tone: rsi > 70 ? "text-red-500" : rsi < 30 ? "text-emerald-600" : "text-amber-600", dot: rsi > 70 ? "bg-red-500" : rsi < 30 ? "bg-emerald-500" : "bg-amber-500" },
                          { label: "MACD", value: macdSignal, tone: macdSignal === "Bullish" ? "text-emerald-600" : "text-red-500", dot: macdSignal === "Bullish" ? "bg-emerald-500" : "bg-red-500" },
                          { label: "Trend (MA)", value: sma20 > sma50 ? "Golden Cross" : "Death Cross", tone: sma20 > sma50 ? "text-emerald-600" : "text-red-500", dot: sma20 > sma50 ? "bg-emerald-500" : "bg-red-500" },
                        ].map((d) => (
                          <div key={d.label} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`size-2 rounded-full ${d.dot}`} />
                              <span className="text-xs font-medium text-foreground">{d.label}</span>
                            </div>
                            <span className={`text-xs font-semibold ${d.tone}`}>{d.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Entry / Targets Grid */}
                    {(stockSignal?.entry || stockSignal?.stopLoss || stockSignal?.target1) && (
                      <div className="grid grid-cols-2 gap-2">
                        {stockSignal?.entry && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Target Entry</div>
                            <div className="text-sm font-semibold text-foreground">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(stockSignal.entry)}</div>
                          </div>
                        )}
                        {stockSignal?.stopLoss && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Stop Loss</div>
                            <div className="text-sm font-semibold text-red-500">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(stockSignal.stopLoss)}</div>
                          </div>
                        )}
                        {stockSignal?.target1 && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Target 1</div>
                            <div className="text-sm font-semibold text-emerald-600">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(stockSignal.target1)}</div>
                          </div>
                        )}
                        {stockSignal?.target2 && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Target 2</div>
                            <div className="text-sm font-semibold text-emerald-600">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(stockSignal.target2)}</div>
                          </div>
                        )}
                        {stockSignal?.target3 && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Target 3</div>
                            <div className="text-sm font-semibold text-emerald-600">{formatCurrency(activeSelection, liveQuote?.currency)}{formatPrice(stockSignal.target3)}</div>
                          </div>
                        )}
                        {stockSignal?.riskReward && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Risk/Reward</div>
                            <div className="text-sm font-semibold text-foreground">1:{stockSignal.riskReward.toFixed(1)}</div>
                          </div>
                        )}
                        {stockSignal?.timeframe && (
                          <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Timeframe</div>
                            <div className="text-sm font-semibold text-foreground">{stockSignal.timeframe}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tags */}
                    {[
                      stockSignal?.mlWinProb && { label: `ML: ${stockSignal.mlWinProb}`, cls: "bg-blue-50 text-blue-700 border-blue-200" },
                      stockSignal?.regime && { label: stockSignal.regime, cls: "bg-muted text-muted-foreground border-border" },
                      stockSignal?.weeklyTrend && { label: stockSignal.weeklyTrend, cls: stockSignal.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200" },
                      stockSignal?.positionSize && parseInt(stockSignal.positionSize) > 0 && { label: `Size: ${stockSignal.positionSize}`, cls: "bg-purple-50 text-purple-700 border-purple-100" },
                      stockSignal?.var95 && { label: `VaR: ${stockSignal.var95}`, cls: "bg-orange-50 text-orange-700 border-orange-100" },
                      stockSignal?.cvar95 && { label: `CVaR: ${stockSignal.cvar95}`, cls: "bg-orange-50 text-orange-700 border-orange-100" },
                    ].filter(Boolean).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          stockSignal?.mlWinProb && { label: `ML: ${stockSignal.mlWinProb}`, cls: "bg-blue-50 text-blue-700 border-blue-200" },
                          stockSignal?.regime && { label: stockSignal.regime, cls: "bg-muted text-muted-foreground border-border" },
                          stockSignal?.weeklyTrend && { label: stockSignal.weeklyTrend, cls: stockSignal.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200" },
                          stockSignal?.positionSize && parseInt(stockSignal.positionSize) > 0 && { label: `Size: ${stockSignal.positionSize}`, cls: "bg-purple-50 text-purple-700 border-purple-100" },
                          stockSignal?.var95 && { label: `VaR: ${stockSignal.var95}`, cls: "bg-orange-50 text-orange-700 border-orange-100" },
                          stockSignal?.cvar95 && { label: `CVaR: ${stockSignal.cvar95}`, cls: "bg-orange-50 text-orange-700 border-orange-100" },
                        ].filter(Boolean).map((tag: any, i) => (
                          <span key={i} className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${tag.cls}`}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {(stockSignal?.sector || stockSignal?.market) && (
                      <div className="text-[11px] text-muted-foreground">
                        {stockSignal.sector && `Sector: ${stockSignal.sector}`}{stockSignal.sector && stockSignal.market ? ' · ' : ''}{stockSignal.market || ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Key Indicators */}
            <Card className="relative overflow-hidden border border-border shadow-sm">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
                  <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><LineChart className="size-3.5" /></span>
                  Key Indicators
                </h3>
                <div className="space-y-4">

                  {/* RSI */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground">RSI (14)</span>
                      <span className={`text-xs font-semibold ${
                        rsi > 70 ? "text-red-500" : rsi < 30 ? "text-emerald-600" : "text-amber-600"
                      }`}>{rsi.toFixed(1)}</span>
                    </div>
                    <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-0 rounded-full" style={{
                        background: 'linear-gradient(to right, #059669, #059669 30%, #d97706 30%, #d97706 70%, #dc2626 70%, #dc2626 100%)',
                        opacity: 0.15,
                      }} />
                      <div
                        className="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, rsi))}%`,
                          background: rsi > 70 ? '#dc2626' : rsi < 30 ? '#059669' : '#d97706',
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>0</span>
                      <span className="text-emerald-600 font-medium">30</span>
                      <span className="text-red-500 font-medium">70</span>
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
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-muted/40 rounded p-2 border border-border/50">
                        <div className="text-[10px] text-muted-foreground mb-0.5">MACD Line</div>
                        <div className="font-semibold text-foreground">{macdLine.toFixed(4)}</div>
                      </div>
                      <div className="bg-muted/40 rounded p-2 border border-border/50">
                        <div className="text-[10px] text-muted-foreground mb-0.5">Signal</div>
                        <div className="font-semibold text-foreground">{macdSignalLine.toFixed(4)}</div>
                      </div>
                      <div className="bg-muted/40 rounded p-2 border border-border/50">
                        <div className="text-[10px] text-muted-foreground mb-0.5">Histogram</div>
                        <div className={`font-semibold ${macdHistogram >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {macdHistogram >= 0 ? '+' : ''}{macdHistogram.toFixed(4)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {macdHistogram >= 0 ? '↑ Momentum gaining' : '↓ Momentum fading'}
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
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs bg-muted/40 rounded p-2 border border-border/50">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-[#f59e0b]" />
                          <span className="text-muted-foreground">SMA 20</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{formatPrice(sma20)}</span>
                          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                            currentPrice >= sma20 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {currentPrice >= sma20 ? 'above' : 'below'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs bg-muted/40 rounded p-2 border border-border/50">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-full bg-[#ef4444]" />
                          <span className="text-muted-foreground">SMA 50</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{formatPrice(sma50)}</span>
                          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                            currentPrice >= sma50 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {currentPrice >= sma50 ? 'above' : 'below'}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground px-1">
                        <span>Gap</span>
                        <span className="font-medium text-foreground">
                          {formatPrice(Math.abs(sma20 - sma50))} ({(Math.abs(sma20 - sma50) / displayPrice * 100).toFixed(1)}%)
                        </span>
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
                    <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/30 via-amber-400/30 to-red-400/30" />
                      <div className="absolute left-0 right-0 top-0 h-full flex items-center justify-center">
                        <div className="w-px h-full bg-foreground/20" />
                      </div>
                      <div
                        className="size-3.5 rounded-full border-2 border-white shadow-md transition-all absolute top-1/2 -translate-y-1/2"
                        style={{
                          left: `${Math.min(95, Math.max(5, bbPosition))}%`,
                          backgroundColor: bbPosition > 80 ? '#dc2626' : bbPosition < 20 ? '#059669' : '#d97706',
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>{formatPrice(bbLower)}</span>
                      <span className="font-medium text-foreground">{formatPrice((bbUpper + bbLower) / 2)}</span>
                      <span>{formatPrice(bbUpper)}</span>
                    </div>
                  </div>

                  {/* ATR */}
                  <div className="border-t border-border pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-medium text-muted-foreground">Volatility (ATR)</span>
                      <div className="text-left sm:text-right">
                        <span className="text-xs font-semibold text-foreground">{formatPrice(atr)}</span>
                        <span className="text-[11px] text-muted-foreground ml-1">({atrPct}%)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
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
            </div>
            {/* Wide column: Financial Health */}
            <div className="xl:col-span-2">
              <FinancialMetrics symbol={activeSelection.ticker} sector={activeSelection.sector} />
            </div>
          </div>

          {/* ── Top Holders ── */}
          {holders.length > 0 && (
            <Card className="relative overflow-hidden border border-border shadow-sm">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><Building2 className="size-3.5" /></span>
                  <h3 className="font-semibold text-sm text-foreground">Top Holders</h3>
                  <Badge variant="secondary" className="rounded-full text-[10px] ml-auto">{holders.length} holders</Badge>
                </div>
                <div className="space-y-2.5">
                  {holders.slice(0, 10).map((h, i) => {
                    const pct = h.pctHeld ?? 0;
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-[11px] font-medium text-muted-foreground w-5 text-right shrink-0">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-foreground truncate">{h.holder}</p>
                            <span className={`text-xs font-semibold shrink-0 ml-2 ${
                              pct > 5 ? 'text-[#0D7490]' : 'text-muted-foreground'
                            }`}>
                              {pct > 0 ? `${pct.toFixed(1)}%` : `${(h.shares || 0).toLocaleString()} shares`}
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] rounded-full transition-all"
                              style={{ width: `${Math.min(100, pct * 5)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Inline SVG icon components for NSE Insights ── */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function Bell({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
