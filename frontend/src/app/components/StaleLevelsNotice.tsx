import { useEffect, useState } from "react";
import { AlertTriangle, Radio } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const n = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) && x > 0 ? x : null;
};

function clockOf(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function ageLabel(ts: number | null): string | null {
  if (!ts || !isFinite(ts)) return null;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return null;
  return `${days} day${days === 1 ? "" : "s"} old`;
}

/**
 * Discloses when the published levels no longer describe the trade you would
 * actually be taking today.
 *
 * The card instructs the reader to "buy at the current market price", but every
 * number beside it - the entry, and the risk-to-reward derived from that entry -
 * is anchored to the price when the signal was generated. Once price drifts those
 * two things disagree.
 *
 * PAST PRICES ARE NOT THE SIGNAL CACHE. The signal payload's own `price` is only
 * refreshed when an exchange is open (15 minute cache TTL behind an
 * anyTrackedExchangeOpen guard), so with the market shut it is the last close -
 * not live. The drift therefore compares a genuinely live quote fetched from
 * /api/quote against the stored entry, and says which is which. If the live fetch
 * fails it falls back to the cache and says so rather than silently presenting a
 * stale number as current.
 */
export function StaleLevelsNotice({ selected }: { selected: any }) {
  const entry = n(selected?.entry);
  const stop = n(selected?.stopLoss);
  const t1 = n(selected?.target1);
  const cached = n(selected?.price);
  const ticker = selected?.ticker;
  const cur = selected?.currency === "KES" ? "KES " : "$";

  const [live, setLive] = useState<number | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [liveFailed, setLiveFailed] = useState(false);

  const genAt = (() => {
    const raw = selected?.generatedAt;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    return isFinite(t) ? t : null;
  })();

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    fetch(`${API_URL}/quote/${encodeURIComponent(String(ticker).startsWith("NSE:") ? ticker : ticker)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no quote"))))
      .then((q) => {
        if (cancelled) return;
        const p = n(q?.price);
        if (p) { setLive(p); setLiveAt(Date.now()); }
        else setLiveFailed(true);
      })
      .catch(() => { if (!cancelled) setLiveFailed(true); });
    return () => { cancelled = true; };
  }, [ticker]);

  const price = live ?? cached;
  if (!entry || !price) return null;

  const drift = ((price - entry) / entry) * 100;
  const DRIFT_THRESHOLD = 3;
  if (Math.abs(drift) < DRIFT_THRESHOLD) return null;

  const hasStop = stop != null;
  const riskFromEntry = hasStop && entry > (stop as number) ? entry - (stop as number) : null;
  const riskFromPrice = hasStop && price > (stop as number) ? price - (stop as number) : null;
  const reward = t1 ? t1 - price : null;
  const rrNow = riskFromPrice && reward ? reward / riskFromPrice : null;
  const rrAtEntry = riskFromEntry && t1 ? (t1 - entry) / riskFromEntry : null;
  const stopPctNow = riskFromPrice ? (riskFromPrice / price) * 100 : null;
  const stopPctEntry = riskFromEntry ? (riskFromEntry / entry) * 100 : null;
  const tighter = stopPctNow != null && stopPctEntry != null && stopPctNow < stopPctEntry;
  const up = drift > 0;

  const priceSrc = live
    ? `live quote${liveAt ? ` at ${clockOf(liveAt)}` : ""}`
    : liveFailed
      ? "last signal refresh (live quote unavailable)"
      : "last signal refresh";

  return (
    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
        <AlertTriangle className="size-3.5 shrink-0" />
        These levels are from an earlier price
        {ageLabel(genAt) ? ` (${ageLabel(genAt)})` : ""}
      </p>
      <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-amber-900">
        <p>
          Last price {cur}{price.toFixed(2)} ({priceSrc}) is {up ? "above" : "below"} the{" "}
          {cur}{entry.toFixed(2)} entry by {Math.abs(drift).toFixed(1)}%. The entry, stop
          and targets were sized from the price when the signal was generated
          {genAt ? ` on ${new Date(genAt).toLocaleDateString()}` : ""}.
        </p>
        {tighter && stopPctNow != null && stopPctEntry != null && (
          <p>
            Buying here puts the stop only <b>{stopPctNow.toFixed(1)}%</b> away
            {" "}— versus the {stopPctEntry.toFixed(1)}% the rating was built on. That is a
            tighter stop than the engine assessed, so ordinary volatility could take
            you out before the thesis plays out.
          </p>
        )}
        {rrNow != null && rrAtEntry != null && (
          <p>
            Risk-to-reward from the original entry is <b>{rrAtEntry.toFixed(1)}:1</b>;
            at the last price it is <b>{rrNow.toFixed(1)}:1</b>. Treat the headline ratio
            as describing the original entry, not the price on screen.
          </p>
        )}
        <p className="text-amber-800/90">
          Check the current signal and technicals before acting on this call.
        </p>
      </div>
    </div>
  );
}
