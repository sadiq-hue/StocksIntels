import { getToken } from "../auth/tokenStore";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export type DataProvider = "auto" | "sec-edgar" | "simfin" | "fmp" | "yahoo-finance" | "synthetic";

export interface EdgarFiling {
  form: string;
  description: string;
  filingDate: string;
  reportDate: string;
  acceptanceDate?: string;
  documentUrl: string;
  primaryDocument: string;
  accessionNumber: string;
  filmNumber?: string;
  fileNumber?: string;
  size?: number | null;
  isXBRL?: number;
  isInlineXBRL?: number;
  items?: string;
  delayDays?: number | null;
}

export interface FinancialsStatus {
  providerConfigured: boolean;
  provider: string;
  edgarConfigured: boolean;
  edgarApiKeyConfigured: boolean;
  simfinConfigured: boolean;
  simfinApiKeyConfigured: boolean;
  yahooFinanceConfigured: boolean;
  message: string;
}

export interface CompanyProfile {
  symbol: string;
  companyName: string;
  industry: string;
  sector: string;
  country: string;
  website: string;
  description: string;
  ceo: string;
  employees: number;
  marketCap: number;
  exchange: string;
  currency: string;
  image?: string;
  lastUpdated: string;
}

export interface CompanyQuote {
  symbol: string;
  price: number;
  change: number;
  changesPercentage: number;
  dayLow: number;
  dayHigh: number;
  yearLow: number;
  yearHigh: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  sharesOutstanding: number;
  lastUpdated: string;
}

export interface IncomeStatement {
  date: string;
  period: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  grossProfitRatio: number;
  operatingExpenses: number;
  operatingIncome: number;
  operatingIncomeRatio: number;
  netIncome: number;
  netIncomeRatio: number;
  ebitda: number;
  incomeTaxExpense: number;
  interestExpense: number;
  eps: number;
  epsdiluted: number;
}

export interface BalanceSheet {
  date: string;
  period: string;
  cashAndCashEquivalents: number;
  inventory: number;
  totalCurrentAssets: number;
  totalNonCurrentAssets: number;
  totalAssets: number;
  totalCurrentLiabilities: number;
  totalNonCurrentLiabilities: number;
  totalLiabilities: number;
  retainedEarnings: number;
  totalStockholdersEquity: number;
  totalEquity: number;
  totalDebt: number;
  netDebt: number;
}

export interface CashFlowStatement {
  date: string;
  period: string;
  netIncome: number;
  operatingCashFlow: number;
  capitalExpenditure: number;
  freeCashFlow: number;
  netCashProvidedByOperatingActivities: number;
  netCashUsedForInvestingActivites: number;
  netCashUsedProvidedByFinancingActivities: number;
  netChangeInCash: number;
  cashAtEndOfPeriod: number;
  cashAtBeginningOfPeriod: number;
  dividendsPaid: number;
}

export interface KeyMetric {
  date: string;
  period: string;
  marketCap: number;
  peRatio: number;
  priceToSalesRatio: number;
  pbRatio: number;
  debtToEquity: number;
  currentRatio: number;
  dividendYield: number;
  dividendYieldPercentage: number;
  payoutRatio: number;
  netDebtToEBITDA: number;
  earningsYield: number;
  freeCashFlowYield: number;
  revenuePerShare: number;
  netIncomePerShare: number;
  operatingCashFlowPerShare: number;
  freeCashFlowPerShare: number;
}

export interface DividendEvent {
  date: string;
  adjDividend: number;
  dividend: number;
  recordDate: string | null;
  paymentDate: string | null;
  declarationDate: string | null;
}

export interface FinancialReport {
  success: boolean;
  symbol: string;
  source?: string;
  availableProviders?: string[];
  lastUpdated: string;
  data: {
    profile: CompanyProfile;
    quote: CompanyQuote;
    incomeStatement: IncomeStatement | null;
    incomeStatementHistory: IncomeStatement[];
    balanceSheet: BalanceSheet | null;
    balanceSheetHistory: BalanceSheet[];
    cashFlowStatement: CashFlowStatement | null;
    cashFlowStatementHistory: CashFlowStatement[];
    keyMetrics: KeyMetric | null;
    keyMetricsHistory: KeyMetric[];
    dividendHistory: DividendEvent[];
    filings?: EdgarFiling[];
  };
  error?: string;
}

function getUserId(): string | null {
  try {
    const stored = localStorage.getItem("stockintel_user");
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.id ? String(parsed.id) : null;
    }
  } catch {}
  return null;
}

function appendUserId(url: string): string {
  const userId = getUserId();
  if (!userId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}userId=${userId}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(appendUserId(url), { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchFinancialsStatus() {
  return fetchJson<FinancialsStatus>(`${API_BASE}/financials/status`);
}

export function fetchFinancialReport(symbol: string, period: "annual" | "quarter" = "annual", limit = 4, provider?: DataProvider) {
  let url = `${API_BASE}/financials/${encodeURIComponent(symbol)}?period=${period}&limit=${limit}`;
  if (provider && provider !== "auto") url += `&provider=${provider}`;
  return fetchJson<FinancialReport>(url);
}

export function fetchEdgarFilings(symbol: string, limit = 10) {
  return fetchJson<{ success: boolean; symbol: string; filings: EdgarFiling[]; count: number }>(
    `${API_BASE}/financials/${encodeURIComponent(symbol)}/filings?limit=${limit}`
  );
}

export function fetchEdgarReport(symbol: string, period: "annual" | "quarter" = "annual", limit = 4) {
  return fetchJson<FinancialReport>(
    `${API_BASE}/financials/${encodeURIComponent(symbol)}/edgar?period=${period}&limit=${limit}`
  );
}
