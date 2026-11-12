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
  ResponsiveContainer, ComposedChart, Bar, Legend,
} from "recharts";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import {
  TrendingUp, Search, Star, BarChart3, Building2,
  DollarSign, Activity, ArrowUpDown, TrendingUpIcon,
  Loader2, ExternalLink, X, Zap,
  Info, Shield, Wallet, Target, LineChart,
  ChevronDown, ChevronUp, AlertTriangle,
  Layers, PieChart, Percent,
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
import { SignalContextExtras } from "../components/SignalContext";

import { FinancialMetrics } from "../components/FinancialMetrics";
import { TradingViewChart } from "../components/TradingViewChart";
import { useAuth } from "../auth/AuthContext";
import { authFetch } from "../auth/tokenStore";
import { CompareButton } from "../components/CompareButton";
import { fetchFinancialReport, type FinancialReport } from "../services/financialsService";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const formatCurrency = (stock: StockListItem, liveCurrency?: string) => {
  const cur = liveCurrency || stock.currency;
  return cur === "USD" ? "$" : cur === "KES" ? "KES " : `${cur} `;
};

function formatPrice(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  const abs = Math.abs(value);
  if (abs < 0.0001) return value.toFixed(6);
  if (abs < 0.01) return value.toFixed(4);
  if (abs < 1) return value.toFixed(3);
  return value.toFixed(2);
}

function formatCompact(value?: number | null): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${n}`;
}

interface LiveQuote {
  symbol: string;
  company_name?: string;
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
  regularMarketTime?: number | null;
  timestamp?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
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
      const marketFromUrl: StockMarket = urlMarket === "nse" ? "nse" : urlMarket === "ngx" ? "ngx" : urlMarket === "jse" ? "jse" : "global";
      const currencyFromUrl = marketFromUrl === "nse" ? "KES" : marketFromUrl === "ngx" ? "NGN" : marketFromUrl === "jse" ? "ZAR" : "USD";
      return {
        stock: {
          ticker: urlTicker.toUpperCase(),
          name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0,
          market: marketFromUrl,
          currency: currencyFromUrl,
        },
        market: marketFromUrl,
      };
    }
    return null;
  };
  const initialUrl = resolveUrlTicker();

  const [activeMarket, setActiveMarket] = useState<StockMarket>(initialUrl?.market || "nse");
  const [africaUniverse, setAfricaUniverse] = useState<StockListItem[]>([]);
  const stockUniverse = useMemo(
    () => (activeMarket === "nse" ? [...kenyanStocks, ...africaUniverse] : globalStocks),
    [activeMarket, africaUniverse]
  );
  const [selectedStock, setSelectedStock] = useState<StockListItem>(initialUrl?.stock || stockUniverse[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "financials" | "statistics" | "dividends" | "history" | "profile">("overview");
  const [sortBy, setSortBy] = useState<"ticker" | "price" | "change" | "volume">("ticker");
  const [filterSector, setFilterSector] = useState("All");
  const [favorites, setFavorites] = useState<string[]>(["SCOM", "EQTY", "KCB", "AAPL", "MSFT"]);
  const [nseInsights, setNseInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [stockProfile, setStockProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [page, setPage] = useState(1);
  const itemsPerPage = 15;

  const { getQuote, quotes } = useRealtimeQuotes();

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
        if (sortBy === "price") {
          const pa = getQuote(a.ticker)?.price || 0;
          const pb = getQuote(b.ticker)?.price || 0;
          return pb - pa;
        }
        if (sortBy === "change") {
          return (getQuote(b.ticker)?.changePercent ?? 0) - (getQuote(a.ticker)?.changePercent ?? 0);
        }
        if (sortBy === "volume") {
          return (getQuote(b.ticker)?.volume || 0) - (getQuote(a.ticker)?.volume || 0);
        }
        return a.ticker.localeCompare(b.ticker);
      });
  }, [stockUniverse, searchTerm, filterSector, sortBy, quotes]);

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
        const marketFromUrl: StockMarket = urlMarket === "nse" ? "nse" : urlMarket === "ngx" ? "ngx" : urlMarket === "jse" ? "jse" : "global";
        setActiveMarket(marketFromUrl);
        setSelectedStock({
          ticker: urlTicker.toUpperCase(), name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0,
          market: marketFromUrl,
          currency: marketFromUrl === "nse" ? "KES" : marketFromUrl === "ngx" ? "NGN" : marketFromUrl === "jse" ? "ZAR" : "USD",
        });
      }
    }
  }, [urlTicker]);

  // Load NGX (Nigeria) & JSE (South Africa) listings into the African Stocks tab,
  // alongside the Kenyan NSE universe.
  useEffect(() => {
    let dead = false;
    const load = (url: string) =>
      fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
    Promise.all([
      load(`${API_URL}/africa/stocks?exchange=NGX&all=1&limit=500`),
      load(`${API_URL}/africa/stocks?exchange=JSE&all=1&limit=500`),
    ]).then(([ngx, jse]) => {
      if (dead) return;
      const map = (d: any, market: StockMarket, currency: string): StockListItem[] =>
        (Array.isArray(d?.data) ? d.data : Array.isArray(d?.stocks) ? d.stocks : Array.isArray(d) ? d : []).map((r: any) => ({
          ticker: r.ticker,
          name: r.name,
          price: Number(r.price) || 0,
          change: Number(r.changePct) || 0,
          volume: String(r.volume ?? '0'),
          marketCap: '—',
          sector: r.sector || 'Other',
          pe: 0,
          dividend: 0,
          market,
          currency,
        }));
      setAfricaUniverse([...map(ngx, 'ngx', 'NGN'), ...map(jse, 'jse', 'ZAR')]);
    }).catch((e) => { console.error('[africa universe] load failed:', e); });
    return () => { dead = true; };
  }, []);

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

  const activeSelection = stockUniverse.find((s) => s.ticker === selectedStock.ticker) || selectedStock;
  // Financial statements live under different providers per market: JSE via Yahoo
  // (TICKER.JO), NGX via the stockanalysis.com scraper (NGX:TICKER), NSE/US as-is.
  const finSymbol = activeSelection.market === 'jse' ? `JSE:${activeSelection.ticker}`
    : activeSelection.market === 'ngx' ? `NGX:${activeSelection.ticker}`
    : activeSelection.ticker;

  useEffect(() => {
    const controller = new AbortController();
    setStockProfile(null);
    setProfileLoading(true);
    fetch(`${API_URL}/stock/${encodeURIComponent(finSymbol)}/profile?market=${encodeURIComponent(activeSelection.market)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.profile) setStockProfile(data.profile); })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
    return () => controller.abort();
  }, [finSymbol, activeSelection.market]);

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
    const market = activeSelection.market === "global" ? "us" : activeSelection.market;
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
  const regularPrice = liveQuote?.price ?? liveQuote?.regularMarketPrice ?? yahooRegularPrice ?? liveQuote?.previousClose ?? null;
  const prePrice = yahooData?.preMarketPrice ?? liveQuote?.preMarketPrice ?? null;
  const postPrice = yahooData?.postMarketPrice ?? liveQuote?.postMarketPrice ?? null;
  // Show the extended-hours session from the latest available data — even when the
  // market is CLOSED (e.g. weekend) Yahoo still reports the last session's post-market print.
  const usePre = isPreMarket || (prePrice != null && postPrice == null);
  const altPrice = usePre ? prePrice : postPrice;
  const altChange = usePre ? (yahooData?.preMarketChange ?? liveQuote?.preMarketChange) : (yahooData?.postMarketChange ?? liveQuote?.postMarketChange);
  const altChangePct = usePre ? (yahooData?.preMarketChangePercent ?? liveQuote?.preMarketChangePercent) : (yahooData?.postMarketChangePercent ?? liveQuote?.postMarketChangePercent);
  const altTime = usePre ? (yahooData?.preMarketTime ?? liveQuote?.preMarketTime) : (yahooData?.postMarketTime ?? liveQuote?.postMarketTime);
  const altSessionLabel = altPrice != null ? (usePre ? 'Pre-Market' : 'After Hours') : null;
  const yahooTradingPeriod = yahooData?.currentTradingPeriod;

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

  // Yahoo exchange codes -> display names (chart meta uses short codes like NMS/NYQ)
  const EXCHANGE_LABELS: Record<string, string> = {
    NMS: 'NASDAQ', NGM: 'NASDAQ', NGS: 'NASDAQ', NCM: 'NASDAQ', NASDAQ: 'NASDAQ',
    NASDAQGM: 'NASDAQ', NASDAQGS: 'NASDAQ', NASDAQCM: 'NASDAQ',
    NYQ: 'NYSE', NYS: 'NYSE', NYE: 'NYSE', NYSE: 'NYSE',
    ASE: 'NYSE AMEX', AMEX: 'NYSE AMEX', PCX: 'NYSE Arca', BATS: 'Cboe BZX',
    XNAS: 'NASDAQ', XNYS: 'NYSE', XNSE: 'NSE', LSE: 'LSE', JSE: 'JSE',
  };
  function exchangeLabelFor(raw?: string | null): string | null {
    if (!raw) return null;
    const key = raw.toUpperCase();
    return EXCHANGE_LABELS[key] || (key.length <= 4 ? raw : null);
  }

  // GMT offset (seconds) -> "GMT-4" / "GMT+3"
  function formatGmtOffset(offsetSeconds?: number | null): string {
    if (offsetSeconds == null || Number.isNaN(offsetSeconds)) return '';
    const sign = offsetSeconds >= 0 ? '+' : '-';
    const abs = Math.abs(offsetSeconds) / 3600;
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh) * 60);
    return `GMT${sign}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
  }

  // Render a unix timestamp in the exchange's local wall-clock (offset-corrected)
  // as "14 Aug, 19:59 GMT-4" — matching the reference quote header.
  function formatQuoteTime(unixSeconds?: number | null, offsetSeconds?: number | null): string {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    const shifted = new Date(d.getTime() + (offsetSeconds || 0) * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = shifted.getUTCDate();
    const hh = shifted.getUTCHours().toString().padStart(2, '0');
    const min = shifted.getUTCMinutes().toString().padStart(2, '0');
    const tz = formatGmtOffset(offsetSeconds) || yahooTradingPeriod?.regular?.timezone || liveQuote?.currentTradingPeriod?.regular?.timezone || '';
    return `${day} ${months[shifted.getUTCMonth()]}, ${hh}:${min}${tz ? ' ' + tz : ''}`;
  }

  const exchangeOffset = yahooTradingPeriod?.regular?.gmtoffset ?? liveQuote?.currentTradingPeriod?.regular?.gmtoffset;
  const regularEnd = yahooTradingPeriod?.regular?.end ?? liveQuote?.currentTradingPeriod?.regular?.end;
  const regularStart = yahooTradingPeriod?.regular?.start ?? liveQuote?.currentTradingPeriod?.regular?.start;
  const lastTradeTime = yahooData?.regularMarketTime ?? liveQuote?.regularMarketTime ?? liveQuote?.timestamp ?? null;
  const quoteTime = lastTradeTime ?? (isRegular ? regularStart : regularEnd);
  const quoteStatusLabel = isRegular ? 'Open' : isPreMarket ? 'Pre-Market' : isPostMarket ? 'After Hours' : 'At close';
  const quoteStatusLine = quoteTime ? `${quoteStatusLabel}: ${formatQuoteTime(quoteTime, exchangeOffset)}` : quoteStatusLabel;

  const rawExchange = yahooData?.exchange || liveQuote?.exchange || null;
  const exchangeLabel = isNse ? 'NSE' : exchangeLabelFor(rawExchange) || (activeSelection.market === 'global' ? 'Global' : null);
  const tickerLine = exchangeLabel ? `${exchangeLabel}: ${activeSelection.ticker}` : activeSelection.ticker;
  const displayName = yahooData?.company_name?.trim() || liveQuote?.company_name?.trim() || activeSelection.name || activeSelection.ticker;
  const currencyLabel = yahooData?.currency || liveQuote?.currency || activeSelection.currency || (isNse ? 'KES' : 'USD');

  // Fetch signal from the SAME source as the Market Intelligence page
  // (/api/signals, the signal-engine cache + monitored open positions) so this
  // card always shows the engine's actual call. Fall back to the single-stock
  // endpoint only when the ticker isn't in the Market Intelligence list.
  useEffect(() => {
    const ticker = activeSelection.ticker;
    let cancelled = false;
    setFinancialReport(null);
    setStockSignal(null);
    // Market intelligence is only produced for the covered (NSE/US) universe, so
    // NGX/JSE never request a signal. They DO still load financial statements
    // (market cap, P/E, Financial Health), so only the signal fetch is skipped.
    const isAfrica = activeSelection.market === 'ngx' || activeSelection.market === 'jse';
    const fetchData = async () => {
      setLoadingData(true);
      if (isAfrica) {
        const fin = await fetchFinancialReport(finSymbol, "annual", 10).catch(() => null);
        if (!cancelled) { if (fin) setFinancialReport(fin); setLoadingData(false); }
        return;
      }
      const userIdParam = user?.id ? `?userId=${user.id}` : '';
      const [signalsRes, finRes] = await Promise.allSettled([
        authFetch(`${API_URL}/signals${userIdParam}`).then(r => r.ok ? r.json() : null),
        fetchFinancialReport(finSymbol, "annual", 10),
      ]);
      let sig: any = null;
      if (signalsRes.status === 'fulfilled' && signalsRes.value?.signals) {
        sig = signalsRes.value.signals.find(
          (s: any) => String(s.ticker).toUpperCase() === ticker.toUpperCase()
        ) || null;
      }
      if (!sig) {
        sig = await fetch(`${API_URL}/signal/${ticker}`).then(r => r.ok ? r.json() : null).catch(() => null);
      }
      if (!cancelled) {
        if (sig) setStockSignal(sig);
        if (finRes.status === 'fulfilled') setFinancialReport(finRes.value);
        setLoadingData(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [activeSelection.ticker, activeSelection.market, user?.id]);

  const displayPrice = regularPrice ?? 0;
  const displayChange = liveQuote?.changePercent ?? 0;
  // No static fallback: when there is no live change, render an em-dash rather
  // than a hardcoded/zero percentage that looks like real data.
  const changeDisplay = liveQuote?.changePercent != null && Number.isFinite(displayChange)
    ? `${displayChange > 0 ? "+" : ""}${displayChange.toFixed(2)}%`
    : "—";

  // Chart data — live from Yahoo Finance
  const [chartHistory, setChartHistory] = useState<PriceBar[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartPeriod, setChartPeriod] = useState("6M");
  const [tvFailed, setTvFailed] = useState(false);
  const historySource = chartHistory.length > 0 ? 'live' : 'none';

  const periodToRange = (period: string): string => {
    switch (period) {
      case "1D": return "1d";
      case "5D": return "5d";
      case "1M": return "1mo";
      case "YTD": return "ytd";
      case "3M": return "3mo";
      case "6M": return "6mo";
      case "1Y": return "1y";
      case "5Y": return "5y";
      case "Max": return "max";
      default: return "6mo";
    }
  };

  useEffect(() => {
    let cancelled = false;
    setTvFailed(false);
    setChartLoading(true);
    const m = activeSelection.market;
    const symbol = m === "nse"
      ? `${activeSelection.ticker}.NSE`
      : (m === "ngx" || m === "jse")
        ? `${m.toUpperCase()}:${activeSelection.ticker}`
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
  }, [activeSelection.ticker, activeSelection.market, chartPeriod]);

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

  const signalTone = signalIsBullish ? "emerald" : signalIsBearish ? "red" : "amber";

  const statStrip = [
    { label: "Sector", value: activeSelection.sector, icon: Layers },
    { label: "Volume", value: liveQuote?.volume ? `${(liveQuote.volume / 1000000).toFixed(1)}M` : "-", icon: BarChart3 },
    { label: "Market Cap", value: (() => { const cur = liveQuote?.currency || activeSelection.currency; const cap = financialReport?.data?.quote?.marketCap || financialReport?.data?.keyMetrics?.marketCap || liveQuote?.marketCap || 0; return cap > 0 ? formatMarketCap(cap, cur) : "-"; })(), icon: PieChart },
    { label: "P/E Ratio", value: (() => {
      const pe = financialReport?.data?.quote?.pe || financialReport?.data?.keyMetrics?.peRatio || 0;
      if (pe > 0) return pe.toFixed(1);
      if (financialReport) return "N/A";
      return activeSelection.pe > 0 ? activeSelection.pe.toFixed(1) : "N/A";
    })(), icon: Percent },
  ];

  const fr = financialReport?.data;
  const fq = fr?.quote || null;
  const fk = fr?.keyMetrics || null;
  const fi = fr?.incomeStatement || null;
  const fh = Array.isArray(fr?.incomeStatementHistory) ? fr!.incomeStatementHistory : [];
  const latestDiv = Array.isArray(fr?.dividendHistory) ? fr!.dividendHistory[0] : null;
  const yearLow = fq?.yearLow ?? yahooData?.fiftyTwoWeekLow ?? null;
  const yearHigh = fq?.yearHigh ?? yahooData?.fiftyTwoWeekHigh ?? null;
  const curSym = liveQuote?.currency || activeSelection.currency || (isNse ? "KES" : "USD");
  const money = (v?: number | null) => (v != null && Number.isFinite(Number(v)) && Number(v) !== 0 ? `${curSym} ${formatCompact(Number(v))}` : "—");
  const priceOf = (v?: number | null) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? `${curSym} ${formatPrice(Number(v))}` : "—");
  const pctOf = (v?: number | null) => (v != null && Number.isFinite(Number(v)) ? `${(Number(v) * (Math.abs(Number(v)) <= 1 ? 100 : 1)).toFixed(2)}%` : "—");
  const companySnapshot = [
    { label: "Market Cap", value: money(fq?.marketCap || fk?.marketCap || liveQuote?.marketCap) },
    { label: "Revenue", value: money(fi?.revenue || fh[0]?.revenue) },
    { label: "Net Income", value: money(fi?.netIncome || fh[0]?.netIncome) },
    { label: "EPS", value: fq?.eps != null ? fq.eps.toFixed(2) : fi?.eps != null ? fi.eps.toFixed(2) : "—" },
    { label: "Shares Out", value: fq?.sharesOutstanding ? formatCompact(fq.sharesOutstanding) : fk?.sharesOutstanding ? formatCompact(fk.sharesOutstanding) : "—" },
    { label: "P/E Ratio", value: fq?.pe ? fq.pe.toFixed(1) : fk?.peRatio ? fk.peRatio.toFixed(1) : "—" },
    { label: "P/B Ratio", value: fk?.pbRatio ? fk.pbRatio.toFixed(2) : "—" },
    { label: "P/S Ratio", value: fk?.priceToSalesRatio ? fk.priceToSalesRatio.toFixed(2) : "—" },
    { label: "Dividend Yield", value: pctOf(fk?.dividendYieldPercentage ?? fk?.dividendYield) },
    { label: "Last Dividend", value: latestDiv ? `${curSym} ${formatPrice(latestDiv.dividend)}` : "—" },
    { label: "Volume", value: formatCompact(fq?.volume || liveQuote?.volume) },
    { label: "Avg Volume", value: formatCompact(fq?.avgVolume) },
    { label: "Open", value: priceOf(fq?.open) },
    { label: "Previous Close", value: priceOf(fq?.previousClose || liveQuote?.previousClose) },
    { label: "Day Range", value: fq?.dayLow || fq?.dayHigh ? `${formatPrice(fq?.dayLow)} – ${formatPrice(fq?.dayHigh)}` : "—" },
    { label: "52-Week Range", value: fq?.yearLow || fq?.yearHigh ? `${formatPrice(fq?.yearLow)} – ${formatPrice(fq?.yearHigh)}` : "—" },
  ].filter((s) => s.value !== "—" && s.value !== "N/A");

  const financialSeries = fh
    .slice()
    .reverse()
    .map((row: any) => ({
      year: String(row.date || row.period || "").slice(0, 4) || "—",
      revenue: Number(row.revenue) || 0,
      netIncome: Number(row.netIncome) || 0,
    }))
    .filter((r) => r.year !== "—")
    .slice(-6);

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Company header */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.08] via-[#0EA5E9]/[0.04] to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">
              {displayName} <span className="text-muted-foreground font-medium">({activeSelection.ticker})</span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tickerLine} · Real-Time Price · {currencyLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
            <a href="#price-chart" className="hover:text-[#0D7490]">Full Chart</a>
            <button onClick={() => toggleFavorite(activeSelection.ticker)} className="hover:text-[#0D7490]">
              {favorites.includes(activeSelection.ticker) ? "★ Watchlist" : "☆ Watchlist"}
            </button>
            <Link to={`/app/signals?ticker=${encodeURIComponent(activeSelection.ticker)}`} className="hover:text-[#0D7490]">Alerts</Link>
            <CompareButton ticker={activeSelection.ticker} size="sm" />
          </div>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div><span className="block text-[10px] uppercase tracking-wider">Volume</span><span className="font-semibold text-foreground">{formatCompact(fq?.volume || liveQuote?.volume)}</span></div>
            <div><span className="block text-[10px] uppercase tracking-wider">Market Cap</span><span className="font-semibold text-foreground">{formatCompact(fq?.marketCap || fk?.marketCap || liveQuote?.marketCap)}</span></div>
            <div><span className="block text-[10px] uppercase tracking-wider">Day Range</span><span className="font-semibold text-foreground">{fq?.dayLow || fq?.dayHigh ? `${formatPrice(fq?.dayLow)} - ${formatPrice(fq?.dayHigh)}` : "-"}</span></div>
            <div><span className="block text-[10px] uppercase tracking-wider">52-Week Range</span><span className="font-semibold text-foreground">{yearLow || yearHigh ? `${formatPrice(yearLow)} - ${formatPrice(yearHigh)}` : "-"}</span></div>
          </div>
          <div className="rounded-xl border border-[#0D7490]/10 bg-white/40 dark:bg-white/[0.03] px-3 py-2 text-left sm:text-right">
            <div className="flex flex-wrap items-baseline justify-start gap-2 sm:justify-end">
              <span className="text-[42px] sm:text-[48px] leading-none font-bold tracking-tight tabular-nums text-foreground">{formatPrice(regularPrice)}</span>
              {liveQuote?.change != null && (
                <span className={`text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                  {liveQuote.change > 0 ? "+" : ""}{liveQuote.change.toFixed(2)}
                </span>
              )}
              <span className={`text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                ({changeDisplay})
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{quoteStatusLine}</p>
            {altPrice != null && altSessionLabel && (
              <p className="mt-1 text-xs text-muted-foreground">
                {altSessionLabel}: <span className="font-medium text-foreground">{formatPrice(altPrice)}</span>{" "}
                {altChange != null && (
                  <span className={altChangePct != null && altChangePct >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {altChange > 0 ? "+" : ""}{altChange.toFixed(2)} ({altChangePct != null ? `${altChangePct > 0 ? "+" : ""}${altChangePct.toFixed(2)}%` : ""})
                  </span>
                )}{" "}
                {formatAltTime(altTime)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border text-xs font-medium">
        {([
          ["overview", "Overview"],
          ["financials", "Financials"],
          ["statistics", "Statistics"],
          ["dividends", "Dividends"],
          ["history", "History"],
          ["profile", "Profile"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`whitespace-nowrap px-3 py-2 border-b-2 transition-colors ${
              activeTab === key ? "border-[#0D7490] text-[#0D7490]" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
          <div className="space-y-4 min-w-0">
            {/* Price chart */}
            <Card id="price-chart" className="relative overflow-hidden border border-border shadow-sm">
              <div className="h-1 w-full bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-4 bg-gradient-to-b from-[#0D7490]/[0.03] to-transparent">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Price Chart</h2>
                  <div className="flex flex-wrap gap-0.5">
                    {["1D", "5D", "1M", "YTD", "3M", "6M", "1Y", "5Y", "Max"].map((p) => (
                      <button
                        key={p}
                        onClick={() => setChartPeriod(p)}
                        className={`px-2 py-1 text-[10px] font-semibold rounded ${
                          chartPeriod === p ? "bg-[#0D7490] text-white" : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {chartLoading && chartHistory.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin mr-2" /> Loading chart…</div>
                ) : chartData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">No price history available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0D7490" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#0D7490" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={Math.max(1, Math.floor(chartData.length / 6))} />
                      <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={52} tickFormatter={(v: number) => formatCompact(v)} />
                      <Tooltip formatter={(v: any) => `${curSym} ${formatPrice(Number(v))}`} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                      <Area type="monotone" dataKey="price" stroke="#0D7490" strokeWidth={2} fill="url(#priceArea)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            {/* About */}
            <Card className="border border-border shadow-sm">
              <div className="p-4">
                <h2 className="text-sm font-semibold text-foreground">About {activeSelection.ticker}</h2>
                {stockProfile?.description ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{stockProfile.description}</p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Company description is not available yet.</p>
                )}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4 text-xs">
                  {[
                    { label: "Industry", value: stockProfile?.industry },
                    { label: "Sector", value: stockProfile?.sector || activeSelection.sector },
                    { label: "Employees", value: stockProfile?.employees ? Number(stockProfile.employees).toLocaleString() : null },
                    { label: "Stock Exchange", value: stockProfile?.exchange },
                    { label: "Ticker Symbol", value: activeSelection.ticker },
                  ].filter((x) => x.value).map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                      <p className="mt-0.5 font-medium text-foreground">{item.value}</p>
                    </div>
                  ))}
                  {stockProfile?.website && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Website</p>
                      <a href={stockProfile.website} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-medium text-[#0D7490] hover:underline">
                        {stockProfile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink className="size-3" />
                      </a>
                    </div>
                  )}
                </div>
                <button onClick={() => setActiveTab("profile")} className="mt-4 text-xs font-medium text-[#0D7490] hover:underline">
                  Full Company Profile →
                </button>
              </div>
            </Card>

            {/* Financial performance */}
            {financialSeries.length > 0 && (
              <Card className="border border-border shadow-sm">
                <div className="p-4">
                  <h2 className="text-sm font-semibold text-foreground">Financial Performance</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Annual revenue and net income</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={financialSeries} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                      <YAxis yAxisId="left" tickFormatter={formatCompact} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={52} />
                      <YAxis yAxisId="right" orientation="right" tickFormatter={formatCompact} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={52} />
                      <Tooltip formatter={(v: any, name: any) => [`${curSym} ${formatCompact(Number(v))}`, name]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0D7490" radius={[2, 2, 0, 0]} />
                      <Line yAxisId="right" dataKey="netIncome" name="Net Income" stroke="#059669" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <button onClick={() => setActiveTab("financials")} className="mt-1 text-xs font-medium text-[#0D7490] hover:underline">Financial Statements →</button>
                </div>
              </Card>
            )}

            {/* News */}
            <Card className="border border-border shadow-sm">
              <div className="p-4">
                <h2 className="text-sm font-semibold text-foreground">News</h2>
                {stockSignal?.news && stockSignal.news.length > 0 ? (
                  <div className="mt-3 divide-y divide-border">
                    {stockSignal.news.slice(0, 8).map((n: any, i: number) => (
                      <a key={`${n.url}-${i}`} href={n.url} target="_blank" rel="noopener noreferrer" className="block py-2.5 group">
                        <p className="text-[12px] font-medium text-foreground leading-snug group-hover:text-[#0D7490]">{n.headline}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{n.source}{n.timestamp ? ` · ${n.timestamp}` : ""}</p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No recent news available.</p>
                )}
              </div>
            </Card>

            {/* NSE insights */}
            {activeSelection.market === "nse" && nseInsights && (
              <Card className="border border-border shadow-sm">
                <div className="p-4">
                  <h2 className="text-sm font-semibold text-foreground">NSE Insights</h2>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Financial Health</p>
                      <p className={`mt-0.5 font-semibold ${nseInsights.financialHealth?.level === "good" ? "text-emerald-600" : nseInsights.financialHealth?.level === "watch" ? "text-amber-600" : "text-red-600"}`}>{nseInsights.financialHealth?.label || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Liquidity</p>
                      <p className="mt-0.5 font-semibold text-foreground">{nseInsights.liquidity?.label || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Next Earnings</p>
                      <p className="mt-0.5 font-semibold text-foreground">{nseInsights.earnings?.[0] ? `${nseInsights.earnings[0].daysUntil}d` : "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">FX (USD/KES)</p>
                      <p className="mt-0.5 font-semibold text-foreground">{nseInsights.fxRate || "—"}</p>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Top holders */}
            {holders.length > 0 && (
              <Card className="border border-border shadow-sm">
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Top Holders</h2>
                    <span className="text-[10px] text-muted-foreground">{holders.length} holders</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {holders.slice(0, 6).map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 border-b border-border/60 pb-1.5 text-[11px] last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{h.holder}</p>
                          <p className="text-[10px] text-muted-foreground">{h.pctHeld != null ? `${h.pctHeld.toFixed(1)}% held` : `${(h.shares || 0).toLocaleString()} shares`}</p>
                        </div>
                        <span className="shrink-0 font-semibold text-foreground">{h.value ? formatCompact(h.value) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </div>
          <aside className="space-y-4">
            <Card className="border border-border shadow-sm">
              <div className="p-4">
                <h2 className="text-sm font-semibold text-foreground">Key Stats</h2>
                <table className="mt-3 w-full text-[11px]">
                  <tbody>
                    {[
                      ...companySnapshot,
                      { label: "Forward PE", value: "—" },
                      { label: "Beta", value: "—" },
                      { label: "Analysts", value: "—" },
                      { label: "Price Target", value: "—" },
                      { label: "Est. Earnings", value: "—" },
                    ].map((item) => (
                      <tr key={item.label} className="border-t border-border/60 first:border-0">
                        <td className="py-1.5 text-muted-foreground">{item.label}</td>
                        <td className="py-1.5 text-right font-medium text-foreground">{item.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="border border-border shadow-sm">
              <div className="p-4">
                <h2 className="text-sm font-semibold text-foreground">Company Profile</h2>
                <div className="mt-2 space-y-1.5 text-[11px]">
                  <p className="font-medium text-foreground">{stockProfile?.companyName || displayName}</p>
                  <p className="text-muted-foreground">{stockProfile?.sector || activeSelection.sector}{stockProfile?.industry ? ` · ${stockProfile.industry}` : ""}</p>
                  <p className="text-muted-foreground">{stockProfile?.address || stockProfile?.country || ""}</p>
                  {stockProfile?.phone && <p className="text-muted-foreground">{stockProfile.phone}</p>}
                  {stockProfile?.website && (
                    <a href={stockProfile.website} target="_blank" rel="noopener noreferrer" className="text-[#0D7490] hover:underline break-all">{stockProfile.website}</a>
                  )}
                </div>
                <button onClick={() => setActiveTab("profile")} className="mt-3 text-xs font-medium text-[#0D7490] hover:underline">Full Company Profile →</button>
              </div>
            </Card>

            {/* StocksIntels analysis */}
            <Card className="relative overflow-hidden border border-border shadow-sm">
              <div className="h-1 w-full bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
              <div className="p-4">
                <h2 className="text-sm font-semibold text-foreground">StocksIntels Analysis</h2>
                {loadingData ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading analysis…</div>
                ) : stockSignal ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] to-[#0EA5E9]/[0.03] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-lg font-bold ${signalIsBullish ? "text-emerald-700" : signalIsBearish ? "text-red-600" : "text-amber-700"}`}>{displaySignal}</span>
                        <span className="text-xs font-semibold text-foreground">{displayConfidence}% conviction</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-[#0D7490]" style={{ width: `${displayConfidence}%` }} />
                      </div>
                      {stockSignal.reason && <p className="mt-2 text-[10px] leading-snug text-muted-foreground line-clamp-3">{stockSignal.reason}</p>}
                    </div>
                    {(stockSignal.entry != null || stockSignal.target1 != null) && (
                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        {[
                          ["Entry", stockSignal.entry],
                          ["Stop", stockSignal.stopLoss],
                          ["Target 1", stockSignal.target1],
                          ["Target 2", stockSignal.target2],
                        ].filter(([, v]) => v != null).map(([label, v]) => (
                          <div key={String(label)} className="rounded-lg border border-border bg-muted/40 p-2">
                            <p className="uppercase tracking-wider text-muted-foreground">{label}</p>
                            <p className="mt-0.5 font-semibold text-foreground">{curSym} {formatPrice(Number(v))}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <Link to={`/app/signals?ticker=${encodeURIComponent(activeSelection.ticker)}`} className="inline-flex text-xs font-medium text-[#0D7490] hover:underline">
                      Open full analysis →
                    </Link>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No StocksIntels analysis available for this listing yet.</p>
                )}
              </div>
            </Card>
          </aside>
        </div>
      )}

      {activeTab === "financials" && (
        <Card className="border border-border shadow-sm">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Financial Statements</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-2 pr-4">Period</th><th className="py-2 pr-4 text-right">Revenue</th><th className="py-2 pr-4 text-right">Gross Profit</th><th className="py-2 pr-4 text-right">Operating Income</th><th className="py-2 pr-4 text-right">Net Income</th><th className="py-2 text-right">EPS</th></tr>
                </thead>
                <tbody>
                  {fh.map((row: any, i: number) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-2 pr-4 font-medium text-foreground">{String(row.date || row.period || "").slice(0, 10)}</td>
                      <td className="py-2 pr-4 text-right">{formatCompact(row.revenue)}</td>
                      <td className="py-2 pr-4 text-right">{formatCompact(row.grossProfit)}</td>
                      <td className="py-2 pr-4 text-right">{formatCompact(row.operatingIncome)}</td>
                      <td className="py-2 pr-4 text-right">{formatCompact(row.netIncome)}</td>
                      <td className="py-2 text-right">{row.eps != null ? Number(row.eps).toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fh.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No financial statements available.</p>}
            </div>
          </div>
        </Card>
      )}

      {activeTab === "statistics" && (
        <Card className="border border-border shadow-sm">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Statistics</h2>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              {[
                ["Market Cap", money(fq?.marketCap || fk?.marketCap || liveQuote?.marketCap)],
                ["Revenue", money(fi?.revenue || fh[0]?.revenue)],
                ["Net Income", money(fi?.netIncome || fh[0]?.netIncome)],
                ["EPS", fq?.eps != null ? fq.eps.toFixed(2) : "—"],
                ["Shares Outstanding", fq?.sharesOutstanding ? formatCompact(fq.sharesOutstanding) : "—"],
                ["Float", fk?.floatShares ? formatCompact(fk.floatShares) : "—"],
                ["P/E Ratio", fq?.pe ? fq.pe.toFixed(2) : fk?.peRatio ? fk.peRatio.toFixed(2) : "—"],
                ["P/B Ratio", fk?.pbRatio ? fk.pbRatio.toFixed(2) : "—"],
                ["P/S Ratio", fk?.priceToSalesRatio ? fk.priceToSalesRatio.toFixed(2) : "—"],
                ["Debt / Equity", fk?.debtToEquity ? fk.debtToEquity.toFixed(2) : "—"],
                ["Current Ratio", fk?.currentRatio ? fk.currentRatio.toFixed(2) : "—"],
                ["Dividend Yield", pctOf(fk?.dividendYieldPercentage ?? fk?.dividendYield)],
                ["Payout Ratio", fk?.payoutRatio ? pctOf(fk.payoutRatio) : "—"],
                ["52-Week Range", fq?.yearLow || fq?.yearHigh ? `${formatPrice(fq?.yearLow)} – ${formatPrice(fq?.yearHigh)}` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-border/60 py-2 text-[11px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {activeTab === "statistics" && (
        <FinancialMetrics symbol={finSymbol} sector={activeSelection.sector} instrumentName={activeSelection.name} />
      )}

      {activeTab === "dividends" && (
        <Card className="border border-border shadow-sm">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Dividend History</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4 text-right">Dividend</th><th className="py-2 pr-4">Record Date</th><th className="py-2">Payment Date</th></tr>
                </thead>
                <tbody>
                  {(fr?.dividendHistory || []).map((d: any, i: number) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-2 pr-4 font-medium text-foreground">{String(d.date || "").slice(0, 10)}</td>
                      <td className="py-2 pr-4 text-right">{curSym} {formatPrice(d.dividend)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{d.recordDate ? String(d.recordDate).slice(0, 10) : "—"}</td>
                      <td className="py-2 text-muted-foreground">{d.paymentDate ? String(d.paymentDate).slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!fr?.dividendHistory || fr.dividendHistory.length === 0) && <p className="py-6 text-center text-xs text-muted-foreground">No dividend history available.</p>}
            </div>
          </div>
        </Card>
      )}

      {activeTab === "history" && (
        <Card className="border border-border shadow-sm">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-foreground">Price History</h2>
            <div className="mt-3 overflow-x-auto max-h-[520px]">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-2 pr-4">Date</th><th className="py-2 pr-4 text-right">Open</th><th className="py-2 pr-4 text-right">High</th><th className="py-2 pr-4 text-right">Low</th><th className="py-2 pr-4 text-right">Close</th><th className="py-2 text-right">Volume</th></tr>
                </thead>
                <tbody>
                  {chartData.slice().reverse().map((d: any, i: number) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-1.5 pr-4 font-medium text-foreground">{d.fullDate}</td>
                      <td className="py-1.5 pr-4 text-right">{formatPrice(d.open)}</td>
                      <td className="py-1.5 pr-4 text-right">{formatPrice(d.high)}</td>
                      <td className="py-1.5 pr-4 text-right">{formatPrice(d.low)}</td>
                      <td className="py-1.5 pr-4 text-right font-medium">{formatPrice(d.price)}</td>
                      <td className="py-1.5 text-right">{formatCompact(d.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {activeTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
          <Card className="border border-border shadow-sm">
            <div className="p-4">
              <h2 className="text-sm font-semibold text-foreground">{stockProfile?.companyName || displayName}</h2>
              {stockProfile?.description && <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{stockProfile.description}</p>}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 border-t border-border pt-4 text-xs">
                {[
                  { label: "Industry", value: stockProfile?.industry },
                  { label: "Sector", value: stockProfile?.sector || activeSelection.sector },
                  { label: "Employees", value: stockProfile?.employees ? Number(stockProfile.employees).toLocaleString() : null },
                  { label: "Country", value: stockProfile?.country },
                  { label: "Stock Exchange", value: stockProfile?.exchange },
                  { label: "Ticker Symbol", value: activeSelection.ticker },
                  { label: "CEO", value: stockProfile?.ceo },
                ].filter((x) => x.value).map((item) => (
                  <div key={item.label}>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
                    <p className="mt-0.5 font-medium text-foreground">{item.value}</p>
                  </div>
                ))}
                {stockProfile?.website && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Website</p>
                    <a href={stockProfile.website} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-medium text-[#0D7490] hover:underline break-all">
                      {stockProfile.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink className="size-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </Card>
          <Card className="border border-border shadow-sm">
            <div className="p-4">
              <h2 className="text-sm font-semibold text-foreground">Key Executives</h2>
              <div className="mt-2 space-y-2">
                {Array.isArray(stockProfile?.officers) && stockProfile.officers.length > 0 ? stockProfile.officers.map((o: any, i: number) => (
                  <div key={String(o.name) + '-' + i} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                    <p className="text-xs font-medium text-foreground">{o.name || "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{o.title || "—"}{o.yearBorn ? ` · born ${o.yearBorn}` : ""}</p>
                  </div>
                )) : <p className="text-xs text-muted-foreground">No executive data available.</p>}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

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
