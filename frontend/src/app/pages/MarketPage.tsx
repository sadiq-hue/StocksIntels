"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Search, RefreshCcw, Loader2, Globe, Landmark, Settings, X, Mail,
  TrendingUp, TrendingDown, ArrowUpDown, Star, Newspaper, BrainCircuit,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { kenyanStocks, globalStocks } from '../data/stockUniverses';
import { useStockData } from '../contexts/StockDataContext';
import { fetchAllNews, type NewsArticle } from '../services/newsService';

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function parseVolume(vol: string): number {
  const num = parseFloat(vol.replace("M", "").replace("K", "").replace("B", ""));
  if (vol.includes("B")) return num * 1000000000;
  if (vol.includes("M")) return num * 1000000;
  if (vol.includes("K")) return num * 1000;
  return num;
}

function safeVolume(vol: any): number {
  if (typeof vol === 'number') return vol;
  if (typeof vol === 'string') return parseVolume(vol);
  return 0;
}

function toApiFormat(stocks: typeof kenyanStocks, prefixNse = false) {
  return stocks.map(s => ({
    symbol: prefixNse ? `NSE:${s.ticker}` : s.ticker,
    company_name: s.name,
    price: s.price,
    changePercent: s.change,
    volume: parseVolume(s.volume),
    currency: s.currency || "KES",
    market_cap: s.marketCap,
    sector: s.sector,
    pe: s.pe,
    dividend: s.dividend,
  }));
}

