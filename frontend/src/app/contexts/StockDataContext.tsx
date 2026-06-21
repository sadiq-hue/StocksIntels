"use client";

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { useRealtimeQuotes } from "./RealtimeQuotesContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

interface StockData {
  symbol: string;
  company_name: string;
  price: number;
  changePercent: number;
  volume: number;
  currency: string;
  market_cap: string;
  sector: string;
  pe: number;
  dividend: number;
}

interface StockDataContextValue {
  allStocks: StockData[];
  nseStocks: StockData[];
  globalStocks: StockData[];
  allSymbols: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getRealtimeQuote: (symbol: string) => { price: number; changePercent: number; volume: number } | null;
}

const StockDataContext = createContext<StockDataContextValue | null>(null);

function normalizeSymbol(symbol: string): string {
  return symbol.startsWith("NSE:") ? symbol.replace("NSE:", "") : symbol;
}

export function StockDataProvider({ children }: { children: ReactNode }) {
  const [allStocks, setAllStocks] = useState<StockData[]>([]);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { quotes: realtimeQuotes, refetch: refetchQuotes } = useRealtimeQuotes();

  const fetchStocks = async () => {
    try {
      setLoading(true);
      setError(null);
      // Fetch signals (price/analysis) and comprehensive stock list in parallel
      const [signalsRes, listRes] = await Promise.all([
        fetch(`${API_BASE_URL}/stocks`),
        fetch(`${API_BASE_URL}/stocks/list`),
      ]);
      if (!signalsRes.ok) throw new Error(`HTTP ${signalsRes.status}`);
      const signals = await signalsRes.json();
      let listData: any[] = [];
      if (listRes.ok) {
        listData = await listRes.json();
      }
      // Build comprehensive symbol list for realtime subscriptions
      if (listData.length > 0) {
        const syms = listData.map((s: any) =>
          s.market === 'NSE' ? `NSE:${s.ticker}` : s.ticker
        ).filter(Boolean);
        setAllSymbols(syms);
      }
      // Merge signal data with list data for comprehensive stock info
      const signalMap = new Map(signals.map((s: any) => [(s.ticker || s.symbol || '').toUpperCase(), s]));
      const merged = listData.length > 0 ? listData.map((s: any) => {
        const key = s.ticker.toUpperCase();
        const signal = signalMap.get(key) || {};
        return {
          symbol: s.market === 'NSE' ? `NSE:${s.ticker}` : s.ticker,
          company_name: s.name || signal.name || '',
          price: typeof signal.price === 'number' ? signal.price : (parseFloat(signal.price) || 0),
          changePercent: typeof signal.changePercent === 'number' ? signal.changePercent : (typeof signal.change === 'number' ? signal.change : 0),
          volume: typeof signal.volume === 'number' ? signal.volume : 0,
          currency: s.currency || 'USD',
          market_cap: signal.market_cap || '',
          sector: s.sector || signal.sector || 'Other',
          pe: signal.pe || 0,
          dividend: signal.dividend || 0,
        };
      }) : signals.map((s: any) => ({
        ...s,
        symbol: s.market === 'NSE' ? `NSE:${s.ticker}` : (s.ticker || s.symbol || ''),
        company_name: s.company_name || s.name || '',
        price: typeof s.price === 'number' ? s.price : (parseFloat(s.price) || 0),
        changePercent: typeof s.changePercent === 'number' ? s.changePercent : (typeof s.change === 'number' ? s.change : 0),
        volume: typeof s.volume === 'number' ? s.volume : (parseFloat(String(s.volume).replace(/[^0-9.]/g, '')) || 0),
        currency: s.currency || 'USD',
      }));
      setAllStocks(merged);
    } catch (err: any) {
      setError(err.message || "Failed to fetch stocks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStocks(); }, []);

  // Merge real-time data into base stock data
  const mergedStocks = useMemo(() => {
    return allStocks.map(stock => {
      const liveQuote = realtimeQuotes[stock.symbol];
      if (!liveQuote) return stock;
      return {
        ...stock,
        price: liveQuote.price ?? stock.price,
        changePercent: liveQuote.changePercent ?? stock.changePercent,
        volume: liveQuote.volume ?? stock.volume,
        change: liveQuote.change ?? stock.change,
        provider: liveQuote.provider ?? stock.provider,
      };
    });
  }, [allStocks, realtimeQuotes]);

  const { nseStocks, globalStocks } = useMemo(() => {
    const nse = mergedStocks.filter(s => s.symbol?.startsWith('NSE:'));
    const global = mergedStocks.filter(s => !s.symbol?.startsWith('NSE:'));
    return { nseStocks: nse, globalStocks: global };
  }, [mergedStocks]);

  const getRealtimeQuote = useMemo(() => (symbol: string) => {
    const q = realtimeQuotes[symbol];
    if (!q) return null;
    return { price: q.price, changePercent: q.changePercent, volume: q.volume, provider: q.provider };
  }, [realtimeQuotes]);

  const refresh = async () => {
    await Promise.all([fetchStocks(), refetchQuotes()]);
  };

  return (
    <StockDataContext.Provider value={{
      allStocks: mergedStocks,
      nseStocks,
      globalStocks,
      allSymbols,
      loading,
      error,
      refresh,
      getRealtimeQuote,
    }}>
      {children}
    </StockDataContext.Provider>
  );
}

export function useStockData() {
  const ctx = useContext(StockDataContext);
  if (!ctx) throw new Error("useStockData must be used within StockDataProvider");
  return ctx;
}
