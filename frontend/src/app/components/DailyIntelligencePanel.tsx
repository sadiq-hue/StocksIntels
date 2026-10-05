import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Newspaper, RefreshCw, Loader2, Globe2, ArrowUpRight, Clock3 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// Mirrors the email digest payload from generateDailyBriefContent().
interface BriefIndex { label: string; value: string; change: string; keyDriver?: string | null }
interface BriefMover { symbol: string; company: string; change: string; volume: string }
export interface DailyBrief {
  indices?: BriefIndex[];
  globalIndices?: BriefIndex[];
  yesterdayTopMovers?: BriefMover[];
  aiSignal?: string;
  aiSignalContext?: string;
  globalToNseConnection?: string;
  analystTake?: string;
  cached?: boolean;
  stale?: boolean;
  generatedAt?: number;
}

/** "+1.24%" -> up. Returns null for "--" so we can render a dash instead of 0. */
function changeTone(change: string | undefined | null): { cls: string; arrow: string } | null {
  if (!change || change === "--" || !change.includes("%")) return null;
  const n = parseFloat(change.replace("%", ""));
  if (!isFinite(n)) return null;
  if (n === 0) return { cls: "text-muted-foreground", arrow: "→" };
  return n > 0
    ? { cls: "text-emerald-600", arrow: "▲" }
    : { cls: "text-red-500", arrow: "▼" };
}

function IndexTile({ idx }: { idx: BriefIndex }) {
  const t = changeTone(idx.change);
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{idx.label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-sm font-bold tabular-nums text-foreground">{idx.value}</span>
        {t && <span className={`text-[11px] font-semibold ${t.cls}`}>{t.arrow} {idx.change}</span>}
      </div>
      {idx.keyDriver && (
        <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{idx.keyDriver}</div>
      )}
    </div>
  );
}

export function DailyIntelligencePanel() {
  const [data, setData] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(`${API_URL}/market/daily-brief${force ? "?refresh=1" : ""}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      setData(await r.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the daily brief");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const generatedLabel = (() => {
    if (!data?.generatedAt) return null;
    const mins = Math.max(0, Math.round((Date.now() - data.generatedAt) / 60000));
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  })();

  if (loading && !data) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading today&apos;s market intelligence…
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-sm text-red-600">{error}</p>
          <Button variant="outline" size="sm" onClick={() => load(true)}>
            <RefreshCw className="size-3.5" /> Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const africa = (data.indices || []).filter((i) => /NSE|NASI|USD/i.test(i.label));
  const global = data.globalIndices || [];
  const movers = (data.yesterdayTopMovers || []).filter((m) => m && m.symbol && m.symbol !== "--");

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] px-4 py-3 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <Newspaper className="size-4" />
          <h2 className="flex-1 text-sm font-semibold">Today&apos;s Market Intelligence</h2>
          {generatedLabel && (
            <span className="inline-flex items-center gap-1 text-[10px] text-white/80">
              <Clock3 className="size-3" /> {generatedLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[11px] font-medium hover:bg-white/25 disabled:opacity-60"
          >
            <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        {data.stale && (
          <p className="mt-1 text-[10.5px] text-amber-100">
            Showing the last successful brief — today&apos;s regeneration failed.
          </p>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* Index strip */}
        {(africa.length > 0 || global.length > 0) && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="lg:col-span-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Globe2 className="size-3" /> Where markets stand
            </div>
            {global.map((i) => <IndexTile key={`g-${i.label}`} idx={i} />)}
            {africa.map((i) => <IndexTile key={`a-${i.label}`} idx={i} />)}
          </div>
        )}

        {/* The read */}
        {data.aiSignal && (
          <div className="rounded-xl border border-[#0D7490]/20 bg-[#0D7490]/5 p-3">
            <p className="text-[11px] font-semibold text-[#0D7490]">The read</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground">{data.aiSignal}</p>
            {data.aiSignalContext && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{data.aiSignalContext}</p>
            )}
          </div>
        )}

        {/* Stocks requiring attention */}
        {movers.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Stocks requiring attention
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {movers.map((m) => {
                const t = changeTone(m.change);
                const isNse = /^(NSE:|KES)/i.test(m.symbol) || m.volume?.includes("KES");
                const sym = m.symbol.replace(/^NSE:/i, "");
                return (
                  <Link
                    key={m.symbol}
                    to={`/app/stock/${sym}?market=${isNse ? "nse" : "us"}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-2.5 py-2 hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">{sym}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{m.company}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${t?.cls || "text-muted-foreground"}`}>
                      {t?.arrow ? `${t.arrow} ` : ""}{m.change}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* What a global move means locally */}
        {data.globalToNseConnection && (
          <div className="rounded-xl border border-border bg-muted/25 p-3">
            <p className="text-[11px] font-semibold text-foreground">What this means for Kenya</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{data.globalToNseConnection}</p>
          </div>
        )}

        {data.analystTake && (
          <div className="rounded-xl border border-border bg-muted/25 p-3">
            <p className="text-[11px] font-semibold text-foreground">Analyst take</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{data.analystTake}</p>
          </div>
        )}

        <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
          A summary of the market data we track, regenerated every 15 minutes. It
          describes what is happening — it is not investment advice.
        </p>
      </div>
    </Card>
  );
}
