import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  TrendingUp, TrendingDown, AlertTriangle, Activity, PieChart, BarChart3, Target, DollarSign,
  ArrowUpRight, ArrowDownRight, Users, Building2, Wallet, Clock, Plus, X, Link2, Unlink,
  RefreshCw,   Sparkles, Loader2, Landmark, Database, Check, Search, Filter, Edit3, Trash2,
  BarChartHorizontal, BrainCircuit, ExternalLink, SwitchCamera, Play, RotateCcw, History,
  ShoppingCart, DollarSign as DollarSignIcon, AlertCircle, Server, ArrowRight, Layers, Newspaper
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useAuth } from "../auth/AuthContext";
import { usePortfolioData } from "../contexts/PortfolioDataContext";
import { usePaperTrading, type PaperPosition, type PaperTrade } from "../contexts/PaperTradingContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface Holding {
  id?: number;
  ticker: string;
  name: string;
  shares: number;
  avgCost: string;
  currentPrice?: string;
  value: string;
  pnl: string;
  isPositive: boolean;
  sector: string;
  market: "NSE" | "Global";
  brokerConnectionId?: number;
}

interface BrokerSnapshot {
  id: number;
  broker_connection_id: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  level: number;
  positions: any[];
  trade_history: any[];
  snapshot_at: string;
}

interface Broker {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  apiSecret?: string;
  config?: { [key: string]: any };
  connected: boolean;
  accountName: string;
  accountId?: string;
  server?: string;
  platform?: string;
  accountType?: string;
  dbId?: number;
  syncStatus?: "idle" | "syncing" | "error";
  lastSyncAt?: string;
  errorMessage?: string;
  accountInfo?: {
    balance?: number | null;
    equity?: number | null;
    margin?: number | null;
    freeMargin?: number | null;
    level?: number | null;
    positionsCount?: number | null;
  };
  latestSnapshot?: BrokerSnapshot | null;
}

interface Recommendation {
  symbol: string;
  ticker?: string;
  signal: string;
  confidence: string;
  name?: string;
  price?: string;
  target1?: string;
  reason?: string;
  market?: string;
  currency?: string;
}

interface PortfolioAdvice {
  summary: string;
  recommendations: {
    ticker: string;
    name: string;
    action: string;
    reason: string;
    pnlPct: string;
    allocation: string;
    targetAllocation: string;
  }[];
  diversification: { score: number; message: string };
  riskAssessment: string;
  marketContext?: {
    direction: { nse: string; global: string };
    indices: { nse: any[]; global: any[] };
    nseVolatility: string;
    topSectors: { name: string; change: string; avgChange: number }[];
    bottomSectors: { name: string; change: string; avgChange: number }[];
    relevantNews: { headline: string; source: string; date: string }[];
    fxRate: number;
  };
}

const SECTORS = ["Technology", "Financial", "Telecom", "Banking", "Manufacturing", "Consumer", "Automobiles", "Energy", "Media", "Utilities", "Other"];

