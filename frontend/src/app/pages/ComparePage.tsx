import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { X, Search, GitCompare, TrendingUp, TrendingDown, Loader2, Plus, Download, Share2, Check, Trophy, ChevronDown } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { authFetch } from "../auth/tokenStore";
import { useCompare } from "../contexts/CompareContext";
import { fetchStockHistory, type PriceBar } from "../services/marketDataService";
import { formatCompactNumber } from "../utils/format";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const MAX_STOCKS = 5;
const CHART_COLORS = ["#0D7490", "#0EA5E9", "#f59e0b", "#8b5cf6", "#ef4444"];

// Chart periods. Each maps a UI period to the history range to fetch and a cutoff
// (months back; 0 = YTD, -1 = all). MyStocks only serves correct NSE series for
// 1M/1Y/5Y/MAX, so other periods are hidden when a Kenyan stock is in the mix.
const PERIODS = [
  { k: "1m", label: "1M", fetch: "1mo", months: 1 },
  { k: "3m", label: "3M", fetch: "3mo", months: 3 },
  { k: "6m", label: "6M", fetch: "6mo", months: 6 },
  { k: "ytd", label: "YTD", fetch: "1y", months: 0 },
  { k: "1y", label: "1Y", fetch: "1y", months: 12 },
  { k: "3y", label: "3Y", fetch: "5y", months: 36 },
  { k: "5y", label: "5Y", fetch: "5y", months: 60 },
  { k: "10y", label: "10Y", fetch: "10y", months: 120 },
  { k: "max", label: "MAX", fetch: "max", months: -1 },
] as const;
type PeriodKey = typeof PERIODS[number]["k"];
const NSE_OK = new Set<PeriodKey>(["1m", "1y", "5y", "max"]);

