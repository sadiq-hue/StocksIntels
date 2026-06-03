import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  TrendingUp, TrendingDown, Search, RefreshCcw, Landmark,
  BarChart3, Building2, Briefcase, CalendarDays, Percent,
  DollarSign, LineChart, ChevronDown, ChevronUp,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface Bond {
  id: string; type: string; issuer: string; name: string;
  coupon: number; maturity: string; ytm: number; price: number;
  currency: string; rating: string; amountIssued: number; description: string;
}

interface YieldPoint { term: string; kenya: number; us: number; }

export function BondsPage() {
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [summary, setSummary] = useState<{ kenya10Y: number; us10Y: number; kenyaTbill91D: number; yieldCurve: YieldPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<"kenya" | "global">("kenya");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [bondsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/bonds?market=${market}`),
        fetch(`${API_URL}/bonds/summary`),
      ]);
      setBonds(await bondsRes.json());
      setSummary(await summaryRes.json());
    } catch (e) {
      console.error("Failed to load bonds:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [market]);

  const filtered = bonds.filter(b => {
    if (typeFilter !== "all" && b.type !== typeFilter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase()) && !b.issuer.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatCurrency = (v: number, c: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const formatAmount = (v: number, c: string) => {
    const inBillions = v / 1000000000;
    return `${c === "KES" ? "KSh" : "$"}${inBillions.toFixed(1)}B`;
  };

  const getRatingColor = (r: string) => {
    if (r.startsWith("AAA") || r.startsWith("AA")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (r.startsWith("A") || r.startsWith("BBB")) return "bg-blue-100 text-blue-700 border-blue-200";
    if (r.startsWith("BB")) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const getTypeIcon = (t: string) => {
    switch (t) {
      case "Government": return <Landmark className="w-4 h-4" />;
      case "Infrastructure": return <Building2 className="w-4 h-4" />;
      case "Corporate": return <Briefcase className="w-4 h-4" />;
      case "T-Bill": return <BarChart3 className="w-4 h-4" />;
      default: return <Briefcase className="w-4 h-4" />;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 text-2xl mb-1">Bonds</h2>
          <p className="text-gray-600">Fixed income securities — government bonds, T-bills, and corporate debt</p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" className="border-gray-200">
          <RefreshCcw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">KE 10-Year Yield</p>
            <p className="text-gray-900 text-xl font-semibold">{summary.kenya10Y.toFixed(2)}%</p>
            <p className="text-emerald-600 text-xs flex items-center gap-1 mt-1"><TrendingUp className="w-3 h-3" /> +0.05%</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">US 10-Year Yield</p>
            <p className="text-gray-900 text-xl font-semibold">{summary.us10Y.toFixed(2)}%</p>
            <p className="text-red-600 text-xs flex items-center gap-1 mt-1"><TrendingDown className="w-3 h-3" /> -0.02%</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">KE 91-Day T-Bill</p>
            <p className="text-gray-900 text-xl font-semibold">{summary.kenyaTbill91D.toFixed(2)}%</p>
            <p className="text-gray-500 text-xs mt-1">Primary rate</p>
          </Card>
          <Card className="bg-white border-gray-200 p-4">
            <p className="text-gray-500 text-xs mb-1">KE-US Spread</p>
            <p className="text-gray-900 text-xl font-semibold">{(summary.kenya10Y - summary.us10Y).toFixed(2)}%</p>
            <p className="text-amber-600 text-xs mt-1">Risk premium</p>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex bg-white border border-gray-200 rounded-lg p-1">
          <button onClick={() => setMarket("kenya")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${market === "kenya" ? "bg-[#0D7490] text-white" : "text-gray-600 hover:text-gray-900"}`}>Kenya</button>
          <button onClick={() => setMarket("global")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${market === "global" ? "bg-[#0D7490] text-white" : "text-gray-600 hover:text-gray-900"}`}>Global</button>
        </div>

        <div className="flex bg-white border border-gray-200 rounded-lg p-1">
          {["all", "Government", "Infrastructure", "Corporate", "T-Bill"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${typeFilter === t ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{t === "all" ? "All" : t}</button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bonds..." className="pl-9 border-gray-200" />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="bg-white border-gray-200 p-5 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div><div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div><div className="h-3 bg-gray-200 rounded w-2/3"></div></Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {filtered.map(bond => (
              <Card key={bond.id} className="bg-white border-gray-200 p-5 hover:border-[#0D7490] transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-50 rounded-lg border border-gray-200 mt-0.5">{getTypeIcon(bond.type)}</div>
                    <div>
                      <h3 className="text-gray-900 font-semibold text-sm">{bond.name}</h3>
                      <p className="text-gray-500 text-xs">{bond.issuer}</p>
                    </div>
                  </div>
                  <Badge className={getRatingColor(bond.rating)}>{bond.rating}</Badge>
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">Coupon</p>
                    <p className="text-gray-900 text-sm font-semibold">{bond.coupon}%</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">YTM</p>
                    <p className="text-[#0D7490] text-sm font-semibold">{bond.ytm.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">Price</p>
                    <p className="text-gray-900 text-sm font-semibold">{bond.price.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] uppercase">Maturity</p>
                    <p className="text-gray-900 text-sm font-semibold">{bond.maturity.substring(0, 7)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {bond.maturity}</span>
                  <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {formatAmount(bond.amountIssued, bond.currency)}</span>
                  <span className="flex items-center gap-1"><Percent className="w-3 h-3" /> {bond.type}</span>
                </div>
                {bond.description && <p className="text-gray-400 text-xs mt-2 italic">{bond.description}</p>}
              </Card>
            ))}
          </div>

          {filtered.length === 0 && (
            <Card className="bg-white border-gray-200 p-8 text-center"><p className="text-gray-500">No bonds match your filters.</p></Card>
          )}

          {summary && (
            <Card className="bg-white border-gray-200 p-6">
              <h3 className="text-gray-900 font-semibold mb-4 flex items-center gap-2"><LineChart className="w-5 h-5 text-[#0D7490]" /> Yield Curve</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-gray-500 font-medium">Term</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Kenya</th>
                    <th className="text-right py-2 text-gray-500 font-medium">US</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Spread</th>
                  </tr></thead>
                  <tbody>
                    {summary.yieldCurve.map(p => {
                      const spread = p.kenya - p.us;
                      return (
                        <tr key={p.term} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 text-gray-900 font-medium">{p.term}</td>
                          <td className="py-2.5 text-right text-gray-900">{p.kenya.toFixed(2)}%</td>
                          <td className="py-2.5 text-right text-gray-900">{p.us.toFixed(2)}%</td>
                          <td className={`py-2.5 text-right font-medium ${spread > 8 ? "text-amber-600" : "text-gray-900"}`}>+{spread.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
