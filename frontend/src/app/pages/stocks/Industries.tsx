"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Search, TrendingUp, TrendingDown, Building2,
  BarChart3, RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router";
import { fetchScreenerResults, type ScreenerStock } from "../../services/screenerService";

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function parseVolume(vol: string): number {
  const num = parseFloat(vol.replace("M", "").replace("K", "").replace("B", ""));
  if (vol.includes("B")) return num * 1e9;
  if (vol.includes("M")) return num * 1e6;
  if (vol.includes("K")) return num * 1e3;
  return num;
}

interface IndustryGroup {
  name: string;
  stocks: ScreenerStock[];
  avgChange: number;
  totalVolume: number;
  avgVolume: number;
  avgScore: number;
  count: number;
}

export function Industries() {
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<"all" | "nse" | "global">("all");
  const [sortBy, setSortBy] = useState<"change" | "name" | "companies" | "score">("change");
  const [allStocks, setAllStocks] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = () => {
    setLoading(true);
    fetchScreenerResults({ limit: 200 })
      .then(r => { setAllStocks(r.stocks); setLoading(false); })
      .catch(() => { setLoading(false); });
  };

  useEffect(() => { fetchData(); }, []);

  const industries = useMemo(() => {
    const groups: Record<string, IndustryGroup> = {};

    allStocks.forEach(stock => {
      const sector = stock.sector || "Other";
      if (!groups[sector]) {
        groups[sector] = { name: sector, stocks: [], totalVolume: 0, avgChange: 0, avgVolume: 0, avgScore: 0, count: 0 };
      }
      groups[sector].stocks.push(stock);
      groups[sector].totalVolume += parseVolume(stock.volume);
      groups[sector].count++;
    });

    return Object.values(groups).map(g => ({
      ...g,
      avgChange: +(g.stocks.reduce((sum, s) => sum + (s.change || 0), 0) / g.count).toFixed(2),
      avgVolume: g.count > 0 ? Math.round(g.totalVolume / g.count) : 0,
      avgScore: +(g.stocks.reduce((sum, s) => sum + (s.score || 0), 0) / g.count).toFixed(1),
    }));
  }, [allStocks]);

  const filtered = useMemo(() => {
    let list = industries;
    if (search) {
      list = list.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    }
    if (marketFilter !== "all") {
      list = list.filter(i =>
        i.stocks.some(s => s.market?.toLowerCase() === marketFilter)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "companies") return b.count - a.count;
      if (sortBy === "score") return b.avgScore - a.avgScore;
      return b.avgChange - a.avgChange;
    });
  }, [industries, search, marketFilter, sortBy]);

  const totalIndustries = industries.length;
  const advancing = industries.filter(i => i.avgChange > 0).length;
  const declining = industries.filter(i => i.avgChange < 0).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Industries & Sectors</h2>
          <p className="text-sm text-muted-foreground">Real-time performance across all industries and sectors</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 hover:bg-muted rounded-lg transition-colors" title="Refresh">
            <RefreshCw className={`size-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search industries..."
              className="w-44 pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={marketFilter}
            onChange={e => setMarketFilter(e.target.value as any)}
          >
            <option value="all">All Markets</option>
            <option value="nse">NSE</option>
            <option value="global">Global</option>
          </select>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="change">Avg Change</option>
            <option value="name">Name</option>
            <option value="companies">Companies</option>
            <option value="score">Avg Score</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Total Industries</p>
          <p className="text-2xl font-bold text-foreground">{totalIndustries}</p>
        </Card>
        <Card className="p-4 border-emerald-200 bg-emerald-50/30">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Advancing</p>
          <p className="text-2xl font-bold text-emerald-600">{advancing}</p>
        </Card>
        <Card className="p-4 border-red-200 bg-red-50/30">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Declining</p>
          <p className="text-2xl font-bold text-red-600">{declining}</p>
        </Card>
      </div>

      {loading && allStocks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading industry data...</div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(industry => {
          const nseCount = industry.stocks.filter(s => s.market === "NSE").length;
          const globalCount = industry.stocks.filter(s => s.market === "Global").length;
          const isPositive = industry.avgChange >= 0;

          return (
            <Card key={industry.name} className="p-5 hover:shadow-md transition-all cursor-pointer" onClick={() => navigate(`/app/sectors`)}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                    <Building2 className="size-5 text-[#0D7490]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground">{industry.name}</h3>
                    <p className="text-xs text-muted-foreground">{industry.count} companies</p>
                  </div>
                </div>
                <div className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold ${isPositive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {isPositive ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                  {isPositive ? "+" : ""}{industry.avgChange}%
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {nseCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-[#0D7490]" /> NSE: {nseCount}
                  </span>
                )}
                {globalCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-indigo-500" /> Global: {globalCount}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <BarChart3 className="size-3" /> Score: {industry.avgScore}
                </span>
                <span className="flex items-center gap-1 ml-auto">
                  <BarChart3 className="size-3" /> Vol: {formatCompactNumber(industry.avgVolume)}
                </span>
              </div>
              {industry.stocks.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">Top Companies</p>
                  <div className="flex flex-wrap gap-2">
                    {industry.stocks.slice(0, 6).map(s => (
                      <Badge key={s.ticker} variant="secondary" className="text-[10px] cursor-pointer hover:bg-muted" onClick={(e) => { e.stopPropagation(); navigate(`/app/stock/${s.ticker}?market=${s.market?.toLowerCase()}`); }}>
                        {s.ticker}
                      </Badge>
                    ))}
                    {industry.stocks.length > 6 && (
                      <Badge variant="outline" className="text-[10px]">+{industry.stocks.length - 6} more</Badge>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      )}
    </div>
  );
}
