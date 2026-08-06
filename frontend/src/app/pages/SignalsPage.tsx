import { useState, useEffect, useMemo } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import {
  TrendingUp, TrendingDown, Signal, Search, Zap,
  Activity, Star, RefreshCw, Info, ChevronLeft, ChevronRight,
  ArrowUpRight, ArrowDownRight, BarChart3, Clock,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthContext";
import type { Signal as StockSignal } from "../types/signals";
import { authFetch } from "../auth/tokenStore";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const SIGNAL_STYLES: Record<string, { bg: string; text: string; border: string; icon: typeof TrendingUp }> = {
  "Strong Buy":  { bg: "bg-emerald-600", text: "text-white", border: "border-emerald-600", icon: TrendingUp },
  "Buy":         { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200", icon: TrendingUp },
  "Hold":        { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-200", icon: Activity },
  "Sell":        { bg: "bg-red-100", text: "text-red-700", border: "border-red-200", icon: TrendingDown },
  "Strong Sell": { bg: "bg-red-600", text: "text-white", border: "border-red-600", icon: TrendingDown },
};

const TYPE_STYLES: Record<string, string> = {
  Intraday: "bg-orange-100 text-orange-700 border-orange-200",
  "Swing Trade": "bg-blue-100 text-blue-700 border-blue-200",
  "Long Term": "bg-purple-100 text-purple-700 border-purple-200",
  "Aggressive Buy": "bg-emerald-600 text-white border-emerald-600",
  "Momentum Trade": "bg-cyan-100 text-cyan-700 border-cyan-200",
  "Long Term Value": "bg-violet-100 text-violet-700 border-violet-200",
  Avoid: "bg-slate-100 text-slate-600 border-slate-200",
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

function curSym(s: { currency?: string; market?: string; country?: string }): string {
  return s.currency === "KES" || s.market === "NSE" || s.country === "KE" ? "KSh " : "$";
}

function fmtPrice(
  s: { currency?: string; market?: string; country?: string },
  v: number | null | undefined
): string {
  if (v == null || Number.isNaN(v)) return "—";
  return curSym(s) + formatCurrency(v);
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return formatCurrency(v);
}

function insiderPositive(ins: { netShares: number | null; buyCount: number; sellCount: number } | null | undefined): boolean {
  if (!ins) return false;
  return ins.netShares != null ? ins.netShares >= 0 : ins.buyCount >= ins.sellCount;
}

// ── Plain-language explanations ──────────────────────────────────────────────
const CONDITION_PLAIN: Record<string, string> = {
  peSignal: "Price compared to the company's earnings, vs similar companies — is the stock cheap or expensive?",
  evSignal: "What you pay for the whole business vs its earnings — a cheaper multiple is usually better.",
  pbSignal: "Price vs the value of the company's assets — how much you pay per dollar of assets.",
  divSignal: "Cash the company pays shareholders each year as a % of the share price.",
  revSignal: "How fast sales are growing compared to the same period last year.",
  epsSignal: "Whether the latest profit report beat analyst expectations — surprises can move the stock.",
  mgnSignal: "Whether the company's profit margins are widening or shrinking over time.",
  fcfSignal: "Cash left after expenses and reinvestment — the real money the business actually generates.",
  deSignal: "How much debt the company carries vs shareholder money — lower is safer.",
  crSignal: "Can it pay its short-term bills with short-term assets? Above 1.5 is generally healthy.",
  roeSignal: "Profit earned per dollar of shareholder money — how efficiently it uses investors' capital.",
  altSignal: "Bankruptcy-risk score. Above 3 = low risk; below 1.8 = danger zone.",
  insiderSignal: "Are the company's own directors and executives buying or selling its shares?",
  newsSignal: "The overall tone of recent news coverage — positive, negative, or mixed.",
};

const MACRO_LABELS: Record<string, string> = {
  pmi: "Manufacturing Activity",
  gdp: "GDP Growth",
  gdpGrowth: "GDP Growth",
  inflation: "Inflation",
  creditRating: "Credit Rating",
  politicalRisk: "Political Risk",
  currentAccount: "Current Account",
  interestRateDifferential: "Interest Rates vs Fed",
};

const MACRO_PLAIN: Record<string, string> = {
  pmi: "Business activity gauge — above 50 means the economy is growing, below 50 it's shrinking.",
  gdp: "How fast the whole economy is growing — steady growth supports company earnings.",
  gdpGrowth: "How fast the whole economy is growing — steady growth supports company earnings.",
  inflation: "How fast prices are rising — high inflation squeezes margins and consumer spending.",
  creditRating: "The country's creditworthiness — investment grade means a safer backdrop for business.",
  politicalRisk: "Political stability — a low score means a very stable environment.",
  currentAccount: "Trade and income balance with the rest of the world — a large deficit can weaken the currency.",
  interestRateDifferential: "Local interest rates vs the US Federal Reserve — affects currency strength and borrowing costs.",
};

function ratingPlain(signal: string): string {
  switch (signal) {
    case 'BUY': return "Positive — helps this stock";
    case 'STRONG BUY': return "Strongly positive — a clear tailwind";
    case 'SELL': return "Negative — a headwind to watch";
    case 'WATCH': return "Watch closely — could go either way";
    case 'SUPPRESS': return "A red-flag override — this one metric alone blocks a buy";
    default: return "Neutral — no strong impact";
  }
}

function confidencePlain(conf: number): string {
  if (conf >= 80) return "high conviction";
  if (conf >= 60) return "moderate conviction";
  if (conf >= 40) return "balanced — the model sees real pros and cons";
  return "low conviction";
}

function plainSummary(s: StockSignal): string {
  const verb = s.signal === "Strong Buy" ? "a strong buy"
    : s.signal === "Buy" ? "a buy"
    : s.signal === "Hold" ? "a hold"
    : s.signal === "Sell" ? "a sell"
    : s.signal === "Strong Sell" ? "a strong sell"
    : s.signal;
  const conf = s.confidence;
  let tail: string;
  if (conf >= 60) tail = "This is a relatively strong signal — but always check the levels below.";
  else if (conf >= 40) tail = "Treat this as a starting point, not a certainty — the model is fairly balanced.";
  else tail = "Be cautious — the model is not very confident about this one.";
  return `The model rates this ${verb} with ${confidencePlain(conf)} (${conf}% confidence). ${tail}`;
}

function reasonBullets(reason: string): string[] {
  return reason
    .split('|')
    .flatMap(part => part.split(';'))
    .map(s => s.trim())
    .filter(Boolean);
}

function gradePlain(grade: string): string {
  const head = (grade || '').trim().charAt(0).toUpperCase();
  if (['A', 'B'].includes(head)) return "strong";
  if (head === 'C') return "average";
  if (['D', 'F'].includes(head)) return "weak";
  return "";
}

function timeframePlain(timeframe: string | null | undefined): string {
  const t = (timeframe || '').toLowerCase();
  if (t.includes('intraday') || t.includes('day')) return "an intraday trade — opened and closed within the same trading day";
  if (t.includes('week')) return "a short-term trade, entered and exited within a few weeks — not a long-term investment";
  if (t.includes('month')) return "a medium-term position, meant to be held over months";
  return "a longer-term position, meant to be held for months or more";
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
      const res = await authFetch(`${API_URL}/signals${userIdParam}`);
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
          <div className="flex flex-wrap gap-2">
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
          <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="Intraday">Intraday</SelectItem><SelectItem value="Swing Trade">Swing Trade</SelectItem><SelectItem value="Long Term">Long Term</SelectItem><SelectItem value="Aggressive Buy">Aggressive Buy</SelectItem><SelectItem value="Momentum Trade">Momentum Trade</SelectItem><SelectItem value="Long Term Value">Long Term Value</SelectItem><SelectItem value="Avoid">Avoid</SelectItem></SelectContent>
        </Select>
        <Select value={filterSignal} onValueChange={setFilterSignal}>
          <SelectTrigger className="w-[130px] h-9 text-sm border-border"><SelectValue placeholder="Signal" /></SelectTrigger>
          <SelectContent><SelectItem value="All">All Signals</SelectItem><SelectItem value="Strong Buy">Strong Buy</SelectItem><SelectItem value="Buy">Buy</SelectItem><SelectItem value="Hold">Hold</SelectItem><SelectItem value="Sell">Sell</SelectItem><SelectItem value="Strong Sell">Strong Sell</SelectItem></SelectContent>
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
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link to={`/app/stock/${s.ticker}`} onClick={e => e.stopPropagation()} className="text-sm font-bold text-foreground hover:text-[#0D7490]">{s.ticker}</Link>
                      <span className="text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-[180px]">{s.name}</span>
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
                <span>{s.timeframe || "—"}</span>
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
                  <p className="text-sm font-bold text-foreground">{fmtPrice(s, s.price)}</p>
                </div>
                <div className={`flex-1 rounded-lg p-2.5 border ${s.change >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                  <p className="text-[10px] text-muted-foreground font-medium">Change</p>
                  <p className={`text-sm font-bold flex items-center gap-1 ${s.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {s.change >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    {s.change >= 0 ? "+" : ""}{s.change.toFixed(2)}%
                  </p>
                </div>
                <div className="flex-1 bg-muted rounded-lg p-2.5 border border-border">
                  <p className="text-[10px] text-muted-foreground font-medium">Confidence</p>
                  <p className={`text-sm font-bold ${s.confidence >= 80 ? "text-emerald-600" : s.confidence >= 70 ? "text-yellow-600" : "text-red-600"}`}>{s.confidence}%</p>
                </div>
              </div>

              {/* Entry / Stop / Targets */}
              <div className={`px-4 pb-3 grid grid-cols-2 gap-2 ${s.target3 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                <div className="bg-blue-50 rounded-md p-2 text-center border border-blue-100"><p className="text-[9px] font-medium text-blue-600 uppercase">Entry</p><p className="text-xs font-bold text-blue-900 font-mono">{fmtPrice(s, s.entry)}</p></div>
                <div className="bg-red-50 rounded-md p-2 text-center border border-red-100"><p className="text-[9px] font-medium text-red-600 uppercase">Stop</p><p className="text-xs font-bold text-red-900 font-mono">{fmtPrice(s, s.stopLoss)}</p></div>
                <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">T1</p><p className="text-xs font-bold text-emerald-900 font-mono">{fmtPrice(s, s.target1)}</p></div>
                <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">T2</p><p className="text-xs font-bold text-emerald-900 font-mono">{fmtPrice(s, s.target2)}</p></div>
                {s.target3 && <div className="bg-emerald-50 rounded-md p-2 text-center border border-emerald-100"><p className="text-[9px] font-medium text-emerald-600 uppercase">T3</p><p className="text-xs font-bold text-emerald-900 font-mono">{fmtPrice(s, s.target3)}</p></div>}
              </div>

              {/* Risk / ML badges */}
              <div className="px-4 pb-2 flex items-center gap-2 flex-wrap text-[10px]">
                {s.positionSize && parseInt(s.positionSize) > 0 && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100 font-medium">Size: {s.positionSize}</span>}
                {s.var95 && <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-100">VaR: {s.var95}</span>}
                {s.mlWinProb && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">ML: {s.mlWinProb}</span>}
                {s.regime && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">{s.regime}</span>}
                {s.weeklyTrend && <span className={`px-1.5 py-0.5 rounded font-medium ${s.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{s.weeklyTrend}</span>}
                {s.speculative && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 font-semibold">SPECULATIVE</span>}
                {s.catalyst?.direction && <span className={`px-1.5 py-0.5 rounded font-semibold border ${s.catalyst.direction === "positive" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>{s.catalyst.direction === "positive" ? "CATALYST +" : "CATALYST −"}</span>}
                {s.insider?.hasActivity && s.insider.score !== 50 && (
                  <span className={`px-1.5 py-0.5 rounded font-semibold border ${insiderPositive(s.insider) ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                    INSIDER {insiderPositive(s.insider) ? "+" : "−"}
                  </span>
                )}
              </div>

              {s.speculative && (
                <div className="mx-4 mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Speculative Rally — Not a Buy</p>
                  <p className="text-[11px] text-amber-800 leading-snug mt-0.5">+{s.speculative.momentumPct}% run over ~{s.speculative.lookbackSessions} sessions on sentiment/catalyst while fundamentals stay weak (Altman Z {s.speculative.altmanZ != null ? s.speculative.altmanZ : "n/a"}). Composite capped at Hold.</p>
                </div>
              )}

              {s.catalyst?.headline && (
                <div className="px-4 pb-3 -mt-1">
                  <p className="text-[11px] leading-snug">
                    <span className={`font-semibold ${s.catalyst.direction === "positive" ? "text-emerald-700" : "text-red-700"}`}>{s.catalyst.direction === "positive" ? "▲" : "▼"} {s.catalyst.type}</span>
                    <span className="text-muted-foreground"> — {s.catalyst.headline.slice(0, 90)}{s.catalyst.headline.length > 90 ? "…" : ""}</span>
                  </p>
                </div>
              )}

              {s.insider?.hasActivity && (
                <div className="px-4 pb-3 -mt-1">
                  <p className="text-[11px] leading-snug">
                    <span className={`font-semibold ${insiderPositive(s.insider) ? "text-emerald-700" : "text-red-700"}`}>{insiderPositive(s.insider) ? "▲" : "▼"} {s.insider.summary}</span>
                    {s.insider.latestDate && <span className="text-muted-foreground"> · latest {s.insider.latestDate}</span>}
                    {s.insider.score != null && <span className="text-muted-foreground"> · insider score {s.insider.score}/100</span>}
                    {s.insider.shortFloatPct != null && <span className="text-muted-foreground"> · short float {s.insider.shortFloatPct}%</span>}
                  </p>
                </div>
              )}

              {/* Confidence bar */}
              <div className="px-4 pb-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${s.confidence >= 80 ? "bg-emerald-500" : s.confidence >= 70 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${s.confidence}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">R:R 1:{s.riskReward != null && !Number.isNaN(s.riskReward) ? s.riskReward.toFixed(1) : "—"}</span>
              </div>

              {/* Condition summary + Reason */}
              <div className="px-4 pb-4 pt-2 border-t border-border">
                {s.analysis?.fundamental?.metrics && (() => {
                  const condSignals = getConditionSignals(s.analysis?.fundamental?.metrics ?? {});
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
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{s.reason || "Insufficient data for a detailed rationale."}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {paged.length === 0 && (
        signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Signal className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm font-medium text-muted-foreground">No signals available right now</p>
            <p className="text-xs mt-1 text-muted-foreground">Signals regenerate every few minutes — markets may be closed or the engine is still warming up.</p>
            <Button onClick={fetchSignals} disabled={loading} variant="outline" size="sm" className="border-border mt-4">
              <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm font-medium text-muted-foreground">No signals match your filters</p>
            <p className="text-xs mt-1 text-muted-foreground">Try adjusting your search or filter criteria</p>
          </div>
        )
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <h2 className="text-xl font-bold text-foreground">{selected.ticker}</h2>
                    {(() => { const s = SIGNAL_STYLES[selected.signal]; const I = s.icon; return <Badge className={`${s.bg} ${s.text} border-0`}><I className="w-3 h-3 mr-1" />{selected.signal}</Badge>; })()}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{selected.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 max-w-md">{plainSummary(selected)}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-1.5 hover:bg-accent rounded-md transition-colors shrink-0"><span className="text-muted-foreground text-lg font-bold">&times;</span></button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-3 border border-border"><p className="text-xs text-muted-foreground">Price</p><p className="text-lg font-bold text-foreground">{fmtPrice(selected, selected.price)}</p></div>
                <div className={`rounded-lg p-3 border ${selected.change >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}><p className="text-xs text-muted-foreground">Change</p><p className={`text-lg font-bold flex items-center gap-1 ${selected.change >= 0 ? "text-emerald-700" : "text-red-700"}`}>{selected.change >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}{selected.change >= 0 ? "+" : ""}{selected.change.toFixed(2)}%</p></div>
                <div className="bg-muted rounded-lg p-3 border border-border"><p className="text-xs text-muted-foreground">Confidence</p><p className={`text-lg font-bold ${selected.confidence >= 80 ? "text-emerald-600" : selected.confidence >= 70 ? "text-yellow-600" : "text-red-600"}`}>{selected.confidence}%</p></div>
              </div>

              <div>
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Trade Parameters</h3>
                  <p className="text-[10px] text-muted-foreground italic">The action plan — what to do, step by step</p>
                </div>
                <div className={`grid grid-cols-2 gap-2 ${selected.target3 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 text-center"><p className="text-[10px] font-medium text-blue-600 uppercase">Entry</p><p className="text-sm font-bold text-blue-900 font-mono">{fmtPrice(selected, selected.entry)}</p></div>
                  <div className="bg-red-50 rounded-lg p-3 border border-red-100 text-center"><p className="text-[10px] font-medium text-red-600 uppercase">Stop</p><p className="text-sm font-bold text-red-900 font-mono">{fmtPrice(selected, selected.stopLoss)}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center"><p className="text-[10px] font-medium text-emerald-600 uppercase">T1</p><p className="text-sm font-bold text-emerald-900 font-mono">{fmtPrice(selected, selected.target1)}</p></div>
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center"><p className="text-[10px] font-medium text-emerald-600 uppercase">T2</p><p className="text-sm font-bold text-emerald-900 font-mono">{fmtPrice(selected, selected.target2)}</p></div>
                  {selected.target3 && <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center"><p className="text-[10px] font-medium text-emerald-600 uppercase">T3</p><p className="text-sm font-bold text-emerald-900 font-mono">{fmtPrice(selected, selected.target3)}</p></div>}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                  <p><span className="font-semibold text-blue-700">Entry {fmtPrice(selected, selected.entry)}</span> — the price you should wait for before buying.</p>
                  <p><span className="font-semibold text-red-700">Stop {fmtPrice(selected, selected.stopLoss)}</span> — the safety-net price. If the stock drops to this level, sell immediately to prevent further losses.</p>
                  {selected.target1 && <p><span className="font-semibold text-emerald-700">T1 {fmtPrice(selected, selected.target1)}</span> — first profit goal. Many investors take some profit here.</p>}
                  {selected.target2 && <p><span className="font-semibold text-emerald-700">T2 {fmtPrice(selected, selected.target2)}</span> — middle profit goal — take more profit if it reaches here.</p>}
                  {selected.target3 && <p><span className="font-semibold text-emerald-700">T3 {fmtPrice(selected, selected.target3)}</span> — ultimate profit goal — the full win.</p>}
                  {selected.riskReward != null && !Number.isNaN(selected.riskReward) && (
                    <p><span className="font-semibold text-foreground">Risk-to-reward {selected.riskReward.toFixed(1)}:1</span> — for every $1 you risk, the plan targets {selected.riskReward.toFixed(1)} of profit.</p>
                  )}
                </div>
              </div>

              {/* Risk / ML detail row */}
              {(selected.positionSize || selected.var95 || selected.var99 || selected.cvar95 || selected.mlWinProb || selected.regime) && (
                <div>
                  <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Risk & ML</h3>
                    <p className="text-[10px] text-muted-foreground italic">How risky this trade is, and how big a slice of your money it should be</p>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {selected.positionSize && parseInt(selected.positionSize) > 0 && <div className="bg-purple-50 rounded-lg p-2.5 border border-purple-100 text-center"><p className="text-[9px] font-medium text-purple-600 uppercase">Size</p><p className="text-sm font-bold text-purple-900">{selected.positionSize}</p></div>}
                    {selected.var95 && <div className="bg-orange-50 rounded-lg p-2.5 border border-orange-100 text-center"><p className="text-[9px] font-medium text-orange-600 uppercase">VaR 95%</p><p className="text-sm font-bold text-orange-900">{selected.var95}</p></div>}
                    {selected.var99 && <div className="bg-orange-50 rounded-lg p-2.5 border border-orange-100 text-center"><p className="text-[9px] font-medium text-orange-600 uppercase">VaR 99%</p><p className="text-sm font-bold text-orange-900">{selected.var99}</p></div>}
                    {selected.cvar95 && <div className="bg-red-50 rounded-lg p-2.5 border border-red-100 text-center"><p className="text-[9px] font-medium text-red-600 uppercase">CVaR</p><p className="text-sm font-bold text-red-900">{selected.cvar95}</p></div>}
                    {selected.mlWinProb && <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100 text-center"><p className="text-[9px] font-medium text-blue-600 uppercase">ML Win Prob</p><p className="text-sm font-bold text-blue-900">{selected.mlWinProb}</p></div>}
                    {selected.regime && <div className="bg-muted rounded-lg p-2.5 border border-border text-center"><p className="text-[9px] font-medium text-muted-foreground uppercase">Regime</p><p className={`text-sm font-bold ${selected.regime === 'bull' ? 'text-emerald-600' : selected.regime === 'bear' ? 'text-red-600' : 'text-foreground'}`}>{selected.regime}</p></div>}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                    {selected.positionSize && parseInt(selected.positionSize) > 0 && <p><span className="font-semibold text-purple-700">Size {selected.positionSize}</span> — the suggested share of your investment money for this single trade.</p>}
                    {selected.var95 && <p><span className="font-semibold text-orange-700">VaR 95% {selected.var95}</span> — the worst loss expected on a normal bad day (only about 5% of days lose more).</p>}
                    {selected.var99 && <p><span className="font-semibold text-orange-700">VaR 99% {selected.var99}</span> — the worst loss expected on a rare, extreme day.</p>}
                    {selected.cvar95 && <p><span className="font-semibold text-red-700">CVaR {selected.cvar95}</span> — the average loss in the worst 5% of scenarios.</p>}
                    {selected.mlWinProb && <p><span className="font-semibold text-blue-700">ML Win Prob {selected.mlWinProb}</span> — how often this machine-learning model has been right on similar setups in the past.</p>}
                    {selected.regime && <p><span className="font-semibold text-foreground">Regime: {selected.regime}</span> — the broad market state the model detects. Bull = prices generally rising, Bear = falling, Neutral = sideways.</p>}
                  </div>
                </div>
              )}

              {selected.analysis && (
                <>
                  {/* ── Why This Signal ── */}
                  <div>
                    <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-foreground">Why This Signal</h3>
                      <p className="text-[10px] text-muted-foreground italic">The company health check — how the business itself looks</p>
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        const condSignals = getConditionSignals(selected.analysis?.fundamental?.metrics || {});
                        const grouped: Record<string, typeof condSignals> = {};
                        condSignals.forEach(c => {
                          if (!grouped[c.category]) grouped[c.category] = [];
                          grouped[c.category].push(c);
                        });
                        return CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => (
                          <div key={cat} className="bg-muted rounded-lg p-3 border border-border">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{cat}</p>
                            <div className="space-y-1.5">
                              {grouped[cat].map(c => {
                                const signal = c.signal || 'NEUTRAL';
                                const style = CONDITION_SIGNAL_STYLES[signal] || CONDITION_SIGNAL_STYLES['NEUTRAL'];
                                return (
                                  <div key={c.key} className="text-xs">
                                    <div className="flex items-start gap-2">
                                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${style}`}>{signal}</span>
                                      <span className="font-medium text-foreground min-w-[7rem]">{c.name}</span>
                                      <span className="text-muted-foreground leading-tight">{c.rating}</span>
                                    </div>
                                    <p className="pl-[4.25rem] text-[10px] text-muted-foreground/80 leading-snug mt-0.5">
                                      <span className="font-medium text-foreground/70">What it means:</span> {CONDITION_PLAIN[c.key] || 'See the detail above.'} <span className="font-medium text-foreground/70">Verdict:</span> {ratingPlain(signal).toLowerCase()}.
                                    </p>
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
                      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          Macro Conditions — {selected.analysis.macro.country}
                          <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            selected.analysis.macro.signal === 'Bullish' || selected.analysis.macro.signal === 'Favorable'
                              ? 'bg-emerald-100 text-emerald-700'
                              : selected.analysis.macro.signal === 'Caution' || selected.analysis.macro.signal === 'Bearish'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-muted text-muted-foreground'
                          }`}>{selected.analysis.macro.signal} ({selected.analysis.macro.score})</span>
                        </h3>
                        <p className="text-[10px] text-muted-foreground italic">The big economic picture around this stock</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(selected.analysis.macro.conditions).map(([key, cond]) => {
                          const sig = (cond as any).signal || 'NEUTRAL';
                          const style = sig === 'BUY' ? 'bg-emerald-50 border-emerald-200' :
                            sig === 'SELL' ? 'bg-red-50 border-red-200' : 'bg-muted border-border';
                          return (
                            <div key={key} className={`rounded-lg p-2.5 border ${style}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                                  {MACRO_LABELS[key] || key.replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                                  sig === 'BUY' ? 'bg-emerald-100 text-emerald-700' :
                                  sig === 'SELL' ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
                                }`}>{sig}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-tight">{(cond as any).detail}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground/80 leading-snug">
                                <span className="font-medium text-foreground/70">What it means:</span> {MACRO_PLAIN[key] || ''} <span className="font-medium text-foreground/70">Verdict:</span> {ratingPlain(sig).toLowerCase()}.
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Score Breakdown ── */}
                  <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Score Breakdown</h3>
                    <p className="text-[10px] text-muted-foreground italic">The grade card — how the stock scores in each area</p>
                  </div>
                  <div className="space-y-2">
                    {(["fundamental", "technical", "financial", "macro", "insider", "overall"] as const).map(key => {
                      const section = selected.analysis![key] as any;
                      if (!section) return null;
                      if (section.score == null) return null;
                      const label = key === 'overall' ? 'Overall' : key.charAt(0).toUpperCase() + key.slice(1);
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${section.score >= 70 ? 'bg-emerald-500' : section.score >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${section.score}%` }} />
                          </div>
                          <Badge className={`shrink-0 border-0 ${section.score >= 70 ? 'bg-emerald-100 text-emerald-700' : section.score >= 45 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{section.grade} ({section.score}){gradePlain(section.grade) ? ` · ${gradePlain(section.grade)}` : ''}</Badge>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
                    Each area is graded 0–100 (A–F). <span className="text-emerald-600">A–B</span> = strong, <span className="text-yellow-600">C</span> = average, <span className="text-red-600">D–F</span> = weak.
                  </p>
                  {(() => {
                    const overall = selected.analysis!.overall as any;
                    if (!overall || overall.score == null) return null;
                    const insiderSec = selected.analysis!.insider as any;
                    const insiderWeak = insiderSec && insiderSec.score != null && insiderSec.score < 45;
                    return (
                      <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
                        <p>
                          <span className="font-semibold text-foreground">In plain words:</span> mixing all the strengths and weaknesses together, the overall grade is{" "}
                          <span className="font-semibold text-foreground">{overall.grade} ({overall.score})</span> — {gradePlain(overall.grade) || 'average'}.
                        </p>
                        {insiderWeak && selected.insider?.hasActivity && (
                          <p>
                            <span className="font-semibold text-red-700">Why the insider score is low:</span> company insiders {selected.insider.summary?.toLowerCase()}. They know the business best, so heavy selling is a caution flag.
                          </p>
                        )}
                        <p>
                          <span className="font-semibold text-foreground">Timeframe:</span> {selected.timeframe || '—'} — {timeframePlain(selected.timeframe)}.
                        </p>
                      </div>
                    );
                  })()}
                </>
              )}

              {selected.speculative && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">Speculative Rally — Not a Buy</p>
                  <p className="text-xs text-amber-800 leading-relaxed">{selected.speculative.warning || "Sentiment/catalyst-driven run on weak fundamentals — composite capped at Hold, high reversal risk."}</p>
                  <p className="text-[11px] text-amber-700 mt-2">+{selected.speculative.momentumPct}% momentum over ~{selected.speculative.lookbackSessions} sessions{selected.speculative.altmanZ != null ? ` · Altman Z ${selected.speculative.altmanZ}` : ""}</p>
                </div>
              )}

              {selected.catalyst && (
                <div className={`rounded-lg border p-4 ${selected.catalyst.direction === "positive" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                  <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${selected.catalyst.direction === "positive" ? "text-emerald-800" : "text-red-800"}`}>{selected.catalyst.direction === "positive" ? "Positive" : "Negative"} Catalyst</p>
                  <p className="text-sm font-semibold text-foreground">{selected.catalyst.type}</p>
                  {selected.catalyst.headline && <p className="text-xs text-muted-foreground leading-relaxed mt-1">{selected.catalyst.headline}</p>}
                  <p className="text-[11px] text-muted-foreground/80 mt-1.5">
                    What this means: a {selected.catalyst.direction === "positive" ? "positive" : "negative"} news event that can move the stock — weigh it together with the fundamentals above.
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                    {selected.catalyst.source && <span>Source: {selected.catalyst.source}</span>}
                    {selected.catalyst.publishedAt && <span>Published: {new Date(selected.catalyst.publishedAt).toLocaleDateString()}</span>}
                    {selected.catalyst.strength != null && <span>Strength: {selected.catalyst.strength}/5</span>}
                  </div>
                </div>
              )}

              {selected.insider?.hasActivity && (
                <div className={`rounded-lg border p-4 ${insiderPositive(selected.insider) ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                  <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${insiderPositive(selected.insider) ? "text-emerald-800" : "text-red-800"}`}>
                    {insiderPositive(selected.insider) ? "Insider Buying" : "Insider Selling"} {selected.insider.score != null ? `· Score ${selected.insider.score}/100` : ""}
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">{selected.insider.summary}</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-1.5">
                    Insiders know the business best — when they sell more than they buy (or vice versa), it's often a clue about how they see the company's prospects.
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                    {selected.insider.latestDate && <span>Latest: {selected.insider.latestDate}</span>}
                    {selected.insider.latestText && <span>Last: {selected.insider.latestText}</span>}
                    {selected.insider.shortFloatPct != null && <span>Short float: {selected.insider.shortFloatPct}%</span>}
                  </div>
                </div>
              )}

              <div className="bg-[#0D7490]/5 rounded-lg p-4 border border-[#0D7490]/20">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-[#0D7490] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1.5">
                      <p className="text-sm font-medium text-foreground">Signal Reason</p>
                      <p className="text-[10px] text-muted-foreground italic">The full story behind the rating, in one place</p>
                    </div>
                    <ul className="list-disc pl-4 space-y-1">
                      {reasonBullets(selected.reason || "").map((b, i) => (
                        <li key={i} className="text-sm text-muted-foreground leading-relaxed">{b}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={TYPE_STYLES[selected.type]}>{selected.type}</Badge>
                  <span title={timeframePlain(selected.timeframe)}>Timeframe: {selected.timeframe}</span>
                  <span className="text-muted-foreground">|</span>
                  <span>Sector: {selected.sector}</span>
                  {selected.country && (
                    <>
                      <span className="text-muted-foreground">|</span>
                      <span className="font-medium text-[#0D7490]">{selected.country}</span>
                    </>
                  )}
                </div>
                <span>R:R 1:{selected.riskReward != null && !Number.isNaN(selected.riskReward) ? selected.riskReward.toFixed(1) : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
