import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { Link } from "react-router";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Rocket, CalendarDays, Search, BarChart3, Newspaper, History,
  ChevronDown, Check, RefreshCw, TrendingUp, TrendingDown, Info,
  DollarSign, Users, Timer, Globe2, ExternalLink, Search as SearchIcon,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type ViewKey = "calendar" | "statistics" | "news" | "lookup";
type SubTab = "recent" | "upcoming" | "lockups" | "filings" | "withdrawn";

interface Ipo {
  id: number | string;
  company_name: string;
  ticker: string | null;
  exchange?: string | null;
  status: string;
  listing_date: string | null;
  offer_price: number | null;
  current_price: number | null;
  oversubscription_pct: number | null;
  description: string | null;
  sector: string | null;
  price_change_pct: number | null;
  price_change: number | null;
  since_ipo_pct?: number | null;
  market?: string;
  source?: string;
  sec?: {
    cik: string | null;
    filingsCount: number;
    ipoFilings: Array<{ form: string; filed: string; url: string }>;
    hasIpoFiling: boolean;
    lastAnnualReport?: { filed: string; url: string } | null;
  };
}

interface IpoNewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment?: string;
  relatedStocks?: string[];
  category?: string;
}

const VIEWS: { key: ViewKey; label: string; icon: typeof CalendarDays }[] = [
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "statistics", label: "Statistics", icon: BarChart3 },
  { key: "news", label: "News", icon: Newspaper },
  { key: "lookup", label: "Lookup", icon: SearchIcon },
];

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "upcoming", label: "Upcoming" },
  { key: "lockups", label: "Lockups" },
  { key: "filings", label: "Filings" },
  { key: "withdrawn", label: "Withdrawn" },
];

const statusColors: Record<string, string> = {
  upcoming: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50",
  filed: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50",
  current: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50",
  listed: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50",
  withdrawn: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/50",
  info: "bg-muted text-muted-foreground border-border",
};

