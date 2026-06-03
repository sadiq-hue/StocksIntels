import React, { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, Banknote, BarChart3, Building2, ChartBar, ChartNoAxesCombined,
  Database, ExternalLink, FileText, Globe, HandCoins, RefreshCw, Scale, Search,
  TrendingUp, Wallet,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { quickFinancialSymbols, type StockMarket } from "../data/stockUniverses";
import {
  fetchEdgarFilings, fetchFinancialReport, fetchFinancialsStatus,
  type BalanceSheet, type CashFlowStatement, type CompanyProfile, type CompanyQuote,
  type DataProvider, type DividendEvent, type EdgarFiling, type FinancialReport,
  type FinancialsStatus, type IncomeStatement, type KeyMetric,
} from "../services/financialsService";
import { useRealtimeQuotes } from "../contexts/RealtimeQuotesContext";

function formatCurrency(value: number, currency = "KES") {
  if (!Number.isFinite(value) || value === 0) return `${currency} 0`;
  return new Intl.NumberFormat("en-KE", {
    style: "currency", currency,
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
  }).format(value);
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function formatRatio(value: number, digits = 2) {
  if (!Number.isFinite(value) || value === 0) return "N/A";
  return value.toFixed(digits);
}

function toPercent(value: number) { return Number.isFinite(value) ? value * 100 : 0; }

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-KE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const PROVIDER_LABELS: Record<string, { label: string; color: string }> = {
  "sec-edgar": { label: "SEC EDGAR", color: "bg-blue-100 text-blue-800" },
  simfin: { label: "SimFin", color: "bg-orange-100 text-orange-800" },
  fmp: { label: "FMP", color: "bg-purple-100 text-purple-800" },
  synthetic: { label: "Estimated", color: "bg-amber-100 text-amber-800" },
};

interface HistoryMetric { label: string; key: string; kind?: "currency" | "percent" | "number"; calcGrowth?: boolean; }

function HorizontalStatementTable({ data, metrics, currency }: { data: any[]; metrics: HistoryMetric[]; currency: string }) {
  if (!data || data.length === 0) return <div className="p-12 text-center text-gray-300 text-sm font-medium">No historical data available</div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-sm text-right border-collapse">
        <thead>
          <tr className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200">
            <th className="text-left p-3.5 font-bold text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10 w-56 border-r border-gray-100 text-[11px]">Fiscal Year</th>
            {data.map((item, i) => (
              <th key={i} className="p-3.5 font-bold text-gray-900 whitespace-nowrap text-xs">FY {new Date(item.date).getFullYear()}</th>
            ))}
          </tr>
          <tr className="bg-white border-b border-gray-100">
            <th className="text-left p-3.5 font-medium text-gray-400 sticky left-0 bg-white z-10 border-r border-gray-100 text-[11px]">Period Ending</th>
            {data.map((item, i) => (
              <th key={i} className="p-3.5 font-medium text-gray-400 whitespace-nowrap text-[11px]">{formatDate(item.date)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m, mIdx) => (
            <React.Fragment key={mIdx}>
              <tr className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors group">
                <td className="text-left p-3.5 font-bold sticky left-0 z-10 border-r border-gray-100 text-gray-700 bg-white group-hover:bg-blue-50/30 text-xs">{m.label}</td>
                {data.map((item, i) => {
                  const val = item[m.key];
                  let content = "N/A";
                  if (typeof val === 'number') {
                    if (m.kind === 'currency') content = formatCurrency(val, currency);
                    else if (m.kind === 'percent') content = formatPercent(val);
                    else content = formatCompactNumber(val);
                  }
                  return <td key={i} className="p-3.5 font-semibold text-gray-900 text-xs">{content}</td>;
                })}
              </tr>
              {m.calcGrowth && (
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <td className="text-left p-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider sticky left-0 bg-gray-50/50 z-10 border-r border-gray-100">Growth (YoY)</td>
                  {data.map((item, i) => {
                    const nextItem = data[i + 1];
                    if (!nextItem || !item[m.key] || !nextItem[m.key]) return <td key={i} className="p-2.5 text-gray-300 text-[11px]">—</td>;
                    const growth = ((item[m.key] - nextItem[m.key]) / nextItem[m.key]) * 100;
                    return (
                      <td key={i} className={`p-2.5 font-bold text-[11px] ${growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {growth >= 0 ? '+' : ''}{growth.toFixed(2)}%
                      </td>
                    );
                  })}
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || !PROVIDER_LABELS[source]) return null;
  const info = PROVIDER_LABELS[source];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${info.color}`}>
      <Database className="w-2.5 h-2.5" />
      {info.label}
    </span>
  );
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseDelayDays(delay: number | null | undefined): { label: string; color: string } {
  if (delay == null) return { label: 'N/A', color: 'text-gray-400' };
  if (delay <= 40) return { label: `${delay}d (on time)`, color: 'text-emerald-600' };
  if (delay <= 60) return { label: `${delay}d`, color: 'text-amber-600' };
  return { label: `${delay}d (late)`, color: 'text-red-600' };
}

function getCikFromAccNo(accNo: string): string { return accNo?.split('-')[0] || ''; }

function buildAccNoPath(accNo: string): string { return (accNo || '').replace(/-/g, ''); }

function FilingCard({ filing }: { filing: EdgarFiling }) {
  const delay = parseDelayDays(filing.delayDays);
  const is10K = filing.form === '10-K';
  const reportYear = filing.reportDate ? new Date(filing.reportDate).getFullYear() : null;
  const quarterMatch = filing.description?.match(/Q([1-4])/i);
  const quarterLabel = quarterMatch ? `Q${quarterMatch[1]}` : '';
  const cik = getCikFromAccNo(filing.accessionNumber);
  const accPath = buildAccNoPath(filing.accessionNumber);

  const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
  const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

  return (
    <div className="px-5 py-4 hover:bg-blue-50/20 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded ${is10K ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>{filing.form}</span>
              {quarterLabel && <span className="text-[10px] font-bold text-gray-500 uppercase">{quarterLabel}</span>}
              {reportYear && <span className="text-[10px] font-bold text-gray-400">FY {reportYear}</span>}
            </div>
            <p className="text-sm font-semibold text-gray-900">{filing.description || `${filing.form} Filing — ${fmtD(filing.reportDate)}`}</p>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Timeline</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[11px]">
              <div><span className="text-gray-400">Filed:</span> <span className="font-medium text-gray-700">{fmtD(filing.filingDate)}</span></div>
              <div><span className="text-gray-400">Period:</span> <span className="font-medium text-gray-700">{fmtD(filing.reportDate)}</span></div>
              <div><span className="text-gray-400">Accepted:</span> <span className="font-medium text-gray-700">{fmtDT(filing.acceptanceDate)}</span></div>
              <div><span className="text-gray-400">Delay:</span> <span className={`font-medium ${delay.color}`}>{delay.label}</span></div>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">IDs</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
              <div><span className="text-gray-400">Accession:</span> <span className="font-mono font-medium text-gray-700 text-[10px]">{filing.accessionNumber || 'N/A'}</span></div>
              <div><span className="text-gray-400">Film:</span> <span className="font-medium text-gray-700">{filing.filmNumber || 'N/A'}</span></div>
              <div><span className="text-gray-400">File:</span> <span className="font-medium text-gray-700">{filing.fileNumber || 'N/A'}</span></div>
              <div><span className="text-gray-400">Items:</span> <span className="font-medium text-gray-700 truncate">{filing.items || 'N/A'}</span></div>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Document</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
              <div className="md:col-span-2"><span className="text-gray-400">Doc:</span> <span className="font-mono font-medium text-gray-700 text-[10px]">{filing.primaryDocument || 'N/A'}</span></div>
              <div><span className="text-gray-400">Size:</span> <span className="font-medium text-gray-700">{formatFileSize(filing.size) || 'N/A'}</span></div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${filing.isXBRL === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>XBRL</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${filing.isInlineXBRL === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>Inline</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0 min-w-[120px]">
          <a href={filing.documentUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#0D7490] hover:bg-[#0A5F7A] px-3 py-1.5 rounded-lg transition-colors">
            <ExternalLink className="w-3 h-3" /> View Filing
          </a>
          <a href={`https://www.sec.gov/Archives/edgar/data/${cik}/${accPath}/${filing.primaryDocument}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors">
            <FileText className="w-3 h-3" /> Raw HTML
          </a>
          {filing.isXBRL === 1 && (
            <a href={`https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${filing.accessionNumber}&xbrl=1`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 px-3 py-1.5 rounded-lg transition-colors">
              <Database className="w-3 h-3" /> XBRL Viewer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, positive, negative }: { label: string; value: string; sub?: string; icon: React.ReactNode; positive?: boolean; negative?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
        <span className={`${positive ? 'text-emerald-500' : negative ? 'text-rose-500' : 'text-[#0D7490]'}`}>{icon}</span>
      </div>
      <p className={`text-xl font-black tracking-tight ${positive ? 'text-emerald-600' : negative ? 'text-rose-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function FinancialsPage() {
  const [status, setStatus] = useState<FinancialsStatus | null>(null);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [symbolInput, setSymbolInput] = useState("AAPL");
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [selectedMarket, setSelectedMarket] = useState<StockMarket>("global");
  const [period, setPeriod] = useState<"annual" | "quarter">("annual");
  const [provider, setProvider] = useState<DataProvider>("auto");
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filings, setFilings] = useState<EdgarFiling[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [showQuickSymbols, setShowQuickSymbols] = useState(false);
  const { getQuote } = useRealtimeQuotes();
  const contextSymbol = selectedMarket === "nse" ? `NSE:${selectedSymbol}` : selectedSymbol;
  const liveQuote = getQuote(contextSymbol);

  useEffect(() => { fetchFinancialsStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    const limit = period === "annual" ? 4 : 6;
    fetchFinancialReport(selectedSymbol, period, limit, provider)
      .then((payload) => {
        if (!active) return;
        if (!payload.success) throw new Error(payload.error || "Unable to load financial report");
        setReport(payload);
      })
      .catch((err: Error) => { if (!active) return; setError(err.message || "Failed to load financial report"); })
      .finally(() => { if (!active) return; setIsLoading(false); setIsRefreshing(false); });

    setFilingsLoading(true);
    fetchEdgarFilings(selectedSymbol, 20)
      .then((data) => { if (active) setFilings(data.filings || []); })
      .catch(() => { if (active) setFilings([]); })
      .finally(() => { if (active) setFilingsLoading(false); });

    return () => { active = false; };
  }, [selectedSymbol, period, refreshKey, provider]);

  const profile = report?.data.profile as CompanyProfile | undefined;
  const reportQuote = report?.data.quote as CompanyQuote | undefined;
  const baseQuote: CompanyQuote = reportQuote || { symbol: selectedSymbol, price: 0, change: 0, changesPercentage: 0, dayLow: 0, dayHigh: 0, yearLow: 0, yearHigh: 0, marketCap: 0, volume: 0, avgVolume: 0, open: 0, previousClose: 0, eps: 0, pe: 0, sharesOutstanding: 0, lastUpdated: "" };
  const quote = liveQuote ? { ...baseQuote, symbol: liveQuote.symbol, price: liveQuote.price, change: liveQuote.change, changesPercentage: liveQuote.changePercent, volume: liveQuote.volume, dayHigh: liveQuote.dayHigh, dayLow: liveQuote.dayLow, previousClose: liveQuote.previousClose, lastUpdated: new Date(liveQuote.timestamp * 1000).toISOString() } : reportQuote;
  const income = report?.data.incomeStatement as IncomeStatement | null | undefined;
  const balance = report?.data.balanceSheet as BalanceSheet | null | undefined;
  const cashFlow = report?.data.cashFlowStatement as CashFlowStatement | null | undefined;
  const metrics = report?.data.keyMetrics as KeyMetric | null | undefined;
  const dividends = report?.data.dividendHistory as DividendEvent[] | undefined;
  const activeSource = report?.source || "synthetic";
  const availableProviders = (report?.availableProviders || ["fmp"]) as DataProvider[];

  const incHistory = report?.data.incomeStatementHistory || [];
  const balHistory = report?.data.balanceSheetHistory || [];
  const cfHistory = report?.data.cashFlowStatementHistory || [];
  const metHistory = (report?.data.keyMetricsHistory || []).map(m => ({ ...m, dividendYieldPercentage: m.dividendYieldPercentage || toPercent(m.dividendYield) }));

  const tabs = ["summary", "income", "balance", "cashflow", "metrics", "filings"];

  const performanceData = useMemo(() =>
    incHistory.slice().reverse().map(i => ({ period: formatDate(i.date), revenue: i.revenue / 1_000_000_000, netIncome: i.netIncome / 1_000_000_000, ebitda: i.ebitda / 1_000_000_000 })),
  [incHistory]);

  const capitalData = useMemo(() =>
    balHistory.slice().reverse().map(i => ({ period: formatDate(i.date), assets: i.totalAssets / 1_000_000_000, liabilities: i.totalLiabilities / 1_000_000_000, equity: i.totalEquity / 1_000_000_000 })),
  [balHistory]);

  const cfChartData = useMemo(() =>
    cfHistory.slice().reverse().map(i => ({ period: formatDate(i.date), ocf: i.operatingCashFlow / 1_000_000_000, fcf: i.freeCashFlow / 1_000_000_000, capex: Math.abs(i.capitalExpenditure) / 1_000_000_000 })),
  [cfHistory]);

  const handleSubmit = () => {
    const next = symbolInput.trim().toUpperCase();
    if (!next) return;
    setSelectedSymbol(next);
    setSelectedMarket(quickFinancialSymbols.find((item) => item.symbol === next)?.market || "global");
  };

  const handleRefresh = () => { setIsRefreshing(true); setRefreshKey((c) => c + 1); };

  const latestInc = incHistory[0];
  const latestMet = metHistory[0];

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6 bg-gray-50/50 min-h-screen">
      {/* ─── Company Header ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] flex items-center justify-center text-white font-black text-lg shrink-0">
              {selectedSymbol.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-black text-gray-900 tracking-tight">{profile?.companyName || selectedSymbol} <span className="text-gray-400 font-bold">({selectedSymbol})</span></h1>
                <SourceBadge source={activeSource} />
                <div className={`h-2 w-2 rounded-full ${status?.edgarConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
              </div>
              <p className="text-xs font-semibold text-gray-500 mt-1 flex items-center gap-2">
                {profile?.exchange || "NYSE"} · {profile?.industry || "N/A"} · {profile?.currency || "USD"}
              </p>
            </div>
          </div>
          <div className="flex items-end flex-col md:items-end">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-black text-gray-900">{formatCurrency(quote?.price || 0, profile?.currency || "USD")}</span>
              <span className={`text-lg font-bold ${quote && quote.change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {quote && quote.change >= 0 ? "+" : ""}{quote?.change.toFixed(2)} ({formatPercent(quote?.changesPercentage || 0, 2)})
              </span>
            </div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-1">Close: {formatDateTime(quote?.lastUpdated)}</p>
          </div>
        </div>
      </div>

      {/* ─── KPI Row ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Market Cap" value={formatCompactNumber(quote?.marketCap || 0)} sub={profile?.currency || "USD"} icon={<Globe className="w-4 h-4" />} />
        <KpiCard label="P/E Ratio" value={formatRatio(latestMet?.peRatio || quote?.pe || 0)} sub="Trailing 12M" icon={<Activity className="w-4 h-4" />} />
        <KpiCard label="Revenue" value={formatCurrency(latestInc?.revenue || 0, profile?.currency || "USD")} sub={latestInc?.date ? formatDate(latestInc.date) : ''} icon={<BarChart3 className="w-4 h-4" />} />
        <KpiCard label="Net Income" value={formatCurrency(latestInc?.netIncome || 0, profile?.currency || "USD")} sub={`Margin ${formatPercent(latestInc?.netIncomeRatio ? latestInc.netIncomeRatio * 100 : 0, 1)}`} icon={<Wallet className="w-4 h-4" />} positive />
        <KpiCard label="EPS" value={formatRatio(latestInc?.eps || 0, 2)} sub={`Diluted: ${formatRatio(latestInc?.epsdiluted || 0, 2)}`} icon={<ChartBar className="w-4 h-4" />} />
        <KpiCard label="Div Yield" value={formatPercent(latestMet?.dividendYieldPercentage || toPercent(metrics?.dividendYield || 0), 2)} sub={dividends?.length ? `${dividends.length} payments` : ''} icon={<HandCoins className="w-4 h-4" />} />
      </div>

      {/* ─── Search & Controls Toolbar ─── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input value={symbolInput} onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} className="pl-9 h-9 text-sm" placeholder="Search ticker..." />
          </div>
          <Button onClick={handleSubmit} className="bg-[#0D7490] hover:bg-[#0A5F7A] h-9 text-xs font-bold">Load</Button>

          <div className="h-6 w-px bg-gray-200 mx-1 hidden md:block" />

          <div className="flex bg-gray-100 p-0.5 rounded-lg">
            <button onClick={() => setPeriod("annual")} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${period === 'annual' ? 'bg-white text-[#0D7490] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Annual</button>
            <button onClick={() => setPeriod("quarter")} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${period === 'quarter' ? 'bg-white text-[#0D7490] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Quarterly</button>
          </div>

          <div className="h-6 w-px bg-gray-200 mx-1 hidden md:block" />

          <div className="flex items-center gap-1.5 flex-wrap">
            {(["auto", "sec-edgar", "simfin", "fmp"] as DataProvider[]).map((p) => {
              const enabled = p === "auto" || availableProviders.includes(p);
              const info = PROVIDER_LABELS[p];
              return (
                <button key={p} onClick={() => enabled && setProvider(p)} disabled={!enabled}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md transition-all ${
                    provider === p ? 'bg-[#0D7490] text-white shadow-sm' : enabled ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                  }`}>
                  {info?.label || p}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading || isRefreshing} className="text-gray-400 hover:text-[#0D7490] h-8">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading || isRefreshing ? "animate-spin" : ""}`} />
              <span className="text-[10px] font-bold">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Quick Symbols */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider shrink-0">Quick:</span>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {(["nse", "global"] as const).flatMap(m => quickFinancialSymbols.filter(i => i.market === m)).slice(0, 15).map((item) => (
              <button key={`${item.market}-${item.symbol}`} onClick={() => { setSymbolInput(item.symbol); setSelectedSymbol(item.symbol); setSelectedMarket(item.market); }}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all whitespace-nowrap ${
                  selectedSymbol === item.symbol ? 'border-[#0D7490] bg-[#0D7490]/10 text-[#0D7490]' : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}>
                {item.symbol}
              </button>
            ))}
            {quickFinancialSymbols.length > 15 && (
              <button onClick={() => setShowQuickSymbols(!showQuickSymbols)}
                className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 whitespace-nowrap">
                +{quickFinancialSymbols.length - 15} more
              </button>
            )}
          </div>
        </div>
        {showQuickSymbols && (
          <div className="mt-2 flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
            {quickFinancialSymbols.slice(15).map((item) => (
              <button key={`${item.market}-${item.symbol}`} onClick={() => { setSymbolInput(item.symbol); setSelectedSymbol(item.symbol); setSelectedMarket(item.market); setShowQuickSymbols(false); }}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                  selectedSymbol === item.symbol ? 'border-[#0D7490] bg-[#0D7490]/10 text-[#0D7490]' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                {item.symbol}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Main Content ─── */}
      {isLoading && !report && !error ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-[#0D7490] border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-sm font-bold text-gray-500">Loading financial data for {selectedSymbol}...</p>
            <p className="text-xs text-gray-400 mt-1">Fetching from {PROVIDER_LABELS[activeSource]?.label || activeSource}</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl border border-rose-200 p-12 text-center">
          <div className="text-rose-500 font-black text-4xl mb-3">!</div>
          <p className="text-sm font-bold text-gray-900 mb-1">Failed to load data</p>
          <p className="text-xs text-gray-500 mb-4">{error}</p>
          <Button onClick={handleRefresh} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-xs">Try Again</Button>
        </div>
      ) : (
        <Tabs defaultValue="summary" className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <TabsList className="w-full h-auto bg-transparent p-0 rounded-none flex flex-wrap">
              {tabs.map((tab) => (
                <TabsTrigger key={tab} value={tab}
                  className="flex-1 min-w-0 px-3 py-3.5 capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-[#0D7490] data-[state=active]:bg-[#0D7490]/5 data-[state=active]:text-[#0D7490] text-gray-500 font-bold text-xs md:text-sm hover:text-gray-700 transition-all">
                  {tab === "summary" ? <><ChartNoAxesCombined className="w-3.5 h-3.5 mr-1.5 hidden md:inline-block" /> Summary</> : tab === "income" ? "Income" : tab === "balance" ? "Balance" : tab === "cashflow" ? "Cash Flow" : tab === "metrics" ? "Ratios" : "Filings"}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ═══ SUMMARY TAB ═══ */}
          <TabsContent value="summary" className="mt-0 outline-none space-y-5">
            {/* Performance & Capital Charts */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-[#0D7490]" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Revenue & Net Income</h3>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded">{profile?.currency || "USD"} (B)</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={performanceData}>
                    <defs>
                      <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0D7490" stopOpacity={0.3} /><stop offset="95%" stopColor="#0D7490" stopOpacity={0} /></linearGradient>
                      <linearGradient id="incG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16A34A" stopOpacity={0.25} /><stop offset="95%" stopColor="#16A34A" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="period" stroke="#9CA3AF" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <YAxis stroke="#9CA3AF" tickFormatter={(v) => `${v}B`} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}B`, '']} />
                    <Area type="monotone" dataKey="revenue" stroke="#0D7490" fill="url(#revG)" strokeWidth={2.5} name="Revenue" />
                    <Area type="monotone" dataKey="netIncome" stroke="#16A34A" fill="url(#incG)" strokeWidth={2} name="Net Income" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-[#0D7490]" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Capital Structure</h3>
                  </div>
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded">{profile?.currency || "USD"} (B)</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={capitalData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="period" stroke="#9CA3AF" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <YAxis stroke="#9CA3AF" tickFormatter={(v) => `${v}B`} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}B`, '']} />
                    <Bar dataKey="assets" fill="#0D7490" radius={[4, 4, 0, 0]} name="Assets" />
                    <Bar dataKey="liabilities" fill="#F59E0B" radius={[4, 4, 0, 0]} name="Liabilities" />
                    <Bar dataKey="equity" fill="#16A34A" radius={[4, 4, 0, 0]} name="Equity" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Key Ratios Grid */}
            <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-[#0D7490]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Key Financial Ratios</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {[["P/E", latestMet?.peRatio || quote?.pe || 0, "number"], ["P/B", latestMet?.pbRatio || 0, "number"], ["P/S", latestMet?.priceToSalesRatio || 0, "number"],
                  ["D/E", latestMet?.debtToEquity || 0, "number"], ["Current Ratio", latestMet?.currentRatio || 0, "number"], ["Div. Yield", latestMet?.dividendYieldPercentage || toPercent(metrics?.dividendYield || 0), "percent"],
                ].map(([label, val, kind]) => (
                  <div key={label as string} className="bg-gray-50 rounded-xl p-3.5 border border-gray-100">
                    <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{label as string}</p>
                    <p className="text-lg font-black text-gray-900 mt-0.5">{kind === 'percent' ? formatPercent(val as number, 1) : formatRatio(val as number)}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Company Snapshot */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="w-4 h-4 text-[#0D7490]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Company Snapshot</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[["Industry", profile?.industry || "N/A"], ["Sector", profile?.sector || "N/A"], ["CEO", profile?.ceo || "N/A"], ["Employees", formatCompactNumber(profile?.employees || 0)],
                    ["Country", profile?.country || "N/A"], ["Exchange", profile?.exchange || "N/A"], ["Currency", profile?.currency || "USD"], ["CIK", String(profile?.cik || "N/A")],
                  ].map(([label, value]) => (
                    <div key={label as string} className="border-b border-gray-50 pb-1.5">
                      <p className="text-[10px] font-bold uppercase text-gray-400">{label as string}</p>
                      <p className="text-sm font-bold text-gray-900 truncate">{value as string}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
                <div className="flex items-center gap-2 mb-4">
                  <HandCoins className="w-4 h-4 text-[#0D7490]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Dividend History</h3>
                  <span className="text-[10px] text-gray-400 ml-auto">{dividends?.length || 0} events</span>
                </div>
                <div className="space-y-1.5">
                  {(dividends || []).slice(0, 6).map((item) => (
                    <div key={item.date} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-xs font-semibold text-gray-700">{formatDate(item.date)}</span>
                      <span className="text-xs font-bold text-emerald-600">{formatCurrency(item.dividend || item.adjDividend)}</span>
                    </div>
                  ))}
                  {!dividends?.length && <p className="text-sm text-gray-400 py-4 text-center">No dividend history available</p>}
                </div>
              </Card>
            </div>

            {/* Data Sources Info */}
            <Card className="border-gray-200 bg-white p-5 shadow-sm rounded-xl">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-[#0D7490]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Data Sources</h3>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                <div className="flex items-center gap-2"><span className="text-gray-400">Active:</span> <SourceBadge source={activeSource} /></div>
                <div className="flex items-center gap-2"><span className="text-gray-400">Available:</span> <span className="font-bold">{availableProviders.length} provider{availableProviders.length > 1 ? 's' : ''}</span></div>
                <div className="flex items-center gap-2"><span className="text-gray-400">Filings:</span> <span className="font-bold">{filings.length}</span></div>
                {report?.lastUpdated && <div className="flex items-center gap-2"><span className="text-gray-400">Updated:</span> <span className="font-bold">{formatDateTime(report.lastUpdated)}</span></div>}
              </div>
            </Card>
          </TabsContent>

          {/* ═══ INCOME STATEMENT ═══ */}
          <TabsContent value="income" className="mt-0 outline-none">
            <HorizontalStatementTable currency={profile?.currency || "USD"}
              metrics={[
                { label: "Revenue", key: "revenue", kind: "currency", calcGrowth: true },
                { label: "Cost of Revenue", key: "costOfRevenue", kind: "currency" },
                { label: "Gross Profit", key: "grossProfit", kind: "currency", calcGrowth: true },
                { label: "Operating Expenses", key: "operatingExpenses", kind: "currency" },
                { label: "Operating Income", key: "operatingIncome", kind: "currency", calcGrowth: true },
                { label: "Net Income", key: "netIncome", kind: "currency", calcGrowth: true },
                { label: "EPS (Diluted)", key: "eps", kind: "number" },
                { label: "EBITDA", key: "ebitda", kind: "currency" },
              ]}
              data={incHistory} />
          </TabsContent>

          {/* ═══ BALANCE SHEET ═══ */}
          <TabsContent value="balance" className="mt-0 outline-none">
            <HorizontalStatementTable currency={profile?.currency || "USD"}
              metrics={[
                { label: "Total Assets", key: "totalAssets", kind: "currency", calcGrowth: true },
                { label: "Current Assets", key: "totalCurrentAssets", kind: "currency" },
                { label: "Cash & Equivalents", key: "cashAndCashEquivalents", kind: "currency" },
                { label: "Total Liabilities", key: "totalLiabilities", kind: "currency" },
                { label: "Current Liabilities", key: "totalCurrentLiabilities", kind: "currency" },
                { label: "Long-Term Debt", key: "totalDebt", kind: "currency" },
                { label: "Total Equity", key: "totalEquity", kind: "currency", calcGrowth: true },
                { label: "Retained Earnings", key: "retainedEarnings", kind: "currency" },
              ]}
              data={balHistory} />
          </TabsContent>

          {/* ═══ CASH FLOW ═══ */}
          <TabsContent value="cashflow" className="mt-0 outline-none">
            <HorizontalStatementTable currency={profile?.currency || "USD"}
              metrics={[
                { label: "Operating Cash Flow", key: "operatingCashFlow", kind: "currency", calcGrowth: true },
                { label: "Capital Expenditure", key: "capitalExpenditure", kind: "currency" },
                { label: "Free Cash Flow", key: "freeCashFlow", kind: "currency", calcGrowth: true },
                { label: "Dividends Paid", key: "dividendsPaid", kind: "currency" },
                { label: "Net Change in Cash", key: "netChangeInCash", kind: "currency" },
              ]}
              data={cfHistory} />
          </TabsContent>

          {/* ═══ RATIOS ═══ */}
          <TabsContent value="metrics" className="mt-0 outline-none">
            <HorizontalStatementTable currency={profile?.currency || "USD"}
              metrics={[
                { label: "P/E Ratio", key: "peRatio", kind: "number" },
                { label: "P/B Ratio", key: "pbRatio", kind: "number" },
                { label: "P/S Ratio", key: "priceToSalesRatio", kind: "number" },
                { label: "Debt / Equity", key: "debtToEquity", kind: "number" },
                { label: "Dividend Yield", key: "dividendYieldPercentage", kind: "percent" },
                { label: "Current Ratio", key: "currentRatio", kind: "number" },
                { label: "Revenue / Share", key: "revenuePerShare", kind: "number" },
                { label: "Net Income / Share", key: "netIncomePerShare", kind: "number" },
              ]}
              data={metHistory} />
          </TabsContent>

          {/* ═══ SEC FILINGS ═══ */}
          <TabsContent value="filings" className="mt-0 outline-none space-y-5">
            {filingsLoading && filings.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-bold">Loading SEC filings...</p>
                <p className="text-xs text-gray-400 mt-1">Retrieving from SEC EDGAR database</p>
              </div>
            ) : filings.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-bold">
                  {selectedMarket === "nse" ? "SEC EDGAR filings only available for US stocks" : "No SEC EDGAR filings found"}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {selectedMarket === "nse" ? "NSE stocks file with the Nairobi Securities Exchange" : "Verify the ticker symbol"}
                </p>
              </div>
            ) : (
              <>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50/30 border border-blue-100 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-[#0D7490]" />
                        <h3 className="text-lg font-bold text-gray-900">SEC EDGAR Filings — {selectedSymbol}</h3>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Retrieved directly from the SEC EDGAR database</p>
                    </div>
                    <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${selectedSymbol}&type=10-K`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#0D7490] hover:underline font-medium flex items-center gap-1">SEC.gov <ExternalLink className="w-3 h-3" /></a>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    {(() => {
                      const total = filings.length; const tensKs = filings.filter(f => f.form === '10-K').length; const tensQs = filings.filter(f => f.form === '10-Q').length;
                      const dates = filings.filter(f => f.filingDate).map(f => new Date(f.filingDate));
                      const newest = dates.length ? dates.reduce((a, b) => a > b ? a : b) : null;
                      const oldest = dates.length ? dates.reduce((a, b) => a < b ? a : b) : null;
                      const delays = filings.filter(f => f.delayDays != null).map(f => f.delayDays as number);
                      const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;
                      const onTime = delays.filter(d => d <= 60).length;
                      const onTimePct = delays.length ? Math.round((onTime / delays.length) * 100) : null;
                      const xbrlCount = filings.filter(f => f.isXBRL === 1).length;
                      return [
                        { label: "Total", value: String(total) },
                        { label: "10-K", value: String(tensKs) },
                        { label: "10-Q", value: String(tensQs) },
                        { label: "Range", value: oldest && newest ? `${oldest.getFullYear()}-${newest.getFullYear()}` : 'N/A' },
                        { label: "Avg Delay", value: avgDelay !== null ? `${avgDelay}d` : 'N/A', color: avgDelay !== null && avgDelay > 60 ? 'text-rose-600' : 'text-emerald-600' },
                        { label: "On Time", value: onTimePct !== null ? `${onTimePct}%` : 'N/A', sub: `${onTime}/${delays.length}` },
                        { label: "XBRL", value: String(xbrlCount), sub: xbrlCount > 0 ? `${Math.round((xbrlCount / total) * 100)}%` : '' },
                      ].map((s) => (
                        <div key={s.label} className="bg-white rounded-lg border border-blue-100 p-3">
                          <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{s.label}</p>
                          <p className={`text-lg font-black mt-0.5 ${s.color || 'text-gray-900'}`}>{s.value}</p>
                          {s.sub && <p className="text-[10px] text-gray-400">{s.sub}</p>}
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {(() => {
                  const grouped: Record<string, EdgarFiling[]> = {};
                  for (const f of filings) { const y = f.reportDate ? new Date(f.reportDate).getFullYear().toString() : 'Unknown'; if (!grouped[y]) grouped[y] = []; grouped[y].push(f); }
                  return Object.keys(grouped).sort().reverse().map((year) => {
                    const yf = grouped[year]; const af = yf.find(f => f.form === '10-K'); const qf = yf.filter(f => f.form === '10-Q').sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || ''));
                    return (
                      <div key={year} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-gray-900">Fiscal Year {year}</span>
                            {af && <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">10-K</span>}
                            {qf.length > 0 && <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded">{qf.length}× 10-Q</span>}
                          </div>
                          <span className="text-[10px] text-gray-400">{yf.length} filing{yf.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {af && <FilingCard filing={af} />}
                          {qf.map((f, i) => <FilingCard key={i} filing={f} />)}
                        </div>
                      </div>
                    );
                  });
                })()}

                <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 text-[10px] text-gray-400">
                  <span>Data from SEC EDGAR public API</span>
                  <span>10-K (Annual) • 10-Q (Quarterly)</span>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
