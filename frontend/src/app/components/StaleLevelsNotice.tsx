import { AlertTriangle } from "lucide-react";

const n = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) && x > 0 ? x : null;
};

/**
 * Discloses when the published levels no longer describe the trade you would
 * actually be taking today.
 *
 * The card instructs the reader to "buy at the current market price", but every
 * number next to it - the entry, and the risk-to-reward derived from that entry -
 * is anchored to the price when the signal was generated. Once price has drifted,
 * those two things disagree.
 *
 * Concretely (PAAS, observed): the signal was generated at an entry of $49.62
 * with a stop at $40.69, and price later fell to $45.51. The card still
 * advertised "risk-to-reward 2.0:1", which is the ratio from the old entry. A
 * reader following the instruction to buy now would face a stop only 10.6% away
 * rather than the ~18% the rating was sized for, giving a different ratio
 * (~4.6:1) on a materially tighter stop - i.e. a trade the engine never
 * evaluated.
 *
 * So this states the drift, the age when known, and the recomputed numbers
 * rather than letting the stale ratio stand unqualified.
 */
export function StaleLevelsNotice({ selected }: { selected: any }) {
  const entry = n(selected?.entry);
  const stop = n(selected?.stopLoss);
  const t1 = n(selected?.target1);
  const price = n(selected?.price);
  if (!entry || !price) return null;

  const drift = ((price - entry) / entry) * 100;
  // Only worth interrupting for once the drift is material relative to the stop.
  const DRIFT_THRESHOLD = 3;
  if (Math.abs(drift) < DRIFT_THRESHOLD) return null;

  const ageLabel = (() => {
    const raw = selected?.generatedAt || selected?.timestamp;
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!isFinite(t)) return null;
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return null;
    return `${days} day${days === 1 ? "" : "s"} old`;
  })();

  const hasStop = stop != null;
  const riskFromEntry = hasStop && entry > (stop as number) ? entry - (stop as number) : null;
  const riskFromPrice = hasStop && price > (stop as number) ? price - (stop as number) : null;
  const reward = t1 ? t1 - price : null;
  const rrNow = riskFromPrice && reward ? reward / riskFromPrice : null;
  const rrAtEntry = riskFromEntry && t1 ? (t1 - entry) / riskFromEntry : null;
  const stopPctNow = riskFromPrice ? (riskFromPrice / price) * 100 : null;
  const stopPctEntry = riskFromEntry ? (riskFromEntry / entry) * 100 : null;
  const cur = selected?.currency === "KES" ? "KES " : "$";

  const tighter = stopPctNow != null && stopPctEntry != null && stopPctNow < stopPctEntry;
  const up = drift > 0;

  return (
    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
        <AlertTriangle className="size-3.5 shrink-0" />
        These levels are from an earlier price
        {ageLabel ? ` (${ageLabel})` : ""}
      </p>
      <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-amber-900">
        <p>
          Price is now {cur}{price.toFixed(2)}, {up ? "above" : "below"} the{" "}
          {cur}{entry.toFixed(2)} entry by {Math.abs(drift).toFixed(1)}%. The entry,
          stop and targets were sized from the price when the signal was generated.
        </p>
        {tighter && stopPctNow != null && stopPctEntry != null && (
          <p>
            Buying here puts the stop only <b>{stopPctNow.toFixed(1)}%</b> away
            {" "}â€” versus the {stopPctEntry.toFixed(1)}% the rating was built on. That is a
            tighter stop than the engine assessed, so ordinary volatility could take
            you out before the thesis plays out.
          </p>
        )}
        {rrNow != null && rrAtEntry != null && (
          <p>
            Risk-to-reward from the original entry is{" "}
            <b>{rrAtEntry.toFixed(1)}:1</b>; buying at today&apos;s price it is{" "}
            <b>{rrNow.toFixed(1)}:1</b>. Treat the headline ratio as describing the
            original entry, not the price on screen.
          </p>
        )}
        <p className="text-amber-800/90">
          Check the current signal and technicals before acting on this call.
        </p>
      </div>
    </div>
  );
}
