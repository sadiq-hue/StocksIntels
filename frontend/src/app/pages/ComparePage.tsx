import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate } from "react-router";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { X, Search, GitCompare, TrendingUp, TrendingDown, Loader2, Plus } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { authFetch } from "../auth/tokenStore";
import { useCompare } from "../contexts/CompareContext";
import { fetchStockHistory, type PriceBar } from "../services/marketDataService";
import { formatCompactNumber } from "../utils/format";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const MAX_STOCKS = 5;
const CHART_COLORS = ["#0D7490", "#0EA5E9", "#f59e0b", "#8b5cf6", "#ef4444"];
// MyStocks only serves correct NSE series for 1M, 1Y and 5Y (its 3M/6M/2Y/10Y
// periods all return ~1 month), so the unsupported ones are hidden whenever a
// Kenyan stock is in the mix.
const CHART_RANGES = [
  { k: "1mo", label: "1M" },
  { k: "3mo", label: "3M" },
  { k: "1y", label: "1Y" },
  { k: "2y", label: "2Y" },
  { k: "5y", label: "5Y" },
  { k: "10y", label: "10Y" },
];
const NSE_RANGE_KEYS = new Set(["1mo", "1y", "5y"]);
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
    y1: number | null; y3Annualized: number | null; y5Annualized: number | null; y10Annualized: number | null;
    spanYears: number | null; basis: string | null;
  } | null;
}

interface SearchResult { ticker: string; name: string; sector?: string; market?: string; }

