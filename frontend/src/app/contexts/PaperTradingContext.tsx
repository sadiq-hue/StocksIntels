"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export interface PaperAccount {
  id: number;
  userId: number;
  cashBalance: number;
  cashBalanceUsd: number;
  initialCapital: number;
  initialCapitalUsd: number;
  portfolioValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  totalFeesPaid: number;
  totalFeesPaidUsd: number;
}

export interface MarketStatusInfo {
  open: boolean;
  label: string;
  openTime: string;
  closeTime: string;
}

export interface PaperPosition {
  id: number;
  ticker: string;
  name: string;
  shares: number;
  avgCost: string;
  currentPrice: string;
  value: string;
  pnl: string;
  pnlPercent: string;
  market: string;
  sector?: string;
}

export interface PaperTrade {
  id: number;
  ticker: string;
  name: string;
  shares: number;
  price: string;
  type: "buy" | "sell";
  market: string;
  currency: string;
  total_value: string;
  commission: string;
  fees: string;
  created_at: string;
}

export interface TradeResult {
  success: boolean;
  error?: string;
  trade?: {
    ticker: string;
    shares: number;
    price: number;
    type: "buy" | "sell";
    totalValue: number;
    commission: number;
    fees: number;
    currency: string;
  };
  cashBalance?: number;
  cashBalanceUsd?: number;
}

export interface StatementData {
  generatedAt: string;
  account: {
    cashBalanceKes: number;
    initialCapitalKes: number;
    cashBalanceUsd: number;
    initialCapitalUsd: number;
    totalFeesPaidKes: number;
    totalFeesPaidUsd: number;
  };
  summary: {
    totalTrades: number;
    buyTrades: number;
    sellTrades: number;
    openPositions: number;
    totalCommissionKes: number;
    totalFeesKes: number;
    totalCommissionUsd: number;
    totalFeesUsd: number;
    realizedPnlKes: number;
    realizedPnlUsd: number;
  };
  trades: Array<{
    id: number;
    ticker: string;
    name: string;
    shares: number;
    price: number;
    type: "buy" | "sell";
    market: string;
    currency: string;
    totalValue: number;
    commission: number;
    fees: number;
    date: string;
  }>;
  openPositions: Array<{
    ticker: string;
    name: string;
    shares: number;
    avgCost: number;
    currentPrice: number;
    value: number;
    pnl: number;
    pnlPercent: number;
    market: string;
  }>;
}

interface PaperTradingContextValue {
  account: PaperAccount | null;
  positions: PaperPosition[];
  trades: PaperTrade[];
  loading: boolean;
  placingOrder: boolean;
  marketStatus: { nse: MarketStatusInfo; global: MarketStatusInfo } | null;
  error: string | null;
  refresh: () => Promise<void>;
  placeOrder: (params: { ticker: string; name?: string; shares: number; type: "buy" | "sell"; market: string; sector?: string }) => Promise<TradeResult>;
  initAccount: (initialCapital?: number) => Promise<boolean>;
  resetAccount: (initialCapital?: number) => Promise<boolean>;
  fetchStatement: () => Promise<StatementData | null>;
}

const PaperTradingContext = createContext<PaperTradingContextValue | null>(null);

export function PaperTradingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [marketStatus, setMarketStatus] = useState<{ nse: MarketStatusInfo; global: MarketStatusInfo } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [accountRes, tradesRes] = await Promise.all([
        fetch(`${API_URL}/paper/account?userId=${user.id}`),
        fetch(`${API_URL}/paper/trades?userId=${user.id}`),
      ]);
      if (accountRes.ok) {
        const data = await accountRes.json();
        setAccount(data.account);
        setPositions(data.positions);
        if (data.marketStatus) setMarketStatus(data.marketStatus);
      }
      if (tradesRes.ok) setTrades(await tradesRes.json());
    } catch {}
    setLoading(false);
  }, [user]);

  const placeOrder = useCallback(async (params) => {
    if (!user) return { success: false, error: "Not authenticated" };
    setPlacingOrder(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/paper/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          ticker: params.ticker,
          name: params.name || params.ticker,
          shares: params.shares,
          type: params.type,
          market: params.market,
          sector: params.sector || "Other",
        }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || "Failed to place order" };
      await refresh();
      return {
        success: true,
        trade: data.trade,
        cashBalance: data.cashBalance,
        cashBalanceUsd: data.cashBalanceUsd,
      };
    } catch (err: any) {
      return { success: false, error: err.message || "Network error" };
    } finally {
      setPlacingOrder(false);
    }
  }, [user, refresh]);

  const initAccount = useCallback(async (initialCapital?: number) => {
    if (!user) return false;
    try {
      const res = await fetch(`${API_URL}/paper/account/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, initialCapital }),
      });
      if (res.ok) { await refresh(); return true; }
      return false;
    } catch { return false; }
  }, [user, refresh]);

  const resetAccount = useCallback(async (initialCapital?: number) => {
    if (!user) return false;
    try {
      const res = await fetch(`${API_URL}/paper/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, initialCapital }),
      });
      if (res.ok) { await refresh(); return true; }
      return false;
    } catch { return false; }
  }, [user, refresh]);

  const fetchStatement = useCallback(async () => {
    if (!user) return null;
    try {
      const res = await fetch(`${API_URL}/paper/statement?userId=${user.id}`);
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }, [user]);

  return (
    <PaperTradingContext.Provider value={{ account, positions, trades, loading, placingOrder, marketStatus, error, refresh, placeOrder, initAccount, resetAccount, fetchStatement }}>
      {children}
    </PaperTradingContext.Provider>
  );
}

export function usePaperTrading() {
  const ctx = useContext(PaperTradingContext);
  if (!ctx) throw new Error("usePaperTrading must be used within PaperTradingProvider");
  return ctx;
}
