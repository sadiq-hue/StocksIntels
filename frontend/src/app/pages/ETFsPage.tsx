import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  Search, RefreshCcw, TrendingUp, TrendingDown,
  Layers, Clock, Wifi, WifiOff,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

interface ETF {
  ticker: string; name: string; category: string;
  expenseRatio: number; aum: number; dividendYield: number;
  description: string; currency: string;
  price: number; change: number; changePercent: number;
  high: number; low: number; volume: number;
  open: number; previousClose: number; dataSource?: string;
  lastUpdated: string;
}

interface Summary {
  totalETFs: number; hasLiveData: boolean;
  topGainers: ETF[]; topLosers: ETF[]; largestAUM: ETF[];
  categories: { name: string; count: number }[];
  totalVolume: number; advancing: number; declining: number;
}

async function fetchYahooQuotes(tickers: string[]): Promise<Record<string, Partial<ETF>>> {
  const results = await Promise.allSettled(tickers.map(ticker =>
    fetch(`${YAHOO_BASE}/${ticker}?interval=1d&range=1d`, {
      headers: { Accept: "application/json" },
    })
      .then(r => r.json())
      .then(d => {
        const meta = d?.chart?.result?.[0]?.meta;
        if (!meta || meta.regularMarketPrice == null) return null;
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const change = price - prevClose;
        return {
          ticker,
          price,
          change: +change.toFixed(2),
          changePercent: +((change / prevClose) * 100).toFixed(2),
          high: meta.regularMarketDayHigh ?? 0,
          low: meta.regularMarketDayLow ?? 0,
          volume: meta.regularMarketVolume ?? 0,
          open: meta.regularMarketOpen ?? 0,
          previousClose: prevClose,
          dataSource: "yahoo",
          lastUpdated: new Date().toISOString(),
        };
      })
      .catch(() => null)
  ));

  const quotes: Record<string, Partial<ETF>> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      quotes[r.value.ticker] = r.value;
    }
  }
  return quotes;
}

