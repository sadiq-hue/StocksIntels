// AI Position Intelligence component.
//
// Renders the Azure GPT-5-mini interpretation of an existing quantitative
// signal. Clearly distinguished from engine outputs: uses a different visual
// treatment (muted border, "AI Interpretation" label) and never alters the
// recommendation display.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Brain,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
} from "lucide-react";
import type { AiPositionIntelligence, AiAnalysisRecord } from "../types/signals";

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

interface AiPositionIntelligenceProps {
  ticker: string;
  analysis: AiPositionIntelligence | null;
  loading: boolean;
  error: string | null;
  lastAnalyzed: string | null;
  onRetry: () => void;
  model: string | null;
  engineSignal: string | null;
  engineConfidence: number | null;
}

function renderMarkdownLite(text: string): React.ReactNode {
  // Very light inline rendering: bold segments (**text**) and plain paragraphs.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderFactorBlock({ title, text, hint }: { title: string; text: string | null | undefined; hint?: string }) {
  if (!text) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
        <p className="mb-1 font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">Not available.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-[#0D7490]/5 p-3 text-[11px] leading-relaxed">
      <p className="mb-1 font-semibold text-foreground">{title}{hint ? ` <span className="text-muted-foreground font-normal text-[10px]">({hint})</span>` : ''}</p>
      <p>{renderMarkdownLite(text)}</p>
    </div>
  );
}

function renderStringArray(items: string[] | undefined | null): React.ReactNode {
  if (!items || items.length === 0) {
    return <span className="text-[11px] text-muted-foreground">None identified.</span>;
  }
  return (
    <ul className="space-y-1.5 text-[11.5px] list-disc list-inside text-foreground/90">
      {items.map((item, i) => (
        <li key={i}>{renderMarkdownLite(item)}</li>
      ))}
    </ul>
  );
}

function ConflictRow({ conflict }: { conflict: { factor_pair: string; conflict: string; assessment: string } }) {
  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50 p-2.5 text-[11px]">
      <p className="mb-1 font-semibold text-amber-800">{conflict.factor_pair}</p>
      <p className="mb-1 text-amber-700">{renderMarkdownLite(conflict.conflict)}</p>
      <p className="text-amber-600">{renderMarkdownLite(conflict.assessment)}</p>
    </div>
  );
}

