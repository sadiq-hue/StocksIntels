import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ArrowDownRight, ArrowUpRight, Building2, ExternalLink, Loader2, RefreshCw, Search,
  ShieldCheck, UserRound, Users,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import {
  fetchCompanyInsiderFilings, fetchRecentInsiderFilings,
  type InsiderResponse, type InsiderRow,
} from "../services/insiderService";

const COMPANY_LIMIT = 20;
const RECENT_LIMIT = 25;

function fmtMoney(value: number) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(value);
}

function fmtShares(value: number) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function fmtPrice(value: number) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function fmtDate(value?: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rolesFor(row: InsiderRow) {
  const owner = row.owner;
  const roles: string[] = [];
  if (owner?.isDirector) roles.push("Director");
  if (owner?.isOfficer) roles.push(owner.officerTitle || "Officer");
  if (owner?.isTenPercentOwner) roles.push("10% Owner");
  if (owner?.isOther) roles.push(owner.otherText || "Other");
  return roles;
}

function FormBadge({ form }: { form: string }) {
  const styles = form.startsWith("3")
    ? "bg-slate-100 text-slate-700 border-slate-200"
    : form.startsWith("5")
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-blue-50 text-blue-700 border-blue-200";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${styles}`}>{form}</span>;
}

export function InsiderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [symbolInput, setSymbolInput] = useState((searchParams.get("symbol") || "").toUpperCase());
  const [companySymbol, setCompanySymbol] = useState((searchParams.get("symbol") || "").toUpperCase());
  const [data, setData] = useState<InsiderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"all" | "buy" | "sell">("all");
  const [form, setForm] = useState<"all" | "3" | "4" | "5">("all");
  const [tenPercentOnly, setTenPercentOnly] = useState(false);
  const [limit, setLimit] = useState(RECENT_LIMIT);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request = companySymbol
      ? fetchCompanyInsiderFilings(companySymbol, limit)
      : fetchRecentInsiderFilings(limit);
    request
      .then((payload) => { if (active) setData(payload); })
      .catch((err: Error) => { if (active) { setData(null); setError(err.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companySymbol, limit, refreshKey]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    return all.filter((row) => {
      if (direction !== "all" && row.direction !== direction) return false;
      if (form !== "all" && !String(row.formType).startsWith(form)) return false;
      if (tenPercentOnly && !row.owner?.isTenPercentOwner) return false;
      return true;
    });
  }, [data, direction, form, tenPercentOnly]);

  const summary = useMemo(() => {
    let buys = 0;
    let sells = 0;
    let buyShares = 0;
    let sellShares = 0;
    const insiders = new Set<string>();
    let latest = "";
    for (const row of rows) {
      if (row.owner?.name) insiders.add(row.owner.name.toLowerCase());
      if (row.transactionDate && row.transactionDate > latest) latest = row.transactionDate;
      if (row.direction === "buy") { buys++; buyShares += row.shares || 0; }
      if (row.direction === "sell") { sells++; sellShares += row.shares || 0; }
    }
    return { buys, sells, buyShares, sellShares, netShares: buyShares - sellShares, insiders: insiders.size, latest };
  }, [rows]);

  const loadCompany = () => {
    const next = symbolInput.trim().toUpperCase();
    if (!next) return;
    setCompanySymbol(next);
    setLimit(COMPANY_LIMIT);
    setSearchParams({ symbol: next });
  };

  const showRecent = () => {
    setCompanySymbol("");
    setSymbolInput("");
    setLimit(RECENT_LIMIT);
    setSearchParams({});
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6 bg-background min-h-screen">
      <div className="bg-card rounded-2xl border border-border p-5 md:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] flex items-center justify-center text-white shrink-0">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-foreground tracking-tight">Insider Trading</h1>
              <p className="text-xs font-semibold text-muted-foreground mt-1">
                SEC Forms 3, 4 and 5 — open-market buys and sells by executives, directors and 10% owners.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {companySymbol && (
              <Button variant="ghost" size="sm" onClick={showRecent} className="text-muted-foreground hover:text-[#0D7490] h-9">
                Recent filings
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setRefreshKey((c) => c + 1)} disabled={loading}
              className="text-muted-foreground hover:text-[#0D7490] h-9">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              <span className="text-[10px] font-bold">Refresh</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") loadCompany(); }}
              className="pl-9 h-9 text-sm"
              placeholder="Search a US ticker (AAPL, TSLA, IONQ...)"
            />
          </div>
          <Button onClick={loadCompany} className="bg-[#0D7490] hover:bg-[#0A5F7A] h-9 text-xs font-bold">Load</Button>
          <span className="text-[10px] font-semibold text-muted-foreground">
            {companySymbol ? `Company filings for ${companySymbol}` : "Latest SEC insider filings"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Transactions</p>
          <p className="text-xl font-black text-foreground mt-1">{rows.length}</p>
        </Card>
        <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Buys</p>
          <p className="text-xl font-black text-emerald-600 mt-1">{summary.buys}</p>
          <p className="text-[10px] font-semibold text-muted-foreground">{fmtShares(summary.buyShares)} sh</p>
        </Card>
        <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sells</p>
          <p className="text-xl font-black text-rose-600 mt-1">{summary.sells}</p>
          <p className="text-[10px] font-semibold text-muted-foreground">{fmtShares(summary.sellShares)} sh</p>
        </Card>
        <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Net shares</p>
          <p className={`text-xl font-black mt-1 ${summary.netShares >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {summary.netShares >= 0 ? "+" : ""}{fmtShares(summary.netShares)}
          </p>
        </Card>
        <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Insiders</p>
          <p className="text-xl font-black text-foreground mt-1">{summary.insiders}</p>
          <p className="text-[10px] font-semibold text-muted-foreground">Latest {fmtDate(summary.latest)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-muted p-0.5 rounded-lg">
          {(["all", "buy", "sell"] as const).map((value) => (
            <button key={value} onClick={() => setDirection(value)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all capitalize ${direction === value ? "bg-card text-[#0D7490] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {value === "all" ? "All" : value === "buy" ? "Buys" : "Sells"}
            </button>
          ))}
        </div>
        <div className="flex bg-muted p-0.5 rounded-lg">
          {(["all", "3", "4", "5"] as const).map((value) => (
            <button key={value} onClick={() => setForm(value)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${form === value ? "bg-card text-[#0D7490] shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {value === "all" ? "All forms" : `Form ${value}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={tenPercentOnly} onChange={(e) => setTenPercentOnly(e.target.checked)} className="accent-[#0D7490]" />
          10% owners only
        </label>
        <span className="ml-auto text-[10px] font-semibold text-muted-foreground">
          Form 4 is due within 2 business days; filings shown may include amendments.
        </span>
      </div>

      <Card className="border-border bg-card rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#0D7490] mx-auto mb-3" />
            <p className="text-sm font-bold text-muted-foreground">Loading SEC insider filings…</p>
          </div>
        ) : error ? (
          <div className="p-16 text-center">
            <p className="text-sm font-bold text-rose-600">{error}</p>
            <p className="text-xs text-muted-foreground mt-1">Try refreshing or another ticker.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-16 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-bold text-foreground">No insider filings match these filters</p>
            <p className="text-xs text-muted-foreground mt-1">
              {companySymbol ? `No Forms 3/4/5 found for ${companySymbol}.` : "Try clearing the filters or refreshing."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted border-b border-border text-left">
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Filed</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Company</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Insider</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Form</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Transaction</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Shares</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Price</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Value</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Owned after</th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">SEC</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const roles = rolesFor(row);
                  return (
                    <tr key={`${row.accessionNumber}-${index}`} className="border-b border-border/60 hover:bg-accent/50 transition-colors">
                      <td className="p-3 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.filedDate)}
                        {row.transactionDate && row.transactionDate !== row.filedDate && (
                          <div className="text-[10px] text-muted-foreground/70">Txn {fmtDate(row.transactionDate)}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-foreground text-xs">{row.symbol || row.company || "—"}</div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{row.issuerName || row.company}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                          {row.owner?.name || "—"}
                        </div>
                        {row.tenB5One && <span className="text-[9px] font-bold text-muted-foreground uppercase">10b5-1 plan</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[190px]">
                          {roles.length === 0 ? <span className="text-[10px] text-muted-foreground">—</span> : roles.map((role) => (
                            <span key={role} className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${/10%/.test(role) ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border bg-muted text-muted-foreground"}`}>
                              {role}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3"><FormBadge form={row.formType} /></td>
                      <td className="p-3">
                        <div className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${row.direction === "buy" ? "bg-emerald-50 text-emerald-700" : row.direction === "sell" ? "bg-rose-50 text-rose-700" : "bg-muted text-muted-foreground"}`}>
                          {row.direction === "buy" ? <ArrowUpRight className="h-3 w-3" /> : row.direction === "sell" ? <ArrowDownRight className="h-3 w-3" /> : null}
                          {row.code} · {row.codeLabel}
                        </div>
                        {row.securityTitle && <div className="text-[10px] text-muted-foreground mt-0.5">{row.securityTitle}{row.derivative ? " (derivative)" : ""}</div>}
                      </td>
                      <td className="p-3 text-right font-semibold text-xs text-foreground whitespace-nowrap">{fmtShares(row.shares)}</td>
                      <td className="p-3 text-right text-xs text-foreground whitespace-nowrap">{fmtPrice(row.pricePerShare)}</td>
                      <td className="p-3 text-right text-xs text-foreground whitespace-nowrap">{fmtMoney(row.value)}</td>
                      <td className="p-3 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtShares(row.sharesOwnedAfter)}</td>
                      <td className="p-3 text-center">
                        {row.filingUrl ? (
                          <a href={row.filingUrl} target="_blank" rel="noreferrer" className="inline-flex text-[#0D7490] hover:text-[#0A5F7A]" title="Open filing on SEC EDGAR">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && rows.length > 0 && limit < 50 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((value) => Math.min(value + 25, 50))} className="text-xs font-bold">
            Show more filings
          </Button>
        </div>
      )}

      <Card className="border-border bg-card p-4 rounded-xl shadow-sm">
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <Building2 className="h-4 w-4 text-[#0D7490] shrink-0 mt-0.5" />
          <p>
            Source: SEC EDGAR ownership filings. Form 3 reports initial holdings, Form 4 reports changes
            (open-market buys/sells, grants, option exercises, tax withholding), and Form 5 reports annual
            changes. African exchanges publish director dealings separately and are not included here.{" "}
            <Link to="/app/financials" className="font-bold text-[#0D7490] hover:underline">Open Financials</Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
