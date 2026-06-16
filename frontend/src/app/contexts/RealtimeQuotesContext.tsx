"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { fetchRealtimeQuotesBatch, type RealtimeStockQuote } from "../services/marketDataService";

interface RealtimeQuotesContextValue {
  quotes: Record<string, RealtimeStockQuote>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getQuote: (symbol: string) => RealtimeStockQuote | undefined;
}

const RealtimeQuotesContext = createContext<RealtimeQuotesContextValue | null>(null);

const POLL_INTERVAL = 30000; // 30 seconds

export function RealtimeQuotesProvider({ children, symbols = [] }: { children: ReactNode; symbols?: string[] }) {
  const [quotes, setQuotes] = useState<Record<string, RealtimeStockQuote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const fetchAll = useCallback(async () => {
    const currentSymbols = symbolsRef.current;
    if (currentSymbols.length === 0) return;
    setLoading(true);
    try {
      const data = await fetchRealtimeQuotesBatch(currentSymbols);
      setQuotes(prev => ({ ...prev, ...data }));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  const getQuote = useCallback((symbol: string): RealtimeStockQuote | undefined => {
    return quotes[symbol] ?? (!symbol.startsWith('NSE:') ? quotes[`NSE:${symbol}`] : undefined);
  }, [quotes]);

  return (
    <RealtimeQuotesContext.Provider value={{ quotes, loading, error, refetch: fetchAll, getQuote }}>
      {children}
    </RealtimeQuotesContext.Provider>
  );
}

export function useRealtimeQuotes() {
  const ctx = useContext(RealtimeQuotesContext);
  if (!ctx) throw new Error("useRealtimeQuotes must be used within RealtimeQuotesProvider");
  return ctx;
}
