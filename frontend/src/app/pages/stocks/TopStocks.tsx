"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Search, TrendingUp, TrendingDown,
  Trophy, Flame, Zap, Star, Award,
  DollarSign, BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

function parseVolume(vol: string | number): number {
  if (typeof vol === "number") return vol;
  const num = parseFloat(vol.replace("M", "").replace("K", "").replace("B", ""));
  if (vol.includes("B")) return num * 1e9;
  if (vol.includes("M")) return num * 1e6;
  if (vol.includes("K")) return num * 1e3;
  return num || 0;
}

function formatVolume(vol: number | string): string {
  const n = typeof vol === "string" ? parseVolume(vol) : vol;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n?.toLocaleString() || "0";
}

const signalColors: Record<string, string> = {
  "Strong Buy": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Buy": "bg-green-100 text-green-800 border-green-200",
  "Accumulate": "bg-teal-100 text-teal-800 border-teal-200",
  "Hold": "bg-amber-100 text-amber-800 border-amber-200",
  "Sell": "bg-orange-100 text-orange-800 border-orange-200",
  "Strong Sell": "bg-red-100 text-red-800 border-red-200",
};

export function TopStocks() {
  const [stocks, setStocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [category, setCategory] = useState<string>("gainers");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ category, market: marketFilter, limit: "50" });
    fetch(`${API_BASE}/top-stocks?${params}`)
      .then(r => r.json())
      .then(data => setStocks(data.stocks || []))
      .catch(() => setStocks([]))
      .finally(() => setLoading(false));
  }, [category, marketFilter]);

  const filtered = useMemo(() => {
    if (!search) return stocks;
    const q = search.toLowerCase();
    return stocks.filter(s =>
      (s.ticker || "").toLowerCase().includes(q) ||
      (s.name || "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  const categories = [
    { id: "gainers", label: "Top Gainers", icon: TrendingUp, color: "text-emerald-600" },
    { id: "losers", label: "Top Losers", icon: TrendingDown, color: "text-red-600" },
    { id: "active", label: "Most Active", icon: Flame, color: "text-orange-500" },
    { id: "mcap", label: "Largest MCap", icon: DollarSign, color: "text-purple-500" },
    { id: "rated", label: "Highest Rated", icon: Star, color: "text-yellow-500" },
    { id: "confident", label: "Highest Confidence", icon: Award, color: "text-blue-500" },
    { id: "value", label: "Best Value", icon: BarChart3, color: "text-cyan-500" },
    { id: "growth", label: "Growth Leaders", icon: Zap, color: "text-violet-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Top Stocks</h2>
          <p className="text-sm text-muted-foreground">Top performing stocks across all categories</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search stocks..."
              className="w-44 pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={marketFilter}
            onChange={e => setMarketFilter(e.target.value)}
          >
            <option value="all">All Markets</option>
            <option value="nse">NSE</option>
            <option value="global">Global</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {categories.map(cat => {
          const Icon = cat.icon;
          const isActive = category === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                isActive
                  ? "bg-[#0D7490] text-white shadow-sm"
                  : "bg-background border text-muted-foreground hover:bg-accent"
              }`}
            >
              <Icon className={`size-4 ${isActive ? "text-white" : cat.color}`} />
              {cat.label}
            </button>
          );
        })}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">#</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Symbol</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Name</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Signal</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Price</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Change</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden md:table-cell">Volume</th>
                <th className="px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden xl:table-cell">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((stock, idx) => {
                const isPositive = (stock.change || 0) >= 0;
                const showTrophy = idx < 3 && category === "gainers";
                const signalClass = signalColors[stock.signal] || "bg-gray-100 text-gray-800";
                return (
                  <tr
                    key={`${stock.ticker}-${idx}`}
                    className="group hover:bg-muted/50 transition-all duration-200 cursor-pointer"
                    onClick={() => navigate(`/app/stock/${stock.ticker}?market=${stock.market === "NSE" ? "nse" : "us"}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {showTrophy ? (
                          <Trophy className={`size-4 ${idx === 0 ? "text-yellow-400" : idx === 1 ? "text-gray-400" : "text-amber-600"}`} />
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">{idx + 1}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-foreground group-hover:text-[#0D7490] transition-colors">{stock.ticker}</span>
                        {stock.market === "NSE" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0D7490]/10 text-[#0D7490] font-bold">NSE</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-muted-foreground block max-w-[180px] truncate font-medium">{stock.name}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 ${signalClass}`}>
                        {stock.signal}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-bold text-foreground font-mono">
                        {stock.currency === "USD" ? "$" : "KES "}{(stock.price || 0).toFixed(2)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold ${isPositive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                        {isPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {isPositive ? "+" : ""}{(stock.change || 0).toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatVolume(stock.volume)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden xl:table-cell">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${stock.overallScore || 0}%`,
                              backgroundColor: (stock.overallScore || 0) >= 75 ? "#10b981" : (stock.overallScore || 0) >= 50 ? "#f59e0b" : "#ef4444",
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono font-bold text-muted-foreground">{stock.overallScore || 0}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="size-6 border-2 border-[#0D7490] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="size-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">No stocks match your criteria</p>
            </div>
          )}
        </div>
      </Card>

      {!loading && filtered.length > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {filtered.length} stocks &middot; {category === "gainers" ? "sorted by highest gain" : category === "losers" ? "sorted by biggest loss" : category === "active" ? "sorted by volume" : category === "mcap" ? "sorted by market cap" : category === "rated" ? "sorted by overall score" : category === "confident" ? "sorted by confidence" : category === "value" ? "sorted by fundamental value" : "sorted by growth score"}
        </div>
      )}
    </div>
  );
}
