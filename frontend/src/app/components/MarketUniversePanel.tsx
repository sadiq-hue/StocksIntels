import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, Database, ExternalLink } from "lucide-react";
import { Card } from "./ui/card";
import { currencyPrefix } from "../utils/currency";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type Snapshot = {
  ticker: string;
  name?: string | null;
  market?: string | null;
  sector?: string | null;
  tier?: string | null;
  signal?: string | null;
  action?: string | null;
  confidence?: number | null;
  score?: number | null;
  price?: number | null;
  entry?: number | null;
  horizon?: string | null;
  timeframe?: string | null;
  catalyst?: { type?: string; direction?: string } | null;
  news_summary?: { count?: number } | null;
  analyzed_at?: string | null;
};

type Coverage = {
  total: number;
  freshLastHour: number;
  byAction?: Record<string, number>;
  byMarket?: Record<string, number>;
  byTier?: Record<string, number>;
};

const currencyFor = (market?: string | null) => {
  const m = String(market || "").toUpperCase();
  return m === "NSE" ? "KES" : m === "NGX" ? "NGN" : m === "JSE" ? "ZAR" : "USD";
};

const ago = (iso?: string | null) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const signalTone = (s?: string | null) => {
  const v = String(s || "").toLowerCase();
  if (v.includes("strong buy") || v === "buy") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (v.includes("sell")) return "text-red-700 bg-red-50 border-red-200";
  return "text-muted-foreground bg-muted/50 border-border";
};

export function MarketUniversePanel() {
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [market, setMarket] = useState("all");
  const [action, setAction] = useState("all");
  const [minScore, setMinScore] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ page: String(page), limit: String(limit), market, action, sort: "score" });
    if (minScore !== "all") qs.set("minScore", minScore);
    Promise.all([
      fetch(`${API_BASE}/market/intelligence?${qs}`, { signal: controller.signal }).then(r => {
        if (!r.ok) throw new Error("Failed to load market intelligence");
        return r.json();
      }),
      fetch(`${API_BASE}/market/intelligence/coverage`, { signal: controller.signal })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ])
      .then(([data, cov]) => {
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setTotal(Number(data?.total) || 0);
        if (cov) setCoverage(cov);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError(e?.message || "Universe data unavailable");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page, limit, market, action, minScore]);

  useEffect(() => { setPage(1); }, [market, action, minScore, limit]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const range = useMemo(() => {
    if (!total) return "0 results";
    const from = (page - 1) * limit + 1;
    const to = Math.min(total, page * limit);
    return `${from}–${to} of ${total.toLocaleString()}`;
  }, [page, limit, total]);

  return (
    <Card className="border shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-[#0D7490]/15 flex items-center justify-center">
            <Database className="size-4 text-[#0D7490]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Universe Intelligence</h3>
            <p className="text-[11px] text-muted-foreground">
              Latest scored snapshot per symbol · {coverage ? `${coverage.total.toLocaleString()} analyzed · ${coverage.freshLastHour.toLocaleString()} fresh this hour` : "loading coverage…"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select aria-label="Market filter" value={market} onChange={e => setMarket(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
            <option value="all">All markets</option>
            <option value="Global">Global</option>
            <option value="NSE">NSE</option>
            <option value="NGX">NGX</option>
            <option value="JSE">JSE</option>
          </select>
          <select aria-label="Signal filter" value={action} onChange={e => setAction(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
            <option value="all">All signals</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="hold">Hold</option>
          </select>
          <select aria-label="Minimum score" value={minScore} onChange={e => setMinScore(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
            <option value="all">Any score</option>
            <option value="60">60+</option>
            <option value="70">70+</option>
            <option value="80">80+</option>
          </select>
          <select aria-label="Rows per page" value={limit} onChange={e => setLimit(Number(e.target.value))} className="h-8 rounded-md border border-border bg-background px-2">
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
      </div>

      {error && <p className="px-4 py-3 text-xs text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Signal</th>
              <th className="px-3 py-2 font-medium text-right">Score</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium">Catalyst</th>
              <th className="px-3 py-2 font-medium text-right">Analyzed</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading latest universe snapshots…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No analyzed symbols match these filters yet. The engine will populate them as it rotates through the universe.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.ticker} className="border-t border-border/40 hover:bg-muted/20">
                <td className="px-4 py-2">
                  <div className="font-semibold text-foreground">{r.ticker}</div>
                  <div className="max-w-[240px] truncate text-[11px] text-muted-foreground">{r.name || r.sector || "—"}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.market || "—"}{r.sector ? ` · ${r.sector}` : ""}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${signalTone(r.signal)}`}>
                    {r.signal || "—"}{r.confidence != null ? ` · ${r.confidence}%` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.score ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.price != null ? `${currencyPrefix(currencyFor(r.market))}${Number(r.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</td>
                <td className="px-3 py-2">
                  {r.catalyst?.type ? (
                    <span className={`text-[11px] font-medium ${r.catalyst.direction === "positive" ? "text-emerald-700" : r.catalyst.direction === "negative" ? "text-red-600" : "text-muted-foreground"}`}>
                      {r.catalyst.type}
                    </span>
                  ) : <span className="text-[11px] text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-muted-foreground">{ago(r.analyzed_at)}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/signals?ticker=${encodeURIComponent(r.ticker)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0D7490] hover:underline">
                    Open <ExternalLink className="size-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{range}</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 disabled:opacity-40">
            <ChevronLeft className="size-3.5" /> Prev
          </button>
          <span className="tabular-nums">{page} / {pages}</span>
          <button disabled={page >= pages || loading} onClick={() => setPage(p => Math.min(pages, p + 1))} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 disabled:opacity-40">
            Next <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}
