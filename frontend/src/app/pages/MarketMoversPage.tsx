"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router";
import {
  BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Cloud, Loader2, Moon, RefreshCcw, Search,
  TrendingDown, TrendingUp, Zap,
} from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Input } from "../components/ui/input";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

type TabId = "gainers" | "losers" | "active" | "premarket" | "afterhours" | "heatmap";
type PeriodId = "1d" | "1w" | "1mo" | "ytd" | "1y" | "3y" | "5y";
type SortKey = "ticker" | "name" | "changeAmount" | "changePercent" | "price" | "volume" | "marketCap";
type MarketFilter = "all" | "Global" | "NSE" | "NGX" | "JSE";
type HeatMarket = "all" | "global" | "african";

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
  currency?: string;
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
  const abs = Math.abs(n);
  const maxDecimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals });
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
  if (!nodes.length || !(width > 1e-9) || !(height > 1e-9)) return;
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
  const safeRowSize = bestRowSize > 0 ? bestRowSize : 1e-9;
  if (width >= height) {
    const rowHeight = safeRowSize / width;
    let cx = x;
    for (const node of bestRow) {
      const nw = Math.max(1e-9, node.size / rowHeight);
      result.push({ ...node, x: cx, y, w: nw, h: rowHeight });
      cx += nw;
    }
    const remaining = nodes.filter((n) => !bestRow.includes(n));
    squarify(remaining, x, y + rowHeight, width, Math.max(0, height - rowHeight), result);
  } else {
    const rowWidth = safeRowSize / height;
    let cy = y;
    for (const node of bestRow) {
      const nh = Math.max(1e-9, node.size / rowWidth);
      result.push({ ...node, x, y: cy, w: rowWidth, h: nh });
      cy += nh;
    }
    const remaining = nodes.filter((n) => !bestRow.includes(n));
    squarify(remaining, x + rowWidth, y, Math.max(0, width - rowWidth), height, result);
  }
}

function heatStyle(pct: number): { backgroundColor: string; color: string } {
  const p = Number.isFinite(pct) ? pct : 0;
  const a = Math.abs(p);
  if (a < 0.05) return { backgroundColor: "rgba(100,116,139,0.35)", color: "#0f172a" }; // flat / no move
  if (p > 0) {
    if (a >= 5) return { backgroundColor: "rgba(21,128,61,0.92)", color: "#ffffff" };
    if (a >= 3) return { backgroundColor: "rgba(22,163,74,0.85)", color: "#ffffff" };
    if (a >= 2) return { backgroundColor: "rgba(34,197,94,0.78)", color: "#052e16" };
    if (a >= 1) return { backgroundColor: "rgba(74,222,128,0.72)", color: "#052e16" };
    return { backgroundColor: "rgba(134,239,172,0.65)", color: "#052e16" };
  }
  if (a >= 5) return { backgroundColor: "rgba(153,27,27,0.92)", color: "#ffffff" };
  if (a >= 3) return { backgroundColor: "rgba(185,28,28,0.86)", color: "#ffffff" };
  if (a >= 2) return { backgroundColor: "rgba(220,38,38,0.80)", color: "#ffffff" };
  if (a >= 1) return { backgroundColor: "rgba(248,113,113,0.75)", color: "#450a0a" };
  return { backgroundColor: "rgba(252,165,165,0.68)", color: "#450a0a" };
}

// Scale node sizes so their total equals the rectangle area. squarify expects
// sizes in the same units as the area; without this, coordinates come out in
// market-cap units (e.g. 3.9e12) and every tile renders off-screen.
function scaleSizes(nodes: any[], area: number): any[] {
  const total = nodes.reduce((s, n) => s + (n.size > 0 ? n.size : 1), 0) || 1;
  const k = area / total;
  return nodes.map((n) => ({ ...n, size: Math.max((n.size > 0 ? n.size : 1) * k, 1e-9) }));
}

