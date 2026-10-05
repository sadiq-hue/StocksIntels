import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { AlertTriangle, ChevronDown, Radio, ExternalLink } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const num = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) ? x : null;
};
const pos = (v: any): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** A rating that means "the data was unavailable", not "balanced". */
const NO_DATA = /no\s+(data|analyst|roe)|not available|insufficient|n\/a/i;
type Verdict = "Positive" | "Negative" | "Neutral" | "Insufficient data";
function verdictOf(sig: any, rating: any): Verdict {
  const s = String(sig || "").toUpperCase(), r = String(rating || "");
  if (NO_DATA.test(r)) return "Insufficient data";
  if (!s || s === "NEUTRAL") return "Neutral";
  if (s === "BUY" || s === "STRONG BUY") return "Positive";
  if (s === "SELL" || s === "SUPPRESS") return "Negative";
  return "Neutral";
}

/** Per-category wording for a verdict, so the same signal reads consistently. */
const ASSESS: Record<string, { Positive: string; Negative: string }> = {
  Valuation: { Positive: "Attractive", Negative: "Expensive" },
  Growth: { Positive: "Strong", Negative: "Weak" },
  "Balance Sheet": { Positive: "Very strong", Negative: "Stretched" },
  default: { Positive: "Positive", Negative: "Negative" },
};

const CONDITIONS = [
  { key: "evSignal", name: "EV/EBITDA", cat: "Valuation", cmp: "industry" },
  { key: "peSignal", name: "P/E vs Sector", cat: "Valuation", cmp: "sector" },
  { key: "pbSignal", name: "Price/Book", cat: "Valuation", cmp: "median" },
  { key: "divSignal", name: "Dividend Yield", cat: "Valuation" },
  { key: "revSignal", name: "Revenue Growth", cat: "Growth", cmp: "threshold" },
  { key: "epsSignal", name: "Earnings Surprise", cat: "Growth", cmp: "threshold" },
  { key: "mgnSignal", name: "Margin Trend", cat: "Growth" },
  { key: "fcfSignal", name: "Free Cash Flow Yield", cat: "Growth", cmp: "threshold" },
  { key: "deSignal", name: "Debt/Equity", cat: "Balance Sheet" },
  { key: "crSignal", name: "Current Ratio", cat: "Balance Sheet", cmp: "threshold" },
  { key: "roeSignal", name: "Return on Equity", cat: "Balance Sheet" },
  { key: "altSignal", name: "Altman Z-Score", cat: "Balance Sheet", cmp: "threshold" },
];
const RATING_KEYS: Record<string, string> = {
  peSignal: "peRating", evSignal: "evRating", pbSignal: "pbRating", divSignal: "divRating",
  revSignal: "revRating", epsSignal: "epsRating", mgnSignal: "mgnRating", fcfSignal: "fcfRating",
  deSignal: "debtRating", crSignal: "crRating", roeSignal: "roeRating", altSignal: "altRating",
};
const MACRO_LABELS: Record<string, string> = {
  pmi: "Manufacturing Activity", gdp: "GDP Growth", gdpGrowth: "GDP Growth",
  inflation: "Inflation", creditRating: "Credit Rating", politicalRisk: "Political Risk",
  currentAccount: "Current-account conditions", interestRateDifferential: "Interest Rates vs Fed",
};

function strength(v: any): string {
  const s = num(v);
  if (s == null) return "Not scored";
  if (s >= 75) return "Very strong";
  if (s >= 65) return "Strong";
  if (s >= 55) return "Moderate";
  if (s >= 45) return "Mixed";
  return "Weak";
}
const scoreInk = (v: any) =>
  num(v) == null ? "text-muted-foreground/50"
    : num(v)! >= 65 ? "text-emerald-700" : num(v)! >= 50 ? "text-amber-700" : "text-red-600";

/** Every number in a rating string, in order, e.g. "D/E 0.38 < 0.5" -> [0.38, 0.5]. */
function nums(s: any): number[] {
  if (!s) return [];
  return (String(s).match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => isFinite(n));
}

