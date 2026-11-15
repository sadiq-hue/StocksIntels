"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useLocation, useNavigate, Link } from "react-router";
import { BarChart3, ChevronLeft, ChevronRight, Cloud, Loader2, Moon, RefreshCcw, Search, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Input } from "../components/ui/input";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

type TabId = "gainers" | "losers" | "active" | "premarket" | "afterhours" | "heatmap";
type SortKey = "ticker" | "name" | "changePercent" | "price" | "volume" | "marketCap";

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
  children: any[];
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
  if (n < 1) return n.toFixed(4);
  if (n < 100) return n.toFixed(3);
  return n.toFixed(2);
}

// Squarified Treemap (StockAnalysis-style heatmap)
// Tile size = market cap, Color = performance
function worstAspectRatio(row: { size: number }[], width: number, height: number, rowSize: number): number {
  if (row.length === 0) return Infinity;
  const maxSize = Math.max(...row.map((n) => n.size));
  const minSize = Math.min(...row.map((n) => n.size));
  if (width >= height) {
    return Math.max((maxSize * width * width) / (rowSize * rowSize), (rowSize * rowSize) / (minSize * width * width));
  }
  return Math.max((maxSize * height * height) / (rowSize * rowSize), (rowSize * rowSize) / (minSize * height * height));
}

function squarify(nodes: { size: number; [key: string]: any }[], x: number, y: number, width: number, height: number, result: any[]): void {
  if (nodes.length === 0) return;
  nodes.sort((a, b) => b.size - a.size);
  if (nodes.length === 1) {
    result.push({ ...nodes[0], x, y, w: width, h: height });
    return;
  }

  const totalSize = nodes.reduce((s, n) => s + n.size, 0);
  const row: typeof nodes = [];
  let rowSize = 0;
  let bestRow: typeof nodes = [];
  let bestRowSize = 0;
  let bestWorst = Infinity;

  for (const node of nodes) {
    row.push(node);
    rowSize += node.size;
    const w = worstAspectRatio(row, width, height, rowSize);
    if (w < bestWorst) {
      bestWorst = w;
      bestRow = [...row];
      bestRowSize = rowSize;
    } else {
      row.pop();
      rowSize -= node.size;
      break;
    }
  }

  if (width >= height) {
    const rowHeight = bestRowSize / width;
    let cx = x;
    for (const node of bestRow) {
      const nw = node.size / rowHeight;
      result.push({ ...node, x: cx, y, w: nw, h: rowHeight });
      cx += nw;
    }
    const remaining = nodes.filter((n) => !bestRow.includes(n));
    squarify(remaining, x, y + rowHeight, width, height - rowHeight, result);
  } else {
    const rowWidth = bestRowSize / height;
    let cy = y;
    for (const node of bestRow) {
      const nh = node.size / rowWidth;
      result.push({ ...node, x, y: cy, w: rowWidth, h: nh });
      cy += nh;
    }
    const remaining = nodes.filter((n) => !bestRow.includes(n));
    squarify(remaining, x + rowWidth, y, width - rowWidth, height, result);
  }
}

function parseCompact(v?: string | number | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const m = String(v).trim().toUpperCase().match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const mult = m[2] === "T" ? 1e12 : m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Number.isFinite(n) ? n * mult : 0;
}

function normalizeTicker(t?: string | null): string {
  return String(t || "").toUpperCase().replace(/^(NSE|NGX|JSE|US|GLOBAL):/, "").trim();
}

// Inline heat colour (do NOT build Tailwind class names dynamically — those get
// purged from the production CSS and the tiles render colourless).
function heatStyle(pct: number): string {
  const clamped = Math.max(-6, Math.min(6, Number.isFinite(pct) ? pct : 0));
  if (clamped === 0) return "rgba(148,163,184,0.35)"; // neutral / no move (e.g., closed market)
  const alpha = Math.min(0.95, 0.25 + (Math.abs(clamped) / 6) * 0.7);
  return clamped > 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
}

