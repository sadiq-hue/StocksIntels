import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Loader2, Activity } from "lucide-react";
import { fetchFinancialReport } from "../services/financialsService";
import type { FinancialReport } from "../services/financialsService";

interface FinancialMetricsProps {
  symbol: string;
  sector: string;
  instrumentName?: string;
}

function formatLargeNum(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(1)}`;
}

function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !isFinite(v)) return "—";
  // Backend returns ratio metrics (ROE, margins, yields, growth) as decimals; display as %
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(decimals)}%`;
}

function ratio(v: number | null | undefined, decimals = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function badgeColor(value: number | null | undefined, good: (v: number) => boolean): string {
  if (value == null || !isFinite(value)) return "text-muted-foreground";
  return good(value) ? "text-emerald-600" : "text-red-500";
}

export function FinancialMetrics({ symbol, sector, instrumentName }: FinancialMetricsProps) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFinancialReport(symbol, "annual", 10)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) {
    return (
      <Card className="relative overflow-hidden border border-border shadow-sm h-full">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4"><span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><Activity className="size-3.5" /></span> Financial Health</h3>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </div>
      </Card>
    );
  }

  if (!report?.success || !report.data) {
    const isFund = /ETF|ETN|Feeder|AMETF|Index Fund/i.test(instrumentName || '') || /ETF|Fund/i.test(sector || '');
    return (
      <Card className="relative overflow-hidden border border-border shadow-sm h-full">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4"><span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><Activity className="size-3.5" /></span> Financial Health</h3>
          <p className="text-xs text-muted-foreground text-center py-8">
            {isFund
              ? 'This instrument is a fund/ETF — it does not report company financial statements.'
              : 'No financial statements are available for this instrument.'}
          </p>
        </div>
      </Card>
    );
  }

  const { keyMetrics, incomeStatement: incSt, incomeStatementHistory: incHist, balanceSheet: balSt, balanceSheetHistory: balHist, cashFlowStatement: cfSt } = report.data;
  const quote = report.data.quote;

  const km = keyMetrics;
  const inc = incSt;
  const bal = balSt;
  const cf = cfSt;

  const annualHist = (incHist || []).filter((h: any) => h?.periodType !== "TTM" && h?.period !== "ttm");
  const latestAnnual = annualHist[0] || null;
  const prevAnnual = annualHist[1] || null;

  const price = quote?.price || 0;
  const marketCap = quote?.marketCap || km?.marketCap || 0;

  const revenue = inc?.revenue ?? null;
  const revenueGrowth = latestAnnual?.revenue != null && prevAnnual?.revenue
    ? (latestAnnual.revenue - prevAnnual.revenue) / prevAnnual.revenue : null;

  const netIncome = inc?.netIncome ?? null;
  const epsGrowth = latestAnnual?.eps != null && prevAnnual?.eps != null && prevAnnual.eps !== 0
    ? (latestAnnual.eps - prevAnnual.eps) / Math.abs(prevAnnual.eps) : null;

  const operatingIncome = inc?.operatingIncome ?? null;
  const opMargin = inc?.operatingIncomeRatio ?? (revenue != null && operatingIncome != null && revenue !== 0
    ? operatingIncome / revenue : null);

  const equity = bal?.totalStockholdersEquity ?? bal?.totalEquity ?? null;
  const totalDebt = bal?.totalDebt ?? 0;
  const cash = bal?.cashAndCashEquivalents ?? 0;
  const currentAssets = bal?.totalCurrentAssets ?? 0;
  const currentLiabilities = bal?.totalCurrentLiabilities ?? 0;

  // Negative book equity makes ROE, P/B and D/E meaningless — show "—" instead
  // of a mathematically misleading positive/zero value.
  const roe = netIncome != null && equity != null && equity > 0 ? netIncome / equity : null;

  const pb = equity != null && equity > 0 && marketCap > 0
    ? marketCap / equity
    : (km?.pbRatio != null && km.pbRatio > 0 ? km.pbRatio : null);
  const ps = marketCap > 0 && revenue != null && revenue > 0
    ? marketCap / revenue
    : (km?.priceToSalesRatio != null && km.priceToSalesRatio > 0 ? km.priceToSalesRatio : null);
  const de = equity != null && equity > 0
    ? ((totalDebt > 0 ? totalDebt : (bal?.totalLiabilities ?? 0)) / equity)
    : null;

  const pe = quote?.pe != null && quote.pe > 0
    ? quote.pe
    : (price > 0 && inc?.eps != null && inc.eps > 0
      ? price / inc.eps
      : (km?.peRatio != null && km.peRatio > 0 ? km.peRatio : null));

  const currentRatio = currentLiabilities > 0
    ? currentAssets / currentLiabilities
    : (km?.currentRatio != null && km.currentRatio > 0 ? km.currentRatio : null);

  const taxRate = inc?.incomeTaxExpense != null && operatingIncome != null && operatingIncome > 0
    ? Math.min(0.6, Math.max(0, inc.incomeTaxExpense / operatingIncome))
    : 0;
  const nopat = operatingIncome != null ? operatingIncome * (1 - taxRate) : null;
  const investedCapital = (totalDebt || 0) + (equity || 0) - (cash || 0);
  const roic = nopat != null && investedCapital > 0 ? nopat / investedCapital : null;

  const fcf = cf?.freeCashFlow ?? null;
  const earningsYield = marketCap > 0 && netIncome != null
    ? netIncome / marketCap
    : (km?.earningsYield ?? null);
  const fcfYield = marketCap > 0 && fcf != null
    ? fcf / marketCap
    : (km?.freeCashFlowYield ?? null);
  // PEG uses earnings growth in percent, not as a decimal.
  const peg = pe != null && epsGrowth != null && epsGrowth !== 0 ? pe / (epsGrowth * 100) : null;

  const totalAssets = bal?.totalAssets ?? null;
  const totalLiabilities = bal?.totalLiabilities ?? null;
  const dy = km?.dividendYieldPercentage ?? null;

  return (
    <Card className="relative overflow-hidden border border-border shadow-sm h-full flex flex-col">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#0D7490]" />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4"><span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] text-white"><Activity className="size-3.5" /></span> Financial Health</h3>
        <div className="flex-1 space-y-4">
          {/* Profitability & Efficiency */}
          <div>
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2.5">Profitability</div>
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="ROIC" value={pct(roic, 1)} color={badgeColor(roic, v => v > 0.1)} sub="Return on Invested Capital" />
              <MetricBox label="ROE" value={pct(roe, 1)} color={badgeColor(roe, v => v > 0.15)} sub="Return on Equity" />
              <MetricBox label="Op. Margin" value={pct(opMargin, 1)} color={badgeColor(opMargin, v => v > 0.1)} sub="Operating Efficiency" />
              <MetricBox label="Net Margin" value={inc?.netIncomeRatio != null ? pct(inc.netIncomeRatio, 1) : "—"} color={badgeColor(inc?.netIncomeRatio, v => v > 0.05)} sub="Profit per Revenue $" />
            </div>
          </div>

          {/* Valuation */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2.5">Valuation</div>
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="P/E" value={ratio(pe, 1)} color={badgeColor(pe, v => v > 0 && v < 25)} sub="Price-to-Earnings" />
              <MetricBox label="P/B" value={ratio(pb, 1)} color={badgeColor(pb, v => v > 0 && v < 3)} sub="Price-to-Book" />
              <MetricBox label="P/S" value={ratio(ps, 1)} color={badgeColor(ps, v => v > 0 && v < 5)} sub="Price-to-Sales" />
              <MetricBox label="PEG" value={ratio(peg, 1)} color={badgeColor(peg, v => v > 0 && v < 1.5)} sub="P/E ÷ EPS Growth" />
            </div>
          </div>

          {/* Growth */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2.5">Growth</div>
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="Revenue Growth" value={pct(revenueGrowth, 1)} color={badgeColor(revenueGrowth, v => v > 0.05)} sub="Latest FY vs prior FY" />
              <MetricBox label="EPS Growth" value={pct(epsGrowth, 1)} color={badgeColor(epsGrowth, v => v > 0.05)} sub="Latest FY vs prior FY" />
              <MetricBox label="Free Cash Flow" value={fcf != null ? formatLargeNum(fcf) : "—"} color={badgeColor(fcf, v => v > 0)} sub="Operating CF − CapEx" />
              <MetricBox label="Earnings Yield" value={pct(earningsYield, 1)} color={badgeColor(earningsYield, v => v > 0.05)} sub="Net Income ÷ Market Cap" />
            </div>
          </div>

          {/* Financial Health */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2.5">Leverage & Liquidity</div>
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="D/E Ratio" value={ratio(de, 1)} color={badgeColor(de, v => v > 0 && v < 1.5)} sub="Debt-to-Equity" />
              <MetricBox label="Current Ratio" value={ratio(currentRatio, 1)} color={badgeColor(currentRatio, v => v > 1.5)} sub="Assets ÷ Liabilities" />
              <MetricBox label="FCF Yield" value={pct(fcfYield, 1)} color={badgeColor(fcfYield, v => v > 0.03)} sub="Free Cash Flow Yield" />
              <MetricBox label="Dividend Yield" value={dy != null ? `${dy.toFixed(2)}%` : "—"} color={badgeColor(dy, v => v > 0 && v < 8)} sub="Annual Dividend / Price" />
            </div>
          </div>

          {/* Balance Sheet Summary */}
          {(totalAssets != null || totalLiabilities != null) && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2.5">
                Balance Sheet{bal?.date ? <span className="text-muted-foreground font-medium normal-case tracking-normal"> · {bal.date}</span> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {totalAssets != null && <MetricBox label="Total Assets" value={formatLargeNum(totalAssets)} color="text-foreground" sub="Reported" />}
                {totalLiabilities != null && <MetricBox label="Total Liabilities" value={formatLargeNum(totalLiabilities)} color={totalLiabilities > (totalAssets ?? 0) * 0.7 ? "text-red-500" : "text-foreground"} sub="vs. Assets" />}
                {equity != null && <MetricBox label="Shareholders Equity" value={formatLargeNum(equity)} color={equity > 0 ? "text-emerald-600" : "text-red-500"} sub="Book Value" />}
                {revenue != null && <MetricBox label="Revenue (TTM)" value={formatLargeNum(revenue)} color="text-foreground" sub={inc?.date ? `TTM to ${inc.date}` : "Trailing 12 Months"} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function MetricBox({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
      <div className="text-[11px] font-medium text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{sub}</div>
    </div>
  );
}
