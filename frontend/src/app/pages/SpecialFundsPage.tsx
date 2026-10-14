import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Landmark, Search, X, Loader2, Sparkles, Scale, TrendingUp, Lock,
  FileText, Info, Wallet, ShieldCheck, ChevronRight, Upload,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const TIER_RANK: Record<string, number> = { free: 0, core: 1, pro: 2, premium: 3, institutional: 4 };
const tierRank = (t?: string) => TIER_RANK[String(t || "free").toLowerCase()] ?? 0;

interface Fund {
  id: string; name: string; manager: string; category: string; structure: string;
  currency: string; country: string; listing: string | null;
  riskLevel: string | null; liquidity: string | null; assetClass: string | null;
  riskNotes: string | null; shariaCompliant: boolean;
  objective: string | null; minInvestment: number | null;
  managementFeePct: number | null; expenseRatioPct: number | null; otherFees: string | null;
  yieldPct: number | null; oneYearReturnPct: number | null; threeYearReturnPct: number | null;
  nav: number | null; aum: number | null;
  holdings: Array<{ name: string; weight: number }> | null;
  documents: Array<{ type?: string; title: string; url?: string }> | null;
  dataSource: string | null; sourceUrl: string | null;
  publishedAt: string | null; observationDate: string | null; dataStatus: string | null;
  updatedAt: string | null;
}
interface Summary {
  totalFunds: number; categories: number; managers: number; currencies: number;
  verifiedFunds: number; fundsWithYield: number; latestDataDate: string | null;
  country: string; primaryCurrency: string;
}
interface Facets {
  categories: { value: string; count: number }[];
  managers: { value: string; count: number }[];
  currencies: string[];
}
interface CmaContext {
  period: string | null;
  totalAum: number;
  source?: string;
  sourceUrl?: string | null;
  observationDate?: string | null;
  schemes: { scheme: string; aum: number; prevAum: number; pctChange: number; marketShare: number }[];
  assetClasses: { assetClass: string; amount: number; proportion: number; changePct: number }[];
}
interface CompareRow { key: keyof Fund | "manager"; label: string; fmt?: "money" | "pct" }
interface CompareResult { funds: Fund[]; rows: CompareRow[]; notices: string[] }

