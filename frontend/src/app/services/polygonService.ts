const POLYGON_KEY = import.meta.env.VITE_POLYGON_API_KEY;
const POLYGON_BASE = "https://api.polygon.io";

export interface PolygonAgg {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
  n: number;
  t: number;
}

export interface PolygonOhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  timestamp: number;
  trades: number;
}

function toPolygonTicker(symbol: string): string {
  const clean = symbol.replace("NSE:", "").toUpperCase();
  if (symbol.startsWith("NSE:")) return `${clean}.XNSE`;
  return clean;
}

/**
 * Fetch historical OHLCV bars from Polygon.io
 * @param symbol  Stock ticker (e.g. "AAPL" or "NSE:SCOM")
 * @param multiplier  Timespan multiplier (default 1)
 * @param timespan  "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year"
 * @param from  YYYY-MM-DD start date
 * @param to  YYYY-MM-DD end date
 */
export async function fetchHistoricOhlcv(
  symbol: string,
  multiplier = 1,
  timespan: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year" = "day",
  from: string,
  to: string,
): Promise<PolygonOhlcvBar[]> {
  if (!POLYGON_KEY) return [];
  const ticker = toPolygonTicker(symbol);
  try {
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${POLYGON_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "OK" || !data.results) return [];
    return data.results.map((r: PolygonAgg) => ({
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
      vwap: r.vw,
      timestamp: Math.floor(r.t / 1000000000),
      trades: r.n,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch the previous trading day's OHLCV bar
 */
export async function fetchPrevDayOhlcv(symbol: string): Promise<PolygonOhlcvBar | null> {
  if (!POLYGON_KEY) return null;
  const ticker = toPolygonTicker(symbol);
  try {
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK" || !data.results?.length) return null;
    const r: PolygonAgg = data.results[0];
    return {
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
      vwap: r.vw,
      timestamp: Math.floor(r.t / 1000000000),
      trades: r.n,
    };
  } catch {
    return null;
  }
}
