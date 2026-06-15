"use client";

import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { useStockData } from "./StockDataContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export interface PortfolioHolding {
  id?: number;
  ticker: string;
  name: string;
  shares: number;
  avgCost: string;
  currentPrice: string;
  value: string;
  pnl: string;
  isPositive: boolean;
  sector: string;
  market: "NSE" | "Global";
  brokerConnectionId?: number;
}

interface PortfolioTotals {
  totalValue: number;
  totalCost: number;
  totalPnL: number;
  pnlPercent: number;
  holdingsCount: number;
  nseValue: number;
  globalValue: number;
  nseCost: number;
  globalCost: number;
  nsePnL: number;
  globalPnL: number;
  nsePnLPercent: number;
  globalPnLPercent: number;
  nseCount: number;
  globalCount: number;
  combinedKesValue: number;
  fxRate: number;
}

interface PortfolioAllocation {
  name: string;
  value: number;
  color: string;
}

interface BrokerTotals {
  activeBrokerCount: number;
  equityUsd: number;
  profitUsd: number;
  posCount: number;
}

interface PortfolioDataContextValue {
  holdings: PortfolioHolding[];
  totals: PortfolioTotals;
  enhancedTotals: PortfolioTotals;
  allocation: PortfolioAllocation[];
  topHoldings: PortfolioHolding[];
  loading: boolean;
  refresh: () => Promise<void>;
  brokerTotals: BrokerTotals;
  brokerConnections: any[];
  brokerLoading: boolean;
  setBrokerConnections: (connections: any[]) => void;
}

const ALLOCATION_COLORS = [
  "#0D7490", "#0EA5E9", "#10B981", "#8B5CF6",
  "#F59E0B", "#EF4444", "#6366F1", "#6B7280",
];

const PortfolioDataContext = createContext<PortfolioDataContextValue | null>(null);

function getDemoHoldings(): PortfolioHolding[] {
  return [
    { ticker: "SCOM", name: "Safaricom PLC", shares: 500, avgCost: "24.50", currentPrice: "28.50", value: "14250", pnl: "+16.3%", isPositive: true, sector: "Telecom", market: "NSE" },
    { ticker: "EQTY", name: "Equity Group", shares: 200, avgCost: "48.00", currentPrice: "52.75", value: "10550", pnl: "+9.9%", isPositive: true, sector: "Financial", market: "NSE" },
    { ticker: "KCB", name: "KCB Group", shares: 180, avgCost: "44.00", currentPrice: "45.20", value: "8136", pnl: "+2.7%", isPositive: true, sector: "Financial", market: "NSE" },
    { ticker: "EABL", name: "East African Breweries", shares: 40, avgCost: "162.00", currentPrice: "165.00", value: "6600", pnl: "+1.9%", isPositive: true, sector: "Consumer", market: "NSE" },
    { ticker: "AAPL", name: "Apple Inc.", shares: 30, avgCost: "178.50", currentPrice: "198.25", value: "5947", pnl: "+11.1%", isPositive: true, sector: "Technology", market: "Global" },
    { ticker: "NVDA", name: "NVIDIA Corp.", shares: 15, avgCost: "485.00", currentPrice: "624.50", value: "9367", pnl: "+28.8%", isPositive: true, sector: "Technology", market: "Global" },
    { ticker: "MSFT", name: "Microsoft Corp.", shares: 20, avgCost: "390.00", currentPrice: "425.30", value: "8506", pnl: "+9.1%", isPositive: true, sector: "Technology", market: "Global" },
  ];
}

