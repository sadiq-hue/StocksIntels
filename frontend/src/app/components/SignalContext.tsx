import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { AlertTriangle, Info, Newspaper, Database } from "lucide-react";
import type { Signal } from "../types/signals";

// Everything here is best-effort: the engine omits levels for Hold ratings and
// for stocks whose levels failed validation, so each block renders only when its
// inputs are real numbers. Nothing is inferred or filled in with a default.

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && isFinite(n) && n > 0 ? n : null;
};
const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtNum = (v: number, dp = 2) =>
  v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Entry / stop / targets shown as percentages as well as prices, with a marker
 * for where the live price currently sits on that ladder.
 *
 * The existing card showed absolute prices only. A stop of "KES 28.29" tells an
 * investor nothing about how much risk they are taking; "-18.0%" does. The marker
 * also answers the question that actually matters on an open call: is this trade
 * still live, and how far has price already travelled?
 */
export function TradeLevelLadder(props: {
  signal: Partial<Signal>;
  price: number | null | undefined;
  currency?: string;
}) {
  const s = props.signal as any;
  const entry = num(s?.entry);
  const stop = num(s?.stopLoss);
  const t1 = num(s?.target1);
  const t3 = num(s?.target3) ?? num(s?.target2);
  const price = num(props.price);
  if (!entry) return null;

  const pctOf = (lvl: number) => ((lvl - entry) / entry) * 100;
  const sym = (props.currency || "USD") === "KES" ? "KES " : "$";

  // Ladder geometry: place stop at 0% and the far target at 100%, then map any
  // level (or the live price) into that span.
  const lo = Math.min(stop ?? entry, entry);
  const hi = Math.max(t3 ?? t1 ?? entry, entry, price ?? entry);
  const span = hi - lo;
  const posOf = (v: number) => (span > 0 ? Math.max(0, Math.min(100, ((v - lo) / span) * 100)) : 50);

  const levels: Array<{ label: string; v: number; tone: string; chip: string }> = [
    { label: "Entry", v: entry, tone: "text-blue-900", chip: "bg-blue-50 border-blue-100" },
  ];
  if (stop != null) levels.push({ label: "Stop", v: stop, tone: "text-red-900", chip: "bg-red-50 border-red-100" });
  if (t1 != null) levels.push({ label: "Target 1", v: t1, tone: "text-emerald-900", chip: "bg-emerald-50 border-emerald-100" });
  if (t3 != null && t3 !== t1) levels.push({ label: "Ultimate", v: t3, tone: "text-emerald-900", chip: "bg-emerald-50 border-emerald-100" });

  // How far the live price has already moved from entry.
  const movedFromEntry = price != null ? ((price - entry) / entry) * 100 : null;
  const aboveStop = price != null && stop != null ? price > stop : null;

  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trade levels</span>
        {s?.riskReward != null && (
          <span className="text-[10px] text-muted-foreground">
            Risk-to-reward <span className="font-semibold text-foreground">1:{Number(s.riskReward).toFixed(1)}</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {levels.map((l) => (
          <div key={l.label} className={`rounded-lg border p-2 text-center ${l.chip}`}>
            <div className="text-[9px] font-medium uppercase opacity-70">{l.label}</div>
            <div className={`text-sm font-bold ${l.tone}`}>{sym}{fmtNum(l.v)}</div>
            <div className="text-[9.5px] text-muted-foreground">
              {l.label === "Entry" ? "reference" : signedPct(pctOf(l.v))}
            </div>
          </div>
        ))}
      </div>

      {/* Ladder with the live price marked on it */}
      {span > 0 && (
        <div>
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-300 via-amber-200 to-emerald-300">
            {levels.filter((l) => l.label !== "Entry").map((l) => (
              <span
                key={l.label}
                title={`${l.label} ${sym}${fmtNum(l.v)}`}
                className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-foreground/70"
                style={{ left: `${posOf(l.v)}%` }}
              />
            ))}
            {price != null && (
              <span
                title={`Live price ${sym}${fmtNum(price)}`}
                className="absolute -top-0.5 -translate-x-1/2 rounded-full bg-[#0D7490] px-1 text-[8px] font-bold text-white"
                style={{ left: `${posOf(price)}%` }}
              >
                â–²
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{stop != null ? `Stop ${sym}${fmtNum(stop)}` : "Low"}</span>
            <span>
              {price != null && movedFromEntry != null
                ? `Price ${sym}${fmtNum(price)} (${signedPct(movedFromEntry)} vs entry)`
                : "Live price unavailable"}
            </span>
            <span>{t3 != null ? `Ultimate ${sym}${fmtNum(t3)}` : t1 != null ? `Target ${sym}${fmtNum(t1)}` : "High"}</span>
          </div>
          {aboveStop === false && (
            <p className="mt-1 text-[10.5px] font-medium text-red-600">
              Price is at or below the stop level on the last quote checked.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The specific event the engine flagged as able to move this stock. */
export function CatalystNote({ signal }: { signal: Partial<Signal> }) {
  const c = (signal as any)?.catalyst;
  if (!c || !c.headline) return null;
  const pos = String(c.direction || "").toLowerCase() === "positive";
  const strength = typeof c.strength === "number" ? ` Â· strength ${Math.round(c.strength)}` : "";
  return (
    <div className={`rounded-2xl border p-2.5 ${pos ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}>
      <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${pos ? "text-emerald-700" : "text-red-700"}`}>
        <Newspaper className="size-3" /> Catalyst {pos ? "(positive)" : "(negative)"}
      </div>
      <p className="text-[11.5px] leading-relaxed text-foreground">{c.headline}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {[c.source, c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : null, strength.replace(/^ Â· /, "")]
          .filter(Boolean)
          .join(" Â· ")}
      </p>
    </div>
  );
}

/**
 * Risk disclosure the engine raises when price has rallied hard while the
 * underlying fundamentals stay weak. Suppressing the composite score is a
 * decision the user should be able to see, not have to infer from a Hold.
 */
export function SpeculativeWarning({ signal }: { signal: Partial<Signal> }) {
  const sp = (signal as any)?.speculative;
  if (!sp || typeof sp.momentumPct !== "number") return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
        <AlertTriangle className="size-3" /> Speculative move flagged
      </div>
      <p className="text-[11.5px] leading-relaxed text-amber-900">
        Up {sp.momentumPct.toFixed(1)}% over the last {sp.lookbackSessions} sessions while the fundamentals have not improved.
        {sp.warning ? ` ${sp.warning}` : ""} The engine caps its composite score for moves like this.
      </p>
    </div>
  );
}

/**
 * Where the numbers behind this signal came from. Users are being asked to trust
 * a score, so the provenance belongs next to it rather than in a help page.
 */
export function SignalProvenance({ signal }: { signal: Partial<Signal> }) {  const s = signal as any;
  const src = s?.dataSource || s?.analysis?.overall?.dataSource;
  const a = s?.analysis;
  const parts: string[] = [];
  if (src) parts.push(`data: ${src}`);
  if (a?.overall?.score != null && a?.overall?.grade) {
    parts.push(`composite ${a.overall.score}/100 (grade ${a.overall.grade})`);
  }
  if (s?.signal_generatedAt || s?.generatedAt) parts.push("generated from the latest signal cycle");
  if (parts.length === 0) return null;
  return (
    <div className="flex items-start gap-1.5 rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
      <Database className="mt-px size-3 shrink-0" />
      <span>{parts.join(" Â· ")}. Scores summarise available data and are not investment advice â€” review the evidence above before deciding.</span>
    </div>
  );
}

/** One wrapper so the page can drop the blocks in without extra layout code. */
export function SignalContextExtras(props: {
  signal: Partial<Signal> | null | undefined;
  price: number | null | undefined;
  currency?: string;
}) {
  if (!props.signal) return null;
  return (
    <>
      <TradeLevelLadder signal={props.signal} price={props.price} currency={props.currency} />
      <CatalystNote signal={props.signal} />
      <SpeculativeWarning signal={props.signal} />
      <SignalProvenance signal={props.signal} />
    </>
  );
}