export function ETFsPage() {
  const [etfs, setEtfs] = useState<ETF[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const tickersRef = useRef<string[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [etfsRes, summaryRes] = await Promise.all([
          fetch(`${API_URL}/etfs?market=all`),
          fetch(`${API_URL}/etfs/summary`),
        ]);
        const data: ETF[] = await etfsRes.json();
        setEtfs(data);
        setSummary(await summaryRes.json());
        tickersRef.current = data.filter(e => e.currency !== "KES").map(e => e.ticker);
        setLastUpdate(new Date());
      } catch (e) {
        console.error("Failed to load ETFs:", e);
      } finally {
        setInitialLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (initialLoading) return;
    let mounted = true;

    const update = async () => {
      const globalTickers = tickersRef.current;
      if (globalTickers.length === 0) return;

      const quotes = await fetchYahooQuotes(globalTickers);
      if (!mounted) return;

      if (Object.keys(quotes).length > 0) {
        setEtfs(prev =>
          prev.map(etf => {
            const q = quotes[etf.ticker];
            if (q && q.price != null) {
              return { ...etf, ...q } as ETF;
            }
            return etf;
          })
        );
        setLiveStatus("live");
      } else {
        setLiveStatus(prev => prev === "connecting" ? prev : "offline");
      }
      setLastUpdate(new Date());
    };

    update();
    const interval = setInterval(update, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [initialLoading]);

  const liveSummary = useMemo((): Summary | null => {
    if (!summary || etfs.length === 0) return summary;
    const advancing = etfs.filter(e => (e.changePercent || 0) > 0).length;
    const declining = etfs.filter(e => (e.changePercent || 0) < 0).length;
    const sortedByChange = [...etfs].sort((a, b) => b.changePercent - a.changePercent);
    return {
      ...summary,
      advancing,
      declining,
      topGainers: sortedByChange.slice(0, 5),
      topLosers: [...sortedByChange].reverse().slice(0, 5),
      totalVolume: etfs.reduce((s, e) => s + (e.volume || 0), 0),
      hasLiveData: etfs.some(e => e.dataSource === "yahoo"),
    };
  }, [etfs, summary]);

  const categories = ["all", ...new Set(etfs.map(e => e.category))];

  const filtered = etfs.filter(e => {
    if (category !== "all" && e.category !== category) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.ticker.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

  const formatCompact = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Exchange-Traded Funds</h2>
          <p className="text-sm text-muted-foreground">Track top ETFs across global markets — equity, bonds, commodities, and more</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="size-3" /> {lastUpdate.toLocaleTimeString()}
            </p>
          )}
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${liveStatus === "live" ? "bg-emerald-100 text-emerald-700" : liveStatus === "connecting" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
            {liveStatus === "live" ? <Wifi className="size-2.5" /> : <WifiOff className="size-2.5" />}
            {liveStatus === "live" ? "Live" : liveStatus === "connecting" ? "Connecting" : "Offline"}
          </span>
        </div>
      </div>

      {liveSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Total ETFs</p>
            <p className="text-2xl font-bold text-foreground">{liveSummary.totalETFs}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{liveSummary.categories.length} categories</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Advancing</p>
            <p className="text-2xl font-bold text-emerald-600">{liveSummary.advancing}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Declining: {liveSummary.declining}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Top Gainer</p>
            <p className="text-xl font-bold text-emerald-600">{liveSummary.topGainers?.[0]?.ticker || "—"}</p>
            <p className="text-xs text-emerald-600 mt-1">+{liveSummary.topGainers?.[0]?.changePercent?.toFixed(2) || "0"}%</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Top Loser</p>
            <p className="text-xl font-bold text-red-600">{liveSummary.topLosers?.[0]?.ticker || "—"}</p>
            <p className="text-xs text-red-600 mt-1">{liveSummary.topLosers?.[0]?.changePercent?.toFixed(2) || "0"}%</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-muted rounded-lg p-1 flex-wrap">
          {categories.slice(0, 8).map(c => (
            <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${category === c ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{c === "all" ? "All" : c}</button>
          ))}
        </div>
        <div className="relative w-full sm:w-auto sm:max-w-xs sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ETFs..." className="pl-9 w-full" />
        </div>
      </div>

      {initialLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="p-5 animate-pulse"><div className="flex gap-4"><div className="h-10 w-10 bg-muted rounded"></div><div className="flex-1"><div className="h-4 bg-muted rounded w-1/3 mb-2"></div><div className="h-3 bg-muted rounded w-1/2"></div></div></div></Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(etf => (
            <Card key={etf.ticker} className="p-4 hover:border-[#0D7490]/50 transition-all group">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-muted rounded-lg shrink-0">
                  <Layers className="size-5 text-[#0D7490]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-foreground font-bold text-sm">{etf.ticker}</span>
                    <Badge variant="outline" className="text-[10px]">{etf.category}</Badge>
                    {etf.currency === "KES" && <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">NSE</Badge>}
                    {etf.dataSource === "yahoo" && (
                      <span className="text-[8px] text-emerald-600 font-semibold uppercase tracking-wider flex items-center gap-0.5">
                        <Wifi className="size-2.5" /> Live
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{etf.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{etf.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-foreground font-semibold">{formatCurrency(etf.price)}</p>
                  <p className={`text-sm font-medium flex items-center justify-end gap-1 ${(etf.changePercent || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {(etf.changePercent || 0) >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {(etf.changePercent || 0) >= 0 ? "+" : ""}{etf.changePercent?.toFixed(2)}%
                  </p>
                </div>
                <div className="hidden md:grid grid-cols-3 gap-6 text-right shrink-0">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Expense</p>
                    <p className="text-sm font-medium text-foreground">{etf.expenseRatio.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">AUM</p>
                    <p className="text-sm font-medium text-foreground">{formatCompact(etf.aum)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Div Yield</p>
                    <p className="text-sm font-medium text-foreground">{etf.dividendYield.toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="p-8 text-center"><p className="text-muted-foreground text-sm">No ETFs match your filters.</p></Card>
          )}
        </div>
      )}
    </div>
  );
}
