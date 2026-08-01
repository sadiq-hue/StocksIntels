export type SignalAction = "buy" | "sell" | "hold";

export interface Catalyst {
  type: string;
  direction: "positive" | "negative" | string;
  strength?: number;
  headline?: string | null;
  source?: string | null;
  publishedAt?: string | null;
}

export interface SpeculativeFlag {
  momentumPct: number;
  lookbackSessions: number;
  altmanZ?: number | null;
  warning?: string;
}

export interface Signal {
  id: string;
  ticker: string;
  name: string;
  price: number;
  change: number;
  type:
    | "Intraday"
    | "Swing Trade"
    | "Long Term"
    | "Aggressive Buy"
    | "Momentum Trade"
    | "Long Term Value"
    | "Avoid"
    | string;
  signal: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell" | string;
  action?: SignalAction;
  entry: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  confidence: number;
  timeframe?: string;
  sector: string;
  volume: string;
  rawVolume?: number;
  reason?: string;
  country?: string;
  market?: string;
  currency?: string;
  positionSize?: string;
  var95?: string;
  var99?: string;
  cvar95?: string;
  mlWinProb?: string;
  regime?: string;
  weeklyTrend?: string;
  dataSource?: string;
  catalyst?: Catalyst | null;
  speculative?: SpeculativeFlag | null;
  analysis?: {
    fundamental: { score: number; grade: string; metrics: Record<string, string> };
    technical: { score: number; grade: string; indicators: Record<string, string> };
    financial: { score: number; grade: string; analysis: Record<string, string> };
    macro?: {
      score: number;
      grade: string;
      signal: string;
      country: string;
      summary: string;
      conditions: Record<string, { score: number; signal: string; detail: string }>;
    };
    overall: { score: number; grade: string };
  };
}