export function PortfolioDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { nseStocks, globalStocks } = useStockData();
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [brokerConnections, setBrokerConnections] = useState<any[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem("portfolio_brokers") : null;
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [brokerLoading, setBrokerLoading] = useState(false);

  const stockPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of nseStocks) map.set(s.symbol?.replace('NSE:', ''), s.price);
    for (const s of globalStocks) map.set(s.symbol, s.price);
    return map;
  }, [nseStocks, globalStocks]);

  const [fxRate, setFxRate] = useState(130);

  const fetchHoldings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/holdings?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const holdingsArr = Array.isArray(data) ? data : (data.holdings || []);
        if (data.fxRate) setFxRate(data.fxRate);
        if (holdingsArr.length > 0) {
          const enriched = holdingsArr.map((h: any) => {
            const livePrice = h.live_price || h.current_price || parseFloat(h.current_price) || parseFloat(h.avg_cost) || 0;
            const avgC = parseFloat(h.avg_cost) || 0;
            const shares = parseFloat(h.shares) || 0;
            const val = parseFloat(h.value) || (livePrice * shares);
            const pnl = parseFloat(h.pnl) || (val - (avgC * shares));
            const pnlPct = parseFloat(h.pnl_percent) || (avgC > 0 ? ((livePrice - avgC) / avgC * 100) : 0);
            return {
              id: h.id,
              ticker: h.ticker,
              name: h.name || h.ticker,
              shares,
              avgCost: String(avgC),
              currentPrice: String(livePrice),
              value: val.toFixed(2),
              pnl: (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(1) + "%",
              isPositive: h.is_positive !== undefined ? h.is_positive : pnl >= 0,
              sector: h.sector || "Other",
              market: (h.market || "NSE") as "NSE" | "Global",
              brokerConnectionId: h.broker_connection_id || 0,
            };
          });
          setHoldings(enriched);
          setLoading(false);
          return;
        }
      }
    } catch {}
    setHoldings([]);
    setLoading(false);
  }, [user, stockPriceMap]);

  const fetchBrokers = useCallback(async () => {
    if (!user) return;
    setBrokerLoading(true);
    try {
      const res = await fetch(`${API_URL}/broker-connections?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const apiData = Array.isArray(data) ? data : [];
        setBrokerConnections(prev => {
          if (apiData.length === 0) return prev;
          if (prev.length === 0) return [];
          const apiById = new Map(apiData.map(ad => [ad.id, ad]));
          return prev.map(p => {
            const ad = apiById.get(p.id) || apiById.get(p.dbId);
            if (!ad) return p;
            if (!ad.latest_snapshot && p.latest_snapshot) {
              return { ...ad, latest_snapshot: p.latest_snapshot };
            }
            if (!ad.latestSnapshot && p.latestSnapshot) {
              return { ...ad, latestSnapshot: p.latestSnapshot };
            }
            if (!ad.account_info?.equity && p.account_info?.equity) {
              return { ...ad, account_info: { ...(ad.account_info || {}), equity: p.account_info.equity } };
            }
            if (!ad.accountInfo?.equity && p.accountInfo?.equity) {
              return { ...ad, accountInfo: { ...(ad.accountInfo || {}), equity: p.accountInfo.equity } };
            }
            return ad;
          });
        });
      }
    } catch {
      // API failed — try localStorage cache as fallback
      try {
        const saved = localStorage.getItem("portfolio_brokers");
        if (saved) {
          const cached = JSON.parse(saved);
          if (Array.isArray(cached) && cached.length > 0) {
            setBrokerConnections(cached);
          }
        }
      } catch {}
    } finally {
      setBrokerLoading(false);
    }
  }, [user]);

  const pollingRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (user) {
      fetchHoldings();
      fetchBrokers();
      pollingRef.current = setInterval(() => {
        fetchHoldings();
        fetchBrokers();
      }, 30000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [user]);

  // Listen for socket.io broker:sync event to refresh immediately
  useEffect(() => {
    if (!user) return;
    let socket: any;
    import("../services/socketService").then(({ getSocket, connectSocket }) => {
      socket = connectSocket(user.id, user.full_name || "");
      socket.on("broker:sync", () => {
        fetchBrokers();
        fetchHoldings();
      });
    });
    return () => {
      if (socket) socket.off("broker:sync");
    };
  }, [user]);

  const totals = useMemo(() => {
    // Exclude broker-synced holdings (they are counted via brokerTotals in enhancedTotals)
    const manualHoldings = holdings.filter(h => !h.brokerConnectionId || h.brokerConnectionId === 0);
    const nseH = manualHoldings.filter(h => h.market === "NSE");
    const globalH = manualHoldings.filter(h => h.market === "Global");

    const nseValue = nseH.reduce((sum, h) => sum + (parseFloat(h.value) || 0), 0);
    const nseCost = nseH.reduce((sum, h) => sum + ((parseFloat(h.avgCost) || 0) * (h.shares || 0)), 0);
    const nsePnL = nseValue - nseCost;

    const globalValue = globalH.reduce((sum, h) => sum + (parseFloat(h.value) || 0), 0);
    const globalCost = globalH.reduce((sum, h) => sum + ((parseFloat(h.avgCost) || 0) * (h.shares || 0)), 0);
    const globalPnL = globalValue - globalCost;

    const combinedKesValue = nseValue + globalValue * fxRate;
    const combinedKesCost = nseCost + globalCost * fxRate;
    const combinedKesPnL = combinedKesValue - combinedKesCost;

    return {
      totalValue: Math.round(combinedKesValue),
      totalCost: Math.round(combinedKesCost),
      totalPnL: Math.round(combinedKesPnL),
      pnlPercent: combinedKesCost > 0 ? Math.round((combinedKesPnL / combinedKesCost) * 1000) / 10 : 0,
      holdingsCount: holdings.length,
      nseValue: Math.round(nseValue),
      globalValue: Math.round(globalValue),
      nseCost: Math.round(nseCost),
      globalCost: Math.round(globalCost),
      nsePnL: Math.round(nsePnL),
      globalPnL: Math.round(globalPnL),
      nsePnLPercent: nseCost > 0 ? Math.round((nsePnL / nseCost) * 1000) / 10 : 0,
      globalPnLPercent: globalCost > 0 ? Math.round((globalPnL / globalCost) * 1000) / 10 : 0,
      nseCount: nseH.length,
      globalCount: globalH.length,
      combinedKesValue: Math.round(combinedKesValue),
      fxRate,
    };
  }, [holdings, fxRate]);

  const topHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
  }, [holdings]);

  const brokerTotals = useMemo(() => {
    let equityUsd = 0, profitUsd = 0, posCount = 0;
    let activeBrokerCount = 0;
    const seen = new Set();
    for (const b of brokerConnections) {
      const key = `${b.accountId || b.account_id || ''}|${b.server || ''}`;
      if (key !== '|') {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const snap = b.latest_snapshot || b.latestSnapshot;
      const eq = parseFloat(snap?.equity ?? b.account_info?.equity ?? b.accountInfo?.equity ?? 0);
      if (!isNaN(eq) && eq > 0) {
        equityUsd += eq;
        activeBrokerCount++;
      }
      if (snap) {
        const bal = parseFloat(snap.balance) || 0;
        profitUsd += eq - bal;
      }
      posCount += (snap?.positions || []).length;
    }
    return { equityUsd, profitUsd, posCount, activeBrokerCount };
  }, [brokerConnections]);



  const enhancedTotals = useMemo(() => {
    const eqUsd = Number(brokerTotals.equityUsd) || 0;
    const pftUsd = Number(brokerTotals.profitUsd) || 0;
    const pCnt = Number(brokerTotals.posCount) || 0;
    const fx = Number(totals.fxRate) || 130;
    const newCombinedKes = Number(totals.combinedKesValue) + eqUsd * fx;
    const globalCost = eqUsd - pftUsd;
    const totalPnL = Number(totals.totalPnL) + pftUsd * fx;
    const totalCost = Number(totals.totalCost) + Math.max(0, globalCost * fx);
    return {
      ...totals,
      combinedKesValue: Math.round(newCombinedKes),
      globalValue: Math.round(eqUsd * 100) / 100,
      globalPnL: Math.round(pftUsd),
      totalPnL: Math.round(totalPnL),
      globalCount: Number(totals.globalCount),
      totalValue: Math.round(newCombinedKes),
      pnlPercent: totalCost > 0
        ? Math.round((totalPnL / totalCost) * 1000) / 10
        : Number(totals.pnlPercent) || 0,
      globalPnLPercent: globalCost > 0
        ? Math.round((pftUsd / globalCost) * 1000) / 10
        : 0,
    };
  }, [totals, brokerTotals]);

  const allocation = useMemo(() => {
    const totalKesValue = holdings.reduce((sum, h) => {
      const val = parseFloat(h.value) || 0;
      return sum + (h.market === "Global" ? val * fxRate : val);
    }, 0);
    return holdings.map((h, i) => ({
      name: h.ticker,
      value: totalKesValue > 0 ? Math.round(((h.market === "Global" ? (parseFloat(h.value) || 0) * fxRate : parseFloat(h.value) || 0) / totalKesValue) * 100) : 0,
      color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
    }));
  }, [holdings, fxRate]);

  return (
    <PortfolioDataContext.Provider value={{ holdings, totals, enhancedTotals, allocation, topHoldings, loading, refresh: fetchHoldings, brokerTotals, brokerConnections, brokerLoading, setBrokerConnections }}>
      {children}
    </PortfolioDataContext.Provider>
  );
}

export function usePortfolioData() {
  const ctx = useContext(PortfolioDataContext);
  if (!ctx) throw new Error("usePortfolioData must be used within PortfolioDataProvider");
  return ctx;
}
