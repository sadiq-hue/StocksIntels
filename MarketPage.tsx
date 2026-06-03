"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Bell, Search, RefreshCcw, ArrowUpRight, ArrowDownRight, Activity, PieChart, Info, 
  Loader2, Globe, Landmark, ChevronRight, Settings, X, Mail, Columns2, Maximize2,
  TrendingUp, TrendingDown, ArrowUpDown, Star, ArrowRightLeft, Newspaper, BrainCircuit
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/**
 * MarketPage Component
 * Dual-window layout: NSE stocks on the left, Global stocks on the right.
 */
const MarketPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const [showSettings, setShowSettings] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(() => {
    return localStorage.getItem('market_sentiment_emails') === 'true';
  });
  const [marketData, setMarketData] = useState<{
    nse: { active: any[], movers: any },
    global: { active: any[], movers: any },
    indices: any[]
  } | null>(null);

  // Independent search states for each window
  const [nseSearch, setNseSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");

  // Independent sort states for each window
  const [nseSort, setNseSort] = useState<'symbol' | 'price' | 'change'>('symbol');
  const [globalSort, setGlobalSort] = useState<'symbol' | 'price' | 'change'>('symbol');

  // Favorites
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (searchParams.get('settings') === 'true') {
      setShowSettings(true);
    }
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem('market_sentiment_emails', String(emailAlerts));
  }, [emailAlerts]);

  const fetchMarketData = async () => {
    setLoading(true);
    try {
      const [activeRes, moversRes, indicesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/market/active`),
        fetch(`${API_BASE_URL}/market/movers`),
        fetch(`${API_BASE_URL}/market/indices`)
      ]);

      const active = await activeRes.json();
      const movers = await moversRes.json();
      const indices = await indicesRes.json();

      setMarketData({
        nse: { active: active.nse, movers: movers.nse },
        global: { active: active.global, movers: movers.global },
        indices: indices
      });
    } catch (err) {
      console.error("Failed to fetch market snapshot", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
  }, []);

  const marketStatus = useMemo(() => {
    if (!marketData) return { status: 'Closed', closes: '3:30 PM', turnover: 'KES 0', gainers: 0, losers: 0, volume: '0', turnoverChange: '0%', unchanged: 0, total: 0 };
    
    const nseGainers = marketData.nse.movers.gainers?.length || 0;
    const globalGainers = marketData.global.movers.gainers?.length || 0;
    const nseLosers = marketData.nse.movers.losers?.length || 0;
    const globalLosers = marketData.global.movers.losers?.length || 0;
    
    const nseActive = marketData.nse.active || [];
    const globalActive = marketData.global.active || [];
    
    // Calculate total volume from active stocks
    const totalVol = [...nseActive, ...globalActive].reduce((acc, stock) => acc + (stock.volume || 0), 0);
    const totalCount = nseActive.length + globalActive.length;
    const gainers = nseGainers + globalGainers;
    const losers = nseLosers + globalLosers;

    return {
      status: 'Open',
      closes: '3:30 PM',
      turnover: 'KES 1.8B', // Realistically this should come from an index API
      turnoverChange: '+4.2%',
      gainers,
      losers,
      unchanged: Math.max(0, totalCount - gainers - losers),
      volume: formatCompactNumber(totalVol)
    };
  }, [marketData]);

  const toggleFavorite = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };

  const filterAndSort = (stocks: any[], search: string, sort: string) => {
    let filtered = stocks.filter(s => 
      (s.symbol || '').toLowerCase().includes(search.toLowerCase()) || 
      (s.company_name || '').toLowerCase().includes(search.toLowerCase())
    );

    if (sort === 'price') {
      filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (sort === 'change') {
      filtered.sort((a, b) => {
        const aVal = a.changePercent || 0;
        const bVal = b.changePercent || 0;
        return bVal - aVal;
      });
    } else {
      filtered.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
    }

    return filtered;
  };

  const nseStocks = marketData?.nse.active || [];
  const globalStocks = marketData?.global.active || [];

  const filteredNse = filterAndSort(nseStocks, nseSearch, nseSort);
  const filteredGlobal = filterAndSort(globalStocks, globalSearch, globalSort);

  const indicesToDisplay = useMemo(() => {
    if (marketData?.indices) return marketData.indices;
    return [
      { symbol: 'NSEASI', name: 'NSE All Share Index', value: '112.45', change: '+1.08%', volume: '450.1M', turnover: 'KES 1.2B' },
      { symbol: 'S&P 500', name: 'S&P 500 Index', value: '5,204.34', change: '+1.15%', volume: '3.8B', turnover: 'USD' },
      { symbol: 'NASDAQ', name: 'Nasdaq Composite', value: '16,332.24', change: '+1.54%', volume: '4.2B', turnover: 'USD' },
      { symbol: 'NSE 20', name: 'NSE 20 Share Index', value: '1,542.12', change: '+0.45%', volume: '12.4M', turnover: 'KES 45.2M' },
    ];
  }, [marketData]);

  // Window Component
  const MarketWindow = ({ 
    title, 
    icon: Icon, 
    stocks, 
    search, 
    setSearch, 
    sort, 
    setSort, 
    accentColor,
    currency
  }: any) => (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accentColor}15` }}>
            <Icon size={18} color={accentColor} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <span className="text-xs text-slate-500 font-medium">{stocks.length} active securities</span>
          </div>
        </div>
        <Badge variant="secondary" style={{ backgroundColor: `${accentColor}15`, color: accentColor }} className="font-bold">
          {currency}
        </Badge>
      </div>

      <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-200 outline-none transition-all"
          />
        </div>
        <button 
          className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          onClick={() => setSort((prev: string) => prev === 'symbol' ? 'change' : prev === 'change' ? 'price' : 'symbol')}
        >
          <ArrowUpDown size={14} />
          <span>{sort === 'symbol' ? 'A-Z' : sort === 'price' ? 'Price' : 'Change'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto max-h-[500px]">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="w-8"></th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Symbol</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Name</th>
              <th className="text-right">Price</th>
              <th className="text-right">Change</th>
              <th className="text-right hide-md">Volume</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock: any) => {
              const isPositive = (stock.changePercent || 0) >= 0;
              const isFav = favorites.includes(stock.symbol);
              return (
                <tr key={stock.symbol} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <button 
                      className="p-1 hover:bg-slate-100 rounded transition-colors"
                      onClick={(e) => toggleFavorite(stock.symbol, e)}
                    >
                      <Star size={14} className={isFav ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{stock.symbol?.replace('NSE:', '')}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{stock.currency}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs font-medium text-slate-600 truncate block max-w-[150px]">{stock.company_name}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm font-bold text-slate-900">{stock.price}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {isPositive ? '+' : ''}{stock.changePercent?.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right hide-md">
                    <span className="text-xs font-semibold text-slate-500">{formatCompactNumber(stock.volume)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {stocks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Search size={24} className="mb-2 opacity-20" />
            <p className="text-xs font-medium">No stocks match "{search}"</p>
          </div>
        )}
      </div>
    </div>
  );

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
      <Loader2 className="animate-spin text-[#0D7490]" size={32} />
      <p className="text-slate-500 font-bold text-sm">Loading Market Data...</p>
    </div>
  );

  return (
    <div className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Market Intelligence</h1>
          <p className="text-xs text-slate-500 font-medium">Real-time NSE & Global Market Activity • Updated {new Date().toLocaleTimeString()}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
            <Settings size={14} className="mr-2" /> Settings
          </Button>
          <Button variant="outline" size="sm" onClick={fetchMarketData}>
            <RefreshCcw size={14} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col gap-1.5 border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Market Status</span>
          <span className="text-2xl font-extrabold text-emerald-600">{marketStatus.status}</span>
          <span className="text-xs font-semibold text-slate-500">Closes {marketStatus.closes}</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1.5 border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Turnover</span>
          <span className="text-2xl font-extrabold text-slate-900">{marketStatus.turnover}</span>
          <span className="text-xs font-semibold text-emerald-600">{marketStatus.turnoverChange} vs yesterday</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1.5 border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gainers / Losers</span>
          <div className="flex gap-3 text-2xl font-extrabold">
            <span className="text-emerald-600">{marketStatus.gainers}</span>
            <span className="text-rose-600">{marketStatus.losers}</span>
            <span className="text-slate-300">{marketStatus.unchanged}</span>
          </div>
          <span className="text-xs font-semibold text-slate-500">of {marketStatus.gainers + marketStatus.losers + marketStatus.unchanged} tracked</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1.5 border-slate-200/80 shadow-sm">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volume</span>
          <span className="text-2xl font-extrabold text-slate-900">{marketStatus.volume}</span>
          <span className="text-xs font-semibold text-slate-500">shares traded today</span>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {indicesToDisplay.map(idx => (
          <Card key={idx.symbol} className="bg-slate-900 text-white p-4 border-none shadow-lg">
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{idx.name}</span>
              <span className="text-lg font-extrabold">{idx.value}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={`text-xs font-bold ${idx.change?.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
                {idx.change}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">Vol: {idx.volume}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Market Legend */}
      <div className="flex flex-wrap items-center gap-6 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#0D7490]" />
          <span className="text-xs font-bold text-slate-600">Nairobi Securities Exchange (KES)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          <span className="text-xs font-bold text-slate-600">US/Global Markets (USD)</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400 font-medium">
          <ArrowRightLeft size={14} />
          <span>Both markets update in real-time</span>
        </div>
      </div>

      {/* Dual Windows */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MarketWindow
          title="NSE Activity"
          icon={Landmark}
          stocks={filteredNse}
          search={nseSearch}
          setSearch={setNseSearch}
          sort={nseSort}
          setSort={setNseSort}
          accentColor="#0D7490"
          currency="KES"
        />
        <MarketWindow
          title="Global Activity"
          icon={Globe}
          stocks={filteredGlobal}
          search={globalSearch}
          setSearch={setGlobalSearch}
          sort={globalSort}
          setSort={setGlobalSort}
          accentColor="#6366f1"
          currency="USD"
        />
      </div>

      {/* Bottom Section: News + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <Newspaper size={18} className="text-[#0D7490]" />
              Market News
            </h3>
            <Link to="/app/news" className="text-xs font-bold text-[#0D7490] hover:underline">View All News</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NewsItem category="SCOM" title="Safaricom reports record M-Pesa growth in Q1" source="Business Daily" time="1h ago" />
            <NewsItem category="NSE" title="Central Bank holds rates steady at 10.5%" source="Reuters" time="3h ago" />
            <NewsItem category="EQTY" title="Equity Group Q2 profit up 23% YoY" source="NSE" time="5h ago" />
            <NewsItem category="GLOBAL" title="Nvidia gains 4.5% after AI summit highlights" source="CNBC" time="6h ago" />
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <SidebarWidget title="Sector Performance" link="/app/sectors">
            <div className="space-y-3">
              {[
                { name: 'NSE Banking', change: '+2.1%' },
                { name: 'Global Tech', change: '+3.4%' },
                { name: 'NSE Telecom', change: '+5.2%' },
                { name: 'Global Energy', change: '-0.8%' },
              ].map(sector => (
                <div className="flex justify-between items-center text-xs font-bold" key={sector.name}>
                  <span className="text-slate-600">{sector.name}</span>
                  <span className={sector.change.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}>{sector.change}</span>
                </div>
              ))}
            </div>
          </SidebarWidget>

          <SidebarWidget title="AI Market Summary">
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-slate-600 font-medium">Global markets show resilience with Tech leading gains in the US, while the NSE experiences bullish momentum in the Banking sector driven by institutional buying.</p>
              <div className="flex gap-2">
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px] font-bold">Sentiment: Bullish</Badge>
                <Badge variant="secondary" className="bg-slate-100 text-slate-600 text-[10px] font-bold">Confidence: 78%</Badge>
              </div>
              <Link to="/app/ai-insights" className="w-full mt-2 py-2.5 bg-slate-900 text-white text-[11px] font-bold rounded-lg text-center hover:bg-slate-800 transition-colors flex items-center justify-center gap-2">
                <BrainCircuit size={14} />
                View Full Analysis
              </Link>
            </div>
          </SidebarWidget>

          <MoverWindow 
            title="Top Gainers" 
            nse={marketData?.nse.movers.gainers} 
            global={marketData?.global.movers.gainers} 
            pos 
          />

          <MoverWindow 
            title="Top Losers" 
            nse={marketData?.nse.movers.losers} 
            global={marketData?.global.movers.losers} 
            pos={false} 
          />
        </aside>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Market Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex gap-3">
                  <Mail size={18} className="text-[#0D7490] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Daily Sentiment Emails</p>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed mt-1">Receive daily AI-powered market sentiment reports via email.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEmailAlerts(!emailAlerts)}
                  className={`w-11 h-6 rounded-full relative transition-colors duration-200 ${emailAlerts ? 'bg-[#0D7490]' : 'bg-slate-200'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${emailAlerts ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MoverWindow = ({ title, nse, global, pos }: any) => {
  const [tab, setTab] = useState<'nse' | 'global'>('nse');
  const data = tab === 'nse' ? nse : global;

  return (
    <SidebarWidget title={title}>
      <div className="flex gap-1.5 mb-3">
        <button 
          onClick={() => setTab('nse')}
          className={`flex-1 py-1.5 text-[10px] font-extrabold rounded-md transition-all ${
            tab === 'nse' ? 'bg-[#0D7490] text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >NSE</button>
        <button 
          onClick={() => setTab('global')}
          className={`flex-1 py-1.5 text-[10px] font-extrabold rounded-md transition-all ${
            tab === 'global' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >GLOBAL</button>
      </div>
      <div className="space-y-1">
        {data?.slice(0, 5).map((s: any) => (
          <TinyCard key={s.symbol} s={s.symbol?.replace('NSE:', '')} p={s.price} c={s.changePercent} v={s.volume} pos={pos} />
        ))}
        {(!data || data.length === 0) && (
          <div className="py-6 text-center text-[11px] text-slate-400 font-bold uppercase tracking-wider">No movement data</div>
        )}
      </div>
    </SidebarWidget>
  );
};

const TinyCard = ({ s, p, c, v, pos }: any) => (
  <div className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0">
    <div className="flex flex-col">
      <span className="font-bold text-sm text-slate-900">{s}</span>
      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Vol: {formatCompactNumber(v)}</span>
    </div>
    <div className="text-right flex flex-col">
      <span className="font-bold text-sm text-slate-900">{p}</span>
      <span className={`text-xs font-bold ${pos ? 'text-emerald-600' : 'text-rose-600'}`}>{pos ? '+' : ''}{c?.toFixed(2)}%</span>
    </div>
  </div>
);

const NewsItem = ({ category, title, source, time }: any) => (
  <Card className="p-4 border-slate-200/80 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
    <span className="text-[10px] font-bold text-[#0D7490] uppercase tracking-widest mb-1 block">{category}</span>
    <h4 className="text-sm font-bold text-slate-900 mb-2 line-clamp-2 leading-snug">{title}</h4>
    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold">
      <span>{source}</span>
      <div className="w-1 h-1 rounded-full bg-slate-200" />
      <span>{time}</span>
    </div>
  </Card>
);

const SidebarWidget = ({ title, children, link }: any) => (
  <Card className="overflow-hidden border-slate-200/80 shadow-sm">
    <div className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
      {link && <Link to={link} className="text-[10px] font-bold text-[#0D7490] hover:underline">View All</Link>}
    </div>
    <div className="p-4">{children}</div>
  </Card>
);

export default MarketPage;
