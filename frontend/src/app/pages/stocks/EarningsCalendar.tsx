import { useState, useEffect, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import {
  Search, CalendarDays, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, BarChart3, DollarSign,
  Building2, Globe, ExternalLink, X,
} from "lucide-react";
import { useNavigate } from "react-router";
import {
  fetchUpcomingEarnings, fetchEarningsCriteria,
  type EarningsEvent, type EarningsResult, type EarningsCriteria,
} from "../../services/earningsService";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMarketCap(mcap: number): string {
  if (mcap >= 1e12) return `$${(mcap / 1e12).toFixed(2)}T`;
  if (mcap >= 1e9) return `$${(mcap / 1e9).toFixed(1)}B`;
  if (mcap >= 1e6) return `$${(mcap / 1e6).toFixed(1)}M`;
  return "";
}

function formatRevenue(rev: number): string {
  if (rev >= 1e12) return `$${(rev / 1e12).toFixed(2)}T`;
  if (rev >= 1e9) return `$${(rev / 1e9).toFixed(1)}B`;
  if (rev >= 1e6) return `$${(rev / 1e6).toFixed(1)}M`;
  if (rev > 0) return `$${(rev / 1e3).toFixed(1)}K`;
  return "$0";
}

function EarningDetail({ event, onClose }: { event: EarningsEvent; onClose: () => void }) {
  const navigate = useNavigate();
  const isUpcoming = event.actualEPS === 0;
  const surpriseAbs = Math.abs(event.surprise);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <Card className="max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 md:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center">
                <BarChart3 className="size-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-foreground">{event.ticker}</h3>
                  <Badge variant="outline" className={`text-[10px] ${event.market === "nse" ? "text-[#0D7490]" : "text-indigo-500"}`}>
                    {event.market === "nse" ? "NSE" : "Global"}
                  </Badge>
                  {isUpcoming && <Badge className="text-[9px] bg-amber-100 text-amber-800 border-amber-200">Upcoming</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{event.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <X className="size-5 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 border">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Period</p>
              <p className="text-sm font-bold text-foreground">{event.quarter} FY{event.fiscalYear}</p>
              <p className="text-xs text-muted-foreground">{event.dateStr}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 border">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Sector</p>
              <p className="text-sm font-bold text-foreground">{event.sector}</p>
              {event.marketCap > 0 && <p className="text-xs text-muted-foreground">{formatMarketCap(event.marketCap)}</p>}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-3">Earnings Per Share (EPS)</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
                <p className="text-[10px] text-blue-600 font-semibold uppercase mb-1">Estimated</p>
                <p className="text-lg font-black text-blue-700">{event.currency === "KES" ? "KES " : "$"}{event.estEPS.toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-center">
                <p className="text-[10px] text-emerald-600 font-semibold uppercase mb-1">Actual</p>
                <p className="text-lg font-black text-emerald-700">
                  {isUpcoming ? "\u2014\u2014" : `${event.currency === "KES" ? "KES " : "$"}${event.actualEPS.toFixed(2)}`}
                </p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${isUpcoming ? "bg-gray-50 border-gray-200" : event.isBeat ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                <p className={`text-[10px] font-semibold uppercase mb-1 ${isUpcoming ? "text-gray-500" : event.isBeat ? "text-emerald-600" : "text-red-600"}`}>Surprise</p>
                <div className={`flex items-center justify-center gap-1 text-lg font-black ${isUpcoming ? "text-gray-400" : event.isBeat ? "text-emerald-700" : "text-red-700"}`}>
                  {isUpcoming ? "\u2014\u2014" : <>{event.isBeat ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}{event.surprise >= 0 ? "+" : ""}{event.surprise}%</>}
                </div>
              </div>
            </div>
          </div>

          {!isUpcoming && (
          <div className="rounded-lg bg-muted/30 p-4 border">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">Surprise Visualization</p>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground w-16">Estimate</span>
              <div className="flex-1 h-5 rounded-full bg-blue-100 relative overflow-hidden">
                <div className="absolute inset-y-0 right-0 bg-blue-400 rounded-full"
                  style={{ width: `${Math.min(100, (event.estEPS / Math.max(event.estEPS, event.actualEPS)) * 100)}%` }} />
              </div>
              <span className="text-xs font-bold text-blue-700 w-16 text-right">{event.estEPS.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs font-medium text-muted-foreground w-16">Actual</span>
              <div className="flex-1 h-5 rounded-full bg-emerald-100 relative overflow-hidden">
                <div className="absolute inset-y-0 right-0 bg-emerald-400 rounded-full"
                  style={{ width: `${Math.min(100, (event.actualEPS / Math.max(event.estEPS, event.actualEPS)) * 100)}%` }} />
              </div>
              <span className="text-xs font-bold text-emerald-700 w-16 text-right">{event.actualEPS.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
              <span className={`text-xs font-semibold ${event.isBeat ? "text-emerald-600" : "text-red-600"}`}>
                {event.isBeat ? "Beat" : "Miss"} by {surpriseAbs}% &mdash;
                {event.isBeat
                  ? ` $${(event.actualEPS - event.estEPS).toFixed(2)} above estimate`
                  : ` $${(event.estEPS - event.actualEPS).toFixed(2)} below estimate`}
              </span>
            </div>
          </div>
          )}

          <div className="rounded-lg bg-muted/50 p-3 border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Revenue</p>
                <p className="text-sm font-bold text-foreground">{event.currency === "KES" ? `KES ${event.revenue.toFixed(1)}B` : formatRevenue(event.revenue)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Currency</p>
                <p className="text-sm font-bold text-foreground">{event.currency}</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => { onClose(); navigate(`/app/stock/${event.ticker}?market=${event.market}`); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0D7490] text-white font-semibold hover:bg-[#0A5F7A] transition-colors"
          >
            <ExternalLink className="size-4" /> View Full Stock Analysis
          </button>
        </div>
      </Card>
    </div>
  );
}

export function EarningsCalendar() {
  const navigate = useNavigate();
  const [result, setResult] = useState<EarningsResult | null>(null);
  const [criteria, setCriteria] = useState<EarningsCriteria | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EarningsEvent | null>(null);

  useEffect(() => {
    fetchEarningsCriteria().then(setCriteria).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    const doFetch = () => {
      setLoading(true);
      fetchUpcomingEarnings({
        search: search || undefined,
        market: marketFilter || undefined,
        sector: sectorFilter || undefined,
        limit: 2000,
      })
        .then(r => {
          if (cancelled) return;
          setResult(r);
          if (r.earnings.length > 0 || r.total > 0) {
            setLoading(false);
          } else {
            retryTimer = setTimeout(doFetch, 5000);
          }
        })
        .catch(() => { if (!cancelled) { setResult(null); retryTimer = setTimeout(doFetch, 5000); } })
    };
    doFetch();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [search, marketFilter, sectorFilter]);

  const allEarnings = result?.earnings || [];

  const today = new Date();
  const [weekOffset, setWeekOffset] = useState(0);
  const [autoJumped, setAutoJumped] = useState(false);

  const viewWeekStart = new Date(today);
  viewWeekStart.setDate(viewWeekStart.getDate() + weekOffset * 7 - ((viewWeekStart.getDay() + 6) % 7));
  const viewWeekEnd = new Date(viewWeekStart);
  viewWeekEnd.setDate(viewWeekEnd.getDate() + 6);

  const filtered = useMemo(() => {
    const nextEvent = allEarnings.find(e => new Date(e.date) >= viewWeekStart);
    const weekEvents = allEarnings.filter(e => {
      const d = new Date(e.date);
      return d >= viewWeekStart && d <= viewWeekEnd;
    });
    return { all: weekEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()), nextEvent: nextEvent || null };
  }, [allEarnings, viewWeekStart, viewWeekEnd]);

  useEffect(() => {
    if (!autoJumped && allEarnings.length > 0 && filtered.all.length === 0 && filtered.nextEvent) {
      const next = new Date(filtered.nextEvent.date);
      const weeksDiff = Math.floor((next.getTime() - today.getTime()) / (7 * 86400000));
      setWeekOffset(weeksDiff);
      setAutoJumped(true);
    }
  }, [allEarnings.length, filtered.all.length, autoJumped, filtered.nextEvent, today]);

  const groupedByDay = useMemo(() => {
    const groups: Record<string, EarningsEvent[]> = {};
    filtered.all.forEach(e => {
      if (!groups[e.dateStr]) groups[e.dateStr] = [];
      groups[e.dateStr].push(e);
    });
    return groups;
  }, [filtered.all]);

  const totals = useMemo(() => {
    let beats = 0, misses = 0, upcoming = 0;
    allEarnings.forEach(e => { if (e.actualEPS === 0) upcoming++; else if (e.isBeat) beats++; else misses++; });
    return { total: allEarnings.length, beats, misses, upcoming };
  }, [allEarnings]);

  const weekLabel = `${months[viewWeekStart.getMonth()]} ${viewWeekStart.getDate()} - ${months[viewWeekEnd.getMonth()]} ${viewWeekEnd.getDate()}, ${viewWeekEnd.getFullYear()}`;

  return (
    <div className="space-y-6">
      {selectedEvent && <EarningDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">Earnings Calendar</h2>
          <p className="text-sm text-muted-foreground truncate">Upcoming earnings reports and estimates</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search ticker or company..."
              className="w-full sm:w-48 pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={marketFilter}
            onChange={e => setMarketFilter(e.target.value)}
          >
            <option value="">All Markets</option>
            {criteria?.markets.map(m => <option key={m} value={m}>{m === "nse" ? "NSE" : "Global"}</option>)}
          </select>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={sectorFilter}
            onChange={e => setSectorFilter(e.target.value)}
          >
            <option value="">All Sectors</option>
            {criteria?.sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Reports</p><p className="text-lg font-bold text-foreground">{totals.total}</p></Card>
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase font-semibold">Upcoming</p><p className="text-lg font-bold text-amber-600">{totals.upcoming}</p></Card>
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase font-semibold">Reported</p><p className="text-lg font-bold text-emerald-600">{totals.beats + totals.misses}</p></Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={() => setWeekOffset(prev => prev - 1)}
          className="flex items-center gap-1 px-3 py-2 rounded-lg border bg-background text-sm font-semibold hover:bg-accent transition-colors"
        >
          <ChevronLeft className="size-4" /> Previous Week
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="size-4 text-[#0D7490]" />
          <span className="font-semibold text-foreground">{weekLabel}</span>
        </div>
        <button
          onClick={() => setWeekOffset(prev => prev + 1)}
          className="flex items-center gap-1 px-3 py-2 rounded-lg border bg-background text-sm font-semibold hover:bg-accent transition-colors"
        >
          Next Week <ChevronRight className="size-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <div className="size-6 border-2 border-[#0D7490] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : Object.keys(groupedByDay).length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarDays className="size-12 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">No earnings reports this week</p>
        </Card>
      ) : (
        Object.entries(groupedByDay).map(([day, earnings]) => (
          <div key={day}>
            <div className="flex items-center gap-3 mb-3">
              <div className="size-2 rounded-full bg-[#0D7490]" />
              <h3 className="font-bold text-foreground">{day}</h3>
              <Badge variant="secondary" className="text-[10px]">{earnings.length} report{earnings.length > 1 ? "s" : ""}</Badge>
            </div>
            <div className="space-y-2 mb-6">
              {earnings.map((e: EarningsEvent) => (
                <Card
                  key={e.id}
                  className="p-4 hover:shadow-sm hover:border-[#0D7490]/30 transition-all cursor-pointer border-l-4"
                  style={{ borderLeftColor: e.actualEPS === 0 ? "#9ca3af" : e.isBeat ? "#10b981" : "#ef4444" }}
                  onClick={() => setSelectedEvent(e)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                        <BarChart3 className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-foreground">{e.ticker}</span>
                          <Badge variant="outline" className={`text-[9px] ${e.market === "nse" ? "text-[#0D7490]" : "text-indigo-500"}`}>
                            {e.market === "nse" ? "NSE" : "Global"}
                          </Badge>
                          {e.actualEPS === 0 && <span className="text-[9px] text-amber-600 font-medium">Upcoming</span>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{e.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold">{e.quarter} FY{e.fiscalYear}</p>
                        <p className="text-xs text-muted-foreground">{e.sector}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold">Est.</p>
                        <p className="text-sm font-mono font-bold text-foreground">{e.estEPS.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold">Act.</p>
                        <p className="text-sm font-mono font-bold">{e.actualEPS === 0 ? "\u2014\u2014" : `${e.currency === "KES" ? "KES " : "$"}${e.actualEPS.toFixed(2)}`}</p>
                      </div>
                      <div className={`px-2.5 py-1.5 rounded-lg text-center ${e.actualEPS === 0 ? "bg-gray-50" : e.isBeat ? "bg-emerald-50" : "bg-red-50"}`}>
                        <p className={`text-xs font-bold flex items-center gap-0.5 ${e.actualEPS === 0 ? "text-gray-400" : e.isBeat ? "text-emerald-700" : "text-red-700"}`}>
                          {e.actualEPS === 0 ? "\u2014\u2014" : <>{e.isBeat ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{e.surprise >= 0 ? "+" : ""}{e.surprise}%</>}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {result && result.total > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {filtered.all.length} earnings reports for {weekLabel} &middot; {result.total} total upcoming
        </div>
      )}
    </div>
  );
}