// Series a chart metric can be built from: daily price bars, or the dated
// fundamental histories returned by /api/financials.
type MetricSource = "price" | "keyMetrics" | "income" | "cashflow" | "balance";
interface ChartMetric {
  id: string; label: string; source: MetricSource; get?: ((o: any) => number | null | undefined) | null; fmt: (v: number) => string;
}
const pctF = (v: number) => pct(v * 100, 2); // fraction (0.0486) -> 4.86%
const METRIC_GROUPS: { group: string; metrics: ChartMetric[] }[] = [
  { group: "Price & Return", metrics: [
    { id: "totalReturn", label: "Total Return (%)", source: "price", get: null, fmt: (v) => signed(v) },
    { id: "growth10k", label: "Growth of $10K", source: "price", get: null, fmt: (v) => money(v, "USD") },
    { id: "price", label: "Stock Price (%)", source: "price", get: null, fmt: (v) => signed(v) },
  ]},
  { group: "Valuation", metrics: [
    { id: "marketCap", label: "Market Cap", source: "keyMetrics", get: (k) => k.marketCap, fmt: (v) => formatCompactNumber(v) },
    { id: "peRatio", label: "PE Ratio", source: "keyMetrics", get: (k) => k.peRatio, fmt: ratio },
    { id: "psRatio", label: "PS Ratio", source: "keyMetrics", get: (k) => k.priceToSalesRatio, fmt: ratio },
    { id: "pbRatio", label: "PB Ratio", source: "keyMetrics", get: (k) => k.pbRatio, fmt: ratio },
    { id: "earningsYield", label: "Earnings Yield", source: "keyMetrics", get: (k) => k.earningsYield, fmt: pctF },
    { id: "fcfYield", label: "FCF Yield", source: "keyMetrics", get: (k) => k.freeCashFlowYield, fmt: pctF },
    { id: "payoutRatio", label: "Payout Ratio", source: "keyMetrics", get: (k) => k.payoutRatio, fmt: pctF },
    { id: "dividendYield", label: "Dividend Yield", source: "keyMetrics", get: (k) => k.dividendYield, fmt: pctF },
  ]},
  { group: "Revenue & Earnings", metrics: [
    { id: "revenue", label: "Revenue", source: "income", get: (k) => k.revenue ?? k.totalRevenue, fmt: (v) => formatCompactNumber(v) },
    { id: "revenueGrowth", label: "Revenue Growth", source: "keyMetrics", get: (k) => k.revenueGrowth, fmt: pctF },
    { id: "eps", label: "EPS (Diluted)", source: "income", get: (k) => k.epsdiluted ?? k.eps, fmt: (v) => v.toFixed(2) },
    { id: "epsGrowth", label: "EPS Growth", source: "keyMetrics", get: (k) => k.epsGrowth, fmt: (v) => (v * 100).toFixed(1) + "%" },
    { id: "grossProfit", label: "Gross Profit", source: "income", get: (k) => k.grossProfit, fmt: (v) => formatCompactNumber(v) },
    { id: "operatingIncome", label: "Operating Income", source: "income", get: (k) => k.operatingIncome, fmt: (v) => formatCompactNumber(v) },
    { id: "netIncome", label: "Net Income", source: "income", get: (k) => k.netIncome, fmt: (v) => formatCompactNumber(v) },
    { id: "ebitda", label: "EBITDA", source: "income", get: (k) => k.ebitda, fmt: (v) => formatCompactNumber(v) },
  ]},
  { group: "Margins", metrics: [
    { id: "grossMargin", label: "Gross Margin", source: "income", get: (k) => k.grossProfitRatio, fmt: pctF },
    { id: "operatingMargin", label: "Operating Margin", source: "income", get: (k) => k.operatingIncomeRatio, fmt: pctF },
    { id: "profitMargin", label: "Profit Margin", source: "income", get: (k) => k.netIncomeRatio, fmt: pctF },
    { id: "ebitdaMargin", label: "EBITDA Margin", source: "income", get: (k) => (k.revenue ? k.ebitda / k.revenue : null), fmt: pctF },
  ]},
  { group: "Cash Flow", metrics: [
    { id: "operatingCashFlow", label: "Operating Cash Flow", source: "cashflow", get: (k) => k.operatingCashFlow, fmt: (v) => formatCompactNumber(v) },
    { id: "capex", label: "Capital Expenditures", source: "cashflow", get: (k) => k.capitalExpenditure, fmt: (v) => formatCompactNumber(v) },
    { id: "freeCashFlow", label: "Free Cash Flow", source: "cashflow", get: (k) => k.freeCashFlow, fmt: (v) => formatCompactNumber(v) },
    { id: "fcfMargin", label: "Free Cash Flow Margin", source: "cashflow", get: (k) => (k.freeCashFlow && k.revenue ? k.freeCashFlow / k.revenue : null), fmt: pctF },
  ]},
  { group: "Returns", metrics: [
    { id: "roe", label: "Return on Equity (ROE)", source: "keyMetrics", get: (k) => k.roe, fmt: pctF },
    { id: "roa", label: "Return on Assets (ROA)", source: "keyMetrics", get: (k) => k.roa, fmt: pctF },
    { id: "roic", label: "Return on Invested Capital (ROIC)", source: "keyMetrics", get: (k) => k.roic, fmt: pctF },
  ]},
  { group: "Balance Sheet", metrics: [
    { id: "totalCash", label: "Total Cash", source: "balance", get: (k) => k.cashAndCashEquivalents, fmt: (v) => formatCompactNumber(v) },
    { id: "totalDebt", label: "Total Debt", source: "balance", get: (k) => k.totalDebt, fmt: (v) => formatCompactNumber(v) },
    { id: "netCash", label: "Net Cash", source: "balance", get: (k) => k.netCash ?? (k.cashAndCashEquivalents - k.totalDebt), fmt: (v) => formatCompactNumber(v) },
    { id: "sharesOutstanding", label: "Shares Outstanding", source: "keyMetrics", get: (k) => k.sharesOutstanding, fmt: (v) => formatCompactNumber(v) },
  ]},
];
const ALL_METRICS = METRIC_GROUPS.flatMap((g) => g.metrics);
const metricById = (id: string) => ALL_METRICS.find((m) => m.id === id) || ALL_METRICS[0];

const SUGGESTIONS = ["SCOM", "EQTY", "KCB", "AAPL", "MSFT", "NVDA", "TSLA"];

interface CompareStock {
  ticker: string;
  name: string;
  market: "NSE" | "US" | string;
  currency: string;
  quote: {
    price: number | null; change: number | null; volume: number | null;
    dayHigh: number | null; dayLow: number | null; previousClose: number | null; marketCap: number | null;
  };
  signal: {
    rating: string; confidence: number | null; type: string | null; timeframe: string | null;
    entry: number | null; stopLoss: number | null; target1: number | null; target2: number | null; target3: number | null;
    riskReward: number | null; positionSize: string | null; mlWinProb: string | null; regime: string | null; weeklyTrend: string | null;
    overall: number | null; overallGrade: string | null;
    fundamental: number | null; technical: number | null; financial: number | null; macro: number | null; insider: number | null;
  } | null;
  metrics: {
    pe: number | null; pb: number | null; evEbitda: number | null; dividendYield: number | null;
    revenueGrowth: number | null; epsGrowth: number | null; epsSurprise: number | null; marginChange: number | null;
    roe: number | null; fcfYield: number | null; debtEquity: number | null; currentRatio: number | null;
    altmanZ: number | null; payoutRatio: number | null; dataSource: string | null;
  };
  technicals: {
    rsi: number | null; rsiSignal: string | null; macdSignal: string | null; trendSignal: string | null;
    momentum: string | null; momentumSignal: string | null; volumeSignal: string | null; bbSignal: string | null;
  };
  performance: {
    y1: number | null; ytd: number | null; y3Annualized: number | null; y5Annualized: number | null;
    y10Annualized: number | null; spanYears: number | null; basis: string | null;
  } | null;
  risk: {
    volatility: number | null; maxDrawdown1y: number | null; high52: number | null; low52: number | null; fromHigh52: number | null;
  } | null;
}

