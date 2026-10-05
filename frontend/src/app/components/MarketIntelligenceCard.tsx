import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { AlertTriangle, ChevronDown, Radio, ShieldCheck } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

// ── numeric helpers ──────────────────────────────────────────────────────────
const num = (v: any): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && isFinite(x) ? x : null;
};
const pos = (v: any): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) =>
  !xs.length ? "" : xs.length === 1 ? xs[0]
    : xs.length === 2 ? `${xs[0]} and ${xs[1]}`
      : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const numsIn = (s: any): number[] =>
  (String(s || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => isFinite(n));

/** A rating that means the data was unavailable, not that the view is balanced. */
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
const TONE: Record<Verdict, string> = {
  Positive: "text-emerald-600",
  Negative: "text-red-600",
  Neutral: "text-muted-foreground",
  "Insufficient data": "text-slate-500 italic",
};
const VerdictTag = ({ v, words }: { v: Verdict; words?: [string, string, string] }) => (
  <span className={TONE[v]}>
    {v === "Positive" ? (words ? words[0] : "Positive")
      : v === "Negative" ? (words ? words[1] : "Negative")
        : v === "Insufficient data" ? "Insufficient data" : "Neutral"}
  </span>
);

// ── factor definitions ───────────────────────────────────────────────────────
// `unit` fixes a defect where a percentage threshold rendered as "5x" next to a
// yield. Multiples get x, percentages get %, ratios get neither.
type Unit = "x" | "%" | "";
interface FactorDef { key: string; name: string; group: string; unit: Unit; cmp?: string; cmpLabel?: string }

const FACTORS: FactorDef[] = [
  { key: "evSignal", name: "EV/EBITDA", group: "Valuation", unit: "x", cmp: "industry", cmpLabel: "Industry" },
  { key: "peSignal", name: "P/E vs Sector", group: "Valuation", unit: "x", cmp: "sector", cmpLabel: "Sector" },
  { key: "pbSignal", name: "Price/Book", group: "Valuation", unit: "x", cmp: "median", cmpLabel: "Median" },
  { key: "divSignal", name: "Dividend Yield", group: "Valuation", unit: "%" },
  { key: "revSignal", name: "Revenue Growth", group: "Growth", unit: "%", cmp: "threshold", cmpLabel: "Threshold" },
  { key: "epsSignal", name: "Earnings Surprise", group: "Earnings", unit: "%", cmp: "threshold", cmpLabel: "Threshold" },
  { key: "mgnSignal", name: "Margin Trend", group: "Margins", unit: "" },
  { key: "fcfSignal", name: "Free Cash Flow Yield", group: "Cash Flow", unit: "%", cmp: "threshold", cmpLabel: "Threshold" },
  { key: "deSignal", name: "Debt/Equity", group: "Financial Health", unit: "", cmp: "level", cmpLabel: "Healthy below" },
  { key: "crSignal", name: "Current Ratio", group: "Financial Health", unit: "", cmp: "threshold", cmpLabel: "Threshold" },
  { key: "roeSignal", name: "Return on Equity", group: "Financial Health", unit: "%" },
  { key: "altSignal", name: "Altman Z-Score", group: "Financial Health", unit: "", cmp: "threshold", cmpLabel: "Threshold" },
];
const RATING_KEYS: Record<string, string> = {
  peSignal: "peRating", evSignal: "evRating", pbSignal: "pbRating", divSignal: "divRating",
  revSignal: "revRating", epsSignal: "epsRating", mgnSignal: "mgnRating", fcfSignal: "fcfRating",
  deSignal: "debtRating", crSignal: "crRating", roeSignal: "roeRating", altSignal: "altRating",
};
const ASSESS: Record<string, [string, string]> = {
  Valuation: ["Attractive", "Expensive"],
  Growth: ["Strong", "Weak"],
  Earnings: ["Positive surprise", "Negative surprise"],
  Margins: ["Expanding", "Compressing"],
  "Cash Flow": ["Strong", "Weak"],
  "Financial Health": ["Strong", "Stretched"],
};

const MACRO_LABELS: Record<string, string> = {
  pmi: "Manufacturing Activity", gdp: "GDP Growth", gdpGrowth: "GDP Growth",
  inflation: "Inflation", creditRating: "Credit Rating", politicalRisk: "Political Risk",
  currentAccount: "Current-account conditions", interestRateDifferential: "Interest Rates vs Fed",
};
const DIMS = [
  { key: "fundamental", label: "Fundamentals" },
  { key: "technical", label: "Technical" },
  { key: "financial", label: "Financial Health" },
  { key: "insider", label: "Insider Activity" },
  { key: "macro", label: "Macro" },
];

function band(v: any): string {
  const s = num(v);
  if (s == null) return "Not scored";
  if (s >= 75) return "Very strong";
  if (s >= 65) return "Strong";
  if (s >= 55) return "Moderate";
  if (s >= 45) return "Mixed";
  return "Weak";
}
const ink = (v: any) => {
  const s = num(v);
  return s == null ? "text-muted-foreground/50" : s >= 65 ? "text-emerald-700" : s >= 50 ? "text-amber-700" : "text-red-600";
};

/** Format a factor value with its correct unit. */
function fmtVal(v: number | undefined, unit: Unit): string {
  if (v === undefined) return "—";
  return unit === "%" ? `${v}%` : unit === "x" ? `${v}x` : String(v);
}

function Block({ title, bandTxt, right, children }: { title: string; bandTxt?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border/70 pt-5">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-foreground">{title}</h3>
        {bandTxt && <span className="text-[11.5px] font-medium text-muted-foreground">{bandTxt}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  );
}
function Fact({ label, value, assess }: { label: string; value: ReactNode; assess?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px] text-[12px]">
      <span className="w-[44%] shrink-0 text-muted-foreground">{label}</span>
      <span className="w-[24%] shrink-0 font-mono tabular-nums text-foreground">{value}</span>
      <span className="min-w-0 flex-1 text-right">{assess}</span>
    </div>
  );
}

/**
 * Market Intelligence card, structured as a position brief.
 *
 * Everything on screen derives from ONE snapshot - signal.analysis - so the
 * headline, the factor rows, the dimension bands and the written explanation
 * cannot disagree. The engine's free-text `reason` blob is deliberately NOT
 * shown: it is generated at a different point in the cycle, and displaying it
 * alongside the metrics produced a card that claimed FCF yield 13.7% in one
 * place and 12.2% in another.
 *
 * Two honesty rules:
 *  - a score renders only with a grade. The engine emits placeholders (50, no
 *    grade) for signals restored from history.
 *  - missing data is a distinct state, never "Neutral". No number is invented;
 *    where the model has no score (news sentiment) that is stated rather than
 *    filled in.
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
    const isNse = s.market === "NSE" || s.currency === "KES";
    let dead = false;
    fetch(`${API_URL}/quote/${encodeURIComponent(isNse ? `NSE:${s.ticker}` : s.ticker)}`)
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

  // Factors, parsed once and reused by every section and by the narrative.
  const factors = useMemo(() => {
    const m = a.fundamental?.metrics || {};
    return FACTORS.map((f) => {
      const rating = m[RATING_KEYS[f.key]];
      const raw = m[f.key];
      if (raw == null && rating == null) return null;
      const n = numsIn(rating);
      return { ...f, rating, verdict: verdictOf(raw, rating), value: n[0], cmpValue: f.cmp ? n[1] : undefined };
    }).filter(Boolean) as Array<FactorDef & { rating: any; verdict: Verdict; value?: number; cmpValue?: number }>;
  }, [a.fundamental]);

  const byGroup = (g: string) => factors.filter((f) => f.group === g);
  const positive = factors.filter((f) => f.verdict === "Positive");
  const negative = factors.filter((f) => f.verdict === "Negative");
  const insufficient = factors.filter((f) => f.verdict === "Insufficient data");

  // News: a band only. The model has no separate sentiment score, so none is shown.
  const ns = s.newsSummary;
  const news = Array.isArray(s.news) ? s.news : [];
  const newsCount = ns ? ns.count : news.length;
  const net = String(ns?.net || "").toLowerCase();
  const newsBand: Verdict = newsCount < 3 ? "Insufficient data" : net === "positive" ? "Positive" : net === "negative" ? "Negative" : "Neutral";
  const newsJudgment = newsCount < 3;

  const insd = s.insider;
  const insNet = num(insd?.netShares);
  const insDir = insNet == null ? "Neutral" : insNet > 0 ? "Positive" : "Negative";

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

  // ── Investment View: one paragraph, built from the same snapshot ──
  const view = useMemo(() => {
    const isBuy = /buy/i.test(String(s.signal || ""));
    const isSell = /sell/i.test(String(s.signal || ""));
    const lead = isBuy ? "positive" : isSell ? "negative" : "neutral";
    const picks = positive.slice(0, 4).map((f) => friendly(f));
    const tail: string[] = [];
    if (isBuy || isSell) {
      tail.push(`Supported by ${list(picks)}`);
    }
    if (tech) tail.push(`${band(tech.score).toLowerCase()} technicals${trendRead ? ` (${trendRead.toLowerCase()})` : ""}`);
    if (insd && insNet != null && Math.abs(insNet) > 0) {
      tail.push(`${insNet > 0 ? "strong insider buying" : "insider selling"}`);
    }
    if (newsCount > 0) tail.push(`${newsJudgment ? "unconfirmed" : newsBand.toLowerCase()} news sentiment`);
    if (macro) tail.push(`${band(macro.score).toLowerCase()} macro conditions`);

    let t = `StocksIntels currently identifies a ${lead} ${String(s.type || "short-term").toLowerCase()} position. `;
    if (tail.length) t += `${cap(tail.join(", "))}.`;
    if (negative.length) {
      t += ` The clearest offsets are ${list(negative.slice(0, 3).map((f) => f.name.toLowerCase()))}.`;
    } else if (insufficient.length) {
      t += ` ${insufficient.length} factor${insufficient.length === 1 ? " is" : "s are"} unassessable for want of data and ${insufficient.length === 1 ? "is" : "are"} excluded from the view.`;
    }
    return t;
  }, [s.signal, s.type, positive, negative, insufficient, tech, insd, insNet, newsCount, newsBand, newsJudgment, macro, trendRead]);

  const rr = num(s.riskReward);
  const riskLevel = overall ? (num(overall.score)! >= 70 ? "Moderate" : "Elevated") : "Not assessed";

  const whatCouldChange = useMemo(() => {
    const out: string[] = [];
    if (stop != null) out.push(`Price moves below ${money(stop)}`);
    if (tech) out.push("Technical momentum deteriorates materially");
    if (positive.some((f) => /revenue/i.test(f.name))) out.push("Revenue growth slows significantly");
    if (positive.some((f) => /free cash flow/i.test(f.name))) out.push("Free cash flow generation weakens");
    if (insNet != null && Math.abs(insNet) > 0) out.push("Insider activity reverses from its current direction");
    if (mHead.length) out.push("Macro/currency conditions deteriorate");
    return out;
  }, [stop, tech, positive, insNet, mHead]);

  const groupRows = (g: string) => byGroup(g).map((f) => {
    const words = ASSESS[g] || ["Positive", "Negative"];
    return (
      <div key={f.key}>
        <Fact
          label={f.name}
          value={f.verdict === "Insufficient data" ? "n/a" : fmtVal(f.value, f.unit)}
          assess={<VerdictTag v={f.verdict} words={[words[0], words[1], ""]} />}
        />
        {f.cmpValue !== undefined && (
          <div className="flex items-baseline gap-3 pb-0.5 text-[11px]">
            <span className="w-[44%] shrink-0" />
            <span className="w-[24%] shrink-0 font-mono tabular-nums text-muted-foreground">
              {fmtVal(f.cmpValue, f.unit)}
            </span>
            <span className="min-w-0 flex-1 text-right text-muted-foreground">{f.cmpLabel}</span>
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="space-y-5">
      {/* ── 1. what is the view ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{s.ticker}</h1>
        {s.name && s.name !== s.ticker && <p className="text-sm text-muted-foreground">{s.name}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
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

      {/* ── 2. position score, market price, holding period ── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Position Score</div>
          {overall ? (
            <>
              <div className={`mt-0.5 text-lg font-extrabold tabular-nums ${ink(overall.score)}`}>
                {overall.score}<span className="text-xs text-muted-foreground">/100</span>
                {overall.grade && <span className="ml-1.5 text-sm">{overall.grade}</span>}
              </div>
              {/* stops users assuming a plain average of the bands below */}
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                Weighted across fundamentals, technicals, financial health,
                insider activity and macro &mdash; not a simple average.
              </p>
            </>
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
              generated {new Date(genAt).toLocaleDateString()} {clock(genAt)}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. why ── */}
      <Block title="Investment View">
        <p className="text-[13px] leading-relaxed text-foreground">{view}</p>
      </Block>

      {/* ── 5. the evidence, dimension by dimension ── */}
      <Block title="Position Evidence" bandTxt="how each dimension scored">
        <div className="space-y-1">
          {DIMS.map((d) => {
            const sc = a[d.key]?.score;
            const gr = a[d.key]?.grade;
            const real = num(sc) != null && !!gr;
            return (
              <div key={d.key} className="flex items-center justify-between gap-3 border-b border-border/40 py-1 last:border-0">
                <span className="text-[12px] text-foreground">{d.label}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-[12px] font-semibold ${ink(sc)}`}>{real ? sc : "—"}</span>
                  {real && <span className="w-5 text-[11px] text-muted-foreground">{gr}</span>}
                  <span className="w-24 text-right text-[11px] text-muted-foreground">{band(sc)}</span>
                </span>
              </div>
            );
          })}
          {/* News carries no separate model score, so it is listed as a band with
              that stated rather than given an invented number. */}
          {newsCount > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-border/40 py-1 last:border-0">
              <span className="text-[12px] text-foreground">News &amp; Sentiment</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">not separately scored</span>
                <span className="w-24 text-right text-[11px]"><VerdictTag v={newsBand} /></span>
              </span>
            </div>
          )}
        </div>
      </Block>

      {/* ── fundamentals ── */}
      <Block title="Fundamentals" bandTxt={fund ? `${band(fund.score)} · ${fund.score}/100` : "not scored"}>
        {(["Valuation", "Growth", "Earnings", "Margins", "Cash Flow"] as const).map((g) => {
          const items = byGroup(g);
          if (!items.length) return null;
          return <div key={g} className="mb-2.5 last:mb-0">{groupRows(g)}</div>;
        })}
        <details className="group mt-2.5">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
            <span className="inline-flex items-center gap-1">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              View full fundamental analysis ({factors.length} factors)
            </span>
          </summary>
          <div className="mt-2 space-y-0.5">
            {factors.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 text-[11.5px] last:border-0">
                <span className="font-medium text-foreground">{f.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.rating || "—"}</span>
                <span className="shrink-0"><VerdictTag v={f.verdict} /></span>
              </div>
            ))}
            {insufficient.length > 0 && (
              <p className="pt-1.5 text-[10.5px] text-muted-foreground">
                {insufficient.length} factor{insufficient.length === 1 ? "" : "s"} excluded rather than
                scored neutral — missing data is not a balanced view.
              </p>
            )}
          </div>
        </details>
      </Block>

      {/* ── financial health, previously buried inside fundamentals ── */}
      <Block title="Financial Health" bandTxt={fin ? `${band(fin.score)} · ${fin.score}/100` : "not scored"}>
        {byGroup("Financial Health").length
          ? groupRows("Financial Health")
          : <p className="text-[12px] text-muted-foreground">No balance-sheet factors were scored for this stock.</p>}
      </Block>

      {/* ── technicals ── */}
      <Block title="Technical Picture" bandTxt={tech ? `${band(tech.score)} · ${tech.score}/100` : "not scored"}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {technicals.map((t) => (
                <tr key={t.label} className="border-b border-border/30 last:border-0">
                  <td className="w-[36%] py-1 pr-3 text-muted-foreground">{t.label}</td>
                  <td className="w-[36%] py-1 pr-3 font-medium text-foreground">{t.reading}</td>
                  <td className="py-1 text-right text-muted-foreground">{t.read || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TechnicalRead trend={trendRead} rsi={rsiRead} macd={String(ti.macdSignal || "")} />
      </Block>

      {/* ── news, first class ── */}
      {newsCount > 0 && (
        <Block
          title="News & Sentiment"
          bandTxt={newsJudgment ? "insufficient coverage" : newsBand}
          right={!newsJudgment && ns ? (
            <span className="text-[11.5px]">
              <span className="text-emerald-600">{ns.positive} positive</span> ·{" "}
              <span className="text-muted-foreground">{ns.neutral} neutral</span> ·{" "}
              <span className="text-red-600">{ns.negative} negative</span>
            </span>
          ) : undefined}
        >
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Market narrative:</span>{" "}
            {newsJudgment
              ? `Only ${newsCount} tracked ${newsCount === 1 ? "story" : "stories"}, which is too few to read a reliable tone from coverage of this stock. No sentiment is being assumed.`
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

      {/* ── insider, first class ── */}
      {insd && (insd.hasActivity || (num(insd.score) != null && num(insd.score)! >= 50)) && (
        <Block
          title="Insider Activity"
          bandTxt={ins ? `${band(ins.score)} · ${ins.score}/100` : undefined}
        >
          <div className="space-y-0.5 text-[12px]">
            <Fact label="Buys" value={insd.buyCount ?? "—"} assess="" />
            <Fact label="Sells" value={insd.sellCount ?? "—"} assess="" />
            <Fact
              label="Net Activity"
              value={insNet != null ? `${insNet > 0 ? "+" : ""}${insNet.toLocaleString()} shares` : "—"}
              assess={<VerdictTag v={insDir as Verdict} words={["Accumulation", "Distribution", ""]} />}
            />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Insider interpretation:</span>{" "}
            {insNet == null
              ? "No net insider position could be established for this stock."
              : insNet > 0
                ? `Insiders bought materially more than they sold across the analysed window (${insd.buyCount ?? 0} buys against ${insd.sellCount ?? 0} sells). This is a significant supporting factor in the current assessment.`
                : `Insiders sold more than they bought across the analysed window (${insd.sellCount ?? 0} sells against ${insd.buyCount ?? 0} buys), which weighs against the current view.`}
          </p>
          {insd.latestDate && (
            <p className="mt-1 text-[10.5px] text-muted-foreground">Most recent activity: {String(insd.latestDate).slice(0, 10)}</p>
          )}
        </Block>
      )}

      {/* ── macro ── */}
      {a.macro && (
        <Block title="Macro" bandTxt={`${cap(macroStance || "mixed")}${macro ? ` · ${macro.score}/100` : ""}`}>
          <div className="space-y-2 text-[12px]">
            {mSup.length > 0 && (
              <div>
                <p className="mb-0.5 font-medium text-emerald-700">Supportive</p>
                <ul className="space-y-0.5 text-muted-foreground">{mSup.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {mHead.length > 0 && (
              <div>
                <p className="mb-0.5 font-medium text-red-700">Headwinds</p>
                <ul className="space-y-0.5 text-muted-foreground">{mHead.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {!mSup.length && !mHead.length && (
              <p className="text-muted-foreground">No macro factor is currently flagged in either direction.</p>
            )}
          </div>
          {macroFactors.length > 0 && (
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
                        <td className="py-1 text-right"><VerdictTag v={f.verdict} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Block>
      )}

      {/* ── risk ── */}
      <Block title="Risk & Position Sizing">
        <div className="space-y-0.5 text-[12px]">
          <Fact label="Risk Level" value={<span className="font-sans">{riskLevel}</span>} assess="" />
          <Fact label="Model Allocation" value={<span className="font-sans">{s.positionSize || "—"}</span>} assess="" />
          <Fact label="Risk/Reward" value={rr != null ? `${rr.toFixed(1)} : 1` : "—"} assess="" />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] italic text-muted-foreground">
          <ShieldCheck className="mt-px size-3 shrink-0" />
          Model output — not personalized investment advice.
        </p>
      </Block>

      {/* ── levels ── */}
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

      {/* ── 4. what would invalidate it ── */}
      <Block title="What Could Change This Position?">
        <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
          {whatCouldChange.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      </Block>

      {/* ── methodology, with a generated explanation that cannot drift ── */}
      <details className="group border-t border-border/70 pt-4">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-[#0D7490] hover:underline">
          <span className="inline-flex items-center gap-1">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            View methodology
          </span>
        </summary>
        <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            This position was assessed across fundamental performance, valuation, earnings,
            margins, cash flow, balance sheet, technical momentum, insider activity, news
            sentiment and macroeconomic conditions. Scored dimensions are weighted into the
            overall position score rather than averaged. Factors with no underlying data are
            shown as insufficient data and excluded from the directional assessment.
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
          <div>
            <p className="font-medium text-foreground">How the position was reached</p>
            <ul className="mt-0.5 space-y-0.5">
              {positive.map((f) => (
                <li key={"p" + f.key}>
                  <span className="text-emerald-600">Supports</span>{" "}
                  {f.name}{f.value !== undefined ? ` (${fmtVal(f.value, f.unit)})` : ""}
                  {f.cmpValue !== undefined ? ` vs ${fmtVal(f.cmpValue, f.unit)} ${(f.cmpLabel || "").toLowerCase()}` : ""}
                </li>
              ))}
              {negative.map((f) => (
                <li key={"n" + f.key}>
                  <span className="text-red-600">Counts against</span>{" "}
                  {f.name}{f.value !== undefined ? ` (${fmtVal(f.value, f.unit)})` : ""}
                </li>
              ))}
              {insufficient.map((f) => (
                <li key={"i" + f.key}>
                  <span className="text-slate-500">Unassessable</span>{" "}
                  {f.name} — {f.rating}
                </li>
              ))}
            </ul>
            {mSup.length > 0 && <p className="mt-1">Macro supportive: {list(mSup)}.</p>}
            {mHead.length > 0 && <p className="mt-0.5">Macro headwinds: {list(mHead)}.</p>}
          </div>
        </div>
      </details>
    </div>
  );
}

/** Plain-English name for a factor, used in the narrative. */
function friendly(f: { name: string; value?: number; unit: Unit }): string {
  const n = f.name.toLowerCase();
  if (n.includes("ev/ebitda")) return f.value !== undefined ? `attractive valuation at ${f.value}x EV/EBITDA` : "attractive valuation";
  if (n.includes("p/e")) return f.value !== undefined ? `a ${f.value}x P/E` : "a reasonable P/E";
  if (n.includes("revenue")) return f.value !== undefined ? `${f.value}% revenue growth` : "revenue growth";
  if (n.includes("free cash flow")) return f.value !== undefined ? `${f.value}% free cash flow yield` : "free cash flow";
  if (n.includes("current ratio")) return f.value !== undefined ? `liquidity at ${f.value}x` : "healthy liquidity";
  if (n.includes("debt/equity")) return f.value !== undefined ? `leverage of ${f.value}x` : "manageable leverage";
  if (n.includes("margin")) return "stable margins";
  if (n.includes("dividend")) return f.value !== undefined ? `a ${f.value}% dividend yield` : "dividend support";
  return f.name.toLowerCase();
}

function TechnicalRead({ trend, rsi, macd }: { trend: string; rsi: string; macd: string }) {
  if (!trend && !rsi && !macd) return null;
  const parts: string[] = [];
  if (trend) parts.push(`broader trend remains ${trend.toLowerCase()}`);
  const over = /overbought|extended/i.test(rsi);
  const under = /oversold/i.test(rsi);
  if (under && /bull/i.test(macd)) parts.push("but bullish MACD and an approaching-oversold RSI suggest possible stabilisation");
  else if (over) parts.push("though the RSI indicates the stock may be extended in the short term");
  else if (rsi) parts.push(`with RSI ${rsi.toLowerCase()}`);
  if (!parts.length) return null;
  return (
    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">Technical interpretation:</span> {cap(parts.join(", "))}.
    </p>
  );
}