// Build a NON-overlapping, sector-grouped treemap:
//   1) squarify sectors into the full area by aggregate market cap;
//   2) squarify each sector's stocks inside that sector's region.
function buildHeatmap(sectors: SectorRow[]): any[] {
  const nodes = sectors
    .map((s) => {
      const children = (s.children || []).slice(0, 60);
      const size = children.reduce((sum, c: any) => sum + (Number(c.marketCap) > 0 ? Number(c.marketCap) : 1), 0);
      return { name: s.name, size: size > 0 ? size : 1, children };
    })
    .filter((n) => n.children.length > 0);
  if (!nodes.length) return [];
  const regions: any[] = [];
  squarify(nodes, 0, 0, 1, 1, regions);
  const tiles: any[] = [];
  for (const region of regions) {
    const kids = (region.children || []).map((c: any) => {
      const cap = Number(c.marketCap) > 0 ? Number(c.marketCap) : 0;
      const act = parseCompact(c.volume);
      return { ...c, sector: region.name, size: cap > 0 ? cap : act > 0 ? act : 1 };
    });
    const out: any[] = [];
    squarify(kids, region.x, region.y, region.w, region.h, out);
    tiles.push(...out);
  }
  return tiles.slice(0, 300);
}

const TABS_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "gainers", label: "Top Gainers", icon: TrendingUp },
  { id: "losers", label: "Top Losers", icon: TrendingDown },
  { id: "active", label: "Most Active", icon: Zap },
  { id: "premarket", label: "Pre-Market", icon: Cloud },
  { id: "afterhours", label: "After Hours", icon: Moon },
  { id: "heatmap", label: "Market Heatmap", icon: BarChart3 },
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
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialTab = (searchParams.get("tab") as TabId) || (location.pathname.includes("/heatmap") ? "heatmap" : "gainers");
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [data, setData] = useState<{ gainers: MoverRow[]; losers: MoverRow[]; active: MoverRow[]; sectors: SectorRow[]; premarket: Record<string, any> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("changePercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [marketFilter, setMarketFilter] = useState<"all" | "Global" | "NSE" | "NGX" | "JSE">("all");
  const ROWS_PER_PAGE = 20;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMovers = useCallback(async (attempt = 1): Promise<void> => {
    const maxAttempts = 3;
    try {
      setLoading(true);
      const fetchJson = async (url: string) => {
        const res = await fetch(`${API_BASE_URL}${url}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const [moversRes, sectorsRes] = await Promise.allSettled([
        fetchJson(`/market/movers`),
        fetchJson(`/market/sectors/tree`),
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
        ["nse", "ngx", "jse", "global"].some((m) => Array.isArray(md[m]?.gainers) || Array.isArray(md[m]?.losers));
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
        return sd.map((s: any) => ({ name: s.name, changePercent: s.changePercent ?? 0, isPositive: (s.changePercent ?? 0) >= 0, children: s.children || [] }));
      })();

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

  // Reset sorting sensibly per tab (losers = most negative first).
  useEffect(() => {
    setSortKey("changePercent");
    setSortDir(activeTab === "losers" ? "asc" : "desc");
  }, [activeTab]);

  const goToStock = (ticker?: string | null, market?: string | null) => {
    const t = normalizeTicker(ticker);
    if (!t) return;
    const m = String(market || "").toLowerCase();
    const q = m && m !== "global" ? `?market=${encodeURIComponent(m)}` : "";
    navigate(`/app/stock/${encodeURIComponent(t)}${q}`);
  };

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
    let list = rows.filter(
      (r) =>
        (r.ticker.toLowerCase().includes(term) || String(r.name || "").toLowerCase().includes(term)) &&
        (marketFilter === "all" || r.market === marketFilter),
    );
    const dir = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "name") cmp = String(a.name || "").localeCompare(String(b.name || ""));
      else if (sortKey === "changePercent") cmp = a.changePercent - b.changePercent;
      else if (sortKey === "price") cmp = a.price - b.price;
      else if (sortKey === "volume") cmp = parseCompact(a.volume) - parseCompact(b.volume);
      else if (sortKey === "marketCap") cmp = a.marketCap - b.marketCap;
      return cmp * dir;
    });
    return list;
  }, [rows, searchTerm, marketFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "ticker" || key === "name" ? "asc" : "desc");
    }
    setPage(1);
  };

  const sortHead = (label: string, k: SortKey, className = "") => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
      >
        {label}
        {sortKey === k ? <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </TableHead>
  );

  const downloadCsv = () => {
    const header = ["Ticker", "Company", "Price", "ChangePercent", "Volume", "MarketCap", "Market"];
    const lines = [header.join(",")].concat(
      filteredRows.map((r) =>
        [
          r.ticker,
          `"${String(r.name || "").replace(/"/g, '""')}"`,
          r.price,
          r.changePercent,
          r.volume,
          r.marketCap,
          r.market,
        ].join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTab}-movers.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  // Heatmap data: prefer the live sector tree; if it is unavailable, fall back
  // to the live movers so the heatmap is never blank.
  const heatmapSectors = useMemo<SectorRow[]>(() => {
    if (data?.sectors?.length) return data.sectors;
    if (!data) return [];
    const map = new Map<string, any>();
    for (const r of [...data.gainers, ...data.losers, ...data.active]) {
      const t = normalizeTicker(r.ticker);
      if (!t || map.has(t)) continue;
      map.set(t, {
        name: t,
        fullName: r.name,
        changePercent: r.changePercent,
        price: r.price,
        marketCap: r.marketCap,
        currency: r.currency,
        market: r.market,
        volume: r.volume,
      });
    }
    const children = [...map.values()];
    return children.length
      ? [{ name: "Market", changePercent: 0, isPositive: true, children }]
      : [];
  }, [data]);

  const heatmapTiles = useMemo(() => buildHeatmap(heatmapSectors), [heatmapSectors]);

  const changeColor = (pct: number) => (pct >= 0 ? "text-emerald-600" : "text-red-600");
  const tabTitle = TAB_TITLES[activeTab];

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] via-[#0EA5E9]/[0.03] to-transparent p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">{tabTitle}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Live market data across Global and African markets.
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
            <Button variant="outline" size="sm" className="px-2" onClick={() => navigate("/app/stocks")}>Screener</Button>
            <Button variant="outline" size="sm" className="px-2" onClick={downloadCsv} disabled={filteredRows.length === 0}>Download</Button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Market</span>
            <select
              value={marketFilter}
              onChange={(e) => { setMarketFilter(e.target.value as typeof marketFilter); setPage(1); }}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="all">All</option>
              <option value="Global">Global</option>
              <option value="NSE">NSE</option>
              <option value="NGX">NGX</option>
              <option value="JSE">JSE</option>
            </select>
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

      {/* Stale data warning (previous data still shown) */}
      {error && data && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Showing the last available data — refresh failed: {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mb-2" />
          <p className="text-xs">Loading market movers…</p>
        </div>
      )}

      {/* Tab bar (always visible) */}
      <div className="border-b border-border bg-[#0D7490]/5 px-4 py-2 overflow-x-auto">
        <div className="flex gap-1">
          {TABS_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setPage(1); }}
                className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${isActive ? "border-[#0D7490] text-[#0D7490] shadow-[0_1px_0px_0px_rgba(13,116,144,0.35)]" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border border-border rounded-2xl shadow-sm bg-background p-0">
        <div className="overflow-hidden border-b border-border">
          <ScrollArea className="h-[520px]">
            {/* Heatmap tab content */}
            {activeTab === "heatmap" && (
              <div className="p-4 pb-8">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="size-5 text-[#0D7490]" />
                  <span className="text-sm font-semibold text-foreground">Market Heat Map</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Tile size = market cap / activity · Color = performance
                  </span>
                </div>

                {/* Live top-movers summary (same movers feed) */}
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { label: "Top Gainers", rows: data?.gainers || [], tone: "text-emerald-600" },
                    { label: "Top Losers", rows: data?.losers || [], tone: "text-red-600" },
                    { label: "Most Active", rows: data?.active || [], tone: "text-[#0D7490]" },
                  ].map((g) => (
                    <div key={g.label} className="rounded-lg border border-border bg-muted/30 p-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{g.label}</p>
                      <div className="space-y-0.5">
                        {g.rows.slice(0, 3).map((r) => (
                          <button
                            key={`${g.label}-${r.ticker}`}
                            onClick={() => goToStock(r.ticker, r.market)}
                            className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                          >
                            <span className="truncate text-[11.5px] font-medium text-foreground">{normalizeTicker(r.ticker)}</span>
                            <span className={`text-[11px] font-semibold tabular-nums ${changeColor(r.changePercent)}`}>
                              {(r.changePercent >= 0 ? "+" : "")}{r.changePercent.toFixed(2)}%
                            </span>
                          </button>
                        ))}
                        {g.rows.length === 0 && <p className="text-[11px] text-muted-foreground">No data</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {loading && !data ? (
                  <div className="h-[360px] flex items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" /> Loading market heat map…
                  </div>
                ) : heatmapTiles.length === 0 ? (
                  <div className="h-[360px] flex flex-col items-center justify-center text-muted-foreground">
                    <BarChart3 className="size-8 mb-2 opacity-40" />
                    <p className="text-xs">No heat-map data available right now.</p>
                  </div>
                ) : (
                  <>
                    <div className="relative w-full aspect-[16/9] min-h-[360px] border border-[#0D7490]/15 rounded-xl overflow-hidden bg-muted/20">
                      {heatmapTiles.map((t, i) => {
                        const pct = Number.isFinite(t.changePercent) ? t.changePercent : 0;
                        const name = normalizeTicker(t.name);
                        const label = String(t.fullName || t.name || "");
                        return (
                          <button
                            key={`${name}-${t.sector || ""}-${i}`}
                            onClick={() => goToStock(name, t.market)}
                            title={`${label}${t.sector ? ` · ${t.sector}` : ""} · ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                            className="absolute overflow-hidden border border-white/20 text-left focus:outline-none focus:ring-2 focus:ring-white/60"
                            style={{
                              left: `${t.x * 100}%`,
                              top: `${t.y * 100}%`,
                              width: `${Math.max(1.2, t.w * 100)}%`,
                              height: `${Math.max(1.2, t.h * 100)}%`,
                              backgroundColor: heatStyle(pct),
                            }}
                          >
                            <div className="absolute inset-0 bg-black/10" />
                            <div className="relative z-10 p-1 text-[9px] font-bold leading-tight text-white">
                              <div className="truncate">{name}</div>
                              <div className="text-[8px] opacity-90">{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground text-center">
                      Tile size = market cap (or activity when cap is unavailable) · Green = up · Red = down · Click a tile to open its analysis.
                    </p>
                    {heatmapTiles.some((t) => !(Number(t.price) > 0) && !Number(t.changePercent)) && (
                      <p className="mt-1 text-[10.5px] text-muted-foreground text-center">
                        Neutral tiles indicate the latest quote for that stock is unavailable (e.g., market closed or delayed).
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            {/* List tab content */}
            {activeTab !== "heatmap" && (
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px] uppercase tracking-wider text-muted-foreground bg-[#0D7490]/5">
                    <TableHead className="w-5">#</TableHead>
                    {sortHead("Ticker", "ticker", "w-20")}
                    {sortHead("Company", "name", "min-w-[160px]")}
                    {sortHead("Change %", "changePercent", "text-right w-20")}
                    {sortHead("Price", "price", "text-right w-20")}
                    {sortHead("Volume", "volume", "text-right w-24")}
                    {sortHead("Mkt Cap", "marketCap", "text-right w-24")}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, i) => {
                    const globalIndex = (currentPage - 1) * ROWS_PER_PAGE + i + 1;
                    return (
                      <TableRow
                        key={`${row.ticker}-${i}`}
                        className="text-sm cursor-pointer hover:bg-muted/40"
                        onClick={() => goToStock(row.ticker, row.market)}
                        title={`Open ${normalizeTicker(row.ticker)} analysis`}
                      >
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
            )}
          </ScrollArea>
        </div>

        {/* Pagination */}
        {activeTab !== "heatmap" && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              {filteredRows.length === 0 ? "No rows" : `Showing ${(currentPage - 1) * ROWS_PER_PAGE + 1} to ${Math.min(currentPage * ROWS_PER_PAGE, filteredRows.length)} of ${filteredRows.length} rows`}
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
        )}

        {/* Empty state */}
        {activeTab !== "heatmap" && pageRows.length === 0 && (
          <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground border border-dashed rounded-2xl p-6">
            <BarChart3 className="size-8 mb-2 opacity-50" />
            <p className="text-xs">No {tabTitle.toLowerCase()} data available.</p>
          </div>
        )}
      </div>
    </div>
  );
}