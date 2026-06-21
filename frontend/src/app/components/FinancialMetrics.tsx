import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Loader2 } from "lucide-react";
import { fetchFinancialReport } from "../services/financialsService";
import type { FinancialReport } from "../services/financialsService";

interface FinancialMetricsProps {
  symbol: string;
  sector: string;
}

function formatLargeNum(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(1)}`;
}

function pct(v: number | null | undefined, decimals = 1): string {
  if (v == null || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function ratio(v: number | null | undefined, decimals = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function badgeColor(value: number | null | undefined, good: (v: number) => boolean): string {
  if (value == null || !isFinite(value)) return "text-muted-foreground";
  return good(value) ? "text-emerald-600" : "text-red-500";
}

export function FinancialMetrics({ symbol, sector }: FinancialMetricsProps) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFinancialReport(symbol, "annual", 2)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (loading) {
    return (
      <Card className="border shadow-sm">
        <div className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Financial Health</h3>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </div>
      </Card>
    );
  }

  if (!report?.success || !report.data) {
    return (
      <Card className="border shadow-sm">
        <div className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Financial Health</h3>
          <p className="text-xs text-muted-foreground text-center py-8">No financial data available for {symbol}</p>
        </div>
      </Card>
    );
  }

  const { keyMetrics, incomeStatement: incSt, incomeStatementHistory: incHist, balanceSheet: balSt, balanceSheetHistory: balHist, cashFlowStatement: cfSt } = report.data;

  const km = keyMetrics;
  const inc = incSt;
  const bal = balSt;
  const cf = cfSt;
  const prevInc = incHist && incHist.length > 1 ? incHist[1] : null;
  const prevBal = balHist && balHist.length > 1 ? balHist[1] : null;

  const pe = km?.peRatio ?? null;
  const pb = km?.pbRatio ?? null;
  const ps = km?.priceToSalesRatio ?? null;
  const de = km?.debtToEquity ?? null;
  const cr = km?.currentRatio ?? null;
  const dy = km?.dividendYieldPercentage ?? null;
  const fcfYield = km?.freeCashFlowYield ?? null;
  const earningsYield = km?.earningsYield ?? null;

  const revenue = inc?.revenue ?? null;
  const prevRevenue = prevInc?.revenue ?? null;
  const revenueGrowth = revenue != null && prevRevenue != null && prevRevenue !== 0
    ? (revenue - prevRevenue) / prevRevenue : null;

  const netIncome = inc?.netIncome ?? null;
  const prevNetIncome = prevInc?.netIncome ?? null;
  const epsGrowth = inc?.eps != null && prevInc?.eps != null && prevInc.eps !== 0
    ? (inc.eps - prevInc.eps) / Math.abs(prevInc.eps) : null;

  const operatingIncome = inc?.operatingIncome ?? null;
  const opMargin = inc?.operatingIncomeRatio ?? (revenue != null && operatingIncome != null && revenue !== 0
    ? operatingIncome / revenue : null);

  const equity = bal?.totalStockholdersEquity ?? bal?.totalEquity ?? null;
  const roe = netIncome != null && equity != null && equity !== 0
    ? netIncome / equity : null;

  const totalDebt = bal?.totalDebt ?? null;
  const cash = bal?.cashAndCashEquivalents ?? null;
  const taxRate = inc?.incomeTaxExpense != null && operatingIncome != null && operatingIncome !== 0
    ? inc.incomeTaxExpense / operatingIncome : 0;
  const nopat = operatingIncome != null ? operatingIncome * (1 - taxRate) : null;
  const investedCapital = (totalDebt ?? 0) + (equity ?? 0) - (cash ?? 0);
  const roic = nopat != null && investedCapital > 0 ? nopat / investedCapital : null;

  const fcf = cf?.freeCashFlow ?? null;
  const peg = pe != null && epsGrowth != null && epsGrowth !== 0 ? pe / epsGrowth : null;

  const totalAssets = bal?.totalAssets ?? null;
  const totalLiabilities = bal?.totalLiabilities ?? null;

  return (
    <Card className="border shadow-sm">
      <div className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Financial Health</h3>
        <div className="space-y-4">
          {/* Profitability & Efficiency */}
          <div>
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2">Profitability</div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricBox label="ROIC" value={pct(roic, 1)} color={badgeColor(roic, v => v > 0.1)} sub="Return on Invested Capital" />
              <MetricBox label="ROE" value={pct(roe, 1)} color={badgeColor(roe, v => v > 0.15)} sub="Return on Equity" />
              <MetricBox label="Op. Margin" value={pct(opMargin, 1)} color={badgeColor(opMargin, v => v > 0.1)} sub="Operating Efficiency" />
              <MetricBox label="Net Margin" value={inc?.netIncomeRatio != null ? pct(inc.netIncomeRatio, 1) : "—"} color={badgeColor(inc?.netIncomeRatio, v => v > 0.05)} sub="Profit per Revenue $ " />
            </div>
          </div>

          {/* Valuation */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2">Valuation</div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricBox label="P/E" value={ratio(pe, 1)} color={badgeColor(pe, v => v > 0 && v < 25)} sub="Price-to-Earnings" />
              <MetricBox label="P/B" value={ratio(pb, 1)} color={badgeColor(pb, v => v > 0 && v < 3)} sub="Price-to-Book" />
              <MetricBox label="P/S" value={ratio(ps, 1)} color={badgeColor(ps, v => v > 0 && v < 5)} sub="Price-to-Sales" />
              <MetricBox label="PEG" value={ratio(peg, 1)} color={badgeColor(peg, v => v > 0 && v < 1.5)} sub="P/E ÷ EPS Growth" />
            </div>
          </div>

          {/* Growth */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2">Growth</div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricBox label="Revenue Growth" value={pct(revenueGrowth, 1)} color={badgeColor(revenueGrowth, v => v > 0.05)} sub="YoY Revenue Change" />
              <MetricBox label="EPS Growth" value={pct(epsGrowth, 1)} color={badgeColor(epsGrowth, v => v > 0.05)} sub="YoY Earnings/Share" />
              <MetricBox label="Free Cash Flow" value={fcf != null ? formatLargeNum(fcf) : "—"} color={badgeColor(fcf, v => v > 0)} sub="Operating CF − CapEx" />
              <MetricBox label="Earnings Yield" value={pct(earningsYield, 1)} color={badgeColor(earningsYield, v => v > 0.05)} sub="Net Income ÷ Market Cap" />
            </div>
          </div>

          {/* Financial Health */}
          <div className="border-t border-border pt-3">
            <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2">Financial Health</div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricBox label="D/E Ratio" value={ratio(de, 1)} color={badgeColor(de, v => v > 0 && v < 1.5)} sub="Debt-to-Equity" />
              <MetricBox label="Current Ratio" value={ratio(cr, 1)} color={badgeColor(cr, v => v > 1.5)} sub="Assets ÷ Liabilities" />
              <MetricBox label="FCF Yield" value={pct(fcfYield, 1)} color={badgeColor(fcfYield, v => v > 0.03)} sub="Free Cash Flow Yield" />
              <MetricBox label="Dividend Yield" value={dy != null ? `${dy.toFixed(2)}%` : "—"} color={badgeColor(dy, v => v > 0 && v < 8)} sub="Annual Dividend / Price" />
            </div>
          </div>

          {/* Balance Sheet Summary */}
          {(totalAssets != null || totalLiabilities != null) && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-semibold text-[#0D7490] uppercase tracking-wider mb-2">Balance Sheet</div>
              <div className="grid grid-cols-2 gap-1.5">
                {totalAssets != null && <MetricBox label="Total Assets" value={formatLargeNum(totalAssets)} color="text-foreground" sub="Reported" />}
                {totalLiabilities != null && <MetricBox label="Total Liabilities" value={formatLargeNum(totalLiabilities)} color={totalLiabilities > (totalAssets ?? 0) * 0.7 ? "text-red-500" : "text-foreground"} sub="vs. Assets" />}
                {equity != null && <MetricBox label="Shareholders Equity" value={formatLargeNum(equity)} color={equity > 0 ? "text-emerald-600" : "text-red-500"} sub="Book Value" />}
                {revenue != null && <MetricBox label="Revenue (TTM)" value={formatLargeNum(revenue)} color="text-foreground" sub="Trailing 12 Months" />}
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
    <div className="bg-background rounded-lg p-2 border">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{sub}</div>
    </div>
  );
}