export function AiPositionIntelligence(props: AiPositionIntelligenceProps) {
  const { ticker, analysis, loading, error, lastAnalyzed, onRetry } = props;

  if (loading) {
    return (
      <Card className="border border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold flex items-center gap-2">
            <Brain className="size-3.5 text-[#0D7490]" />
            AI Investment Overview
          </CardTitle>
          <Badge variant="secondary" className="h-6 text-[10px]">
            Interpreting…
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            Generating AI interpretation…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border border-red-200 bg-red-50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="size-3.5 text-red-600" />
            AI Investment Overview
          </CardTitle>
          <ButtonRetry onRetry={onRetry} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-40 flex items-center justify-start text-[11px] text-red-600 leading-relaxed p-3">
            Unable to generate AI interpretation at this time. {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card className="border border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold flex items-center gap-2">
            <Brain className="size-3.5 text-muted-foreground" />
            AI Investment Overview
          </CardTitle>
          <ButtonRetry onRetry={onRetry} />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-40 flex items-center justify-start text-[11px] text-muted-foreground leading-relaxed p-3">
            No AI interpretation available for this position yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-[#0D7490]/20 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Brain className="size-3.5 text-[#0D7490]" />
          <CardTitle className="text-xs font-semibold text-foreground">
            AI Investment Overview
          </CardTitle>
          <Badge variant="outline" className="h-6 text-[10px]">
            Detailed Assessment
          </Badge>
        </div>
        <Badge variant="secondary" className="h-6 text-[10px]">
          {lastAnalyzed ? new Date(lastAnalyzed).toLocaleDateString() : "—"}
        </Badge>
      </CardHeader>
      <CardDescription className="text-[10px] text-muted-foreground mb-2">
        Detailed interpretation of the existing StocksIntels quantitative
        recommendation. Does not alter the engine’s signal, confidence, targets,
        or stop levels.
      </CardDescription>
      <Separator className="my-3" />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full grid w-full grid-cols-1 sm:grid-cols-4 text-xs border-b border-border/40">
          <TabsTrigger value="overview" className="flex flex-col items-center gap-1 px-2 py-2">
            <Info className="size-3 text-[#0D7490]" />
            <span>Overview</span>
          </TabsTrigger>
          <TabsTrigger value="factors" className="flex flex-col items-center gap-1 px-2 py-2">
            <AlertTriangle className="size-3 text-[#0D7490]" />
            <span>Evidence</span>
          </TabsTrigger>
          <TabsTrigger value="risks" className="flex flex-col items-center gap-1 px-2 py-2">
            <AlertTriangle className="size-3 text-[#0D7490]" />
            <span>Risks</span>
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="flex flex-col items-center gap-1 px-2 py-2">
            <Clock className="size-3 text-[#0D7490]" />
            <span>Monitoring</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3">
          {/* Overall Assessment */}
          <div className="rounded-lg border border-[#0D7490]/30 bg-[#0D7490]/10 p-3 text-[11.5px] leading-relaxed">
            <p className="mb-2 font-semibold text-[#0D7490]">Overall Assessment</p>
            <p>{renderMarkdownLite(analysis.executive_summary)}</p>
            {analysis.recommendation_context?.interpretation && (
              <>
                <p className="mt-2 font-semibold text-foreground">What the recommendation means</p>
                <p>{renderMarkdownLite(analysis.recommendation_context.interpretation)}</p>
              </>
            )}
          </div>

          {/* Factor Analysis */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed">
            <p className="mb-2 font-semibold text-foreground">Factor Analysis</p>
            <div className="space-y-2">
              {analysis.factor_analysis && (
                <>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">Fundamentals</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.fundamentals)}</p>
                  </div>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">Technical Analysis</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.technical)}</p>
                  </div>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">Financial Health</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.financial_health)}</p>
                  </div>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">Macro &amp; Market Conditions</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.macro)}</p>
                  </div>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">News &amp; Sentiment</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.news_and_sentiment)}</p>
                  </div>
                  <div className="border-b border-border/40 pb-1">
                    <p className="mb-1 font-semibold text-foreground">Valuation</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.valuation)}</p>
                  </div>
                  <div className="pb-1">
                    <p className="mb-1 font-semibold text-foreground">Risk</p>
                    <p>{renderMarkdownLite(analysis.factor_analysis.risk)}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recommendation Context */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px]">
            <p className="mb-2 font-semibold text-foreground">Recommendation Context</p>
            <p className="mb-1">
              <span className="font-semibold text-foreground">Engine signal: </span>
              <span className="text-foreground/90">{props.engineSignal || '—'}</span>
              {props.engineConfidence != null && (
                <span className="ml-2 text-foreground/70">({props.engineConfidence}% confidence)</span>
              )}
            </p>
            {analysis.recommendation_context?.interpretation && (
              <p>{renderMarkdownLite(analysis.recommendation_context.interpretation)}</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="factors" className="space-y-3">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-emerald-800">Bullish Factors</p>
            {renderStringArray(analysis.investment_thesis.bullish_factors)}
          </div>
          <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-red-800">Bearish Factors</p>
            {renderStringArray(analysis.investment_thesis.bearish_factors)}
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-amber-800">Neutral Factors</p>
            {renderStringArray(analysis.investment_thesis.neutral_factors)}
          </div>

          <Separator className="my-2" />
          <p className="text-[10px] font-semibold text-foreground mb-1">Factor Conflicts</p>
          {analysis.factor_conflicts.length > 0 ? (
            <div className="space-y-2">
              {analysis.factor_conflicts.map((c, i) => (
                <ConflictRow key={i} conflict={c} />
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">No significant factor conflicts identified.</span>
          )}
        </TabsContent>

        <TabsContent value="risks" className="space-y-3">
          <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-red-800">Key Risks</p>
            {renderStringArray(analysis.key_risks)}
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-amber-800">Missing Information</p>
            {renderStringArray(analysis.missing_information)}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-foreground">Thesis Invalidation Conditions</p>
            {renderStringArray(analysis.thesis_invalidation_conditions)}
          </div>
        </TabsContent>

        <TabsContent value="monitoring" className="space-y-3">
          <div className="rounded-lg border border-border bg-[#0D7490]/5 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-foreground">Monitoring Priorities</p>
            {renderStringArray(analysis.monitoring_priorities)}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-foreground">Data Quality Observations</p>
            {renderStringArray(analysis.data_quality_observations)}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11.5px]">
            <p className="mb-2 font-semibold text-foreground">Limitations</p>
            {renderStringArray(analysis.limitations)}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function ButtonRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      onClick={onRetry}
      className="flex items-center gap-1 text-[10px] font-medium text-[#0D7490] hover:underline"
    >
      <RefreshCw className="size-3" /> Retry
    </button>
  );
}
