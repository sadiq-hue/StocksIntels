"use client";

import { useState, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Search, TrendingUp, TrendingDown, Star,
  BarChart3, Target, Award, ChevronDown, ChevronUp, ThumbsUp,
} from "lucide-react";
import { useNavigate } from "react-router";
import { globalStocks, kenyanStocks } from "../../data/stockUniverses";

const analysts = [
  { id: "gs", name: "Goldman Sachs", rating: "Buy", successRate: 78, totalRatings: 1245, topSector: "Technology", focus: "Large Cap" },
  { id: "ms", name: "Morgan Stanley", rating: "Overweight", successRate: 75, totalRatings: 1089, topSector: "Healthcare", focus: "Growth" },
  { id: "jp", name: "JP Morgan", rating: "Overweight", successRate: 74, totalRatings: 1134, topSector: "Financials", focus: "Value" },
  { id: "bofa", name: "Bank of America", rating: "Buy", successRate: 72, totalRatings: 895, topSector: "Energy", focus: "Dividend" },
  { id: "citi", name: "Citigroup", rating: "Buy", successRate: 71, totalRatings: 756, topSector: "Consumer", focus: "Growth" },
  { id: "ubs", name: "UBS Group", rating: "Buy", successRate: 73, totalRatings: 678, topSector: "Healthcare", focus: "Defensive" },
  { id: "cs", name: "Credit Suisse", rating: "Neutral", successRate: 68, totalRatings: 534, topSector: "Financials", focus: "Value" },
  { id: "db", name: "Deutsche Bank", rating: "Hold", successRate: 66, totalRatings: 456, topSector: "Energy", focus: "Cyclical" },
  { id: "barclays", name: "Barclays", rating: "Overweight", successRate: 70, totalRatings: 623, topSector: "Technology", focus: "Growth" },
  { id: "rbc", name: "RBC Capital Markets", rating: "Outperform", successRate: 76, totalRatings: 445, topSector: "Healthcare", focus: "Innovation" },
  { id: "wf", name: "Wells Fargo", rating: "Equal Weight", successRate: 65, totalRatings: 389, topSector: "Energy", focus: "Value" },
  { id: "piper", name: "Piper Sandler", rating: "Overweight", successRate: 72, totalRatings: 312, topSector: "Technology", focus: "Mid Cap" },
  { id: "needham", name: "Needham & Co", rating: "Buy", successRate: 79, totalRatings: 278, topSector: "Technology", focus: "Small Cap" },
  { id: "canaccord", name: "Canaccord Genuity", rating: "Buy", successRate: 74, totalRatings: 234, topSector: "Healthcare", focus: "Small Cap" },
  { id: "stifel", name: "Stifel Financial", rating: "Hold", successRate: 67, totalRatings: 289, topSector: "Consumer", focus: "Mid Cap" },
];

function generateAnalystPick(analystId: string, index: number) {
  const allStocks = [...kenyanStocks, ...globalStocks];
  const stock = allStocks[(analystId.length + index * 7) % allStocks.length];
  const targetPrice = +(stock.price * (0.85 + Math.random() * 0.45)).toFixed(2);
  const upside = +(((targetPrice - stock.price) / stock.price) * 100).toFixed(1);
  const rating = upside > 15 ? "Strong Buy" : upside > 5 ? "Buy" : upside > -5 ? "Hold" : "Sell";
  return { stock, targetPrice, upside, rating };
}

export function TopAnalysts() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"successRate" | "ratings" | "name">("successRate");
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    let list = analysts;
    if (search) {
      list = list.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.topSector.toLowerCase().includes(search.toLowerCase()) ||
        a.rating.toLowerCase().includes(search.toLowerCase())
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "ratings") return b.totalRatings - a.totalRatings;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.successRate - a.successRate;
    });
  }, [search, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Top Analysts</h2>
          <p className="text-sm text-muted-foreground">Leading Wall Street & investment bank analysts and their recommendations</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search analysts..."
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
            <option value="successRate">Success Rate</option>
            <option value="ratings">Total Ratings</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filtered.map((analyst, idx) => {
          const isExpanded = expanded === analyst.id;
          const picks = Array.from({ length: 3 }, (_, i) => generateAnalystPick(analyst.id, i + idx * 3));
          const rateColor = analyst.successRate >= 75 ? "text-emerald-600" : analyst.successRate >= 70 ? "text-amber-600" : "text-gray-600";

          return (
            <Card key={analyst.id} className="overflow-hidden">
              <div
                className="p-5 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : analyst.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="size-12 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center text-white font-bold text-lg">
                      {analyst.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-foreground">{analyst.name}</h3>
                        <Badge className="text-[10px] bg-[#0D7490]/10 text-[#0D7490]">{analyst.focus}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Target className="size-3" />{analyst.topSector}</span>
                        <span className="flex items-center gap-1"><Star className="size-3" />{analyst.totalRatings.toLocaleString()} ratings</span>
                        <span className="flex items-center gap-1"><Award className="size-3" />Rating: {analyst.rating}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Success Rate</p>
                      <p className={`text-xl font-bold ${rateColor}`}>{analyst.successRate}%</p>
                    </div>
                    {isExpanded ? <ChevronUp className="size-5 text-muted-foreground" /> : <ChevronDown className="size-5 text-muted-foreground" />}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-5 pb-5 border-t pt-4">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-3">Top Picks & Recommendations</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {picks.map((pick, i) => (
                      <Card key={i} className="p-4 hover:shadow-sm transition-all cursor-pointer" onClick={(e) => { e.stopPropagation(); navigate(`/app/stock/${pick.stock.ticker}?market=${pick.stock.market}`); }}>
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-bold text-foreground">{pick.stock.ticker}</p>
                            <p className="text-[10px] text-muted-foreground">{pick.stock.name}</p>
                          </div>
                          <Badge className={`text-[10px] ${pick.rating === "Strong Buy" || pick.rating === "Buy" ? "bg-emerald-50 text-emerald-700" : pick.rating === "Sell" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                            {pick.rating === "Strong Buy" || pick.rating === "Buy" ? <ThumbsUp className="size-2.5 mr-1" /> : null}
                            {pick.rating}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Current: <strong className="text-foreground">${pick.stock.price.toFixed(2)}</strong></span>
                          <span className="text-muted-foreground">Target: <strong className="text-foreground">${pick.targetPrice.toFixed(2)}</strong></span>
                          <span className={`font-semibold ${pick.upside >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {pick.upside >= 0 ? "+" : ""}{pick.upside}%
                          </span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
