import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Info, Calculator, Sparkles, BookOpen, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

// ---------- shared numeric helpers ----------

const DASH = "—";

/** Parse a user-typed number; returns null when blank/invalid so we can show a dash. */
function num(v: string): number | null {
  if (v == null) return null;
  const t = String(v).trim().replace(/[,%\s]/g, "");
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/** Per-share values in a large cap's currency. */
function money(v: number | null | undefined, cur: string, dp = 2): string {
  if (v == null || !isFinite(v)) return DASH;
  return `${cur === "KES" ? "KES " : "$"}${v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function pct(v: number | null | undefined, dp = 1): string {
  return v == null || !isFinite(v) ? DASH : `${v.toFixed(dp)}%`;
}
function compact(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(2) + "K";
  return v.toFixed(2);
}

// A labelled number field that keeps the raw string while the user types, so
// intermediate states like "-" or "" don't snap the input to 0.
function NumField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  step?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {props.label}
        {props.hint && <span title={props.hint} className="cursor-help text-muted-foreground/70"><Info className="inline size-3" /></span>}
      </span>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          step={props.step ?? "any"}
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className="pr-9 text-sm"
        />
        {props.suffix && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {props.suffix}
          </span>
        )}
      </div>
    </label>
  );
}

/** A single "step" row in the tutorial. */
function Step(props: { n: number; title: string; body: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0D7490]/10 text-[10px] font-semibold text-[#0D7490]">
        {props.n}
      </span>
      <span className="min-w-0 text-[12px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">{props.title}. </span>
        {props.body}
      </span>
    </li>
  );
}

// Colour a sensitivity cell by whether it clears the current price. Shared by
// both calculators, which render the same idea at different scales.
function sensTone(v: number, price: number | null | undefined): string {
  if (price == null || !isFinite(v)) return "";
  return v >= price ? "text-emerald-600" : "text-red-500";
}

function ResultCard(props: {  label: string;
  value: string;
  tone?: "pos" | "neg" | "flat";
  sub?: string;
}) {
  const tone =
    props.tone === "pos" ? "text-emerald-600" : props.tone === "neg" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{props.label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone}`}>{props.value}</div>
      {props.sub && <div className="text-[11px] text-muted-foreground">{props.sub}</div>}
    </div>
  );
}

// ---------- Fair Value ----------

export interface FairValueSeed {
  ticker: string;
  currency: string;
  price: number | null;
  eps: number | null;
  pe: number | null;
  epsGrowth: number | null;  // fraction, e.g. 0.12
}