const DASH = "—";
const money = (v: number | null, c: string) =>
  v == null ? DASH : `${c === "KES" ? "KES " : "$"}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ratio = (v: number | null) => (v == null ? DASH : Number(v).toFixed(2));
const pctSuffix = (v: number | null, dp = 1) => (v == null ? DASH : `${Number(v).toFixed(dp)}%`);
const pctSigned = (v: number | null, dp = 2) => (v == null ? DASH : `${v > 0 ? "+" : ""}${Number(v).toFixed(dp)}%`);

function signalTone(rating: string): string {
  if (rating === "Strong Buy") return "bg-emerald-600 text-white border-emerald-600";
  if (rating === "Buy") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (rating === "Sell") return "bg-red-100 text-red-700 border-red-200";
  if (rating === "Strong Sell") return "bg-red-600 text-white border-red-600";
  return "bg-yellow-100 text-yellow-700 border-yellow-200";
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
    const middle = y1.slice(1, -1).map((s) => `${s.ticker} ${pctSigned(s.performance!.y1)}`).join(", ");
    parts.push(
      `In the past year, ${best.ticker} returned the most (${pctSigned(best.performance!.y1)}), versus ${worst.ticker} (${pctSigned(worst.performance!.y1)})${middle ? `, with ${middle}` : ""}.`
    );
  }

  const windows: { key: "y10Annualized" | "y5Annualized" | "y3Annualized"; years: number }[] = [
    { key: "y10Annualized", years: 10 },
    { key: "y5Annualized", years: 5 },
    { key: "y3Annualized", years: 3 },
  ];
  // Prefer the longest window that covers the most of the selected stocks, so a
  // mixed NSE + US list still compares everyone (NSE has up to 5y, US up to 10y).
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
    parts.push(`Over the past ${w.years} years, annualized returns were ${w.have.map((s) => `${s.ticker} ${pctSigned(s.performance![w.key])}`).join(", ")}.`);
  }

  if (parts.length === 0) return null;
  parts.push("Returns use adjusted closes (splits, and reinvested dividends where available).");
  return parts.join(" ");
}

export function ComparePage() {
  const navigate = useNavigate();
  const { list: selected, add, remove, clear } = useCompare();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [data, setData] = useState<CompareStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<string>("1y");
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const selKey = selected.join(",");

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

  // Relative-performance series (normalized to 0% at the first bar)
  useEffect(() => {
    if (data.length === 0) { setChartData([]); return; }
    let cancelled = false;
    setChartLoading(true);
    Promise.all(
      data.map(async (s) => {
        const sym = s.market === "NSE" ? `${s.ticker}.NSE` : s.ticker;
        // NSE serves only 1M/1Y/5Y correctly; fall back for any other range.
        const r = s.market === "NSE" && !NSE_RANGE_KEYS.has(range) ? "1y" : range;
        try { return { t: s.ticker, bars: await fetchStockHistory(sym, r) }; }
        catch { return { t: s.ticker, bars: [] as PriceBar[] }; }
      })
    ).then((series) => {
      if (cancelled) return;
      const byDate = new Map<string, any>();
      for (const { t, bars } of series) {
        if (!bars || bars.length === 0) continue;
        const base = bars[0].close ?? bars.find((b) => b.close != null)?.close ?? null;
        if (!base) continue;
        for (const b of bars) {
          if (b.close == null || !b.date) continue;
          if (!byDate.has(b.date)) byDate.set(b.date, { date: b.date });
          byDate.get(b.date)![t] = ((b.close / base) - 1) * 100;
        }
      }
      setChartData([...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));
    }).finally(() => { if (!cancelled) setChartLoading(false); });
    return () => { cancelled = true; };
  }, [data, range]);

  const hasNse = data.some((s) => s.market === "NSE");
  const visibleRanges = CHART_RANGES.filter((r) => !hasNse || NSE_RANGE_KEYS.has(r.k));
  useEffect(() => {
    if (hasNse && !NSE_RANGE_KEYS.has(range)) setRange("1y");
  }, [hasNse, range]);

  const groups = useMemo(() => ([
    {
      title: "Snapshot",
      rows: [
        { label: "Price", render: (s: CompareStock) => money(s.quote.price, s.currency) },
        {
          label: "Change",
          render: (s: CompareStock) => {
            const c = s.quote.change;
            if (c == null) return DASH;
            return (
              <span className={c >= 0 ? "text-emerald-600" : "text-red-500"}>
                {c >= 0 ? <TrendingUp className="inline size-3" /> : <TrendingDown className="inline size-3" />} {pctSigned(c)}
              </span>
            );
          },
        },
        { label: "Volume", render: (s: CompareStock) => (s.quote.volume == null ? DASH : formatCompactNumber(s.quote.volume)) },
        { label: "Market Cap", render: (s: CompareStock) => (s.quote.marketCap == null ? DASH : formatCompactNumber(s.quote.marketCap)) },
        { label: "Day Range", render: (s: CompareStock) => (s.quote.dayLow == null || s.quote.dayHigh == null ? DASH : `${money(s.quote.dayLow, s.currency)} – ${money(s.quote.dayHigh, s.currency)}`) },
      ],
    },
    {
      title: "Performance",
      rows: [
        { label: "1-Year Return", render: (s: CompareStock) => (s.performance?.y1 == null ? DASH : <span className={s.performance.y1 >= 0 ? "text-emerald-600" : "text-red-500"}>{pctSigned(s.performance.y1)}</span>) },
        { label: "3-Year (annualized)", render: (s: CompareStock) => pctSigned(s.performance?.y3Annualized ?? null) },
        { label: "5-Year (annualized)", render: (s: CompareStock) => pctSigned(s.performance?.y5Annualized ?? null) },
        { label: "10-Year (annualized)", render: (s: CompareStock) => pctSigned(s.performance?.y10Annualized ?? null) },
      ],
    },
    {
      title: "Signal",
      rows: [
        { label: "Rating", render: (s: CompareStock) => (s.signal ? <Badge variant="outline" className={signalTone(s.signal.rating)}>{s.signal.rating}</Badge> : DASH) },
        { label: "Confidence", render: (s: CompareStock) => (s.signal?.confidence == null ? DASH : `${s.signal.confidence}%`) },
        { label: "Type", render: (s: CompareStock) => s.signal?.type || DASH },
        { label: "Holding Period", render: (s: CompareStock) => s.signal?.timeframe || DASH },
        { label: "Risk / Reward", render: (s: CompareStock) => (s.signal?.riskReward == null ? DASH : `1:${s.signal.riskReward.toFixed(1)}`) },
        { label: "Target 1", render: (s: CompareStock) => money(s.signal?.target1 ?? null, s.currency) },
        { label: "Stop", render: (s: CompareStock) => money(s.signal?.stopLoss ?? null, s.currency) },
      ],
    },
    {
      title: "Valuation",
      rows: [
        { label: "P/E", render: (s: CompareStock) => ratio(s.metrics.pe) },
        { label: "P/B", render: (s: CompareStock) => ratio(s.metrics.pb) },
        { label: "EV/EBITDA", render: (s: CompareStock) => ratio(s.metrics.evEbitda) },
        { label: "Dividend Yield", render: (s: CompareStock) => pctSuffix(s.metrics.dividendYield) },
        { label: "Payout Ratio", render: (s: CompareStock) => pctSuffix(s.metrics.payoutRatio, 0) },
      ],
    },
    {
      title: "Growth",
      rows: [
        { label: "Revenue Growth", render: (s: CompareStock) => pctSuffix(s.metrics.revenueGrowth) },
        { label: "EPS Growth", render: (s: CompareStock) => pctSuffix(s.metrics.epsGrowth) },
        { label: "Earnings Surprise", render: (s: CompareStock) => pctSuffix(s.metrics.epsSurprise) },
        { label: "Margin Change", render: (s: CompareStock) => (s.metrics.marginChange == null ? DASH : `${s.metrics.marginChange > 0 ? "+" : ""}${Number(s.metrics.marginChange).toFixed(1)}pp`) },
      ],
    },
    {
      title: "Profitability",
      rows: [
        { label: "Return on Equity", render: (s: CompareStock) => pctSuffix(s.metrics.roe) },
        { label: "FCF Yield", render: (s: CompareStock) => pctSuffix(s.metrics.fcfYield) },
      ],
    },
    {
      title: "Balance Sheet",
      rows: [
        { label: "Debt / Equity", render: (s: CompareStock) => ratio(s.metrics.debtEquity) },
        { label: "Current Ratio", render: (s: CompareStock) => ratio(s.metrics.currentRatio) },
        { label: "Altman Z-Score", render: (s: CompareStock) => ratio(s.metrics.altmanZ) },
      ],
    },
    {
      title: "Technicals",
      rows: [
        { label: "RSI", render: (s: CompareStock) => (s.technicals.rsi == null ? DASH : `${s.technicals.rsi.toFixed(1)}${s.technicals.rsiSignal ? ` · ${s.technicals.rsiSignal}` : ""}`) },
        { label: "MACD", render: (s: CompareStock) => s.technicals.macdSignal || DASH },
        { label: "Trend", render: (s: CompareStock) => s.technicals.trendSignal || DASH },
        { label: "Momentum", render: (s: CompareStock) => (s.technicals.momentum ? `${s.technicals.momentum}${s.technicals.momentumSignal ? ` · ${s.technicals.momentumSignal}` : ""}` : DASH) },
        { label: "Volume", render: (s: CompareStock) => s.technicals.volumeSignal || DASH },
      ],
    },
  ]), []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white shadow-sm">
          <GitCompare className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Compare Stocks</h1>
          <p className="text-xs text-muted-foreground">Put 2–5 NSE or global stocks side by side — valuation, growth, profitability, technicals and signals.</p>
        </div>
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
          {/* Relative performance */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Relative Performance <span className="text-muted-foreground font-normal">(% change)</span></h2>
              <div className="flex gap-1">
                {visibleRanges.map((r) => (
                  <button
                    key={r.k}
                    type="button"
                    onClick={() => setRange(r.k)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === r.k ? "bg-[#0D7490] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-64">
              {chartLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
              ) : chartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No price history available.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: any) => `${Number(v).toFixed(2)}%`}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.map((s, i) => (
                      <Line key={s.ticker} type="monotone" dataKey={s.ticker} name={s.ticker} stroke={CHART_COLORS[i % CHART_COLORS.length]} dot={false} strokeWidth={2} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {(() => {
            const narrative = buildPerfNarrative(data);
            return narrative ? (
              <Card className="p-4 text-sm text-muted-foreground leading-relaxed">{narrative}</Card>
            ) : null;
          })()}

          {/* Metric matrix */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-card p-3 text-left text-xs font-semibold text-muted-foreground min-w-[10rem]">Metric</th>
                    {data.map((s) => (
                      <th key={s.ticker} className="p-3 text-left align-top min-w-[9.5rem]">
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
                      {g.rows.map((row) => (
                        <tr key={`${g.title}-${row.label}`} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-card p-2.5 px-3 text-xs text-muted-foreground">{row.label}</td>
                          {data.map((s) => (
                            <td key={s.ticker} className="p-2.5 pr-4 text-sm text-foreground">{row.render(s)}</td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {data.some((s) => s.metrics.dataSource === "fallback") && (
              <p className="p-3 text-[10px] text-muted-foreground border-t border-border">
                Some ratios are curated estimates (live fundamentals unavailable for those names).
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
