import { getToken } from "../auth/tokenStore";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface InsiderOwner {
  name: string;
  cik?: string;
  isDirector?: boolean;
  isOfficer?: boolean;
  isTenPercentOwner?: boolean;
  isOther?: boolean;
  officerTitle?: string;
  otherText?: string;
}

export interface InsiderRow {
  symbol: string;
  issuerName?: string;
  company?: string;
  cik?: string;
  formType: string;
  filedDate: string;
  periodOfReport?: string;
  accessionNumber?: string;
  filingUrl?: string;
  tenB5One?: boolean;
  owner: InsiderOwner | null;
  securityTitle?: string;
  transactionDate?: string;
  code: string;
  codeLabel: string;
  direction: "buy" | "sell" | "neutral";
  acquiredDisposed?: string;
  shares: number;
  pricePerShare: number;
  value: number;
  sharesOwnedAfter: number;
  directOrIndirect?: string;
  natureOfOwnership?: string;
  derivative?: boolean;
}

export interface InsiderSummary {
  buys: number;
  sells: number;
  buyShares: number;
  sellShares: number;
  netShares: number;
  insiders: number;
  latestDate: string;
}

export interface InsiderResponse {
  success: boolean;
  symbol?: string;
  cik?: string;
  filings?: unknown[];
  rows: InsiderRow[];
  summary?: InsiderSummary;
  counts?: { filings: number; feed: number; dailyIndex: number };
  error?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function fetchRecentInsiderFilings(limit = 25) {
  return fetchJson<InsiderResponse>(`${API_BASE}/insider/recent?limit=${limit}`);
}

export function fetchCompanyInsiderFilings(symbol: string, limit = 20) {
  return fetchJson<InsiderResponse>(`${API_BASE}/insider/${encodeURIComponent(symbol)}?limit=${limit}`);
}
