import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { AlertTriangle, ChevronDown, Radio } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// ── numeric / text helpers ──────────────────────────────────────────────────
const num = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) ? x : null;
};
const pos = (v: any): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const pct = (v: any, dp = 1) =>
  num(v) == null ? "—" : `${num(v)! >= 0 ? "+" : ""}${num(v)!.toFixed(dp)}%`;
const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A rating that means "the underlying data was unavailable", not "balanced". */
const NO_DATA = /no\s+(data|analyst|roe)|not available|insufficient|n\/a/i;

type Verdict = "Positive" | "Negative" | "Neutral" | "Insufficient data";

function verdictOf(signal: any, rating: any): Verdict {
  const s = String(signal || "").toUpperCase();
  const r = String(rating || "");
  if (NO_DATA.test(r)) return "Insufficient data";
  if (!s || s === "NEUTRAL") return "Neutral";
  if (s === "BUY" || s === "STRONG BUY") return "Positive";
  if (s === "SELL" || s === "SUPPRESS") return "Negative";
  return "Neutral";
}

const VERDICT_STYLE: Record<Verdict, string> = {
  Positive: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Negative: "bg-red-100 text-red-700 border-red-200",
  Neutral: "bg-muted text-muted-foreground border-border",
  "Insufficient data": "bg-slate-100 text-slate-600 border-slate-200 border-dashed",
};

const CONDITIONS = [
  { key: "evSignal", name: "EV/EBITDA", cat: "Valuation" },
  { key: "peSignal", name: "P/E vs Sector", cat: "Valuation" },
  { key: "pbSignal", name: "Price/Book", cat: "Valuation" },
  { key: "divSignal", name: "Dividend Yield", cat: "Valuation" },
  { key: "revSignal", name: "Revenue Growth", cat: "Growth" },
  { key: "epsSignal", name: "Earnings Surprise", cat: "Growth" },
  { key: "mgnSignal", name: "Margin Trend", cat: "Growth" },
  { key: "fcfSignal", name: "Free Cash Flow Yield", cat: "Growth" },
  { key: "deSignal", name: "Debt/Equity", cat: "Balance Sheet" },
  { key: "crSignal", name: "Current Ratio", cat: "Balance Sheet" },
  { key: "roeSignal", name: "Return on Equity", cat: "Balance Sheet" },
  { key: "altSignal", name: "Altman Z-Score", cat: "Balance Sheet" },
];
const RATING_KEYS: Record<string, string> = {
  peSignal: "peRating", evSignal: "evRating", pbSignal: "pbRating", divSignal: "divRating",
  revSignal: "revRating", epsSignal: "epsRating", mgnSignal: "mgnRating", fcfSignal: "fcfRating",
  deSignal: "debtRating", crSignal: "crRating", roeSignal: "roeRating", altSignal: "altRating",
};
const MACRO_LABELS: Record<string, string> = {
  pmi: "Manufacturing Activity", gdp: "GDP Growth", gdpGrowth: "GDP Growth",
  inflation: "Inflation", creditRating: "Credit Rating", politicalRisk: "Political Risk",
  currentAccount: "Current Account", interestRateDifferential: "Interest Rates vs Fed",
};
const DIMS = [
  { key: "fundamental", label: "Fundamentals" },
  { key: "technical", label: "Technical" },
  { key: "financial", label: "Financial Health" },
  { key: "macro", label: "Macro" },
  { key: "insider", label: "Insider Activity" },
];

function strength(score: number | null | undefined): string {
  if (score == null || !isFinite(score)) return "Not scored";
  if (score >= 75) return "Very strong";
  if (score >= 65) return "Strong";
  if (score >= 55) return "Moderate";
  if (score >= 45) return "Mixed";
  return "Weak";
}
const scoreInk = (s: any) =>
  s == null || !isFinite(s) ? "text-muted-foreground/50"
    : s >= 65 ? "text-emerald-700" : s >= 50 ? "text-amber-700" : "text-red-600";

function listOf(items: string[]): string {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function Section(props: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
        {props.sub && <span className="text-[10px] italic text-muted-foreground">{props.sub}</span>}
        {props.right && <span className="ml-auto">{props.right}</span>}
      </div>
      {props.children}
    </section>
  );
}