const fmtPct = (v: number | null | undefined, dp = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`);

function StatusBadge({ status }: { status: string }) {
  const label = status === "info" ? "" : status.charAt(0).toUpperCase() + status.slice(1);
  return <Badge className={`text-[10px] px-2 py-0.5 font-medium border ${statusColors[status] || statusColors.info}`}>{label}</Badge>;
}

export function IpoPage() {
  const [view, setView] = useState<ViewKey>("calendar");
  const [subTab, setSubTab] = useState<SubTab>("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendar, setCalendar] = useState<Ipo[]>([]);
  const [news, setNews] = useState<IpoNewsItem[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [lockups, setLockups] = useState<any>({ thisWeek: [], nextWeek: [], after: [], expired: [] });
  const [lockupLoading, setLockupLoading] = useState(false);
  const [filings, setFilings] = useState<any[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<Ipo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCommon = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [cal, nw, st] = await Promise.all([
        fetch(`${API_BASE}/ipo/calendar`).then((r) => r.json()),
        fetch(`${API_BASE}/ipo/news`).then((r) => r.json()),
        fetch(`${API_BASE}/ipo/statistics`).then((r) => r.json()),
      ]);
      setCalendar(Array.isArray(cal?.ipos) ? cal.ipos : []);
      setNews(Array.isArray(nw?.items) ? nw.items : []);
      setStats(st || null);
    } catch {
      setError("Failed to load IPO data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCommon(); }, [loadCommon]);

  // Load lockups / filings lazily when those sub-tabs are opened.
  useEffect(() => {
    if (subTab === "lockups" && !lockups.thisWeek?.length && !lockups.after?.length && !lockupLoading) {
      setLockupLoading(true);
      fetch(`${API_BASE}/ipo/lockups`).then((r) => r.json()).then((j) => {
        if (j && !j.error) setLockups(j);
      }).catch(() => {}).finally(() => setLockupLoading(false));
    }
    if (subTab === "filings" && !filings.length && !filingsLoading) {
      setFilingsLoading(true);
      fetch(`${API_BASE}/ipo/filings`).then((r) => r.json()).then((j) => {
        if (Array.isArray(j?.filings)) setFilings(j.filings);
      }).catch(() => {}).finally(() => setFilingsLoading(false));
    }
  }, [subTab]);

  const runLookup = useCallback(async () => {
    const q = query.trim();
    if (!q) { setLookup(null); return; }
    try {
      const r = await fetch(`${API_BASE}/ipo/lookup?q=${encodeURIComponent(q)}`).then((x) => x.json());
      setLookup(Array.isArray(r?.matches) ? r.matches : []);
    } catch { setLookup([]); }
  }, [query]);

  useEffect(() => {
    if (view === "lookup") runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const activeView = VIEWS.find((v) => v.key === view)!;
  const ActiveIcon = activeView.icon;

  const renderCard = (ipo: Ipo) => {
    const cur = ipo.market === "NSE" ? "KES " : "$";
    return (
      <Card key={ipo.id} className="p-4 border shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground truncate">{ipo.company_name}</h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {ipo.ticker && (
                <Link to={`/app/stock/${ipo.ticker}?market=${ipo.market === "NSE" ? "nse" : "us"}`} className="text-xs font-mono text-muted-foreground bg-muted px-1 py-0.5 rounded hover:text-foreground">{ipo.ticker}</Link>
              )}
              {ipo.exchange && <span className="text-[10px] text-muted-foreground">({ipo.exchange})</span>}
            </div>
          </div>
          <StatusBadge status={ipo.status} />
        </div>
        {ipo.description && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{ipo.description}</p>}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {ipo.offer_price != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground"><DollarSign className="size-3 shrink-0" /><span>Offer: {cur}{ipo.offer_price.toLocaleString()}</span></div>
          )}
          {ipo.current_price != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BarChart3 className="size-3 shrink-0" />
              <span>Current: {cur}{ipo.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
            </div>
          )}
          {typeof ipo.since_ipo_pct === "number" && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="size-3 shrink-0" />
              <span className={`font-medium ${ipo.since_ipo_pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>Since IPO: {fmtPct(ipo.since_ipo_pct)}</span>
            </div>
          )}
          {ipo.price_change_pct != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {ipo.price_change_pct >= 0 ? <TrendingUp className="size-3 shrink-0 text-emerald-600" /> : <TrendingDown className="size-3 shrink-0 text-red-500" />}
              <span className={`font-semibold ${ipo.price_change_pct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmtPct(ipo.price_change_pct, 2)}</span>
            </div>
          )}
          {ipo.oversubscription_pct != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground"><Users className="size-3 shrink-0" /><span>{ipo.oversubscription_pct}x oversubscribed</span></div>
          )}
          {ipo.listing_date && (
            <div className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="size-3 shrink-0" /><span>Lists {ipo.listing_date}</span></div>
          )}
        </div>
        {ipo.sec && (
          <div className="mt-3 pt-2.5 border-t border-border space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">SEC EDGAR</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {ipo.sec.hasIpoFiling ? (
                ipo.sec.ipoFilings.slice(0, 3).map((f, i) => (
                  <a key={i} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                    {f.form} <ExternalLink className="size-2.5" />
                  </a>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground">{ipo.sec.filingsCount} SEC filings{ipo.sec.lastAnnualReport ? " · last 10-K on file" : ""}</span>
              )}
            </div>
          </div>
        )}
      </Card>
    );
  };

  const grouped = useMemo(() => {
    const upcoming = calendar.filter((i) => i.status === "upcoming" || i.status === "filed");
    const listed = calendar.filter((i) => i.status === "listed");
    return { upcoming, listed };
  }, [calendar]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
          <Rocket className="size-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-foreground">IPOs & New Listings</h1>
          <p className="text-xs text-muted-foreground">NSE and global IPOs — calendar, lookup, stats, news and recent listings</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadCommon} disabled={loading} className="h-8 text-xs gap-1.5">
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Section dropdown */}
      <div className="relative mb-5 w-fit">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <ActiveIcon className="size-4 text-[#0D7490]" />
          {activeView.label}
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-0 z-40 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => { setView(v.key); setMenuOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted ${v.key === view ? "font-semibold text-[#0D7490]" : "text-foreground"}`}
                >
                  <v.icon className="size-4 shrink-0" />
                  {v.label}
                  {v.key === view && <Check className="ml-auto size-4" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <Card className="p-4 mb-5 border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20">
          <div className="flex items-start gap-2"><Info className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" /><p className="text-xs text-amber-700 dark:text-amber-300">{error}</p></div>
        </Card>
      )}

      {view === "calendar" && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${subTab === t.key ? "bg-[#0D7490] text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading && !calendar.length ? (
        <div className="text-sm text-muted-foreground">Loading IPO data…</div>
      ) : view === "calendar" ? (
        subTab === "recent" ? (
          grouped.listed.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{grouped.listed.map(renderCard)}</div>
          ) : <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No recently listed IPOs.</p></Card>
        ) : subTab === "upcoming" ? (
          grouped.upcoming.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{grouped.upcoming.map(renderCard)}</div>
          ) : <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No upcoming IPOs.</p></Card>
        ) : subTab === "withdrawn" ? (
          <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No withdrawn IPOs tracked.</p></Card>
        ) : subTab === "lockups" ? (
          lockupLoading && !lockups.thisWeek?.length ? (
            <div className="text-sm text-muted-foreground">Building lock-up calendar from SEC filings (can take ~30s first run)…</div>
          ) : (
            <LockupCalendar cal={lockups} />
          )
        ) : (
          filingsLoading && !filings.length ? (
            <div className="text-sm text-muted-foreground">Loading SEC filings…</div>
          ) : filings.length > 0 ? (
            <FilingsTable filings={filings} />
          ) : <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No recent IPO filings.</p></Card>
        )
      ) : view === "lookup" ? (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runLookup()}
              placeholder="Search a company or ticker (e.g. KPC, AAPL)…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-card text-sm outline-none focus:border-[#0D7490]"
            />
          </div>
          {lookup && lookup.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{lookup.map(renderCard)}</div>
          )}
          {lookup && lookup.length === 0 && <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No IPOs match “{query}”.</p></Card>}
        </div>
      ) : view === "statistics" ? (
        stats ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Total IPOs" value={stats.total} icon={Rocket} />
              <StatCard label="Upcoming" value={(stats.byStatus?.upcoming || 0) + (stats.byStatus?.filed || 0)} icon={CalendarDays} />
              <StatCard label="Listed" value={stats.byStatus?.listed || 0} icon={History} />
              <StatCard label="Avg Since IPO" value={fmtPct(stats.avgSinceIpoPct)} icon={TrendingUp} />
              <StatCard label="Best Since IPO" value={fmtPct(stats.bestSinceIpoPct)} icon={TrendingUp} />
              <StatCard label="Worst Since IPO" value={fmtPct(stats.worstSinceIpoPct)} icon={TrendingDown} />
              <StatCard label="Median Since IPO" value={fmtPct(stats.medianSinceIpoPct)} icon={BarChart3} />
              <StatCard label="% Above Offer" value={stats.pctAboveOffer == null ? "—" : `${stats.pctAboveOffer.toFixed(0)}%`} icon={TrendingUp} />
            </div>
            {stats.pricedCount != null && stats.pricedCount < 3 && (
              <p className="text-[10px] text-muted-foreground">Only {stats.pricedCount} priced IPO(s) have both an offer and a current price, so return stats are based on a small sample.</p>
            )}
            {(stats.topPerformers?.length > 0 || stats.bottomPerformers?.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {stats.topPerformers?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">Top since IPO</h3>
                    <div className="space-y-1">
                      {stats.topPerformers.map((p: any) => (
                        <div key={p.ticker} className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                          <span className="font-medium text-foreground">{p.ticker}</span>
                          <span className="font-semibold text-emerald-600">{fmtPct(p.pct)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {stats.bottomPerformers?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">Weakest since IPO</h3>
                    <div className="space-y-1">
                      {stats.bottomPerformers.map((p: any) => (
                        <div key={p.ticker} className="flex items-center justify-between rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
                          <span className="font-medium text-foreground">{p.ticker}</span>
                          <span className="font-semibold text-red-500">{fmtPct(p.pct)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : <div className="text-sm text-muted-foreground">Loading statistics…</div>
      ) : (
        news.length > 0 ? (
          <div className="space-y-2">
            {news.map((n) => (
              <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-border bg-card p-3 hover:shadow-md transition-shadow">
                <p className="text-sm font-medium text-foreground leading-snug">{n.headline}</p>
                <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span>{n.source}</span>
                  {n.publishedAt && <span>· {new Date(n.publishedAt).toLocaleDateString()}</span>}
                  <ExternalLink className="size-3" />
                </p>
              </a>
            ))}
          </div>
        ) : <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No IPO news right now.</p></Card>
      )}
    </div>
  );
}

function fmtNum(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

function LockupRow({ r }: { r: any }) {
  return (
    <tr className="border-b border-border/60 hover:bg-muted/40 text-xs">
      <td className="px-3 py-2 font-mono font-semibold text-foreground">{r.ticker || "—"}</td>
      <td className="px-3 py-2 text-foreground max-w-[10rem] truncate">{r.name}</td>
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.expirationDate}</td>
      <td className="px-3 py-2 text-muted-foreground text-right tabular-nums">{r.days ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground text-right tabular-nums">{fmtNum(r.shares)}</td>
      <td className="px-3 py-2 text-muted-foreground text-right tabular-nums">{fmtNum(r.marketCap)}</td>
      <td className="px-3 py-2 text-muted-foreground max-w-[12rem] truncate" title={r.condition}>{r.condition}{r.note ? " · early-release" : ""}</td>
      <td className="px-3 py-2">
        {r.docUrl && <a href={r.docUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">sec.gov</a>}
      </td>
    </tr>
  );
}

function LockupTable({ title, rows }: { title: string; rows: any[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-foreground mb-2">{title} ({rows.length})</h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Ticker</th>
              <th className="px-3 py-2 text-left font-medium">Company</th>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-right font-medium">Day</th>
              <th className="px-3 py-2 text-right font-medium">Shares</th>
              <th className="px-3 py-2 text-right font-medium">Mkt Cap</th>
              <th className="px-3 py-2 text-left font-medium">Condition</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => <LockupRow key={`${r.ticker}-${r.expirationDate}-${i}`} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LockupCalendar({ cal }: { cal: any }) {
  const groups = [
    { title: "This Week", rows: cal.thisWeek },
    { title: "Next Week", rows: cal.nextWeek },
    { title: "After Next Week", rows: cal.after },
    { title: "Recently Expired", rows: cal.expired },
  ];
  const total = groups.reduce((s, g) => s + (g.rows?.length || 0), 0);
  if (total === 0) {
    return <Card className="p-6 text-center border-dashed"><p className="text-sm text-muted-foreground">No lock-up expirations found in recent SEC prospectuses.</p></Card>;
  }
  return (
    <div>
      {groups.map((g) => <LockupTable key={g.title} title={g.title} rows={g.rows || []} />)}
      <p className="text-[10px] text-muted-foreground">Data source: SEC filings. Lock-up dates come from each company's prospectus; early-release provisions can unlock shares earlier.</p>
    </div>
  );
}

function FilingsTable({ filings }: { filings: any[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Ticker</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Stage</th>
            <th className="px-3 py-2 text-left font-medium">Filed</th>
            <th className="px-3 py-2 text-left font-medium">Form</th>
          </tr>
        </thead>
        <tbody>
          {filings.map((f, i) => (
            <tr key={`${f.cik}-${f.accession}-${i}`} className="border-b border-border/60 hover:bg-muted/40 text-xs">
              <td className="px-3 py-2 font-mono font-semibold text-foreground">{f.ticker || "—"}</td>
              <td className="px-3 py-2 text-foreground max-w-[12rem] truncate">{f.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{f.stage}</td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{f.prospectusDate}</td>
              <td className="px-3 py-2 text-muted-foreground">{f.form}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: ReactNode; icon: typeof Rocket }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="size-3.5 text-[#0D7490]" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
    </Card>
  );
}