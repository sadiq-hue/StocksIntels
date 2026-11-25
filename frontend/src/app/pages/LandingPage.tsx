import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Globe2,
  Landmark,
  LayoutGrid,
  LineChart,
  Mail,
  Menu,
  Newspaper,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  TrendingDown,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { fetchRealtimeQuotesBatch, type RealtimeStockQuote } from "../services/marketDataService";
import { useSEO } from "../hooks/useSEO";
import { PLANS, YEARLY_SAVINGS_LABEL, MONEY_BACK_GUARANTEE } from "../data/plans";

const MARKETING_PLANS = PLANS.filter((p) => ["core", "pro", "premium"].includes(p.id));

const API_URL = import.meta.env.VITE_API_URL || "/api";

const TICKER_SYMBOLS = [
  { symbol: "NSE:SCOM", name: "Safaricom PLC", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:EQTY", name: "Equity Group", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:KCB", name: "KCB Group", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:COOP", name: "Co-op Bank", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:ABSA", name: "ABSA Bank Kenya", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:NCBA", name: "NCBA Group", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:EABL", name: "East African Breweries", currency: "KES", exchange: "NSE" },
  { symbol: "NSE:BAT", name: "BAT Kenya", currency: "KES", exchange: "NSE" },
  { symbol: "AAPL", name: "Apple Inc.", currency: "$", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "Microsoft", currency: "$", exchange: "NASDAQ" },
  { symbol: "NVDA", name: "NVIDIA", currency: "$", exchange: "NASDAQ" },
  { symbol: "GOOGL", name: "Alphabet", currency: "$", exchange: "NASDAQ" },
  { symbol: "TSLA", name: "Tesla Inc.", currency: "$", exchange: "NASDAQ" },
  { symbol: "AMZN", name: "Amazon.com", currency: "$", exchange: "NASDAQ" },
  { symbol: "META", name: "Meta Platforms", currency: "$", exchange: "NASDAQ" },
  { symbol: "JSE:NPN", name: "Naspers Ltd", currency: "ZAR", exchange: "JSE" },
  { symbol: "JSE:FSR", name: "FirstRand", currency: "ZAR", exchange: "JSE" },
  { symbol: "JSE:SBK", name: "Standard Bank Group", currency: "ZAR", exchange: "JSE" },
  { symbol: "JSE:MTN", name: "MTN Group", currency: "ZAR", exchange: "JSE" },
  { symbol: "NGX:MTNN", name: "MTN Nigeria", currency: "NGN", exchange: "NGX" },
  { symbol: "NGX:DANGCEM", name: "Dangote Cement", currency: "NGN", exchange: "NGX" },
  { symbol: "NGX:ZENITHBANK", name: "Zenith Bank", currency: "NGN", exchange: "NGX" },
  { symbol: "NGX:GTCO", name: "Guaranty Trust Holding", currency: "NGN", exchange: "NGX" },
  { symbol: "GSE:MTNGH", name: "MTN Ghana", currency: "GHS", exchange: "GSE" },
  { symbol: "GSE:ETI", name: "Ecobank Transnational", currency: "GHS", exchange: "GSE" },
];

const HERO_SYMBOLS = TICKER_SYMBOLS.map((s) => s.symbol);

type Article = {
  id: string;
  title: string;
  summary?: string;
  source?: string;
  publishedAt?: string;
  slug?: string;
  url?: string;
};

const navItems = [
  { label: "Platform", href: "#platform" },
  { label: "Market Intelligence", href: "#intelligence" },
  { label: "Research & Analysts", href: "#human-expertise" },
  { label: "For Businesses", href: "#audiences" },
  { label: "Pricing", href: "#pricing" },
];

const intelligenceLayers = [
  { number: "01", title: "Computational", text: "Processes market, company and pricing information across the research workflow." },
  { number: "02", title: "Fundamental", text: "Examines business quality, valuation context and company performance." },
  { number: "03", title: "Technical", text: "Adds trend, momentum, volatility and market-structure evidence." },
  { number: "04", title: "Financial", text: "Interprets statements, cash generation, leverage and operating history." },
  { number: "05", title: "Macroeconomic", text: "Connects rates, inflation, currencies and growth conditions to markets." },
  { number: "06", title: "Sentiment & news", text: "Tracks corporate developments and the information shaping market attention." },
  { number: "07", title: "Human expertise", text: "Keeps research grounded in context, judgement and responsible interpretation." },
];

const capabilities = [
  { icon: FileText, label: "Fundamental analysis", text: "Company quality, valuation and business drivers." },
  { icon: LineChart, label: "Technical analysis", text: "Trend, momentum and volatility indicators." },
  { icon: BarChart3, label: "Financial performance", text: "Statements, ratios and reported operating history." },
  { icon: Globe2, label: "Macroeconomic context", text: "Rates, inflation, FX and economic conditions." },
  { icon: Newspaper, label: "News intelligence", text: "Corporate developments and relevant market reporting." },
  { icon: ShieldCheck, label: "Risk context", text: "Evidence quality, uncertainty and downside awareness." },
];

const exchanges = [
  { code: "NSE", city: "Nairobi", market: "Kenya" },
  { code: "NGX", city: "Lagos", market: "Nigeria" },
  { code: "JSE", city: "Johannesburg", market: "South Africa" },
  { code: "GSE", city: "Accra", market: "Ghana" },
  { code: "GLOBAL", city: "International", market: "Global equities" },
];

