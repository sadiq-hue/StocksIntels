import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "../../components/ui/card";
import {
  Search, TrendingUp, TrendingDown, Filter,
  SlidersHorizontal, RotateCcw, X, LayoutGrid, Table2,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router";
import {
  fetchScreenerResults, fetchScreenerCriteria,
  type ScreenerFilters, type ScreenerStock, type ScreenerResult, type ScreenerCriteria,
} from "../../services/screenerService";

const API_URL = import.meta.env.VITE_API_URL || "/api";

function formatVolume(vol: string | number): string {
  const v = typeof vol === "string" ? parseFloat(vol.replace(/[^0-9.]/g, "")) : vol;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(vol);
}

function formatMarketCap(mcap: number): string {
  if (mcap >= 1e12) return `${(mcap / 1e12).toFixed(2)}T`;
  if (mcap >= 1e9) return `${(mcap / 1e9).toFixed(1)}B`;
  if (mcap >= 1e6) return `${(mcap / 1e6).toFixed(1)}M`;
  return "N/A";
}

const SIGNAL_COLORS: Record<string, string> = {
  "Strong Buy": "text-emerald-600 bg-emerald-50",
  "Buy": "text-emerald-600 bg-emerald-50",
  "Accumulate": "text-teal-600 bg-teal-50",
  "Hold": "text-yellow-600 bg-yellow-50",
  "Sell": "text-red-600 bg-red-50",
  "Strong Sell": "text-red-600 bg-red-50",
};

const SIGNAL_BG: Record<string, string> = {
  "Strong Buy": "bg-emerald-500",
  "Buy": "bg-emerald-400",
  "Accumulate": "bg-teal-400",
  "Hold": "bg-yellow-400",
  "Sell": "bg-red-400",
  "Strong Sell": "bg-red-500",
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 55 ? "bg-teal-400" : score >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      <span className="text-[11px] font-bold text-gray-500 w-6 text-right">{score}</span>
    </div>
  );
}

