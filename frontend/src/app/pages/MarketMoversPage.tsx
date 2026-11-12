"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useSearchParams, useNavigate } from "react-router";
import {
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  DollarSign,
  Flame,
  Loader2,
  Moon,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useAuth } from "../auth/AuthContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

type TabId = "gainers" | "losers" | "active" | "premarket" | "afterhours" | "heatmap";

interface MoverRow {
  ticker: string;
  symbol: string;
  name: string;
  price: number;
  change?: string;
  changePercent: number;
  isPositive: boolean;
  volume: string;
  marketCap: number;
  currency: string;
  market: string;
}

interface SectorRow {
  name: string;
  changePercent: number;
  isPositive: boolean;
}

function formatCompact(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return n.toString();
}

function formatPrice(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(4);
}

const TABS_CONFIG: { id: TabId; label: string; icon: React.ElementType; description: string }[] = [
  { id: "gainers", label: "Top Gainers", icon: TrendingUp, description: "Biggest percentage gainers today" },
  { id: "losers", label: "Top Losers", icon: TrendingDown, description: "Biggest percentage decliners today" },
  { id: "active", label: "Most Active", icon: Zap, description: "Highest volume stocks today" },
  { id: "premarket", label: "Pre-Market", icon: Cloud, description: "Pre-market movers" },
  { id: "afterhours", label: "After Hours", icon: Moon, description: "After-hours movers" },
  { id: "heatmap", label: "Market Heatmap", icon: BarChart3, description: "Sector performance heatmap" },
];