function Row(props: { l: ReactNode; r: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{props.l}</span>
      <span className="text-right text-foreground">{props.r}</span>
    </div>
  );
}

/**
 * Market Intelligence card.
 *
 * Structured so the investor reads conclusion, then reasoning, then detail, and
 * never has to reconcile two different numbers for the same thing:
 *   - "Market price" is fetched live from /api/quote and timestamped now
 *   - "Position analysis" carries the timestamp of the run that set the levels,
 *     because entry/stop/targets only hold as of that moment
 * Terminology is Position rather than Signal: these are modelled views with
 * levels and a thesis, not instructions to execute an order.
 */
export function MarketIntelligenceCard({ signal }: { signal: any }) {
  const s = signal || {};
  const a = s.analysis || {};
  const cur = s.currency === "KES" ? "KES " : "$";
  const money = (v: any) => {
    const n = pos(v);
    return n == null ? "—"
      : `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [live, setLive] = useState<{ price: number | null; at: number }>({ price: null, at: 0 });
  useEffect(() => {
    if (!s.ticker) return;
    // Kenyan listings MUST be requested with the NSE: prefix. A bare "CGEN"
    // resolves to a different company on the US feed (it returned 2.31 against a
    // true KES 284) and "SCOM" 404s entirely, which would have put a wrong live
    // price into the levels table and a meaningless drift on every NSE holding.
    const isNse = s.market === "NSE" || s.currency === "KES";
    const sym = isNse ? `NSE:${s.ticker}` : s.ticker;
    let dead = false;
    fetch(`${API_URL}/quote/${encodeURIComponent(sym)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("q"))))
      .then((q) => { const p = pos(q?.price); if (!dead && p) setLive({ price: p, at: Date.now() }); })
      .catch(() => { });
    return () => { dead = true; };
  }, [s.ticker, s.market, s.currency]);

  const price = live.price ?? pos(s.price);
  const priceIsLive = live.price != null;
  const entry = pos(s.entry);
  const stop = pos(s.stopLoss);
  const t1 = pos(s.target1);
  const t3 = pos(s.target3);

  const genAt = useMemo(() => {
    const t = s.generatedAt ? new Date(s.generatedAt).getTime() : NaN;
    return isFinite(t) ? t : null;
  }, [s.generatedAt]);

  const drift = entry != null && price != null ? ((price - entry) / entry) * 100 : null;

  const conditions = useMemo(() => {
    const m = a.fundamental?.metrics || {};
    return CONDITIONS.map((c) => {
      const rating = m[RATING_KEYS[c.key]] || null;
      return { ...c, rating, verdict: verdictOf(m[c.key], rating), raw: m[c.key] };
    }).filter((c) => c.raw != null || c.rating);
  }, [a.fundamental]);

  const supporting = conditions.filter((c) => c.verdict === "Positive");
  const headwinds = conditions.filter((c) => c.verdict === "Negative");
  const insufficient = conditions.filter((c) => c.verdict === "Insufficient data");

  const macro = a.macro;
  const macroFactors = useMemo(() => {
    const out: { label: string; detail: string; verdict: Verdict }[] = [];
    if (!macro?.conditions) return out;
    for (const [k, c] of Object.entries<any>(macro.conditions)) {
      out.push({
        label: MACRO_LABELS[k] || k,
        detail: c?.detail || "—",
        verdict: verdictOf(c?.signal, c?.detail),
      });
    }
    return out;
  }, [macro]);
  const macroPos = macroFactors.filter((f) => f.verdict === "Positive").length;
  const macroNeg = macroFactors.filter((f) => f.verdict === "Negative").length;

  const ti: any = a.technical?.indicators || {};
  const has = (v: any) => v != null && v !== "N/A" && v !== "No Data" && v !== "Insufficient Data";
  const technicals = [
    { label: "Trend", reading: has(ti.trendSignal) ? String(ti.trendSignal) : null, read: has(ti.smaFast) && has(ti.smaSlow) ? `SMA ${ti.smaFast} vs ${ti.smaSlow}` : null },
    { label: "MACD", reading: has(ti.macdSignal) ? String(ti.macdSignal) : null, read: has(ti.macd) ? String(ti.macd) : null },
    { label: "Momentum", reading: has(ti.momentum) ? String(ti.momentum) : null, read: null },
    { label: "RSI", reading: has(ti.rsi) ? String(ti.rsi) : null, read: has(ti.rsiSignal) ? String(ti.rsiSignal) : null },
    { label: "Bollinger", reading: has(ti.bbSignal) ? String(ti.bbSignal) : null, read: null },
    { label: "Volume", reading: has(ti.volumeSignal) ? String(ti.volumeSignal) : null, read: has(ti.volume) ? String(ti.volume) : null },
  ].filter((t): t is { label: string; reading: string; read: string | null } => t.reading != null);

  const lead =
    s.signal === "Buy" || s.signal === "Strong Buy" ? "positive"
      : s.signal === "Sell" || s.signal === "Strong Sell" ? "negative" : "neutral";

  const thesis = useMemo(() => {
    const p = supporting.map((c) => c.name.toLowerCase());
    const n = headwinds.map((c) => c.name.toLowerCase());
    const out: string[] = [];
    out.push(
      `StocksIntels currently identifies a ${lead} ${String(s.type || "short-term").toLowerCase()} position` +
      (p.length ? `, supported by ${listOf(p)}` : "") + "."
    );
    if (s.timeframe) out.push(`The position is designed for an estimated ${String(s.timeframe).replace("~", "")} holding period.`);
    if (n.length) out.push(`The main identified headwind${n.length > 1 ? "s are" : " is"} ${listOf(n)}.`);
    const rv = num(ti.rsi);
    if (rv != null && rv > 70) out.push(`RSI at ${ti.rsi} indicates the stock may be extended in the short term.`);
    return out.join(" ");
  }, [lead, supporting, headwinds, s.type, s.timeframe, ti.rsi]);

  const overallAssessment = useMemo(() => {
    const ranked = DIMS
      .map((d) => ({ ...d, score: num(a[d.key]?.score) }))
      .filter((d) => d.score != null)
      .sort((x, y) => (y.score as number) - (x.score as number));
    if (!ranked.length) return "No dimension scores were available for this stock, so no assessment can be made.";
    const top = ranked.slice(0, 3).map((d) => d.label.toLowerCase());
    const weak = ranked.filter((d) => (d.score as number) < 50).map((d) => d.label.toLowerCase());
    let t = `Supported primarily by ${listOf(top)}.`;
    if (weak.length) t += ` Weakest dimension${weak.length > 1 ? "s" : ""}: ${listOf(weak)}.`;
    if (macro) t += ` Macro is ${strength(num(macro.score)).toLowerCase()} for this position.`;
    return t;
  }, [a, macro]);

  const whatCouldChange = useMemo(() => {
    const out: string[] = [];
    if (stop != null) out.push(`Price falls below the model's downside level of ${cur}${stop.toFixed(2)}.`);
    const rv = num(ti.rsi);
    if (rv != null && rv > 70) out.push("Short-term volatility increases while RSI remains above 70.");
    else if (ti.trendSignal && /bear/i.test(String(ti.trendSignal))) out.push(`Technical momentum deteriorates further from the current ${ti.trendSignal} reading.`);
    else out.push("Technical momentum deteriorates materially from current readings.");
    if (supporting.some((c) => /revenue/i.test(c.name))) out.push("Revenue growth slows relative to the current run rate.");
    if (supporting.some((c) => /cash flow/i.test(c.name))) out.push("Free cash flow generation weakens.");
    const ins = s.insider;
    if (ins?.hasActivity) {
      const net = num(ins.netShares);
      out.push(`Insider activity reverses from the current ${net != null && net > 0 ? "net buying" : "net selling"}.`);
    }
    for (const m of macroFactors.filter((f) => f.verdict === "Negative")) {
      out.push(`Macro conditions worsen: ${m.label.toLowerCase()} (currently ${m.detail}).`);
    }
    return out;
  }, [stop, ti, supporting, s.insider, macroFactors, cur]);

  const riskLevel = a.overall?.score != null ? (num(a.overall.score)! >= 70 ? "Moderate" : "Elevated") : "Not assessed";
  const rr = num(s.riskReward);

  return (
    <div className="space-y-4">
      {/* 1. the five questions, answered immediately */}
      <div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">{s.ticker}</h1>
              {s.name && s.name !== s.ticker && (
                <span className="truncate text-sm text-muted-foreground">{s.name}</span>
              )}
              {s.sector && <Badge variant="outline" className="text-[10px]">{s.sector}</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2.5 py-1 text-sm font-bold ${lead === "positive" ? "bg-emerald-600 text-white" : lead === "negative" ? "bg-red-600 text-white" : "bg-muted text-foreground"}`}>
                {s.signal || "—"}
              </span>
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{s.confidence ?? "—"}%</span> confidence
              </span>
              {s.type && <span className="text-sm text-muted-foreground">· {s.type}</span>}
            </div>
          </div>
          {a.overall?.score != null && (
            <div className="shrink-0 rounded-xl border border-border bg-muted/30 px-3 py-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Position score</div>
              <div className={`text-lg font-extrabold tabular-nums ${scoreInk(a.overall.score)}`}>
                {a.overall.score}
                <span className="text-xs text-muted-foreground">/100</span>
                {a.overall.grade && <span className="ml-1 text-sm">{a.overall.grade}</span>}
              </div>
            </div>
          )}
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-foreground">{thesis}</p>
      </div>

      {/* 2. live market price separated from the analysis timestamp */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Market price
            {priceIsLive
              ? <span className="inline-flex items-center gap-1 normal-case text-emerald-600"><Radio className="size-3" />live · {clock(live.at)}</span>
              : <span className="normal-case">last refresh</span>}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums text-foreground">{money(price)}</span>
            {num(s.change) != null && (
              <span className={`text-xs font-semibold ${(s.change as number) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {pct(s.change, 2)}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holding period</div>
          <div className="mt-0.5 text-lg font-bold text-foreground">{s.timeframe || "—"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Position analysis</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {genAt ? new Date(genAt).toLocaleDateString() : "Time not recorded"}
          </div>
          {genAt && <div className="text-[10.5px] text-muted-foreground">generated {clock(genAt)}</div>}
        </div>
      </div>

      {/* 3. position levels, always relative to the live price */}
      <Section title="Position Levels" sub="the model's levels for this position">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">Level</th>
                <th className="py-1.5 pr-3 text-right font-medium text-muted-foreground">Price</th>
                <th className="py-1.5 text-right font-medium text-muted-foreground">From current price</th>
              </tr>
            </thead>
            <tbody>
              {entry != null && (
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3 text-foreground">Original analysis price</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">{money(entry)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{pct(drift)}</td>
                </tr>
              )}
              {stop != null && (
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3">
                    <span className="text-foreground">Stop</span>
                    <span className="ml-1.5 text-[10.5px] text-muted-foreground">model downside level</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-red-700">{money(stop)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {price != null ? pct(((stop - price) / price) * 100) : "—"}
                  </td>
                </tr>
              )}
              {t1 != null && (
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3">
                    <span className="text-foreground">Target 1</span>
                    <span className="ml-1.5 text-[10.5px] text-muted-foreground">first upside objective</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-emerald-700">{money(t1)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {price != null ? pct(((t1 - price) / price) * 100) : "—"}
                  </td>
                </tr>
              )}
              {t3 != null && (
                <tr>
                  <td className="py-1.5 pr-3">
                    <span className="text-foreground">Ultimate target</span>
                    <span className="ml-1.5 text-[10.5px] text-muted-foreground">longer upside objective</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-emerald-700">{money(t3)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {price != null ? pct(((t3 - price) / price) * 100) : "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {drift != null && Math.abs(drift) >= 3 ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-2 text-[11px] leading-relaxed text-amber-900">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              <b>Position status:</b> the price is currently {Math.abs(drift).toFixed(1)}% {drift! > 0 ? "above" : "below"} the
              price at which this position was analysed and generated
              {genAt ? ` on ${new Date(genAt).toLocaleDateString()}` : ""}. The levels above were calculated using the
              market conditions at that time and have not been recalculated.
            </span>
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {rr != null
              ? `Risk-to-reward: ${rr.toFixed(1)}:1 at the original position price.`
              : "Risk-to-reward not published for this position."}
          </p>
        )}
      </Section>

      {/* 4. rationale, with insufficient data separated from neutral */}
      <Section title="Position Rationale" sub="why the model takes this view">
        <div className="space-y-2.5">
          {/* Structured factor rows. The metric name appeared twice before -
              once as a label and again inside the rating text
              ("EV/EBITDA" / "EV/EBITDA 5.3 below industry median 12"). */}
          {([["Supporting factors", supporting, "Positive"],
             ["Working against", headwinds, "Negative"]] as const).map(([title, items, tone]) => (
            <div key={title}>
              <p className={`mb-1 text-[11px] font-semibold ${tone === "Positive" ? "text-emerald-700" : "text-red-700"}`}>
                {title}
              </p>
              {items.length ? (
                <ul className="space-y-0.5">
                  {items.map((c) => (
                    <li key={c.name} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="text-muted-foreground">{c.rating || ""}</span>
                      <span className={tone === "Positive" ? "text-emerald-600" : "text-red-600"}>· {tone}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-muted-foreground">No factor met the model's {tone.toLowerCase()} threshold.</p>
              )}
            </div>
          ))}
          {insufficient.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-slate-600">Not included in the assessment</p>
              <ul className="space-y-0.5">
                {insufficient.map((c) => (
                  <li key={c.name} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-muted-foreground">{c.rating || "No data"}</span>
                    <span className="text-slate-500">· Insufficient data</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                Excluded rather than scored neutral — missing data is not a balanced view.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* 5. score breakdown plus what it means for this position */}
      <Section title="Intelligence Breakdown" sub="how each dimension scored">
        <div className="space-y-1">
          {DIMS.map((d) => {
            const sc = num(a[d.key]?.score);
            const gr = a[d.key]?.grade;
            const real = sc != null && isFinite(sc) && !!gr;
            return (
              <div key={d.key} className="flex items-center justify-between gap-3 border-b border-border/40 py-1 last:border-0">
                <span className="text-[11.5px] text-foreground">{d.label}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-[11.5px] font-semibold ${scoreInk(sc)}`}>{real ? sc : "—"}</span>
                  {real && <span className="w-6 text-[11px] text-muted-foreground">{gr}</span>}
                  <span className="w-24 text-right text-[11px] text-muted-foreground">{strength(sc)}</span>
                </span>
              </div>
            );
          })}
          {a.overall?.score != null && (
            <div className="flex items-center justify-between gap-3 border-t-2 border-border pt-1.5">
              <span className="text-[12px] font-semibold text-foreground">Overall</span>
              <span className="flex items-center gap-2">
                <span className={`text-[12px] font-bold ${scoreInk(a.overall.score)}`}>{a.overall.score}</span>
                <span className="w-6 text-[11px] text-muted-foreground">{a.overall.grade}</span>
                <span className="w-24 text-right text-[11px] text-muted-foreground">{strength(num(a.overall.score))}</span>
              </span>
            </div>
          )}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">{overallAssessment}</p>
      </Section>

      {/* 6. technicals */}
      {technicals.length > 0 && (
        <Section
          title="Technical Picture"
          sub={s.timeframe ? `relevant to a ${String(s.timeframe).replace("~", "")} hold` : undefined}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">Indicator</th>
                  <th className="py-1.5 pr-3 text-right font-medium text-muted-foreground">Reading</th>
                  <th className="py-1.5 text-right font-medium text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody>
                {technicals.map((t) => (
                  <tr key={t.label} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-3 text-foreground">{t.label}</td>
                    <td className="py-1.5 pr-3 text-right font-medium text-foreground">{t.reading}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{t.read || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {technicalSummary(technicals, ti.rsiSignal) && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
              Technical interpretation: {technicalSummary(technicals, ti.rsiSignal)}
            </p>
          )}
        </Section>
      )}

      {/* 7. news and sentiment */}
      {(() => {
        const ns = s.newsSummary;
        const news = Array.isArray(s.news) ? s.news : [];
        const net = String(ns?.net || "").toLowerCase();
        const tone = net === "positive" ? "Positive" : net === "negative" ? "Negative" : "Neutral";
        const judgement = news.length < 3;
        if (!ns && news.length === 0) return null;
        return (
          <Section
            title="News & Sentiment"
            sub={`${ns ? ns.count : news.length} tracked stor${(ns ? ns.count : news.length) === 1 ? "y" : "ies"}`}
            right={
              <Badge className={`text-[10px] ${judgement ? VERDICT_STYLE["Insufficient data"] : VERDICT_STYLE[tone as Verdict]}`}>
                {judgement ? "Insufficient data" : tone}
              </Badge>
            }
          >
            {ns && (
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
                <span className="text-emerald-600">{ns.positive} positive</span>
                <span className="text-muted-foreground">{ns.neutral} neutral</span>
                <span className="text-red-600">{ns.negative} negative</span>
              </div>
            )}
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {judgement
                ? "Too few tracked stories to read a reliable tone from coverage of this stock."
                : net === "positive"
                  ? "Recent coverage leans positive, with no dominant negative catalyst identified."
                  : net === "negative"
                    ? "Recent coverage leans negative. Treat this as an active risk to the current view."
                    : "Recent coverage is broadly balanced, with no dominant catalyst in either direction."}
            </p>
            {news.length > 0 && (
              <details className="group mt-2">
                <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
                  <span className="inline-flex items-center gap-1">
                    <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                    View the {news.length} tracked {news.length === 1 ? "story" : "stories"}
                  </span>
                </summary>
                <ul className="mt-1.5 space-y-1">
                  {news.slice(0, 6).map((h: any, i: number) => (
                    <li key={i} className="border-b border-border/40 pb-1 text-[11px] leading-relaxed last:border-0">
                      <span className="font-medium text-foreground">{h.headline}</span>
                      <span className="ml-1.5 text-muted-foreground">
                        {h.source}
                        {h.publishedAt ? ` · ${new Date(h.publishedAt).toLocaleDateString()}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Section>
        );
      })()}

      {/* 8. macro: verdict first, factors on demand */}
      {macro && (
        <Section
          title="Macro Environment"
          sub={macro.country ? `${macro.country} · ${macro.score}/100` : undefined}
          right={
            <Badge className={`text-[10px] ${macroBadge(macro, macroFactors).tone}`}>
              {macroBadge(macro, macroFactors).label}
            </Badge>
          }
        >
          <p className="mb-2 text-[11.5px] leading-relaxed text-foreground">{macroSummary(macro, macroFactors)}</p>
          {macroFactors.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
                <span className="inline-flex items-center gap-1">
                  <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  View the {macroFactors.length} macro factors
                </span>
              </summary>
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">Factor</th>
                      <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">Reading</th>
                      <th className="py-1.5 text-right font-medium text-muted-foreground">Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macroFactors.map((f, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 pr-3 text-foreground">{f.label}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{f.detail}</td>
                        <td className="py-1.5 text-right">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${VERDICT_STYLE[f.verdict]}`}>{f.verdict}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Section>
      )}

      {/* 8. risk and sizing, with ML removed from the investor-facing copy */}
      <Section title="Risk & Position Sizing">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-muted/25 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk level</div>
            <div className="mt-0.5 text-sm font-bold text-foreground">{riskLevel}</div>
          </div>
          {s.positionSize && (
            <div className="rounded-lg border border-border bg-muted/25 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Model allocation</div>
              <div className="mt-0.5 text-sm font-bold text-foreground">{s.positionSize}</div>
            </div>
          )}
          {rr != null && (
            <div className="rounded-lg border border-border bg-muted/25 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk-to-reward</div>
              <div className="mt-0.5 text-sm font-bold text-foreground">{rr.toFixed(1)}:1</div>
            </div>
          )}
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
          Model allocation is derived from the position's estimated risk and conviction. It is not a
          recommendation of how much any individual should invest.
        </p>
      </Section>

      {/* 9. what would invalidate the view */}
      <Section title="What Could Change This Position?" sub="conditions that would weaken the current view">
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] leading-relaxed text-muted-foreground">
          {whatCouldChange.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      </Section>

      {/* 10. methodology, with real content instead of empty bullets */}
      <details className="group border-t border-border/70 pt-3">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
          <span className="inline-flex items-center gap-1">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            Model methodology
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            This position was assessed across fundamental performance, valuation, financial
            health, technical momentum, insider activity, news sentiment and macroeconomic
            conditions. Each dimension is scored 0-100 and combined into the overall position
            score, then mapped to a rating.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <Row l="Market" r={s.market || "—"} />
            <Row l="Sector" r={s.sector || "—"} />
            <Row l="Position type" r={s.type || "—"} />
            <Row l="Holding period" r={s.timeframe || "—"} />
            <Row l="Regime" r={s.regime || "—"} />
            <Row l="Data source" r={s.dataSource || "—"} />
            <Row l="Position generated" r={genAt ? new Date(genAt).toLocaleString() : "—"} />
            <Row l="Speculative flag" r={s.speculative ? "Yes - score capped" : "No"} />
          </div>
          {s.reason && (
            <div>
              <p className="mt-1 font-medium text-foreground">Model reasoning</p>
              <p className="whitespace-pre-line">{s.reason}</p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Macro badge.
 *
 * Previously this counted supportive vs adverse factors and labelled the result
 * "Supportive" while the summary sentence directly beneath it read "neutral",
 * because the two used different sources of truth. The engine's own `macro.signal`
 * is the verdict the rest of the product uses, so the badge follows it; the
 * factor counts are used only as a tiebreak when the engine has no signal.
 */
function macroBadge(macro: any, factors: { verdict: Verdict }[]): { label: string; tone: string } {
  const engine = String(macro?.signal || "").toLowerCase();
  if (/bull|support|positive/.test(engine)) return { label: "Supportive", tone: VERDICT_STYLE.Positive };
  if (/bear|headwind|negative|caution/.test(engine)) return { label: "Headwind", tone: VERDICT_STYLE.Negative };
  if (engine) return { label: "Neutral", tone: VERDICT_STYLE.Neutral };
  const p = factors.filter((f) => f.verdict === "Positive").length;
  const n = factors.filter((f) => f.verdict === "Negative").length;
  if (p > n) return { label: "Supportive", tone: VERDICT_STYLE.Positive };
  if (n > p) return { label: "Headwind", tone: VERDICT_STYLE.Negative };
  return { label: "Neutral", tone: VERDICT_STYLE.Neutral };
}

function technicalSummary(rows: { label: string; reading: string; read: string | null }[], rsiSignal?: any): string {
  const rsi = rows.find((x) => x.label === "RSI");
  const trend = rows.find((x) => x.label === "Trend");
  const macd = rows.find((x) => x.label === "MACD");
  const bits: string[] = [];
  if (trend?.reading) bits.push(`the broader trend is ${String(trend.reading).toLowerCase()}`);
  // Prefer the engine's own RSI interpretation. Hardcoded thresholds said
  // "neutral range" for an RSI the engine had already labelled "Approaching
  // Oversold", which contradicted the Technical Picture table right above it.
  const rs = String(rsiSignal || rsi?.read || "").toLowerCase();
  if (rs) bits.push(`RSI is ${rs}`);
  else if (rsi?.reading) bits.push("with RSI in a neutral range");
  const macdRead = String(macd?.reading || "").toLowerCase();
  if (macdRead === "bullish" && /down|bear/.test(String(trend?.reading || "").toLowerCase())) {
    bits.push("although the MACD is turning bullish, which can precede stabilisation");
  }
  return bits.length ? `${cap(bits.join(", "))}.` : "";
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function macroSummary(macro: any, factors: { label: string; verdict: Verdict }[]): string {
  const p = factors.filter((f) => f.verdict === "Positive").map((f) => f.label);
  const n = factors.filter((f) => f.verdict === "Negative").map((f) => f.label);
  const neu = factors.filter((f) => f.verdict === "Neutral").length;
  const where = macro?.country ? `The ${macro.country} ` : "The ";
  const stance = macro?.signal ? String(macro.signal).toLowerCase() : "mixed";
  let t = `${where}macro environment is ${stance} for this position (${macro?.score}/100). `;
  // "X and Y supportive" was missing its verb.
  const bits: string[] = [];
  if (p.length) bits.push(`${listOf(p)} ${p.length === 1 ? "is" : "are"} supportive`);
  if (n.length) bits.push(`${listOf(n)} ${n.length === 1 ? "is" : "are"} a headwind`);
  if (neu) bits.push(`${neu} factor${neu === 1 ? " is" : "s are"} neutral`);
  if (bits.length) t += `${cap(bits.join(", "))}.`;
  return t;
}
