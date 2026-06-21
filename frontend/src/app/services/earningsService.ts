const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface EarningsEvent {
  id: string;
  ticker: string;
  name: string;
  date: string;
  dateStr: string;
  quarter: string;
  fiscalYear: number;
  estEPS: number;
  actualEPS: number;
  surprise: number;
  isBeat: boolean;
  market: string;
  sector: string;
  currency: string;
  marketCap: number;
  revenue: number;
}

export interface EarningsResult {
  earnings: EarningsEvent[];
  total: number;
  offset: number;
  limit: number;
  sectors: string[];
  dateRange: { from: string | null; to: string | null };
}

export interface EarningsCriteria {
  sectors: string[];
  markets: string[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchEarningsCriteria(): Promise<EarningsCriteria> {
  return fetchJson<EarningsCriteria>(`${API_BASE}/earnings/criteria`);
}

export function fetchUpcomingEarnings(params: {
  market?: string;
  sector?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<EarningsResult> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  return fetchJson<EarningsResult>(`${API_BASE}/earnings/upcoming?${query.toString()}`);
}
