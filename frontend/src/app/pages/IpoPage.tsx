import { useState, useEffect, useMemo } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { TrendingUp, Calendar, DollarSign, Users, BarChart3, Timer, Globe } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface Ipo {
  id: number;
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
}

const statusColors: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-700 border-blue-200",
  current: "bg-amber-100 text-amber-700 border-amber-200",
  listed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  withdrawn: "bg-red-100 text-red-700 border-red-200",
  info: "bg-gray-100 text-gray-500 border-gray-200",
};

export function IpoPage() {
  const [tab, setTab] = useState<'nse' | 'global'>('nse');
  const [nseIpos, setNseIpos] = useState<Ipo[]>([]);
  const [globalIpos, setGlobalIpos] = useState<Ipo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/nse/ipos`).then(r => r.json()).then(d => { if (Array.isArray(d)) setNseIpos(d); }).catch(() => {}),
      fetch(`${API_BASE}/alpha/ipos`).then(r => r.json()).then(d => {
        if (Array.isArray(d) && d.length) setGlobalIpos(d);
        else return fetch(`${API_BASE}/global/ipos`).then(r => r.json()).then(fb => { if (Array.isArray(fb)) setGlobalIpos(fb); });
      }).catch(() => {
        fetch(`${API_BASE}/global/ipos`).then(r => r.json()).then(fb => { if (Array.isArray(fb)) setGlobalIpos(fb); }).catch(() => {});
      }),
    ]).finally(() => setLoading(false));
  }, []);

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

  const renderIpoCard = (ipo: Ipo) => (
    <Card key={ipo.id} className="p-4 border shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-semibold text-sm text-foreground">{ipo.company_name}</h3>
          <div className="flex items-center gap-1.5">
            {ipo.ticker && <span className="text-xs text-muted-foreground">{ipo.ticker}</span>}
            {ipo.exchange && <span className="text-[10px] text-muted-foreground">({ipo.exchange})</span>}
          </div>
        </div>
        <Badge className={`text-[10px] px-2 py-0.5 font-medium border ${statusColors[ipo.status] || ''}`}>
          {ipo.status === 'info' ? '' : ipo.status.charAt(0).toUpperCase() + ipo.status.slice(1)}
        </Badge>
      </div>
      {ipo.description && <p className="text-xs text-muted-foreground mb-3">{ipo.description}</p>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {ipo.offer_price && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="size-3" />
            <span>Offer: ${ipo.offer_price.toLocaleString()}</span>
          </div>
        )}
        {ipo.current_price != null && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BarChart3 className="size-3" />
            <span>Current: ${ipo.current_price.toLocaleString()}</span>
            {ipo.price_change_pct != null && (
              <span className={`text-[10px] font-medium ${ipo.price_change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {ipo.price_change_pct >= 0 ? '+' : ''}{ipo.price_change_pct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
        {ipo.oversubscription_pct != null && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="size-3" />
            <span>{ipo.oversubscription_pct}x oversubscribed</span>
          </div>
        )}
        {ipo.listing_date && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="size-3" />
            <span>{ipo.listing_date}</span>
          </div>
        )}
        {ipo.sector && (
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
            <Timer className="size-3" />
            <span>Sector: {ipo.sector}</span>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center">
          <TrendingUp className="size-4 text-blue-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">New Listings & IPOs</h1>
          <p className="text-xs text-muted-foreground">Track NSE and global IPO offerings</p>
        </div>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-6 w-fit">
        <button onClick={() => setTab('nse')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === 'nse' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          NSE IPOs
        </button>
        <button onClick={() => setTab('global')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${tab === 'global' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Globe className="size-3" /> Global IPOs
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading IPO data...</div>
      ) : (
        <>
          {current.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                <Timer className="size-4" /> Current / Ongoing
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {current.map(renderIpoCard)}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                <Calendar className="size-4" /> Upcoming
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {upcoming.map(renderIpoCard)}
              </div>
            </div>
          )}

          {listed.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
                <TrendingUp className="size-4" /> Recently Listed
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {listed.map(renderIpoCard)}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-2">Other</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {past.map(renderIpoCard)}
              </div>
            </div>
          )}

          {ipos.length === 0 && (
            <Card className="p-6 text-center border-dashed">
              <p className="text-sm text-muted-foreground">No IPO data available for this market.</p>
            </Card>
          )}
        </>
      )}

      <Card className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100">
        <h3 className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-2">
          {tab === 'nse' ? 'About NSE IPOs' : 'About Global IPOs'}
        </h3>
        {tab === 'nse' ? (
          <p className="text-xs text-gray-600 leading-relaxed">
            Initial Public Offerings (IPOs) on the Nairobi Securities Exchange allow companies to raise capital by listing shares to the public.
            Notable NSE IPOs include Safaricom (2008), KCB Group, and Co-op Bank. Investors can participate through approved stockbrokers.
            Oversubscription rates indicate investor demand — rates above 100% signal strong interest.
          </p>
        ) : (
          <p className="text-xs text-gray-600 leading-relaxed">
            Global IPOs span major exchanges including the NYSE, NASDAQ, and international bourses. Notable offerings include Saudi Aramco
            (largest in history at $29.4B), Alibaba ($25B), and Arm Holdings (largest tech IPO of 2023). Oversubscription rates indicate
            investor demand — rates above 100% signal strong interest.
          </p>
        )}
      </Card>
    </div>
  );
}