const money = (v: number | null, cur = "KES") => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${cur} ${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${cur} ${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${cur} ${(v / 1e3).toFixed(1)}K`;
  return `${cur} ${v.toLocaleString()}`;
};
const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const dateStr = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

function riskTone(risk: string | null) {
  const r = String(risk || "").toLowerCase();
  if (r.includes("low-medium")) return "bg-sky-100 text-sky-700 border-sky-200";
  if (r.includes("low")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (r.includes("medium-high")) return "bg-orange-100 text-orange-700 border-orange-200";
  if (r.includes("medium")) return "bg-amber-100 text-amber-700 border-amber-200";
  if (r.includes("high")) return "bg-red-100 text-red-700 border-red-200";
  return "bg-muted text-muted-foreground border-border";
}

function UpgradeNote({ required }: { required: string }) {
  return (
    <Card className="p-6 text-center border-dashed">
      <Lock className="size-6 mx-auto text-muted-foreground mb-2" />
      <p className="text-sm font-semibold text-foreground">Available on the {required} plan</p>
      <p className="text-xs text-muted-foreground mt-1">Upgrade to unlock advanced fund comparison and AI research.</p>
      <Button className="mt-3 bg-[#0D7490] hover:bg-[#0A5F7A]" size="sm" onClick={() => (window.location.href = "/app/pricing")}>View plans</Button>
    </Card>
  );
}

export function SpecialFundsPage() {
  const { user, apiFetch } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [context, setContext] = useState<CmaContext | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"directory" | "compare" | "ai">("directory");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [manager, setManager] = useState("all");
  const [risk, setRisk] = useState("all");
  const [sort, setSort] = useState("name");
  const [sharia, setSharia] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [profile, setProfile] = useState<Fund | null>(null);

  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareErr, setCompareErr] = useState<string | null>(null);

  const [aiFundId, setAiFundId] = useState("");
  const [aiQ, setAiQ] = useState("");
  const [aiAns, setAiAns] = useState<{ answer: string; missing: string[]; disclaimer: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const isAdmin = !!user && (user.role === "admin" || user.role === "super_admin");
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [impSource, setImpSource] = useState("");
  const [impDate, setImpDate] = useState(new Date().toISOString().slice(0, 10));
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ updated: number; created: number; skipped: number; parsedRows?: number; errors: { row: number; reason: string }[] } | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const CSV_TEMPLATE =
    "id,name,currency,yield_pct,one_year_return_pct,management_fee_pct,min_investment,nav,aum,observation_date\n" +
    "sf-britam-money-market-fund,Britam Money Market Fund,KES,11.85,12.40,1.5,1000,,,\n";

  const isPremium = !!user && (user.role === "admin" || user.role === "super_admin" || tierRank(user.subscription_tier) >= 3 ||
    (!!user.trial_start_date && (Date.now() - new Date(user.trial_start_date).getTime()) < 7 * 24 * 3600 * 1000));

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [sRes, fRes, cRes] = await Promise.all([apiFetch("/special-funds/summary"), apiFetch("/special-funds/facets"), apiFetch("/special-funds/context")]);
        if (!cancel) {
          if (sRes.ok) setSummary(await sRes.json());
          if (fRes.ok) setFacets(await fRes.json());
          if (cRes.ok) setContext(await cRes.json());
        }
      } catch { /* ignore */ }
    })();
    return () => { cancel = true; };
  }, [apiFetch]);

  const loadFunds = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ sort });
      if (search) params.set("search", search);
      if (category !== "all") params.set("category", category);
      if (manager !== "all") params.set("manager", manager);
      if (risk !== "all") params.set("risk", risk);
      if (sharia) params.set("sharia", "true");
      const res = await apiFetch(`/special-funds?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load funds");
      setFunds(data.funds || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load funds");
    } finally { setLoading(false); }
  }, [apiFetch, search, category, manager, risk, sort, sharia]);

  useEffect(() => {
    const t = setTimeout(loadFunds, 250);
    return () => clearTimeout(t);
  }, [loadFunds]);

  const runImport = useCallback(async () => {
    if (!csvText.trim()) return;
    setImporting(true); setImportErr(null); setImportResult(null);
    try {
      const res = await apiFetch("/special-funds/import-csv", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, defaults: { data_source: impSource || undefined, observation_date: impDate || undefined } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setImportResult({ updated: data.updated || 0, created: data.created || 0, skipped: data.skipped || 0, parsedRows: data.parsedRows, errors: data.errors || [] });
      await loadFunds();
    } catch (e: any) {
      setImportErr(e?.message || "Import failed");
    } finally { setImporting(false); }
  }, [apiFetch, csvText, impSource, impDate, loadFunds]);

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : (prev.length >= 5 ? prev : [...prev, id]));
  };

  const runCompare = useCallback(async () => {
    if (selected.length < 2) return;
    setCompareLoading(true); setCompareErr(null); setCompare(null);
    try {
      const res = await apiFetch(`/special-funds/compare?ids=${encodeURIComponent(selected.join(","))}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Comparison failed");
      setCompare(data);
    } catch (e: any) {
      setCompareErr(e?.message || "Comparison failed");
    } finally { setCompareLoading(false); }
  }, [apiFetch, selected]);

  const askAi = useCallback(async () => {
    if (!aiFundId || !aiQ.trim()) return;
    setAiLoading(true); setAiErr(null); setAiAns(null);
    try {
      const res = await apiFetch(`/special-funds/${encodeURIComponent(aiFundId)}/ai`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: aiQ.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "AI research failed");
      setAiAns({ answer: data.answer, missing: data.missing || [], disclaimer: data.disclaimer || "" });
    } catch (e: any) {
      setAiErr(e?.message || "AI research failed");
    } finally { setAiLoading(false); }
  }, [apiFetch, aiFundId, aiQ]);

  const categories = facets?.categories || [];
  const managers = facets?.managers || [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center">
              <Landmark className="size-4 text-white" />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Managed Funds</h1>
            <Badge variant="outline" className="text-[10px] border-[#0D7490] text-[#0D7490]">Advanced</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Research collective investment schemes — unit trusts, CIS, REITs, ETFs and Special Funds. Kenya first.
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" className="border-border h-9" onClick={() => setShowImport(true)}>
            <Upload className="size-4 mr-1.5" /> Import data
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Funds tracked</div><div className="text-xl font-bold text-foreground">{summary?.totalFunds ?? "—"}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Categories</div><div className="text-xl font-bold text-foreground">{summary?.categories ?? "—"}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Managers</div><div className="text-xl font-bold text-foreground">{summary?.managers ?? "—"}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Market</div><div className="text-lg font-bold text-foreground">{summary?.country || "Kenya"}</div><div className="text-[10px] text-muted-foreground">{summary?.primaryCurrency || "KES"}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Latest data</div><div className="text-sm font-bold text-foreground">{summary?.latestDataDate ? dateStr(summary.latestDataDate) : "—"}</div><div className="text-[10px] text-muted-foreground">{summary?.verifiedFunds ?? 0} verified</div></Card>
      </div>

      {context && context.period && context.schemes.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Landmark className="size-4 text-[#0D7490]" />
              <span className="text-sm font-semibold text-foreground">Industry context — CIS assets under management</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {context.period}
              {context.sourceUrl ? <> · <a className="underline" href={context.sourceUrl} target="_blank" rel="noopener noreferrer">{context.source}</a></> : context.source ? <> · {context.source}</> : null}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total AUM</div>
              <div className="text-2xl font-bold text-foreground tabular-nums">{money(context.totalAum, "KES")}</div>
              <div className="text-[11px] text-muted-foreground mt-1">across {context.schemes.length} schemes</div>
            </div>
            <div className="lg:col-span-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Top schemes by market share</div>
              <div className="space-y-1.5">
                {context.schemes.slice(0, 6).map(s => (
                  <div key={s.scheme} className="flex items-center gap-2">
                    <span className="text-[11px] text-foreground w-48 truncate">{s.scheme}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-[#0D7490]" style={{ width: `${Math.min(100, s.marketShare)}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-14 text-right">{s.marketShare?.toFixed(2)}%</span>
                    <span className={`text-[11px] tabular-nums w-16 text-right ${s.pctChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>{s.pctChange >= 0 ? "+" : ""}{s.pctChange}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {context.assetClasses.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {context.assetClasses.slice(0, 6).map(a => (
                <span key={a.assetClass} className="text-[10px] rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
                  {a.assetClass}: <span className="text-foreground font-medium">{a.proportion}%</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0 mt-0.5" />
        <span>
          Fund directory shows verified scheme metadata (names, managers, categories, risk class). Live figures
          (NAV, yield, returns, fees) appear once ingested from official provider/CMA disclosures — missing values
          show as “—” rather than zero, and every record carries its source and data date.
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([["directory", "Directory", Search], ["compare", "Compare", Scale], ["ai", "AI Research", Sparkles]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === id ? "border-[#0D7490] text-[#0D7490]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "directory" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fund or manager…" className="pl-9 h-9" />
            </div>
            <select value={category} onChange={e => setCategory(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm">
              <option value="all">All categories</option>
              {categories.map(c => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
            </select>
            <select value={manager} onChange={e => setManager(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm max-w-[220px]">
              <option value="all">All managers</option>
              {managers.map(m => <option key={m.value} value={m.value}>{m.value}</option>)}
            </select>
            <select value={risk} onChange={e => setRisk(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm">
              <option value="all">All risk</option>
              {["Low", "Low-Medium", "Medium", "Medium-High", "High"].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm">
              <option value="name">Sort: Name</option>
              <option value="yield">Sort: Yield</option>
              <option value="oneYear">Sort: 1-year return</option>
              <option value="fees">Sort: Fees</option>
              <option value="aum">Sort: AUM</option>
              <option value="updated">Sort: Recently updated</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground h-9 px-1">
              <input type="checkbox" checked={sharia} onChange={e => setSharia(e.target.checked)} className="accent-[#0D7490]" /> Shariah only
            </label>
          </div>

          {/* Compare bar */}
          {selected.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-[#0D7490]/30 bg-[#0D7490]/5 px-3 py-2">
              <span className="text-xs text-foreground">{selected.length} fund{selected.length > 1 ? "s" : ""} selected for comparison</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected([])}>Clear</Button>
                <Button size="sm" className="h-7 text-xs bg-[#0D7490] hover:bg-[#0A5F7A]"
                  disabled={selected.length < 2} onClick={() => { setTab("compare"); runCompare(); }}>
                  <Scale className="size-3.5 mr-1" /> Compare
                </Button>
              </div>
            </div>
          )}

          {/* Table */}
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 w-8"></th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Fund</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Manager</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Risk</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Yield</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">1-yr</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Mgmt fee</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">As of</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="text-center py-10"><Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" /></td></tr>
                  ) : error ? (
                    <tr><td colSpan={9} className="text-center py-10 text-red-600">{error}</td></tr>
                  ) : funds.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No funds match your filters.</td></tr>
                  ) : funds.map(f => (
                    <tr key={f.id} className="border-b border-border hover:bg-accent/60 cursor-pointer" onClick={() => setProfile(f)}>
                      <td className="py-2 px-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggleSelect(f.id)} className="accent-[#0D7490]" />
                      </td>
                      <td className="py-2 px-3 font-medium text-foreground">
                        {f.name}
                        {f.listing && <span className="ml-1.5 text-[9px] text-muted-foreground">{f.listing}</span>}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{f.manager}</td>
                      <td className="py-2 px-3 text-muted-foreground">{f.category}</td>
                      <td className="py-2 px-3"><span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${riskTone(f.riskLevel)}`}>{f.riskLevel || "—"}</span></td>
                      <td className="py-2 px-3 text-right tabular-nums text-foreground">{pct(f.yieldPct)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${f.oneYearReturnPct != null && f.oneYearReturnPct < 0 ? "text-red-600" : "text-foreground"}`}>{pct(f.oneYearReturnPct)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{f.managementFeePct != null ? `${f.managementFeePct}%` : "—"}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">{dateStr(f.observationDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-[11px] text-muted-foreground">{funds.length} of {summary?.totalFunds ?? funds.length} funds shown. Click a row for the full profile.</p>
        </div>
      )}

      {tab === "compare" && (
        <div className="space-y-4">
          {!isPremium ? <UpgradeNote required="Premium" /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Selected: {selected.length ? selected.map(id => funds.find(f => f.id === id)?.name || id).join(", ") : "none"}</span>
                <Button size="sm" className="h-8 bg-[#0D7490] hover:bg-[#0A5F7A]" disabled={selected.length < 2 || compareLoading} onClick={runCompare}>
                  {compareLoading ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Scale className="size-3.5 mr-1" />} Compare {selected.length ? `(${selected.length})` : ""}
                </Button>
                {selected.length < 2 && <span className="text-xs text-muted-foreground">Select 2–5 funds from the Directory tab.</span>}
              </div>

              {compareErr && <p className="text-sm text-red-600">{compareErr}</p>}

              {compare && (
                <>
                  {compare.notices.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                      {compare.notices.map((n, i) => <div key={i}>• {n}</div>)}
                    </div>
                  )}
                  <Card className="overflow-hidden p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted">
                          <tr className="border-b border-border">
                            <th className="text-left py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-muted">Metric</th>
                            {compare.funds.map(f => <th key={f.id} className="text-left py-2 px-3 font-medium text-foreground min-w-[160px]">{f.name}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {compare.rows.map(row => (
                            <tr key={row.key} className="border-b border-border">
                              <td className="py-2 px-3 text-muted-foreground sticky left-0 bg-card">{row.label}</td>
                              {compare.funds.map(f => {
                                const v = (f as any)[row.key];
                                let out: string;
                                if (row.fmt === "money") out = money(typeof v === "number" ? v : null, f.currency);
                                else if (row.fmt === "pct") out = pct(typeof v === "number" ? v : null);
                                else if (v === true) out = "Yes";
                                else if (v === false) out = "No";
                                else out = v == null || v === "" ? "—" : String(v);
                                return <td key={f.id} className="py-2 px-3 text-foreground">{out}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  <p className="text-[11px] text-muted-foreground">Comparison periods and return methodologies must match; where data is missing it is shown as “—”. Historical performance is not a guarantee of future results.</p>
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-4">
          {!isPremium ? <UpgradeNote required="Premium" /> : (
            <>
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[#0D7490]" />
                  <span className="text-sm font-semibold text-foreground">Ask about a fund</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select value={aiFundId} onChange={e => setAiFundId(e.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm sm:w-64">
                    <option value="">Select a fund…</option>
                    {funds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <Input value={aiQ} onChange={e => setAiQ(e.target.value)} placeholder="e.g. What is the risk profile and how liquid is it?" className="h-10 flex-1" />
                  <Button className="h-10 bg-[#0D7490] hover:bg-[#0A5F7A]" disabled={!aiFundId || !aiQ.trim() || aiLoading} onClick={askAi}>
                    {aiLoading ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Answers are grounded in this fund’s stored record and cite the fields used. Missing data is called out, never estimated.</p>
              </Card>

              {aiErr && <p className="text-sm text-red-600">{aiErr}</p>}
              {aiAns && (
                <Card className="p-4 space-y-3">
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">{aiAns.answer}</p>
                  {aiAns.missing.length > 0 && (
                    <div className="text-[11px] text-muted-foreground border-t border-border pt-2">Missing fields: {aiAns.missing.join(", ")}</div>
                  )}
                  <div className="text-[11px] text-amber-700 border-t border-border pt-2">{aiAns.disclaimer}</div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-card w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-foreground">Import fund data (CSV)</h3>
                <p className="text-[11px] text-muted-foreground">Paste rows from a provider factsheet or CMA disclosure. Funds are matched by id or name; new names are created.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}><X className="size-4" /></Button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input value={impSource} onChange={e => setImpSource(e.target.value)} placeholder="Source (e.g. Britam factsheet Q3 2026)" className="h-9 flex-1 min-w-[220px]" />
                <Input type="date" value={impDate} onChange={e => setImpDate(e.target.value)} className="h-9 w-[160px]" />
              </div>
              <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={10}
                placeholder="id,name,currency,yield_pct,one_year_return_pct,..."
                className="w-full rounded-lg border bg-background p-3 text-xs font-mono outline-none focus:ring-2 focus:ring-[#0D7490]/20" />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setCsvText(CSV_TEMPLATE); setImpSource(impSource || 'Manual import'); }}>Load template</Button>
                <span className="text-[11px] text-muted-foreground">Any of id/name + figures. Numbers accept %, currency symbols and commas.</span>
              </div>
              {importErr && <p className="text-xs text-red-600">{importErr}</p>}
              {importResult && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  <div className="text-foreground font-medium">
                    {importResult.parsedRows != null ? `${importResult.parsedRows} rows parsed · ` : ''}
                    {importResult.updated} updated · {importResult.created} created · {importResult.skipped} skipped
                  </div>
                  {importResult.errors.length > 0 && (
                    <ul className="mt-1 text-muted-foreground list-disc pl-4">
                      {importResult.errors.slice(0, 8).map((er, i) => <li key={i}>Row {er.row}: {er.reason}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>Close</Button>
                <Button size="sm" className="bg-[#0D7490] hover:bg-[#0A5F7A]" disabled={importing || !csvText.trim()} onClick={runImport}>
                  {importing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Upload className="size-3.5 mr-1" />} Import
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {profile && <ProfileDrawer fund={profile} onClose={() => setProfile(null)} />}
    </div>
  );
}

function ProfileDrawer({ fund, onClose }: { fund: Fund; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "performance" | "fees" | "risk" | "portfolio" | "documents">("overview");
  const tabs = [
    ["overview", "Overview"], ["performance", "Performance"], ["fees", "Fees"],
    ["risk", "Risk"], ["portfolio", "Portfolio"], ["documents", "Documents"],
  ] as const;

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/60">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground text-right">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div className="bg-card w-full max-w-xl h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground truncate">{fund.name}</h3>
            <p className="text-[11px] text-muted-foreground">{fund.manager} · {fund.category} · {fund.currency}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4" /></Button>
        </div>

        <div className="flex flex-wrap gap-1 px-3 pt-3 border-b border-border">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px ${tab === id ? "border-[#0D7490] text-[#0D7490]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-3">
          {tab === "overview" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={`text-[10px] ${riskTone(fund.riskLevel)}`}>{fund.riskLevel || "Risk n/a"}</Badge>
                <Badge variant="outline" className="text-[10px]">{fund.structure}</Badge>
                {fund.shariaCompliant && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">Shariah</Badge>}
                {fund.listing && <Badge variant="outline" className="text-[10px]">{fund.listing}</Badge>}
              </div>
              {fund.objective && <p className="text-sm text-foreground leading-relaxed">{fund.objective}</p>}
              <div>
                <Row label="Fund manager" value={fund.manager || "—"} />
                <Row label="Category" value={fund.category || "—"} />
                <Row label="Structure" value={fund.structure || "—"} />
                <Row label="Currency" value={fund.currency || "—"} />
                <Row label="Asset class" value={fund.assetClass || "—"} />
                <Row label="Liquidity" value={fund.liquidity || "—"} />
                <Row label="Minimum investment" value={money(fund.minInvestment, fund.currency)} />
                <Row label="Data source" value={fund.dataSource || "—"} />
                <Row label="Data as of" value={dateStr(fund.observationDate)} />
              </div>
            </>
          )}

          {tab === "performance" && (
            fund.yieldPct == null && fund.oneYearReturnPct == null && fund.nav == null ? (
              <Empty icon={TrendingUp} text="No performance figures published yet for this fund." />
            ) : (
              <div>
                <Row label="Published yield" value={pct(fund.yieldPct)} />
                <Row label="1-year return" value={pct(fund.oneYearReturnPct)} />
                <Row label="3-year return" value={pct(fund.threeYearReturnPct)} />
                <Row label="NAV" value={fund.nav != null ? fund.nav.toFixed(4) : "—"} />
                <Row label="As of" value={dateStr(fund.observationDate)} />
              </div>
            )
          )}

          {tab === "fees" && (
            fund.managementFeePct == null && fund.expenseRatioPct == null && !fund.otherFees ? (
              <Empty icon={Wallet} text="Fees have not been ingested yet for this fund." />
            ) : (
              <div>
                <Row label="Management fee" value={fund.managementFeePct != null ? `${fund.managementFeePct}% p.a.` : "—"} />
                <Row label="Expense ratio" value={fund.expenseRatioPct != null ? `${fund.expenseRatioPct}%` : "—"} />
                <Row label="Other charges" value={fund.otherFees || "—"} />
              </div>
            )
          )}

          {tab === "risk" && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="size-4 text-[#0D7490]" />
                <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${riskTone(fund.riskLevel)}`}>{fund.riskLevel || "Not classified"}</span>
              </div>
              {fund.riskNotes && <p className="text-sm text-foreground leading-relaxed">{fund.riskNotes}</p>}
              <div className="mt-2">
                <Row label="Liquidity" value={fund.liquidity || "—"} />
                <Row label="Structure" value={fund.structure || "—"} />
              </div>
            </div>
          )}

          {tab === "portfolio" && (
            fund.holdings && fund.holdings.length > 0 ? (
              <div className="space-y-2">
                {fund.holdings.map((h, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1"><span className="text-foreground">{h.name}</span><span className="text-muted-foreground">{h.weight}%</span></div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-[#0D7490]" style={{ width: `${Math.min(100, h.weight)}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : <Empty icon={FileText} text="Holdings/allocation not disclosed yet for this fund." />
          )}

          {tab === "documents" && (
            fund.documents && fund.documents.length > 0 ? (
              <div className="space-y-2">
                {fund.documents.map((d, i) => (
                  <a key={i} href={d.url || "#"} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-accent">
                    <FileText className="size-4 text-[#0D7490]" />
                    <span className="text-xs text-foreground">{d.title}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{d.type || "document"}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            ) : <Empty icon={FileText} text="No factsheets, prospectuses or reports linked yet." />
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="size-6 mx-auto text-muted-foreground mb-2" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