export function FairValueCalculator({ seed, onClose }: { seed: FairValueSeed | null; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [t, setT] = useState("0.12");          // growth (fraction)
  const [pe, setPe] = useState("20");            // target P/E
  const [eps, setEps] = useState("");            // today's EPS
  const [px, setPx] = useState("");              // current price
  const [years, setYears] = useState("5");

  // Pre-fill from the selected ticker whenever it changes.
  useEffect(() => {
    if (!seed) return;
    setEps(seed.eps != null ? String(Number(seed.eps.toFixed(4))) : "");
    setPe(seed.pe != null && seed.pe > 0 ? String(Number(seed.pe.toFixed(2))) : "20");
    setPx(seed.price != null ? String(Number(seed.price.toFixed(2))) : "");
  }, [seed?.ticker, seed?.eps, seed?.pe, seed?.price]);

  const cur = seed?.currency || "USD";
  const g = num(t);
  const mult = num(pe);
  const e0 = num(eps);
  const price = num(px);
  const n = num(years) ?? 5;

  // Future EPS after n years of compounding growth.
  const epsN = e0 != null && g != null ? e0 * Math.pow(1 + g, n) : null;
  // Fair value = forward EPS x target P/E.
  const fairValue = epsN != null && mult != null ? epsN * mult : null;
  const upside = fairValue != null && price ? ((fairValue - price) / price) * 100 : null;
  const impliedPE = price != null && e0 ? price / e0 : null;

  // Projection path for the chart: EPS each year plus the P/E-implied value.
  const path = useMemo(() => {
    if (e0 == null || g == null || mult == null) return [];
    const out: Array<{ year: number; eps: number; value: number }> = [];
    for (let y = 0; y <= Math.max(1, Math.min(10, Math.round(n))); y++) {
      const e = e0 * Math.pow(1 + g, y);
      out.push({ year: y, eps: Number(e.toFixed(4)), value: Number((e * mult).toFixed(2)) });
    }
    return out;
  }, [e0, g, mult, n]);

  // Sensitivity: value across growth x P/E. This is what shows how much each
  // assumption actually matters.
  const growthAxis = [-0.05, 0, 0.05, 0.1, 0.15, 0.2];
  const peAxis = [10, 15, 20, 25, 30, 35];
  const sens = useMemo(() => {
    if (e0 == null) return [];
    return growthAxis.map((gg) => {
      const row: Record<string, number | string> = { growth: (gg * 100).toFixed(0) + "%" };
      peAxis.forEach((p) => {
        row["pe" + p] = Number((e0 * Math.pow(1 + gg, n) * p).toFixed(2));
      });
      return row;
    });
  }, [e0, n]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#0D7490]/10 text-[#0D7490]">
          <Calculator className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Fair Value Calculator</h2>
          <p className="text-[11px] text-muted-foreground">
            Earnings-based value: forward EPS multiplied by a target P/E.
          </p>
        </div>
        {seed && <Badge variant="outline" className="text-[10px]">{seed.ticker}</Badge>}
        <button type="button" onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
          <BookOpen className="size-3" /> Tutorial
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {showHelp && (
        <div className="rounded-xl border border-[#0D7490]/20 bg-[#0D7490]/5 p-3">
          <ol className="space-y-2">
            <Step n={1} title="Start from EPS" body={<>Earnings per share is the profit each share earns. We use the company's latest annual EPS, pre-filled from the ticker you picked. The <code className="text-[11px]">trailing</code> figure keeps the math honest; check the Financials tab if you want a forward estimate instead.</>} />
            <Step n={2} title="Pick a growth rate" body={<>What you expect earnings to grow each year. Historical EPS growth is pre-filled as a starting point, but this is your assumption — lower it if the business looks mature, raise it if it is still scaling.</>} />
            <Step n={3} title="Choose a target P/E" body={<>The multiple you are willing to pay per unit of earnings. The pre-filled value is the stock's <i>current</i> P/E, so the result starts at today's price and shows the effect of your assumptions alone.</>} />
            <Step n={4} title="Read the result" body={<>Future EPS = EPS x (1 + growth) raised to the number of years. Fair value = that future EPS x your target P/E. Compare it to the live price to see the implied upside or downside.</>} />
            <Step n={5} title="Use the sensitivity table" body={<>The grid re-runs the whole calculation across combinations of growth and P/E. It is the fastest way to see which assumption is driving the answer — if the value swings wildly on growth alone, the result is mostly a guess about the future, not a measurement of the business.</>} />
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <NumField label="EPS (annual)" value={eps} onChange={setEps} suffix={cur === "KES" ? "KES" : "$"} hint="Latest trailing earnings per share." />
        <NumField label="Expected growth" value={t} onChange={setT} suffix="%" hint="Annual EPS growth assumption, e.g. 12 for 12%." step="0.5" />
        <NumField label="Target P/E" value={pe} onChange={setPe} suffix="x" hint="Multiple you will pay per unit of earnings." />
        <NumField label="Current price" value={px} onChange={setPx} suffix={cur === "KES" ? "KES" : "$"} />
        <NumField label="Years out" value={years} onChange={setYears} suffix="yrs" hint="How far forward to project earnings." />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ResultCard label="Future EPS" value={epsN != null ? epsN.toFixed(2) : DASH} sub={`after ${n} year${n === 1 ? "" : "s"} at ${pct(g != null ? g * 100 : null)}`} />
        <ResultCard label="Fair value" value={money(fairValue, cur)} tone={fairValue == null ? "flat" : (price == null ? "flat" : fairValue > price ? "pos" : "neg")} />
        <ResultCard label="Upside / downside" value={upside != null ? `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%` : DASH} tone={upside == null ? "flat" : upside >= 0 ? "pos" : "neg"} sub={price != null ? `vs ${money(price, cur)}` : undefined} />
        <ResultCard label="Implied P/E today" value={impliedPE != null ? impliedPE.toFixed(1) + "x" : DASH} sub="at the current price" />
      </div>

      {path.length > 1 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-foreground">Projected value by year</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={path} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10 }} tickFormatter={(v) => `Y${v}`} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => Number(v).toFixed(0)} domain={["auto", "auto"]} />
                <Tooltip
                  formatter={(v: any, n: any) => [`${Number(v).toFixed(2)}`, n === 0 ? "EPS" : "Implied value"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }}
                />
                <ReferenceLine y={price ?? undefined} stroke="#9ca3af" strokeDasharray="4 4"
                  label={{ value: "price", position: "right", fontSize: 10, fill: "#9ca3af" }} />
                <Line type="monotone" dataKey="value" name="Implied value" stroke="#0D7490" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {sens.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold text-foreground">
            Sensitivity — fair value by growth and target P/E
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-1.5 text-left font-medium text-muted-foreground">Growth</th>
                  {peAxis.map((p) => (
                    <th key={p} className="p-1.5 text-right font-medium text-muted-foreground">{p}x</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sens.map((row) => (
                  <tr key={row.growth} className="border-b border-border/50">
                    <td className="p-1.5 font-medium text-muted-foreground">{row.growth}</td>
                    {peAxis.map((p) => (
                      <td key={p} className={`p-1.5 text-right font-mono ${sensTone(row["pe" + p] as number, price)}`}>
                        {Number(row["pe" + p]).toFixed(0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            <span className="text-emerald-600">green</span> = above the current price,{" "}
            <span className="text-red-500">red</span> = below. Values in {cur === "KES" ? "KES" : "USD"} per share.
          </p>
        </div>
      )}
    </Card>
  );
}

// ---------- DCF ----------

export interface DcfSeed extends FairValueSeed {
  fcf: number | null;          // total free cash flow, absolute
  shares: number | null;       // shares outstanding
  netCash: number | null;      // cash minus debt
  fcfYield: number | null;     // fraction
}

export function DcfCalculator({ seed, onClose }: { seed: DcfSeed | null; onClose?: () => void }) {
  const [showHelp, setShowHelp] = useState(false);
  const [t, setT] = useState("0.07");          // revenue/FCF growth (fraction)
  const [wacc, setWacc] = useState("0.09");     // discount rate
  const [term, setTerm] = useState("0.025");    // terminal growth
  const [yrs, setYrs] = useState("10");
  const [fcf, setFcf] = useState("");
  const [g1, setG1] = useState("");             // stage 1 growth (years 1-5)
  const [g2, setG2] = useState("");             // stage 2 growth (years 6-10)

  useEffect(() => {
    if (!seed) return;
    if (seed.fcf != null) setFcf(String(Math.round(seed.fcf)));
    else if (seed.price != null && seed.fcfYield) setFcf(String(Math.round(seed.price * (seed.fcfYield > 1 ? 1 : 1))));
    else if (seed.price != null && seed.pe != null && seed.eps != null) {
      // Last resort: derive an approximate FCF from earnings yield x market cap.
      setFcf(String(Math.round(seed.eps * (seed.shares || 0) || 0)));
    }
  }, [seed?.ticker, seed?.fcf, seed?.fcfYield, seed?.eps, seed?.shares, seed?.price, seed?.pe]);

  const cur = seed?.currency || "USD";
  const growth = num(t);
  const r = num(wacc);
  const tg = num(term);
  const n = Math.max(1, Math.round(num(yrs) ?? 10));
  const f0 = num(fcf);
  const gr1 = num(g1);
  const gr2 = num(g2);
  // Two-stage growth: years 1-5 use g1 (falls back to the headline rate), 6-10 use g2.
  const stageRate = (y: number) => {
    if (y <= 5) return gr1 != null ? gr1 / 100 : (growth ?? 0);
    return gr2 != null ? gr2 / 100 : (growth ?? 0);
  };

  const dcf = useMemo(() => {
    if (f0 == null || r == null || tg == null || r <= 0) return null;
    if (r <= tg) return null; // discount rate must exceed terminal growth
    let pv = 0;
    const rows: Array<{ year: number; fcf: number; pv: number }> = [];
    let cf = f0;
    for (let y = 1; y <= n; y++) {
      cf = cf * (1 + stageRate(y));
      const disc = Math.pow(1 + r, y);
      const p = cf / disc;
      pv += p;
      rows.push({ year: y, fcf: Number(cf.toFixed(0)), pv: Number(p.toFixed(0)) });
    }
    // Gordon growth terminal value on the final year's cash flow.
    const tv = (cf * (1 + tg)) / (r - tg);
    const pvTv = tv / Math.pow(1 + r, n);
    const equity = pv + pvTv + (seed?.netCash ?? 0);
    const perShare = seed?.shares ? equity / seed.shares : null;
    return { rows, pv, tv, pvTv, equity, perShare, terminalShare: pvTv / (pv + pvTv) };
  }, [f0, r, tg, n, growth, gr1, gr2, seed?.netCash, seed?.shares]);

  const upside = dcf?.perShare != null && seed?.price ? ((dcf.perShare - seed.price) / seed.price) * 100 : null;
  const wErr = r != null && tg != null && r <= tg;

  // Sensitivity of per-share value to the discount rate x terminal growth.
  const waccAxis = [0.07, 0.08, 0.09, 0.10, 0.11, 0.12];
  const tgAxis = [0.015, 0.02, 0.025, 0.03, 0.035];
  const sens = useMemo(() => {
    if (f0 == null || seed?.shares == null || !isFinite(seed.shares) || seed.shares <= 0) return [];
    return waccAxis.map((rr) => {
      const row: Record<string, number | string> = { wacc: (rr * 100).toFixed(1) + "%" };
      tgAxis.forEach((g) => {
        if (rr <= g) { row["g" + g] = 0; return; }
        let pv2 = 0, cf2 = f0;
        for (let y = 1; y <= n; y++) { cf2 = cf2 * (1 + stageRate(y)); pv2 += cf2 / Math.pow(1 + rr, y); }
        const tv2 = (cf2 * (1 + g)) / (rr - g);
        const eq = pv2 + tv2 / Math.pow(1 + rr, n) + (seed?.netCash ?? 0);
        row["g" + g] = Number((eq / (seed?.shares as number)).toFixed(2));
      });
      return row;
    });
  }, [f0, n, growth, gr1, gr2, seed?.shares, seed?.netCash]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">DCF Calculator</h2>
          <p className="text-[11px] text-muted-foreground">
            Ten-year discounted cash flow with a Gordon-growth terminal value.
          </p>
        </div>
        {seed && <Badge variant="outline" className="text-[10px]">{seed.ticker}</Badge>}
        <button type="button" onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
          <BookOpen className="size-3" /> Tutorial
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {showHelp && (
        <div className="rounded-xl border-violet-500/20 bg-violet-500/5 p-3">
          <ol className="space-y-2">
            <Step n={1} title="Start from free cash flow" body={<>Free cash flow is the cash a business actually generates after keeping the lights on — operating cash flow minus capital spending. Use the latest annual figure, pre-filled from the ticker where available.</>} />
            <Step n={2} title="Set the growth path" body={<>Cash flow is projected forward for the full horizon. We use two stages: a higher rate for years 1-5 while the business compounds, then a lower, mature rate for years 6-10. Both default to the headline growth rate.</>} />
            <Step n={3} title="Choose a discount rate (WACC)" body={<>The cost of capital — the return investors demand. Higher rates push value down and reflect riskier or more uncertain businesses. Roughly: risk-free rate plus a risk premium for the equity.</>} />
            <Step n={4} title="Set the terminal growth rate" body={<>The steady growth rate assumed to continue forever after the projection window. It must stay below the discount rate, otherwise the model produces a meaningless or negative result and we will flag it.</>} />
            <Step n={5} title="Read the result" body={<>Each year's cash flow is discounted back to today and summed. A terminal value captures everything after year 10, also discounted. Adding net cash and dividing by shares outstanding gives value per share. Note how much of the total the terminal value represents — usually the majority, which is why this model is sensitive to the discount rate.</>} />
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumField label="Free cash flow" value={fcf} onChange={setFcf} suffix={cur === "KES" ? "KES" : "$"} hint="Latest annual free cash flow, in total." />
        <NumField label="Growth (default)" value={t} onChange={setT} suffix="%" step="0.5" />
        <NumField label="Discount rate (WACC)" value={wacc} onChange={setWacc} suffix="%" step="0.25" hint="Cost of capital. Must exceed terminal growth." />
        <NumField label="Terminal growth" value={term} onChange={setTerm} suffix="%" step="0.25" hint="Perpetual growth after the horizon." />
        <NumField label="Stage 1 growth (Y1-5)" value={g1} onChange={setG1} suffix="%" step="0.5" hint="Optional. Defaults to the growth rate above." />
        <NumField label="Stage 2 growth (Y6-10)" value={g2} onChange={setG2} suffix="%" step="0.5" />
        <NumField label="Projection years" value={yrs} onChange={setYrs} suffix="yrs" />
        <NumField label="Shares outstanding" value={seed?.shares != null ? String(Math.round(seed.shares)) : ""} onChange={() => {}} disabled suffix="sh" hint="Taken from the company's filings." />
        <NumField label="Net cash" value={seed?.netCash != null ? String(Math.round(seed.netCash)) : ""} onChange={() => {}} disabled suffix={cur === "KES" ? "KES" : "$"} hint="Cash minus total debt, added to the valuation." />
      </div>

      {wErr && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-600">
          The discount rate must be higher than the terminal growth rate, otherwise the model has no solution.
        </p>
      )}

      {dcf ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <ResultCard label="Value per share" value={money(dcf.perShare, cur)} tone={dcf.perShare == null ? "flat" : (seed?.price && dcf.perShare > seed.price ? "pos" : "neg")} />
            <ResultCard label="Upside / downside" value={upside != null ? `${upside > 0 ? "+" : ""}${upside.toFixed(1)}%` : DASH} tone={upside == null ? "flat" : upside >= 0 ? "pos" : "neg"} sub={seed?.price ? `vs ${money(seed.price, cur)}` : undefined} />
            <ResultCard label="PV of forecast" value={compact(dcf.pv)} />
            <ResultCard label="PV of terminal" value={compact(dcf.pvTv)} sub={`${(dcf.terminalShare * 100).toFixed(0)}% of total`} />
            <ResultCard label="Equity value" value={compact(dcf.equity)} sub="incl. net cash" />
          </div>

          <div>
            <h3 className="mb-1 text-[11px] font-semibold text-foreground">Discounted cash flow by year</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dcf.rows} margin={{ top: 5, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => compact(Number(v))} />
                  <Tooltip
                    formatter={(v: any, n: any) => [compact(Number(v)), n === 0 ? "FCF" : "Present value"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                  <Bar dataKey="fcf" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pv" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {sens.length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-semibold text-foreground">
                Sensitivity — value per share by discount rate and terminal growth
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-1.5 text-left font-medium text-muted-foreground">WACC</th>
                      {tgAxis.map((g) => (
                        <th key={g} className="p-1.5 text-right font-medium text-muted-foreground">g {(g * 100).toFixed(1)}%</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sens.map((row) => (
                      <tr key={row.wacc} className="border-b border-border/50">
                        <td className="p-1.5 font-medium text-muted-foreground">{row.wacc}</td>
                        {tgAxis.map((g) => (
                          <td key={g} className={`p-1.5 text-right font-mono ${sensTone(row["g" + g] as number, seed?.price)}`}>
                            {Number(row["g" + g]).toFixed(0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                <span className="text-emerald-600">green</span> = above the current price,{" "}
                <span className="text-red-500">red</span> = below. Values in {cur === "KES" ? "KES" : "USD"} per share.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Enter free cash flow, a discount rate and a terminal growth rate to see the valuation.
        </p>
      )}
    </Card>
  );
}
