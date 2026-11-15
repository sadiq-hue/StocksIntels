"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router";
import {
  BarChart3, ChevronLeft, ChevronRight, Cloud, Loader2, Moon, RefreshCcw, Search,
  TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Input } from "../components/ui/input";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

type TabId = "gainers" | "losers" | "active" | "premarket" | "afterhours" | "heatmap";
type PeriodId = "1d" | "1w" | "1mo" | "ytd" | "1y" | "3y" | "5y";
type SortKey = "ticker" | "name" | "changeAmount" | "changePercent" | "price" | "volume" | "marketCap";
type MarketFilter = "all" | "Global" | "NSE" | "NGX" | "JSE";

interface MoverRow {
  ticker: string;
  symbol: string;
  name: string;
  price: number;
  change?: string;
  changePercent: number;
  changeAmount?: number | null;
  isPositive: boolean;
  volume: string;
  rawVolume?: number;
  marketCap: number;
  currency: string;
  market: string;
  updatedAt?: string | null;
}
interface SectorRow {
  name: string;
  changePercent: number;
  isPositive: boolean;
  children: any[];
}
interface IndexRow {
  symbol: string;
  name: string;
  value: string;
  change: string;
  changeRaw: number;
  isPositive: boolean;
  market: string;
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

function openOf(s: any): boolean {
  return typeof s === "boolean" ? s : !!s?.open;
}

/** Last weekday (Mon–Fri) in the exchange timezone; used when today is a
 *  weekend so we never label Friday's session as "today". Public holidays are
 *  not modelled here (the backend session status remains authoritative). */
function tradingDateLabel(tz: string): string {
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const dt = new Date(now.getTime() - i * 86400000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(dt);
    if (wd !== "Sat" && wd !== "Sun") {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(dt);
    }
  }
  return "";
}

function fmtTzTime(iso: string | number | null | undefined, tz: string): string {
  if (iso == null) return "—";
  const d = new Date(iso as any);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

function absChangeOf(row: MoverRow): number {
  if (row.changeAmount != null && Number.isFinite(Number(row.changeAmount))) return Number(row.changeAmount);
  const pct = Number(row.changePercent) || 0;
  const p = Number(row.price) || 0;
  if (p > 0 && pct !== 0) return p - p / (1 + pct / 100);
  return 0;
}

function displayVolume(r: MoverRow): string {
  const raw = Number(r.rawVolume);
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw).toLocaleString();
  const parsed = parseCompact(r.volume);
  return parsed > 0 ? Math.round(parsed).toLocaleString() : "—";
}

// Squarified treemap (StockAnalysis-style heatmap).
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

function heatStyle(pct: number): string {
  const clamped = Math.max(-6, Math.min(6, Number.isFinite(pct) ? pct : 0));
  if (clamped === 0) return "rgba(148,163,184,0.35)";
  const alpha = Math.min(0.95, 0.25 + (Math.abs(clamped) / 6) * 0.7);
  return clamped > 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
}

// Scale node sizes so their total equals the rectangle area. squarify expects
// sizes in the same units as the area; without this, coordinates come out in
// market-cap units (e.g. 3.9e12) and every tile renders off-screen.
function scaleSizes(nodes: any[], area: number): any[] {
  const total = nodes.reduce((s, n) => s + (n.size > 0 ? n.size : 1), 0) || 1;
  const k = area / total;
  return nodes.map((n) => ({ ...n, size: Math.max((n.size > 0 ? n.size : 1) * k, 1e-9) }));
}

function buildHeatmap(sectors: SectorRow[]): any[] {
  // Flatten every stock first, keep only the largest few, THEN group by sector.
  // Slicing after layout (or capping per sector before layout) leaves uncovered
  // holes in the rectangle — this way the treemap always fills the area exactly.
  const flat: any[] = [];
  for (const s of sectors) {
    for (const c of (s.children || [])) {
      const cap = Number(c.marketCap) > 0 ? Number(c.marketCap) : 0;
      const act = parseCompact(c.volume);
      flat.push({ ...c, sector: s.name, size: cap > 0 ? cap : act > 0 ? act : 1 });
    }
  }
  if (!flat.length) return [];
  flat.sort((a, b) => b.size - a.size);
  const top = flat.slice(0, 220);

  const groups = new Map<string, any[]>();
  for (const t of top) {
    if (!groups.has(t.sector)) groups.set(t.sector, []);
    groups.get(t.sector)!.push(t);
  }
  const rawNodes = [...groups.entries()].map(([name, children]) => ({
    name,
    size: children.reduce((sum, c) => sum + c.size, 0),
    children,
  }));
  if (!rawNodes.length) return [];

  const nodes = scaleSizes(rawNodes, 1);
  const regions: any[] = [];
  squarify(nodes, 0, 0, 1, 1, regions);

  const tiles: any[] = [];
  for (const region of regions) {
    const area = Math.max(1e-6, region.w * region.h);
    const kids = scaleSizes(region.children || [], area);
    const out: any[] = [];
    squarify(kids, region.x, region.y, region.w, region.h, out);
    tiles.push(...out.map((t) => ({ ...t, region: { x: region.x, y: region.y, w: region.w, h: region.h } })));
  }
  return tiles;
}

const TABS_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "gainers", label: "Gainers", icon: TrendingUp },
  { id: "losers", label: "Losers", icon: TrendingDown },
  { id: "active", label: "Active", icon: Zap },
  { id: "premarket", label: "Premarket", icon: Cloud },
  { id: "afterhours", label: "After Hours", icon: Moon },
  { id: "heatmap", label: "Heatmap", icon: BarChart3 },
];