const localNseStocks = toApiFormat(kenyanStocks, true);
const localGlobalStocks = toApiFormat(globalStocks, false);

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const MarketPage: React.FC = () => {
  const { nseStocks: ctxNse, globalStocks: ctxGlobal, allStocks, loading: ctxLoading, refresh: refreshCtx } = useStockData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showSettings, setShowSettings] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(() => {
    return localStorage.getItem('market_sentiment_emails') === 'true';
  });
  const [marketData, setMarketData] = useState<{
    nse: { active: any[], movers: any },
    global: { active: any[], movers: any },
    indices: any[]
  }>({
    nse: { active: localNseStocks, movers: { gainers: [], losers: [] } },
    global: { active: localGlobalStocks, movers: { gainers: [], losers: [] } },
    indices: [],
  });
  const [fetchingMovers, setFetchingMovers] = useState(false);

  const [nseSearch, setNseSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [nseSort, setNseSort] = useState<'symbol' | 'price' | 'change'>('symbol');
  const [globalSort, setGlobalSort] = useState<'symbol' | 'price' | 'change'>('symbol');
  const [nsePage, setNsePage] = useState(1);
  const [globalPage, setGlobalPage] = useState(1);
  const itemsPerPage = 20;

  const [favorites, setFavorites] = useState<string[]>([]);
  const [aiSummary, setAiSummary] = useState<{ summary: string; sentiment: string; confidence: string } | null>(null);

  const [marketNews, setMarketNews] = useState<NewsArticle[]>([]);

  useEffect(() => {
    fetchAllNews().then(articles => setMarketNews(articles));
  }, []);

  useEffect(() => {
    if (searchParams.get('settings') === 'true') {
      setShowSettings(true);
    }
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem('market_sentiment_emails', String(emailAlerts));
  }, [emailAlerts]);

  // Merge context stocks into market data whenever they change (shared with StocksPage)
  useEffect(() => {
    if (allStocks.length === 0) return;
    const apiNseStocks = allStocks.filter(s => s.symbol?.startsWith('NSE:'));
    const apiGlobalStocks = allStocks.filter(s => !s.symbol?.startsWith('NSE:'));
    const apiNseMap = new Map(apiNseStocks.map(s => [s.symbol, s]));
    const apiGlobalMap = new Map(apiGlobalStocks.map(s => [s.symbol, s]));

    const mergedNse = localNseStocks.map(local => {
      const api = apiNseMap.get(local.symbol);
      return api ? { ...local, ...api } : local;
    });
    const mergedGlobal = localGlobalStocks.map(local => {
      const api = apiGlobalMap.get(local.symbol);
      return api ? { ...local, ...api } : local;
    });

    const localNseSymbols = new Set(localNseStocks.map(s => s.symbol));
    const localGlobalSymbols = new Set(localGlobalStocks.map(s => s.symbol));
    for (const s of apiNseStocks) {
      if (!localNseSymbols.has(s.symbol)) mergedNse.push(s);
    }
    for (const s of apiGlobalStocks) {
      if (!localGlobalSymbols.has(s.symbol)) mergedGlobal.push(s);
    }

    setMarketData(prev => ({
      ...prev,
      nse: { ...prev.nse, active: mergedNse },
      global: { ...prev.global, active: mergedGlobal },
    }));
  }, [allStocks]);

  const fetchMoversAndIndices = async () => {
    setFetchingMovers(true);
    try {
      const [moversRes, indicesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/market/movers`),
        fetch(`${API_BASE_URL}/market/indices`),
      ]);
      const movers = await moversRes.json();
      const indices = await indicesRes.json();
      setMarketData(prev => ({
        ...prev,
        nse: { ...prev.nse, movers: movers.nse || { gainers: [], losers: [] } },
        global: { ...prev.global, movers: movers.global || { gainers: [], losers: [] } },
        indices: indices || [],
      }));
    } catch (err) {
      console.error("API fetch failed, using local stock data", err);
    } finally {
      setFetchingMovers(false);
    }
  };

  const loading = ctxLoading && allStocks.length === 0;

  useEffect(() => {
    fetchMoversAndIndices();
    fetch(`${API_BASE_URL}/ai/market-summary`)
      .then(r => r.json())
      .then(setAiSummary)
      .catch(() => {});
  }, []);

  const indicesToDisplay = useMemo(() => {
    if (marketData.indices?.length) return marketData.indices;
    return [
      { symbol: 'NSEASI', name: 'NSE All Share Index', value: '112.45', change: '+1.08%', volume: '450.1M', turnover: 'KES 1.2B' },
      { symbol: 'S&P 500', name: 'S&P 500 Index', value: '5,204.34', change: '+1.15%', volume: '3.8B', turnover: 'USD' },
      { symbol: 'NASDAQ', name: 'Nasdaq Composite', value: '16,332.24', change: '+1.54%', volume: '4.2B', turnover: 'USD' },
      { symbol: 'NYSE', name: 'NYSE Composite', value: '17,842.15', change: '+0.72%', volume: '2.1B', turnover: 'USD' },
      { symbol: 'DJIA', name: 'Dow Jones Industrial', value: '38,904.04', change: '+0.85%', volume: '320M', turnover: 'USD' },
      { symbol: 'RUSSELL', name: 'Russell 2000 Index', value: '2,012.45', change: '+0.12%', volume: '1.2B', turnover: 'USD' },
      { symbol: 'NSE 20', name: 'NSE 20 Share Index', value: '1,542.12', change: '+0.45%', volume: '12.4M', turnover: 'KES 45.2M' },
    ];
  }, [marketData]);

  const nseStats = useMemo(() => {
    const stocks = marketData.nse.active || [];
    const totalVol = stocks.reduce((acc, s) => acc + safeVolume(s.volume), 0);
    const totalTurnover = stocks.reduce((acc, s) => acc + ((s.price || 0) * safeVolume(s.volume)), 0);
    return { volume: formatCompactNumber(totalVol), turnover: formatCompactNumber(totalTurnover), count: stocks.length };
  }, [marketData.nse.active]);

  const globalStats = useMemo(() => {
    const stocks = marketData.global.active || [];
    const totalVol = stocks.reduce((acc, s) => acc + safeVolume(s.volume), 0);
    const totalTurnover = stocks.reduce((acc, s) => acc + ((s.price || 0) * safeVolume(s.volume)), 0);
    return { volume: formatCompactNumber(totalVol), turnover: formatCompactNumber(totalTurnover), count: stocks.length };
  }, [marketData.global.active]);

  const nseShareIdx = useMemo(() => {
    return indicesToDisplay.find(i =>
      i.symbol?.includes('NSE20') || i.symbol?.includes('NSEASI') || i.name?.includes('NSE All Share') || i.name?.includes('NSE 20')
    ) || indicesToDisplay[0];
  }, [indicesToDisplay]);

  const globalShareIdx = useMemo(() => {
    return indicesToDisplay.find(i =>
      i.symbol === 'S&P 500' || i.symbol === 'SP500' || i.name?.includes('S&P 500')
    ) || indicesToDisplay.find(i => !i.symbol?.startsWith('NSE')) || indicesToDisplay[1];
  }, [indicesToDisplay]);

  // Compute top movers locally from active stock data (fallback when API movers are empty)
  const localNseGainers = useMemo(() =>
    [...marketData.nse.active].sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0)).slice(0, 5),
    [marketData.nse.active]
  );
  const localNseLosers = useMemo(() =>
    [...marketData.nse.active].sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0)).slice(0, 5),
    [marketData.nse.active]
  );
  const localGlobalGainers = useMemo(() =>
    [...marketData.global.active].sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0)).slice(0, 5),
    [marketData.global.active]
  );
  const localGlobalLosers = useMemo(() =>
    [...marketData.global.active].sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0)).slice(0, 5),
    [marketData.global.active]
  );

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

  const nseStocks = marketData.nse.active;
  const globalStocksData = marketData.global.active;

  const filteredNse = filterAndSort(nseStocks, nseSearch, nseSort);
  const filteredGlobal = filterAndSort(globalStocksData, globalSearch, globalSort);

  const paginatedNse = filteredNse.slice((nsePage - 1) * itemsPerPage, nsePage * itemsPerPage);
  const paginatedGlobal = filteredGlobal.slice((globalPage - 1) * itemsPerPage, globalPage * itemsPerPage);

  const nsePages = Math.max(1, Math.ceil(filteredNse.length / itemsPerPage));
  const globalPages = Math.max(1, Math.ceil(filteredGlobal.length / itemsPerPage));

  useEffect(() => { setNsePage(1); }, [nseSearch, nseSort]);
  useEffect(() => { setGlobalPage(1); }, [globalSearch, globalSort]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
      <Loader2 className="animate-spin text-[#0D7490]" size={32} />
      <p className="text-sm font-medium text-muted-foreground">Loading Market Data...</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]">
              <Globe className="size-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Market Intelligence</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time NSE &amp; Global Market Activity &bull; Updated {new Date().toLocaleTimeString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
            <Settings size={14} className="mr-2" /> Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refreshCtx(); fetchMoversAndIndices(); }}>
            <RefreshCcw size={14} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Market Status</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">NSE</div>
              <div className="text-lg font-bold text-emerald-600">Open</div>
              <div className="text-[10px] text-muted-foreground">Closes 3:30 PM</div>
            </div>
            <div className="border-l border-border pl-3">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Global</div>
              <div className="text-lg font-bold text-emerald-600">Open</div>
              <div className="text-[10px] text-muted-foreground">Closes 4:00 PM</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Total Turnover</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">NSE (KES)</div>
              <div className="text-lg font-bold text-foreground">{nseStats.turnover}</div>
            </div>
            <div className="border-l border-border pl-3">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Global (USD)</div>
              <div className="text-lg font-bold text-foreground">{globalStats.turnover}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Volume</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">NSE</div>
              <div className="text-lg font-bold text-foreground">{nseStats.volume}</div>
              <div className="text-[10px] text-muted-foreground">shares</div>
            </div>
            <div className="border-l border-border pl-3">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5">Global</div>
              <div className="text-lg font-bold text-foreground">{globalStats.volume}</div>
              <div className="text-[10px] text-muted-foreground">shares</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border shadow-sm">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Share Index</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate">{nseShareIdx.name?.replace(' Index', '') || 'NSE'}</div>
              <div className="text-lg font-bold text-foreground">{nseShareIdx.value}</div>
              <div className={`text-[10px] font-semibold ${String(nseShareIdx.change)?.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>{nseShareIdx.change}</div>
            </div>
            <div className="border-l border-border pl-3">
              <div className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate">{globalShareIdx.name?.replace(' Index', '') || 'Global'}</div>
              <div className="text-lg font-bold text-foreground">{globalShareIdx.value}</div>
              <div className={`text-[10px] font-semibold ${String(globalShareIdx.change)?.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>{globalShareIdx.change}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Indices */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {indicesToDisplay.map(idx => (
          <Card key={idx.symbol} className="bg-card border shadow-sm p-3">
            <div className="text-[10px] font-medium text-muted-foreground truncate mb-1">{idx.name}</div>
            <div className="text-base font-bold text-foreground mb-0.5">{idx.value}</div>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${idx.change?.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>
                {idx.change}
              </span>
              <span className="text-[10px] text-muted-foreground">Vol: {idx.volume}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Market Legend */}
      <div className="flex flex-wrap items-center gap-6 px-1">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-[#0D7490]" />
          <span className="text-xs font-medium text-muted-foreground">Nairobi Securities Exchange (KES)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-indigo-500" />
          <span className="text-xs font-medium text-muted-foreground">US/Global Markets (USD)</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>Both markets update in real-time</span>
        </div>
      </div>

      {/* Dual Windows */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MarketWindow
          title="NSE Activity"
          icon={Landmark}
          stocks={paginatedNse}
          search={nseSearch}
          setSearch={setNseSearch}
          sort={nseSort}
          setSort={setNseSort}
          accentColor="#0D7490"
          currency="KES"
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          page={nsePage}
          setPage={setNsePage}
          totalPages={nsePages}
          totalCount={filteredNse.length}
          onStockClick={(stock: any) => navigate(`/app/stock/${stock.symbol?.replace(/^(NSE|NYSE|NASDAQ|AMEX):/, '')}?market=nse`)}
        />
        <MarketWindow
          title="US & Global Activity"
          icon={Globe}
          stocks={paginatedGlobal}
          search={globalSearch}
          setSearch={setGlobalSearch}
          sort={globalSort}
          setSort={setGlobalSort}
          accentColor="#6366f1"
          currency="USD"
          favorites={favorites}
          toggleFavorite={toggleFavorite}
          page={globalPage}
          setPage={setGlobalPage}
          totalPages={globalPages}
          totalCount={filteredGlobal.length}
          onStockClick={(stock: any) => navigate(`/app/stock/${stock.symbol?.replace(/^(NSE|NYSE|NASDAQ|AMEX):/, '')}?market=us`)}
        />
      </div>

      {/* Bottom Section: Widgets Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SidebarWidget title="Sector Performance" link="/app/sectors">
          <div className="space-y-3">
            {[
              { name: 'NSE Banking', change: '+2.1%' },
              { name: 'Global Tech', change: '+3.4%' },
              { name: 'NSE Telecom', change: '+5.2%' },
              { name: 'Global Energy', change: '-0.8%' },
            ].map(sector => (
              <div className="flex justify-between items-center" key={sector.name}>
                <span className="text-xs font-medium text-muted-foreground">{sector.name}</span>
                <span className={`text-xs font-semibold ${sector.change.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>{sector.change}</span>
              </div>
            ))}
          </div>
        </SidebarWidget>

        <SidebarWidget title="AI Market Summary">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground leading-relaxed">{aiSummary?.summary || 'Loading market analysis...'}</p>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary" className={`text-[10px] font-medium ${
                aiSummary?.sentiment?.includes('Bullish') ? 'bg-emerald-50 text-emerald-700' :
                aiSummary?.sentiment?.includes('Bearish') ? 'bg-red-50 text-red-700' :
                'bg-muted text-muted-foreground'
              }`}>Sentiment: {aiSummary?.sentiment || '--'}</Badge>
              <Badge variant="secondary" className="bg-muted text-muted-foreground text-[10px] font-medium">Confidence: {aiSummary?.confidence || '--'}</Badge>
            </div>
            <Link to="/app/ai-insights" className="w-full py-2 bg-foreground text-background text-xs font-medium rounded-lg text-center hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <BrainCircuit size={14} />
              View Full Analysis
            </Link>
          </div>
        </SidebarWidget>
      </div>

      {/* Bottom Section: News + Movers aligned */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Newspaper size={16} className="text-[#0D7490]" />
              Market News
            </h3>
            <Link to="/app/news" className="text-xs font-medium text-[#0D7490] hover:underline">View All</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {marketNews.slice(0, 4).map((item) => (
              <NewsItem key={item.id} article={item} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <MoverWindow 
            title="Top Gainers" 
            nse={marketData.nse.movers?.gainers?.length ? marketData.nse.movers.gainers : localNseGainers}
            global={marketData.global.movers?.gainers?.length ? marketData.global.movers.gainers : localGlobalGainers}
            pos 
          />
          <MoverWindow 
            title="Top Losers" 
            nse={marketData.nse.movers?.losers?.length ? marketData.nse.movers.losers : localNseLosers}
            global={marketData.global.movers?.losers?.length ? marketData.global.movers.losers : localGlobalLosers}
            pos={false} 
          />
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="bg-card w-full max-w-md rounded-xl shadow-xl overflow-hidden border" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Market Settings</h3>
              <button onClick={() => setShowSettings(false)} className="p-1.5 hover:bg-muted rounded-md transition-colors">
                <X size={16} className="text-muted-foreground" />
              </button>
            </div>
            <div className="p-5">
              <div className="flex justify-between items-start">
                <div className="flex gap-3">
                  <Mail size={18} className="text-[#0D7490] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Daily Sentiment Emails</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Receive daily AI-powered market sentiment reports via email.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEmailAlerts(!emailAlerts)}
                  className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${emailAlerts ? 'bg-[#0D7490]' : 'bg-muted-foreground/30'}`}
                >
                  <div className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-all duration-200 ${emailAlerts ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MarketWindow = ({ 
  title, 
  icon: Icon, 
  stocks, 
  search, 
  setSearch, 
  sort, 
  setSort, 
  accentColor,
  currency,
  favorites,
  toggleFavorite,
  page,
  setPage,
  totalPages,
  totalCount,
  onStockClick
}: any) => (
  <div className="flex flex-col h-full bg-card rounded-xl border shadow-sm overflow-hidden">
    {/* Header */}
    <div className="px-5 py-4 border-b bg-muted/30 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${accentColor}15` }}>
          <Icon size={18} color={accentColor} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-xs text-muted-foreground">{totalCount} securities</span>
        </div>
      </div>
      <Badge variant="secondary" style={{ backgroundColor: `${accentColor}15`, color: accentColor }} className="font-medium text-xs">
        {currency}
      </Badge>
    </div>

    {/* Search & Sort */}
    <div className="px-4 py-3 border-b flex items-center gap-2">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}...`}
          className="pl-9 h-9 text-sm"
        />
      </div>
      <button 
        className="flex items-center gap-1.5 px-3 h-9 rounded-lg border bg-background hover:bg-accent transition-colors shrink-0"
        onClick={() => setSort((prev: string) => prev === 'symbol' ? 'change' : prev === 'change' ? 'price' : 'symbol')}
      >
        <ArrowUpDown size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{sort === 'symbol' ? 'A-Z' : sort === 'price' ? 'Price' : 'Change'}</span>
      </button>
    </div>

    {/* Table */}
    <div className="flex-1 overflow-auto">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/50">
          <tr className="border-b">
            <th className="w-8 px-3 py-2.5"></th>
            <th className="px-3 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Symbol</th>
            <th className="px-3 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Name</th>
            <th className="px-3 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">Price</th>
            <th className="px-3 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right">Change</th>
            <th className="px-3 py-2.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider text-right hidden md:table-cell">Volume</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock: any) => {
            const isPositive = (stock.changePercent || 0) >= 0;
            const isFav = favorites.includes(stock.symbol);
            return (
              <tr key={stock.symbol} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => onStockClick?.(stock)}>
                <td className="px-3 py-2.5">
                  <button className="p-0.5 hover:bg-muted rounded transition-colors" onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.symbol, e); }}>
                    <Star size={13} className={isFav ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'} />
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-foreground">{stock.symbol?.replace('NSE:', '')}</span>
                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground">{stock.currency || currency}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <span className="text-xs text-muted-foreground truncate block max-w-[160px]">{stock.company_name}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-sm font-semibold text-foreground font-mono">{stock.price}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                    isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {isPositive ? '+' : ''}{(stock.changePercent ?? 0).toFixed(2)}%
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right hidden md:table-cell">
                  <span className="text-xs text-muted-foreground">{formatCompactNumber(typeof stock.volume === 'number' ? stock.volume : parseFloat(String(stock.volume).replace(/[^0-9.]/g, '')) || 0)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {stocks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Search size={24} className="mb-2 opacity-30" />
          <p className="text-xs font-medium">No stocks match &ldquo;{search}&rdquo;</p>
        </div>
      )}
    </div>

    {/* Pagination */}
    <div className="flex items-center justify-between border-t px-4 py-3 bg-muted/20">
      <span className="text-xs text-muted-foreground">{totalCount} results</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPage((p: number) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="flex items-center justify-center size-7 rounded border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="text-xs font-medium text-muted-foreground px-2 min-w-[4rem] text-center">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="flex items-center justify-center size-7 rounded border bg-background hover:bg-accent disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  </div>
);

const MoverWindow = ({ title, nse, global, pos }: any) => {
  const [tab, setTab] = useState<'nse' | 'global'>('nse');
  const data = tab === 'nse' ? nse : global;

  return (
    <SidebarWidget title={title}>
      <div className="flex gap-1.5 mb-3">
        <button 
          onClick={() => setTab('nse')}
          className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-all ${
            tab === 'nse' ? 'bg-[#0D7490] text-white shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >NSE</button>
        <button 
          onClick={() => setTab('global')}
          className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md transition-all ${
            tab === 'global' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >US / GLOBAL</button>
      </div>
      <div className="space-y-1">
        {data?.slice(0, 5).map((s: any) => (
          <TinyCard key={s.symbol} s={s.symbol?.replace(/^(NSE|NYSE|NASDAQ|AMEX):/, '')} p={s.price} c={s.changePercent} v={s.volume} pos={pos} />
        ))}
        {(!data || data.length === 0) && (
          <div className="py-6 text-center text-[11px] text-muted-foreground font-medium uppercase tracking-wider">No data</div>
        )}
      </div>
    </SidebarWidget>
  );
};

const TinyCard = ({ s, p, c, v, pos }: any) => (
  <div className="flex justify-between items-center py-2.5 border-b border-border/50 last:border-0">
    <div className="flex flex-col">
      <span className="text-sm font-semibold text-foreground">{s}</span>
      <span className="text-[10px] text-muted-foreground font-medium">Vol: {formatCompactNumber(typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0)}</span>
    </div>
    <div className="text-right flex flex-col">
      <span className="text-sm font-semibold text-foreground">{p}</span>
      <span className={`text-xs font-semibold ${pos ? 'text-emerald-600' : 'text-red-500'}`}>{pos ? '+' : ''}{(c ?? 0).toFixed(2)}%</span>
    </div>
  </div>
);

const NewsItem = ({ article }: { article: NewsArticle }) => {
  const sentimentColor = article.sentiment === "positive" ? "bg-green-100 text-green-700" : article.sentiment === "negative" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600";
  return (
    <Card className="p-4 border shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => article.url && article.url !== "#" && window.open(article.url, "_blank")}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold text-[#0D7490] uppercase tracking-widest">{article.relatedStocks[0] || "Market"}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sentimentColor}`}>{article.sentiment}</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground mb-2 line-clamp-2 leading-snug">{article.headline}</h4>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{article.source}</span>
        <div className="size-1 rounded-full bg-border" />
        <span>{article.timestamp}</span>
      </div>
    </Card>
  );
};

const SidebarWidget = ({ title, children, link }: any) => (
  <Card className="overflow-hidden border shadow-sm">
    <div className="px-4 py-3 bg-muted/30 border-b flex items-center justify-between">
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{title}</h3>
      {link && <Link to={link} className="text-[10px] font-medium text-[#0D7490] hover:underline">View All</Link>}
    </div>
    <div className="p-4">{children}</div>
  </Card>
);

export default MarketPage;
