import { useEffect, useMemo, useState } from "react";
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
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link, useParams } from "react-router";
import {
  TrendingUp, TrendingDown, Search, Star, BarChart3, Building2,
  DollarSign, Activity, ArrowUpDown, Sparkles, TrendingUpIcon,
  ChevronLeft, ChevronRight, Loader2,
} from "lucide-react";
import { globalStocks, kenyanStocks, type StockListItem, type StockMarket } from "../data/stockUniverses";
import {
  calculateRSI, calculateMACD, calculateSMA, calculateATR,
  generateStockData,
} from "../utils/technicalAnalysis";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const formatCurrency = (stock: StockListItem) => stock.currency === "USD" ? "$" : "KES ";

interface LiveQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
}

interface StockSignal {
  ticker: string;
  signal: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  confidence: number;
  fundamental?: { score: number };
  technical?: { score: number };
  reason?: string;
}

export function StockAnalysisPage() {
  const { ticker: urlTicker } = useParams<{ ticker: string }>();

  // Resolve ticker from URL — find in universe or create synthetic entry
  const resolveUrlTicker = () => {
    if (urlTicker) {
      const inNse = kenyanStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      const inGlobal = globalStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      if (inNse) return { stock: inNse, market: "nse" as StockMarket };
      if (inGlobal) return { stock: inGlobal, market: "global" as StockMarket };
      // Unknown ticker — create a synthetic entry
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

  // Live data states
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [stockSignal, setStockSignal] = useState<StockSignal | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<any>(null);

  const parseVolume = (vol: string): number => {
    const num = parseFloat(vol.replace("M", "").replace("K", ""));
    return vol.includes("M") ? num * 1000000 : vol.includes("K") ? num * 1000 : num;
  };

  const sectors = useMemo(
    () => ["All", ...Array.from(new Set(stockUniverse.map((s) => s.sector)))],
    [stockUniverse]
  );

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

  // Re-sync when URL ticker changes (e.g. from notification click)
  useEffect(() => {
    if (urlTicker) {
      const inNse = kenyanStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      const inGlobal = globalStocks.find(s => s.ticker.toUpperCase() === urlTicker.toUpperCase());
      if (inNse) { setActiveMarket("nse"); setSelectedStock(inNse); }
      else if (inGlobal) { setActiveMarket("global"); setSelectedStock(inGlobal); }
      else {
        // Unknown ticker — synthetic entry
        setActiveMarket("global");
        setSelectedStock({
          ticker: urlTicker.toUpperCase(), name: urlTicker.toUpperCase(),
          price: 0, change: 0, volume: "—", marketCap: "—",
          sector: "Other", pe: 0, dividend: 0, market: "global", currency: "USD",
        });
      }
    }
  }, [urlTicker]);

  const activeSelection = stockUniverse.find((s) => s.ticker === selectedStock.ticker) || selectedStock;

  // Fetch live data when selected stock changes
  useEffect(() => {
    const ticker = activeSelection.ticker;
    const market = activeSelection.market;
    let cancelled = false;

    const fetchData = async () => {
      setLoadingData(true);
      const marketParam = market === "nse" ? "nse" : "us";
      try {
        const [quoteRes, signalRes] = await Promise.all([
          fetch(`${API_URL}/stock/${ticker}?market=${marketParam}`).then(r => r.ok ? r.json() : null),
          fetch(`${API_URL}/signal/${ticker}`).then(r => r.ok ? r.json() : null),
        ]);
        if (!cancelled) {
          if (quoteRes) setLiveQuote(quoteRes);
          if (signalRes) setStockSignal(signalRes);
        }
      } catch { /* silent */ }
      // Fetch profile separately
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
  }, [activeSelection.ticker, activeSelection.market]);

  const displayPrice = liveQuote?.price ?? activeSelection.price;
  const displayChange = liveQuote?.changePercent ?? activeSelection.change;

  const chartData = useMemo(
    () => generateStockData(displayPrice, 0.02),
    [displayPrice]
  );

  const [chartPeriod, setChartPeriod] = useState("6M");
  const { rsi, atr, sma20, sma50, macdSignal } = useMemo(() => {
    const prices = chartData.map((d: any) => d.price);
    return {
      rsi: calculateRSI(prices),
      atr: calculateATR(chartData),
      sma20: calculateSMA(prices, 20),
      sma50: calculateSMA(prices, 50),
      macdSignal: calculateMACD(prices).macd > calculateMACD(prices).signal ? "Bullish" : "Bearish",
    };
  }, [chartData]);

  const displaySignal = stockSignal?.signal || (displayChange > 2 ? "Buy" : displayChange < -2 ? "Sell" : "Hold");
  const displayConfidence = stockSignal?.confidence ?? Math.min(95, 70 + Math.abs(displayChange) * 5);

  const toggleFavorite = (ticker: string) => {
    setFavorites((prev) =>
      prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker]
    );
  };

  const prices = chartData.map((d: any) => d.price);
  const currentPrice = prices[prices.length - 1];
  const highPrice = Math.max(...prices);
  const lowPrice = Math.min(...prices);
  const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
  const periodChange = ((currentPrice - prices[0]) / prices[0] * 100).toFixed(2);

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]">
              <TrendingUpIcon className="size-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Stock Analysis</h1>
          </div>
          <p className="text-sm text-muted-foreground">Explore markets with advanced analytics &amp; signals</p>
        </div>
        <div className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-xl bg-card border shadow-sm">
          <Sparkles className="size-4 text-[#0D7490]" />
          <span className="text-sm font-medium text-muted-foreground">Real-time Data</span>
        </div>
        <Link
          to="/app/stocks"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card text-xs font-semibold text-muted-foreground hover:text-[#0D7490] hover:border-[#0D7490]/30 transition-colors"
        >
          <BarChart3 className="size-3.5" /> Stock Screener
        </Link>
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
          <Card className="border shadow-sm h-full">
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
                    placeholder={`Search ${activeMarket === "nse" ? "Kenyan" : "global"} stocks...`}
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
                            {stock.price.toFixed(2)}
                          </div>
                          <div className={`flex items-center justify-end gap-0.5 text-[11px] font-medium ${
                            stock.change >= 0 ? "text-emerald-600" : "text-red-500"
                          }`}>
                            {stock.change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                            {stock.change > 0 ? "+" : ""}{stock.change}%
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  No stocks found
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
        </div>

        {/* Main Content */}
        <div className="xl:col-span-3 space-y-6">
          {/* Stock Header */}
          <Card className="border shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-sm">
                    <TrendingUp className="size-7 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h2 className="text-2xl font-bold text-foreground">{activeSelection.ticker}</h2>
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
                    {formatCurrency(activeSelection)}{displayPrice.toFixed(2)}
                  </div>
                  <div className={`flex items-center justify-end gap-1.5 mt-0.5 ${
                    displayChange >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}>
                    {displayChange >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    <span className="font-semibold">{displayChange > 0 ? "+" : ""}{displayChange.toFixed(2)}%</span>
                    <span className="text-xs text-muted-foreground">Today</span>
                  </div>
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
          <Card className="border shadow-sm">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Price Trend</h3>
                  <p className="text-xs text-muted-foreground">6-month daily price movement</p>
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

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
                {[
                  { label: "Current", value: `${formatCurrency(activeSelection)}${displayPrice.toFixed(2)}`, color: "text-foreground" },
                  { label: "High", value: `${formatCurrency(activeSelection)}${highPrice.toFixed(2)}`, color: "text-emerald-600" },
                  { label: "Low", value: `${formatCurrency(activeSelection)}${lowPrice.toFixed(2)}`, color: "text-red-500" },
                  { label: "Avg", value: `${formatCurrency(activeSelection)}${avgPrice.toFixed(2)}`, color: "text-blue-600" },
                  { label: "Change", value: `${periodChange.startsWith("-") ? "" : "+"}${periodChange}%`, color: +periodChange >= 0 ? "text-emerald-600" : "text-red-500" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-muted/50 p-2.5 border text-center">
                    <div className="text-[11px] font-medium text-muted-foreground mb-0.5">{s.label}</div>
                    <div className={`text-sm font-semibold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0D7490" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0D7490" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    interval={Math.floor(chartData.length / 7)}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    domain={["dataMin - 2", "dataMax + 2"]}
                    width={55}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                      fontSize: "13px",
                    }}
                    labelStyle={{ fontWeight: 600, marginBottom: 4, color: "var(--foreground)" }}
                    formatter={(value: number, name: string) => {
                      if (name === "price") return [`${formatCurrency(activeSelection)}${value.toFixed(2)}`, "Price"];
                      if (name === "volume") return [`${(value / 1000000).toFixed(2)}M`, "Volume"];
                      return [value, name];
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
                </AreaChart>
              </ResponsiveContainer>

              <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-sm bg-[#0D7490]" />
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground">PRICE</div>
                    <div className="text-sm font-semibold text-foreground">{currentPrice.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-sm bg-muted-foreground/30" />
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground">6M RANGE</div>
                    <div className="text-sm font-semibold text-foreground">{lowPrice.toFixed(2)} &mdash; {highPrice.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-sm bg-[#0EA5E9]/50" />
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground">AVG VOLUME</div>
                    <div className="text-sm font-semibold text-foreground">
                      {(chartData.reduce((s, d) => s + d.volume, 0) / chartData.length / 1000000).toFixed(1)}M
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Analytics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Signal */}
            <Card className="border shadow-sm">
              <div className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Trading Signal</h3>
                {loadingData ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
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
                      <p className="text-xs text-muted-foreground mt-2">{stockSignal.reason}</p>
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
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-medium text-muted-foreground">RSI (14)</span>
                      <span className={`text-xs font-semibold ${
                        rsi > 70 ? "text-red-500" : rsi < 30 ? "text-emerald-600" : "text-amber-600"
                      }`}>{rsi.toFixed(1)}</span>
                    </div>
                    <Progress value={Math.min(100, rsi)} className="h-1.5" />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {rsi > 70 ? "Overbought" : rsi < 30 ? "Oversold" : "Neutral"}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-muted-foreground">MACD</span>
                    <Badge className={`text-[11px] rounded-full font-medium ${
                      macdSignal === "Bullish" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}>{macdSignal}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-muted-foreground">Trend</span>
                    <span className={`text-xs font-semibold ${sma20 > sma50 ? "text-emerald-600" : "text-red-500"}`}>
                      {sma20 > sma50 ? "Up" : "Down"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-muted-foreground">Volatility (ATR)</span>
                    <span className="text-xs font-semibold text-foreground">{atr.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Fundamentals */}
            <Card className="border shadow-sm">
              <div className="p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Fundamental Analysis</h3>
                {loadingData ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : companyProfile ? (
                  <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100 mb-3">
                    <div className="text-[11px] font-medium text-blue-800 mb-1">{companyProfile.industry || activeSelection.sector}</div>
                    <div className="text-lg font-bold text-blue-700">
                      {companyProfile.recommendation || "N/A"}
                    </div>
                    <Progress value={companyProfile.scores?.total || 65} className="h-1.5 mt-2 bg-blue-200 [&>div]:bg-blue-600" />
                    <div className="text-[11px] text-blue-700 mt-1">Score: {companyProfile.scores?.total || 65}/100</div>
                  </div>
                ) : (
                  <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100 mb-3">
                    <div className="text-[11px] font-medium text-blue-800 mb-1">RATING</div>
                    <div className="text-lg font-bold text-blue-700">
                      {stockSignal?.signal || "Hold"}
                    </div>
                    <Progress value={stockSignal?.confidence || 50} className="h-1.5 mt-2 bg-blue-200 [&>div]:bg-blue-600" />
                    <div className="text-[11px] text-blue-700 mt-1">Signal Confidence: {stockSignal?.confidence || 50}/100</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "P/E", value: companyProfile?.peRatio?.toFixed(1) || (activeSelection.pe > 0 ? activeSelection.pe.toFixed(1) : "N/A"), sub: (companyProfile?.peRatio || activeSelection.pe) < 20 ? "Undervalued" : "Fair" },
                    { label: "Market Cap", value: companyProfile?.marketCap ? `$${(companyProfile.marketCap / 1e9).toFixed(1)}B` : activeSelection.marketCap, sub: "Enterprise Value" },
                    { label: "Revenue", value: companyProfile?.revenue ? `$${(companyProfile.revenue / 1e9).toFixed(1)}B` : "N/A", sub: "Annual (TTM)" },
                    { label: "Employees", value: companyProfile?.employees ? companyProfile.employees.toLocaleString() : "N/A", sub: companyProfile?.country || activeSelection.market === "nse" ? "Kenya" : "Global" },
                  ].map((item) => (
                    <div key={item.label} className="bg-background rounded-lg p-2.5 border">
                      <div className="text-[11px] font-medium text-muted-foreground">{item.label}</div>
                      <div className="text-sm font-semibold text-foreground">{item.value}</div>
                      <div className="text-[11px] text-muted-foreground">{item.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
