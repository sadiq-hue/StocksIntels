import { useMemo, type ReactNode } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Info, Sparkles, ShieldAlert } from "lucide-react";
import type { Signal } from "../types/signals";

// Plain-language bands. We deliberately never render a buy/sell instruction from
// these - the product promise is "see the data, understand the reasoning, make
// your own decision", so every row here is a summary of evidence, not advice.
type Band = "Positive" | "Neutral" | "Caution" | "Strong" | "Not scored";

function bandFor(score: number | null | undefined): Band {
  if (score == null || !isFinite(score)) return "Not scored";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Positive";
  if (score >= 40) return "Neutral";
  return "Caution";
}
const BAND_TEXT: Record<Band, string> = {
  Strong: "text-emerald-700",
  Positive: "text-emerald-600",
  Neutral: "text-muted-foreground",
  Caution: "text-amber-600",
  "Not scored": "text-muted-foreground/60",
};
const BAND_BAR: Record<Band, string> = {
  Strong: "bg-emerald-500",
  Positive: "bg-emerald-400",
  Neutral: "bg-muted-foreground/40",
  Caution: "bg-amber-500",
  "Not scored": "bg-muted",
};

/**
 * A P/E-only valuation read.
 *
 * IMPORTANT: this is a coarse absolute band, not a sector- or history-relative
 * one. Saying "8.4x is cheap" is meaningless without knowing the sector, the
 * growth rate and the stock's own history, so the tooltip says exactly what this
 * is based on. A proper relative verdict is a separate feature; until that ships
 * this row must not be read as one.
 */
function peBand(pe: number | null | undefined): { band: Band; note: string } {
  if (pe == null || !isFinite(pe) || pe <= 0) return { band: "Not scored", note: "No positive P/E available" };
  if (pe < 10) return { band: "Positive", note: `P/E ${pe.toFixed(1)}x is in the low absolute band` };
  if (pe <= 20) return { band: "Neutral", note: `P/E ${pe.toFixed(1)}x is in the mid absolute band` };
  if (pe <= 35) return { band: "Neutral", note: `P/E ${pe.toFixed(1)}x is above the mid band` };
  return { band: "Caution", note: `P/E ${pe.toFixed(1)}x is a high absolute multiple` };
}

function riskBand(volatility: number | null | undefined, drawdown: number | null | undefined): { band: Band; note: string } {
  const parts: string[] = [];
  if (volatility != null && isFinite(volatility)) parts.push(`${volatility.toFixed(1)}% annualised volatility`);
  if (drawdown != null && isFinite(drawdown)) parts.push(`${Math.abs(drawdown).toFixed(1)}% max drawdown (1y)`);
  if (parts.length === 0) return { band: "Not scored", note: "Risk history not available yet" };
  const note = parts.join(" · ");
  if (volatility != null && volatility >= 45) return { band: "Caution", note };
  if (volatility != null && volatility < 25) return { band: "Positive", note };
  return { band: "Neutral", note };
}

