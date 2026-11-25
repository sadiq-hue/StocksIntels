import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface MarketIndex {
  name: string;
  symbol: string;
  market: string;
  currency: string;
  value: string;
  change: string;
  changeRaw: number;
  isPositive: boolean;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  previousClose?: string;
  lastUpdated?: string;
}

const INDEX_DISPLAY_ORDER = [
  { symbol: "NSE:NSE20", name: "NSE 20", exchange: "NSE" },
  { symbol: "NSE:NSEASI", name: "NSE All Share", exchange: "NSE" },
  { symbol: "NGX:ASI", name: "NGX All Share", exchange: "NGX" },
  { symbol: "^J200.JO", name: "JSE Top 40", exchange: "JSE" },
  { symbol: "^GSPC", name: "S&P 500", exchange: "NYSE" },
  { symbol: "^IXIC", name: "NASDAQ", exchange: "NASDAQ" },
  { symbol: "^DJI", name: "Dow Jones", exchange: "NYSE" },
  { symbol: "^FTSE", name: "FTSE 100", exchange: "LSE" },
  { symbol: "^N225", name: "Nikkei 225", exchange: "TSE" },
  { symbol: "^HSI", name: "Hang Seng", exchange: "HKEX" },
];

const CURRENCY_MAP: Record<string, string> = {
  "NSE:NSE20": "KES",
  "NSE:NSEASI": "KES",
  "NGX:ASI": "NGN",
  "^J200.JO": "ZAR",
  "^GSPC": "$",
  "^IXIC": "$",
  "^DJI": "$",
  "^FTSE": "£",
  "^N225": "¥",
  "^HSI": "HK$",
};

export function MarketIndicesOverview() {
  const [indices, setIndices] = useState<Record<string, MarketIndex>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchIndices = async () => {
      try {
        const response = await fetch(`${API_BASE}/market/indices`);
        if (!response.ok) throw new Error("Failed to fetch indices");
        const data = await response.json();
        if (alive) {
          const indexMap: Record<string, MarketIndex> = {};
          if (Array.isArray(data)) {
            data.forEach((item: MarketIndex) => {
              indexMap[item.symbol] = item;
            });
          }
          setIndices(indexMap);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load indices");
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchIndices();
    const timer = setInterval(fetchIndices, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const displayIndices = INDEX_DISPLAY_ORDER.map(({ symbol, name, exchange }) => {
    const index = indices[symbol];
    const currency = CURRENCY_MAP[symbol] || "$";
    if (!index) {
      return { symbol, name, exchange, currency, value: "--", change: "--", changeRaw: 0, isPositive: true, hasData: false, marketState: "UNKNOWN" };
    }
    return {
      symbol,
      name,
      exchange,
      currency,
      value: index.value,
      change: index.change,
      changeRaw: index.changeRaw,
      isPositive: index.isPositive,
      hasData: true,
      marketState: index.lastUpdated ? "Live" : "Delayed",
    };
  });

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {INDEX_DISPLAY_ORDER.map(({ symbol, name, exchange }) => (
          <div key={symbol} className="relative rounded-xl border border-white/10 bg-white/[0.02] p-5 animate-pulse">
            <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0" />
            <div className="relative flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold tracking-[0.1em] text-cyan-300">{exchange}</span>
                <span className="font-mono text-xs font-semibold text-slate-400">—</span>
              </div>
              <p className="text-sm font-medium text-slate-200 truncate">{name}</p>
              <p className="font-mono text-2xl font-semibold text-white">--.--</p>
              <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500">Loading...</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {INDEX_DISPLAY_ORDER.map(({ symbol, name, exchange }) => (
          <div key={symbol} className="relative rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <div className="relative flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold tracking-[0.1em] text-cyan-300">{exchange}</span>
                <span className="font-mono text-xs font-semibold text-rose-400">—</span>
              </div>
              <p className="text-sm font-medium text-slate-200 truncate">{name}</p>
              <p className="font-mono text-2xl font-semibold text-white">--.--</p>
              <p className="text-[10px] uppercase tracking-[0.1em] text-rose-500">Unavailable</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {displayIndices.map((index) => (
        <div key={index.symbol} className="group relative rounded-xl border border-white/10 bg-white/[0.02] p-5 hover:border-white/20 hover:bg-white/[0.05] transition-all">
          <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold tracking-[0.1em] text-cyan-300">{index.exchange}</span>
              <span className={`${index.isPositive ? "text-emerald-400" : index.changeRaw < 0 ? "text-rose-400" : "text-slate-400"} font-mono text-xs font-semibold`}>
                {index.hasData ? index.change : "—"}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-200 truncate">{index.name}</p>
            <p className="font-mono text-2xl font-semibold text-white">{index.value}</p>
            <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
              {index.marketState}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}