export function MarketMoversPage() {
  const { user, apiFetch } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab = (searchParams.get("tab") as TabId) || "gainers";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [data, setData] = useState<{ gainers: MoverRow[]; losers: MoverRow[]; active: MoverRow[]; sectors: SectorRow[]; premarket: Record<string, any> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMovers = useCallback(async (attempt = 1): Promise<void> => {
    const maxAttempts = 3;
    try {
      setLoading(true);
      const userId = user?.id ? `?userId=${user.id}` : "";
      const [moversRes, sectorsRes] = await Promise.allSettled([
        apiFetch(`${API_BASE_URL}/market/movers${userId}`),
        apiFetch(`${API_BASE_URL}/market/sectors`),
      ]);

      let moversData: any = null;
      if (moversRes.status === "fulfilled") {
        try { moversData = await moversRes.value.json(); } catch { /* keep null */ }
      }
      let sectorsData: any = null;
      if (sectorsRes.status === "fulfilled") {
        try { sectorsData = await sectorsRes.value.json(); } catch { /* keep null */ }
      }

      if (!moversData || typeof moversData !== "object") throw new Error("movers endpoint returned no data");

      const combined = moversData.combined || moversData;
      const gainers: MoverRow[] = Array.isArray(combined.gainers) ? combined.gainers.map((g: any) => ({
        ...g,
        change: g.change ?? ((g.changePercent ?? 0) >= 0 ? "+" : "") + (g.changePercent ?? 0).toFixed(2) + "%",
      })) : [];
      const losers: MoverRow[] = Array.isArray(combined.losers) ? combined.losers.map((l: any) => ({
        ...l,
        change: l.change ?? ((l.changePercent ?? 0) >= 0 ? "+" : "") + (l.changePercent ?? 0).toFixed(2) + "%",
      })) : [];
      const active: MoverRow[] = Array.isArray(combined.active) ? combined.active.map((a: any) => ({
        ...a,
        change: a.change ?? ((a.changePercent ?? 0) >= 0 ? "+" : "") + (a.changePercent ?? 0).toFixed(2) + "%",
      })) : [];

      const sectors: SectorRow[] = Array.isArray(sectorsData)
        ? sectorsData.map((s: any) => ({ name: s.sector || s.name || s.symbol || "Sector", changePercent: s.avgChange ?? s.changePercent ?? 0, isPositive: (s.avgChange ?? s.changePercent ?? 0) >= 0 }))
        : (sectorsData?.sectors || []).map((s: any) => ({ name: s.name || s.symbol || "Sector", changePercent: s.changePercent ?? 0, isPositive: (s.changePercent ?? 0) >= 0 }));

      // Gather tickers for premarket lookup
      const tickers = new Set<string>();
      [...gainers.slice(0, 10), ...losers.slice(0, 10), ...active.slice(0, 10)].forEach((r) => {
        const t = String(r.ticker || r.symbol || "").toUpperCase().replace(/^(NSE|NGX|JSE):/, "");
        if (t && !/[:=^]/.test(t)) tickers.add(t);
      });

      let premarket: Record<string, any> = {};
      if (tickers.size > 0) {
        try {
          const pmRes = await apiFetch(`${API_BASE_URL}/market/premarket?symbols=${Array.from(tickers).join(",")}`, { cache: "no-store" });
          if (pmRes.ok) {
            premarket = await pmRes.json();
          }
        } catch { /* silent */ }
      }

      setData({ gainers, losers, active, sectors, premarket });
      setLastUpdated(new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (attempt < maxAttempts) {
        // Backend may be cold-building the movers cache (10-80s); retry after a short delay.
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        return fetchMovers(attempt + 1);
      }
      setError(e.message || "Failed to load market movers");
    } finally {
      if (attempt === maxAttempts) setLoading(false);
    }
  }, [apiFetch, user?.id]);

  useEffect(() => {
    fetchMovers();
    pollRef.current = setInterval(fetchMovers, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMovers]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TABS_CONFIG.some((x) => x.id === t)) setActiveTab(t as TabId);
  }, [searchParams]);

  const rows = useMemo(() => {
    if (!data) return [];
    switch (activeTab) {
      case "gainers": return data.gainers;
      case "losers": return data.losers;
      case "active": return data.active;
      case "premarket":
        return Object.entries(data.premarket).map(([symbol, q]: [string, any]) => {
          const c = q.preMarketChangePercent ?? q.changePercent ?? 0;
          return {
            ticker: symbol,
            symbol,
            name: q.company_name || symbol,
            price: q.preMarketPrice ?? q.price ?? 0,
            change: (c >= 0 ? "+" : "") + c.toFixed(2) + "%",
            changePercent: c,
            isPositive: c >= 0,
            volume: formatCompact(q.preMarketVolume ?? q.volume ?? 0),
            marketCap: q.marketCap ?? 0,
            currency: q.currency ?? "USD",
            market: "Global",
          };
        }).filter((r) => r.price > 0);
      case "afterhours":
        return Object.entries(data.premarket).map(([symbol, q]: [string, any]) => {
          const c = q.postMarketChangePercent ?? q.changePercent ?? 0;
          return {
            ticker: symbol,
            symbol,
            name: q.company_name || symbol,
            price: q.postMarketPrice ?? q.price ?? 0,
            change: (c >= 0 ? "+" : "") + c.toFixed(2) + "%",
            changePercent: c,
            isPositive: c >= 0,
            volume: formatCompact(q.postMarketVolume ?? q.volume ?? 0),
            marketCap: q.marketCap ?? 0,
            currency: q.currency ?? "USD",
            market: "Global",
          };
        }).filter((r) => r.price > 0);
      default: return data.gainers;
    }
  }, [data, activeTab]);

  const heatmapSectors = useMemo(() => {
    if (!data) return [];
    return data.sectors;
  }, [data]);

  const changeColor = (pct: number) => (pct >= 0 ? "text-emerald-600" : "text-red-600");
  const heatColor = (pct: number) => {
    const a = Math.min(Math.abs(pct), 5);
    const base = pct >= 0 ? "bg-emerald" : "bg-red";
    const intensity = Math.round((a / 5) * 800) + 100;
    return `${base}-${Math.max(100, Math.min(900, intensity))}`;
  };

  const ActiveIcon = TABS_CONFIG.find((t) => t.id === activeTab)?.icon || TrendingUp;

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] via-[#0EA5E9]/[0.03] to-transparent p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">Market Movers</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Real-time top gainers, losers, most active, and sector heatmap across Global and African markets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => fetchMovers()} size="sm" disabled={loading} className="flex items-center gap-1.5 text-xs">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-4" />}
              <span>Refresh</span>
            </Button>
            <span className="text-xs text-muted-foreground">Updated {lastUpdated || "—"}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 overflow-x-auto border-b border-border text-xs font-medium mb-4">
          {TABS_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-[#0D7490] text-[#0D7490] shadow-[0_1px_0px_0px_rgba(13,116,144,0.35)]"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && !data && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm">
              <Cloud className="size-4 text-destructive" />
              <span className="text-destructive">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mb-2" />
          <p className="text-xs">Loading market movers…</p>
        </div>
      )}

      {/* Heatmap tab */}
      {data && activeTab === "heatmap" && (
        <Card className="border border-border shadow-sm">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {heatmapSectors.map((s, i) => {
                const cls = heatColor(s.changePercent);
                const barWidth = `${Math.min(Math.abs(s.changePercent) * 20, 100)}%`;
                return (
                  <Card key={i} className={`p-3 rounded-xl border border-border shadow-sm flex flex-col gap-1 ${cls} text-foreground`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold truncate" title={s.name}>{s.name}</span>
                      <Badge variant={s.isPositive ? "default" : "destructive"} className="text-[10px]">
                        {(s.changePercent >= 0 ? "+" : "") + s.changePercent.toFixed(2)}%
                      </Badge>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-[#0D7490]/10 overflow-hidden">
                      <div className={`h-full ${s.isPositive ? "bg-emerald-600" : "bg-red-600"} w-[${barWidth}]`} />
                    </div>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* List tabs */}
      {data && activeTab !== "heatmap" && rows.length > 0 && (
        <Card className="border border-border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-hidden border-b border-border">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px] uppercase tracking-wider text-muted-foreground bg-[#0D7490]/5">
                      <TableHead className="w-6">#</TableHead>
                      <TableHead className="w-20">Ticker</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right w-24">Price</TableHead>
                      <TableHead className="text-right w-20">Change</TableHead>
                      <TableHead className="text-right w-20">Change %</TableHead>
                      <TableHead className="text-right w-24">Volume</TableHead>
                      <TableHead className="text-right w-24">Mkt Cap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={`${row.ticker}-${i}`} className="text-sm">
                        <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-semibold tabular-nums">{row.ticker}</TableCell>
                        <TableCell className="max-w-[140px] truncate">{row.name}</TableCell>
                        <TableCell className="font-bold tabular-nums text-right">{formatPrice(row.price)}</TableCell>
                        <TableCell className={`font-semibold tabular-nums text-right ${changeColor(row.changePercent)}`}>
                          {row.change ?? ((row.changePercent >= 0 ? "+" : "") + row.changePercent.toFixed(2) + "%")}
                        </TableCell>
                        <TableCell className={`font-semibold tabular-nums text-right ${changeColor(row.changePercent)}`}>
                          {(row.changePercent >= 0 ? "+" : "")}{row.changePercent.toFixed(2)}%
                        </TableCell>
                        <TableCell className="tabular-nums text-right text-muted-foreground">{row.volume}</TableCell>
                        <TableCell className="tabular-nums text-right text-muted-foreground">{formatCompact(row.marketCap)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data && activeTab !== "heatmap" && rows.length === 0 && (
        <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground border border-dashed rounded-2xl p-6">
          <BarChart3 className="size-8 mb-2 opacity-50" />
          <p className="text-xs">No {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} data available.</p>
        </div>
      )}
    </div>
  );
}
