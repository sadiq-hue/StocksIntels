import { useMemo, useState } from "react";
import { 
  TrendingUp, 
  ArrowLeft, 
  BarChart3, 
  Globe, 
  Landmark, 
  Search, 
  ChevronRight, 
  Activity, 
  Zap 
} from "lucide-react";
import { Link } from 'react-router';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  CartesianGrid 
} from "recharts";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { kenyanStocks, globalStocks } from "../data/stockUniverses";
import { useRealtimeQuotes } from "../contexts/RealtimeQuotesContext";

interface SectorData {
  name: string;
  displayName: string;
  change: number;
  volume: number;
  volumeLabel: string;
  leading: string;
  leadingTicker: string;
  sentiment: string;
  market: "NSE" | "Global";
  stockCount: number;
}

function formatVolume(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

function parseVolume(volume: string): number {
  const clean = volume.replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  if (volume.includes("B")) return num * 1_000_000_000;
  if (volume.includes("M")) return num * 1_000_000;
  if (volume.includes("K")) return num * 1_000;
  return num || 0;
}

function computeSentiment(change: number): string {
  if (change > 3) return "Strong Bullish";
  if (change > 1) return "Bullish";
  if (change > -1) return "Neutral";
  if (change > -3) return "Bearish";
  return "Strong Bearish";
}

export const SectorsPage: React.FC = () => {
  const [marketFilter, setMarketFilter] = useState<"all" | "NSE" | "Global">("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const { getQuote, quotes } = useRealtimeQuotes();

  const allSectors = useMemo(() => {
    const map = new Map<string, {
      changes: number[];
      totalVolume: number;
      stocks: { name: string; ticker: string; change: number }[];
      market: "NSE" | "Global";
    }>();

    for (const stock of kenyanStocks) {
      const live = getQuote(`NSE:${stock.ticker}`);
      if (!live || live.changePercent == null) continue;
      const change = live.changePercent;
      const volume = live.volume ?? parseVolume(stock.volume);
      const key = `NSE ${stock.sector}`;
      if (!map.has(key)) map.set(key, { changes: [], totalVolume: 0, stocks: [], market: "NSE" });
      const entry = map.get(key)!;
      entry.changes.push(change);
      entry.totalVolume += volume;
      entry.stocks.push({ name: stock.name, ticker: stock.ticker, change });
    }

    for (const stock of globalStocks) {
      const live = getQuote(stock.ticker);
      if (!live || live.changePercent == null) continue;
      const change = live.changePercent;
      const volume = live.volume ?? parseVolume(stock.volume);
      const key = stock.sector;
      if (!map.has(key)) map.set(key, { changes: [], totalVolume: 0, stocks: [], market: "Global" });
      const entry = map.get(key)!;
      entry.changes.push(change);
      entry.totalVolume += volume;
      entry.stocks.push({ name: stock.name, ticker: stock.ticker, change });
    }

    return Array.from(map.entries())
      .filter(([_, v]) => v.stocks.length > 0)
      .map(([name, data]): SectorData => {
        const avgChange = data.changes.reduce((a, b) => a + b, 0) / data.changes.length;
        const leading = data.stocks.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
        return {
          name,
          displayName: name.replace("NSE ", ""),
          change: Math.round(avgChange * 10) / 10,
          volume: data.totalVolume,
          volumeLabel: formatVolume(data.totalVolume),
          leading: leading?.name || "",
          leadingTicker: leading?.ticker || "",
          sentiment: computeSentiment(avgChange),
          market: data.market,
          stockCount: data.stocks.length,
        };
      })
      .sort((a, b) => b.change - a.change);
  }, [quotes]);

  const filteredSectors = useMemo(() => {
    return allSectors.filter(s => {
      const matchesMarket = marketFilter === "all" || s.market === marketFilter;
      const matchesSearch = s.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            s.leading.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesMarket && matchesSearch;
    });
  }, [allSectors, marketFilter, searchTerm]);

  const chartData = useMemo(() => {
    return filteredSectors.map(s => ({
      name: s.displayName,
      val: s.change,
      fullName: s.name
    })).sort((a, b) => b.val - a.val);
  }, [filteredSectors]);

  const nseLeader = filteredSectors.filter(s => s.market === "NSE")
    .sort((a, b) => b.change - a.change)[0];

  const globalLeader = filteredSectors.filter(s => s.market === "Global")
    .sort((a, b) => b.change - a.change)[0];

  const highestVolumeSector = useMemo(() => {
    if (filteredSectors.length === 0) return { name: "N/A", volumeLabel: "0" };
    return filteredSectors.reduce((prev, current) => {
      return prev.volume > current.volume ? prev : current;
    });
  }, [filteredSectors]);

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div className="space-y-4">
        <Link to="/app/markets" className="text-[#0D7490] text-sm font-bold flex items-center gap-2 hover:underline">
          <ArrowLeft size={14} /> Back to Market Intelligence
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">Sector Performance</h1>
            <p className="text-gray-500 font-medium">Real-time industry strength and cross-exchange momentum tracking.</p>
          </div>
          <div className="text-right">
            <Badge variant="outline" className="text-gray-400 font-bold border-gray-200 uppercase tracking-widest text-[10px]">
              Updated: {new Date().toLocaleTimeString()}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 border-gray-200 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 bg-cyan-50 text-cyan-600 rounded-xl flex items-center justify-center"><Landmark size={24} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">NSE Top Performer</p>
            <p className="text-lg font-bold text-gray-900 truncate">{nseLeader?.displayName || "N/A"} ({nseLeader ? (nseLeader.change >= 0 ? "+" : "") + nseLeader.change + "%" : "—"})</p>
          </div>
        </Card>
        <Card className="p-5 border-gray-200 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center"><Globe size={24} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Global Top Performer</p>
            <p className="text-lg font-bold text-gray-900 truncate">{globalLeader?.displayName || "N/A"} ({globalLeader ? (globalLeader.change >= 0 ? "+" : "") + globalLeader.change + "%" : "—"})</p>
          </div>
        </Card>
        <Card className="p-5 border-gray-200 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center"><BarChart3 size={24} /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Highest Volume</p>
            <p className="text-lg font-bold text-gray-900 truncate">
              {highestVolumeSector.name !== "N/A" ? highestVolumeSector.displayName + " (" + highestVolumeSector.volumeLabel + ")" : "N/A"}
            </p>
          </div>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between pb-2">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search sectors or leaders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-white"
          />
        </div>
        <div className="flex flex-wrap bg-gray-100 p-1 rounded-lg">
          {[
            { id: "all", label: "All Markets", icon: Activity },
            { id: "NSE", label: "NSE Only", icon: Landmark },
            { id: "Global", label: "Global Only", icon: Globe },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMarketFilter(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                marketFilter === tab.id ? "bg-white text-[#0D7490] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Sector Name</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">Market</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider text-right">1D Change</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider text-right">Volume</th>
                  <th className="px-6 py-4 text-[10px] font-black uppercase text-gray-500 tracking-wider">AI Sentiment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSectors.map((sector) => (
                  <tr key={sector.name} className="hover:bg-gray-50/50 transition-colors cursor-pointer group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-900 group-hover:text-[#0D7490] transition-colors">{sector.displayName}</span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase">Leader: {sector.leading}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={sector.market === "NSE" ? "secondary" : "outline"} className={sector.market === "NSE" ? "bg-cyan-50 text-cyan-700 border-cyan-100" : "bg-indigo-50 text-indigo-700 border-indigo-100"}>
                        {sector.market}
                      </Badge>
                    </td>
                    <td className={`px-6 py-4 text-right font-black ${sector.change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {sector.change >= 0 ? "+" : ""}{sector.change}%
                    </td>
                    <td className="px-6 py-4 text-right text-gray-600 font-medium text-sm">
                      {sector.volumeLabel}
                    </td>
                    <td className="px-6 py-4">
                      <div className={`text-[10px] font-black uppercase px-2 py-1 rounded inline-flex items-center gap-1 ${
                        sector.sentiment.includes("Bullish") ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-gray-600"
                      }`}>
                        {sector.sentiment.includes("Bullish") && <Zap size={10} />}
                        {sector.sentiment}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6 border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs flex items-center gap-2">
                <TrendingUp size={16} className="text-[#0D7490]" />
                Relative Strength
              </h3>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: "#64748b" }} width={80} />
                  <Tooltip 
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)", fontSize: "10px", fontWeight: "bold" }}
                  />
                  <Bar dataKey="val" radius={[0, 4, 4, 0]} barSize={20}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.val >= 0 ? "#10B981" : "#EF4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] border-none text-white">
            <h3 className="font-bold mb-2 flex items-center gap-2 text-sm uppercase tracking-wider">
              <Activity size={16} /> Market Sentiment
            </h3>
            <p className="text-xs text-white/80 leading-relaxed mb-4">
              The overall market posture remains <span className="font-black text-white">BULLISH</span>. Capital is rotating from Energy into Technology and Banking sectors across both global and local exchanges.
            </p>
            <Button variant="outline" className="w-full bg-white/10 border-white/20 hover:bg-white/20 text-white font-bold text-xs">
              View Signal Details <ChevronRight size={14} className="ml-1" />
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
};