function buildHeatmap(sectors: SectorRow[], mode: HeatMarket = "all"): any[] {
  const isAfrican = (m?: string) => ["NSE", "NGX", "JSE"].includes(String(m || "").toUpperCase());
  // Activity-based sizing for African stocks (no reliable market cap). Raw share
  // volume spans 1..millions → ~65k:1 slivers; log10 compresses while preserving order.
  const activitySize = (v: number) => (v > 0 ? Math.log10(1 + v) : 1);

  const flat: any[] = [];
  for (const s of sectors) {
    for (const c of (s.children || [])) {
      const market = c.market || "Global";
      const group = isAfrican(market) ? "African" : "Global";
      if (mode === "global" && group === "African") continue;
      if (mode === "african" && group === "Global") continue;
      // Skip rows with no usable quote — they render as empty/grey boxes.
      const priceNum = Number(c.price) || 0;
      const pctNum = Number(c.changePercent) || 0;
      if (!(priceNum > 0) && pctNum === 0) continue;
      // African: always log-activity (caps are mostly 0 and inconsistent).
      // Global: market cap, falling back to log activity.
      const cap = Number(c.marketCap) > 0 ? Number(c.marketCap) : 0;
      const size = group === "African" ? activitySize(parseCompact(c.volume)) : (cap > 0 ? cap : activitySize(parseCompact(c.volume)));
      flat.push({ ...c, sector: s.name, market, group, size });
    }
  }
  if (!flat.length) return [];
  flat.sort((a, b) => b.size - a.size);

  const global = flat.filter((c) => c.group === "Global").slice(0, 120);
  const african = flat.filter((c) => c.group === "African").slice(0, 50);

  // Deterministic regions (no squarify on 2 thin groups, which can consume the
  // full width and drop the remaining tiles).
  const blocks: { name: string; rect: { x: number; y: number; w: number; h: number }; tiles: any[] }[] = [];
  if (mode === "african") {
    blocks.push({ name: "African", rect: { x: 0, y: 0, w: 1, h: 1 }, tiles: african });
  } else if (mode === "global") {
    blocks.push({ name: "Global", rect: { x: 0, y: 0, w: 1, h: 1 }, tiles: global });
  } else if (global.length && african.length) {
    blocks.push({ name: "Global", rect: { x: 0, y: 0, w: 1, h: 0.78 }, tiles: global });
    blocks.push({ name: "African", rect: { x: 0, y: 0.78, w: 1, h: 0.22 }, tiles: african });
  } else if (global.length) {
    blocks.push({ name: "Global", rect: { x: 0, y: 0, w: 1, h: 1 }, tiles: global });
  } else if (african.length) {
    blocks.push({ name: "African", rect: { x: 0, y: 0, w: 1, h: 1 }, tiles: african });
  }
  if (!blocks.length) return [];

  const tiles: any[] = [];
  for (const b of blocks) {
    const { x, y, w, h } = b.rect;
    const area = Math.max(1e-6, w * h);
    const kids = scaleSizes(b.tiles, area);
    const placed: any[] = [];
    squarify(kids, x, y, w, h, placed);
    tiles.push(...placed.map((t) => ({ ...t, group: b.name, region: { x, y, w, h } })));
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
  const [heatMarket, setHeatMarket] = useState<HeatMarket>("all");
  const ROWS_PER_PAGE = 20;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMovers = useCallback(async (attempt = 1, force = false): Promise<void> => {
    const maxAttempts = 2;
    const effectivePeriod: PeriodId = activeTab === "gainers" || activeTab === "losers" ? period : "1d";
    try {
      setLoading(true);
      const fetchJson = async (url: string, init?: RequestInit) => {
        const res = await fetch(`${API_BASE_URL}${url}`, { credentials: "include", ...init });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      };
      const moversUrl = `/market/movers?period=${effectivePeriod}${force ? "&refresh=1" : ""}`;
      const [moversRes, sectorsRes, indicesRes, statusRes] = await Promise.allSettled([
        fetchJson(moversUrl, force ? { cache: "no-store" } : undefined),
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
            currency: i.currency || "",
          }));
      })();

      const tickers = new Set<string>();
      const isGlobalMover = (r: any) => String(r?.market || "").toUpperCase() === "GLOBAL";
      [...gainers, ...losers, ...active].filter(isGlobalMover).forEach((r) => {
        const t = normalizeTicker(r.ticker || r.symbol);
        if (t && !/[:=^]/.test(t)) tickers.add(t);
      });
      // Extended-hours quotes only exist for US listings, so use a broad Global
      // universe (top names by market cap) rather than just the current movers.
      const globalUniverse = sectors
        .flatMap((s) => s.children || [])
        .filter((c: any) => String(c.market || "").toUpperCase() === "GLOBAL" && Number(c.price) > 0)
        .sort((a: any, b: any) => Number(b.marketCap) - Number(a.marketCap))
        .map((c: any) => normalizeTicker(c.name || c.ticker))
        .filter((t: string) => t && !/[:=^]/.test(t));
      for (const t of globalUniverse) {
        if (tickers.size >= 120) break;
        tickers.add(t);
      }
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
        return fetchMovers(attempt + 1, force);
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

  // Pre/post-market prints are separate from the regular-session movers table.
  // Build both so the Premarket and After Hours tabs can fall back to the most
  // recent extended session instead of showing an empty table on weekends.
  const extendedRows = useMemo<{ pre: MoverRow[]; post: MoverRow[] }>(() => {
    const entries = Object.entries(data?.premarket || {});
    const build = (session: "pre" | "post"): MoverRow[] => entries.map(([symbol, q]: [string, any]) => {
      const prefix = session === "pre" ? "preMarket" : "postMarket";
      const c = Number(q[`${prefix}ChangePercent`] ?? 0);
      const volume = Number(q[`${prefix}Volume`] ?? q.regularMarketVolume ?? 0);
      const time = Number(q[`${prefix}Time`]);
      return {
        ticker: normalizeTicker(symbol), symbol,
        name: q.company_name || q.name || symbol,
        price: Number(q[`${prefix}Price`] ?? 0),
        change: (c >= 0 ? "+" : "") + c.toFixed(2) + "%",
        changePercent: c, isPositive: c >= 0,
        changeAmount: Number.isFinite(Number(q[`${prefix}Change`])) ? Number(q[`${prefix}Change`]) : null,
        volume: formatCompact(volume),
        rawVolume: volume,
        marketCap: Number(q.marketCap ?? 0),
        currency: q.currency ?? "USD", market: q.market ?? "Global",
        updatedAt: Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null,
      };
    }).filter((r) => r.price > 0);
    return { pre: build("pre"), post: build("post") };
  }, [data]);

  const rows = useMemo<MoverRow[]>(() => {
    if (!data) return [];
    switch (activeTab) {
      case "gainers": return data.gainers;
      case "losers": return data.losers;
      case "active": return data.active;
      case "premarket": return extendedRows.pre.length ? extendedRows.pre : extendedRows.post;
      case "afterhours": return extendedRows.post.length ? extendedRows.post : extendedRows.pre;
      default: return data.gainers;
    }
  }, [data, activeTab, extendedRows]);

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
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground">
        {label}
        {sortKey === k ? (sortDir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : null}
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
  const heatmapTiles = useMemo(() => buildHeatmap(heatmapSectors, heatMarket), [heatmapSectors, heatMarket]);
  const heatmapGroupRegions = useMemo(() => {
    const seen = new Map<string, any>();
    for (const t of heatmapTiles) {
      if (t.group && t.region && !seen.has(t.group)) seen.set(t.group, t.region);
    }
    return [...seen.entries()];
  }, [heatmapTiles]);
  const globalIndices = indices.filter((i) => i.market === "Global").slice(0, 4);
  const AFRICAN_INDEX_ORDER = ["NSE:NSEASI", "NSE:NSE20", "NGX:ASI", "^J203.JO"];
  const africanIndices = AFRICAN_INDEX_ORDER
    .map((sym) => indices.find((i) => i.symbol === sym))
    .filter((i): i is IndexRow => Boolean(i));
  const shownIndices = [...globalIndices, ...africanIndices];
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
      ? `Premarket session is closed or no premarket quotes are available for the tracked universe. Last checked ${lastUpdated || "-"}.`
      : activeTab === "afterhours"
        ? `After-hours session is closed or no after-hours quotes are available for the tracked universe. Last checked ${lastUpdated || "-"}.`
        : `No ${sectionTitle.toLowerCase()} data available right now.`;
  const extendedFallback: string | null =
    activeTab === "premarket" && extendedRows.pre.length === 0 && extendedRows.post.length > 0
      ? "after-hours"
      : activeTab === "afterhours" && extendedRows.post.length === 0 && extendedRows.pre.length > 0
        ? "pre-market"
        : null;

  return (
    <div className="w-full max-w-none px-3 md:px-5 py-5 space-y-4">
      {/* Header + tabs */}
      <div className="rounded-2xl border border-[#0D7490]/15 bg-gradient-to-br from-[#0D7490]/[0.06] via-[#0EA5E9]/[0.03] to-transparent p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight text-foreground">Market Movers</h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  error
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
                    : marketOpen
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                      : "border-border bg-muted/50 text-muted-foreground"
                }`}
              >
                <span className={`size-1.5 rounded-full ${error ? "bg-amber-500" : marketOpen ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />
                {freshness}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Global and African markets · NSE · NGX · JSE</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="inline-flex items-center rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground">
              As of {asOfTime}{sessionSuffix}
            </span>
            <Button onClick={() => fetchMovers(1, true)} size="sm" disabled={loading} className="flex h-8 items-center gap-1.5 text-xs">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1 overflow-x-auto border-b border-border pb-1 [scrollbar-width:none]">
          {TABS_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors ${isActive ? "border-[#0D7490] font-semibold text-[#0D7490]" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {(activeTab === "gainers" || activeTab === "losers") && (
          <div className="mt-2 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {PERIOD_TABS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${period === p.id ? "bg-[#0D7490] text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Indexes */}
      {isListTab && shownIndices.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-1">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Market Indexes</h2>
              <p className="text-[11px] text-muted-foreground">Global benchmarks and African exchanges</p>
            </div>
            <span className="text-[11px] text-muted-foreground">{marketOpen ? `Today · ${asOfTime}` : `Last session${sessionSuffix} · ${asOfTime}`}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {shownIndices.map((i) => {
              const isAfrican = ["NSE", "NGX", "JSE"].includes(i.market);
              const code = i.symbol.replace(/^[A-Z]+:/, "").replace(/^\^/, "");
              return (
                <div key={i.symbol} className={`rounded-xl border bg-card p-3 ${isAfrican ? "border-[#0D7490]/25" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-semibold text-foreground">{code}</span>
                      <span className={`shrink-0 rounded px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide ${isAfrican ? "bg-[#0D7490]/10 text-[#0D7490]" : "bg-muted text-muted-foreground"}`}>{i.market}</span>
                    </div>
                    <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${changeColor(i.changeRaw)}`}>{i.change}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={i.name}>{i.name}</p>
                  <div className="mt-1 flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{i.value}</p>
                    <span className="text-[9.5px] uppercase text-muted-foreground">{i.currency}</span>
                  </div>
                </div>
              );
            })}
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
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-foreground">{sectionTitle}</h2>
            <p className="text-[11px] text-muted-foreground">{marketOpen ? "Live" : "Last trading session"}{sessionSuffix} · as of {asOfTime}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Find symbol or company"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="h-8 w-full pl-7 text-xs sm:w-[210px]"
              />
            </div>
            <select
              value={marketFilter}
              onChange={(e) => { setMarketFilter(e.target.value as MarketFilter); setPage(1); }}
              aria-label="Filter by market"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="all">All markets</option>
              <option value="Global">Global</option>
              <option value="NSE">NSE</option>
              <option value="NGX">NGX</option>
              <option value="JSE">JSE</option>
            </select>
            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => navigate("/app/stocks")}>Screener</Button>
            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => {
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

      {isListTab && extendedFallback && (
        <div className="rounded-lg border border-[#0D7490]/25 bg-[#0D7490]/[0.06] px-3 py-2 text-[11px] text-muted-foreground">
          {activeTab === "premarket" ? "Pre-market is closed" : "After-hours is closed"} — showing the most recent {extendedFallback} session.
        </div>
      )}

      {/* Table */}
      {isListTab && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="max-h-[620px] overflow-auto">
            <Table className="min-w-[900px]" containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
                <TableRow className="border-b border-border bg-[#0D7490]/5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-[#0D7490]/5">
                  <TableHead className="w-8">#</TableHead>
                  {sortHead("Symbol", "ticker", "w-24")}
                  {sortHead("Company", "name", "min-w-[160px]")}
                  {sortHead("Price", "price", "text-right w-20")}
                  {sortHead("Change", "changeAmount", "hidden text-right w-20 lg:table-cell")}
                  {sortHead("Change %", "changePercent", "text-right w-24")}
                  {sortHead("Volume", "volume", "text-right w-28")}
                  {sortHead("Mkt Cap", "marketCap", "hidden text-right w-24 md:table-cell")}
                  <TableHead className="hidden text-right w-16 xl:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((row, i) => {
                  const globalIndex = (currentPage - 1) * ROWS_PER_PAGE + i + 1;
                  const amt = absChangeOf(row);
                  const amtText = amt === 0 ? "—" : `${amt > 0 ? "+" : "-"}${formatPrice(Math.abs(amt))}`;
                  const pct = Number(row.changePercent) || 0;
                  const pctClass = pct > 0
                    ? "bg-emerald-500/10 text-emerald-700"
                    : pct < 0
                      ? "bg-red-500/10 text-red-700"
                      : "text-muted-foreground";
                  return (
                    <TableRow
                      key={`${row.ticker}-${i}`}
                      className="cursor-pointer text-sm odd:bg-muted/[0.02] hover:bg-[#0D7490]/[0.04]"
                      onClick={() => goToStock(row.ticker, row.market)}
                      title={`Open ${row.ticker} analysis`}
                    >
                      <TableCell className="font-medium text-muted-foreground">{globalIndex}</TableCell>
                      <TableCell>
                        <div className="font-semibold leading-tight tabular-nums">{row.ticker}</div>
                        <div className="mt-0.5 inline-flex rounded bg-muted px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">{row.market}</div>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-[13px]" title={row.name}>{row.name || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="font-bold tabular-nums">{formatPrice(Number(row.price))}</div>
                        <div className="text-[9px] uppercase text-muted-foreground">{row.currency}</div>
                      </TableCell>
                      <TableCell className={`hidden text-right tabular-nums lg:table-cell ${changeColor(pct)}`}>{amtText}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex min-w-[62px] justify-end rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${pctClass}`}>
                          {(pct >= 0 ? "+" : "")}{pct.toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{displayVolume(row)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{formatCompact(Number(row.marketCap))}</TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground xl:table-cell">{fmtTzTime(row.updatedAt || asOf, SESSION_TZ)}</TableCell>
                    </TableRow>
                  );
                })}
                {pageRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-[260px] text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <BarChart3 className="mb-2 size-8 opacity-40" />
                        <p className="text-xs">{emptyMessage}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2.5 text-xs">
            <div className="text-muted-foreground">
              {filteredRows.length === 0 ? "No rows" : `Showing ${(currentPage - 1) * ROWS_PER_PAGE + 1}–${Math.min(currentPage * ROWS_PER_PAGE, filteredRows.length)} of ${filteredRows.length}`}
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={currentPage <= 1 || filteredRows.length === 0} onClick={() => setPage(currentPage - 1)} className="h-7 px-2">
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="px-1.5 tabular-nums text-muted-foreground">{currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages || filteredRows.length === 0} onClick={() => setPage(currentPage + 1)} className="h-7 px-2">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap */}
      {activeTab === "heatmap" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="size-5 text-[#0D7490]" />
                <span className="text-sm font-semibold text-foreground">Market Heat Map</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Sector performance across Global and African markets</p>
            </div>
            <div className="flex items-center gap-1">
              {([
                { id: "all", label: "All markets" },
                { id: "global", label: "Global" },
                { id: "african", label: "African" },
              ] as { id: HeatMarket; label: string }[]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setHeatMarket(m.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${heatMarket === m.id ? "bg-[#0D7490] text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 mb-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-medium">Loss</span>
            <div className="flex h-2.5 overflow-hidden rounded-full border border-black/10">
              {[
                "rgba(153,27,27,0.92)",
                "rgba(220,38,38,0.80)",
                "rgba(100,116,139,0.35)",
                "rgba(34,197,94,0.78)",
                "rgba(21,128,61,0.92)",
              ].map((c) => (
                <span key={c} className="h-full w-8" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="font-medium">Gain</span>
            <span className="ml-auto">Tile size = market cap (or activity)</span>
          </div>

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: "Top Gainers", rows: data?.gainers || [] },
              { label: "Top Losers", rows: data?.losers || [] },
              { label: "Most Active", rows: data?.active || [] },
            ].map((g) => (
              <div key={g.label} className="rounded-xl border border-border bg-muted/30 p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
                <div className="space-y-1">
                  {g.rows.slice(0, 3).map((r) => (
                    <button key={`${g.label}-${r.ticker}`} onClick={() => goToStock(r.ticker, r.market)} className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-background/70">
                      <span className="truncate text-[11.5px] font-medium text-foreground">{normalizeTicker(r.ticker)}</span>
                      <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${changeColor(r.changePercent)}`}>{(r.changePercent >= 0 ? "+" : "")}{Number(r.changePercent).toFixed(2)}%</span>
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
                {heatmapGroupRegions.length > 1 && heatmapGroupRegions.map(([name, r]) => (
                  <div
                    key={`group-${name}`}
                    className="pointer-events-none absolute z-20 border border-white/25"
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                  >
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">{name}</span>
                  </div>
                ))}
                {heatmapTiles.map((t, i) => {
                  const pct = Number.isFinite(t.changePercent) ? t.changePercent : 0;
                  const name = normalizeTicker(t.name);
                  const label = String(t.fullName || t.name || "");
                  const tone = heatStyle(pct);
                  return (
                    <button
                      key={`${name}-${t.sector || ""}-${i}`}
                      onClick={() => goToStock(name, t.market)}
                      title={`${label}${t.sector ? ` · ${t.sector}` : ""} · ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                      className="group absolute overflow-hidden rounded-[2px] border border-black/10 text-left transition duration-150 hover:z-30 hover:brightness-110 focus:z-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                      style={{
                        left: `${t.x * 100}%`, top: `${t.y * 100}%`,
                        width: `${t.w * 100}%`, height: `${t.h * 100}%`,
                        backgroundColor: tone.backgroundColor,
                        color: tone.color,
                      }}
                    >
                      <div className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/0" />
                      {t.w * 100 >= 1.6 && t.h * 100 >= 1.9 && (
                        <div className="relative z-10 p-1 text-[8px] font-bold leading-tight">
                          <div className="truncate">{name || "—"}</div>
                          {t.w * 100 >= 4 && t.h * 100 >= 4.5 && (
                            <div className="text-[7.5px] font-semibold opacity-90">{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Green = up · Red = down</span>
                <span className="hidden sm:inline">·</span>
                <span>Click any tile to open its analysis</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