export function StockScreener() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<ScreenerCriteria | null>(null);
  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [signalFilter, setSignalFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minChange, setMinChange] = useState("");
  const [maxChange, setMaxChange] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [minPE, setMinPE] = useState("");
  const [maxPE, setMaxPE] = useState("");
  const [minDiv, setMinDiv] = useState("");
  const [maxDiv, setMaxDiv] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [sortBy, setSortBy] = useState("confidence");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [yahooResults, setYahooResults] = useState<{ ticker: string; name: string }[]>([]);
  const [yahooSearching, setYahooSearching] = useState(false);
  const yahooTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (yahooTimer.current) clearTimeout(yahooTimer.current);
    if (!search.trim()) {
      setYahooResults([]); setYahooSearching(false); return;
    }
    setYahooSearching(true);
    yahooTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/stocks/search/yahoo?q=${encodeURIComponent(search)}`);
        const data = await res.json();
        setYahooResults((data || []).filter((q: any) =>
          q.quoteType === "EQUITY" || q.quoteType === "ETF"
        ).map((q: any) => ({ ticker: q.symbol, name: q.longName || q.shortName || q.symbol })));
      } catch { setYahooResults([]); }
      finally { setYahooSearching(false); }
    }, 400);
    return () => { if (yahooTimer.current) clearTimeout(yahooTimer.current); };
  }, [search]);

  useEffect(() => {
    fetchScreenerCriteria().then(setCriteria).catch(() => {});
  }, []);

  const buildFilters = useCallback((): ScreenerFilters => {
    const f: ScreenerFilters = {};
    if (search) f.search = search;
    if (marketFilter) f.market = marketFilter;
    if (sectorFilter) f.sector = sectorFilter;
    if (signalFilter) f.signal = signalFilter;
    if (typeFilter) f.type = typeFilter;
    if (minPrice) f.minPrice = parseFloat(minPrice);
    if (maxPrice) f.maxPrice = parseFloat(maxPrice);
    if (minChange) f.minChange = parseFloat(minChange);
    if (maxChange) f.maxChange = parseFloat(maxChange);
    if (minVolume) f.minVolume = parseFloat(minVolume);
    if (minPE) f.minPE = parseFloat(minPE);
    if (maxPE) f.maxPE = parseFloat(maxPE);
    if (minDiv) f.minDividend = parseFloat(minDiv);
    if (maxDiv) f.maxDividend = parseFloat(maxDiv);
    if (minScore) f.minScore = parseFloat(minScore);
    if (maxScore) f.maxScore = parseFloat(maxScore);
    f.sortBy = sortBy;
    f.sortDir = sortDir;
    f.page = page;
    f.limit = 30;
    return f;
  }, [search, marketFilter, sectorFilter, signalFilter, typeFilter,
      minPrice, maxPrice, minChange, maxChange, minVolume,
      minPE, maxPE, minDiv, maxDiv, minScore, maxScore,
      sortBy, sortDir, page]);

  useEffect(() => {
    setLoading(true);
    fetchScreenerResults(buildFilters())
      .then(setResult)
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [buildFilters]);

  const hasActiveFilters = minPrice || maxPrice || minChange || maxChange || minVolume ||
    minPE || maxPE || minDiv || maxDiv || minScore || maxScore ||
    sectorFilter || signalFilter || typeFilter;

  const clearFilters = () => {
    setMinPrice(""); setMaxPrice(""); setMinChange(""); setMaxChange(""); setMinVolume("");
    setMinPE(""); setMaxPE(""); setMinDiv(""); setMaxDiv(""); setMinScore(""); setMaxScore("");
    setSectorFilter(""); setSignalFilter(""); setTypeFilter(""); setPage(1);
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <span className="text-muted-foreground/30 ml-1">&#8597;</span>;
    return <span className="ml-1">{sortDir === "asc" ? "&#8593;" : "&#8595;"}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Stock Screener</h2>
          <p className="text-sm text-muted-foreground">
            {result ? `${result.total} stocks match your criteria` : "Loading..."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search ticker, name..."
              className="w-full pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={marketFilter}
            onChange={e => { setMarketFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Markets</option>
            {criteria?.markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 ${viewMode === "table" ? "bg-[#0D7490] text-white" : "bg-background text-muted-foreground hover:bg-accent"}`}
              title="Table view"
            >
              <Table2 className="size-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? "bg-[#0D7490] text-white" : "bg-background text-muted-foreground hover:bg-accent"}`}
              title="Grid view"
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold transition-all ${
              showFilters || hasActiveFilters
                ? "bg-[#0D7490] text-white border-[#0D7490]"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            <SlidersHorizontal className="size-3.5" />
            Filters
            {hasActiveFilters && <span className="size-1.5 rounded-full bg-yellow-400" />}
          </button>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 rounded-lg border bg-background text-xs font-semibold text-muted-foreground hover:bg-accent">
              <RotateCcw className="size-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <Card className="p-4 border-[#0D7490]/20 bg-[#0D7490]/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-[#0D7490]" />
              <span className="text-sm font-bold text-foreground">Advanced Filters</span>
            </div>
            <button onClick={() => setShowFilters(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Sector</label>
              <select value={sectorFilter} onChange={e => { setSectorFilter(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20">
                <option value="">All</option>
                {criteria?.sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Signal</label>
              <select value={signalFilter} onChange={e => { setSignalFilter(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20">
                <option value="">All</option>
                {criteria?.signalTypes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Trade Type</label>
              <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20">
                <option value="">All</option>
                {criteria?.tradeTypes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Price Min</label>
              <input type="number" placeholder="Min" value={minPrice} onChange={e => { setMinPrice(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Price Max</label>
              <input type="number" placeholder="Max" value={maxPrice} onChange={e => { setMaxPrice(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Change % Min</label>
              <input type="number" placeholder="Min" value={minChange} onChange={e => { setMinChange(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Change % Max</label>
              <input type="number" placeholder="Max" value={maxChange} onChange={e => { setMaxChange(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Volume Min</label>
              <input type="number" placeholder="Min" value={minVolume} onChange={e => { setMinVolume(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">P/E Min</label>
              <input type="number" placeholder="Min" value={minPE} onChange={e => { setMinPE(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">P/E Max</label>
              <input type="number" placeholder="Max" value={maxPE} onChange={e => { setMaxPE(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Div Yield Min</label>
              <input type="number" placeholder="Min" value={minDiv} onChange={e => { setMinDiv(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Div Yield Max</label>
              <input type="number" placeholder="Max" value={maxDiv} onChange={e => { setMaxDiv(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Score Min</label>
              <input type="number" placeholder="Min" value={minScore} onChange={e => { setMinScore(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase font-semibold">Score Max</label>
              <input type="number" placeholder="Max" value={maxScore} onChange={e => { setMaxScore(e.target.value); setPage(1); }}
                className="w-full px-2.5 py-1.5 bg-background border rounded text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
            </div>
          </div>
        </Card>
      )}

      {viewMode === "table" ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("ticker")}>
                    Symbol <SortIcon col="ticker" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Name</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("sector")}>
                    Sector <SortIcon col="sector" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("price")}>
                    Price <SortIcon col="price" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("change")}>
                    Change <SortIcon col="change" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden md:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("volume")}>
                    Volume <SortIcon col="volume" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden xl:table-cell">Signal</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("confidence")}>
                    Conf. <SortIcon col="confidence" />
                  </th>
                  <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden xl:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("score")}>
                    Score <SortIcon col="score" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result?.stocks.map((stock, idx) => {
                  const isPositive = stock.change >= 0;
                  return (
                    <tr
                      key={`${stock.ticker}-${idx}`}
                      className="group hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                      onClick={() => navigate(`/app/stock/${stock.ticker}?market=${stock.market === "NSE" ? "nse" : "us"}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground group-hover:text-[#0D7490] transition-colors">{stock.ticker}</span>
                          {stock.market === "NSE" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0D7490]/10 text-[#0D7490] font-bold">NSE</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-sm text-muted-foreground block font-medium">{stock.name || stock.ticker}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground font-medium">{stock.sector || 'N/A'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-bold text-foreground font-mono">
                          {stock.currency === "USD" ? "$" : "KES "}{stock.price.toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold ${isPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                          {isPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                          {isPositive ? "+" : ""}{stock.change.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="text-xs font-medium text-muted-foreground">{formatVolume(stock.volume)}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden xl:table-cell">
                        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${SIGNAL_COLORS[stock.signal] || "text-gray-600 bg-gray-50"}`}>
                          {stock.signal}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-bold text-foreground">{stock.confidence}%</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden xl:table-cell">
                        <ScoreBar score={stock.score} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(!result || result.stocks.length === 0) && !loading && !yahooSearching && yahooResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="size-8 mb-2 opacity-40" />
                <p className="text-sm font-medium">No stocks match your criteria</p>
                <button onClick={clearFilters} className="mt-2 text-xs text-[#0D7490] hover:underline font-semibold">
                  Clear all filters
                </button>
              </div>
            )}
            {(!result || result.stocks.length === 0) && !loading && yahooResults.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-teal-50 border-b border-teal-200">
                  <span className="text-[11px] font-semibold text-teal-700">Yahoo Finance results for &quot;{search}&quot;</span>
                </div>
                <div className="divide-y divide-border">
                  {yahooResults.map((r) => (
                    <div
                      key={r.ticker}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/app/stock/${r.ticker}?market=us`)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-foreground">{r.ticker}</span>
                        <span className="text-xs text-muted-foreground">{r.name}</span>
                      </div>
                      <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded">Yahoo Finance</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loading && !yahooSearching && (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <div className="size-6 border-2 border-[#0D7490] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {yahooSearching && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <div className="size-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mr-2" />
                <span className="text-xs font-medium">Searching Yahoo Finance...</span>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {result?.stocks.map((stock, idx) => {
            const isPositive = stock.change >= 0;
            return (
              <Card
                key={`card-${stock.ticker}-${idx}`}
                className="p-4 hover:border-[#0D7490]/30 cursor-pointer transition-all hover:shadow-sm"
                onClick={() => navigate(`/app/stock/${stock.ticker}?market=${stock.market === "NSE" ? "nse" : "us"}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{stock.ticker}</span>
                      {stock.market === "NSE" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0D7490]/10 text-[#0D7490] font-bold">NSE</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{stock.name || stock.ticker}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold font-mono text-foreground">
                      {stock.currency === "USD" ? "$" : "KES "}{stock.price.toFixed(2)}
                    </div>
                    <div className={`flex items-center justify-end gap-0.5 text-xs font-bold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                      {isPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                      {isPositive ? "+" : ""}{stock.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SIGNAL_COLORS[stock.signal] || "text-gray-600 bg-gray-50"}`}>
                    {stock.signal}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{stock.type}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">Conf: {stock.confidence}%</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{stock.sector || 'N/A'}</span>
                  <span>Vol: {formatVolume(stock.volume)}</span>
                </div>
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Overall Score</span>
                    <ScoreBar score={stock.score} />
                  </div>
                  <div className="grid grid-cols-4 gap-1 mt-1.5">
                    {[
                      { label: "Fund", score: stock.fundamentalScore },
                      { label: "Tech", score: stock.technicalScore },
                      { label: "Fin", score: stock.financialScore },
                      { label: "Macro", score: stock.macroScore },
                    ].map(m => (
                      <div key={m.label} className="text-center">
                        <div className="text-[9px] text-muted-foreground">{m.label}</div>
                        <div className={`h-1 rounded-full mt-0.5 ${m.score >= 60 ? "bg-emerald-400" : m.score >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
                          style={{ width: `${Math.min(100, Math.max(0, m.score))}%` }} />
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
          {(!result || result.stocks.length === 0) && !loading && !yahooSearching && yahooResults.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="size-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">No stocks match your criteria</p>
            </div>
          )}
          {(!result || result.stocks.length === 0) && !loading && yahooResults.length > 0 && (
            <div className="col-span-full">
              <div className="px-4 py-2 bg-teal-50 border border-teal-200 rounded-t-lg">
                <span className="text-[11px] font-semibold text-teal-700">Yahoo Finance results for &quot;{search}&quot;</span>
              </div>
              <div className="divide-y divide-border border-x border-b rounded-b-lg">
                {yahooResults.map((r) => (
                  <div
                    key={r.ticker}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/app/stock/${r.ticker}?market=us`)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm text-foreground">{r.ticker}</span>
                      <span className="text-xs text-muted-foreground">{r.name}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded">Yahoo Finance</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading && !yahooSearching && (
            <div className="col-span-full flex items-center justify-center py-16 text-muted-foreground">
              <div className="size-6 border-2 border-[#0D7490] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {yahooSearching && (
            <div className="col-span-full flex items-center justify-center py-8 text-muted-foreground">
              <div className="size-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-xs font-medium">Searching Yahoo Finance...</span>
            </div>
          )}
        </div>
      )}

      {result && result.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <span>Showing {((result.page - 1) * result.limit) + 1}-{Math.min(result.page * result.limit, result.total)} of {result.total} stocks</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={result.page <= 1}
              className="flex items-center justify-center size-8 rounded-md border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="size-4" />
            </button>
            {Array.from({ length: Math.min(result.totalPages, 7) }, (_, i) => {
              const start = Math.max(1, result.page - 3);
              const p = start + i;
              if (p > result.totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`flex items-center justify-center size-8 rounded-md text-xs font-semibold transition-colors ${
                    p === result.page ? "bg-[#0D7490] text-white" : "border bg-background hover:bg-accent text-muted-foreground"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(result.totalPages, p + 1))}
              disabled={result.page >= result.totalPages}
              className="flex items-center justify-center size-8 rounded-md border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