const TAB_TITLES: Record<TabId, string> = {
  gainers: "Gainers",
  losers: "Losers",
  active: "Active",
  premarket: "Premarket",
  afterhours: "After Hours",
  heatmap: "Heatmap",
};

const PERIOD_TABS: { id: PeriodId; label: string }[] = [
  { id: "1d", label: "Today" },
  { id: "1w", label: "Week" },
  { id: "1mo", label: "Month" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "Year" },
  { id: "3y", label: "3 Years" },
  { id: "5y", label: "5 Years" },
];
const PERIOD_LABEL: Record<PeriodId, string> = {
  "1d": "Today", "1w": "This Week", "1mo": "This Month", ytd: "YTD", "1y": "This Year", "3y": "3 Years", "5y": "5 Years",
};

export function MarketMoversPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialTab = (searchParams.get("tab") as TabId) || (location.pathname.includes("/heatmap") ? "heatmap" : "gainers");

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [period, setPeriod] = useState<PeriodId>("1d");
  const [data, setData] = useState<{ gainers: MoverRow[]; losers: MoverRow[]; active: MoverRow[]; sectors: SectorRow[]; premarket: Record<string, any> } | null>(null);
  const [indices, setIndices] = useState<IndexRow[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [asOf, setAsOf] = useState<string>("");
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("changePercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const ROWS_PER_PAGE = 20;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMovers = useCallback(async (attempt = 1): Promise<void> => {
    const maxAttempts = 2;
    const effectivePeriod: PeriodId = activeTab === "gainers" || activeTab === "losers" ? period : "1d";
    try {
      setLoading(true);
      const fetchJson = async (url: string) => {
        const res = await fetch(`${API_BASE_URL}${url}`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const [moversRes, sectorsRes, indicesRes, statusRes] = await Promise.allSettled([
        fetchJson(`/market/movers?period=${effectivePeriod}`),
        fetchJson(`/market/sectors/tree`),
        fetchJson(`/market/indices`),
        fetchJson(`/market/status`),
      ]);

      if (moversRes.status !== "fulfilled" || !moversRes.value || typeof moversRes.value !== "object") {
        throw new Error("movers endpoint returned no data");
      }
      const md: any = moversRes.value;
      const hasMoversData =
        Array.isArray(md.combined?.gainers) || Array.isArray(md.combined?.losers) ||
        Array.isArray(md.gainers) || Array.isArray(md.losers) ||
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
      const withChange = (r: any): MoverRow => ({
        ...r,
        ticker: normalizeTicker(r.ticker || r.symbol),
        change: r.change ?? ((r.changePercent ?? 0) >= 0 ? "+" : "") + Number(r.changePercent ?? 0).toFixed(2) + "%",
        rawVolume: Number.isFinite(Number(r.rawVolume)) && Number(r.rawVolume) > 0 ? Number(r.rawVolume) : parseCompact(r.volume),
        changeAmount: Number.isFinite(Number(r.changeAmount)) ? Number(r.changeAmount) : null,
        updatedAt: r.updatedAt || null,
      });
      const gainers: MoverRow[] = pick("gainers").map(withChange);
      const losers: MoverRow[] = pick("losers").map(withChange);
      const active: MoverRow[] = pick("active").map(withChange);

      const sectors: SectorRow[] = (() => {
        if (sectorsRes.status !== "fulfilled") return [];
        const sd: any = sectorsRes.value;
        if (!Array.isArray(sd)) return [];
        return sd.map((s: any) => ({ name: s.name, changePercent: s.changePercent ?? 0, isPositive: (s.changePercent ?? 0) >= 0, children: s.children || [] }));
      })();

      const idx: IndexRow[] = (() => {
        if (indicesRes.status !== "fulfilled" || !Array.isArray(indicesRes.value)) return [];
        return indicesRes.value
          .filter((i: any) => i && i.symbol)
          .map((i: any) => ({
            symbol: i.symbol,
            name: i.name || i.symbol,
            value: String(i.value ?? "—"),
            change: i.change ?? "0.00%",
            changeRaw: Number(i.changeRaw ?? 0),
            isPositive: i.isPositive !== false,
            market: i.market || "Global",
          }));
      })();

      const tickers = new Set<string>();
      [...gainers.slice(0, 10), ...losers.slice(0, 10), ...active.slice(0, 10)].forEach((r) => {
        const t = normalizeTicker(r.ticker || r.symbol);
        if (t && !/[:=^]/.test(t)) tickers.add(t);
      });
      let premarket: Record<string, any> = {};
      if (tickers.size > 0) {
        try {
          const pmRes = await fetch(`${API_BASE_URL}/market/premarket?symbols=${Array.from(tickers).join(",")}`, { credentials: "include" });
          if (pmRes.ok) premarket = await pmRes.json();
        } catch { /* silent */ }
      }

      setData({ gainers, losers, active, sectors, premarket });
      setIndices(idx);
      setStatus(statusRes.status === "fulfilled" ? statusRes.value : null);
      setAsOf(md.updatedAt || new Date().toISOString());
      setCached(!!md.cached);
      setLastUpdated(new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" }));
      setError(null);
    } catch (e: any) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        return fetchMovers(attempt + 1);
      }
      setError(e.message || "Failed to load market movers");
    } finally {
      setLoading(false);
    }
  }, [period, activeTab]);

  useEffect(() => {
    fetchMovers();
    pollRef.current = setInterval(fetchMovers, 60000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMovers]);

  useEffect(() => {
    setSortKey("changePercent");
    setSortDir(activeTab === "losers" ? "asc" : "desc");
    setPage(1);
  }, [activeTab]);

  useEffect(() => { setPage(1); }, [period]);

  const goToStock = (ticker?: string | null, market?: string | null) => {
    const t = normalizeTicker(ticker);
    if (!t) return;
    const m = String(market || "").toLowerCase();
    const q = m && m !== "global" ? `?market=${encodeURIComponent(m)}` : "";
    navigate(`/app/stock/${encodeURIComponent(t)}${q}`);
  };

  const rows = useMemo<MoverRow[]>(() => {
    if (!data) return [];
    switch (activeTab) {
      case "gainers": return data.gainers;
      case "losers": return data.losers;
      case "active": return data.active;
      case "premarket":
        return Object.entries(data.premarket).map(([symbol, q]: [string, any]) => {
          const c = Number(q.preMarketChangePercent ?? 0);
          return {
            ticker: normalizeTicker(symbol), symbol,
            name: q.company_name || q.name || symbol,
            price: Number(q.preMarketPrice ?? 0),
            change: (c >= 0 ? "+" : "") + c.toFixed(2) + "%",
            changePercent: c, isPositive: c >= 0,
            changeAmount: Number.isFinite(Number(q.preMarketChange)) ? Number(q.preMarketChange) : null,
            volume: formatCompact(Number(q.preMarketVolume ?? 0)),
            rawVolume: Number(q.preMarketVolume ?? 0),
            marketCap: Number(q.marketCap ?? 0),
            currency: q.currency ?? "USD", market: q.market ?? "Global",
            updatedAt: Number.isFinite(Number(q.preMarketTime)) && Number(q.preMarketTime) > 0 ? new Date(Number(q.preMarketTime)).toISOString() : null,
          };
        }).filter((r) => r.price > 0);
      case "afterhours":
        return Object.entries(data.premarket).map(([symbol, q]: [string, any]) => {
          const c = Number(q.postMarketChangePercent ?? 0);
          return {
            ticker: normalizeTicker(symbol), symbol,
            name: q.company_name || q.name || symbol,
            price: Number(q.postMarketPrice ?? 0),
            change: (c >= 0 ? "+" : "") + c.toFixed(2) + "%",
            changePercent: c, isPositive: c >= 0,
            changeAmount: Number.isFinite(Number(q.postMarketChange)) ? Number(q.postMarketChange) : null,
            volume: formatCompact(Number(q.postMarketVolume ?? 0)),
            rawVolume: Number(q.postMarketVolume ?? 0),
            marketCap: Number(q.marketCap ?? 0),
            currency: q.currency ?? "USD", market: q.market ?? "Global",
            updatedAt: Number.isFinite(Number(q.postMarketTime)) && Number(q.postMarketTime) > 0 ? new Date(Number(q.postMarketTime)).toISOString() : null,
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
      else if (sortKey === "changeAmount") cmp = absChangeOf(a) - absChangeOf(b);
      else if (sortKey === "changePercent") cmp = a.changePercent - b.changePercent;
      else if (sortKey === "price") cmp = Number(a.price) - Number(b.price);
      else if (sortKey === "volume") cmp = (Number(a.rawVolume) || parseCompact(a.volume)) - (Number(b.rawVolume) || parseCompact(b.volume));
      else if (sortKey === "marketCap") cmp = Number(a.marketCap) - Number(b.marketCap);
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
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground">
        {label}
        {sortKey === k ? <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </TableHead>
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const heatmapSectors = useMemo<SectorRow[]>(() => {
    if (data?.sectors?.length) return data.sectors;
    if (!data) return [];
    const map = new Map<string, any>();
    for (const r of [...data.gainers, ...data.losers, ...data.active]) {
      const t = normalizeTicker(r.ticker);
      if (!t || map.has(t)) continue;
      map.set(t, {
        name: t, fullName: r.name, changePercent: r.changePercent, price: r.price,
        marketCap: r.marketCap, currency: r.currency, market: r.market, volume: r.volume,
      });
    }
    const children = [...map.values()];
    return children.length ? [{ name: "Market", changePercent: 0, isPositive: true, children }] : [];
  }, [data]);
  const heatmapTiles = useMemo(() => buildHeatmap(heatmapSectors), [heatmapSectors]);
  const heatmapSectorRegions = useMemo(() => {
    const seen = new Map<string, any>();
    for (const t of heatmapTiles) {
      if (t.sector && t.region && !seen.has(t.sector)) seen.set(t.sector, t.region);
    }
    return [...seen.entries()];
  }, [heatmapTiles]);
  const globalIndices = indices.filter((i) => i.market === "Global").slice(0, 4);
  const changeColor = (pct: number) => (pct >= 0 ? "text-emerald-600" : "text-red-600");
  const isListTab = activeTab !== "heatmap";

  // Exchange-aware session labels. We use the Global (US) calendar for the
  // header; African sessions are reported via the market-status API too.
  const SESSION_TZ = "America/New_York";
  const marketOpen = openOf(status?.global) || ["nse", "ngx", "jse"].some((k) => openOf(status?.[k]));
  const lastSession = tradingDateLabel(SESSION_TZ);
  const sessionWord = marketOpen ? "Today" : "Last Trading Session";
  const sessionSuffix = marketOpen ? "" : ` · ${lastSession}`;
  const asOfTime = fmtTzTime(asOf, SESSION_TZ);
  const freshness = error
    ? "Stale"
    : cached
      ? (marketOpen ? "Delayed (cached)" : "Cached · last session")
      : marketOpen ? "Live" : "Last trading session";

  const periodWord = period === "1d" ? sessionWord : PERIOD_LABEL[period];
  const sectionTitle = activeTab === "gainers" || activeTab === "losers"
    ? `${TAB_TITLES[activeTab]} ${periodWord}`
    : TAB_TITLES[activeTab];
  const emptyMessage =
    activeTab === "premarket"
      ? `Premarket session is closed or no premarket quotes are available for the tracked universe. Last checked ${lastUpdated || "—"}.`
      : activeTab === "afterhours"
        ? `After-hours session is closed or no after-hours quotes are available for the tracked universe. Last checked ${lastUpdated || "—"}.`
        : `No ${sectionTitle.toLowerCase()} data available right now.`;

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Header + tabs */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] via-[#0EA5E9]/[0.03] to-transparent p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">Market Movers</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Live market data across Global and African markets.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => fetchMovers()} size="sm" disabled={loading} className="flex items-center gap-1.5 text-xs">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-4" />}
              <span>Refresh</span>
            </Button>
            <span className={`text-[11px] font-semibold ${error ? "text-amber-700" : marketOpen ? "text-emerald-600" : "text-muted-foreground"}`}>{freshness}</span>
            <span className="text-[11px] text-muted-foreground">as of {asOfTime}{sessionSuffix}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
          {TABS_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors whitespace-nowrap text-[13px] ${isActive ? "border-[#0D7490] text-[#0D7490] font-semibold" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {(activeTab === "gainers" || activeTab === "losers") && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {PERIOD_TABS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${period === p.id ? "bg-[#0D7490] text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Indexes */}
      {isListTab && globalIndices.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Stock Indexes</h2>
            <span className="text-[11px] text-muted-foreground">{marketOpen ? `Today · ${asOfTime}` : `Last session${sessionSuffix} · ${asOfTime}`}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {globalIndices.map((i) => (
              <div key={i.symbol} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold text-foreground">{i.symbol.replace(/^\^/, "")}</span>
                  <span className={`text-[11px] font-semibold tabular-nums ${changeColor(i.changeRaw)}`}>{i.change}</span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{i.name}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{i.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && data && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Showing the last available data — refresh failed: {error}
        </div>
      )}
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
      {loading && !data && (
        <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mb-2" />
          <p className="text-xs">Loading market movers…</p>
        </div>
      )}

      {/* Section title + toolbar */}
      {isListTab && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-foreground">{sectionTitle}</h2>
            <p className="text-[11px] text-muted-foreground">{marketOpen ? "Live" : "Last trading session"}{sessionSuffix} · as of {asOfTime}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Filter results</span>
              <select
                value={marketFilter}
                onChange={(e) => { setMarketFilter(e.target.value as MarketFilter); setPage(1); }}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="all">All markets</option>
                <option value="Global">Global</option>
                <option value="NSE">NSE</option>
                <option value="NGX">NGX</option>
                <option value="JSE">JSE</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <Search className="size-3.5 text-muted-foreground" />
              <Input
                placeholder="Find…"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="h-8 w-[150px] text-xs"
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => navigate("/app/stocks")}>Screener</Button>
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => {
              const header = ["Ticker", "Company", "ChangePercent", "Price", "Volume", "MarketCap", "Market"];
              const lines = [header.join(",")].concat(filteredRows.map((r) => [
                r.ticker, `"${String(r.name || "").replace(/"/g, '""')}"`, r.changePercent, r.price, r.rawVolume ?? r.volume, r.marketCap, r.market,
              ].join(",")));
              const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${activeTab}-movers.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }} disabled={filteredRows.length === 0}>Download</Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isListTab && (
        <div className="border border-border rounded-2xl shadow-sm bg-background overflow-hidden">
          <ScrollArea className="h-[620px]">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow className="text-[10px] uppercase tracking-wider text-muted-foreground bg-[#0D7490]/5">
                  <TableHead className="w-8">#</TableHead>
                  {sortHead("Symbol", "ticker", "w-20")}
                  {sortHead("Company", "name", "min-w-[160px]")}
                  {sortHead("Price", "price", "text-right w-20")}
                  {sortHead("Change", "changeAmount", "text-right w-20")}
                  {sortHead("Change %", "changePercent", "text-right w-20")}
                  {sortHead("Volume", "volume", "text-right w-28")}
                  {sortHead("Mkt Cap", "marketCap", "text-right w-24")}
                  <TableHead className="text-right w-16">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row, i) => {
                  const globalIndex = (currentPage - 1) * ROWS_PER_PAGE + i + 1;
                  const amt = absChangeOf(row);
                  const amtText = `${amt >= 0 ? "+" : "-"}${formatPrice(Math.abs(amt))}`;
                  return (
                    <TableRow
                      key={`${row.ticker}-${i}`}
                      className="text-sm cursor-pointer hover:bg-muted/40"
                      onClick={() => goToStock(row.ticker, row.market)}
                      title={`Open ${row.ticker} analysis`}
                    >
                      <TableCell className="font-medium text-muted-foreground">{globalIndex}</TableCell>
                      <TableCell className="font-semibold tabular-nums">{row.ticker}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{row.name}</TableCell>
                      <TableCell className="font-bold tabular-nums text-right">{formatPrice(Number(row.price))}</TableCell>
                      <TableCell className={`tabular-nums text-right ${changeColor(row.changePercent)}`}>{amtText}</TableCell>
                      <TableCell className={`font-semibold tabular-nums text-right ${changeColor(row.changePercent)}`}>
                        {(row.changePercent >= 0 ? "+" : "")}{Number(row.changePercent).toFixed(2)}%
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-muted-foreground">{displayVolume(row)}</TableCell>
                      <TableCell className="tabular-nums text-right text-muted-foreground">{formatCompact(Number(row.marketCap))}</TableCell>
                      <TableCell className="tabular-nums text-right text-muted-foreground">{fmtTzTime(row.updatedAt || asOf, SESSION_TZ)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {pageRows.length === 0 && (
              <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="size-8 mb-2 opacity-40" />
                <p className="text-xs">{emptyMessage}</p>
              </div>
            )}
          </ScrollArea>

          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs">
            <div className="text-muted-foreground">
              {filteredRows.length === 0 ? "No rows" : `Showing ${(currentPage - 1) * ROWS_PER_PAGE + 1} to ${Math.min(currentPage * ROWS_PER_PAGE, filteredRows.length)} of ${filteredRows.length} rows`}
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" disabled={currentPage <= 1 || filteredRows.length === 0} onClick={() => setPage(currentPage - 1)} className="px-2">
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="px-2 text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button size="sm" disabled={currentPage >= totalPages || filteredRows.length === 0} onClick={() => setPage(currentPage + 1)} className="px-2">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap */}
      {activeTab === "heatmap" && (
        <div className="border border-border rounded-2xl shadow-sm bg-background p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <BarChart3 className="size-5 text-[#0D7490]" />
            <span className="text-sm font-semibold text-foreground">Market Heat Map</span>
            <span className="ml-auto text-[11px] text-muted-foreground">Tile size = market cap / activity · Color = performance</span>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: "Top Gainers", rows: data?.gainers || [] },
              { label: "Top Losers", rows: data?.losers || [] },
              { label: "Most Active", rows: data?.active || [] },
            ].map((g) => (
              <div key={g.label} className="rounded-lg border border-border bg-muted/30 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{g.label}</p>
                <div className="space-y-0.5">
                  {g.rows.slice(0, 3).map((r) => (
                    <button key={`${g.label}-${r.ticker}`} onClick={() => goToStock(r.ticker, r.market)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted">
                      <span className="truncate text-[11.5px] font-medium text-foreground">{normalizeTicker(r.ticker)}</span>
                      <span className={`text-[11px] font-semibold tabular-nums ${changeColor(r.changePercent)}`}>{(r.changePercent >= 0 ? "+" : "")}{Number(r.changePercent).toFixed(2)}%</span>
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
                {heatmapSectorRegions.map(([name, r]) => (
                  <div
                    key={`sector-${name}`}
                    className="absolute border border-white/30 pointer-events-none"
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                  />
                ))}
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
                        left: `${t.x * 100}%`, top: `${t.y * 100}%`,
                        width: `${t.w * 100}%`, height: `${t.h * 100}%`,
                        backgroundColor: heatStyle(pct),
                      }}
                    >
                      <div className="absolute inset-0 bg-black/10" />
                      {t.w * 100 >= 4 && t.h * 100 >= 5 && (
                        <div className="relative z-10 p-1 text-[9px] font-bold leading-tight text-white">
                          <div className="truncate">{name}</div>
                          <div className="text-[8px] opacity-90">{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</div>
                        </div>
                      )}
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
    </div>
  );
}