/** Human sentence for the headline Investment View. */
function investmentView(s: any, support: string[], adverse: string[], rsiRead: string, trend: string): string {
  const lead = /buy/i.test(String(s.signal || "")) ? "positive" : /sell/i.test(String(s.signal || "")) ? "negative" : "neutral";
  const clauses: string[] = [];
  if (support.length) clauses.push(`supported by ${list(support)}`);
  if (adverse.length) clauses.push(`weighed against by ${list(adverse)}`);
  let t = `A ${lead} position ${clauses.join(", ")}.`;
  const bits: string[] = [];
  if (trend) bits.push(`the stock is in a ${String(trend).toLowerCase()}`);
  if (rsiRead) bits.push(rsiRead.toLowerCase().includes("oversold") ? "approaching oversold territory" : `RSI ${rsiRead.toLowerCase()}`);
  if (bits.length) t += ` Technical conditions remain mixed, with ${list(bits)}.`;
  return t;
}

function list(xs: string[]): string {
  if (!xs.length) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Block({ title, band, children, right }: { title: string; band?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-foreground">{title}</h3>
        {band && <span className="text-[11.5px] font-medium text-muted-foreground">{band}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/** Label / value / assessment row. */
function Fact({ label, value, assess }: { label: string; value: ReactNode; assess?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px] text-[12px]">
      <span className="w-[46%] shrink-0 text-muted-foreground">{label}</span>
      <span className="w-[26%] shrink-0 font-mono tabular-nums text-foreground">{value}</span>
      <span className="min-w-0 flex-1 text-right">{assess}</span>
    </div>
  );
}
const Tone = ({ children, v }: { children: ReactNode; v: Verdict }) => (
  <span className={
    v === "Positive" ? "text-emerald-600" : v === "Negative" ? "text-red-600"
      : v === "Insufficient data" ? "text-slate-500 italic" : "text-muted-foreground"
  }>{children}</span>
);

/**
 * Market Intelligence card, laid out as a position brief: verdict, then the
 * evidence behind it, then the levels and the conditions that would change it.
 *
 * Two accuracy rules are load-bearing here:
 *  - a dimension score is only shown when it carries a grade. The engine emits
 *    placeholder scores (50, no grade) for signals restored from history rather
 *    than freshly computed, and rendering those would show a confident-looking
 *    number that means nothing.
 *  - market price is fetched live and timestamped separately from the position
 *    analysis, because entry/stop/targets are only valid as of when they were set.
 */
export function MarketIntelligenceCard({ signal }: { signal: any }) {
  const s = signal || {};
  const a = s.analysis || {};
  const cur = s.currency === "KES" ? "KES " : "$";
  const money = (v: any) => {
    const n = pos(v);
    return n == null ? "—" : `${cur}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [live, setLive] = useState<{ price: number | null; at: number }>({ price: null, at: 0 });
  useEffect(() => {
    if (!s.ticker) return;
    // Kenyan listings must be requested as NSE:SYM. A bare "CGEN" resolves to an
    // unrelated US listing on the quote feed (returned 2.31 against a true
    // KES 285), and "SCOM" 404s - so the drift would be computed against the
    // wrong instrument entirely.
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
  const entry = pos(s.entry), stop = pos(s.stopLoss), t1 = pos(s.target1), t3 = pos(s.target3);

  const genAt = useMemo(() => {
    const t = s.generatedAt ? new Date(s.generatedAt).getTime() : NaN;
    return isFinite(t) ? t : null;
  }, [s.generatedAt]);
  const drift = entry != null && price != null ? ((price - entry) / entry) * 100 : null;

  const scored = (k: string) => {
    const d = a[k];
    return d && num(d.score) != null && d.grade ? d : null;
  };
  const fund = scored("fundamental"), tech = scored("technical");
  const fin = scored("financial"), macro = scored("macro"), ins = scored("insider");
  const overall = scored("overall");

  const groups = useMemo(() => {
    const m = a.fundamental?.metrics || {};
    const byCat: Record<string, any[]> = { Valuation: [], Growth: [], "Balance Sheet": [] };
    for (const c of CONDITIONS) {
      const rating = m[RATING_KEYS[c.key]];
      const raw = m[c.key];
      if (raw == null && rating == null) continue;
      byCat[c.cat].push({ ...c, rating, verdict: verdictOf(raw, rating) });
    }
    return byCat;
  }, [a.fundamental]);

  const allFactors = useMemo(
    () => [...groups.Valuation, ...groups.Growth, ...groups["Balance Sheet"]],
    [groups]
  );
  const support = allFactors.filter((f) => f.verdict === "Positive").map((f) => f.name.toLowerCase());
  const adverse = allFactors.filter((f) => f.verdict === "Negative").map((f) => f.name.toLowerCase());

  const ti: any = a.technical?.indicators || {};
  const has = (v: any) => v != null && v !== "N/A" && v !== "No Data" && v !== "Insufficient Data";
  const technicals = [
    { label: "Trend", reading: has(ti.trendSignal) ? String(ti.trendSignal) : null, read: has(ti.smaFast) && has(ti.smaSlow) ? `SMA ${ti.smaFast} vs ${ti.smaSlow}` : null },
    { label: "MACD", reading: has(ti.macdSignal) ? String(ti.macdSignal) : null, read: has(ti.macd) ? String(ti.macd) : null },
    { label: "RSI", reading: has(ti.rsi) ? String(ti.rsi) : null, read: has(ti.rsiSignal) ? String(ti.rsiSignal) : null },
    { label: "Momentum", reading: has(ti.momentum) ? String(ti.momentum) : null, read: null },
    { label: "Bollinger", reading: has(ti.bbSignal) ? String(ti.bbSignal) : null, read: null },
    { label: "Volume", reading: has(ti.volumeSignal) ? String(ti.volumeSignal) : null, read: has(ti.volume) ? String(ti.volume) : null },
  ].filter((t): t is { label: string; reading: string; read: string | null } => t.reading != null);

  const rsiRead = has(ti.rsiSignal) ? String(ti.rsiSignal) : "";
  const trendRead = has(ti.trendSignal) ? String(ti.trendSignal) : "";
  const techInterpretation = useMemo(() => {
    const bits: string[] = [];
    if (trendRead) bits.push(`broader trend remains ${trendRead.toLowerCase()}`);
    const bullMacd = /bull/i.test(String(ti.macdSignal || ""));
    const over = /over/i.test(rsiRead), under = /under/i.test(rsiRead);
    if (bullMacd && under) bits.push("but bullish MACD and approaching-oversold RSI suggest possible stabilisation");
    else if (bullMacd) bits.push("with a bullish MACD divergence worth watching");
    else if (over) bits.push("though the RSI indicates the stock may be extended in the short term");
    return bits.length ? `${cap(bits.join(", "))}.` : "";
  }, [trendRead, rsiRead, ti.macdSignal]);

  const ns = s.newsSummary;
  const news = Array.isArray(s.news) ? s.news : [];
  const newsCount = ns ? ns.count : news.length;
  const net = String(ns?.net || "").toLowerCase();
  const newsBand: Verdict = newsCount < 3 ? "Insufficient data" : net === "positive" ? "Positive" : net === "negative" ? "Negative" : "Neutral";

  const macroFactors = useMemo(() => {
    const out: { label: string; detail: string; verdict: Verdict }[] = [];
    for (const [k, c] of Object.entries<any>(a.macro?.conditions || {})) {
      out.push({ label: MACRO_LABELS[k] || k, detail: c?.detail || "—", verdict: verdictOf(c?.signal, c?.detail) });
    }
    return out;
  }, [a.macro]);
  const mSup = macroFactors.filter((f) => f.verdict === "Positive").map((f) => f.label);
  const mHead = macroFactors.filter((f) => f.verdict === "Negative").map((f) => f.label);
  const macroStance = String(a.macro?.signal || "").toLowerCase();
  const macroBand: Verdict = /bull|support|positive/.test(macroStance) ? "Positive"
    : /bear|headwind|negative|caution/.test(macroStance) ? "Negative" : "Neutral";

  const insd = s.insider;
  const rr = num(s.riskReward);
  const riskLevel = overall ? (num(overall.score)! >= 70 ? "Moderate" : "Elevated") : "Not assessed";

  const whatCouldChange = useMemo(() => {
    const out: string[] = [];
    if (stop != null) out.push(`Price moves below ${money(stop)}`);
    out.push("Technical momentum deteriorates materially");
    if (groups.Growth.some((f) => /revenue/i.test(f.name) && f.verdict === "Positive")) out.push("Revenue growth slows significantly");
    if (groups.Growth.some((f) => /cash flow/i.test(f.name) && f.verdict === "Positive")) out.push("Free cash flow generation weakens");
    if (insd?.hasActivity) out.push("Insider activity reverses from its current direction");
    if (mHead.length) out.push("Macro/currency conditions deteriorate");
    return out;
  }, [stop, groups, insd, mHead]);

  return (
    <div className="space-y-5">
      {/* ── header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{s.ticker}</h1>
        {s.name && s.name !== s.ticker && <p className="text-sm text-muted-foreground">{s.name}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
          <span className={`rounded-md px-2.5 py-1 text-[13px] font-bold ${
            /buy/i.test(String(s.signal)) ? "bg-emerald-600 text-white"
              : /sell/i.test(String(s.signal)) ? "bg-red-600 text-white" : "bg-muted text-foreground"}`}>
            {s.signal || "—"}
          </span>
          <span className="text-muted-foreground">· <span className="font-semibold text-foreground">{s.confidence ?? "—"}% Confidence</span></span>
          {s.type && <><span className="text-muted-foreground">·</span><span>{s.type}</span></>}
          {s.sector && <><span className="text-muted-foreground">·</span><span>{s.sector}</span></>}
        </div>
      </div>

      {/* ── three facts ── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Position Score</div>
          {overall ? (
            <div className={`mt-0.5 text-lg font-extrabold tabular-nums ${scoreInk(overall.score)}`}>
              {overall.score}<span className="text-xs text-muted-foreground">/100</span>
              {overall.grade && <span className="ml-1.5 text-sm">{overall.grade}</span>}
            </div>
          ) : <div className="mt-0.5 text-lg font-bold text-muted-foreground/60">—</div>}
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Market Price
            {priceIsLive
              ? <span className="inline-flex items-center gap-1 normal-case text-emerald-600"><Radio className="size-3" />live · {clock(live.at)}</span>
              : <span className="normal-case">last refresh</span>}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-bold tabular-nums text-foreground">{money(price)}</span>
            {num(s.change) != null && (
              <span className={`text-xs font-semibold ${(s.change as number) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {(s.change as number) >= 0 ? "+" : ""}{(s.change as number).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Holding Period</div>
          <div className="mt-0.5 text-lg font-bold text-foreground">{s.timeframe || "—"}</div>
          {genAt && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              position generated {new Date(genAt).toLocaleDateString()} {clock(genAt)}
            </div>
          )}
        </div>
      </div>

      {/* ── investment view ── */}
      <Block title="Investment View">
        <p className="text-[13px] leading-relaxed text-foreground">
          {investmentView(s, support, adverse, rsiRead, trendRead)}
        </p>
      </Block>

      {/* ── fundamentals ── */}
      <Block
        title="Fundamentals"
        band={fund ? <>{strength(fund.score)} · {fund.score}/100</> : "not scored"}
      >
        {(["Valuation", "Growth", "Balance Sheet"] as const).map((cat) => {
          const items = groups[cat];
          if (!items.length) return null;
          const words = ASSESS[cat] || ASSESS.default;
          return (
            <div key={cat} className="mb-2.5 last:mb-0">
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</p>
              {items.map((f) => {
                const v = nums(f.rating);
                const cmpVal = f.cmp && v.length > 1 ? v[1] : null;
                return (
                  <Fact
                    key={f.name}
                    label={f.name}
                    value={
                      f.verdict === "Insufficient data"
                        ? "n/a"
                        : v.length ? (f.name.toLowerCase().includes("yield") || /growth|margin/i.test(f.name) ? `${v[0]}%` : f.name === "EV/EBITDA" || /P\/E|Price\/Book/i.test(f.name) ? `${v[0]}x` : String(v[0])) : "—"
                    }
                    assess={<Tone v={f.verdict}>{f.verdict === "Insufficient data" ? "Insufficient data" : f.verdict === "Positive" ? words.Positive : f.verdict === "Negative" ? words.Negative : "Neutral"}</Tone>}
                  />
                );
              })}
              {items.some((f) => f.cmp && nums(f.rating).length > 1) && (
                <div className="mt-0.5 border-t border-border/40 pt-1">
                  {items.filter((f) => f.cmp && nums(f.rating).length > 1).map((f) => (
                    <Fact key={f.name + "_c"} label={labelForCmp(f.cmp!)} value={`${nums(f.rating)[1]}x`} assess="" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <details className="group mt-2.5">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
            <span className="inline-flex items-center gap-1">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              View full fundamental analysis ({allFactors.length} factors)
            </span>
          </summary>
          <div className="mt-2 space-y-0.5">
            {allFactors.map((f) => (
              <div key={f.name} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 text-[11.5px] last:border-0">
                <span className="font-medium text-foreground">{f.name}</span>
                <span className="text-muted-foreground">{f.rating || "—"}</span>
                <span className="shrink-0"><Tone v={f.verdict}>{f.verdict}</Tone></span>
              </div>
            ))}
          </div>
        </details>
      </Block>

      {/* ── technicals ── */}
      <Block
        title="Technical Picture"
        band={tech ? <>{strength(tech.score)} · {tech.score}/100</> : "not scored"}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {technicals.map((t) => (
                <tr key={t.label} className="border-b border-border/30 last:border-0">
                  <td className="w-[38%] py-1 pr-3 text-muted-foreground">{t.label}</td>
                  <td className="w-[34%] py-1 pr-3 font-medium text-foreground">{t.reading}</td>
                  <td className="py-1 text-right text-muted-foreground">{t.read || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {techInterpretation && (
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Technical interpretation:</span> {techInterpretation}
          </p>
        )}
      </Block>

      {/* ── news ── */}
      {newsCount > 0 && (
        <Block
          title="News & Sentiment"
          band={newsBand === "Insufficient data" ? "insufficient data" : newsBand}
          right={ns && newsCount >= 3 ? (
            <span className="text-[11.5px] text-muted-foreground">
              <span className="text-emerald-600">{ns.positive} positive</span> ·{" "}
              <span>{ns.neutral} neutral</span> ·{" "}
              <span className="text-red-600">{ns.negative} negative</span>
            </span>
          ) : undefined}
        >
          <div className="space-y-0.5 text-[12px]">
            <div className="flex items-baseline gap-3">
              <span className="w-[46%] text-muted-foreground">Recent News</span>
              <span className="text-foreground">{newsCount} tracked</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="w-[46%] text-muted-foreground">News Sentiment</span>
              <span><Tone v={newsBand}>{newsBand === "Insufficient data" ? "Not enough coverage" : newsBand}</Tone></span>
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Market narrative:</span>{" "}
            {newsBand === "Insufficient data"
              ? "Too few tracked stories to read a reliable tone from coverage of this stock."
              : net === "positive"
                ? "Recent coverage leans positive, with no dominant negative catalyst identified."
                : net === "negative"
                  ? "Recent coverage leans negative. Treat this as an active risk to the current view."
                  : "Recent coverage is broadly neutral, with no major negative catalyst identified."}
          </p>
          {news.length > 0 && (
            <details className="group mt-2">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
                <span className="inline-flex items-center gap-1">
                  <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  View recent news ({news.length})
                </span>
              </summary>
              <ul className="mt-1.5 space-y-1">
                {news.slice(0, 6).map((h: any, i: number) => (
                  <li key={i} className="border-b border-border/40 pb-1 text-[11px] leading-relaxed last:border-0">
                    <span className="font-medium text-foreground">{h.headline}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {h.source}{h.publishedAt ? ` · ${new Date(h.publishedAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Block>
      )}

      {/* ── insider ── */}
      {insd && (insd.hasActivity || (num(insd.score) != null && num(insd.score)! >= 50)) && (
        <Block
          title="Insider Activity"
          band={ins ? <>{strength(ins.score)} · {ins.score}/100</> : "not scored"}
        >
          <div className="space-y-0.5 text-[12px]">
            <Fact label="Buys" value={insd.buyCount ?? "—"} assess="" />
            <Fact label="Sells" value={insd.sellCount ?? "—"} assess="" />
            <Fact
              label="Net Activity"
              value={num(insd.netShares) != null ? `${num(insd.netShares)! > 0 ? "+" : ""}${nums(String(insd.netShares))[0]?.toLocaleString()} shares` : "—"}
              assess={<Tone v={num(insd.netShares) != null && num(insd.netShares)! > 0 ? "Positive" : "Negative"}>
                {num(insd.netShares) != null && num(insd.netShares)! > 0 ? "Accumulation" : "Distribution"}
              </Tone>}
            />
          </div>
        </Block>
      )}

      {/* ── macro ── */}
      {a.macro && (
        <Block
          title="Macro"
          band={`${cap(macroStance || "mixed")}${macro ? ` · ${macro.score}/100` : ""}`}
        >
          <div className="space-y-2 text-[12px]">
            {mSup.length > 0 && (
              <div>
                <p className="mb-0.5 font-medium text-emerald-700">Supportive</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {mSup.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
            {mHead.length > 0 && (
              <div>
                <p className="mb-0.5 font-medium text-red-700">Headwinds</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {mHead.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
            {!mSup.length && !mHead.length && (
              <p className="text-muted-foreground">No macro factor is currently flagged in either direction.</p>
            )}
          </div>
          <details className="group mt-2">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
              <span className="inline-flex items-center gap-1">
                <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                View all {macroFactors.length} macro factors
              </span>
            </summary>
            <div className="mt-1.5 overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Factor</th>
                    <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Reading</th>
                    <th className="py-1 text-right font-medium text-muted-foreground">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {macroFactors.map((f, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="py-1 pr-3 text-foreground">{f.label}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{f.detail}</td>
                      <td className="py-1 text-right"><Tone v={f.verdict}>{f.verdict}</Tone></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Block>
      )}

      {/* ── risk & sizing ── */}
      <Block title="Risk & Position Sizing">
        <div className="space-y-0.5 text-[12px]">
          <Fact label="Risk Level" value={<span className="font-sans">{riskLevel}</span>} assess="" />
          <Fact label="Model Allocation" value={<span className="font-sans">{s.positionSize || "—"}</span>} assess="" />
          <Fact label="Risk/Reward" value={rr != null ? `${rr.toFixed(1)} : 1` : "—"} assess="" />
        </div>
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Model output — not personalized investment advice.
        </p>
      </Block>

      {/* ── position levels ── */}
      <Block title="Position Levels">
        <div className="space-y-0.5 text-[12px]">
          <Fact label="Analysis Price" value={money(entry)} assess="" />
          <Fact label="Downside Level" value={money(stop)} assess="" />
          <Fact label="Target 1" value={money(t1)} assess="" />
          <Fact label="Extended Target" value={money(t3)} assess="" />
        </div>
        {drift != null && Math.abs(drift) >= 3 && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-2 text-[11.5px] leading-relaxed text-amber-900">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              Current price is {Math.abs(drift).toFixed(1)}% {drift > 0 ? "above" : "below"} the price used when
              the position was generated{genAt ? ` on ${new Date(genAt).toLocaleDateString()}` : ""}. Levels have not been recalculated.
            </span>
          </p>
        )}
      </Block>

      {/* ── what could change this ── */}
      <Block title="What Could Change This Position?">
        <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
          {whatCouldChange.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      </Block>

      {/* ── methodology ── */}
      <details className="group border-t border-border/70 pt-4">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
          <span className="inline-flex items-center gap-1">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            View methodology
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            This position was assessed across fundamental performance, valuation, financial
            health, technical momentum, insider activity, news sentiment and macroeconomic
            conditions. Each dimension is scored 0-100 and combined into the overall position
            score, then mapped to a rating. Factors with no underlying data are shown as
            insufficient data and excluded from the directional assessment.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <Fact label="Market" value={<span className="font-sans">{s.market || "—"}</span>} assess="" />
            <Fact label="Sector" value={<span className="font-sans">{s.sector || "—"}</span>} assess="" />
            <Fact label="Position Type" value={<span className="font-sans">{s.type || "—"}</span>} assess="" />
            <Fact label="Holding Period" value={<span className="font-sans">{s.timeframe || "—"}</span>} assess="" />
            <Fact label="Regime" value={<span className="font-sans">{s.regime || "—"}</span>} assess="" />
            <Fact label="Data Source" value={<span className="font-sans">{s.dataSource || "—"}</span>} assess="" />
            <Fact label="Position Generated" value={<span className="font-sans">{genAt ? new Date(genAt).toLocaleString() : "—"}</span>} assess="" />
            <Fact label="Speculative Flag" value={<span className="font-sans">{s.speculative ? "Yes — score capped" : "No"}</span>} assess="" />
          </div>
          {s.reason && (
            <div>
              <p className="font-medium text-foreground">Model reasoning</p>
              <p className="whitespace-pre-line">{s.reason}</p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function labelForCmp(cmp: string): string {
  if (cmp === "industry") return "Industry";
  if (cmp === "sector") return "Sector";
  if (cmp === "median") return "Median";
  if (cmp === "threshold") return "Threshold";
  return "Comparison";
}