function useHeroQuotes() {
  const [quotes, setQuotes] = useState<Record<string, RealtimeStockQuote>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchRealtimeQuotesBatch(HERO_SYMBOLS);
        if (alive) {
          setQuotes(data);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return { quotes, error };
}

function findQuote(quotes: Record<string, RealtimeStockQuote>, symbol: string) {
  return quotes[symbol] || quotes[symbol.replace(/^NSE:/, "")] || null;
}

function quoteText(quote: RealtimeStockQuote | null, currency: string) {
  if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) return `${currency} --`;
  return `${currency} ${Number(quote.price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function changeText(quote: RealtimeStockQuote | null) {
  const change = Number(quote?.changePercent);
  if (!Number.isFinite(change)) return "--";
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`mb-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.24em] ${light ? "text-cyan-200" : "text-[#2563A6]"}`}>
      <span className={`h-px w-9 ${light ? "bg-cyan-300/60" : "bg-[#2563A6]/45"}`} />
      {children}
    </p>
  );
}

function FloatingStocksTicker({ quotes, error }: { quotes: Record<string, RealtimeStockQuote>; error: boolean }) {
  const [visibleIndices, setVisibleIndices] = useState<number[]>([0, 1, 2, 3, 4]);
  const [animating, setAnimating] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const intervalRef = useRef<number | null>(null);

  function computeMarketState(exchange: string, fallbackState?: string): "REGULAR" | "CLOSED" | "PRE" | "POST" {
    const now = new Date();
    if (exchange === "NASDAQ") {
      const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = etTime.getDay();
      const hour = etTime.getHours();
      const minute = etTime.getMinutes();
      const minutesSinceMidnight = hour * 60 + minute;
      const marketOpen = 9 * 60 + 30;
      const marketClose = 16 * 60;
      if (day >= 1 && day <= 5) {
        if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose) return "REGULAR";
        if (minutesSinceMidnight >= 4 * 60 && minutesSinceMidnight < marketOpen) return "PRE";
        if (minutesSinceMidnight >= marketClose && minutesSinceMidnight < 20 * 60) return "POST";
      }
      return "CLOSED";
    }
    if (exchange === "NSE") {
      const eatTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
      const day = eatTime.getDay();
      const hour = eatTime.getHours();
      const minute = eatTime.getMinutes();
      const minutesSinceMidnight = hour * 60 + minute;
      const marketOpen = 9 * 60 + 30;
      const marketClose = 15 * 60 + 30;
      if (day >= 1 && day <= 5) {
        if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose) return "REGULAR";
      }
      return "CLOSED";
    }
    if (exchange === "JSE") {
      const saTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
      const day = saTime.getDay();
      const hour = saTime.getHours();
      const minute = saTime.getMinutes();
      const minutesSinceMidnight = hour * 60 + minute;
      const marketOpen = 9 * 60;
      const marketClose = 17 * 60;
      if (day >= 1 && day <= 5) {
        if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose) return "REGULAR";
      }
      return "CLOSED";
    }
    if (exchange === "NGX") {
      const watTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
      const day = watTime.getDay();
      const hour = watTime.getHours();
      const minute = watTime.getMinutes();
      const minutesSinceMidnight = hour * 60 + minute;
      const marketOpen = 10 * 60;
      const marketClose = 14 * 60 + 30;
      if (day >= 1 && day <= 5) {
        if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose) return "REGULAR";
      }
      return "CLOSED";
    }
    if (exchange === "GSE") {
      const gmtTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Accra" }));
      const day = gmtTime.getDay();
      const hour = gmtTime.getHours();
      const minute = gmtTime.getMinutes();
      const minutesSinceMidnight = hour * 60 + minute;
      const marketOpen = 10 * 60;
      const marketClose = 15 * 60;
      if (day >= 1 && day <= 5) {
        if (minutesSinceMidnight >= marketOpen && minutesSinceMidnight < marketClose) return "REGULAR";
      }
      return "CLOSED";
    }
    return (fallbackState as "REGULAR" | "CLOSED" | "PRE" | "POST") || "CLOSED";
  }

  const getQuoteData = useCallback((symbol: string) => {
    const quote = findQuote(quotes, symbol);
    const tickerItem = TICKER_SYMBOLS.find((s) => s.symbol === symbol);
    const currency = tickerItem?.currency || "$";
    const exchange = tickerItem?.exchange || "";
    const change = Number(quote?.changePercent);
    const up = Number.isFinite(change) && change >= 0;
    const down = Number.isFinite(change) && change < 0;
    const apiMarketState = quote?.marketState;
    const computedMarketState = computeMarketState(exchange, apiMarketState);
    const marketState = (exchange === "NASDAQ" || exchange === "NSE" || exchange === "JSE" || exchange === "NGX" || exchange === "GSE") 
      ? computedMarketState 
      : apiMarketState;
    return {
      price: quoteText(quote, currency),
      change: changeText(quote),
      changePercent: change,
      up,
      down,
      hasData: Number.isFinite(change) && Number.isFinite(Number(quote?.price)),
      marketState,
    };
  }, [quotes]);

  const symbolsWithData = useMemo(() => {
    return TICKER_SYMBOLS.filter((item) => {
      const data = getQuoteData(item.symbol);
      return data.hasData;
    });
  }, [quotes, getQuoteData]);

  const totalSymbols = symbolsWithData.length;
  const visibleCount = Math.min(5, totalSymbols);

  const scrollTicker = useCallback(() => {
    if (animating || totalSymbols <= visibleCount || isHovered) return;
    setAnimating(true);
    setVisibleIndices((prev) => {
      const next = prev.map((i) => (i + 1) % totalSymbols);
      setTimeout(() => setAnimating(false), 600);
      return next;
    });
  }, [animating, totalSymbols, visibleCount, isHovered]);

  useEffect(() => {
    if (totalSymbols <= visibleCount) return;
    intervalRef.current = window.setInterval(scrollTicker, 3000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [scrollTicker, totalSymbols, visibleCount, isHovered]);

  const visibleSymbols = visibleIndices.map((idx) => symbolsWithData[idx]).filter(Boolean);

  // Light theme colors
  const bgPrimary = "bg-white";
  const bgSecondary = "bg-gray-50";
  const bgHover = "bg-gray-50";
  const borderColor = "border-gray-200";
  const borderHover = "border-gray-300";
  const textPrimary = "text-gray-900";
  const textSecondary = "text-gray-600";
  const textMuted = "text-gray-400";
  const accentBlue = "text-blue-600";
  const accentBlueBg = "bg-blue-50";
  const accentBlueBorder = "border-blue-200";
  const accentOrange = "text-orange-600";
  const accentOrangeBg = "bg-orange-50";
  const accentOrangeBorder = "border-orange-200";
  const positiveBg = "bg-green-50";
  const positiveText = "text-green-700";
  const negativeBg = "bg-red-50";
  const negativeText = "text-red-700";
  const neutralBg = "bg-gray-100";
  const neutralText = "text-gray-600";
  const accentBlueText = "text-blue-600";
  const accentBlueBg2 = "bg-blue-50";
  const streamingColor = "text-blue-600";
  const streamingBg = "bg-blue-50";
  const liveIndicator = "bg-green-500";

  if (totalSymbols === 0) {
    return (
      <div className="relative mx-auto w-full max-w-[720px]" aria-label="Live market ticker">
        <div className="relative overflow-hidden rounded-[1.5rem] border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 items-center justify-center">
                <span className="absolute size-full rounded-full bg-green-500 animate-ping opacity-75" />
                <span className="relative size-1.5 rounded-full bg-green-500" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Live Market Stream</span>
            </div>
            <span className="font-mono text-[10px] font-semibold text-gray-600">REAL-TIME QUOTES</span>
          </div>
          <div className="overflow-hidden h-80 sm:h-[400px] flex items-center justify-center">
            <p className="text-gray-500 text-sm">No live quote data available at the moment</p>
          </div>
          <div className="border-t border-gray-200 px-4 py-3 sm:px-6 bg-gray-50">
            <div className="flex items-center justify-between gap-4 text-[10px]">
              <span className="text-gray-500">Waiting for market data...</span>
<div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                <span className="absolute size-full rounded-full bg-amber-500 animate-ping opacity-75" />
                <span className="relative size-1 rounded-full bg-amber-500" />
              </span>
              <span className="font-mono font-semibold text-amber-700">STREAMING</span>
            </div>
            </div>
          </div>
          {error && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-3 sm:px-6">
              <p className="text-[10px] text-red-600">Quote feed temporarily unavailable.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[720px]" aria-label="Live market ticker">
      <div className="relative overflow-hidden rounded-[1.5rem] border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 bg-gray-50">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 items-center justify-center">
              <span className="absolute size-full rounded-full bg-green-500 animate-ping opacity-75" />
              <span className="relative size-1.5 rounded-full bg-green-500" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Live Market Stream</span>
          </div>
          <span className="font-mono text-[10px] font-semibold text-gray-600">REAL-TIME QUOTES</span>
        </div>

        <div
          className="overflow-hidden h-80 sm:h-[400px] relative"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div
            className={`transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${animating ? "-translate-y-20" : ""}`}
            style={{ transform: animating ? "translateY(-80px)" : "translateY(0)" }}
          >
            <div className="grid grid-rows-[repeat(5,1fr)]">
              {visibleSymbols.map((item, rowIndex) => {
                const data = getQuoteData(item.symbol);
                const delay = rowIndex * 80;
                return (
                  <div
                    key={`${item.symbol}-${rowIndex}`}
                    className={`relative flex items-center justify-between px-4 py-3 border-b border-gray-200 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-gray-50 hover:scale-[1.01] ${
                      rowIndex === 0 ? "bg-gray-50 backdrop-blur-sm shadow-sm z-10 scale-[1.02] border-l-2 border-blue-500" : ""
                    } ${rowIndex === 4 ? "border-0" : ""}`}
                    style={{
                      transformOrigin: "center",
                      animationDelay: `${delay}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div className="flex flex-col items-start justify-center min-w-[70px]">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-blue-600">{item.exchange}</span>
                        <span className="font-mono text-[11px] font-semibold text-gray-900">{item.symbol.replace(/^NSE:|^JSE:|^NGX:|^GSE:/, "")}</span>
                      </div>
                      <div className="min-w-0 flex-1 border-l border-gray-200 pl-4">
                        <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.1em] text-gray-500">{item.exchange} • {data.marketState === "REGULAR" ? "Live" : data.marketState === "CLOSED" ? "Closed" : "Delayed"}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 min-w-[140px] text-right">
                      <span className="font-mono text-lg font-semibold tabular-nums text-gray-900">
                        {data.hasData ? data.price : <span className="text-gray-400">--</span>}
                      </span>
                      {data.hasData && (
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                            data.up ? "bg-green-50 text-green-700" : data.down ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {data.up && <TrendingUp className="size-3" />}
                          {data.down && <TrendingDown className="size-3" />}
                          {data.change}
                        </span>
                      )}
                      {!data.hasData && <span className="text-[10px] text-gray-400">No data</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />
        </div>

        <div className="border-t border-gray-200 px-4 py-3 sm:px-6 bg-gray-50">
          <div className="flex items-center justify-end gap-4 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5 items-center justify-center">
                <span className="absolute size-full rounded-full bg-amber-500 animate-ping opacity-75" />
                <span className="relative size-1 rounded-full bg-amber-500" />
              </span>
              <span className="font-mono font-semibold text-amber-700">STREAMING</span>
            </div>
          </div>
        </div>
        {error && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-3 sm:px-6">
            <p className="text-[10px] text-red-600">Quote feed temporarily unavailable. Showing cached data where available.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LandingPage() {
  useSEO({
    title: "StocksIntels | Financial Market Intelligence for Africa & Global Markets",
    absoluteTitle: true,
    description: "Discover StocksIntels, a Super Intelligence-powered financial research platform combining market analysis, company financials, investment insights and human analyst expertise across African and global equity markets.",
    canonical: "/",
    keywords: "financial market intelligence, African equity markets, global equity markets, company financials, investment research, Super Intelligence, StocksIntels",
  });

  const { quotes, error: quoteError } = useHeroQuotes();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [yearlyPricing, setYearlyPricing] = useState(true);

  const handleMonthlyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Monthly clicked');
    setYearlyPricing(false);
  };
  const handleYearlyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Yearly clicked');
    setYearlyPricing(true);
  };
  const [articles, setArticles] = useState<Article[]>([]);
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [contactSending, setContactSending] = useState(false);
  const [contactStatus, setContactStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  useEffect(() => {
    fetch(`${API_URL}/market-intel?limit=3`)
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setArticles(Array.isArray(data) ? data.slice(0, 3) : []))
      .catch(() => setArticles([]));
  }, []);

  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setContactStatus(null);
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      setContactStatus({ type: "error", message: "Please complete your name, email and message." });
      return;
    }
    setContactSending(true);
    try {
      const response = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to send message");
      setContactStatus({ type: "success", message: "Message received. Our team will follow up." });
      setContactForm({ name: "", email: "", subject: "", message: "" });
    } catch (error) {
      setContactStatus({ type: "error", message: error instanceof Error ? error.message : "Unable to send message" });
    } finally {
      setContactSending(false);
    }
  };

  return (
    <div className="si-landing min-h-screen overflow-x-hidden bg-[#F5F8FC] text-[#202B3A] selection:bg-[#4386C8]/25">
      <header className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${scrolled || mobileOpen ? "border-[#DCE5F0] bg-[#F5F8FC]/95 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link to="/" className="flex items-center gap-3" aria-label="StocksIntels home">
            <img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" />
            <div>
              <span className="block text-sm font-extrabold tracking-[-0.02em] text-[#102B50]">StocksIntels</span>
              <span className="block text-[8px] font-bold uppercase tracking-[0.24em] text-[#2563A6]">Financial Intelligence</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary navigation">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-[13px] font-semibold text-[#405168] transition-colors hover:text-[#174A7E]">{item.label}</a>
            ))}
            <Link to="/about" className="text-[13px] font-semibold text-[#405168] transition-colors hover:text-[#174A7E]">About</Link>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Button asChild variant="ghost" className="text-sm text-[#174A7E]"><Link to="/login">Sign in</Link></Button>
            <Button asChild className="rounded-full bg-[#2563A6] px-5 text-sm text-white hover:bg-[#174A7E]"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
          </div>

          <button
            type="button"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-nav"
            onClick={() => setMobileOpen((open) => !open)}
            className="grid size-10 place-items-center rounded-full border border-[#D7E1EC] bg-white text-[#102B50] lg:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {mobileOpen && (
          <nav id="landing-mobile-nav" className="max-h-[calc(100vh-72px)] overflow-y-auto border-t border-[#DCE5F0] bg-[#F5F8FC] px-5 py-6 lg:hidden" aria-label="Mobile navigation">
            <div className="mx-auto flex max-w-2xl flex-col gap-1">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-4 py-3 text-sm font-semibold text-[#24364C] hover:bg-white">{item.label}</a>
              ))}
              <Link to="/about" onClick={() => setMobileOpen(false)} className="rounded-xl px-4 py-3 text-sm font-semibold text-[#24364C] hover:bg-white">About</Link>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button asChild variant="outline" className="border-[#BFCFE1] bg-white text-[#174A7E]"><Link to="/login">Sign in</Link></Button>
                <Button asChild className="bg-[#2563A6] text-white"><Link to="/login">Explore</Link></Button>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#F5F8FC] pb-20 pt-32 sm:pb-28 sm:pt-40">
          <div className="si-grid absolute inset-0 opacity-55" />
          <div className="absolute right-[-18%] top-[-20%] size-[700px] rounded-full bg-[#4386C8]/10 blur-[130px]" />
          <div className="relative mx-auto grid max-w-[1440px] items-center gap-16 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:px-12">
            <div className="max-w-[650px]">
              <h1 className="si-display max-w-[720px] text-[3.5rem] font-medium leading-[0.93] tracking-[-0.045em] text-[#102B50] sm:text-[4.8rem] lg:text-[5.65rem]">
                See the markets <span className="text-[#2563A6]">beyond</span> the numbers.
              </h1>
              <p className="mt-8 max-w-[600px] text-base leading-7 text-[#52647A] sm:text-lg sm:leading-8">
                StocksIntels combines Super Intelligence, multi-dimensional financial analysis and human expertise to bring greater clarity to African and global markets.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#2563A6] px-7 text-sm text-white hover:bg-[#174A7E]"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-[#B9CAE0] bg-white/65 px-7 text-sm text-[#174A7E] hover:bg-white"><a href="#intelligence">Discover our intelligence</a></Button>
              </div>
              <div className="mt-10 grid max-w-[560px] grid-cols-1 gap-3 border-t border-[#D8E2ED] pt-6 text-xs text-[#52647A] sm:grid-cols-3">
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> African market depth</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> Global exposure</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> Evidence-led research</span>
              </div>
            </div>
            <FloatingStocksTicker quotes={quotes} error={quoteError} />
          </div>
        </section>

        <section id="intelligence" className="scroll-mt-24 relative overflow-hidden bg-[#102B50] py-20 text-white sm:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,166,0.15),transparent_60%)]" />
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 sm:px-8 lg:grid-cols-[.75fr_1.25fr] lg:px-12">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionLabel light>Super Intelligence</SectionLabel>
              <h2 className="si-display text-4xl leading-[1.02] tracking-[-0.035em] text-white sm:text-6xl">More than data. More than conventional analysis.</h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-slate-300">
                SI is the StocksIntels philosophy: combine complementary forms of intelligence into one coherent research experience. It is not a claim of artificial superintelligence.
              </p>
              <div className="mt-10 flex items-center gap-5 border-t border-white/15 pt-6">
                <div className="si-display text-6xl text-cyan-200">SI</div>
                <p className="max-w-[240px] text-xs leading-5 text-slate-400">Technology, analysis and human judgement working in concert.</p>
              </div>
            </div>
            <div className="space-y-1">
              {intelligenceLayers.map((layer, i) => (
                <div key={layer.number} className="group relative rounded-xl border border-white/5 bg-white/[0.02] p-5 sm:p-6 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-300 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex items-start gap-4 sm:flex-row sm:items-center">
                    <span className="font-mono text-[10px] tracking-[0.2em] text-cyan-300/70 shrink-0 w-[60px]">{layer.number}</span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-white transition-colors group-hover:text-cyan-200">{layer.title}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-slate-300">{layer.text}</p>
                    </div>
                    <ChevronRight className="size-5 text-cyan-300/50 group-hover:text-cyan-200 group-hover:translate-x-1 transition-all shrink-0 mt-1 sm:mt-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="scroll-mt-24 bg-white py-20 sm:py-28">
          {/* Narrower container for text focus */}
          <div className="mx-auto max-w-[1100px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
              <div>
                <SectionLabel>Multi-dimensional intelligence</SectionLabel>
                <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">One company. Multiple analytical perspectives.</h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-[#607187] lg:justify-self-end">
                Financial markets do not resolve into a single score. StocksIntels helps users inspect the evidence across company fundamentals, statements, price behaviour, macro conditions and current developments.
              </p>
            </div>

            <div className="mt-14 grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-8">
              {/* Featured capability - larger */}
              <article className="relative lg:col-span-1 group p-8 rounded-2xl border border-[#2563A6]/20 bg-gradient-to-br from-[#2563A6]/5 via-white to-white hover:border-[#2563A6]/40 hover:shadow-xl hover:shadow-[#2563A6]/10 transition-all duration-500 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#2563A6]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative z-10">
                  <div className="flex items-start justify-between mb-6">
                    <div className="size-16 rounded-2xl bg-gradient-to-br from-[#2563A6] to-[#174A7E] flex items-center justify-center">
                      <FileText className="size-8 text-white" />
                    </div>
                    <span className="font-mono text-[10px] text-[#9AA9BA]">01</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-[#102B50] mb-4">{capabilities[0].label}</h3>
                  <p className="text-lg text-[#607187] leading-relaxed mb-8 pr-4">{capabilities[0].text}</p>
                  <ul className="space-y-3 text-[#607187]">
                    {[
                      "Company quality, valuation and business drivers",
                      "Revenue predictability and margin trajectory analysis",
                      "Competitive positioning and moat assessment",
                      "Capital allocation and shareholder return tracking"
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-3 group">
                        <div className="size-6 rounded-lg bg-[#2563A6]/10 flex items-center justify-center group-hover:bg-[#2563A6]/20 transition-colors shrink-0">
                          <CheckCircle2 className="size-3 text-[#2563A6]" />
                        </div>
                        <span className="text-base leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" className="mt-8 w-full rounded-full border-[#2563A6] text-[#2563A6] hover:bg-[#2563A6]/5"><Link to="/app/financials">Explore fundamental analysis <ArrowRight className="size-4" /></Link></Button>
                </div>
              </article>

              {/* Secondary capabilities - 2 column grid */}
              <div className="grid gap-4 md:grid-cols-2">
                {capabilities.slice(1).map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.label} className="group relative p-6 rounded-2xl border border-[#DCE5EF] bg-gradient-to-br from-white to-[#F5F8FC] hover:border-[#2563A6]/30 hover:shadow-lg hover:shadow-[#2563A6]/5 hover:-translate-y-1 transition-all duration-300 overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-tr from-[#2563A6]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex items-start justify-between relative z-10">
                        <div className="size-12 rounded-xl bg-[#2563A6]/10 flex items-center justify-center group-hover:bg-[#2563A6]/20 transition-colors">
                          <Icon className="size-6 text-[#2563A6]" />
                        </div>
                        <span className="font-mono text-[10px] text-[#9AA9BA]">0{index + 2}</span>
                      </div>
                      <h3 className="mt-6 text-lg font-semibold text-[#102B50] relative z-10">{item.label}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#607187] relative z-10">{item.text}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Breather: Full-bleed visual break */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#102B50] via-[#0E2542] to-[#0B1D3A] py-20 sm:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(37,99,166,0.15),transparent_70%)]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 36v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 6V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#102B50] via-[#0E2542] to-[#0B1D3A]" />
          <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-3xl mx-auto">
              <SectionLabel light>One platform</SectionLabel>
              <h2 className="si-display mt-4 text-4xl leading-[1.03] tracking-[-0.035em] text-white sm:text-6xl">African markets. Global context. One intelligence.</h2>
              <p className="mt-5 text-lg leading-7 text-slate-300 max-w-2xl mx-auto">StocksIntels unifies African market depth with global perspective in a single research workspace.</p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-sm font-medium border border-white/10">
                  <Globe2 className="size-4" /> 5 African Exchanges
                </span>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-sm font-medium border border-white/10">
                  <TrendingUp className="size-4" /> Global Coverage
                </span>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-white/80 text-sm font-medium border border-white/10">
                  <Zap className="size-4" /> Real-time Intelligence
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="human-expertise" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <SectionLabel>Technology + human expertise</SectionLabel>
            <h2 className="si-display max-w-4xl text-4xl leading-[1.04] tracking-[-0.035em] text-[#102B50] sm:text-6xl">Intelligence enhanced by technology. Strengthened by human expertise.</h2>
            <div className="mt-14 grid overflow-hidden rounded-[1.5rem] border border-[#D7E1EC] lg:grid-cols-2">
              <article className="bg-[#102B50] p-8 text-white sm:p-12">
                <Cpu className="size-6 text-cyan-300" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">Advanced technology</p>
                <h3 className="mt-4 text-2xl font-semibold">Built to process complexity.</h3>
                <p className="mt-5 text-sm leading-7 text-slate-300">Technology helps organize financial information, identify analytical patterns and support research across multiple market factors.</p>
              </article>
              <article className="bg-[#F9F5EC] p-8 sm:p-12">
                <Users className="size-6 text-[#B1822C]" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-[#9B732B]">Human judgement</p>
                <h3 className="mt-4 text-2xl font-semibold text-[#3C3427]">Context still matters.</h3>
                <p className="mt-5 text-sm leading-7 text-[#675B49]">Human expertise contributes qualitative context, market judgement and responsible interpretation. Not every automated output is manually reviewed.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#102B50] py-20 text-white sm:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(37,99,166,0.1),transparent_60%)]" />
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
              <div>
                <SectionLabel light>African + global</SectionLabel>
                <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] sm:text-6xl">African market intelligence. Global perspective.</h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-slate-300 lg:justify-self-end">A platform designed around African market relevance, with the international context investors and institutions use to understand capital, sectors and companies.</p>
            </div>
            <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {exchanges.map((exchange) => (
                <div key={exchange.code} className="group relative rounded-xl border border-white/10 bg-white/[0.02] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-all">
                  <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex flex-col items-start gap-1">
                    <span className="font-mono text-sm font-bold tracking-[0.14em] text-cyan-200">{exchange.code}</span>
                    <span className="text-sm text-slate-200">{exchange.city}</span>
                    <span className="text-xs text-slate-400">{exchange.market}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="audiences" className="scroll-mt-24 relative overflow-hidden bg-white py-20 sm:py-28">
          <div className="absolute inset-0 bg-gradient-to-b from-[#2563A6]/5 via-transparent to-transparent" />
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <SectionLabel>Who we serve</SectionLabel>
              <h2 className="si-display mt-4 text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">One intelligence foundation. Two paths forward.</h2>
              <p className="mt-4 text-lg leading-7 text-[#607187]">Whether you're investing your own capital or managing institutional workflows, the same evidence base powers your decisions.</p>
            </div>
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
              {/* Featured: Investors - larger, more prominent */}
              <article className="relative lg:col-span-1 group p-8 sm:p-10 rounded-2xl border border-[#2563A6]/20 bg-gradient-to-br from-[#2563A6]/5 via-white to-white hover:border-[#2563A6]/40 hover:shadow-xl hover:shadow-[#2563A6]/10 transition-all duration-500 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#2563A6]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="size-16 rounded-2xl bg-gradient-to-br from-[#2563A6] to-[#174A7E] flex items-center justify-center">
                      <Search className="size-8 text-white" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#2563A6]">Investors & market participants</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-[#102B50] mb-4">Research with more context.</h3>
                  <p className="text-lg text-[#607187] leading-relaxed mb-8 pr-4">Access multi-dimensional company research, fundamental and technical evidence, portfolio tools, and market intelligence across African and global markets—all in one workspace.</p>
                  <ul className="space-y-4 text-[#607180] mb-8">
                    {[
                      { icon: FileText, text: "Company and financial analysis with multi-factor scoring" },
                      { icon: LineChart, text: "Fundamental and technical evidence with visual evidence trails" },
                      { icon: LayoutGrid, text: "Watchlists, portfolios and paper trading with live P&L" },
                      { icon: Globe2, text: "Market intelligence across African and global regions" },
                    ].map((item, i) => (
                      <li key={i} className="flex items-start gap-3 group">
                        <div className="size-10 rounded-xl bg-[#2563A6]/10 flex items-center justify-center group-hover:bg-[#2563A6]/20 transition-colors shrink-0">
                          <item.icon className="size-5 text-[#2563A6]" />
                        </div>
                        <span className="text-base leading-relaxed text-[#607187]">{item.text}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="w-full rounded-full bg-[#2563A6] px-6 text-white hover:bg-[#174A7E]"><Link to="/login">Explore the platform <ArrowRight className="size-4" /></Link></Button>
                </div>
              </article>

              {/* Secondary: Businesses - compact card */}
              <article className="relative rounded-2xl border border-[#D5E0EB] bg-gradient-to-br from-[#F2F6FA] to-white p-8 sm:p-10 hover:border-[#174A7E]/30 hover:shadow-xl hover:shadow-[#174A7E]/5 transition-all duration-300 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-[#174A7E]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-center gap-3 mb-6">
                  <div className="size-12 rounded-xl bg-[#174A7E]/10 flex items-center justify-center">
                    <Building2 className="size-6 text-[#174A7E]" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#174A7E]">Businesses & financial institutions</p>
                </div>
                <h3 className="text-2xl font-semibold text-[#102B50] mb-4">Intelligence for research workflows.</h3>
                <p className="text-base text-[#607187] leading-relaxed mb-6">Embed our intelligence into your research workflows, risk models, and client reporting with flexible API access and data feeds.</p>
                <ul className="space-y-2 text-sm text-[#566A80] mb-6">
                  {[
                    "Market and company intelligence via API",
                    "Research and analytical support",
                    "Financial information infrastructure",
                    "Integration conversations where supported",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-[#16A085] shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" className="w-full rounded-full border-[#AFC2D8] bg-white px-6 text-[#174A7E] hover:bg-[#F2F6FA]"><a href="#contact">Discuss your needs <ArrowRight className="size-4" /></a></Button>
              </article>
            </div>
          </div>
        </section>

        {/* Breather: Full-bleed before pricing */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#0B1D3A] via-[#0F2644] to-[#142D4E] py-20 sm:py-24">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(37,99,166,0.1),transparent_60%)]" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 36v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 6V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B1D3A] via-[#0F2644] to-[#142D4E]" />
          <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-3xl mx-auto">
              <SectionLabel light>Transparent pricing</SectionLabel>
              <h2 className="si-display mt-4 text-4xl leading-[1.03] tracking-[-0.035em] text-white sm:text-6xl">Simple, transparent pricing. No surprises.</h2>
              <p className="mt-5 text-lg leading-7 text-slate-300 max-w-2xl mx-auto">Three tiers. Monthly or yearly. All features included. Cancel anytime.</p>
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 relative overflow-hidden bg-gradient-to-b from-[#F5F8FC] via-white to-[#F5F8FC] py-20 sm:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,166,0.05),transparent_60%)]" />
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 lg:px-12">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <div>
                <SectionLabel>Access StocksIntels</SectionLabel>
                <h2 className="si-display max-w-3xl text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">Choose the depth of intelligence you need.</h2>
                <p className="mt-6 max-w-2xl text-sm leading-6 text-[#607187]">One platform, three levels of research depth. Trial access begins after the $1 commitment fee.</p>
              </div>
              <div className="inline-flex w-fit rounded-full border border-[#C8D6E5] bg-white p-1 relative z-10" aria-label="Pricing period">
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); console.log('Monthly clicked'); setYearlyPricing(false); }} className={`rounded-full px-5 py-2 text-xs font-semibold transition-colors cursor-pointer pointer-events-auto select-none z-10 ${!yearlyPricing ? "bg-[#102B50] text-white" : "text-[#607187]"}`}>Monthly</button>
                <button type="button" onClick={handleYearlyClick} className={`rounded-full px-5 py-2 text-xs font-semibold transition-colors pointer-events-auto ${yearlyPricing ? "bg-[#102B50] text-white" : "text-[#607187]"}`}>Yearly <span className="ml-1 text-[#D5A64A]">{YEARLY_SAVINGS_LABEL}</span></button>
              </div>
            </div>

            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              {MARKETING_PLANS.map((plan) => {
                const featured = plan.popular;
                const premium = plan.id === "premium";
                const price = yearlyPricing ? plan.yearlyPrice : plan.monthlyPrice;
                const cardBase = "relative flex min-h-[520px] flex-col overflow-hidden rounded-[1.5rem] border p-7 sm:p-8 group";
                const cardFeatured = "border-[#174A7E] bg-gradient-to-br from-[#102B50] via-[#0E2542] to-[#102B50] text-white shadow-[0_30px_65px_-45px_rgba(16,43,80,0.9)]";
                const cardDefault = "border-[#D5E0EB] bg-white text-[#102B50] hover:border-[#2563A6]/30 hover:shadow-xl hover:shadow-[#2563A6]/5 hover:-translate-y-1";
                const topBarFeatured = "bg-gradient-to-r from-[#56A6C8] to-[#D5A64A]";
                const topBarPremium = "bg-[#D5A64A]";
                const topBarDefault = "bg-gradient-to-r from-[#4386C8] to-[#2563A6]";
                const labelFeatured = "text-cyan-200";
                const labelPremium = "text-[#D5A64A]";
                const labelDefault = "text-[#2563A6]";
                const taglineFeatured = "text-slate-300";
                const taglineDefault = "text-[#607187]";
                const badgeFeatured = "bg-white/10 text-cyan-200";
                const badgePremium = "bg-[#D5A64A]/15 text-[#9B732B]";
                const badgeDefault = "bg-[#2563A6]/10 text-[#2563A6]";
                const pricePeriodFeatured = "text-slate-400";
                const pricePeriodDefault = "text-[#718196]";
                const guaranteeFeatured = "text-slate-400";
                const guaranteeDefault = "text-[#8190A2]";
                const highlightFeatured = "text-slate-200";
                const highlightDefault = "text-[#52647A]";
                const checkFeatured = premium ? "text-[#D5A64A]" : "text-[#16A085]";
                const checkDefault = "text-[#16A085]";
                const btnFeatured = "bg-white text-[#102B50] hover:bg-cyan-50";
                const btnPremium = "bg-[#D5A64A] text-[#2F291F] hover:bg-[#C69941]";
                const btnDefault = "bg-[#2563A6] text-white hover:bg-[#174A7E]";
                return (
                  <article key={plan.id} className={`${cardBase} ${featured ? cardFeatured : cardDefault}`} style={{ transition: "all 0.3s ease" }}>
                    <div className={`absolute inset-x-0 top-0 h-1 ${premium ? topBarPremium : featured ? topBarFeatured : topBarDefault}`} />
                    <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-[1.5rem]" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${featured ? labelFeatured : premium ? labelPremium : labelDefault}`}>{featured ? "Most selected" : "StocksIntels"}</p>
                        <h3 className="mt-4 text-2xl font-bold">{plan.name}</h3>
                        <p className={`mt-2 text-sm ${featured ? taglineFeatured : taglineDefault}`}>{plan.tagline}</p>
                      </div>
                      <span className={`grid size-10 place-items-center rounded-full font-mono text-[10px] font-bold ${featured ? badgeFeatured : premium ? badgePremium : badgeDefault}`}>{plan.name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="mt-9 border-b border-current/10 pb-7">
                      <div className="flex items-end gap-2">
                        <span className="font-mono text-4xl font-semibold tabular-nums">${yearlyPricing ? price.toFixed(0) : price.toFixed(2)}</span>
                        <span className={`pb-1 text-xs ${featured ? pricePeriodFeatured : pricePeriodDefault}`}>/{yearlyPricing ? "year" : "month"}</span>
                      </div>
                      <p className={`mt-3 text-[10px] ${featured ? guaranteeFeatured : guaranteeDefault}`}>{MONEY_BACK_GUARANTEE}</p>
                    </div>
                    <ul className="mt-7 flex-1 space-y-3">
                      {plan.highlights.map((highlight) => (
                        <li key={highlight} className={`flex gap-3 text-sm ${featured ? highlightFeatured : highlightDefault}`}><CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${premium ? checkFeatured : checkDefault}`} />{highlight}</li>
                      ))}
                    </ul>
                    <Button asChild className={`mt-9 h-11 rounded-full ${featured ? btnFeatured : premium ? btnPremium : btnDefault}`}><Link to="/pricing">View {plan.name} <ArrowRight className="size-4" /></Link></Button>
                  </article>
                );
              })}
            </div>
            <div className="mt-7 flex flex-col justify-between gap-3 text-xs text-[#718196] sm:flex-row"><span>All prices are billed in USD.</span><Link to="/pricing" className="font-semibold text-[#174A7E]">Compare every feature <ArrowRight className="ml-1 inline size-3" /></Link></div>
          </div>
        </section>

        {articles.length > 0 && (
          <section className="bg-[#EDF3F9] py-20 sm:py-24">
            <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
                <div>
                  <SectionLabel>Current intelligence</SectionLabel>
                  <h2 className="si-display text-4xl tracking-[-0.03em] text-[#102B50] sm:text-5xl">Developments shaping the market.</h2>
                </div>
                <Link to="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-[#174A7E]">View research & insights <ArrowRight className="size-4" /></Link>
              </div>
              <div className="mt-12 divide-y divide-[#CFDBE8] border-y border-[#CFDBE8]">
                {articles.map((article, index) => {
                  const href = article.url || (article.slug ? `https://mystocks.africa/market-intel/${article.slug}` : "/blog");
                  return (
                    <a key={article.id || index} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined} className="group grid gap-4 py-7 sm:grid-cols-[100px_1fr_auto] sm:items-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8192A6]">{article.source || "Market intelligence"}</span>
                      <div>
                        <h3 className="text-base font-semibold text-[#102B50] transition-colors group-hover:text-[#2563A6]">{article.title}</h3>
                        {article.summary && <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#607187]">{article.summary}</p>}
                      </div>
                      <ExternalLink className="size-4 text-[#8294A8] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section id="contact" className="scroll-mt-24 bg-[#F5F8FC] py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 sm:px-8 lg:grid-cols-[.85fr_1.15fr] lg:px-12">
            <div>
              <SectionLabel>Contact StocksIntels</SectionLabel>
              <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">Start a more intelligent market conversation.</h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-[#607187]">Talk to us about the platform, financial research workflows, business enquiries or supported integrations.</p>
              <div className="mt-10 space-y-4 text-sm text-[#52647A]">
                <a href="mailto:support@stocksintels.com" className="flex items-center gap-3 hover:text-[#174A7E]"><Mail className="size-4 text-[#2563A6]" /> support@stocksintels.com</a>
                <a href="tel:+254792754435" className="flex items-center gap-3 hover:text-[#174A7E]"><Phone className="size-4 text-[#2563A6]" /> +254 792 754 435</a>
                <p className="flex items-center gap-3"><Landmark className="size-4 text-[#2563A6]" /> Nairobi, Kenya</p>
                <p className="flex items-center gap-3"><Landmark className="size-4 text-[#D5A64A]" /> Delaware, United States</p>
              </div>
            </div>

            <form onSubmit={submitContact} className="rounded-3xl border border-[#D7E1EC] bg-white p-6 shadow-[0_25px_60px_-48px_rgba(16,43,80,0.8)] sm:p-9">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-xs font-semibold text-[#3A4C62]">Name
                  <input value={contactForm.name} onChange={(event) => setContactForm((form) => ({ ...form, name: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" autoComplete="name" />
                </label>
                <label className="text-xs font-semibold text-[#3A4C62]">Email
                  <input type="email" value={contactForm.email} onChange={(event) => setContactForm((form) => ({ ...form, email: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" autoComplete="email" />
                </label>
              </div>
              <label className="mt-5 block text-xs font-semibold text-[#3A4C62]">Subject
                <input value={contactForm.subject} onChange={(event) => setContactForm((form) => ({ ...form, subject: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" />
              </label>
              <label className="mt-5 block text-xs font-semibold text-[#3A4C62]">Message
                <textarea value={contactForm.message} onChange={(event) => setContactForm((form) => ({ ...form, message: event.target.value }))} className="mt-2 min-h-32 w-full resize-y rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 py-3 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" />
              </label>
              {contactStatus && <p role="status" className={`mt-4 text-xs ${contactStatus.type === "success" ? "text-emerald-700" : "text-rose-600"}`}>{contactStatus.message}</p>}
              <Button type="submit" disabled={contactSending} className="mt-6 h-11 w-full rounded-full bg-[#2563A6] text-white hover:bg-[#174A7E]">{contactSending ? "Sending..." : "Send enquiry"} <ArrowRight className="size-4" /></Button>
            </form>
          </div>
        </section>

        <section className="bg-[#174A7E] py-20 text-white sm:py-24">
          <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-9 px-5 sm:px-8 lg:flex-row lg:items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">Financial intelligence. Elevated.</p>
              <h2 className="si-display mt-5 max-w-3xl text-4xl leading-[1.02] tracking-[-0.035em] sm:text-6xl">Understand the market. Beyond the obvious.</h2>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-blue-100">Experience a more comprehensive approach to financial intelligence, bringing together technology, market analysis and human expertise.</p>
            </div>
            <Button asChild size="lg" className="h-12 shrink-0 rounded-full bg-white px-7 text-[#174A7E] hover:bg-cyan-50"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
          </div>
        </section>
      </main>

      <footer className="bg-[#0B203D] text-white">
        <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8 lg:px-12">
          <div className="grid gap-10 border-b border-white/10 pb-12 sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr_1fr]">
            <div>
              <Link to="/" className="flex items-center gap-3">
                <img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" />
                <span className="text-sm font-extrabold">StocksIntels</span>
              </Link>
              <p className="mt-5 max-w-xs text-sm leading-6 text-slate-400">Super Intelligence. Financial Research. Human Expertise.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Platform</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/app/stocks" className="block hover:text-white">Stocks</Link><Link to="/app/markets" className="block hover:text-white">Markets</Link><Link to="/app/market-movers" className="block hover:text-white">Market movers</Link><Link to="/app/portfolio" className="block hover:text-white">Portfolio</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Intelligence</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/app/financials" className="block hover:text-white">Financials</Link><Link to="/app/news" className="block hover:text-white">News</Link><Link to="/blog" className="block hover:text-white">Research & insights</Link><Link to="/app/sectors" className="block hover:text-white">Sectors</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Company</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/about" className="block hover:text-white">About</Link><Link to="/careers" className="block hover:text-white">Careers</Link><a href="#contact" className="block hover:text-white">Business enquiries</a><Link to="/pricing" className="block hover:text-white">Pricing</Link><Link to="/developers" className="block hover:text-white">Developer Portal</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Legal</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/privacy" className="block hover:text-white">Privacy</Link><Link to="/terms" className="block hover:text-white">Terms</Link><Link to="/security" className="block hover:text-white">Security</Link><Link to="/disclaimer" className="block hover:text-white">Risk disclaimer</Link></div>
            </div>
          </div>
          <div className="flex flex-col gap-4 pt-7 text-[11px] leading-5 text-slate-500 sm:flex-row sm:items-start sm:justify-between">
            <p>Copyright {new Date().getFullYear()} StocksIntels. All rights reserved.</p>
            <p className="max-w-3xl sm:text-right">StocksIntels provides data, analytics and research tools for informational purposes. It is not a broker or financial adviser. Market data may be delayed. Investing involves risk.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
