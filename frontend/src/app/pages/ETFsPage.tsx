import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Search, RefreshCcw, TrendingUp, TrendingDown, BarChart3,
  Layers, Globe, DollarSign, PieChart, Activity,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface ETF {
  ticker: string; name: string; category: string;
  expenseRatio: number; aum: number; dividendYield: number;
  description: string; currency: string;
  price: number; change: number; changePercent: number;
  high: number; low: number; volume: number;
}

export function ETFsPage() {
  const [etfs, setEtfs] = useState<ETF[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [etfsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/etfs?market=all`),
        fetch(`${API_URL}/etfs/summary`),
      ]);
      setEtfs(await etfsRes.json());
      setSummary(await summaryRes.json());
    } catch (e) {
      console.error("Failed to load ETFs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 text-2xl mb-1">Exchange-Traded Funds</h2>
          <p className="text-gray-600">Track top ETFs across global markets — equity, bonds, commodities, and more</p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" className="border-gray-200">
          <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">Total ETFs</p>
            <p className="text-gray-900 text-xl font-semibold">{summary.totalETFs}</p>
            <p className="text-gray-500 text-xs mt-1">{summary.categories.length} categories</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">Top Gainer</p>
            <p className="text-gray-900 text-xl font-semibold text-emerald-600">{summary.topGainers?.[0]?.ticker || "—"}</p>
            <p className="text-emerald-600 text-xs mt-1">+{summary.topGainers?.[0]?.changePercent?.toFixed(2) || "0"}%</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">Top Loser</p>
            <p className="text-gray-900 text-xl font-semibold text-red-600">{summary.topLosers?.[0]?.ticker || "—"}</p>
            <p className="text-red-600 text-xs mt-1">{summary.topLosers?.[0]?.changePercent?.toFixed(2) || "0"}%</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">Largest AUM</p>
            <p className="text-gray-900 text-xl font-semibold">{summary.largestAUM?.[0]?.ticker || "—"}</p>
            <p className="text-gray-500 text-xs mt-1">{summary.largestAUM?.[0] ? formatCompact(summary.largestAUM[0].aum) : "0"}</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 flex-wrap">
          {categories.slice(0, 8).map(c => (
            <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${category === c ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{c === "all" ? "All" : c}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ETFs..." className="pl-9 border-gray-200" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-white border-gray-200 p-5 animate-pulse"><div className="flex gap-4"><div className="h-10 w-10 bg-gray-200 rounded"></div><div className="flex-1"><div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div><div className="h-3 bg-gray-200 rounded w-1/2"></div></div></div></Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(etf => (
            <Card key={etf.ticker} className="bg-white border-gray-200 p-4 hover:border-[#0D7490] transition-all group">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 group-hover:border-[#0D7490]/30 transition-colors">
                  <Layers className="w-5 h-5 text-[#0D7490]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-900 font-bold text-sm">{etf.ticker}</span>
                    <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-[10px]">{etf.category}</Badge>
                    {etf.currency === "KES" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">NSE</Badge>}
                  </div>
                  <p className="text-gray-600 text-sm truncate">{etf.name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{etf.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-gray-900 font-semibold">{formatCurrency(etf.price)}</p>
                  <p className={`text-sm font-medium flex items-center justify-end gap-1 ${etf.changePercent >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {etf.changePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {etf.changePercent >= 0 ? "+" : ""}{etf.changePercent.toFixed(2)}%
                  </p>
                </div>
                <div className="hidden md:grid grid-cols-3 gap-6 text-right flex-shrink-0">
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">Expense</p>
                    <p className="text-gray-900 text-sm font-medium">{etf.expenseRatio.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">AUM</p>
                    <p className="text-gray-900 text-sm font-medium">${formatCompact(etf.aum)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">Div Yield</p>
                    <p className="text-gray-900 text-sm font-medium">{etf.dividendYield.toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <Card className="bg-white border-gray-200 p-8 text-center"><p className="text-gray-500">No ETFs match your filters.</p></Card>
          )}
        </div>
      )}
    </div>
  );
}
