import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "../components/ui/card";
import { 
  Star, TrendingUp, TrendingDown, Trash2, Search, 
  Plus, Loader2, AlertCircle, ArrowUpRight, BarChart2, BarChart3
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { kenyanStocks, globalStocks, type StockListItem } from "../data/stockUniverses";
import { useAuth } from "../auth/AuthContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface SignalData {
  price: number;
  change: number;
  signal: string;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  confidence: number;
  timeframe: string;
  type: string;
  strength: string;
}

interface WatchlistItem {
  id: number;
  symbol: string;
  company_name: string;
  target_price?: number;
  signal?: SignalData;
}

export function WatchlistPage() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTicker, setNewTicker] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const allAvailableStocks = useMemo(() => [...kenyanStocks, ...globalStocks], []);

  const suggestions = useMemo(() => {
    if (!newTicker || newTicker.length < 1) return [];
    return allAvailableStocks
      .filter(s => 
        s.ticker.toLowerCase().includes(newTicker.toLowerCase()) || 
        s.name.toLowerCase().includes(newTicker.toLowerCase())
      )
      .slice(0, 5);
  }, [newTicker, allAvailableStocks]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const userId = user?.id;
      if (!userId) {
        toast.error("Please log in to view your watchlist.");
        setLoading(false);
        return;
      }
      const [watchlistRes, signalsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/watchlist?userId=${userId}`),
        fetch(`${API_BASE_URL}/signals`)
      ]);

      if (!watchlistRes.ok) {
        const errData = await watchlistRes.json();
        throw new Error(errData.error || "Failed to fetch watchlist");
      }

      const watchlist = await watchlistRes.json();
      const signalsData = await signalsRes.json();

      const enriched = watchlist.map((item: any) => {
        const signal = Array.isArray(signalsData.signals) ? signalsData.signals.find((s: any) => s.ticker === item.symbol.replace('NSE:', '')) : undefined;
        return { ...item, signal };
      });
      
      setStocks(enriched);
    } catch (err) {
      console.error("Failed to fetch watchlist:", err);
      toast.error("Could not connect to the market server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const handleClickOutside = () => setShowSuggestions(false);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleAddStock = async (symbol: string, name: string) => {
    setIsAdding(true);
    try {
      const res = await fetch(`${API_BASE_URL}/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol: symbol, 
          company_name: name 
        })
      });
      if (res.ok) {
        setNewTicker("");
        setShowSuggestions(false);
        await fetchData();
        toast.success(`${symbol} added to watchlist!`);
      }
      else {
        const errorData = await res.json();
        console.error("Failed to add stock:", res.status, errorData);
        toast.error(`Failed to add ${symbol}: ${errorData.message || res.statusText}`);
      }
    } catch (err: any) {
      console.error("Network error adding stock:", err);
      toast.error(`Network error: ${err.message || "Could not connect to server."}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await fetch(`${API_BASE_URL}/watchlist/${id}`, { method: 'DELETE' });
      setStocks(stocks.filter(s => s.id !== id));
      toast.success("Removed from watchlist");
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove item");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Star className="w-8 h-8 text-amber-400 fill-amber-400" />
            Watchlist
          </h1>
          <p className="text-gray-500 mt-1 text-lg">Monitor your favorite assets and AI trading signals.</p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/app/stocks" className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
            <BarChart3 className="w-4 h-4" /> Stock Screener
          </Link>
          <form 
          className="flex gap-2 relative" 
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const match = allAvailableStocks.find(s => s.ticker === newTicker);
            if (match) {
              handleAddStock(match.market === 'nse' ? `NSE:${match.ticker}` : match.ticker, match.name);
            } else if (newTicker) {
              handleAddStock(newTicker, newTicker);
            }
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search stocks to add..." 
              className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:border-transparent outline-none w-64 text-gray-900"
              value={newTicker}
              onChange={(e) => {
                setNewTicker(e.target.value.toUpperCase());
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
            />
            
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    type="button"
                    key={s.ticker}
                    onClick={() => handleAddStock(s.market === 'nse' ? `NSE:${s.ticker}` : s.ticker, s.name)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex flex-col transition-colors border-b last:border-0 border-gray-100"
                  >
                    <span className="text-sm font-bold text-gray-900">{s.ticker}</span>
                    <span className="text-xs text-gray-500 truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button 
            type="submit"
            disabled={isAdding || !newTicker}
            className="bg-[#0D7490] hover:bg-[#0A5A70] text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </form>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 bg-white rounded-2xl border border-dashed border-gray-200">
          <Loader2 className="w-10 h-10 animate-spin text-[#0D7490] mb-4" />
          <p className="text-gray-500 font-medium">Synchronizing market data...</p>
        </div>
      ) : stocks.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
          <BarChart2 className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Your watchlist is empty</h2>
          <p className="text-gray-500 mt-2">Start adding stocks to track their real-time performance and AI insights.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
          <Card className="border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Asset</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Price</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Conf</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Entry</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Stop</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">T1</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">T2</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">R:R</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Signal</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Timeframe</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stocks.map((stock) => {
                    const s = stock.signal;
                    return (
                    <tr key={stock.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-[#0D7490] shrink-0">
                            {stock.symbol.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <Link to={`/app/stock/${stock.symbol.replace('NSE:', '')}`} className="font-bold text-gray-900 hover:text-[#0D7490] flex items-center gap-1 text-sm">
                              {stock.symbol.replace('NSE:', '')}
                              <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                            <div className="text-[11px] text-gray-500 truncate max-w-[160px]">{stock.company_name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold text-gray-900 text-sm">
                        KES {s?.price?.toFixed(2) || '0.00'}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          (s?.confidence || 0) >= 80 ? 'bg-emerald-100 text-emerald-700' :
                          (s?.confidence || 0) >= 70 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {s?.confidence || '-'}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-sm font-semibold text-gray-900">
                        {s?.entry ? `KES ${s.entry.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-sm text-red-600 font-semibold">
                        {s?.stopLoss ? `KES ${s.stopLoss.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-sm font-semibold text-emerald-600">
                        {s?.target1 ? `KES ${s.target1.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-sm font-semibold text-emerald-600">
                        {s?.target2 ? `KES ${s.target2.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-bold text-gray-900">
                        {s?.riskReward ? `1:${s.riskReward.toFixed(1)}` : '-'}
                      </td>
                      <td className="px-4 py-4">
                        <div className={`text-[10px] font-black uppercase px-2 py-1 rounded tracking-wider border inline-block ${
                          s?.signal?.toLowerCase().includes('buy') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                          s?.signal?.toLowerCase().includes('sell') ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {s?.signal || 'Hold'}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-xs text-gray-500 font-medium">{s?.timeframe || '-'}</span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button onClick={() => handleRemove(stock.id)} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}