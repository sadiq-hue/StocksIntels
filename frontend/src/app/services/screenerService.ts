const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface ScreenerFilters {
  search?: string;
  market?: string;
  sector?: string;
  signal?: string;
  type?: string;
  minPrice?: number;
  maxPrice?: number;
  minChange?: number;
  maxChange?: number;
  minVolume?: number;
  minPE?: number;
  maxPE?: number;
  minDividend?: number;
  maxDividend?: number;
  minScore?: number;
  maxScore?: number;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  limit?: number;
}

export interface ScreenerStock {
  ticker: string;
  name: string;
  price: number;
  change: number;
  market: string;
  currency: string;
  signal: string;
  type: string;
  confidence: number;
  sector: string;
  volume: string;
  score: number;
  grade: string;
  fundamentalScore: number;
  technicalScore: number;
  financialScore: number;
  macroScore: number;
}

export interface ScreenerResult {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stocks: ScreenerStock[];
}

export interface ScreenerCriteria {
  sectors: string[];
  markets: string[];
  signalTypes: string[];
  tradeTypes: string[];
  priceRange: { min: number; max: number };
  scoreRange: { min: number; max: number };
  totalStocks: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchScreenerCriteria(): Promise<ScreenerCriteria> {
  return fetchJson<ScreenerCriteria>(`${API_BASE}/screener/criteria`);
}

export function fetchScreenerResults(filters: ScreenerFilters): Promise<ScreenerResult> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  return fetchJson<ScreenerResult>(`${API_BASE}/screener?${params.toString()}`);
}
