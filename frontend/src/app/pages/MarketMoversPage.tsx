"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  DollarSign,
  Flame,
  Loader2,
  Moon,
  RefreshCcw,
  Search,
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
import { Input } from "../components/ui/input";
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

const TAB_TITLES: Record<TabId, string> = {
  gainers: "Top Gainers",
  losers: "Top Losers",
  active: "Most Active",
  premarket: "Pre-Market Movers",
  afterhours: "After Hours Movers",
  heatmap: "Market Heatmap",
};

export function MarketMoversPage() {
  const { apiFetch } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabId) || "gainers";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [data, setData] = useState<{ gainers: MoverRow[]; losers: MoverRow[]; active: MoverRow[]; sectors: SectorRow[]; premarket: Record<string, any> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const ROWS_PER_PAGE = 20;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMovers = useCallback(async (attempt = 1): Promise<void> => {
    const maxAttempts = 3;
    try {
      setLoading(true);
      // Public endpoint — raw fetch so a stale auth token never breaks it.
      const fetchJson = async (url: string) => {
        const res = await fetch(`${API_BASE_URL}${url}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const [moversRes, sectorsRes] = await Promise.allSettled([
        fetchJson(`/market/movers`),
        fetchJson(`/market/sectors`),
      ]);

      if (moversRes.status !== "fulfilled" || !moversRes.value || typeof moversRes.value !== "object") {
        throw new Error("movers endpoint returned no data");
      }
      const md: any = moversRes.value;
      const hasMoversData =
        Array.isArray(md.combined?.gainers) ||
        Array.isArray(md.combined?.losers) ||
        Array.isArray(md.gainers) ||
        Array.isArray(md.losers) ||
        ["nse","ngx","jse","global"].some((m) => Array.isArray(md[m]?.gainers) || Array.isArray(md[m]?.losers));
      if (!hasMoversData) throw new Error("movers endpoint returned no data");

      const combined = md.combined || md;
      const pick = (key: string) => {
        const fromCombined = Array.isArray(combined[key]) ? combined[key] : null;
        if (fromCombined && fromCombined.length > 0) return fromCombined;
        const fromTop = Array.isArray(md[key]) ? md[key] : null;
        if (fromTop && fromTop.length > 0) return fromTop;
        const merged: any[] = [];
        for (const m of ["nse", "ngx", "jse", "global"]) {
          const block = md[m];
          if (block && Array.isArray(block[key])) merged.push(...block[key]);
        }
        return merged;
      };
      const gainers: MoverRow[] = pick("gainers").map((g: any) => ({
        ...g,
        change: g.change ?? ((g.changePercent ?? 0) >= 0 ? "+" : "") + (g.changePercent ?? 0).toFixed(2) + "%",
      }));
      const losers: MoverRow[] = pick("losers").map((l: any) => ({
        ...l,
        change: l.change ?? ((l.changePercent ?? 0) >= 0 ? "+" : "") + (l.changePercent ?? 0).toFixed(2) + "%",
      }));
      const active: MoverRow[] = pick("active").map((a: any) => ({
        ...a,
        change: a.change ?? ((a.changePercent ?? 0) >= 0 ? "+" : "") + (a.changePercent ?? 0).toFixed(2) + "%",
      }));

      const sectors: SectorRow[] = (() => {
        if (sectorsRes.status !== "fulfilled") return [];
        const sd: any = sectorsRes.value;
        if (!Array.isArray(sd)) return [];
        return sd.map((s: any) => ({ name: s.sector || s.name || s.symbol || "Sector", changePercent: s.avgChange ?? s.changePercent ?? 0, isPositive: (s.avgChange ?? s.changePercent ?? 0) >= 0 }));
      })();

      // Gather tickers for premarket/afterhours lookup
      const tickers = new Set<string>();
      [...gainers.slice(0, 10), ...losers.slice(0, 10), ...active.slice(0, 10)].forEach((r) => {
        const t = String(r.ticker || r.symbol || "").toUpperCase().replace(/^(NSE|NGX|JSE):/, "");
        if (t && !/[:=^]/.test(t)) tickers.add(t);
      });

      let premarket: Record<string, any> = {};
      if (tickers.size > 0) {
        try {
          const pmRes = await fetch(`${API_BASE_URL}/market/premarket?symbols=${Array.from(tickers).join(",")}`, { credentials: 'include' });
          if (pmRes.ok) premarket = await pmRes.json();
        } catch { /* silent */ }
      }

      // Retry on empty movers (cold backend cache can return empty arrays without erroring).
      if (gainers.length === 0 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        return fetchMovers(attempt + 1);
      }

      setData({ gainers, losers, active, sectors, premarket });
      setLastUpdated(new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        return fetchMovers(attempt + 1);
      }
      setError(e.message || "Failed to load market movers");
    } finally {
      if (attempt === maxAttempts) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovers();
    pollRef.current = setInterval(fetchMovers, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMovers]);

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

  const filteredRows = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return rows.filter((r) => r.ticker.toLowerCase().includes(term) || r.name.toLowerCase().includes(term));
  }, [rows, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const heatmapSectors = useMemo(() => data ? data.sectors : [], [data]);

  const changeColor = (pct: number) => (pct >= 0 ? "text-emerald-600" : "text-red-600");
  const heatColor = (pct: number) => {
    const a = Math.min(Math.abs(pct), 5);
    const base = pct >= 0 ? "bg-emerald" : "bg-red";
    const intensity = Math.round((a / 5) * 800) + 100;
    return `${base}-${Math.max(100, Math.min(900, intensity))}`;
  };

  const ActiveIcon = TABS_CONFIG.find((t) => t.id === activeTab)?.icon || TrendingUp;
  const tabTitle = TAB_TITLES[activeTab];

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] via-[#0EA5E9]/[0.03] to-transparent p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">{tabTitle}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Real-time {activeTab} across Global and African markets.
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

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              placeholder="Find…"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
              className="h-8 text-xs pl-6 min-w-[140px] md:min-w-[200px]"
            />
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">Indicators</span>
            <Button variant="outline" size="sm" className="px-2">Screener</Button>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <Button variant="outline" size="sm" className="px-2">Download</Button>
            <Button variant="outline" size="sm" className="px-2">Add View</Button>
            <Button variant="outline" size="sm" className="px-2">Edit View</Button>
          </div>
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
        <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
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
      {data && activeTab !== "heatmap" && (
        <Card className="border border-border shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-hidden border-b border-border">
              <ScrollArea className="h-[520px]">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px] uppercase tracking-wider text-muted-foreground bg-[#0D7490]/5">
                      <TableHead className="w-5">#</TableHead>
                      <TableHead className="w-20">Ticker</TableHead>
                      <TableHead className="min-w-[160px]">Company</TableHead>
                      <TableHead className="text-right w-20">Change %</TableHead>
                      <TableHead className="text-right w-20">Price</TableHead>
                      <TableHead className="text-right w-24">Volume</TableHead>
                      <TableHead className="text-right w-24">Mkt Cap</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((row, i) => {
                      const globalIndex = (currentPage - 1) * ROWS_PER_PAGE + i + 1;
                      return (
                        <TableRow key={`${row.ticker}-${i}`} className="text-sm">
                          <TableCell className="font-medium text-muted-foreground">{globalIndex}</TableCell>
                          <TableCell className="font-semibold tabular-nums">{row.ticker}</TableCell>
                          <TableCell className="max-w-[160px] truncate">{row.name}</TableCell>
                          <TableCell className={`font-semibold tabular-nums text-right ${changeColor(row.changePercent)}`}>
                            {(row.changePercent >= 0 ? "+" : "")}{row.changePercent.toFixed(2)}%
                          </TableCell>
                          <TableCell className="font-bold tabular-nums text-right">{formatPrice(row.price)}</TableCell>
                          <TableCell className="tabular-nums text-right text-muted-foreground">{row.volume}</TableCell>
                          <TableCell className="tabular-nums text-right text-muted-foreground">{formatCompact(row.marketCap)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
            {/* Pagination */}
            <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                {filteredRows.length === 0 ? "No rows" : `Showing ${((currentPage - 1) * ROWS_PER_PAGE) + 1} to ${Math.min(currentPage * ROWS_PER_PAGE, filteredRows.length)} of ${filteredRows.length} rows`}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  disabled={currentPage === 1 || filteredRows.length === 0}
                  onClick={() => setPage(currentPage - 1)}
                  className="px-2"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="px-2 text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  size="sm"
                  disabled={currentPage === totalPages || filteredRows.length === 0}
                  onClick={() => setPage(currentPage + 1)}
                  className="px-2"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data && activeTab !== "heatmap" && pageRows.length === 0 && (
        <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground border border-dashed rounded-2xl p-6">
          <BarChart3 className="size-8 mb-2 opacity-50" />
          <p className="text-xs">No {tabTitle.toLowerCase()} data available.</p>
        </div>
      )}
    </div>
  );
}
