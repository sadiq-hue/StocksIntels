import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Star, TrendingUp, TrendingDown, MoreVertical, Loader2, PlusCircle } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { authFetch } from "../auth/tokenStore";

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface WatchlistItem {
  symbol: string;
  company_name: string;
  price?: number;
  changePercent?: number;
  signal?: string;
}

export function Watchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const fetchWatchlist = async () => {
      try {
        const userIdParam = user?.id ? `?userId=${user.id}` : '';
        // Fetch saved items and their current market data
        const res = await authFetch(`${API_BASE_URL}/watchlist${userIdParam}`);
        const data = await res.json();
        
        // Fetch signals for these items to enrich the UI
        const signalsRes = await authFetch(`${API_BASE_URL}/signals${userIdParam}`);
        const signalsData = await signalsRes.json();
        
        const enrichedItems = data.map((item: any) => {
          const signalInfo = signalsData.signals?.find((s: any) => s.ticker === item.symbol.replace('NSE:', ''));
          return {
            ...item,
            price: signalInfo?.price || 0,
            changePercent: signalInfo?.change || 0,
            signal: signalInfo?.signal || 'Hold'
          };
        });

        setItems(enrichedItems.slice(0, 5)); // Show top 5 on dashboard
      } catch (err) {
        console.error("Failed to load watchlist", err);
      } finally {
        setLoading(false);
      }
    };

    fetchWatchlist();
  }, [user?.id]);

  return (
    <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between py-4 border-b border-gray-50">
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          My Watchlist
        </CardTitle>
        <Link to="/app/watchlist" className="text-xs text-[#0D7490] hover:underline font-medium">
          View All
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-gray-400 text-sm mb-4">Your watchlist is empty</p>
            <Link to="/app/markets">
              <button className="text-xs flex items-center gap-1 mx-auto bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-full border border-gray-200 transition-colors">
                <PlusCircle className="w-3 h-3" /> Add Stocks
              </button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {items.map((stock) => (
              <Link key={stock.symbol} to={`/app/stock/${stock.symbol.replace('NSE:', '')}`}>
                <div className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between group">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-gray-900">{stock.symbol.replace('NSE:', '')}</span>
                    <span className="text-xs text-gray-500 truncate max-w-[120px]">{stock.company_name}</span>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <span className="text-sm font-semibold text-gray-900">KES {stock.price?.toFixed(2)}</span>
                    <span className={`text-xs flex items-center gap-0.5 ${(stock.changePercent || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(stock.changePercent || 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(stock.changePercent || 0).toFixed(2)}%
                    </span>
                  </div>
                  <div className={`ml-3 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    stock.signal?.includes('Buy') ? 'bg-emerald-100 text-emerald-700' : 
                    stock.signal?.includes('Sell') ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {stock.signal?.split(' ')[0]}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
