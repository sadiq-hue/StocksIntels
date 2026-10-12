import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Card } from "./ui/card";
import { TrendingUp, TrendingDown, Loader2, Search, Globe2 } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "/api";

type Ex = "NGX" | "JSE";

const META: Record<Ex, { name: string; country: string; currency: string; flag: string }> = {
  NGX: { name: "Nigerian Exchange Group", country: "Nigeria", currency: "NGN", flag: "🇳🇬" },
  JSE: { name: "Johannesburg Stock Exchange", country: "South Africa", currency: "ZAR", flag: "🇿🇦" },
};

interface Row {
  symbol: string;
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  changePct: number;
  volume: number;
}

function fmt(currency: string, v: number) {
  const prefix = currency === "NGN" ? "₦" : currency === "ZAR" ? "R" : currency === "KES" ? "KES " : "$";
  return `${prefix}${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AfricanMarketsPanel() {
  const [searchParams] = useSearchParams();
  const wanted = (searchParams.get("exchange") || "").toUpperCase();
  const [exchange, setExchange] = useState<Ex>(wanted === "JSE" ? "JSE" : "NGX");
  const [stocks, setStocks] = useState<Row[]>([]);
  const [gainers, setGainers] = useState<Row[]>([]);
  const [losers, setLosers] = useState<Row[]>([]);
  const [status, setStatus] = useState<{ ngx: boolean; jse: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`${API}/africa/status`)
      .then(r => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    Promise.all([
      fetch(`${API}/africa/stocks?exchange=${exchange}&limit=200`).then(r => (r.ok ? r.json() : null)),
      fetch(`${API}/africa/movers?exchange=${exchange}`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([s, m]) => {
        if (dead) return;
        setStocks(Array.isArray(s?.data) ? s.data : []);
        setGainers(Array.isArray(m?.gainers) ? m.gainers : []);
        setLosers(Array.isArray(m?.losers) ? m.losers : []);
      })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [exchange]);

  const meta = META[exchange];
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return stocks;
    return stocks.filter(s => s.ticker.toLowerCase().includes(term) || (s.name || "").toLowerCase().includes(term));
  }, [stocks, q]);

  const open = status ? status[exchange === "NGX" ? "ngx" : "jse"] : null;

  return (
    <Card className="border shadow-sm p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center">
            <Globe2 className="size-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">African Markets</h3>
            <p className="text-[11px] text-muted-foreground">Nigeria &amp; South Africa &middot; delayed ~15 min</p>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-auto rounded-lg border p-1">
          {(["NGX", "JSE"] as Ex[]).map(ex => (
            <button
              key={ex}
              onClick={() => setExchange(ex)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${exchange === ex ? "bg-[#0D7490] text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        <span className="font-semibold text-foreground">{meta.flag} {meta.name}</span>
        <span className="text-muted-foreground">&middot; {meta.currency} &middot; {meta.country}</span>
        {open != null && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium border ${open ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${open ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
            {open ? "Market open" : "Market closed"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <Loader2 className="size-5 animate-spin mr-2" /> Loading {exchange}&hellip;
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {[
              { title: "Top Gainers", rows: gainers, up: true },
              { title: "Top Losers", rows: losers, up: false },
            ].map(g => (
              <div key={g.title}>
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  {g.up ? <TrendingUp className="size-3.5 text-emerald-600" /> : <TrendingDown className="size-3.5 text-red-500" />}
                  {g.title}
                </p>
                <div className="space-y-1">
                  {g.rows.slice(0, 5).map(r => (
                    <Link
                      key={`${g.title}-${r.ticker}`}
                      to={`/app/stock/${r.ticker}?market=${exchange.toLowerCase()}`}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{r.ticker}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{r.name}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-foreground">{fmt(meta.currency, r.price)}</div>
                        <div className={`text-[11px] font-semibold ${r.changePct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                        </div>
                      </div>
                    </Link>
                  ))}
                  {g.rows.length === 0 && <p className="text-xs text-muted-foreground py-2">No movers available.</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Listed on {exchange}</h4>
            <div className="relative ml-auto w-48 max-w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={`Search ${exchange}\u2026`}
                className="w-full pl-8 pr-2 h-8 rounded-lg border bg-background text-xs text-foreground outline-none focus:ring-1 focus:ring-[#0D7490]"
              />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Symbol</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Price</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.slice(0, 200).map(r => (
                  <tr key={r.ticker} className="hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <Link to={`/app/stock/${r.ticker}?market=${exchange.toLowerCase()}`} className="font-semibold text-foreground hover:text-[#0D7490]">{r.ticker}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-[220px]">{r.name}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{fmt(meta.currency, r.price)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.changePct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No stocks found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
