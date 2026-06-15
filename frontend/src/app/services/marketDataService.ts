import { quickFinancialSymbols, type StockMarket } from "../data/stockUniverses";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export interface RealtimeStockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  timestamp: number;
  provider?: string;
}

export interface PriceBar {
  date: string;
  timestamp: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  adjclose: number | null;
}

export interface PriceHistoryResponse {
  symbol: string;
  bars: PriceBar[];
  count: number;
}

const globalSymbols = new Set(
  quickFinancialSymbols
    .filter((item) => item.market === "global")
    .map((item) => item.symbol)
);

export function inferStockMarket(symbol: string): StockMarket {
  return globalSymbols.has(symbol.toUpperCase()) ? "global" : "nse";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchRealtimeStockQuote(symbol: string, market: StockMarket = "nse") {
  const marketParam = market === "global" ? "us" : "nse";
  return fetchJson<RealtimeStockQuote>(
    `${API_BASE}/stock/${encodeURIComponent(symbol)}?market=${marketParam}`
  );
}

export async function fetchRealtimeQuotesBatch(symbols: string[]): Promise<Record<string, RealtimeStockQuote>> {
  if (symbols.length === 0) return {};
  const response = await fetch(`${API_BASE}/market/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  const data = await response.json();
  return data.quotes as Record<string, RealtimeStockQuote>;
}

export async function fetchStockHistory(symbol: string, range = "6mo", interval = "1d"): Promise<PriceBar[]> {
  const data = await fetchJson<PriceHistoryResponse>(
    `${API_BASE}/stock/${encodeURIComponent(symbol)}/history?range=${range}&interval=${interval}`
  );
  return data.bars;
}