interface SearchResult { ticker: string; name: string; sector?: string; market?: string; }

const DASH = "—";
function money(v: number | null | undefined, c: string) {
  return v == null ? DASH : `${c === "KES" ? "KES " : "$"}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function ratio(v: number | null | undefined) { return v == null ? DASH : Number(v).toFixed(2); }
function pct(v: number | null | undefined, dp = 1) { return v == null ? DASH : `${Number(v).toFixed(dp)}%`; }
function signed(v: number | null | undefined, dp = 2) { return v == null ? DASH : `${v > 0 ? "+" : ""}${Number(v).toFixed(dp)}%`; }

// Earliest timestamp to include for a chart period (months back; 0 = YTD, -1 = all).
function cutoffTs(months: number): number {
  const now = new Date();
  if (months < 0) return 0;
  if (months === 0) return new Date(now.getFullYear(), 0, 1).getTime();
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

function signalTone(rating: string): string {
  if (rating === "Strong Buy") return "bg-emerald-600 text-white border-emerald-600";
  if (rating === "Buy") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (rating === "Sell") return "bg-red-100 text-red-700 border-red-200";
  if (rating === "Strong Sell") return "bg-red-600 text-white border-red-600";
  return "bg-yellow-100 text-yellow-700 border-yellow-200";
}

interface Row {
  label: string;
  value?: (s: CompareStock) => number | null;
  fmt?: (v: number) => string;
  node?: (s: CompareStock) => ReactNode;
  text?: (s: CompareStock) => string;
  better?: "high" | "low";
}
interface Group { title: string; rows: Row[]; }

function cellText(row: Row, s: CompareStock): string {
  if (row.text) return row.text(s);
  if (row.value) { const v = row.value(s); return v == null ? DASH : (row.fmt ? row.fmt(v) : String(v)); }
  return DASH;
}
function cellNode(row: Row, s: CompareStock): ReactNode {
  if (row.node) return row.node(s);
  if (row.value) { const v = row.value(s); return v == null ? DASH : (row.fmt ? row.fmt(v) : String(v)); }
  return DASH;
}

// Plain-language comparison of the selected stocks' returns.
function buildPerfNarrative(stocks: CompareStock[]): string | null {
  const withPerf = stocks.filter((s) => s.performance);
  if (withPerf.length < 2) return null;
  const parts: string[] = [];

  const y1 = withPerf.filter((s) => s.performance!.y1 != null)
    .sort((a, b) => (b.performance!.y1!) - (a.performance!.y1!));
  if (y1.length >= 2) {
    const best = y1[0];
    const worst = y1[y1.length - 1];
    const middle = y1.slice(1, -1).map((s) => `${s.ticker} ${signed(s.performance!.y1)}`).join(", ");
    parts.push(
      `In the past year, ${best.ticker} returned the most (${signed(best.performance!.y1)}), versus ${worst.ticker} (${signed(worst.performance!.y1)})${middle ? `, with ${middle}` : ""}.`
    );
  }

  const windows: { key: "y10Annualized" | "y5Annualized" | "y3Annualized"; years: number }[] = [
    { key: "y10Annualized", years: 10 },
    { key: "y5Annualized", years: 5 },
    { key: "y3Annualized", years: 3 },
  ];
  const candidates = windows
    .map((w) => ({
      ...w,
      have: withPerf
        .filter((s) => s.performance![w.key] != null)
        .sort((a, b) => (b.performance![w.key]!) - (a.performance![w.key]!)),
    }))
    .filter((w) => w.have.length >= 2)
    .sort((a, b) => (b.have.length - a.have.length) || (b.years - a.years));
  if (candidates.length) {
    const w = candidates[0];
    parts.push(`Over the past ${w.years} years, annualized returns were ${w.have.map((s) => `${s.ticker} ${signed(s.performance![w.key])}`).join(", ")}.`);
  }

  if (parts.length === 0) return null;
  parts.push("Returns use adjusted closes (splits, and reinvested dividends where available).");
  return parts.join(" ");
}

interface Quick { label: string; ticker: string; value: number; fmt: (v: number) => string; }
function buildQuickTake(data: CompareStock[]): Quick[] {
  const pick = (label: string, fn: (s: CompareStock) => number | null, dir: "high" | "low", fmt: (v: number) => string): Quick | null => {
    const withV = data.map((s) => ({ s, v: fn(s) })).filter((x) => x.v != null && isFinite(x.v)) as { s: CompareStock; v: number }[];
    if (withV.length < 2) return null;
    withV.sort((a, b) => (dir === "high" ? b.v - a.v : a.v - b.v));
    return { label, ticker: withV[0].s.ticker, value: withV[0].v, fmt };
  };
  return [
    pick("Cheapest (lowest P/E)", (s) => (s.metrics.pe && s.metrics.pe > 0 ? s.metrics.pe : null), "low", ratio),
    pick("Fastest revenue growth", (s) => s.metrics.revenueGrowth, "high", (v) => pct(v)),
    pick("Highest dividend yield", (s) => s.metrics.dividendYield, "high", (v) => pct(v)),
    pick("Best 1-year return", (s) => s.performance?.y1 ?? null, "high", (v) => signed(v)),
    pick("Lowest volatility", (s) => s.risk?.volatility ?? null, "low", (v) => pct(v)),
    pick("Highest overall grade", (s) => s.signal?.overall ?? null, "high", (v) => String(Math.round(v))),
  ].filter((x): x is Quick => x != null);
}

export function ComparePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { list: selected, add, remove, clear } = useCompare();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [data, setData] = useState<CompareStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<PeriodKey>("1y");
  const [metric, setMetric] = useState<string>("totalReturn");
  const [metricOpen, setMetricOpen] = useState(false);
  const [fin, setFin] = useState<Record<string, any>>({});
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const selKey = selected.join(",");

  // Seed the list from a shared ?symbols= link.
  useEffect(() => {
    const q = searchParams.get("symbols");
    if (q) q.split(",").forEach((s) => add(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticker search (public endpoint, debounced)
  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/stocks/search?q=${encodeURIComponent(q)}`);
        const j = r.ok ? await r.json() : [];
        setResults(Array.isArray(j) ? j.slice(0, 8) : []);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(id);
  }, [search]);

  const addTicker = (raw: string) => { add(raw); setSearch(""); setResults([]); };

  // Fetch the normalized comparison payload
  useEffect(() => {
    if (selected.length < 2) { setData([]); setError(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    authFetch(`${API_URL}/compare?symbols=${encodeURIComponent(selKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? "An active subscription is required." : `Request failed (${r.status})`))))
      .then((j) => { if (!cancelled) setData(Array.isArray(j.stocks) ? j.stocks : []); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load comparison"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selKey]);

  // Fetch each ticker's financial history (dated key-metric / statement points)
  // when a fundamental metric is selected. Price metrics don't need it.
  const metricDef = metricById(metric);
  useEffect(() => {
    if (metricDef.source === "price") return;
    const needed = data.map((s) => s.ticker);
    if (needed.every((t) => fin[t])) return;
    let cancelled = false;
    Promise.all(
      needed.map(async (t) => {
        if (fin[t]) return [t, fin[t]] as const;
        try {
          const r = await authFetch(`${API_URL}/financials/${t}?period=annual&limit=12`);
          const j = r.ok ? await r.json() : null;
          return [t, j?.data ?? null] as const;
        } catch { return [t, null] as const; }
      })
    ).then((entries) => { if (!cancelled) setFin((f) => ({ ...f, ...Object.fromEntries(entries) })); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, selKey]);

  // Chart series: price-derived (daily bars) or fundamental (dated history points),
  // each normalized to % change from the window start (or $10K for growth).
  useEffect(() => {
    if (data.length === 0) { setChartData([]); return; }
    let cancelled = false;
    setChartLoading(true);
    const period = PERIODS.find((p) => p.k === range) || PERIODS[4];
    const cutoff = cutoffTs(period.months);
    const build = async (): Promise<Array<{ t: string; pts: Array<{ date: string; v: number }> }>> => {
      if (metricDef.source === "price") {
        return Promise.all(
          data.map(async (s) => {
            const sym = s.market === "NSE" ? `${s.ticker}.NSE` : s.ticker;
            const r = s.market === "NSE" && !NSE_OK.has(range) ? "1y" : period.fetch;
            try {
              const bars = await fetchStockHistory(sym, r);
              const pts = bars
                .filter((b) => b.close != null && b.date && new Date(b.date).getTime() >= cutoff)
                .map((b) => ({ date: b.date, v: b.close as number }));
              return { t: s.ticker, pts };
            } catch { return { t: s.ticker, pts: [] as Array<{ date: string; v: number }> }; }
          })
        );
      }
      const arrKey = metricDef.source === "keyMetrics" ? "keyMetricsHistory"
        : metricDef.source === "income" ? "incomeStatementHistory"
        : metricDef.source === "cashflow" ? "cashFlowStatementHistory" : "balanceSheetHistory";
      return data.map((s) => {
        const arr = fin[s.ticker]?.[arrKey] || [];
        const pts = arr
          .map((o: any) => ({ date: o.date, v: metricDef.get ? metricDef.get(o) : null }))
          .filter((p: any) => p.date && p.v != null && isFinite(p.v) && p.v !== 0 && new Date(p.date).getTime() >= cutoff);
        return { t: s.ticker, pts };
      });
    };
    build().then((series) => {
      if (cancelled) return;
      const byDate = new Map<string, any>();
      for (const { t, pts } of series) {
        if (!pts || pts.length === 0) continue;
        const base = pts[0].v;
        if (!base) continue;
        for (const p of pts) {
          if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date });
          const growth10k = metricDef.id === "growth10k";
          byDate.get(p.date)![t] = growth10k ? (10000 * p.v) / base : ((p.v / base) - 1) * 100;
        }
      }
      setChartData([...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));
    }).finally(() => { if (!cancelled) setChartLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range, metric, selKey]);

  const hasNse = data.some((s) => s.market === "NSE");
  const visiblePeriods = PERIODS.filter((p) => !hasNse || NSE_OK.has(p.k));
  useEffect(() => {
    if (hasNse && !NSE_OK.has(range)) setRange("1y");
  }, [hasNse, range]);

  const groups = useMemo((): Group[] => ([
    {
      title: "Snapshot",
      rows: [
        { label: "Price", node: (s) => <span className="font-semibold">{money(s.quote.price, s.currency)}</span>, text: (s) => money(s.quote.price, s.currency) },
        {
          label: "Change", value: (s) => s.quote.change, fmt: (v) => signed(v), better: "high",
          node: (s) => {
            const c = s.quote.change;
            if (c == null) return DASH;
            return (
              <span className={c >= 0 ? "text-emerald-600" : "text-red-500"}>
                {c >= 0 ? <TrendingUp className="inline size-3" /> : <TrendingDown className="inline size-3" />} {signed(c)}
              </span>
            );
          },
          text: (s) => signed(s.quote.change),
        },
        { label: "Volume", value: (s) => s.quote.volume, fmt: (v) => formatCompactNumber(v) },
        { label: "Market Cap", value: (s) => s.quote.marketCap, fmt: (v) => formatCompactNumber(v) },
        { label: "Day Range", text: (s) => (s.quote.dayLow == null || s.quote.dayHigh == null ? DASH : `${money(s.quote.dayLow, s.currency)} – ${money(s.quote.dayHigh, s.currency)}`), node: (s) => (s.quote.dayLow == null || s.quote.dayHigh == null ? DASH : `${money(s.quote.dayLow, s.currency)} – ${money(s.quote.dayHigh, s.currency)}`) },
        { label: "52-Week Range", text: (s) => (s.risk?.low52 == null || s.risk?.high52 == null ? DASH : `${money(s.risk.low52, s.currency)} – ${money(s.risk.high52, s.currency)}`), node: (s) => (s.risk?.low52 == null || s.risk?.high52 == null ? DASH : `${money(s.risk.low52, s.currency)} – ${money(s.risk.high52, s.currency)}`) },
      ],
    },
    {
      title: "Performance",
      rows: [
        { label: "1-Year Return", value: (s) => s.performance?.y1 ?? null, fmt: (v) => signed(v), better: "high",
          node: (s) => { const v = s.performance?.y1 ?? null; return v == null ? DASH : <span className={v >= 0 ? "text-emerald-600" : "text-red-500"}>{signed(v)}</span>; } },
        { label: "YTD Return", value: (s) => s.performance?.ytd ?? null, fmt: (v) => signed(v), better: "high",
          node: (s) => { const v = s.performance?.ytd ?? null; return v == null ? DASH : <span className={v >= 0 ? "text-emerald-600" : "text-red-500"}>{signed(v)}</span>; } },
        { label: "3-Year (annualized)", value: (s) => s.performance?.y3Annualized ?? null, fmt: (v) => signed(v), better: "high" },
        { label: "5-Year (annualized)", value: (s) => s.performance?.y5Annualized ?? null, fmt: (v) => signed(v), better: "high" },
        { label: "10-Year (annualized)", value: (s) => s.performance?.y10Annualized ?? null, fmt: (v) => signed(v), better: "high" },
      ],
    },
    {
      title: "Risk",
      rows: [
        { label: "Volatility (ann.)", value: (s) => s.risk?.volatility ?? null, fmt: (v) => pct(v), better: "low" },
        { label: "Max Drawdown (1Y)", value: (s) => s.risk?.maxDrawdown1y ?? null, fmt: (v) => pct(v), better: "low" },
        { label: "From 52W High", value: (s) => s.risk?.fromHigh52 ?? null, fmt: (v) => signed(v), better: "high" },
      ],
    },
    {
      title: "Signal",
      rows: [
        { label: "Rating", text: (s) => s.signal?.rating || DASH, node: (s) => (s.signal ? <Badge variant="outline" className={signalTone(s.signal.rating)}>{s.signal.rating}</Badge> : DASH) },
        { label: "Confidence", value: (s) => s.signal?.confidence ?? null, fmt: (v) => `${Math.round(v)}%`, better: "high" },
        { label: "Type", text: (s) => s.signal?.type || DASH },
        { label: "Holding Period", text: (s) => s.signal?.timeframe || DASH },
        {
          label: "Upside to Target 1", value: (s) => (s.signal?.target1 != null && s.quote.price ? ((s.signal.target1 / s.quote.price) - 1) * 100 : null), fmt: (v) => signed(v), better: "high",
          node: (s) => {
            const v = s.signal?.target1 != null && s.quote.price ? ((s.signal.target1 / s.quote.price) - 1) * 100 : null;
            return v == null ? DASH : <span className="text-emerald-600">{signed(v)}</span>;
          },
        },
        { label: "Risk / Reward", value: (s) => s.signal?.riskReward ?? null, fmt: (v) => `1:${v.toFixed(1)}`, better: "high" },
      ],
    },
    {
      title: "Valuation",
      rows: [
        { label: "P/E", value: (s) => s.metrics.pe, fmt: ratio, better: "low" },
        { label: "P/B", value: (s) => s.metrics.pb, fmt: ratio, better: "low" },
        { label: "EV/EBITDA", value: (s) => s.metrics.evEbitda, fmt: ratio, better: "low" },
        { label: "Dividend Yield", value: (s) => s.metrics.dividendYield, fmt: (v) => pct(v), better: "high" },
        { label: "Payout Ratio", value: (s) => s.metrics.payoutRatio, fmt: (v) => pct(v, 0) },
      ],
    },
    {
      title: "Growth",
      rows: [
        { label: "Revenue Growth", value: (s) => s.metrics.revenueGrowth, fmt: (v) => pct(v), better: "high" },
        { label: "EPS Growth", value: (s) => s.metrics.epsGrowth, fmt: (v) => pct(v), better: "high" },
        { label: "Earnings Surprise", value: (s) => s.metrics.epsSurprise, fmt: (v) => pct(v), better: "high" },
        { label: "Margin Change", value: (s) => s.metrics.marginChange, fmt: (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}pp`, better: "high" },
      ],
    },
    {
      title: "Profitability",
      rows: [
        { label: "Return on Equity", value: (s) => s.metrics.roe, fmt: (v) => pct(v), better: "high" },
        { label: "FCF Yield", value: (s) => s.metrics.fcfYield, fmt: (v) => pct(v), better: "high" },
      ],
    },
    {
      title: "Balance Sheet",
      rows: [
        { label: "Debt / Equity", value: (s) => s.metrics.debtEquity, fmt: ratio, better: "low" },
        { label: "Current Ratio", value: (s) => s.metrics.currentRatio, fmt: ratio, better: "high" },
        { label: "Altman Z-Score", value: (s) => s.metrics.altmanZ, fmt: ratio, better: "high" },
      ],
    },
    {
      title: "Technicals",
      rows: [
        { label: "RSI", value: (s) => s.technicals.rsi, text: (s) => (s.technicals.rsi == null ? DASH : `${s.technicals.rsi.toFixed(1)}${s.technicals.rsiSignal ? ` · ${s.technicals.rsiSignal}` : ""}`) },
        { label: "MACD", text: (s) => s.technicals.macdSignal || DASH },
        { label: "Trend", text: (s) => s.technicals.trendSignal || DASH },
        { label: "Momentum", text: (s) => (s.technicals.momentum ? `${s.technicals.momentum}${s.technicals.momentumSignal ? ` · ${s.technicals.momentumSignal}` : ""}` : DASH) },
        { label: "Volume", text: (s) => s.technicals.volumeSignal || DASH },
      ],
    },
  ]), []);

  const radarData = useMemo(() => {
    const dims = [
      { key: "overall", label: "Overall" },
      { key: "fundamental", label: "Fundamental" },
      { key: "technical", label: "Technical" },
      { key: "financial", label: "Financial" },
      { key: "macro", label: "Macro" },
      { key: "insider", label: "Insider" },
    ] as const;
    return dims.map((d) => {
      const row: Record<string, number | string> = { dimension: d.label };
      data.forEach((s) => { row[s.ticker] = s.signal ? Number((s.signal as any)[d.key] ?? 0) : 0; });
      return row;
    });
  }, [data]);

  const quickTake = useMemo(() => buildQuickTake(data), [data]);

  const exportCsv = () => {
    const header = ["Metric", ...data.map((s) => `${s.ticker} (${s.currency})`)];
    const lines = [header.map((h) => `"${h}"`).join(",")];
    for (const g of groups) {
      for (const row of g.rows) {
        lines.push([`"${g.title} - ${row.label}"`, ...data.map((s) => `"${cellText(row, s).replace(/"/g, '""')}"`)].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compare-${data.map((s) => s.ticker).join("-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const share = () => {
    const url = `${window.location.origin}/app/compare?symbols=${selected.join(",")}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white shadow-sm">
          <GitCompare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">Compare Stocks</h1>
          <p className="text-xs text-muted-foreground">Compare up to 5 African (NSE) and global stocks across valuation, growth, profitability, balance sheet, risk, momentum, technicals and AI signals — with best-in-row highlights, relative performance and a quick-take verdict to support informed decisions.</p>
        </div>
        {data.length >= 2 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-3.5" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={share}>{copied ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />} {copied ? "Copied" : "Share"}</Button>
          </div>
        )}
      </div>

      {/* Picker */}
      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selected.length >= MAX_STOCKS ? "Maximum 5 stocks" : "Search a ticker or company (e.g. SCOM, AAPL)…"}
            disabled={selected.length >= MAX_STOCKS}
            className="pl-9"
          />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-72 overflow-auto">
              {results.map((r) => (
                <button
                  key={r.ticker}
                  type="button"
                  onClick={() => addTicker(r.ticker)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{r.ticker}</span>
                    <span className="ml-2 text-xs text-muted-foreground truncate">{r.name}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {r.market && <Badge variant="outline" className="text-[10px]">{String(r.market).toUpperCase()}</Badge>}
                    <Plus className="size-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selected.length === 0 && <span className="text-xs text-muted-foreground">Add stocks, or try:</span>}
          {selected.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-[#0D7490]/30 bg-[#0D7490]/5 px-3 py-1 text-xs font-medium text-foreground">
              {t}
              <button type="button" onClick={() => remove(t)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {selected.length === 0 && SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => addTicker(s)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
              {s}
            </button>
          ))}
          {selected.length > 1 && (
            <button type="button" onClick={() => clear()} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          )}
        </div>
      </Card>

      {selected.length < 2 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Select at least <span className="font-medium text-foreground">2 stocks</span> to compare.
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Building comparison…
        </div>
      )}

      {error && !loading && (
        <Card className="p-4 text-sm text-red-600 border-red-200 bg-red-50">{error}</Card>
      )}

      {!loading && !error && data.length >= 2 && (
        <>
          {/* Quick take */}
          {quickTake.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="size-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-foreground">Quick take</h2>
                <span className="text-[10px] text-muted-foreground italic">best pick per metric</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {quickTake.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => navigate(`/app/stock/${q.ticker}?market=${data.find((d) => d.ticker === q.ticker)?.market === "NSE" ? "nse" : "us"}`)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted transition-colors"
                  >
                    <span className="text-[11px] text-muted-foreground">{q.label}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-foreground">{q.ticker}</span>
                      <Badge className="border-0 bg-emerald-100 text-emerald-700">{q.fmt(q.value)}</Badge>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Chart + Radar */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="p-4 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {metricDef.id === "growth10k" ? "Growth of $10K" : "Relative Performance"}
                  {metricDef.id !== "growth10k" && <span className="text-muted-foreground font-normal"> (% change)</span>}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Metric dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMetricOpen((o) => !o)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {metricDef.label}
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </button>
                    {metricOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMetricOpen(false)} />
                        <div className="absolute right-0 z-40 mt-1 w-64 max-h-80 overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                          {METRIC_GROUPS.map((g) => (
                            <div key={g.group}>
                              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">{g.group}</p>
                              {g.metrics.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => { setMetric(m.id); setMetricOpen(false); }}
                                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted ${m.id === metric ? "font-semibold text-[#0D7490]" : "text-foreground"}`}
                                >
                                  {m.label}
                                  {m.id === metric && <Check className="size-3.5" />}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Period buttons */}
                  {visiblePeriods.map((p) => (
                    <button
                      key={p.k}
                      type="button"
                      onClick={() => setRange(p.k)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === p.k ? "bg-[#0D7490] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                {chartLoading ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
                ) : chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data available for this metric.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (metricDef.id === "growth10k" ? `$${Math.round(v).toLocaleString()}` : `${Math.round(v)}%`)} />
                      <Tooltip formatter={(v: any) => (metricDef.id === "growth10k" ? money(v, "USD") : `${Number(v).toFixed(2)}%`)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {data.map((s, i) => (
                        <Line key={s.ticker} type="monotone" dataKey={s.ticker} name={s.ticker} stroke={CHART_COLORS[i % CHART_COLORS.length]} dot={false} strokeWidth={2} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">Score Profile</h2>
              <p className="text-[10px] text-muted-foreground mb-2">Model grades across each dimension (0–100)</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10 }} />
                    {data.map((s, i) => (
                      <Radar key={s.ticker} name={s.ticker} dataKey={s.ticker} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.12} strokeWidth={2} />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Narrative */}
          {(() => {
            const narrative = buildPerfNarrative(data);
            return narrative ? <Card className="p-4 text-sm text-muted-foreground leading-relaxed">{narrative}</Card> : null;
          })()}

          {/* Metric matrix */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-card p-3 text-left text-xs font-semibold text-muted-foreground min-w-[7.5rem] sm:min-w-[10rem]">Metric</th>
                    {data.map((s) => (
                      <th key={s.ticker} className="p-3 text-left align-top min-w-[8rem] sm:min-w-[9.5rem]">
                        <button type="button" onClick={() => navigate(`/app/stock/${s.ticker}?market=${s.market === "NSE" ? "nse" : "us"}`)} className="text-left group">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground group-hover:text-[#0D7490]">{s.ticker}</span>
                            <Badge variant="outline" className="text-[9px]">{s.market}</Badge>
                          </div>
                          <div className="text-[11px] font-normal text-muted-foreground truncate max-w-[9rem]">{s.name}</div>
                        </button>
                        <button type="button" onClick={() => remove(s.ticker)} className="mt-1 text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                          <X className="size-3" /> remove
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.title}>
                      <tr className="bg-muted/50">
                        <td colSpan={data.length + 1} className="sticky left-0 p-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</td>
                      </tr>
                      {g.rows.map((row) => {
                        const vals = data.map((s) => (row.value ? row.value(s) : null));
                        const nonNull = vals.filter((v) => v != null && isFinite(v)) as number[];
                        let bestIdx = -1, worstIdx = -1;
                        if (row.better && nonNull.length >= 2) {
                          const bv = row.better === "high" ? Math.max(...nonNull) : Math.min(...nonNull);
                          const wv = row.better === "high" ? Math.min(...nonNull) : Math.max(...nonNull);
                          if (bv !== wv) { bestIdx = vals.indexOf(bv); worstIdx = vals.indexOf(wv); }
                        }
                        return (
                          <tr key={`${g.title}-${row.label}`} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="sticky left-0 z-10 bg-card p-2.5 px-3 text-xs text-muted-foreground">{row.label}</td>
                            {data.map((s, i) => (
                              <td key={s.ticker} className={`p-2.5 pr-4 text-sm ${i === bestIdx ? "text-emerald-600 font-semibold" : i === worstIdx ? "text-red-500" : "text-foreground"}`}>
                                {i === bestIdx && <Trophy className="inline size-3 mr-1 -mt-0.5 text-amber-500" />}
                                {cellNode(row, s)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="p-3 text-[10px] text-muted-foreground border-t border-border flex items-center gap-1.5">
              <Trophy className="size-3 text-amber-500" /> marks the best value in a row. Green = best, red = worst.
              {data.some((s) => s.metrics.dataSource === "fallback") && " Some ratios are curated estimates where live fundamentals are unavailable."}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
