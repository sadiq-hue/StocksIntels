import { useState, useEffect, useMemo, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Rocket, Calendar, DollarSign, Users, BarChart3, Timer, Globe2, RefreshCw, TrendingUp, TrendingDown, Info } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

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
  source?: string;
}

const statusColors: Record<string, string> = {
  upcoming: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50",
  current: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50",
  listed: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50",
  withdrawn: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/50",
  info: "bg-muted text-muted-foreground border-border",
};

export function IpoPage() {
  const [tab, setTab] = useState<'nse' | 'global'>('nse');
  const [nseIpos, setNseIpos] = useState<Ipo[]>([]);
  const [globalIpos, setGlobalIpos] = useState<Ipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [alphaStatus, setAlphaStatus] = useState<string | null>(null);

  const fetchGlobalIpos = useCallback(async (showSpinner = true) => {
    if (showSpinner) setGlobalLoading(true);
    setGlobalError(null);
    setAlphaStatus(null);
    try {
      const res = await fetch(`${API_BASE}/alpha/ipos?refresh=1`);
      if (!res.ok) {
        const fb = await fetch(`${API_BASE}/global/ipos`);
        const data = await fb.json();
        if (Array.isArray(data)) setGlobalIpos(data);
        return;
      }
      const body = await res.json();
      if (Array.isArray(body)) {
        setGlobalIpos(body);
      } else if (body && Array.isArray(body.ipos)) {
        setGlobalIpos(body.ipos);
        if (body.alphaStatus === 'rate_limited') {
          setAlphaStatus('rate_limited');
        } else if (body.alphaStatus === 'error') {
          setAlphaStatus('error');
        }
      }
    } catch {
      try {
        const fb = await fetch(`${API_BASE}/global/ipos`);
        const data = await fb.json();
        if (Array.isArray(data)) setGlobalIpos(data);
      } catch {
        setGlobalError("Failed to load global IPO data. Alpha Vantage may not be configured.");
      }
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/nse/ipos`).then(r => r.json()).then(d => { if (Array.isArray(d)) setNseIpos(d); }).catch(() => {}),
      fetchGlobalIpos(false),
    ]).finally(() => setLoading(false));
  }, [fetchGlobalIpos]);

  const ipos = tab === 'nse' ? nseIpos : globalIpos;

  const { upcoming, current, listed, past } = useMemo(() => {
    const u: Ipo[] = [], c: Ipo[] = [], l: Ipo[] = [], p: Ipo[] = [];
    for (const ipo of ipos) {
      if (ipo.status === 'upcoming') u.push(ipo);
      else if (ipo.status === 'current') c.push(ipo);
      else if (ipo.status === 'listed') l.push(ipo);
      else p.push(ipo);
    }
    return { upcoming: u, current: c, listed: l, past: p };
  }, [ipos]);

  const renderIpoCard = (ipo: Ipo, market: 'nse' | 'global') => {
    const cur = market === 'nse' ? 'KES ' : '$';
    return (
      <Card key={ipo.id} className="p-4 border shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm text-foreground">{ipo.company_name}</h3>
            <div className="flex items-center gap-1.5">
              {ipo.ticker && <span className="text-xs font-mono text-muted-foreground bg-muted px-1 py-0.5 rounded">{ipo.ticker}</span>}
              {ipo.exchange && <span className="text-[10px] text-muted-foreground">({ipo.exchange})</span>}
            </div>
          </div>
          <Badge className={`text-[10px] px-2 py-0.5 font-medium border ${statusColors[ipo.status] || ''}`}>
            {ipo.status === 'info' ? '' : ipo.status.charAt(0).toUpperCase() + ipo.status.slice(1)}
          </Badge>
        </div>
        {ipo.description && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{ipo.description}</p>}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {ipo.offer_price != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="size-3 shrink-0" />
              <span>Offer: {cur}{ipo.offer_price.toLocaleString()}</span>
            </div>
          )}
          {ipo.current_price != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BarChart3 className="size-3 shrink-0" />
              <span>Current: {cur}{ipo.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
              {ipo.price_change_pct != null && (
                <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${ipo.price_change_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {ipo.price_change_pct >= 0 ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                  {ipo.price_change_pct >= 0 ? '+' : ''}{ipo.price_change_pct.toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {ipo.offer_price != null && ipo.current_price != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="size-3 shrink-0" />
              <span className={`font-medium ${((ipo.current_price - ipo.offer_price) / ipo.offer_price * 100) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                Since IPO: {((ipo.current_price - ipo.offer_price) / ipo.offer_price * 100) >= 0 ? '+' : ''}{((ipo.current_price - ipo.offer_price) / ipo.offer_price * 100).toFixed(1)}%
              </span>
            </div>
          )}
          {ipo.oversubscription_pct != null && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="size-3 shrink-0" />
              <span>{ipo.oversubscription_pct}x oversubscribed</span>
            </div>
          )}
          {ipo.listing_date && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="size-3 shrink-0" />
              <span>{ipo.listing_date}</span>
            </div>
          )}
          {ipo.sector && (
            <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
              <Timer className="size-3 shrink-0" />
              <span>Sector: {ipo.sector}</span>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
          <Rocket className="size-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">New Listings & IPOs</h1>
          <p className="text-xs text-muted-foreground">Track NSE and global IPO offerings</p>
        </div>
      </div>

      {/* Tab Toggle */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
          <button onClick={() => setTab('nse')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === 'nse' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            NSE IPOs
          </button>
          <button onClick={() => setTab('global')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${tab === 'global' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <Globe2 className="size-3" /> Global IPOs
          </button>
        </div>
        {tab === 'global' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchGlobalIpos(true)}
            disabled={globalLoading}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={`size-3 ${globalLoading ? 'animate-spin' : ''}`} />
            {globalLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading IPO data...</div>
      ) : (
        <>
          {globalError && tab === 'global' && (
            <Card className="p-4 mb-6 border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <Info className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">{globalError}</p>
              </div>
            </Card>
          )}

          {alphaStatus === 'rate_limited' && tab === 'global' && (
            <Card className="p-4 mb-6 border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/20">
              <div className="flex items-start gap-2">
                <Info className="size-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Alpha Vantage rate-limited</p>
                  <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">Showing historic IPOs with live prices. New upcoming listings will appear when the API quota resets (typically within a few minutes).</p>
                </div>
              </div>
            </Card>
          )}

          {current.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                <Timer className="size-4" /> Current / Ongoing
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {current.map(i => renderIpoCard(i, tab))}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1.5">
                <Calendar className="size-4" /> Upcoming ({upcoming.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {upcoming.map(i => renderIpoCard(i, tab))}
              </div>
            </div>
          )}

          {listed.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1.5">
                <Rocket className="size-4" /> Recently Listed ({listed.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {listed.map(i => renderIpoCard(i, tab))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">Other</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {past.map(i => renderIpoCard(i, tab))}
              </div>
            </div>
          )}

          {ipos.length === 0 && !globalError && (
            <Card className="p-6 text-center border-dashed">
              <p className="text-sm text-muted-foreground">No IPO data available for this market.</p>
            </Card>
          )}
        </>
      )}

      <Card className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-100 dark:border-blue-800/50">
        <h3 className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wider mb-2">
          {tab === 'nse' ? 'About NSE IPOs' : 'About Global IPOs'}
        </h3>
        {tab === 'nse' ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Initial Public Offerings (IPOs) on the Nairobi Securities Exchange allow companies to raise capital by listing shares to the public.
            Notable NSE IPOs include Safaricom (2008), KCB Group, and Co-op Bank. Investors can participate through approved stockbrokers.
            Oversubscription rates indicate investor demand — rates above 100% signal strong interest.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Global IPO data sourced from Alpha Vantage and enriched with current market prices. Includes upcoming listings and historical
            IPOs across NYSE, NASDAQ, and international exchanges. Current prices update in real-time where market data is available.
          </p>
        )}
      </Card>
    </div>
  );
}