export function PortfolioPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [marketFilter, setMarketFilter] = useState<"All" | "NSE" | "Global">("All");
  const [showConnect, setShowConnect] = useState(false);
  const [showAddHolding, setShowAddHolding] = useState(false);
  const [showEditHolding, setShowEditHolding] = useState<Holding | null>(null);
  const [showAdvice, setShowAdvice] = useState(false);
  const { holdings, totals, enhancedTotals, brokerTotals, refresh, setBrokerConnections } = usePortfolioData();
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [portfolioAdvice, setPortfolioAdvice] = useState<PortfolioAdvice | null>(null);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [showRecDialog, setShowRecDialog] = useState(false);
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newBroker, setNewBroker] = useState<{ type: string; accountName: string; accountId: string; server: string; platform: string; password: string; accountType: string; platformType: string }>({
    type: "generic", accountName: "", accountId: "", server: "", platform: "", password: "", accountType: "Live", platformType: "mt5"
  });
  const [newHolding, setNewHolding] = useState({ ticker: "", name: "", shares: "", avgCost: "", sector: "Other", market: "NSE" as "NSE" | "Global" });
  const [stockSuggestions, setStockSuggestions] = useState<{ ticker: string; name: string; sector: string; market: string }[]>([]);
  const [searchingStock, setSearchingStock] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [paperMode, setPaperMode] = useState(false);
  const [showFloatingConnect, setShowFloatingConnect] = useState(false);
  const [showRealStatement, setShowRealStatement] = useState(false);
  const [realStatementData, setRealStatementData] = useState<any>(null);
  const [realStatementLoading, setRealStatementLoading] = useState(false);
  const [statementPeriod, setStatementPeriod] = useState("1M");
  const [statementLastRefreshed, setStatementLastRefreshed] = useState<Date | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [currentFxRate, setCurrentFxRate] = useState(130);
  const [parseMode, setParseMode] = useState<'manual' | 'email'>('manual');
  const [emailText, setEmailText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [showPaperBuy, setShowPaperBuy] = useState(false);
  const [showBrokerDetail, setShowBrokerDetail] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null);
  const [showPaperSell, setShowPaperSell] = useState<PaperPosition | null>(null);
  const [showPaperReset, setShowPaperReset] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [statementData, setStatementData] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [paperOrder, setPaperOrder] = useState({ ticker: "", name: "", shares: "", market: "NSE" as "NSE" | "Global", sector: "Other", currentPrice: "" });
  const [paperSearchResults, setPaperSearchResults] = useState<{ ticker: string; name: string; sector: string; market: string }[]>([]);
  const [paperSearching, setPaperSearching] = useState(false);
  const paperSearchRef = useRef<HTMLDivElement>(null);

  const { account: paperAccount, positions: paperPositions, trades: paperTrades, loading: paperLoading, placingOrder: paperPlacingOrder, marketStatus, refresh: refreshPaper, placeOrder, initAccount, resetAccount, fetchStatement } = usePaperTrading();

  const resetPaperOrder = () => setPaperOrder({ ticker: "", name: "", shares: "", market: "NSE", sector: "Other", currentPrice: "" });

  const resetNewHolding = () => setNewHolding({ ticker: "", name: "", shares: "", avgCost: "", sector: "Other", market: "NSE" });
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntryTab, setManualEntryTab] = useState<"single" | "batch" | "csv">("single");
  // Batch entry rows
  const [batchRows, setBatchRows] = useState<{ ticker: string; name: string; shares: string; avgCost: string; sector: string; market: "NSE" | "Global" }[]>([]);
  const [csvData, setCsvData] = useState<{ ticker: string; name: string; shares: string; avgCost: string; sector: string; market: string }[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [importingManual, setImportingManual] = useState(false);
  const [importResult, setImportResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [csvDragOver, setCsvDragOver] = useState(false);

  // Stock ticker search with debounce
  useEffect(() => {
    if (newHolding.ticker.trim().length < 1) { setStockSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setSearchingStock(true);
      try {
        const res = await fetch(`${API_URL}/stocks/search?q=${encodeURIComponent(newHolding.ticker)}`);
        if (res.ok) setStockSuggestions(await res.json());
      } catch {} finally { setSearchingStock(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [newHolding.ticker]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setStockSuggestions([]);
      if (paperSearchRef.current && !paperSearchRef.current.contains(e.target as Node)) setPaperSearchResults([]);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Paper buy stock search with debounce
  useEffect(() => {
    if (paperOrder.ticker.trim().length < 1) { setPaperSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setPaperSearching(true);
      try {
        const res = await fetch(`${API_URL}/stocks/search?q=${encodeURIComponent(paperOrder.ticker)}`);
        if (res.ok) setPaperSearchResults(await res.json());
      } catch {} finally { setPaperSearching(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [paperOrder.ticker]);

  // Load paper trading data when toggled
  useEffect(() => {
    if (paperMode && user) refreshPaper();
  }, [paperMode, user]);

  // Fetch live FX rate for USD/KES conversion (refreshes every 5 min)
  useEffect(() => {
    const fetchFx = () => fetch(`${API_URL}/fx/rate`)
      .then(r => r.ok ? r.json() : { usdToKes: 130 })
      .then(data => setCurrentFxRate(data.usdToKes))
      .catch(() => {});
    fetchFx();
    const interval = setInterval(fetchFx, 300000);
    return () => clearInterval(interval);
  }, []);

  // Show floating Connect button when scrolled past header
  useEffect(() => {
    const handleScroll = () => setShowFloatingConnect(window.scrollY > 300);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Load brokers from API + localStorage
  useEffect(() => {
    const saved = localStorage.getItem("portfolio_brokers");
    const localBrokers: Broker[] = saved ? JSON.parse(saved) : [];
    setBrokers(localBrokers);
    // Hydrate context immediately from localStorage (before API completes)
    if (localBrokers.length > 0) setBrokerConnections(localBrokers);

    if (user) {
      fetch(`${API_URL}/broker-connections?userId=${user.id}`)
        .then(r => r.ok ? r.json() : [])
        .then(apiBrokers => {
          const merged = localBrokers.map(lb => {
            const match = apiBrokers.find((ab: any) => ab.id === lb.dbId);
            if (match) {
              return {
                ...lb,
                syncStatus: match.sync_status,
                lastSyncAt: match.last_sync_at,
                errorMessage: match.error_message,
                connected: match.connected,
                accountInfo: match.account_info,
                latestSnapshot: match.latest_snapshot ?? lb.latestSnapshot,
              };
            }
            return lb;
          });
          setBrokers(merged);
          // Hydrate context with merged data (including localStorage cache fallback)
          setBrokerConnections(merged);
        })
        .catch(() => {});
    }
  }, [user]);

  // Load recommendations + advice
  const loadRecommendations = async () => {
    try {
      const qs = user?.id ? `?userId=${user.id}` : '';
      const res = await fetch(`${API_URL}/ai/recommendations${qs}`);
      const data = await res.json();
      if (data.recommendations) setRecommendations(data.recommendations);
    } catch {}
    setLoadingRecs(false);
  };

  useEffect(() => {
    loadRecommendations();
  }, [user]);

  const openStatement = async () => {
    if (!user?.id) return;
    setShowRealStatement(true);
    setRealStatementLoading(true);
    setStatementError(null);
    try {
      const r = await fetch(`${API_URL}/portfolio/statement?userId=${user.id}&period=${statementPeriod}`);
      if (r.ok) { setRealStatementData(await r.json()); setStatementLastRefreshed(new Date()); }
      else { const errBody = await r.json().catch(() => ({})); setStatementError(`Server ${r.status}: ${errBody.detail || errBody.error || r.statusText}`); }
    } catch (e: any) { setStatementError(e.message || 'Network error'); console.error('Statement fetch error:', e); }
    finally { setRealStatementLoading(false); }
  };

  const changeStatementPeriod = async (p: string) => {
    setStatementPeriod(p);
    if (!user?.id) return;
    setRealStatementLoading(true);
    setStatementError(null);
    try {
      const r = await fetch(`${API_URL}/portfolio/statement?userId=${user.id}&period=${p}`);
      if (r.ok) { setRealStatementData(await r.json()); setStatementLastRefreshed(new Date()); }
      else { const errBody = await r.json().catch(() => ({})); setStatementError(`Server ${r.status}: ${errBody.detail || errBody.error || r.statusText}`); }
    } catch (e: any) { setStatementError(e.message || 'Network error'); console.error('Statement fetch error:', e); }
    finally { setRealStatementLoading(false); }
  };

  // Auto-refresh every 60s while dialog is open
  useEffect(() => {
    if (!showRealStatement) return;
    const id = setInterval(() => {
      if (!user?.id) return;
      fetch(`${API_URL}/portfolio/statement?userId=${user.id}&period=${statementPeriod}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(d => { setRealStatementData(d); setStatementLastRefreshed(new Date()); })
        .catch(e => console.error('Statement auto-refresh error:', e));
    }, 60000);
    return () => clearInterval(id);
  }, [showRealStatement, statementPeriod, user?.id]);

  const saveBrokers = (updated: Broker[]) => {
    setBrokers(updated);
    localStorage.setItem("portfolio_brokers", JSON.stringify(updated));
  };

  const BROKER_OPTIONS = [
    { value: "generic", label: "Generic / Other", description: "Save credentials only, no live sync" },
    { value: "mt5", label: "MT4/MT5 Broker", description: "Any MT4/MT5 broker — live sync via WebTrader scraping (e.g. IC Markets, FTMO, Pepperstone, Scope Markets, Exness, XM, FXTM)" },
    { value: "alpaca", label: "Alpaca Markets", description: "US stock/ETF trading — live sync via REST API. Use API Key ID + Secret Key. Supports paper (demo) and live." },
    { value: "ibkr", label: "Interactive Brokers", description: "Global stocks/forex/futures — live sync via IB Gateway REST API. Requires running IB Gateway locally." },
    { value: "tradier", label: "Tradier", description: "US stocks/options — live sync via Tradier API. Use Bearer access token. Set account type to Demo for paper trading." },
    { value: "oanda", label: "OANDA", description: "Forex/CFD trading — live sync via OANDA v20 REST API. Use Bearer access token. Set account type to Demo for practice account." },
    { value: "hisa", label: "Hisa", description: "Hisa multi-asset investment platform — manual entry required (no API)" },
    { value: "aibaxys", label: "AIB-AXYS Africa", description: "Kenyan stockbroker (NSE) — manual entry required (no API)" },
  ];

  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});
  const [isValidating, setIsValidating] = useState(false);

  const validateBrokerField = (field: string, value: string): string => {
    switch (field) {
      case "accountName":
        if (!value.trim()) return "Account name is required";
        if (value.trim().length < 2) return "Account name must be at least 2 characters";
        return "";
      case "server":
        if (!value.trim()) return "";
        if (value.trim().length < 2 || value.trim().length > 100) return "Server name must be 2-100 characters";
        if (/[<>"'\\;]/.test(value.trim())) return "Server name contains invalid characters";
        return "";
      case "accountId":
        if (!value.trim()) return "";
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,49}$/.test(value.trim()))
          return "Account ID must be 3-50 alphanumeric characters";
        return "";
      case "password":
        if (!value.trim()) return "";
        if (value.trim().length < 4) return "Password must be at least 4 characters";
        return "";
      case "platform":
        if (!value.trim()) return "";
        if (value.trim().length < 2) return "Enter a valid platform name";
        return "";
      default:
        return "";
    }
  };

  const handleConnectBroker = async () => {
    const errors: Record<string, string> = {};
    const isApiBroker = ['alpaca', 'ibkr', 'tradier', 'oanda'].includes(newBroker.type);
    const fields = isApiBroker
      ? ["accountName", "accountId", "password", "accountType"]
      : ["accountName", "accountId", "server", "password", "platform", "accountType"];
    for (const f of fields) {
      if (f === 'server' && isApiBroker) continue;
      const err = validateBrokerField(f, (newBroker as any)[f]);
      if (err) errors[f] = err;
    }
    setConnectErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (user) {
      setIsValidating(true);
      try {
        const valRes = await fetch(`${API_URL}/broker-connections/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brokerType: newBroker.type,
            apiKey: newBroker.accountId,
            apiSecret: newBroker.password,
            config: { server: newBroker.server, accountId: newBroker.accountId, accountType: newBroker.accountType, platformType: newBroker.platformType },
          }),
        });
        const valData = await valRes.json();
        if (!valData.valid) {
          setConnectErrors({ server: valData.error || "Connection validation failed" });
          setIsValidating(false);
          return;
        }
      } catch {
        setConnectErrors({ server: "Could not validate connection. Check your network." });
        setIsValidating(false);
        return;
      }
      setIsValidating(false);
    }

    const displayName = newBroker.platform
      ? `${newBroker.platform} - ${newBroker.accountName}`
      : newBroker.accountName;
    const broker: Broker = {
      id: `broker_${Date.now()}`,
      name: displayName,
      type: newBroker.type,
      connected: true,
      accountName: newBroker.accountName,
      accountId: newBroker.accountId,
      server: newBroker.server,
      platform: newBroker.platform,
      accountType: newBroker.accountType,
      syncStatus: "idle",
    };
    const config: Record<string, any> = {
      accountId: newBroker.accountId,
      server: newBroker.server,
      platform: newBroker.platform,
      accountType: newBroker.accountType,
      platformType: newBroker.platformType,
    };
    broker.config = config;
    broker.apiKey = newBroker.accountId;
    broker.apiSecret = newBroker.password;

    if (user) {
      try {
        const body: Record<string, any> = {
          userId: user.id,
          brokerType: newBroker.type,
          accountName: newBroker.accountName,
          apiKey: newBroker.accountId,
          apiSecret: newBroker.password,
          config,
        };
        const res = await fetch(`${API_URL}/broker-connections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          broker.dbId = data.id;
          broker.syncStatus = data.sync_status;
        } else {
          const err = await res.json();
          alert(`Connection failed: ${err.error}`);
          return;
        }
      } catch (err: any) {
        alert(`Connection failed: ${err.message}`);
        return;
      }
    }
    if (broker.dbId) {
      try {
        const syncRes = await fetch(`${API_URL}/broker-connections/${broker.dbId}/sync`, { method: "POST" });
        if (syncRes.ok) {
          const syncData = await syncRes.json();
          broker.accountInfo = syncData.account || undefined;
          if (syncData.account) {
            broker.latestSnapshot = {
              id: syncData.snapshotId,
              broker_connection_id: broker.dbId,
              balance: syncData.account.balance,
              equity: syncData.account.equity,
              margin: syncData.account.margin,
              free_margin: syncData.account.freeMargin,
              level: syncData.account.level,
              positions: syncData.positions || [],
              trade_history: syncData.tradeHistory || [],
              snapshot_at: new Date().toISOString(),
            };
          }
        }
        broker.syncStatus = "idle";
      } catch {}
    }
    const newBrokers = [...brokers, broker];
    saveBrokers(newBrokers);
    setBrokerConnections(newBrokers);
    setNewBroker({ type: "generic", accountName: "", accountId: "", server: "", platform: "", password: "", accountType: "Live", platformType: "mt5" });
    setConnectErrors({});
    setShowConnect(false);
  };

  const handleDisconnectBroker = async (id: string, dbId?: number) => {
    if (dbId && user) {
      try { await fetch(`${API_URL}/broker-connections/${dbId}?userId=${user.id}`, { method: "DELETE" }); } catch {}
    }
    const filtered = brokers.filter(b => b.id !== id);
    saveBrokers(filtered);
    setBrokerConnections(filtered);
  };

  const handleSyncBroker = async (broker: Broker) => {
    if (!broker.dbId) return;
    setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, syncStatus: "syncing" as const } : b));
    try {
      const res = await fetch(`${API_URL}/broker-connections/${broker.dbId}/sync`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        const updated = brokers.map(b => b.id === broker.id ? {
          ...b,
          syncStatus: "idle" as const,
          accountInfo: data.account || undefined,
          latestSnapshot: data.account ? {
            id: data.snapshotId,
            broker_connection_id: b.dbId!,
            balance: data.account.balance,
            equity: data.account.equity,
            margin: data.account.margin,
            free_margin: data.account.freeMargin,
            level: data.account.level,
            positions: data.positions || [],
            trade_history: data.tradeHistory || [],
            snapshot_at: new Date().toISOString(),
          } : undefined,
        } : b);
        saveBrokers(updated);
        setBrokerConnections(updated);
        await refresh();
      } else {
        const err = await res.json();
        setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, syncStatus: "error" as const, errorMessage: err.error } : b));
      }
    } catch {
      setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, syncStatus: "error" as const } : b));
    }
  };

  // CRUD operations on holdings
  const handleAddHolding = async () => {
    if (!newHolding.ticker.trim() || !newHolding.shares || !newHolding.avgCost) return;

    if (user) {
      try {
        const res = await fetch(`${API_URL}/holdings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            ticker: newHolding.ticker.toUpperCase(),
            name: newHolding.name || newHolding.ticker.toUpperCase(),
            shares: parseFloat(newHolding.shares),
            avgCost: parseFloat(newHolding.avgCost),
            sector: newHolding.sector,
            market: newHolding.market,
          }),
        });
        if (res.ok) {
          resetNewHolding();
          await refresh();
          return;
        }
      } catch {}
    }
    resetNewHolding();
    await refresh();
  };

  const handleEditHolding = async () => {
    if (!showEditHolding || !showEditHolding.ticker.trim()) return;
    const h = showEditHolding;
    if (user && h.id) {
      try {
        await fetch(`${API_URL}/holdings/${h.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: h.ticker,
            name: h.name,
            shares: h.shares,
            avgCost: parseFloat(h.avgCost),
            sector: h.sector,
            market: h.market,
          }),
        });
        await refresh();
      } catch {}
    }
    setShowEditHolding(null);
  };

  const handleDeleteHolding = async (holding: Holding) => {
    if (user && holding.id) {
      try { await fetch(`${API_URL}/holdings/${holding.id}`, { method: "DELETE" }); } catch {}
    }
    await refresh();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadRecommendations()]);
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleGetAdvice = async () => {
    setLoadingAdvice(true);
    setAdviceError(null);
    setShowAdvice(true);
    const allHoldings = holdings.map(h => ({
      ticker: h.ticker,
      name: h.name,
      shares: h.shares,
      avgCost: parseFloat(h.avgCost),
      currentPrice: parseFloat(h.currentPrice || h.avgCost),
      sector: h.sector,
      market: h.market,
    }));
    try {
      const res = await fetch(`${API_URL}/ai/portfolio-advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: allHoldings }),
      });
      if (res.ok) {
        const data = await res.json();
        setPortfolioAdvice(data.advice);
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setAdviceError(err.error || `Request failed (${res.status})`);
      }
    } catch {
      setAdviceError('Network error — server may be down');
    }
    setLoadingAdvice(false);
  };

  // Map broker connection IDs to names for annotating synced holdings
  const brokerNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of brokers) {
      if (b.dbId) map.set(b.dbId, b.accountName || 'Broker');
    }
    return map;
  }, [brokers]);

  const mergedHoldings: (Holding & { _brokerName?: string })[] = useMemo(() => {
    return holdings.map(h => {
      const brokerName = h.brokerConnectionId && h.brokerConnectionId > 0
        ? brokerNameMap.get(h.brokerConnectionId)
        : undefined;
      return brokerName ? { ...h, _brokerName: brokerName } : h;
    });
  }, [holdings, brokerNameMap]);

  const filteredHoldings = (marketFilter === "All" ? mergedHoldings : mergedHoldings.filter(h => h.market === marketFilter)) as (Holding & { _brokerName?: string })[];

  // brokerTotals and enhancedTotals come from context (shared with dashboard)

  const sectorAllocation = holdings.reduce((acc: any[], h) => {
    const existing = acc.find(s => s.sector === h.sector);
    const val = parseFloat(h.value.replace(",", ""));
    if (existing) existing.value += val;
    else acc.push({ sector: h.sector, value: val, color: `#${Math.floor(Math.random()*16777215).toString(16)}` });
    return acc;
  }, [] as any[]).map(s => ({ ...s, pct: totals.combinedKesValue > 0 ? Math.round((s.value / totals.combinedKesValue) * 100) : 0 })).sort((a: any, b: any) => b.value - a.value);

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-gray-900 text-2xl font-semibold">Portfolio Intelligence</h2>
          <p className="text-gray-600">{paperMode ? "Simulate trades with virtual cash" : "Track NSE & global investments, AI insights, and broker integrations"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={paperMode ? "default" : "outline"} onClick={() => { setPaperMode(!paperMode); if (!paperMode) refreshPaper(); }} className={`gap-2 ${paperMode ? "bg-[#0D7490] text-white" : "border-gray-200"}`}>
            <SwitchCamera className="w-4 h-4" /> {paperMode ? "Real Portfolio" : "Paper Trading"}
          </Button>
          <Button variant="outline" onClick={() => navigate('/app/stocks')} className="border-gray-200 gap-2">
            <BarChart3 className="w-4 h-4" /> Screener
          </Button>
          {!paperMode && (
            <>
              <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="border-gray-200 gap-2">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="outline" onClick={handleGetAdvice} className="border-gray-200 gap-2">
                <BrainCircuit className="w-4 h-4" /> AI Advice
              </Button>
              <Button variant="outline" onClick={openStatement} disabled={realStatementLoading} className="border-gray-200 gap-2">
                <BarChartHorizontal className="w-4 h-4" /> Statement
              </Button>
              <Button onClick={() => setShowAddHolding(true)} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                <Plus className="w-4 h-4" /> Add Position
              </Button>
              <Button onClick={() => setShowConnect(true)} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                <Link2 className="w-4 h-4" /> Connect Account
              </Button>
            </>
          )}
        </div>
      </div>

      {paperMode ? (/* Paper Trading Panel */
        <div className="space-y-6">
          {/* Paper trading header actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {["NSE", "Global"].map(m => (
                <button key={m} onClick={() => setPaperOrder({ ...paperOrder, market: m as "NSE" | "Global" })}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${paperOrder.market === m ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  {m === "NSE" ? "NSE Stocks" : "Global Stocks"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={async () => { setStatementLoading(true); const d = await fetchStatement(); if (d) { setStatementData(d); setShowStatement(true); } setStatementLoading(false); }} className="border-gray-200 gap-1" variant="outline">
                <BarChartHorizontal className="w-3.5 h-3.5" /> Statement
              </Button>
              <Button size="sm" onClick={() => { resetPaperOrder(); setShowPaperBuy(true); }} className="bg-green-600 hover:bg-green-700 text-white gap-1">
                <ShoppingCart className="w-3.5 h-3.5" /> Buy
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowPaperReset(true)} className="border-red-200 text-red-600 hover:bg-red-50 gap-1">
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
            </div>
          </div>

          {/* Account Overview */}
          {!paperAccount && !paperLoading ? (
            <Card className="bg-white border-gray-200 p-8 text-center">
              <Play className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Start Paper Trading</h3>
              <p className="text-gray-500 text-sm mb-4">Practice trading with KES 1,000,000 virtual cash. No real money involved.</p>
              <Button onClick={async () => { const ok = await initAccount(); if (ok) refreshPaper(); }} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                <Play className="w-4 h-4" /> Start with KES 1,000,000
              </Button>
            </Card>
          ) : paperLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : paperAccount && (
            <>
              {/* Dashboard Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-white border-gray-200 p-4">
                  <div className="text-gray-600 text-xs mb-1">KES Balance (NSE)</div>
                  <div className="text-gray-900 text-xl font-bold">KES {paperAccount.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-gray-500 text-xs mt-1">Initial: KES {paperAccount.initialCapital.toLocaleString()}</div>
                </Card>
                <Card className="bg-white border-gray-200 p-4">
                  <div className="text-gray-600 text-xs mb-1">USD Balance (Global)</div>
                  <div className="text-gray-900 text-xl font-bold">${paperAccount.cashBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-gray-500 text-xs mt-1">Initial: ${paperAccount.initialCapitalUsd.toLocaleString()}</div>
                </Card>
                <Card className="bg-white border-gray-200 p-4">
                  <div className="text-gray-600 text-xs mb-1">Portfolio Value (KES)</div>
                  <div className="text-gray-900 text-xl font-bold">KES {paperAccount.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-gray-500 text-xs mt-1">Combined (USD at ~{currentFxRate} KES)</div>
                </Card>
                <Card className="bg-white border-gray-200 p-4">
                  <div className="text-gray-600 text-xs mb-1">Total Return</div>
                  <div className={`text-xl font-bold flex items-center gap-1 ${paperAccount.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {paperAccount.totalReturn >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    KES {Math.abs(paperAccount.totalReturn).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className={`text-xs mt-1 ${paperAccount.totalReturnPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {paperAccount.totalReturnPercent >= 0 ? '+' : ''}{paperAccount.totalReturnPercent}% ({paperPositions.length} positions)
                  </div>
                </Card>
              </div>

              {/* Market Status + Fees */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {marketStatus && ["nse", "global"].map((m) => {
                    const s = marketStatus[m as "nse" | "global"];
                    return (
                      <div key={m} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.open ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500 border border-gray-200"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.open ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                        {m.toUpperCase()}: {s.label}
                      </div>
                    );
                  })}
                </div>
                {paperAccount.totalFeesPaid > 0 && (
                  <div className="text-xs text-gray-400">
                    Total fees paid: KES {paperAccount.totalFeesPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>

              {/* Positions Table */}
              <Card className="bg-white border-gray-200 p-6">
                <h3 className="text-gray-900 font-semibold mb-4">Open Positions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left text-gray-600 py-3 px-2 font-medium">Stock</th>
                        <th className="text-center text-gray-600 py-3 px-2 font-medium">Market</th>
                        <th className="text-right text-gray-600 py-3 px-2 font-medium">Shares</th>
                        <th className="text-right text-gray-600 py-3 px-2 font-medium">Avg Cost</th>
                        <th className="text-right text-gray-600 py-3 px-2 font-medium">Current</th>
                        <th className="text-right text-gray-600 py-3 px-2 font-medium">Value</th>
                        <th className="text-right text-gray-600 py-3 px-2 font-medium">P/L</th>
                        <th className="text-center text-gray-600 py-3 px-2 font-medium w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paperPositions.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-gray-400 text-sm">No open positions. Buy a stock to start paper trading.</td>
                        </tr>
                      ) : (
                        paperPositions.map((p) => (
                          <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-2">
                              <button onClick={() => navigate(`/app/stock/${p.ticker}`)} className="text-left hover:text-[#0D7490] transition-colors">
                                <div className="text-gray-900 font-semibold">{p.ticker}</div>
                                <div className="text-gray-500 text-xs">{p.name}</div>
                              </button>
                            </td>
                            <td className="text-center py-3 px-2">
                              <Badge variant="outline" className={`text-[10px] ${p.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{p.market}</Badge>
                            </td>
                            <td className="text-right text-gray-900 py-3 px-2">{p.shares}</td>
                            <td className="text-right text-gray-900 py-3 px-2">{p.market === "NSE" ? "KES " : "$"}{p.avgCost}</td>
                            <td className="text-right text-gray-900 py-3 px-2">{p.market === "NSE" ? "KES " : "$"}{p.currentPrice}</td>
                            <td className="text-right text-gray-900 py-3 px-2 font-medium">{p.market === "NSE" ? "KES " : "$"}{p.value}</td>
                            <td className="text-right py-3 px-2">
                              <span className={`flex items-center gap-1 justify-end font-medium ${parseFloat(p.pnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {parseFloat(p.pnl) >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                {p.market === "NSE" ? "KES " : "$"}{p.pnl} ({p.pnlPercent}%)
                              </span>
                            </td>
                            <td className="text-center py-3 px-2">
                              <button onClick={() => { setPaperOrder(prev => ({ ...prev, shares: "" })); setShowPaperSell(p); }} className="p-1.5 hover:bg-red-50 rounded transition-colors" title="Sell">
                                <DollarSignIcon className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Trade History */}
              <Card className="bg-white border-gray-200 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <History className="w-5 h-5 text-[#0D7490]" />
                  <h3 className="text-gray-900 font-semibold">Trade History</h3>
                </div>
                {paperTrades.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-sm">No trades yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left text-gray-600 py-2 px-2 font-medium">Date</th>
                          <th className="text-left text-gray-600 py-2 px-2 font-medium">Stock</th>
                          <th className="text-center text-gray-600 py-2 px-2 font-medium">Type</th>
                          <th className="text-right text-gray-600 py-2 px-2 font-medium">Shares</th>
                          <th className="text-right text-gray-600 py-2 px-2 font-medium">Price</th>
                          <th className="text-right text-gray-600 py-2 px-2 font-medium">Total</th>
                          <th className="text-right text-gray-600 py-2 px-2 font-medium">Fees</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paperTrades.map((t) => (
                          <tr key={t.id} className="border-b border-gray-100">
                            <td className="py-2 px-2 text-gray-500 text-xs">{new Date(t.created_at).toLocaleDateString()} {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="py-2 px-2">
                              <span className="text-gray-900 font-medium">{t.ticker}</span>
                              <span className="text-gray-400 text-xs ml-1">{t.name}</span>
                            </td>
                            <td className="text-center py-2 px-2">
                              <Badge className={`text-[10px] ${t.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {t.type.toUpperCase()}
                              </Badge>
                            </td>
                            <td className="text-right text-gray-900 py-2 px-2">{t.shares}</td>
                            <td className="text-right text-gray-900 py-2 px-2">{t.currency === "USD" ? "$" : "KES "}{parseFloat(t.price).toFixed(2)}</td>
                            <td className="text-right text-gray-900 py-2 px-2 font-medium">{t.currency === "USD" ? "$" : "KES "}{parseFloat(t.total_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="text-right text-gray-500 py-2 px-2 text-xs">{t.currency === "USD" ? "$" : "KES "}{(parseFloat(t.commission || "0") + parseFloat(t.fees || "0")).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}

          {/* Buy Dialog */}
          <Dialog open={showPaperBuy} onOpenChange={(v) => { setShowPaperBuy(v); if (!v) { resetPaperOrder(); setOrderError(null); } else setOrderError(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Place Buy Order</DialogTitle>
                <DialogDescription>
                  {paperOrder.market === "NSE" ? "NSE board lot: 100 shares (multiples of 100). Commission ~0.3% + statutory fees 0.12%." : "Global stocks: $0.005/share commission (min $1). SEC fees apply."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {/* Market status */}
                {marketStatus && (() => {
                  const s = marketStatus[paperOrder.market === "NSE" ? "nse" : "global"];
                  return (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${s.open ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      <span className={`w-2 h-2 rounded-full ${s.open ? "bg-green-500 animate-pulse" : "bg-red-400"}`} />
                      {paperOrder.market} {s.label} ({s.openTime} - {s.closeTime})
                    </div>
                  );
                })()}
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 flex items-center gap-2">
                  <DollarSignIcon className="w-3.5 h-3.5" />
                  Trading in <strong>{paperOrder.market === "NSE" ? "KES" : "USD"}</strong>
                  {paperOrder.market !== "NSE" && <span>(1 USD ≈ {currentFxRate} KES)</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div ref={paperSearchRef} className="relative">
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Ticker *</label>
                    <Input placeholder="e.g., SCOM" value={paperOrder.ticker} onChange={(e) => setPaperOrder({ ...paperOrder, ticker: e.target.value.toUpperCase() })} className="bg-white border-gray-200" />
                    {paperSearchResults.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {paperSearchResults.map((s) => (
                          <button key={s.ticker} type="button" onClick={async () => { 
                            setPaperSearchResults([]);
                            setPaperOrder(prev => ({ ...prev, ticker: s.ticker, name: s.name, sector: s.sector, market: s.market as "NSE" | "Global" }));
                            try {
                              const marketParam = s.market === "NSE" ? "?market=nse" : "";
                              const res = await fetch(`${API_URL}/stock/${s.ticker}${marketParam}`);
                              if (res.ok) {
                                const data = await res.json();
                                if (data?.price) setPaperOrder(prev => ({ ...prev, currentPrice: String(data.price) }));
                              }
                            } catch {}
                          }} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between">
                            <div>
                              <span className="font-medium text-gray-900">{s.ticker}</span>
                              <span className="text-gray-500 text-sm ml-2">{s.name}</span>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${s.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{s.market}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    {paperSearching && <div className="absolute right-3 top-9"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /></div>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Market</label>
                    <Select value={paperOrder.market} onValueChange={(v) => setPaperOrder({ ...paperOrder, market: v as "NSE" | "Global" })}>
                      <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NSE">NSE (KES · 100-share lot)</SelectItem>
                        <SelectItem value="Global">Global (USD · 1-share min)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Company Name</label>
                  <Input placeholder="e.g., Safaricom PLC" value={paperOrder.name} onChange={(e) => setPaperOrder({ ...paperOrder, name: e.target.value })} className="bg-white border-gray-200" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Shares *</label>
                  <Input type="number" step={paperOrder.market === "NSE" ? "100" : "1"} min={paperOrder.market === "NSE" ? "100" : "1"}
                    placeholder={paperOrder.market === "NSE" ? "e.g., 100, 200, 500" : "e.g., 10"}
                    value={paperOrder.shares} onChange={(e) => setPaperOrder({ ...paperOrder, shares: e.target.value })} className="bg-white border-gray-200" />
                  {paperOrder.market === "NSE" && <p className="text-xs text-gray-400 mt-1">NSE minimum: 100 shares (board lot)</p>}
                </div>
                {paperOrder.currentPrice && (
                  <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm flex items-center justify-between">
                    <span className="text-green-700 font-medium">Current price: {paperOrder.market === "NSE" ? "KES " : "$"}{parseFloat(paperOrder.currentPrice).toFixed(2)}</span>
                    <span className="text-green-600 text-xs">Live market data</span>
                  </div>
                )}
                {/* Available cash preview */}
                {paperAccount && paperOrder.shares && parseFloat(paperOrder.shares) > 0 && (() => {
                  const currencyLabel = paperOrder.market === "NSE" ? "KES" : "USD";
                  const available = paperOrder.market === "NSE" ? paperAccount.cashBalance : paperAccount.cashBalanceUsd;
                  return (
                    <div className="p-3 rounded-lg bg-gray-50 border text-sm space-y-1">
                      <div className="flex justify-between text-gray-600">
                        <span>Available {currencyLabel}</span>
                        <span className="font-medium text-gray-900">{currencyLabel === "KES" ? "KES " : "$"}{available.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Est. commission & fees</span>
                        <span className="text-gray-700">{currencyLabel === "KES" ? "KES " : "$"}Calculated at execution</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowPaperBuy(false); resetPaperOrder(); }} className="border-gray-200">Cancel</Button>
                {orderError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{orderError}</div>
                )}
                <Button onClick={async () => {
                  setOrderError(null);
                  const shares = parseFloat(paperOrder.shares);
                  if (!paperOrder.ticker.trim() || !shares || shares <= 0) return;
                  if (paperOrder.market === "NSE" && shares % 100 !== 0) return;
                  const result = await placeOrder({ ticker: paperOrder.ticker, name: paperOrder.name, shares, type: "buy", market: paperOrder.market, sector: paperOrder.sector });
                  if (result.success) { setShowPaperBuy(false); resetPaperOrder(); setOrderError(null); }
                  else if (result.error) setOrderError(result.error);
                }} disabled={!paperOrder.ticker.trim() || !paperOrder.shares || parseFloat(paperOrder.shares) <= 0 || (paperOrder.market === "NSE" && parseFloat(paperOrder.shares) % 100 !== 0) || paperPlacingOrder} className="bg-green-600 hover:bg-green-700 text-white gap-2">
                  {paperPlacingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Buy
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Sell Dialog */}
          <Dialog open={!!showPaperSell} onOpenChange={(v) => { if (!v) { setShowPaperSell(null); setOrderError(null); } else setOrderError(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Sell {showPaperSell?.ticker}</DialogTitle>
                <DialogDescription>
                  You hold {showPaperSell?.shares} shares. Commission and fees are deducted from proceeds.
                </DialogDescription>
              </DialogHeader>
              {showPaperSell && (
                <div className="space-y-4 py-2">
                  {marketStatus && (() => {
                    const s = marketStatus[showPaperSell.market === "NSE" ? "nse" : "global"];
                    return (
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${s.open ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        <span className={`w-2 h-2 rounded-full ${s.open ? "bg-green-500 animate-pulse" : "bg-red-400"}`} />
                        {showPaperSell.market} {s.label}
                      </div>
                    );
                  })()}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Shares to Sell</label>
                    <Input type="number" step={showPaperSell.market === "NSE" ? "100" : "1"} min="1" max={showPaperSell.shares} placeholder={`Max ${showPaperSell.shares}`}
                      value={paperOrder.shares} onChange={(e) => setPaperOrder({ ...paperOrder, shares: e.target.value })} className="bg-white border-gray-200" />
                    {showPaperSell.market === "NSE" && <p className="text-xs text-gray-400 mt-1">NSE must sell in multiples of 100 shares</p>}
                  </div>
                  {showPaperSell && paperOrder.shares && parseFloat(paperOrder.shares) > 0 && (
                    <div className="p-3 rounded-lg bg-gray-50 border text-sm space-y-1">
                      <div className="flex justify-between text-gray-600">
                        <span>Position value</span>
                        <span className="font-medium text-gray-900">{showPaperSell.market === "NSE" ? "KES " : "$"}{showPaperSell.value}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Avg cost</span>
                        <span className="text-gray-700">{showPaperSell.market === "NSE" ? "KES " : "$"}{showPaperSell.avgCost}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Est. fees deducted</span>
                        <span className="text-gray-700">Commission + statutory</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowPaperSell(null); setPaperOrder({ ...paperOrder, shares: "" }); }} className="border-gray-200">Cancel</Button>
                {orderError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{orderError}</div>
                )}
                <Button onClick={async () => {
                  setOrderError(null);
                  const shares = parseFloat(paperOrder.shares);
                  if (!shares || shares <= 0 || !showPaperSell) return;
                  const result = await placeOrder({ ticker: showPaperSell.ticker, name: showPaperSell.name, shares, type: "sell", market: showPaperSell.market, sector: showPaperSell.sector });
                  if (result.success) { setShowPaperSell(null); setPaperOrder(prev => ({ ...prev, shares: "" })); setOrderError(null); }
                  else if (result.error) setOrderError(result.error);
                }} disabled={!paperOrder.shares || parseFloat(paperOrder.shares) <= 0 || (showPaperSell?.market === "NSE" && parseFloat(paperOrder.shares) % 100 !== 0) || paperPlacingOrder} className="bg-red-600 hover:bg-red-700 text-white gap-2">
                  {paperPlacingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSignIcon className="w-4 h-4" />} Sell
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Reset Dialog */}
          <Dialog open={showPaperReset} onOpenChange={setShowPaperReset}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Reset Paper Account</DialogTitle>
                <DialogDescription>This will delete all positions and trade history, and start with a fresh KES 1,000,000 balance.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPaperReset(false)} className="border-gray-200">Cancel</Button>
                <Button onClick={async () => {
                  await resetAccount();
                  setShowPaperReset(false);
                }} className="bg-red-600 hover:bg-red-700 text-white gap-2">
                  <RotateCcw className="w-4 h-4" /> Reset
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Statement Dialog */}
          <Dialog open={showStatement} onOpenChange={setShowStatement}>
            <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BarChartHorizontal className="w-5 h-5 text-[#0D7490]" />
                  Trading Statement
                </DialogTitle>
                <DialogDescription>
                  {statementData ? `Generated ${new Date(statementData.generatedAt).toLocaleString()}` : 'Loading...'}
                </DialogDescription>
              </DialogHeader>
              {statementData && (
                <div className="space-y-6" id="statement-content">
                  {/* Account Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg border text-center">
                      <div className="text-xs text-gray-500">KES Balance</div>
                      <div className="text-lg font-bold text-gray-900">KES {statementData.account.cashBalanceKes.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="text-xs text-gray-400">From KES {statementData.account.initialCapitalKes.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-lg border text-center">
                      <div className="text-xs text-gray-500">USD Balance</div>
                      <div className="text-lg font-bold text-gray-900">${statementData.account.cashBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="text-xs text-gray-400">From ${statementData.account.initialCapitalUsd.toLocaleString()}</div>
                    </div>
                    <div className="p-3 rounded-lg border text-center">
                      <div className="text-xs text-gray-500">Total Trades</div>
                      <div className="text-lg font-bold text-gray-900">{statementData.summary.totalTrades}</div>
                      <div className="text-xs text-gray-400">{statementData.summary.buyTrades} buys · {statementData.summary.sellTrades} sells</div>
                    </div>
                    <div className="p-3 rounded-lg border text-center">
                      <div className="text-xs text-gray-500">Open Positions</div>
                      <div className="text-lg font-bold text-gray-900">{statementData.summary.openPositions}</div>
                      <div className="text-xs text-gray-400">Currently held</div>
                    </div>
                  </div>

                  {/* Fees & P&L */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-gray-50 border text-sm">
                      <div className="text-xs text-gray-500 mb-1">KES Fees Paid</div>
                      <div className="font-semibold text-gray-900">KES {statementData.summary.totalCommissionKes.toFixed(2)} commission + KES {statementData.summary.totalFeesKes.toFixed(2)} fees</div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border text-sm">
                      <div className="text-xs text-gray-500 mb-1">USD Fees Paid</div>
                      <div className="font-semibold text-gray-900">${statementData.summary.totalCommissionUsd.toFixed(2)} commission + ${statementData.summary.totalFeesUsd.toFixed(2)} fees</div>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border text-sm">
                      <div className="text-xs text-gray-500 mb-1">Realized P&L</div>
                      <div className={`font-semibold ${statementData.summary.realizedPnlKes >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        KES {statementData.summary.realizedPnlKes.toFixed(2)}
                      </div>
                      <div className={`text-xs ${statementData.summary.realizedPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        USD {statementData.summary.realizedPnlUsd.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Trade History */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 text-sm">Trade History ({statementData.trades.length} trades)</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-1 px-1 text-gray-500">Date</th>
                            <th className="text-left py-1 px-1 text-gray-500">Ticker</th>
                            <th className="text-center py-1 px-1 text-gray-500">Type</th>
                            <th className="text-right py-1 px-1 text-gray-500">Shares</th>
                            <th className="text-right py-1 px-1 text-gray-500">Price</th>
                            <th className="text-right py-1 px-1 text-gray-500">Total</th>
                            <th className="text-right py-1 px-1 text-gray-500">Commission</th>
                            <th className="text-right py-1 px-1 text-gray-500">Fees</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statementData.trades.map((t: any) => (
                            <tr key={t.id} className="border-b border-gray-100">
                              <td className="py-1 px-1 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                              <td className="py-1 px-1 font-medium text-gray-900">{t.ticker}</td>
                              <td className="text-center py-1 px-1">
                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${t.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {t.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="text-right py-1 px-1">{t.shares}</td>
                              <td className="text-right py-1 px-1">{t.currency === 'USD' ? '$' : 'KES '}{t.price.toFixed(2)}</td>
                              <td className="text-right py-1 px-1 font-medium">{t.currency === 'USD' ? '$' : 'KES '}{t.totalValue.toFixed(2)}</td>
                              <td className="text-right py-1 px-1 text-gray-500">{t.currency === 'USD' ? '$' : 'KES '}{t.commission.toFixed(2)}</td>
                              <td className="text-right py-1 px-1 text-gray-500">{t.currency === 'USD' ? '$' : 'KES '}{t.fees.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Open Positions */}
                  {statementData.openPositions.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-2 text-sm">Open Positions ({statementData.openPositions.length})</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1 px-1 text-gray-500">Ticker</th>
                              <th className="text-right py-1 px-1 text-gray-500">Shares</th>
                              <th className="text-right py-1 px-1 text-gray-500">Avg Cost</th>
                              <th className="text-right py-1 px-1 text-gray-500">Current</th>
                              <th className="text-right py-1 px-1 text-gray-500">Value</th>
                              <th className="text-right py-1 px-1 text-gray-500">P&L</th>
                              <th className="text-right py-1 px-1 text-gray-500">Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statementData.openPositions.map((p: any, i: number) => (
                              <tr key={i} className="border-b border-gray-100">
                                <td className="py-1 px-1 font-medium text-gray-900">{p.ticker}</td>
                                <td className="text-right py-1 px-1">{p.shares}</td>
                                <td className="text-right py-1 px-1">{p.market === 'NSE' ? 'KES ' : '$'}{p.avgCost.toFixed(2)}</td>
                                <td className="text-right py-1 px-1">{p.market === 'NSE' ? 'KES ' : '$'}{p.currentPrice.toFixed(2)}</td>
                                <td className="text-right py-1 px-1 font-medium">{p.market === 'NSE' ? 'KES ' : '$'}{p.value.toFixed(2)}</td>
                                <td className={`text-right py-1 px-1 ${p.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{p.market === 'NSE' ? 'KES ' : '$'}{p.pnl.toFixed(2)}</td>
                                <td className={`text-right py-1 px-1 ${p.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{p.pnlPercent.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {statementLoading && (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => window.print()} className="border-gray-200 gap-1">
                  <BarChartHorizontal className="w-4 h-4" /> Print
                </Button>
                <Button variant="outline" onClick={() => setShowStatement(false)} className="border-gray-200">Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}

      {!paperMode && (<React.Fragment>

      {/* Connected Brokers */}
      {brokers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {brokers.map(b => (
            <div key={b.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
              b.syncStatus === "error" ? "bg-red-50 border-red-200" :
              b.syncStatus === "syncing" ? "bg-blue-50 border-blue-200" :
              "bg-green-50 border-green-200"
            }`}>
              {b.syncStatus === "syncing" ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              ) : b.syncStatus === "error" ? (
                <AlertCircle className="w-4 h-4 text-red-600" />
              ) : (
                <Check className="w-4 h-4 text-green-600" />
              )}
              <span className={b.syncStatus === "error" ? "text-red-700 font-medium" : "text-green-700 font-medium"}>{b.accountName}</span>
              <span className="text-gray-400 text-[10px]">
                {b.accountType && `${b.accountType}`}{b.platform ? ` - ${b.platform}` : ''}{b.server ? ` @ ${b.server}` : ''}
              </span>
              {(b.latestSnapshot || b.accountInfo?.balance != null || b.accountInfo?.positionsCount != null) && (
                <span className="text-gray-600 text-xs font-medium">
                  Bal: {((b.latestSnapshot?.balance ?? b.accountInfo?.balance) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  Eq: {((b.latestSnapshot?.equity ?? b.accountInfo?.equity) ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {b.latestSnapshot?.positions?.length ?? b.accountInfo?.positionsCount ?? 0} pos
                </span>
              )}
              {b.lastSyncAt && (
                <span className="text-gray-400 text-[10px]">{new Date(b.lastSyncAt).toLocaleDateString()} {new Date(b.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
              {b.dbId && (
                <button onClick={() => handleSyncBroker(b)} disabled={b.syncStatus === "syncing"} className={`p-1 hover:bg-gray-100 rounded ml-1 ${b.syncStatus === "syncing" ? 'opacity-50 cursor-not-allowed' : ''}`} title="Sync now">
                  <RefreshCw className={`w-3 h-3 text-gray-500 ${b.syncStatus === "syncing" ? 'animate-spin' : ''}`} />
                </button>
              )}
              <button onClick={() => { setSelectedBroker(b); setShowBrokerDetail(true); }} className="p-1 hover:bg-gray-100 rounded" title="View details">
                <BarChart3 className="w-3 h-3 text-gray-500" />
              </button>
              <button onClick={() => handleDisconnectBroker(b.id, b.dbId)} className="p-1 hover:bg-red-100 rounded" title="Disconnect">
                <Unlink className="w-3 h-3 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">Total Value (KES)</div>
          <div className="text-gray-900 text-xl font-bold">KES {enhancedTotals.combinedKesValue.toLocaleString()}</div>
          <div className="text-gray-500 text-xs mt-1">NSE: KES {totals.nseValue.toLocaleString()} &middot; Global: ${enhancedTotals.globalValue.toFixed(2)} @ {totals.fxRate.toFixed(2)}</div>
        </Card>
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">NSE Portfolio</div>
          <div className="text-gray-900 text-xl font-bold">KES {totals.nseValue.toLocaleString()}</div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${totals.nsePnLPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totals.nsePnLPercent >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {totals.nsePnLPercent >= 0 ? '+' : ''}{totals.nsePnLPercent}% ({totals.nseCount} holdings)
          </div>
        </Card>
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">Global Portfolio</div>
          <div className="text-gray-900 text-xl font-bold">${enhancedTotals.globalValue.toFixed(2)}</div>
          <div className={`text-xs mt-1 flex items-center gap-1 ${enhancedTotals.globalPnLPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {enhancedTotals.globalPnLPercent >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {enhancedTotals.globalPnLPercent >= 0 ? '+' : ''}{enhancedTotals.globalPnLPercent}% ({brokerTotals.posCount} pos)
          </div>
        </Card>
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">Total Return</div>
          <div className={`text-xl font-bold flex items-center gap-1 ${enhancedTotals.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {enhancedTotals.totalPnL >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            {enhancedTotals.totalPnL >= 0 ? '+' : ''}KES {Math.abs(enhancedTotals.totalPnL).toLocaleString()}
          </div>
          <div className={`text-xs mt-1 ${enhancedTotals.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {enhancedTotals.pnlPercent >= 0 ? '+' : ''}{enhancedTotals.pnlPercent}% overall return
          </div>
        </Card>
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">Holdings</div>
          <div className="text-gray-900 text-xl font-bold">{mergedHoldings.length}</div>
          <div className="text-gray-500 text-xs mt-1">{totals.nseCount} NSE · {enhancedTotals.globalCount} Global</div>
        </Card>
        <Card className="bg-white border-gray-200 p-4">
          <div className="text-gray-600 text-xs mb-1">Connected</div>
          <div className="text-gray-900 text-xl font-bold">{brokerTotals.activeBrokerCount}</div>
          <div className="text-gray-500 text-xs mt-1">{brokerTotals.activeBrokerCount > 0 ? "Accounts linked" : "Not linked"}</div>
        </Card>
      </div>

      {/* Market Filter + Add */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {["All", "NSE", "Global"].map(m => (
            <button key={m} onClick={() => setMarketFilter(m as any)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${marketFilter === m ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {m === "All" ? "All Markets" : m === "NSE" ? "NSE Stocks" : "Global Stocks"}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowAddHolding(true)} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-1">
          <Plus className="w-3.5 h-3.5" /> Add Position
        </Button>
      </div>

      {/* Holdings Table */}
      <Card className="bg-white border-gray-200 p-6">
        <h3 className="text-gray-900 font-semibold mb-4">Holdings</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-gray-600 py-3 px-2 font-medium">Stock</th>
                <th className="text-center text-gray-600 py-3 px-2 font-medium">Market</th>
                <th className="text-right text-gray-600 py-3 px-2 font-medium">Shares</th>
                <th className="text-right text-gray-600 py-3 px-2 font-medium">Avg Cost</th>
                <th className="text-right text-gray-600 py-3 px-2 font-medium">Current</th>
                <th className="text-right text-gray-600 py-3 px-2 font-medium">Value</th>
                <th className="text-right text-gray-600 py-3 px-2 font-medium">P/L</th>
                <th className="text-center text-gray-600 py-3 px-2 font-medium w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400 text-sm">No holdings yet. {brokers.length > 0 ? 'Sync your broker accounts to see positions here.' : 'Add your first position or connect a broker account to start tracking.'}</td>
                </tr>
              ) : (
                filteredHoldings.map((h: any) => (
                  <tr key={`${h.ticker}-${h._brokerName || h.market}-${h.shares || '0'}-${h.avgCost || '0'}-${h.pnl || '0'}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-2">
                      {h._brokerName ? (
                        <div className="text-left">
                          <div className="text-gray-900 font-semibold">{h.ticker}</div>
                          <div className="text-gray-500 text-xs">{h.name}</div>
                          <Badge className="bg-blue-100 text-blue-700 text-[9px] px-1 py-0.5 mt-0.5">Synced</Badge>
                        </div>
                      ) : (
                        <button onClick={() => navigate(`/app/stock/${h.ticker}`)} className="text-left hover:text-[#0D7490] transition-colors">
                          <div className="text-gray-900 font-semibold">{h.ticker}</div>
                          <div className="text-gray-500 text-xs">{h.name}</div>
                          <div className="text-gray-400 text-xs">{h.sector}</div>
                        </button>
                      )}
                    </td>
                    <td className="text-center py-3 px-2">
                      {h._brokerName ? (
                        <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600" title={h._brokerName}>
                          {h._brokerName}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={`text-[10px] ${h.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>
                          {h.market}
                        </Badge>
                      )}
                    </td>
                    <td className="text-right text-gray-900 py-3 px-2">{h.shares}</td>
                    <td className="text-right text-gray-900 py-3 px-2">{h.market === "NSE" ? "KES " : "$"}{h.avgCost}</td>
                    <td className="text-right text-gray-900 py-3 px-2">{h.market === "NSE" ? "KES " : "$"}{h.currentPrice || h.avgCost}</td>
                    <td className="text-right text-gray-900 py-3 px-2 font-medium">{h.market === "NSE" ? "KES " : "$"}{h.value}</td>
                    <td className="text-right py-3 px-2">
                      <span className={`flex items-center gap-1 justify-end font-medium ${h.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {h.isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {h.pnl}
                      </span>
                    </td>
                    <td className="text-center py-3 px-2">
                      {h._brokerName ? (
                        <span className="text-gray-400 text-xs">Auto</span>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setShowEditHolding({ ...h })} className="p-1.5 hover:bg-gray-100 rounded transition-colors" title="Edit">
                            <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                          </button>
                          <button onClick={() => handleDeleteHolding(h)} className="p-1.5 hover:bg-red-50 rounded transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Trade History */}
      {brokers.length > 0 && (
        <Card className="bg-white border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-900 font-semibold flex items-center gap-2">
              <History className="w-5 h-5 text-[#0D7490]" />
              Trade History
            </h3>
            <Badge variant="outline" className="text-xs border-gray-300 text-gray-500">
              {brokers.reduce((sum, b) => sum + (b.latestSnapshot?.trade_history?.length || 0), 0)} trades
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  {['Account', 'Time', 'Ticket', 'Type', 'Volume', 'Symbol', 'Price', 'Close', 'Profit', 'Commission'].map(h => (
                    <th key={h} className={`${h === 'Time' || h === 'Type' || h === 'Account' || h === 'Symbol' ? 'text-left' : 'text-right'} text-gray-600 py-3 px-2 font-medium`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brokers.filter(b => b.latestSnapshot?.trade_history?.length).length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-gray-400 text-sm">No trade history from connected brokers</td>
                  </tr>
                ) : (
                  [...brokers].flatMap(b =>
                    (b.latestSnapshot?.trade_history || []).map((trade: any, i: number) => ({ ...trade, _brokerName: b.accountName, _sortTime: trade.time || '' })))
                    .sort((a, b) => b._sortTime.localeCompare(a._sortTime))
                    .map((trade, i) => {
                      const profit = parseFloat(trade.profit || '0');
                      return (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2.5 px-2">
                            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">{trade._brokerName}</Badge>
                          </td>
                          <td className="py-2.5 px-2 text-gray-500 whitespace-nowrap text-xs">{trade.time || '-'}</td>
                          <td className="text-right py-2.5 px-2 text-gray-700 text-xs">{trade.ticket || '-'}</td>
                          <td className="py-2.5 px-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              (trade.type || '').toLowerCase() === 'buy' ? 'bg-green-100 text-green-700' :
                              (trade.type || '').toLowerCase() === 'sell' ? 'bg-red-100 text-red-700' :
                              (trade.type || '').toLowerCase() === 'balance' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {trade.type || '-'}
                            </span>
                          </td>
                          <td className="text-right py-2.5 px-2 text-gray-900">{trade.volume || '-'}</td>
                          <td className="py-2.5 px-2 font-medium text-gray-900">{trade.symbol || '-'}</td>
                          <td className="text-right py-2.5 px-2 text-gray-900">{trade.price || '-'}</td>
                          <td className="text-right py-2.5 px-2 text-gray-900">{trade.price_2 || '-'}</td>
                          <td className="text-right py-2.5 px-2">
                            <span className={`flex items-center gap-1 justify-end font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {profit >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                              {trade.profit || '0'}
                            </span>
                          </td>
                          <td className="text-right py-2.5 px-2 text-gray-500 text-xs">{trade.commission || '-'}</td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* AI Recommendations + Charts + Advice */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Recommendations */}
        <Card className="bg-white border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#0D7490]" />
              <h3 className="text-gray-900 font-semibold">AI Recommendations</h3>
            </div>
            <button onClick={handleRefresh} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Refresh signals">
              <RefreshCw className={`w-4 h-4 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {loadingRecs ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : recommendations.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No AI recommendations available yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {recommendations.slice(0, 10).map((rec, i) => {
                const sig = rec.signal || rec.signal;
                return (
                  <div key={i} className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
                    sig === "Strong Buy" || sig === "Buy" ? "border-green-200 bg-green-50" :
                    sig === "Strong Sell" || sig === "Sell" ? "border-red-200 bg-red-50" :
                    "border-yellow-200 bg-yellow-50"
                  }`} onClick={() => { setSelectedRec(rec); setShowRecDialog(true); }}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${
                          sig === "Strong Buy" || sig === "Buy" ? "bg-green-600" :
                          sig === "Strong Sell" || sig === "Sell" ? "bg-red-600" :
                          "bg-yellow-500"
                        }`}>{sig}</span>
                        <span className="text-gray-900 font-semibold">{rec.symbol || rec.ticker}</span>
                        {rec.name && <span className="text-gray-500 text-xs hidden md:inline">{rec.name}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {rec.market && (
                          <Badge variant="outline" className={`text-[9px] px-1 ${rec.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>
                            {rec.market}
                          </Badge>
                        )}
                        <span className="text-xs text-gray-500">{rec.confidence}</span>
                      </div>
                    </div>
                    {rec.reason && <p className="text-gray-600 text-xs mt-1 line-clamp-2">{rec.reason}</p>}
                    {rec.target1 && <p className="text-gray-400 text-xs mt-1">Target: {rec.currency === "USD" ? "$" : "KES "}{rec.target1}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Sector Allocation */}
        <Card className="bg-white border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="w-5 h-5 text-[#0D7490]" />
            <h3 className="text-gray-900 font-semibold">Sector Allocation</h3>
          </div>
          {sectorAllocation.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No holdings to display allocation.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <RePieChart>
                  <Pie data={sectorAllocation} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {sectorAllocation.map((_: any, i: number) => (
                      <Cell key={i} fill={sectorAllocation[i].color} />
                    ))}
                  </Pie>
                </RePieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-2">
                {sectorAllocation.map((item: any) => (
                  <div key={item.sector} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }}></div>
                      <span className="text-gray-700 text-sm">{item.sector}</span>
                    </div>
                    <span className="text-gray-900 text-sm font-medium">{item.pct}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* AI Portfolio Advice */}
        <Card className="bg-white border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]">
                <BrainCircuit className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-gray-900 font-semibold">AI Portfolio Advice</h3>
            </div>
            <Button size="sm" variant="outline" onClick={handleGetAdvice} className="border-gray-200 gap-1">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAdvice ? 'animate-spin' : ''}`} />
              Analyze
            </Button>
          </div>
          {!portfolioAdvice ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 flex items-center justify-center">
                <BrainCircuit className="w-6 h-6 text-[#0D7490]/40" />
              </div>
              <p className="font-medium text-gray-500 mb-1">Ready when you are</p>
              <p>Click <span className="text-[#0D7490] font-medium">Analyze</span> for AI-powered rebalancing advice</p>
            </div>
          ) : loadingAdvice ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[#0D7490]" /></div>
          ) : (
            <div className="space-y-4">
              {/* Summary with gradient bg */}
              <div className="bg-gradient-to-r from-[#0D7490]/5 to-[#0EA5E9]/5 rounded-lg p-3 border border-[#0D7490]/10">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-[#0D7490] mt-0.5 shrink-0" />
                  <p className="text-sm text-gray-700 leading-relaxed">{portfolioAdvice.summary}</p>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Diversification</div>
                  <div className={`text-2xl font-bold ${portfolioAdvice.diversification.score >= 70 ? 'text-emerald-600' : portfolioAdvice.diversification.score >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                    {portfolioAdvice.diversification.score}%
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${portfolioAdvice.diversification.score >= 70 ? 'bg-emerald-500' : portfolioAdvice.diversification.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${portfolioAdvice.diversification.score}%` }} />
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Risk Level</div>
                  <div className={`text-lg font-bold ${portfolioAdvice.riskAssessment.startsWith('Low') ? 'text-emerald-600' : portfolioAdvice.riskAssessment.startsWith('Moderate') ? 'text-amber-600' : 'text-red-600'}`}>
                    {portfolioAdvice.riskAssessment.split(' —')[0]}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400 leading-tight">
                    {portfolioAdvice.riskAssessment.includes('—') ? portfolioAdvice.riskAssessment.split('— ')[1].substring(0, 40) + '...' : ''}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Positions</div>
                  <div className="text-2xl font-bold text-gray-900">{portfolioAdvice.recommendations.length}</div>
                  <div className="mt-1 text-[11px] text-gray-400">
                    {portfolioAdvice.recommendations.filter(r => r.action === 'Accumulate').length} buys &middot; {portfolioAdvice.recommendations.filter(r => r.action === 'Reduce' || r.action === 'Trim' || r.action === 'Take Partial Profits').length} sells
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {portfolioAdvice.recommendations.map((rec, i) => {
                  const act = rec.action;
                  const isBuy = act === 'Accumulate';
                  const isSell = act === 'Reduce' || act === 'Trim' || act === 'Take Partial Profits';
                  const allocNum = parseInt(rec.allocation);
                  return (
                    <div key={i} className={`p-3 rounded-lg border-l-4 text-sm ${
                      isBuy ? 'border-l-emerald-500 border-green-100 bg-green-50/50' :
                      isSell ? 'border-l-red-500 border-red-100 bg-red-50/50' :
                      'border-l-gray-400 border-gray-200 bg-gray-50/50'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => navigate(`/app/stock/${rec.ticker}`)} className="font-semibold text-gray-900 hover:text-[#0D7490]">{rec.ticker}</button>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold text-white ${
                            isBuy ? 'bg-emerald-600' : isSell ? 'bg-red-600' : 'bg-gray-500'
                          }`}>{rec.action}</span>
                        </div>
                        <span className="text-[11px] text-gray-500 font-medium">{rec.allocation} <span className="text-gray-300">→</span> {rec.targetAllocation}</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{rec.reason}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${isBuy ? 'bg-emerald-500' : isSell ? 'bg-red-500' : 'bg-gray-400'}`}
                            style={{ width: `${Math.min(100, allocNum)}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-400 font-medium shrink-0">P/L: {rec.pnlPct}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Add Holding Dialog */}
      <Dialog open={showAddHolding} onOpenChange={(v) => { setShowAddHolding(v); if (!v) resetNewHolding(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Position</DialogTitle>
            <DialogDescription>Add a stock holding to your portfolio.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div ref={searchRef} className="relative">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Ticker *</label>
                <Input placeholder="e.g., SCOM" value={newHolding.ticker} onChange={(e) => setNewHolding({ ...newHolding, ticker: e.target.value.toUpperCase() })} className="bg-white border-gray-200" />
                {stockSuggestions.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {stockSuggestions.map((s) => (
                      <button key={s.ticker} type="button" onClick={async () => { 
                        setStockSuggestions([]);
                        setNewHolding(prev => ({ ...prev, ticker: s.ticker, name: s.name, sector: s.sector, market: s.market as "NSE" | "Global" }));
                        try {
                          const marketParam = s.market === "NSE" ? "?market=nse" : "";
                          const res = await fetch(`${API_URL}/stock/${s.ticker}${marketParam}`);
                          if (res.ok) {
                            const data = await res.json();
                            if (data?.price) setNewHolding(prev => ({ ...prev, avgCost: String(data.price) }));
                          }
                        } catch {}
                      }} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between">
                        <div>
                          <span className="font-medium text-gray-900">{s.ticker}</span>
                          <span className="text-gray-500 text-sm ml-2">{s.name}</span>
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${s.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{s.market}</Badge>
                      </button>
                    ))}
                  </div>
                )}
                {searchingStock && <div className="absolute right-3 top-9"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /></div>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Market</label>
                <Select value={newHolding.market} onValueChange={(v) => setNewHolding({ ...newHolding, market: v as "NSE" | "Global" })}>
                  <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NSE">NSE</SelectItem>
                    <SelectItem value="Global">Global</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Company Name</label>
              <Input placeholder="e.g., Safaricom PLC" value={newHolding.name} onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })} className="bg-white border-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Shares *</label>
                <Input type="number" step="any" placeholder="e.g., 500" value={newHolding.shares} onChange={(e) => setNewHolding({ ...newHolding, shares: e.target.value })} className="bg-white border-gray-200" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Avg Cost *</label>
                <Input type="number" step="any" placeholder="e.g., 24.50" value={newHolding.avgCost} onChange={(e) => setNewHolding({ ...newHolding, avgCost: e.target.value })} className="bg-white border-gray-200" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Sector</label>
              <Select value={newHolding.sector} onValueChange={(v) => setNewHolding({ ...newHolding, sector: v })}>
                <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddHolding(false); resetNewHolding(); }} className="border-gray-200">Cancel</Button>
            <Button onClick={handleAddHolding} disabled={!newHolding.ticker.trim() || !newHolding.shares || !newHolding.avgCost} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
              <Plus className="w-4 h-4" /> Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Holding Dialog */}
      <Dialog open={!!showEditHolding} onOpenChange={(v) => { if (!v) setShowEditHolding(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Position</DialogTitle>
            <DialogDescription>Update holding details.</DialogDescription>
          </DialogHeader>
          {showEditHolding && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Ticker</label>
                  <Input value={showEditHolding.ticker} onChange={(e) => setShowEditHolding({ ...showEditHolding, ticker: e.target.value })} className="bg-white border-gray-200" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Market</label>
                  <Select value={showEditHolding.market} onValueChange={(v) => setShowEditHolding({ ...showEditHolding, market: v as "NSE" | "Global" })}>
                    <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NSE">NSE</SelectItem>
                      <SelectItem value="Global">Global</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Company Name</label>
                <Input value={showEditHolding.name} onChange={(e) => setShowEditHolding({ ...showEditHolding, name: e.target.value })} className="bg-white border-gray-200" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Shares</label>
                  <Input type="number" step="any" value={String(showEditHolding.shares)} onChange={(e) => setShowEditHolding({ ...showEditHolding, shares: parseFloat(e.target.value) || 0 })} className="bg-white border-gray-200" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Avg Cost</label>
                  <Input type="number" step="any" value={showEditHolding.avgCost} onChange={(e) => setShowEditHolding({ ...showEditHolding, avgCost: e.target.value })} className="bg-white border-gray-200" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Sector</label>
                <Select value={showEditHolding.sector} onValueChange={(v) => setShowEditHolding({ ...showEditHolding, sector: v })}>
                  <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditHolding(null)} className="border-gray-200">Cancel</Button>
            <Button onClick={handleEditHolding} disabled={!showEditHolding?.ticker.trim()} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
              <Check className="w-4 h-4" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connect Broker Dialog */}
      <Dialog open={showConnect} onOpenChange={(v) => { setShowConnect(v); if (!v) { setConnectErrors({}); setParseMode('manual'); setEmailText(''); } }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Connect Trading Account</DialogTitle>
            <DialogDescription>Enter your brokerage account credentials to sync holdings.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              <button type="button" onClick={() => setParseMode('manual')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${parseMode === 'manual' ? 'bg-[#0D7490] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                <Link2 className="w-3.5 h-3.5 inline mr-1.5" />Manual Entry
              </button>
              <button type="button" onClick={() => setParseMode('email')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${parseMode === 'email' ? 'bg-[#0D7490] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                <svg className="w-3.5 h-3.5 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>Paste Email
              </button>
            </div>

            {parseMode === 'email' && (
              <div className="space-y-3">
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Paste Broker Email</label>
                  <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)}
                    placeholder={`Paste the email from your broker here...\n\nExample:\nLogin: 1000035515\nMaster Password: 39055230Secure!\nServer: IngotKE-Demo2\nPlatform: mt5`}
                    className="w-full h-36 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0D7490] font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">We'll extract Login, Password, Server, Platform, and Account Type automatically.</p>
                </div>
                <Button onClick={async () => {
                  if (!emailText.trim()) return;
                  setIsParsing(true);
                  try {
                    const res = await fetch(`${API_URL}/broker-connections/parse-email`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ emailText: emailText.trim() }),
                    });
                    const data = await res.json();
                    if (data.success && data.parsed) {
                      const p = data.parsed;
                      const brokerType = p.platformType ? 'mt5' : 'generic';
                      setNewBroker({
                        type: brokerType,
                        accountName: p.brokerName ? `${p.brokerName} ${p.accountType}` : 'Broker Account',
                        accountId: p.accountId || newBroker.accountId,
                        server: p.server || newBroker.server,
                        platform: p.platform || newBroker.platform,
                        password: p.password || p.investorPassword || newBroker.password,
                        accountType: p.accountType || newBroker.accountType,
                        platformType: p.platformType || newBroker.platformType,
                      });
                      setConnectErrors({});
                      setParseMode('manual');
                    } else {
                      alert('Could not detect broker details from this email. Please try manual entry.');
                    }
                  } catch (e) {
                    alert('Failed to parse email. Check your connection and try again.');
                  } finally {
                    setIsParsing(false);
                  }
                }} disabled={isParsing || !emailText.trim()} className="w-full bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                  {isParsing ? <><Loader2 className="w-4 h-4 animate-spin" /> Detecting...</> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Detect &amp; Fill</>}
                </Button>
              </div>
            )}

            {parseMode === 'manual' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Broker</label>
                <select value={newBroker.type} onChange={(e) => setNewBroker({ ...newBroker, type: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D7490]">
                  {BROKER_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">{BROKER_OPTIONS.find(b => b.value === newBroker.type)?.description}</p>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Account Name <span className="text-red-500">*</span></label>
                <Input placeholder="e.g., My Trading Account" value={newBroker.accountName}
                  onChange={(e) => { setNewBroker({ ...newBroker, accountName: e.target.value }); setConnectErrors(prev => ({ ...prev, accountName: "" })); }}
                  onBlur={() => setConnectErrors(prev => ({ ...prev, accountName: validateBrokerField("accountName", newBroker.accountName) }))}
                  className={`bg-white ${connectErrors.accountName ? "border-red-400" : "border-gray-200"}`} />
                {connectErrors.accountName && <p className="text-xs text-red-500 mt-1">{connectErrors.accountName}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">{newBroker.type === 'alpaca' ? 'API Key ID' : 'Account ID'}</label>
                <Input placeholder={newBroker.type === 'alpaca' ? 'e.g., AK123...' : newBroker.type === 'oanda' ? 'e.g., 123-456-789' : 'e.g., U1234567'} value={newBroker.accountId}
                  onChange={(e) => { setNewBroker({ ...newBroker, accountId: e.target.value }); setConnectErrors(prev => ({ ...prev, accountId: "" })); }}
                  onBlur={() => setConnectErrors(prev => ({ ...prev, accountId: validateBrokerField("accountId", newBroker.accountId) }))}
                  className={`bg-white ${connectErrors.accountId ? "border-red-400" : "border-gray-200"}`} />
                {connectErrors.accountId && <p className="text-xs text-red-500 mt-1">{connectErrors.accountId}</p>}
              </div>
              {['mt5', 'generic'].includes(newBroker.type) && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Server <span className="text-red-500">*</span></label>
                <Input placeholder="e.g., mt5.forex.com" value={newBroker.server}
                  onChange={(e) => { setNewBroker({ ...newBroker, server: e.target.value }); setConnectErrors(prev => ({ ...prev, server: "" })); }}
                  onBlur={() => setConnectErrors(prev => ({ ...prev, server: validateBrokerField("server", newBroker.server) }))}
                  className={`bg-white ${connectErrors.server ? "border-red-400" : "border-gray-200"}`} />
                {connectErrors.server && <p className="text-xs text-red-500 mt-1">{connectErrors.server}</p>}
              </div>
              )}
              {['mt5'].includes(newBroker.type) && (
              <>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Platform</label>
                <Input placeholder="e.g., MetaTrader 5" value={newBroker.platform}
                  onChange={(e) => { setNewBroker({ ...newBroker, platform: e.target.value }); setConnectErrors(prev => ({ ...prev, platform: "" })); }}
                  onBlur={() => setConnectErrors(prev => ({ ...prev, platform: validateBrokerField("platform", newBroker.platform) }))}
                  className={`bg-white ${connectErrors.platform ? "border-red-400" : "border-gray-200"}`} />
                {connectErrors.platform && <p className="text-xs text-red-500 mt-1">{connectErrors.platform}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Platform Version</label>
                <select value={newBroker.platformType} onChange={(e) => setNewBroker({ ...newBroker, platformType: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D7490]">
                  <option value="mt5">MT5</option>
                  <option value="mt4">MT4</option>
                </select>
              </div>
              </>
              )}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Account Type</label>
                <select value={newBroker.accountType} onChange={(e) => setNewBroker({ ...newBroker, accountType: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D7490]">
                  <option value="Live">Live</option>
                  <option value="Demo">Demo</option>
                  <option value="Margin">Margin</option>
                  <option value="Cash">Cash</option>
                  <option value="IRA">IRA</option>
                  <option value="401k">401(k)</option>
                  <option value="Corporate">Corporate</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  {newBroker.type === 'alpaca' ? 'API Secret Key' : newBroker.type === 'tradier' || newBroker.type === 'oanda' ? 'Access Token' : 'Password / Secret'} <span className="text-red-500">*</span>
                </label>
                <Input type="password" placeholder={
                  newBroker.type === 'alpaca' ? 'e.g., your-alpaca-secret-key' :
                  newBroker.type === 'tradier' ? 'e.g., your-tradier-bearer-token' :
                  newBroker.type === 'oanda' ? 'e.g., your-oanda-bearer-token' :
                  'Account password, API secret or investor password'
                } value={newBroker.password}
                  onChange={(e) => { setNewBroker({ ...newBroker, password: e.target.value }); setConnectErrors(prev => ({ ...prev, password: "" })); }}
                  onBlur={() => setConnectErrors(prev => ({ ...prev, password: validateBrokerField("password", newBroker.password) }))}
                  className={`bg-white ${connectErrors.password ? "border-red-400" : "border-gray-200"}`} />
                {connectErrors.password && <p className="text-xs text-red-500 mt-1">{connectErrors.password}</p>}
              </div>
              <div className="col-span-2 mt-2">
                <p className="text-xs text-gray-400">Credentials are encrypted at rest and used only for syncing your portfolio data.</p>
              </div>
            </div>
            )}
            {parseMode === 'manual' && (
              <div className="col-span-2 text-center">
                <button type="button" onClick={() => { setShowConnect(false); setShowManualEntry(true); setManualEntryTab("single"); }} className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted">
                  <Database className="w-3 h-3 inline mr-1" />Enter holdings manually instead
                </button>
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 shrink-0">
            <Button variant="outline" onClick={() => setShowConnect(false)} className="border-gray-200">Cancel</Button>
            <Button onClick={handleConnectBroker} disabled={isValidating || !newBroker.accountName.trim()} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
              {isValidating ? <><Loader2 className="w-4 h-4 animate-spin" /> Validating...</> : <><Link2 className="w-4 h-4" /> Connect</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Recommendation Detail Dialog */}
      <Dialog open={showRecDialog} onOpenChange={(v) => { setShowRecDialog(v); if (!v) setSelectedRec(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#0D7490]" />
              {selectedRec?.symbol || selectedRec?.ticker} — {selectedRec?.name}
            </DialogTitle>
            <DialogDescription>AI-powered recommendation details</DialogDescription>
          </DialogHeader>
          {selectedRec && (
            <div className="space-y-4">
              {/* Signal badge & confidence */}
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded text-sm font-medium text-white ${
                  selectedRec.signal === "Strong Buy" || selectedRec.signal === "Buy" ? "bg-green-600" :
                  selectedRec.signal === "Strong Sell" || selectedRec.signal === "Sell" ? "bg-red-600" :
                  "bg-yellow-500"
                }`}>{selectedRec.signal}</span>
                <span className="text-sm text-gray-500">Confidence: <strong>{selectedRec.confidence}</strong></span>
                {selectedRec.market && (
                  <Badge variant="outline" className={`text-xs ${selectedRec.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{selectedRec.market}</Badge>
                )}
              </div>

              {/* Reason */}
              {selectedRec.reason && (
                <div className="p-3 rounded-lg bg-gray-50 border">
                  <div className="text-xs text-gray-500 font-medium mb-1">Analysis</div>
                  <p className="text-sm text-gray-700">{selectedRec.reason}</p>
                </div>
              )}

              {/* Price & Targets */}
              <div className="grid grid-cols-3 gap-3">
                {selectedRec.price && (
                  <div className="p-3 rounded-lg border text-center">
                    <div className="text-xs text-gray-500 mb-1">Current</div>
                    <div className="text-lg font-bold text-gray-900">{selectedRec.currency === "USD" ? "$" : "KES "}{selectedRec.price}</div>
                  </div>
                )}
                {selectedRec.target1 && (
                  <div className="p-3 rounded-lg border text-center border-green-200 bg-green-50">
                    <div className="text-xs text-gray-500 mb-1">Target 1</div>
                    <div className="text-lg font-bold text-green-700">{selectedRec.currency === "USD" ? "$" : "KES "}{selectedRec.target1}</div>
                  </div>
                )}
                {selectedRec.target2 && (
                  <div className="p-3 rounded-lg border text-center border-emerald-200 bg-emerald-50">
                    <div className="text-xs text-gray-500 mb-1">Target 2</div>
                    <div className="text-lg font-bold text-emerald-700">{selectedRec.currency === "USD" ? "$" : "KES "}{selectedRec.target2}</div>
                  </div>
                )}
              </div>

              {/* Additional details */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {selectedRec.sector && <div className="text-gray-500">Sector: <span className="text-gray-700">{selectedRec.sector}</span></div>}
                {selectedRec.timeframe && <div className="text-gray-500">Timeframe: <span className="text-gray-700">{selectedRec.timeframe}</span></div>}
                {selectedRec.riskReward && <div className="text-gray-500">Risk/Reward: <span className="text-gray-700">{selectedRec.riskReward}</span></div>}
                {selectedRec.volume && <div className="text-gray-500">Volume: <span className="text-gray-700">{selectedRec.volume}</span></div>}
              </div>

              {/* In portfolio indicator */}
              {'inPortfolio' in selectedRec && (
                <div className={`p-2 rounded-lg text-sm text-center ${selectedRec.inPortfolio ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-500 border'}`}>
                  {selectedRec.inPortfolio ? '✓ Already in your portfolio' : 'Not in your portfolio'}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowRecDialog(false); setSelectedRec(null); }} className="border-gray-200">Close</Button>
            <Button onClick={() => {
              if (!selectedRec) return;
              setNewHolding({ ticker: selectedRec.symbol || selectedRec.ticker || "", name: selectedRec.name || "", shares: "", avgCost: selectedRec.price || "", sector: selectedRec.sector || "Other", market: (selectedRec.market === "NSE" ? "NSE" : "Global") as "NSE" | "Global" });
              setShowRecDialog(false);
              setShowAddHolding(true);
            }} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
              <Plus className="w-4 h-4" /> Add to Portfolio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Advice Full Dialog */}
      <Dialog open={showAdvice} onOpenChange={(v) => { setShowAdvice(v); if (!v) { setAdviceError(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-[#0D7490]" />
              AI Portfolio Analysis
            </DialogTitle>
            <DialogDescription>Personalized rebalancing advice based on real-time market conditions.</DialogDescription>
          </DialogHeader>
          {loadingAdvice && (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#0D7490] mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Analyzing your portfolio with real-time market data...</p>
              </div>
            </div>
          )}
          {adviceError && !loadingAdvice && (
            <div className="text-center py-12">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-red-600 text-sm font-medium mb-1">Failed to get advice</p>
              <p className="text-gray-400 text-xs">{adviceError}</p>
            </div>
          )}
          {portfolioAdvice && (
            <div className="space-y-5">
              {/* Market Conditions Bar */}
              {portfolioAdvice.marketContext && (
                <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-4 border">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1 rounded bg-indigo-100">
                      <Activity className="w-3.5 h-3.5 text-indigo-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800">Market Pulse</span>
                    <div className="flex gap-1.5 ml-auto">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${portfolioAdvice.marketContext.direction.nse === 'bullish' ? 'bg-emerald-100 text-emerald-700' : portfolioAdvice.marketContext.direction.nse === 'bearish' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        NSE {portfolioAdvice.marketContext.direction.nse.toUpperCase()}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${portfolioAdvice.marketContext.direction.global === 'bullish' ? 'bg-emerald-100 text-emerald-700' : portfolioAdvice.marketContext.direction.global === 'bearish' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        Global {portfolioAdvice.marketContext.direction.global.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">Volatility <span className="font-semibold text-gray-700">{portfolioAdvice.marketContext.nseVolatility}</span></span>
                    <span className="w-px bg-gray-200" />
                    <span className="flex items-center gap-1">FX <span className="font-semibold text-gray-700">KES {portfolioAdvice.marketContext.fxRate.toFixed(2)}</span></span>
                    <span className="w-px bg-gray-200" />
                    <span className="flex items-center gap-1">News <span className="font-semibold text-gray-700">{portfolioAdvice.marketContext.relevantNews.length} articles</span></span>
                  </div>
                </div>
              )}

              {/* Sector Performance */}
              {portfolioAdvice.marketContext && portfolioAdvice.marketContext.topSectors.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border border-emerald-100 bg-gradient-to-b from-emerald-50/60 to-white">
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-xs font-semibold text-emerald-700">Leading Sectors</span>
                    </div>
                    {portfolioAdvice.marketContext.topSectors.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-600 py-1 border-b border-emerald-100/50 last:border-0">
                        <span>{s.name}</span>
                        <span className={`font-medium ${parseFloat(s.change) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{s.change}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 rounded-xl border border-red-100 bg-gradient-to-b from-red-50/60 to-white">
                    <div className="flex items-center gap-1.5 mb-2">
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-xs font-semibold text-red-600">Lagging Sectors</span>
                    </div>
                    {portfolioAdvice.marketContext.bottomSectors.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-600 py-1 border-b border-red-100/50 last:border-0">
                        <span>{s.name}</span>
                        <span className={`font-medium ${parseFloat(s.change) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{s.change}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              <div className="bg-gradient-to-r from-[#0D7490]/5 to-[#0EA5E9]/5 rounded-xl p-4 border border-[#0D7490]/10">
                <div className="flex items-start gap-2.5">
                  <div className="p-1 rounded-lg bg-[#0D7490]/10">
                    <Sparkles className="w-4 h-4 text-[#0D7490]" />
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{portfolioAdvice.summary}</p>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Diversification</div>
                  <div className={`text-3xl font-bold ${portfolioAdvice.diversification.score >= 70 ? 'text-emerald-600' : portfolioAdvice.diversification.score >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                    {portfolioAdvice.diversification.score}%
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${portfolioAdvice.diversification.score >= 70 ? 'bg-emerald-500' : portfolioAdvice.diversification.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${portfolioAdvice.diversification.score}%` }} />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-2">{portfolioAdvice.diversification.message}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Risk Level</div>
                  <div className={`text-2xl font-bold ${portfolioAdvice.riskAssessment.startsWith('Low') ? 'text-emerald-600' : portfolioAdvice.riskAssessment.startsWith('Moderate') ? 'text-amber-600' : 'text-red-600'}`}>
                    {portfolioAdvice.riskAssessment.split(' —')[0]}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-2 leading-tight">
                    {portfolioAdvice.riskAssessment.includes('—') ? portfolioAdvice.riskAssessment.split('— ')[1] : ''}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-b from-gray-50 to-white border text-center">
                  <div className="text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Positions</div>
                  <div className="text-3xl font-bold text-gray-900">{portfolioAdvice.recommendations.length}</div>
                  <div className="mt-1 flex items-center justify-center gap-2 text-[11px]">
                    <span className="text-emerald-600 font-medium">{portfolioAdvice.recommendations.filter(r => r.action === 'Accumulate').length} buy</span>
                    <span className="text-gray-300">&middot;</span>
                    <span className="text-red-500 font-medium">{portfolioAdvice.recommendations.filter(r => r.action === 'Reduce' || r.action === 'Trim' || r.action === 'Take Partial Profits').length} sell</span>
                  </div>
                </div>
              </div>

              {/* Position Recommendations */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-gray-400" />
                  Position Recommendations
                </h4>
                <div className="space-y-2.5">
                  {portfolioAdvice.recommendations.map((rec, i) => {
                    const isBuy = rec.action === 'Accumulate';
                    const isSell = rec.action === 'Reduce' || rec.action === 'Trim' || rec.action === 'Take Partial Profits';
                    const allocNum = parseInt(rec.allocation);
                    return (
                      <div key={i} className={`p-3.5 rounded-xl border-l-[5px] ${isBuy ? 'border-l-emerald-500 bg-gradient-to-r from-emerald-50/60 to-white border-emerald-100 border-t border-r border-b' : isSell ? 'border-l-red-500 bg-gradient-to-r from-red-50/60 to-white border-red-100 border-t border-r border-b' : 'border-l-gray-400 bg-gradient-to-r from-gray-50/60 to-white border-gray-200 border-t border-r border-b'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setShowAdvice(false); navigate(`/app/stock/${rec.ticker}`); }} className="font-semibold text-gray-900 hover:text-[#0D7490] text-sm">
                              {rec.ticker}
                            </button>
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold text-white ${isBuy ? 'bg-emerald-600' : isSell ? 'bg-red-600' : 'bg-gray-500'}`}>
                              {rec.action}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-500">{rec.allocation}</span>
                            <ArrowRight className="w-3 h-3 text-gray-300" />
                            <span className="font-semibold text-gray-700">{rec.targetAllocation}</span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 leading-relaxed">{rec.reason}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${isBuy ? 'bg-emerald-500' : isSell ? 'bg-red-500' : 'bg-gray-400'}`}
                              style={{ width: `${Math.min(100, allocNum)}%` }} />
                          </div>
                          <span className="text-[11px] font-medium text-gray-400 shrink-0">P/L: {rec.pnlPct}</span>
                          <span className="text-[11px] font-medium text-gray-400 shrink-0">Target: {rec.targetAllocation}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Relevant News */}
              {portfolioAdvice.marketContext && portfolioAdvice.marketContext.relevantNews.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Newspaper className="w-4 h-4 text-gray-400" />
                    Recent News Impact
                  </h4>
                  <div className="space-y-1.5">
                    {portfolioAdvice.marketContext.relevantNews.map((a, i) => (
                      <div key={i} className="text-xs text-gray-600 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100 flex items-start gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#0D7490] mt-1.5 shrink-0" />
                        <div>
                          <span className="font-medium text-gray-800">{a.headline}</span>
                          {a.source && <span className="text-gray-400 ml-1">— {a.source}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdvice(false)} className="border-gray-200">Close</Button>
            <Button onClick={() => { setPortfolioAdvice(null); handleGetAdvice(); }} disabled={loadingAdvice} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
              {loadingAdvice ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh Analysis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comprehensive Manual Entry Dialog */}
      <Dialog open={showManualEntry} onOpenChange={(v) => { setShowManualEntry(v); if (!v) { setBatchRows([]); setCsvData([]); setCsvFileName(""); setManualEntryTab("single"); setImportResult(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>Manual Entry</DialogTitle>
            <DialogDescription>Add your holdings manually — single entry, batch, or CSV import.</DialogDescription>
            <div className="flex items-center gap-2 mt-3">
              {(["single", "batch", "csv"] as const).map(tab => (
                <button key={tab} onClick={() => setManualEntryTab(tab)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all capitalize ${
                    manualEntryTab === tab ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  {tab === "single" ? "Single Entry" : tab === "batch" ? "Batch Entry" : "CSV Import"}
                </button>
              ))}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* ── Single Entry ── */}
            {manualEntryTab === "single" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Add one holding at a time. Ticker is required.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div ref={searchRef} className="relative">
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Ticker *</label>
                    <Input placeholder="e.g., SCOM" value={newHolding.ticker} onChange={(e) => setNewHolding({ ...newHolding, ticker: e.target.value.toUpperCase() })} className="bg-white border-gray-200" />
                    {stockSuggestions.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {stockSuggestions.map((s) => (
                          <button key={s.ticker} type="button" onClick={async () => {
                            setStockSuggestions([]);
                            setNewHolding(prev => ({ ...prev, ticker: s.ticker, name: s.name, sector: s.sector, market: s.market as "NSE" | "Global" }));
                          }} className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between">
                            <div>
                              <span className="font-medium text-gray-900">{s.ticker}</span>
                              <span className="text-gray-500 text-sm ml-2">{s.name}</span>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${s.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{s.market}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchingStock && <div className="absolute right-3 top-9"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /></div>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Market *</label>
                    <Select value={newHolding.market} onValueChange={(v) => setNewHolding({ ...newHolding, market: v as "NSE" | "Global" })}>
                      <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NSE">NSE (Kenya)</SelectItem>
                        <SelectItem value="Global">Global (US/Intl)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Company Name</label>
                  <Input placeholder="e.g., Safaricom PLC" value={newHolding.name} onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })} className="bg-white border-gray-200" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Shares *</label>
                    <Input type="number" step="any" placeholder="e.g., 500" value={newHolding.shares} onChange={(e) => setNewHolding({ ...newHolding, shares: e.target.value })} className="bg-white border-gray-200" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Avg Cost (per share) *</label>
                    <Input type="number" step="any" placeholder="e.g., 24.50" value={newHolding.avgCost} onChange={(e) => setNewHolding({ ...newHolding, avgCost: e.target.value })} className="bg-white border-gray-200" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Sector</label>
                    <Select value={newHolding.sector} onValueChange={(v) => setNewHolding({ ...newHolding, sector: v })}>
                      <SelectTrigger className="bg-white border-gray-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleAddHolding} disabled={!newHolding.ticker.trim() || !newHolding.shares || !newHolding.avgCost} className="w-full bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                      <Plus className="w-4 h-4" /> Add Holding
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Batch Entry ── */}
            {manualEntryTab === "batch" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Add multiple holdings at once. Each row is one holding.</p>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left p-2 text-gray-600 font-medium">Ticker</th>
                        <th className="text-left p-2 text-gray-600 font-medium">Name</th>
                        <th className="text-right p-2 text-gray-600 font-medium">Shares</th>
                        <th className="text-right p-2 text-gray-600 font-medium">Avg Cost</th>
                        <th className="text-left p-2 text-gray-600 font-medium">Sector</th>
                        <th className="text-left p-2 text-gray-600 font-medium">Market</th>
                        <th className="w-10 p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center py-6 text-gray-400 text-sm">No rows added yet. Click "Add Row" below.</td>
                        </tr>
                      ) : (
                        batchRows.map((row, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            <td className="p-1"><Input size={1} placeholder="SCOM" value={row.ticker} onChange={(e) => { const r = [...batchRows]; r[i] = { ...r[i], ticker: e.target.value.toUpperCase() }; setBatchRows(r); }} className="bg-white border-gray-200 h-8 text-xs" /></td>
                            <td className="p-1"><Input size={1} placeholder="Safaricom PLC" value={row.name} onChange={(e) => { const r = [...batchRows]; r[i] = { ...r[i], name: e.target.value }; setBatchRows(r); }} className="bg-white border-gray-200 h-8 text-xs" /></td>
                            <td className="p-1"><Input size={1} type="number" step="any" placeholder="500" value={row.shares} onChange={(e) => { const r = [...batchRows]; r[i] = { ...r[i], shares: e.target.value }; setBatchRows(r); }} className="bg-white border-gray-200 h-8 text-xs text-right" /></td>
                            <td className="p-1"><Input size={1} type="number" step="any" placeholder="24.50" value={row.avgCost} onChange={(e) => { const r = [...batchRows]; r[i] = { ...r[i], avgCost: e.target.value }; setBatchRows(r); }} className="bg-white border-gray-200 h-8 text-xs text-right" /></td>
                            <td className="p-1">
                              <Select value={row.sector} onValueChange={(v) => { const r = [...batchRows]; r[i] = { ...r[i], sector: v }; setBatchRows(r); }}>
                                <SelectTrigger className="bg-white border-gray-200 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-1">
                              <Select value={row.market} onValueChange={(v) => { const r = [...batchRows]; r[i] = { ...r[i], market: v as "NSE" | "Global" }; setBatchRows(r); }}>
                                <SelectTrigger className="bg-white border-gray-200 h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="NSE">NSE</SelectItem>
                                  <SelectItem value="Global">Global</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-1"><button onClick={() => setBatchRows(batchRows.filter((_, j) => j !== i))} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => setBatchRows([...batchRows, { ticker: "", name: "", shares: "", avgCost: "", sector: "Other", market: "NSE" }])} className="border-gray-200 gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Row
                  </Button>
                  {batchRows.length > 0 && (
                    <Button onClick={async () => {
                      setImportingManual(true);
                      try {
                        const valid = batchRows.filter(r => r.ticker.trim() && r.shares && r.avgCost);
                        if (valid.length === 0) { alert("No valid rows to import."); return; }
                        const res = await fetch(`${API_URL}/holdings/bulk`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userId: user?.id, holdings: valid.map(r => ({ ticker: r.ticker, name: r.name, shares: parseFloat(r.shares), avgCost: parseFloat(r.avgCost), sector: r.sector, market: r.market })) }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          alert(`Successfully imported ${data.imported} holdings.`);
                          setBatchRows([]);
                          await refresh();
                        } else {
                          const err = await res.json();
                          alert(`Import failed: ${err.error}`);
                        }
                      } catch (e: any) { alert(`Import failed: ${e.message}`); }
                      setImportingManual(false);
                    }} disabled={importingManual || batchRows.filter(r => r.ticker.trim() && r.shares && r.avgCost).length === 0} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-1">
                      {importingManual ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />} Import {batchRows.filter(r => r.ticker.trim() && r.shares && r.avgCost).length} Holdings
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* ── CSV Import ── */}
            {manualEntryTab === "csv" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">Upload a CSV file with columns: <code className="bg-gray-100 px-1 rounded">ticker, name, shares, avgCost, sector, market</code></p>

                {importResult && (
                  <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${importResult.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                    {importResult.type === "success" ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    {importResult.message}
                  </div>
                )}

                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${csvDragOver ? "border-[#0D7490] bg-blue-50" : "border-gray-300"}`}
                  onDragOver={(e) => { e.preventDefault(); setCsvDragOver(true); }}
                  onDragLeave={() => setCsvDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setCsvDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file || !file.name.endsWith(".csv")) { setImportResult({ type: "error", message: "Please drop a .csv file." }); return; }
                    setImportResult(null);
                    setCsvFileName(file.name);
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                      const text = evt.target?.result as string;
                      const lines = text.split("\n").filter(l => l.trim());
                      if (lines.length < 2) { setImportResult({ type: "error", message: "CSV file must have a header row and at least one data row." }); return; }
                      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
                      const required = ["ticker", "shares", "avgcost"];
                      const missing = required.filter(r => !headers.some(h => h === r || (r === "avgcost" && (h === "avg_cost" || h === "avgcost" || h === "price"))));
                      if (missing.length > 0) { setImportResult({ type: "error", message: `Missing required columns: ${missing.join(", ")}. Found: ${headers.join(", ")}` }); return; }
                      const rows = lines.slice(1).map(line => {
                        const vals = line.split(",").map(v => v.trim());
                        const row: Record<string, string> = {};
                        headers.forEach((h, i) => row[h] = vals[i] || "");
                        return row;
                      }).filter(r => r.ticker);
                      setCsvData(rows.map(r => ({
                        ticker: r.ticker?.toUpperCase() || "",
                        name: r.name || r.company || "",
                        shares: String(parseFloat(r.shares || r.quantity || r.qty || "0")),
                        avgCost: String(parseFloat(r.avgcost || r.avg_cost || r.avgCost || r.price || "0")),
                        sector: r.sector || r.sector || "Other",
                        market: r.market?.toUpperCase() === "NSE" || r.exchange?.toUpperCase() === "NSE" ? "NSE" : "Global",
                      })));
                    };
                    reader.readAsText(file);
                  }}
                >
                  {!csvFileName ? (
                    <div>
                      <Database className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm text-gray-500 mb-1">Drop a CSV file here or click to browse</p>
                      <p className="text-xs text-gray-400 mb-3">Columns: ticker, shares, avgCost (name, sector, market optional)</p>
                      <label className="cursor-pointer inline-block">
                        <span className="px-4 py-2 rounded-lg bg-[#0D7490] text-white text-sm font-medium hover:bg-[#0A5F7A]">Choose CSV File</span>
                        <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setImportResult(null);
                          setCsvFileName(file.name);
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            const text = evt.target?.result as string;
                            const lines = text.split("\n").filter(l => l.trim());
                            if (lines.length < 2) { setImportResult({ type: "error", message: "CSV file must have a header row and at least one data row." }); return; }
                            const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
                            const rows = lines.slice(1).map(line => {
                              const vals = line.split(",").map(v => v.trim());
                              const row: Record<string, string> = {};
                              headers.forEach((h, i) => row[h] = vals[i] || "");
                              return row;
                            }).filter(r => r.ticker);
                            setCsvData(rows.map(r => ({
                              ticker: r.ticker?.toUpperCase() || "",
                              name: r.name || r.company || "",
                              shares: String(parseFloat(r.shares || r.quantity || r.qty || "0")),
                              avgCost: String(parseFloat(r.avgcost || r.avg_cost || r.avgCost || r.price || "0")),
                              sector: r.sector || r.sector || "Other",
                              market: r.market?.toUpperCase() === "NSE" || r.exchange?.toUpperCase() === "NSE" ? "NSE" : "Global",
                            })));
                          };
                          reader.readAsText(file);
                        }} />
                      </label>
                    </div>
                  ) : (
                    <div className="text-left">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Check className="w-5 h-5 text-green-600" />
                          <span className="text-sm font-medium text-gray-900">{csvFileName}</span>
                          <span className="text-xs text-gray-500">({csvData.length} holdings found)</span>
                        </div>
                        <button onClick={() => { setCsvData([]); setCsvFileName(""); setImportResult(null); }} className="text-sm text-red-600 hover:underline">Remove</button>
                      </div>
                      <div className="overflow-x-auto border rounded-lg max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="text-left p-2 text-gray-600 font-medium">Ticker</th>
                              <th className="text-left p-2 text-gray-600 font-medium">Name</th>
                              <th className="text-right p-2 text-gray-600 font-medium">Shares</th>
                              <th className="text-right p-2 text-gray-600 font-medium">Avg Cost</th>
                              <th className="text-left p-2 text-gray-600 font-medium">Sector</th>
                              <th className="text-left p-2 text-gray-600 font-medium">Market</th>
                            </tr>
                          </thead>
                          <tbody>
                            {csvData.map((r, i) => (
                              <tr key={i} className="border-b hover:bg-gray-50">
                                <td className="p-2 font-medium text-gray-900">{r.ticker}</td>
                                <td className="p-2 text-gray-600">{r.name}</td>
                                <td className="p-2 text-right text-gray-900">{r.shares}</td>
                                <td className="p-2 text-right text-gray-900">{r.avgCost}</td>
                                <td className="p-2 text-gray-600">{r.sector}</td>
                                <td className="p-2"><Badge variant="outline" className={`text-[10px] ${r.market === "NSE" ? "border-[#0D7490] text-[#0D7490]" : "border-purple-300 text-purple-600"}`}>{r.market}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {csvData.length > 0 && (
                        <Button onClick={async () => {
                          setImportingManual(true);
                          setImportResult(null);
                          try {
                            const valid = csvData.filter(r => r.ticker && parseFloat(r.shares) > 0 && parseFloat(r.avgCost) > 0);
                            if (valid.length === 0) { setImportResult({ type: "error", message: "No valid rows (ticker, shares > 0, avgCost > 0 required)." }); setImportingManual(false); return; }
                            const res = await fetch(`${API_URL}/holdings/bulk`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: user?.id, holdings: valid.map(r => ({ ticker: r.ticker, name: r.name, shares: parseFloat(r.shares), avgCost: parseFloat(r.avgCost), sector: r.sector, market: r.market })) }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              setImportResult({ type: "success", message: `Successfully imported ${data.imported} holdings from CSV.` });
                              setCsvData([]);
                              setCsvFileName("");
                              await refresh();
                            } else {
                              const err = await res.json();
                              setImportResult({ type: "error", message: `Import failed: ${err.error}` });
                            }
                          } catch (e: any) { setImportResult({ type: "error", message: `Import failed: ${e.message}` }); }
                          setImportingManual(false);
                        }} disabled={importingManual} className="mt-3 w-full bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                          {importingManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />} Import {csvData.length} Holdings from CSV
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-2 shrink-0">
            <Button variant="outline" onClick={() => { setShowManualEntry(false); setBatchRows([]); setCsvData([]); setCsvFileName(""); }} className="border-gray-200">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Real Portfolio Statement Dialog */}
      <Dialog open={showRealStatement} onOpenChange={(open) => setShowRealStatement(open)}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <BarChartHorizontal className="w-5 h-5 text-[#0D7490]" />
              Portfolio Statement
            </DialogTitle>
            <DialogDescription className="flex items-center justify-between">
              <span>
                {realStatementData
                  ? <>Snapshot: {new Date(realStatementData.generatedAt).toLocaleString()} {statementLastRefreshed && <span className="text-green-600 font-medium ml-1">&bull; Live</span>}</>
                  : 'Loading...'}
              </span>
              {/* Period Selector */}
              <span className="flex gap-1">
                {["1D", "1W", "1M", "1Y", "ALL"].map(p => (
                  <button key={p} onClick={() => changeStatementPeriod(p)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${statementPeriod === p ? "bg-[#0D7490] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                    {p}
                  </button>
                ))}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {realStatementLoading && !realStatementData && (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            )}
            {statementError && !realStatementLoading && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Failed to load statement: {statementError}</span>
              </div>
            )}
            {!realStatementLoading && !realStatementData && !statementError && (
              <div className="p-4 text-center text-gray-400 text-sm">
                Click Refresh or change period to load data
              </div>
            )}
            {realStatementData && (
              <div className="space-y-5">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg border bg-gradient-to-br from-white to-gray-50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wallet className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Total Value</span>
                    </div>
                    <div className="text-lg font-bold text-gray-900">KES {realStatementData.summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Cost: KES {realStatementData.summary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg border ${realStatementData.summary.dailyChange >= 0 ? 'bg-gradient-to-br from-green-50 to-white' : 'bg-gradient-to-br from-red-50 to-white'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Daily Change</span>
                    </div>
                    <div className={`text-lg font-bold ${realStatementData.summary.dailyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {realStatementData.summary.dailyChange >= 0 ? '+' : ''}KES {Math.abs(realStatementData.summary.dailyChange).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`text-xs ${realStatementData.summary.dailyChangePercent >= 0 ? 'text-green-500' : 'text-red-500'} mt-0.5`}>
                      {realStatementData.summary.dailyChangePercent >= 0 ? '+' : ''}{realStatementData.summary.dailyChangePercent}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-gradient-to-br from-white to-gray-50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Unrealized P&L</span>
                    </div>
                    <div className={`text-lg font-bold ${realStatementData.summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {realStatementData.summary.totalPnL >= 0 ? '+' : ''}KES {Math.abs(realStatementData.summary.totalPnL).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-gradient-to-br from-white to-gray-50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Target className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Total Return</span>
                    </div>
                    <div className={`text-lg font-bold ${realStatementData.summary.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {realStatementData.summary.pnlPercent >= 0 ? '+' : ''}{realStatementData.summary.pnlPercent}%
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {realStatementData.summary.holdingsCount} holding{realStatementData.summary.holdingsCount !== 1 ? 's' : ''} &middot; FX: {realStatementData.summary.fxRate}
                    </div>
                  </div>
                </div>

                {/* Value History Chart */}
                {realStatementData.valueHistory?.length > 1 && (
                  <div className="p-3 rounded-lg border">
                    <h4 className="text-xs font-semibold text-gray-900 mb-2">Portfolio Value ({statementPeriod})</h4>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={realStatementData.valueHistory}>
                          <defs>
                            <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0D7490" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#0D7490" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `KES ${(v / 1000).toFixed(0)}k`} />
                          <Tooltip formatter={(value: number) => [`KES ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Value']} labelFormatter={(label) => new Date(label).toLocaleString()} />
                          <Area type="monotone" dataKey="totalValue" stroke="#0D7490" strokeWidth={2} fill="url(#valueGradient)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Market Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg border bg-gradient-to-br from-[#0D7490]/5 to-white">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500">NSE Portfolio</span>
                      <Badge variant="outline" className="text-[9px] border-[#0D7490] text-[#0D7490]">{realStatementData.summary.nseCount} holdings</Badge>
                    </div>
                    <div className="text-lg font-bold text-gray-900">KES {realStatementData.summary.nseValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-medium ${realStatementData.summary.nsePnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        P&L: {realStatementData.summary.nsePnLPercent}%
                      </span>
                      <span className="text-xs text-gray-400">
                        Cost: KES {(realStatementData.summary.nseCost ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-[#0D7490] h-1.5 rounded-full" style={{ width: `${realStatementData.summary.totalValue > 0 ? Math.round((realStatementData.summary.nseValue / realStatementData.summary.totalValue * realStatementData.summary.fxRate) * 100) : 0}%` }} />
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border bg-gradient-to-br from-purple-50 to-white">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500">Global Portfolio</span>
                      <Badge variant="outline" className="text-[9px] border-purple-300 text-purple-600">{realStatementData.summary.globalCount} holdings</Badge>
                    </div>
                    <div className="text-lg font-bold text-gray-900">${realStatementData.summary.globalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-medium ${realStatementData.summary.globalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        P&L: {realStatementData.summary.globalPnLPercent}%
                      </span>
                      <span className="text-xs text-gray-400">
                        Cost: ${realStatementData.summary.globalCost.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${realStatementData.summary.totalValue > 0 ? Math.round((realStatementData.summary.globalValue * realStatementData.summary.fxRate / realStatementData.summary.totalValue) * 100) : 0}%` }} />
                    </div>
                  </div>
                </div>

                {/* Best/Worst Performers */}
                {realStatementData.bestPerformers?.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-gradient-to-br from-green-50 to-white">
                      <h4 className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" /> Best Performers
                      </h4>
                      <div className="space-y-1.5">
                        {realStatementData.bestPerformers.map((p: any) => (
                          <div key={p.ticker} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-900">{p.ticker}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">{p.market === 'NSE' ? 'KES ' : '$'}{p.pnl.toFixed(2)}</span>
                              <span className="text-green-600 font-medium">+{p.pnlPercent}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border bg-gradient-to-br from-red-50 to-white">
                      <h4 className="text-xs font-semibold text-red-800 mb-2 flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" /> Worst Performers
                      </h4>
                      <div className="space-y-1.5">
                        {realStatementData.worstPerformers.map((p: any) => (
                          <div key={p.ticker} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-900">{p.ticker}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">{p.market === 'NSE' ? 'KES ' : '$'}{p.pnl.toFixed(2)}</span>
                              <span className="text-red-600 font-medium">{p.pnlPercent}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Sector Allocation */}
                {realStatementData.sectorAllocation.length > 0 && (
                  <div className="p-3 rounded-lg border">
                    <h4 className="text-xs font-semibold text-gray-900 mb-2">Sector Allocation</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {realStatementData.sectorAllocation.map((s: any) => (
                        <div key={s.sector} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-24 truncate">{s.sector}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-[#0D7490] h-2 rounded-full" style={{ width: `${s.pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-gray-900 w-10 text-right">{s.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Holdings Table */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-900 mb-2">Positions ({realStatementData.holdings.length})</h4>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Ticker</th>
                          <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Name</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Shares</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Avg Cost</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Current</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Value</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">P&L</th>
                          <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Return</th>
                          <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Sector</th>
                        </tr>
                      </thead>
                      <tbody>
                        {realStatementData.holdings.map((h: any) => (
                          <tr key={h.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 font-semibold text-gray-900 text-xs">{h.ticker}</td>
                            <td className="p-2 text-gray-500 text-[11px] max-w-[120px] truncate">{h.name}</td>
                            <td className="p-2 text-right text-gray-900 text-xs">{h.shares}</td>
                            <td className="p-2 text-right text-xs">{h.market === 'NSE' ? 'KES ' : '$'}{h.avgCost.toFixed(2)}</td>
                            <td className="p-2 text-right text-xs">{h.market === 'NSE' ? 'KES ' : '$'}{h.currentPrice.toFixed(2)}</td>
                            <td className="p-2 text-right font-medium text-xs">{h.market === 'NSE' ? 'KES ' : '$'}{h.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className={`p-2 text-right font-medium text-xs ${h.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{h.market === 'NSE' ? 'KES ' : '$'}{h.pnl.toFixed(2)}</td>
                            <td className={`p-2 text-right font-medium text-xs ${h.pnlPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{h.pnlPercent.toFixed(1)}%</td>
                            <td className="p-2">
                              <Badge variant="outline" className={`text-[9px] ${h.market === 'NSE' ? 'border-[#0D7490] text-[#0D7490]' : 'border-purple-300 text-purple-600'}`}>{h.sector}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Trade History */}
                {realStatementData.tradeHistory && realStatementData.tradeHistory.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <History className="w-3.5 h-3.5 text-[#0D7490]" />
                      Trade History ({realStatementData.tradeHistory.length})
                    </h4>
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Account</th>
                            <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Time</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Ticket</th>
                            <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Type</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Volume</th>
                            <th className="text-left p-2 text-gray-500 font-medium text-[11px]">Symbol</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Price</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Close</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Profit</th>
                            <th className="text-right p-2 text-gray-500 font-medium text-[11px]">Commission</th>
                          </tr>
                        </thead>
                        <tbody>
                          {realStatementData.tradeHistory.map((trade: any, i: number) => {
                            const profit = parseFloat(trade.profit || '0');
                            return (
                              <tr key={i} className="border-b hover:bg-gray-50">
                                <td className="p-2">
                                  <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-600">{trade._brokerName || 'Broker'}</Badge>
                                </td>
                                <td className="p-2 text-gray-500 whitespace-nowrap text-[11px]">{trade.time || '-'}</td>
                                <td className="p-2 text-right text-gray-700 text-[11px]">{trade.ticket || '-'}</td>
                                <td className="p-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    (trade.type || '').toLowerCase() === 'buy' ? 'bg-green-100 text-green-700' :
                                    (trade.type || '').toLowerCase() === 'sell' ? 'bg-red-100 text-red-700' :
                                    (trade.type || '').toLowerCase() === 'balance' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {trade.type || '-'}
                                  </span>
                                </td>
                                <td className="p-2 text-right text-gray-900 text-[11px]">{trade.volume || '-'}</td>
                                <td className="p-2 font-medium text-gray-900 text-[11px]">{trade.symbol || '-'}</td>
                                <td className="p-2 text-right text-gray-900 text-[11px]">{trade.price || '-'}</td>
                                <td className="p-2 text-right text-gray-900 text-[11px]">{trade.price_2 || '-'}</td>
                                <td className="p-2 text-right">
                                  <span className={`flex items-center gap-1 justify-end font-medium text-[11px] ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {profit >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                    {trade.profit || '0'}
                                  </span>
                                </td>
                                <td className="p-2 text-right text-gray-500 text-[11px]">{trade.commission || '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-2 shrink-0 gap-2 border-t bg-gray-50">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className={`inline-block w-2 h-2 rounded-full ${statementLastRefreshed ? (Date.now() - statementLastRefreshed.getTime() < 70000 ? 'bg-green-500' : 'bg-yellow-500') : 'bg-gray-300'}`} />
              {statementLastRefreshed ? `Updated ${Math.round((Date.now() - statementLastRefreshed.getTime()) / 1000)}s ago` : 'Not yet updated'}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={openStatement} className="border-gray-200 gap-1 text-xs h-8">
                <RefreshCw className="w-3 h-3" /> Refresh
              </Button>
              <Button variant="outline" onClick={() => window.print()} className="border-gray-200 gap-1 text-xs h-8">
                <BarChartHorizontal className="w-3 h-3" /> Print
              </Button>
              <Button variant="outline" onClick={() => setShowRealStatement(false)} className="border-gray-200 text-xs h-8">Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Broker Detail Dialog */}
      <Dialog open={showBrokerDetail} onOpenChange={setShowBrokerDetail}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#0D7490]" />
              {selectedBroker?.accountName || 'Broker Details'}
            </DialogTitle>
            <DialogDescription>
              {selectedBroker?.platform} {selectedBroker?.accountType && `(${selectedBroker.accountType})`} @ {selectedBroker?.server}
            </DialogDescription>
          </DialogHeader>
          {selectedBroker && (
            <div className="space-y-6">
              {/* Account Summary */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Balance', value: selectedBroker.latestSnapshot?.balance ?? selectedBroker.accountInfo?.balance, fmt: (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) },
                  { label: 'Equity', value: selectedBroker.latestSnapshot?.equity ?? selectedBroker.accountInfo?.equity, fmt: (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) },
                  { label: 'Margin', value: selectedBroker.latestSnapshot?.margin ?? selectedBroker.accountInfo?.margin, fmt: (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) },
                  { label: 'Free Margin', value: selectedBroker.latestSnapshot?.free_margin ?? selectedBroker.accountInfo?.freeMargin, fmt: (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 }) },
                  { label: 'Level', value: selectedBroker.latestSnapshot?.level ?? selectedBroker.accountInfo?.level, fmt: (v: number) => Number(v).toFixed(2) + '%' },
                ].map(({ label, value, fmt }) => (
                  <div key={label} className="p-3 rounded-lg bg-gray-50 border text-center">
                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                    <div className="text-lg font-bold text-gray-900">
                      {value != null ? fmt(Number(value)) : '-'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Open Positions */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#0D7490]" />
                  Open Positions ({(selectedBroker.latestSnapshot?.positions ?? []).length})
                </h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        {['Symbol', 'Volume', 'Price', 'S/L', 'T/P', 'Profit'].map(h => (
                          <th key={h} className={`${h === 'Symbol' ? 'text-left' : 'text-right'} text-gray-600 py-3 px-3 font-medium`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBroker.latestSnapshot?.positions && selectedBroker.latestSnapshot.positions.length > 0 ? (
                        selectedBroker.latestSnapshot.positions.map((pos: any, i: number) => {
                          const profit = parseFloat(pos.profit || '0');
                          return (
                            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-3">
                                <div className="text-gray-900 font-semibold">{pos.symbol || '-'}</div>
                              </td>
                              <td className="text-right py-3 px-3 text-gray-900">{pos.volume || '-'}</td>
                              <td className="text-right py-3 px-3 text-gray-900">{pos.price || '-'}</td>
                              <td className="text-right py-3 px-3 text-gray-500">{pos['s/l'] || pos.sl || '-'}</td>
                              <td className="text-right py-3 px-3 text-gray-500">{pos['t/p'] || pos.tp || '-'}</td>
                              <td className="text-right py-3 px-3">
                                <span className={`flex items-center gap-1 justify-end font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {profit >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                                  {pos.profit || '0'}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-gray-400 text-sm">No open positions</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Trade History */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <History className="w-5 h-5 text-[#0D7490]" />
                  Trade History ({(selectedBroker.latestSnapshot?.trade_history ?? []).length})
                </h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        {['Time', 'Ticket', 'Type', 'Volume', 'Symbol', 'Price', 'Profit', 'Comment'].map(h => (
                          <th key={h} className={`${h === 'Time' || h === 'Type' || h === 'Comment' ? 'text-left' : 'text-right'} text-gray-600 py-3 px-3 font-medium`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBroker.latestSnapshot?.trade_history && selectedBroker.latestSnapshot.trade_history.length > 0 ? (
                        selectedBroker.latestSnapshot.trade_history.map((trade: any, i: number) => {
                          const profit = parseFloat(trade.profit || '0');
                          return (
                            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-3 text-gray-500 whitespace-nowrap">{trade.time || '-'}</td>
                              <td className="text-right py-3 px-3 text-gray-700">{trade.ticket || '-'}</td>
                              <td className="py-3 px-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  (trade.type || '').toLowerCase() === 'buy' ? 'bg-green-100 text-green-700' :
                                  (trade.type || '').toLowerCase() === 'sell' ? 'bg-red-100 text-red-700' :
                                  (trade.type || '').toLowerCase() === 'balance' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {trade.type || '-'}
                                </span>
                              </td>
                              <td className="text-right py-3 px-3 text-gray-900">{trade.volume || '-'}</td>
                              <td className="py-3 px-3 font-medium text-gray-900">{trade.symbol || '-'}</td>
                              <td className="text-right py-3 px-3 text-gray-900">{trade.price || '-'}</td>
                              <td className="text-right py-3 px-3">
                                <span className={`flex items-center gap-1 justify-end font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {profit >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                                  {trade.profit || '0'}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-gray-500 max-w-[200px] truncate" title={trade.comment}>{trade.comment || '-'}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={8} className="text-center py-8 text-gray-400 text-sm">No trade history available</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Last Sync */}
              {selectedBroker.lastSyncAt && (
                <div className="text-xs text-gray-400 text-right">
                  Last synced: {new Date(selectedBroker.lastSyncAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {selectedBroker?.dbId && (
              <Button variant="outline" onClick={async () => {
                try {
                  const res = await fetch(`${API_URL}/broker-connections/${selectedBroker.dbId}/sync`, { method: "POST" });
                  if (res.ok) {
                    const data = await res.json();
                    setBrokers(prev => prev.map(b => b.id === selectedBroker.id ? {
                      ...b,
                      syncStatus: "idle" as const,
                      accountInfo: data.account || undefined,
                      latestSnapshot: data.account ? {
                        id: data.snapshotId,
                        broker_connection_id: b.dbId!,
                        balance: data.account.balance,
                        equity: data.account.equity,
                        margin: data.account.margin,
                        free_margin: data.account.freeMargin,
                        level: data.account.level,
                        positions: data.positions || [],
                        trade_history: data.tradeHistory || [],
                        snapshot_at: new Date().toISOString(),
                      } : undefined,
                    } : b));
                    setSelectedBroker(prev => prev ? {
                      ...prev,
                      syncStatus: "idle",
                      accountInfo: data.account || undefined,
                      latestSnapshot: data.account ? {
                        id: data.snapshotId,
                        broker_connection_id: prev.dbId!,
                        balance: data.account.balance,
                        equity: data.account.equity,
                        margin: data.account.margin,
                        free_margin: data.account.freeMargin,
                        level: data.account.level,
                        positions: data.positions || [],
                        trade_history: data.tradeHistory || [],
                        snapshot_at: new Date().toISOString(),
                      } : undefined,
                    } : null);
                    await refresh();
                  }
                } catch {}
              }} className="border-gray-200 gap-2">
                <RefreshCw className="w-3 h-3" />
                Sync
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowBrokerDetail(false)} className="border-gray-200">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </React.Fragment>)}

      {!paperMode && showFloatingConnect && (
        <button
          onClick={() => setShowConnect(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-[#0D7490] text-white shadow-lg hover:bg-[#0A5F7A] transition-all duration-200"
        >
          <Link2 className="w-4 h-4" />
          <span className="text-sm font-medium">Connect Account</span>
        </button>
      )}
    </div>
  );
}