function DimRow(props: {
  label: string;
  score: number | null | undefined;
  note?: string;
  hint?: string;
  extra?: ReactNode;
}) {
  const band = props.score === undefined ? "Not scored" : bandFor(props.score);
  const scored = props.score != null && isFinite(props.score as number);
  return (
    <div className="border-b border-border/50 py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
          {props.label}
          {props.hint && (
            <span title={props.hint} className="cursor-help text-muted-foreground/60">
              <Info className="inline size-3" />
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {props.extra && <span className="text-[10px] text-muted-foreground">{props.extra}</span>}
          {scored && <span className="text-[11px] font-semibold tabular-nums text-foreground">{props.score}/100</span>}
          <span className={`w-16 text-right text-[12px] font-semibold ${BAND_TEXT[band]}`}>{band}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${BAND_BAR[band]}`}
          style={{ width: scored ? `${Math.max(2, Math.min(100, props.score as number))}%` : "0%" }}
        />
      </div>
      {props.note && <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">{props.note}</p>}
    </div>
  );
}

export function StockIntelligencePanel(props: {
  // The page passes its local StockSignal (a Partial<Signal> with optional id and
  // a few extra score fields). This panel only reads the analysis blocks and
  // reason, so accept the looser shape rather than forcing a cast at the call site.
  signal: Partial<Signal> | null | undefined;
  pe?: number | null;
  volatility?: number | null;
  maxDrawdown?: number | null;
}) {
  const { signal } = props;
  const a = (signal as any)?.analysis || null;

  // The engine emits placeholder sub-scores (score 50, no grade) when a signal is
  // restored from signal_history without a full analysis. Rendering those as a
  // real "50/100" would be a fabricated number, so we require a grade before
  // treating any dimension as genuinely scored.
  const scored = (dim: any) => (dim && typeof dim.score === "number" && isFinite(dim.score) && dim.grade ? dim : null);

  const rows = useMemo(() => {
    const fund = scored(a?.fundamental);
    const tech = scored(a?.technical);
    const fin = scored(a?.financial);
    const macro = scored(a?.macro);
    const ins = scored(a?.insider);
    const overall = scored(a?.overall) || (a?.overall && typeof a.overall.score === "number" && isFinite(a.overall.score) ? a.overall : null);

    const ns = (signal as any)?.newsSummary;
    const sentimentBand: Band =
      ns && ns.count >= 3
        ? ns.positive > ns.negative * 1.3
          ? "Positive"
          : ns.negative > ns.positive * 1.3
            ? "Caution"
            : "Neutral"
        : "Not scored";
    const sentimentNote =
      ns && ns.count >= 3
        ? `${ns.positive} positive · ${ns.neutral} neutral · ${ns.negative} negative across ${ns.count} tracked stories`
        : "Not enough tracked news to read sentiment";

    const val = peBand(props.pe);
    const risk = riskBand(props.volatility, props.maxDrawdown);

    const fundNote = fund?.metrics
      ? Object.entries(fund.metrics).slice(0, 3).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`).join(" · ")
      : undefined;
    const techNote = tech?.indicators
      ? Object.entries(tech.indicators).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" · ")
      : undefined;
    const finNote = fin?.analysis
      ? Object.entries(fin.analysis).slice(0, 2).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`).join(" · ")
      : undefined;
    const macroNote = macro?.summary || undefined;
    const insNote = (signal as any)?.insider?.summary || undefined;

    return {
      overall,
      fund, tech, fin, macro, ins,
      fundNote, techNote, finNote, macroNote, insNote,
      sentimentBand, sentimentNote, val, risk,
    };
  }, [a, signal, props.pe, props.volatility, props.maxDrawdown]);

  if (!signal) return null;

  const overallScore = rows.overall?.score ?? null;
  const grade = rows.overall?.grade ?? null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#0D7490]/10 text-[#0D7490]">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Intelligence Score</h2>
          <p className="text-[11px] text-muted-foreground">
            A summary of what the engine scored, and the evidence behind it.
          </p>
        </div>
        {grade && <Badge variant="outline" className="text-[10px]">Grade {grade}</Badge>}
      </div>

      <div className="mb-3 flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-3">
        <div className="shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Overall</div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold tabular-nums text-foreground">
              {overallScore ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
        </div>
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
          {overallScore == null
            ? "No composite score has been calculated for this stock yet."
            : "A weighted blend of the fundamental, technical, financial and macro scores, adjusted for signals such as speculative moves. It summarises available data — it is not a recommendation."}
        </p>
      </div>

      {/* Why */}
      {(signal as any)?.reason && (
        <div className="mb-3 rounded-xl border border-[#0D7490]/20 bg-[#0D7490]/5 p-3">
          <p className="text-[11px] font-semibold text-[#0D7490]">Why this rating</p>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground">{(signal as any).reason}</p>
        </div>
      )}

      <div>
        <DimRow
          label="Fundamental outlook"
          score={rows.fund?.score}
          extra={rows.fund?.grade}
          note={rows.fundNote}
          hint="Score from profitability, growth, margins and balance-sheet strength."
        />
        <DimRow
          label="Valuation"
          score={undefined}
          extra={props.pe != null && props.pe > 0 ? `${props.pe.toFixed(1)}x P/E` : undefined}
          note={rows.val.note}
          hint="An absolute P/E band only. Whether a multiple is cheap depends on the sector and the stock's own history - that relative view is not applied here yet."
        />
        <DimRow
          label="Technical trend"
          score={rows.tech?.score}
          extra={rows.tech?.grade}
          note={rows.techNote}
          hint="Score from price action, momentum, volume and indicator readings."
        />
        <DimRow
          label="Financial strength"
          score={rows.fin?.score}
          extra={rows.fin?.grade}
          note={rows.finNote}
          hint="Score from cash generation, leverage and earnings quality."
        />
        <DimRow
          label="Sentiment"
          score={undefined}
          extra={`${((signal as any)?.news?.length ?? 0)} stories`}
          note={rows.sentimentNote}
          hint="Read from the tone of news attached to this stock. Needs at least three tracked stories."
        />
        <DimRow
          label="Macro environment"
          score={rows.macro?.score}
          extra={rows.macro?.grade}
          note={rows.macroNote}
          hint="Score from the macro conditions affecting this stock's market."
        />
        <DimRow
          label="Risk"
          score={undefined}
          extra={<ShieldAlert className="inline size-3 text-muted-foreground/60" />}
          note={rows.risk.note}
          hint="Based on realised volatility and the worst 1-year drawdown. Lower is steadier."
        />
        {rows.ins && (
          <DimRow
            label="Insider activity"
            score={rows.ins.score}
            extra={rows.ins.grade}
            note={rows.insNote}
            hint="Net insider buying and selling over the tracked window."
          />
        )}
      </div>

      <p className="mt-3 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Each row summarises the data available for this stock. A row reading
        &ldquo;Not scored&rdquo; means the engine could not gather enough data to
        judge it &mdash; that is a gap in coverage, not a neutral score.
      </p>
    </Card>
  );
}
