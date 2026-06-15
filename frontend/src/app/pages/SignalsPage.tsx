import { useState, useEffect, useMemo } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import {
  TrendingUp, TrendingDown, Signal, Target, Search, Zap,
  Activity, Star, RefreshCw, Info, ChevronLeft, ChevronRight,
  ArrowUpRight, ArrowDownRight, BarChart3, Clock,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthContext";
import type { Signal as StockSignal } from "../types/signals";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const SIGNAL_STYLES: Record<string, { bg: string; text: string; border: string; icon: typeof TrendingUp }> = {
  "Strong Buy":  { bg: "bg-emerald-600", text: "text-white", border: "border-emerald-600", icon: TrendingUp },
  "Buy":         { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200", icon: TrendingUp },
  "Accumulate":  { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-200", icon: Target },
  "Hold":        { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-200", icon: Activity },
  "Reduce":      { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200", icon: TrendingDown },
  "Sell":        { bg: "bg-red-100", text: "text-red-700", border: "border-red-200", icon: TrendingDown },
  "Strong Sell": { bg: "bg-red-600", text: "text-white", border: "border-red-600", icon: TrendingDown },
};

const TYPE_STYLES: Record<string, string> = {
  Intraday: "bg-orange-100 text-orange-700 border-orange-200",
  "Swing Trade": "bg-blue-100 text-blue-700 border-blue-200",
  "Long Term": "bg-purple-100 text-purple-700 border-purple-200",
};

// ── Signal condition definitions ─────────────────────────────────────────────
interface ConditionDef {
  key: string; name: string; category: string;
}
const CONDITIONS: ConditionDef[] = [
  { key: 'peSignal', name: 'P/E vs Sector', category: 'Valuation' },
  { key: 'evSignal', name: 'EV/EBITDA', category: 'Valuation' },
  { key: 'pbSignal', name: 'Price/Book', category: 'Valuation' },
  { key: 'divSignal', name: 'Dividend Yield', category: 'Valuation' },
  { key: 'revSignal', name: 'Revenue Growth', category: 'Growth' },
  { key: 'epsSignal', name: 'Earnings Surprise', category: 'Growth' },
  { key: 'mgnSignal', name: 'Margin Trend', category: 'Growth' },
  { key: 'fcfSignal', name: 'Free Cash Flow Yield', category: 'Growth' },
  { key: 'deSignal', name: 'Debt/Equity', category: 'Balance Sheet' },
  { key: 'crSignal', name: 'Current Ratio', category: 'Balance Sheet' },
  { key: 'roeSignal', name: 'Return on Equity', category: 'Balance Sheet' },
  { key: 'altSignal', name: 'Altman Z-Score', category: 'Balance Sheet' },
  { key: 'insiderSignal', name: 'Insider Activity', category: 'Insider Activity' },
  { key: 'newsSignal', name: 'News Sentiment', category: 'News' },
];

const RATING_KEYS: Record<string, string> = {
  peSignal: 'peRating', evSignal: 'evRating', pbSignal: 'pbRating',
  divSignal: 'divRating', revSignal: 'revRating', epsSignal: 'epsRating',
  mgnSignal: 'mgnRating', fcfSignal: 'fcfRating', deSignal: 'debtRating',
  crSignal: 'crRating', roeSignal: 'roeRating', altSignal: 'altRating',
  insiderSignal: 'insiderRating', newsSignal: 'newsRating',
};

const CONDITION_SIGNAL_STYLES: Record<string, string> = {
  'BUY': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'STRONG BUY': 'bg-emerald-600 text-white border-emerald-600',
  'SELL': 'bg-red-100 text-red-700 border-red-200',
  'WATCH': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'SUPPRESS': 'bg-red-600 text-white border-red-600',
  'NEUTRAL': 'bg-muted text-muted-foreground border-border',
};

function getConditionSignals(metrics: Record<string, string>) {
  return CONDITIONS.map(c => ({
    ...c,
    signal: metrics[c.key] || null,
    rating: metrics[RATING_KEYS[c.key]] || null,
  })).filter(c => c.signal !== null);
}

function countBySignal(conditions: ReturnType<typeof getConditionSignals>) {
  const counts: Record<string, number> = {};
  conditions.forEach(c => {
    const s = c.signal || 'NEUTRAL';
    counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
}

const CATEGORY_ORDER = ['Valuation', 'Growth', 'Balance Sheet', 'Insider Activity', 'News'];

function formatCurrency(value: number) {
  const abs = Math.abs(value);
  const fracDigits = abs < 0.0001 ? 6 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: fracDigits }).format(value);
}

export function SignalsPage() {
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterSignal, setFilterSignal] = useState("All");
  const [filterSector, setFilterSector] = useState("All");
  const [page, setPage] = useState(1);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<StockSignal | null>(null);
  const perPage = 15;
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const fetchSignals = async () => {
    try {
      setLoading(true);
      const userIdParam = user?.id ? `?userId=${user.id}` : '';
      const res = await fetch(`${API_URL}/signals${userIdParam}`);
      const data = await res.json();
      if (data.success) { setSignals(data.signals); setLastUpdated(new Date().toLocaleString()); }
    } catch (e) { console.error("Signals fetch error:", e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchSignals(); const i = setInterval(fetchSignals, 300000); return () => clearInterval(i); }, [user?.id]);

  useEffect(() => {
    const ticker = searchParams.get("ticker");
    if (ticker && signals.length > 0) {
      const match = signals.find(s => s.ticker === ticker);
      if (match) { setSelected(match); window.scrollTo({ top: 0, behavior: "smooth" }); }
    }
  }, [searchParams, signals]);

  const filtered = useMemo(() => signals.filter(s =>
    (s.ticker.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase())) &&
    (filterType === "all" || s.type === filterType) &&
    (filterSignal === "All" || s.signal === filterSignal) &&
    (filterSector === "All" || s.sector === filterSector)
  ), [signals, search, filterType, filterSignal, filterSector]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  useEffect(() => { setPage(1); }, [search, filterType, filterSignal, filterSector]);

  const sectors = [...new Set(signals.map(s => s.sector))].sort();
  const strongBuy = signals.filter(s => s.signal === "Strong Buy" || s.signal === "Buy").length;
  const strongSell = signals.filter(s => s.signal === "Sell" || s.signal === "Strong Sell").length;
  const highConf = signals.filter(s => s.confidence >= 80);

  const toggleFav = (t: string) => setFavorites(p => p.includes(t) ? p.filter(f => f !== t) : [...p, t]);

  if (loading && signals.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center"><RefreshCw className="w-8 h-8 text-[#0D7490] animate-spin mx-auto mb-4" /><p className="text-muted-foreground text-sm">Loading trading signals...</p></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]"><Signal className="w-5 h-5 text-white" /></div>
            <h1 className="text-2xl font-bold text-foreground">Trading Signals</h1>
          </div>
          <p className="text-muted-foreground text-sm">AI-generated opportunities based on fundamental, technical & financial analysis</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && <span className="text-muted-foreground text-xs hidden sm:flex items-center gap-1"><Clock className="w-3 h-3" /> {lastUpdated}</span>}
          <Link to="/app/stocks">
            <Button variant="outline" size="sm" className="border-border">
              <BarChart3 className="w-3.5 h-3.5 mr-2" />Screener
            </Button>
          </Link>
          <Button onClick={fetchSignals} disabled={loading} variant="outline" size="sm" className="border-border">
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="bg-card border-border p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wider">Total Signals</p><p className="text-foreground text-xl font-bold">{signals.length}</p></Card>
        <Card className="bg-card border-border p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wider">Strong Buy/Buy</p><p className="text-emerald-600 text-xl font-bold">{strongBuy}</p></Card>
        <Card className="bg-card border-border p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wider">Sell/Strong Sell</p><p className="text-red-600 text-xl font-bold">{strongSell}</p></Card>
        <Card className="bg-card border-border p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wider">High Confidence</p><p className="text-foreground text-xl font-bold">{highConf.length}</p></Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Avg Confidence</p>
          <p className="text-foreground text-xl font-bold">{signals.length ? Math.round(signals.reduce((a, b) => a + b.confidence, 0) / signals.length) : 0}%</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Favorites</p>
          <p className="text-amber-500 text-xl font-bold">{favorites.length}</p>
        </Card>
      </div>

      {/* High confidence banner */}
      {highConf.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-emerald-100/50 border border-emerald-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-emerald-600" />
            <div><p className="text-emerald-900 text-sm font-semibold">{highConf.length} high-confidence signal{highConf.length > 1 ? "s" : ""} available</p><p className="text-emerald-700 text-xs">Confidence ≥ 80% — strong probability setups</p></div>
          </div>
          <div className="flex gap-2">
            {highConf.slice(0, 3).map(s => (
              <button key={s.ticker} onClick={() => { setSelected(s); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="px-2.5 py-1 bg-card border border-emerald-200 rounded-md text-xs font-medium text-emerald-700 hover:bg-emerald-50">{s.ticker} <span className="text-emerald-500">{s.confidence}%</span></button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker or name..." className="pl-9 h-9 text-sm border-border" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[120px] h-9 text-sm border-border"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="Intraday">Intraday</SelectItem><SelectItem value="Swing Trade">Swing Trade</SelectItem><SelectItem value="Long Term">Long Term</SelectItem></SelectContent>
        </Select>
        <Select value={filterSignal} onValueChange={setFilterSignal}>
          <SelectTrigger className="w-[130px] h-9 text-sm border-border"><SelectValue placeholder="Signal" /></SelectTrigger>
          <SelectContent><SelectItem value="All">All Signals</SelectItem><SelectItem value="Strong Buy">Strong Buy</SelectItem><SelectItem value="Buy">Buy</SelectItem><SelectItem value="Accumulate">Accumulate</SelectItem><SelectItem value="Hold">Hold</SelectItem><SelectItem value="Sell">Sell</SelectItem><SelectItem value="Strong Sell">Strong Sell</SelectItem></SelectContent>
        </Select>
        <Select value={filterSector} onValueChange={setFilterSector}>
          <SelectTrigger className="w-[140px] h-9 text-sm border-border"><SelectValue placeholder="Sector" /></SelectTrigger>
          <SelectContent><SelectItem value="All">All Sectors</SelectItem>{sectors.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Badge className="h-9 px-3 flex items-center gap-1.5 bg-[#0D7490] text-white border-0 text-xs">{filtered.length} signal{filtered.length !== 1 ? "s" : ""}</Badge>
      </div>

      {/* Signal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {paged.map(s => {
          const ss = SIGNAL_STYLES[s.signal];
          const Icon = ss.icon;
          return (
            <Card key={s.id || s.ticker} className="bg-card border-border overflow-hidden hover:border-[#0D7490] hover:shadow-md transition-all cursor-pointer group" onClick={() => setSelected(s)}>
              {/* Top: ticker, signal badge */}
              <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={e => { e.stopPropagation(); toggleFav(s.ticker); }} className="shrink-0 hover:text-amber-400 transition-colors">
                    <Star className={`w-4 h-4 ${favorites.includes(s.ticker) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link to={`/app/stock/${s.ticker}`} onClick={e => e.stopPropagation()} className="text-sm font-bold text-foreground hover:text-[#0D7490]">{s.ticker}</Link>
                      <span className="text-xs text-muted-foreground truncate">{s.name}</span>
                    </div>
                  </div>
                </div>
                <Badge className={`shrink-0 ${ss.bg} ${ss.text} border-0 text-[10px] font-semibold`}><Icon className="w-3 h-3 mr-1" />{s.signal}</Badge>
              </div>

              {/* Type + sector */}
              <div className="px-4 pb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge className={`${TYPE_STYLES[s.type]} border-0 text-[10px] font-medium`}>{s.type}</Badge>
                <span className="text-muted-foreground">|</span>
                <span>{s.sector}</span>
                <span className="text-muted-foreground">|</span>
                <span>{s.timeframe}</span>
                {s.country && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <span className="font-medium text-[#0D7490]">{s.country}</span>
                  </>
                )}
              </div>

              {/* Price row */}
              <div className="px-4 pb-3 flex items-center gap-3">
                <div className="flex-1 bg-muted rounded-lg p-2.5 border border-border">
                  <p className="text-[10px] text-muted-foreground font-medium">Price</p>
                  <p className="text-sm font-bold text-foreground">${formatCurrency(s.price)}</p>
                </div>
                <div className={`flex-1 rounded-lg p-2.5 border ${s.change >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                  <p className="text-[10px] text-muted-foreground font-medium">Change</p>
                  <p className={`text-sm font-bold flex items-center gap-1 ${s.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {s.change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    {s.change >= 0 ? "+" : ""}{s.change}%
                  </p>
                </div>
                <div className="flex-1 bg-muted rounded-lg p-2.5 border border-border">
                  <p className="text-[10px] text-muted-foreground font-medium">Confidence</p>
                  <p className={`text-sm font-bold ${s.confidence >= 80 ? "text-emerald-600" : s.confidence >= 70 ? "text-yellow-600" : "text-red-600"}`}>{s.confidence}%</p>
                </div>
              </div>

              {/* Entry / Stop / Targets */}
              <div className="px-4 pb-3 grid grid-cols-4 gap-2">
                <div className="bg-blue-50 rounded-md p-2 text-center border border-blue-100"><p className="text-[9px] font-medium text-blue-600 uppercase">Entry</p><p className="text-xs font-bold text-blue-900 font-mono">{formatCurrency(s.entry)}</p></div>
                <div className="bg-red-50 rounded-md p-2 text-center border border-red-100"><p className="text-[9px] font-medium text-red-600 uppercase">Stop</p><p className="text-xs font-bold text-red-900 font-mono">{formatCurrency(s.stopLoss)}</p></div>
                <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">T1</p><p className="text-xs font-bold text-emerald-900 font-mono">{formatCurrency(s.target1)}</p></div>
                <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">T2</p><p className="text-xs font-bold text-emerald-900 font-mono">{formatCurrency(s.target2)}</p></div>
              </div>

              {/* Risk / ML badges */}
              <div className="px-4 pb-2 flex items-center gap-2 flex-wrap text-[10px]">
                {s.positionSize && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100 font-medium">Size: {s.positionSize}</span>}
                {s.var95 && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-100">VaR: {s.var95}</span>}
                {s.mlWinProb && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">ML: {s.mlWinProb}</span>}
                {s.regime && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{s.regime}</span>}
                {s.weeklyTrend && <span className={`px-1.5 py-0.5 rounded font-medium ${s.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{s.weeklyTrend}</span>}
              </div>

              {/* Confidence bar */}
              <div className="px-4 pb-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${s.confidence >= 80 ? "bg-emerald-500" : s.confidence >= 70 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${s.confidence}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">R:R 1:{s.riskReward.toFixed(1)}</span>
              </div>

              {/* Condition summary + Reason */}
              <div className="px-4 pb-4 pt-2 border-t border-border">
                {s.analysis?.fundamental.metrics && (() => {
                  const condSignals = getConditionSignals(s.analysis!.fundamental.metrics);
                  const counts = countBySignal(condSignals);
                  const buy = (counts['BUY'] || 0) + (counts['STRONG BUY'] || 0);
                  const sell = (counts['SELL'] || 0);
                  const watch = (counts['WATCH'] || 0);
                  return (
                    <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                      {counts['SUPPRESS'] ? (
                        <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold">SUPPRESSED</span>
                      ) : (
                        <>
                          {buy > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">{buy} BUY</span>}
                          {sell > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">{sell} SELL</span>}
                          {watch > 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-semibold">{watch} WATCH</span>}
                        </>
                      )}
                    </div>
                  );
                })()}
                <div className="flex items-start gap-1.5">
                  <Info className="w-3 h-3 text-[#0D7490] shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{s.reason}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {paged.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Search className="w-8 h-8 mb-3 opacity-30" />
          <p className="text-sm font-medium text-muted-foreground">No signals match your filters</p>
          <p className="text-xs mt-1 text-muted-foreground">Try adjusting your search or filter criteria</p>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">{filtered.length} signal{filtered.length !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} className="flex items-center justify-center w-8 h-8 rounded-md border border-border bg-card hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"><ChevronLeft className="w-4 h-4 text-muted-foreground" /></button>
          <span className="text-xs font-medium text-muted-foreground px-3 min-w-[4rem] text-center">{safePage} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="flex items-center justify-center w-8 h-8 rounded-md border border-border bg-card hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"><ChevronRight className="w-4 h-4 text-muted-foreground" /></button>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-popover text-popover-foreground rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl border border-border" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-0.5">
                    <h2 className="text-xl font-bold text-foreground">{selected.ticker}</h2>
                    {(() => { const s = SIGNAL_STYLES[selected.signal]; const I = s.icon; return <Badge className={`${s.bg} ${s.text} border-0`}><I className="w-3 h-3 mr-1" />{selected.signal}</Badge>; })()}
                  </div>
                  <p className="text-sm text-muted-foreground">{selected.name}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 hover:bg-accent rounded-md transition-colors"><span className="text-muted-foreground text-lg font-bold">&times;</span></button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-3 border border-border"><p className="text-xs text-muted-foreground">Price</p><p className="text-lg font-bold text-foreground">${formatCurrency(selected.price)}</p></div>
                <div className={`rounded-lg p-3 border ${selected.change >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}><p className="text-xs text-muted-foreground">Change</p><p className={`text-lg font-bold flex items-center gap-1 ${selected.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{selected.change >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}{selected.change >= 0 ? "+" : ""}{selected.change}%</p></div>
                <div className="bg-muted rounded-lg p-3 border border-border"><p className="text-xs text-muted-foreground">Confidence</p><p className={`text-lg font-bold ${selected.confidence >= 80 ? "text-emerald-600" : selected.confidence >= 70 ? "text-yellow-600" : "text-red-600"}`}>{selected.confidence}%</p></div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Trade Parameters</h3>
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 text-center"><p className="text-[10px] font-medium text-blue-600 uppercase">Entry</p><p className="text-sm font-bold text-blue-900 font-mono">${formatCurrency(selected.entry)}</p></div>
                  <div className="bg-red-50 rounded-lg p-3 border border-red-100 text-center"><p className="text-[10px] font-medium text-red-600 uppercase">Stop</p><p className="text-sm font-bold text-red-900 font-mono">${formatCurrency(selected.stopLoss)}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center"><p className="text-[10px] font-medium text-emerald-600 uppercase">T1</p><p className="text-sm font-bold text-emerald-900 font-mono">${formatCurrency(selected.target1)}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center"><p className="text-[10px] font-medium text-emerald-600 uppercase">T2</p><p className="text-sm font-bold text-emerald-900 font-mono">${formatCurrency(selected.target2)}</p></div>
                </div>
              </div>

              {/* Risk / ML detail row */}
              {(selected.positionSize || selected.var95 || selected.var99 || selected.cvar95 || selected.mlWinProb || selected.regime) && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Risk & ML</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {selected.positionSize && <div className="bg-purple-50 rounded-lg p-2.5 border border-purple-100 text-center"><p className="text-[9px] font-medium text-purple-600 uppercase">Size</p><p className="text-sm font-bold text-purple-900">{selected.positionSize}</p></div>}
                    {selected.var95 && <div className="bg-orange-50 rounded-lg p-2.5 border border-orange-100 text-center"><p className="text-[9px] font-medium text-orange-600 uppercase">VaR 95%</p><p className="text-sm font-bold text-orange-900">{selected.var95}</p></div>}
                    {selected.var99 && <div className="bg-orange-50 rounded-lg p-2.5 border border-orange-100 text-center"><p className="text-[9px] font-medium text-orange-600 uppercase">VaR 99%</p><p className="text-sm font-bold text-orange-900">{selected.var99}</p></div>}
                    {selected.cvar95 && <div className="bg-red-50 rounded-lg p-2.5 border border-red-100 text-center"><p className="text-[9px] font-medium text-red-600 uppercase">CVaR</p><p className="text-sm font-bold text-red-900">{selected.cvar95}</p></div>}
                    {selected.mlWinProb && <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100 text-center"><p className="text-[9px] font-medium text-blue-600 uppercase">ML Win Prob</p><p className="text-sm font-bold text-blue-900">{selected.mlWinProb}</p></div>}
                    {selected.regime && <div className="bg-muted rounded-lg p-2.5 border border-border text-center"><p className="text-[9px] font-medium text-muted-foreground uppercase">Regime</p><p className={`text-sm font-bold ${selected.regime === 'bull' ? 'text-emerald-600' : selected.regime === 'bear' ? 'text-red-600' : 'text-foreground'}`}>{selected.regime}</p></div>}
                  </div>
                </div>
              )}

              {selected.analysis && (
                <>
                  {/* ── Why This Signal ── */}
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Why This Signal</h3>
                    <div className="space-y-2">
                      {(() => {
                        const condSignals = getConditionSignals(selected.analysis!.fundamental.metrics || {});
                        const grouped: Record<string, typeof condSignals> = {};
                        condSignals.forEach(c => {
                          if (!grouped[c.category]) grouped[c.category] = [];
                          grouped[c.category].push(c);
                        });
                        return CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => (
                          <div key={cat} className="bg-muted rounded-lg p-3 border border-border">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{cat}</p>
                            <div className="space-y-1">
                              {grouped[cat].map(c => {
                                const signal = c.signal || 'NEUTRAL';
                                const style = CONDITION_SIGNAL_STYLES[signal] || CONDITION_SIGNAL_STYLES['NEUTRAL'];
                                return (
                                  <div key={c.key} className="flex items-start gap-2 text-xs">
                                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${style}`}>{signal}</span>
                                    <span className="font-medium text-foreground min-w-[7rem]">{c.name}</span>
                                    <span className="text-muted-foreground leading-tight">{c.rating}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* ── Macro Conditions ── */}
                  {selected.analysis?.macro && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3">
                        Macro Conditions — {selected.analysis.macro.country}
                        <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          selected.analysis.macro.signal === 'Bullish' || selected.analysis.macro.signal === 'Favorable'
                            ? 'bg-emerald-100 text-emerald-700'
                            : selected.analysis.macro.signal === 'Caution' || selected.analysis.macro.signal === 'Bearish'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground'
                        }`}>{selected.analysis.macro.signal} ({selected.analysis.macro.score})</span>
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(selected.analysis.macro.conditions).map(([key, cond]) => {
                          const sig = (cond as any).signal || 'NEUTRAL';
                          const style = sig === 'BUY' ? 'bg-emerald-50 border-emerald-200' :
                            sig === 'SELL' ? 'bg-red-50 border-red-200' : 'bg-muted border-border';
                          return (
                            <div key={key} className={`rounded-lg p-2.5 border ${style}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                                  {key.replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                                  sig === 'BUY' ? 'bg-emerald-100 text-emerald-700' :
                                  sig === 'SELL' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                                }`}>{sig}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-tight">{(cond as any).detail}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Score Breakdown ── */}
                  <h3 className="text-sm font-semibold text-foreground">Score Breakdown</h3>
                  <div className="space-y-2">
                    {(["fundamental", "technical", "financial", "macro", "overall"] as const).map(key => {
                      const section = selected.analysis![key];
                      if (!section) return null;
                      const label = key === 'overall' ? 'Overall' : key.charAt(0).toUpperCase() + key.slice(1);
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${section.score >= 70 ? 'bg-emerald-500' : section.score >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${section.score}%` }} />
                          </div>
                          <Badge className={`shrink-0 border-0 ${section.score >= 70 ? 'bg-emerald-100 text-emerald-700' : section.score >= 45 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{section.grade} ({section.score})</Badge>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="bg-[#0D7490]/5 rounded-lg p-4 border border-[#0D7490]/20">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-[#0D7490] shrink-0 mt-0.5" />
                  <div><p className="text-sm font-medium text-foreground mb-1">Signal Reason</p><p className="text-sm text-muted-foreground leading-relaxed">{selected.reason}</p></div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={TYPE_STYLES[selected.type]}>{selected.type}</Badge>
                  <span>Timeframe: {selected.timeframe}</span>
                  <span className="text-muted-foreground">|</span>
                  <span>Sector: {selected.sector}</span>
                  {selected.country && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span className="font-medium text-[#0D7490]">{selected.country}</span>
                    </>
                  )}
                </div>
                <span>R:R 1:{selected.riskReward.toFixed(1)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
