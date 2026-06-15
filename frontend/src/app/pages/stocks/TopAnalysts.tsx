"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Search, TrendingUp, TrendingDown, Star,
  BarChart3, Target, Award, ChevronDown, ChevronUp, ThumbsUp,
  RefreshCw, Building2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { fetchScreenerResults, type ScreenerStock } from "../../services/screenerService";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface AnalystPick {
  symbol: string;
  rating: string;
  targetPrice: number;
  priceAtRecommendation: number;
  publishedDate: string | null;
}

interface AnalystFirm {
  id: string;
  name: string;
  rating: string;
  totalRatings: number;
  topSector: string;
  picks: AnalystPick[];
  avgTargetPrice: number;
  ratings: Record<string, number>;
}

interface AnalystResponse {
  firms: AnalystFirm[];
  total: number;
  totalRatings: number;
  timestamp: string;
}

const ratingColors: Record<string, string> = {
  "Strong Buy": "bg-emerald-50 text-emerald-700",
  "Buy": "bg-emerald-50 text-emerald-600",
  "Neutral": "bg-amber-50 text-amber-700",
  "Sell": "bg-red-50 text-red-600",
  "Strong Sell": "bg-red-50 text-red-700",
};

export function TopAnalysts() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"ratings" | "name">("ratings");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [data, setData] = useState<AnalystResponse | null>(null);
  const [prices, setPrices] = useState<Record<string, ScreenerStock>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/analysts`).then(r => r.json()),
      fetchScreenerResults({ limit: 200 }).catch(() => ({ stocks: [] })),
    ])
      .then(([analystData, screenerData]) => {
        setData(analystData);
        const priceMap: Record<string, ScreenerStock> = {};
        for (const s of screenerData.stocks || []) priceMap[s.ticker] = s;
        setPrices(priceMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    if (!data?.firms) return [];
    let list = data.firms;
    if (search) {
      list = list.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.topSector.toLowerCase().includes(search.toLowerCase()) ||
        a.picks.some(p => p.symbol.toLowerCase().includes(search.toLowerCase()))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.totalRatings - a.totalRatings;
    });
  }, [data, search, sortBy]);

  const totalBuys = data?.firms.reduce((s, f) => s + (f.ratings["Strong Buy"] || 0) + (f.ratings["Buy"] || 0), 0) || 0;
  const totalNeutral = data?.firms.reduce((s, f) => s + (f.ratings["Neutral"] || 0), 0) || 0;
  const totalSells = data?.firms.reduce((s, f) => s + (f.ratings["Sell"] || 0) + (f.ratings["Strong Sell"] || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Top Analysts</h2>
          <p className="text-sm text-muted-foreground">Real Wall Street analyst ratings & recommendations tracked via FMP</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 hover:bg-muted rounded-lg transition-colors" title="Refresh">
            <RefreshCw className={`size-4 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search analysts or stocks..."
              className="w-44 pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="ratings">Total Ratings</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Analyst Firms</p>
          <p className="text-2xl font-bold text-foreground">{data?.total || 0}</p>
        </Card>
        <Card className="p-4 border-emerald-200 bg-emerald-50/30">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Buy Ratings</p>
          <p className="text-2xl font-bold text-emerald-600">{totalBuys}</p>
        </Card>
        <Card className="p-4 border-amber-200 bg-amber-50/30">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Neutral</p>
          <p className="text-2xl font-bold text-amber-600">{totalNeutral}</p>
        </Card>
        <Card className="p-4 border-red-200 bg-red-50/30">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Sell Ratings</p>
          <p className="text-2xl font-bold text-red-600">{totalSells}</p>
        </Card>
      </div>

      {loading && !data ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading analyst data from FMP (may take 30-60s)...</div>
      ) : data?.firms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">No analyst data available. FMP API may be rate-limited.</div>
      ) : (
      <div className="grid grid-cols-1 gap-4">
        {filtered.map((firm) => {
          const isExpanded = expanded === firm.id;

          return (
            <Card key={firm.id} className="overflow-hidden">
              <div
                className="p-5 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : firm.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="size-12 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center text-white font-bold text-lg">
                      {firm.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-foreground">{firm.name}</h3>
                        <Badge className={`text-[10px] ${ratingColors[firm.rating] || "bg-gray-50 text-gray-700"}`}>
                          {firm.rating}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Target className="size-3" />{firm.topSector}</span>
                        <span className="flex items-center gap-1"><Star className="size-3" />{firm.totalRatings.toLocaleString()} ratings</span>
                        {firm.avgTargetPrice > 0 && (
                          <span className="flex items-center gap-1"><BarChart3 className="size-3" />Avg target: ${firm.avgTargetPrice.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Ratings</p>
                      <p className="text-xl font-bold text-foreground">{firm.totalRatings}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="size-5 text-muted-foreground" /> : <ChevronDown className="size-5 text-muted-foreground" />}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-5 pb-5 border-t pt-4">
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {Object.entries(firm.ratings).map(([rating, count]) => (
                      <div key={rating} className="text-center p-2 rounded-lg bg-muted/30">
                        <p className="text-lg font-bold text-foreground">{count}</p>
                        <p className="text-[9px] text-muted-foreground uppercase">{rating}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-3">Recent Recommendations</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {firm.picks.map((pick) => {
                      const currentPrice = prices[pick.symbol]?.price || 0;
                      const upside = currentPrice > 0 && pick.targetPrice > 0
                        ? ((pick.targetPrice - currentPrice) / currentPrice * 100).toFixed(1)
                        : null;
                      const upsideNum = parseFloat(upside || "0");

                      return (
                        <Card key={pick.symbol} className="p-4 hover:shadow-sm transition-all cursor-pointer" onClick={(e) => { e.stopPropagation(); navigate(`/app/stock/${pick.symbol}?market=global`); }}>
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-sm font-bold text-foreground">{pick.symbol}</p>
                              {pick.publishedDate && (
                                <p className="text-[9px] text-muted-foreground">{new Date(pick.publishedDate).toLocaleDateString()}</p>
                              )}
                            </div>
                            <Badge className={`text-[10px] ${ratingColors[pick.rating] || "bg-gray-50 text-gray-700"}`}>
                              {pick.rating === "Strong Buy" || pick.rating === "Buy" ? <ThumbsUp className="size-2.5 mr-1" /> : null}
                              {pick.rating}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              Current: <strong className="text-foreground font-mono">${currentPrice.toFixed(2)}</strong>
                            </span>
                            <span className="text-muted-foreground">
                              Target: <strong className="text-foreground font-mono">${pick.targetPrice.toFixed(2)}</strong>
                            </span>
                            {upside !== null && (
                              <span className={`font-semibold font-mono ${upsideNum >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {upsideNum >= 0 ? "+" : ""}{upside}%
                              </span>
                            )}
                          </div>
                        </Card>
                      );
                    })}
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
