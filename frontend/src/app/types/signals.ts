export type SignalAction = "buy" | "sell" | "hold";

export interface MonitoredPosition {
  ticker: string;
  signal: string;
  action: SignalAction;
  type: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number | null;
  target3: number | null;
  positionSize: number;
  price: number | null;
  market?: string;
  currency?: string;
  openedAt: string;
  daysHeld: number;
  expiryDays: number;
  expiresAt: string;
}

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

export interface InsiderActivity {
  score: number;
  hasActivity: boolean;
  netShares: number | null;
  netShareRatio: number | null;
  buyCount: number;
  sellCount: number;
  neutralCount: number;
  latestDate?: string | null;
  latestText?: string | null;
  summary: string;
  shortFloatPct?: number | null;
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
  insider?: InsiderActivity | null;
  analysis?: {
    fundamental: { score: number; grade: string; metrics: Record<string, string> };
    technical: { score: number; grade: string; indicators: Record<string, string> };
    financial: { score: number; grade: string; analysis: Record<string, string> };
    insider?: { score: number | null; grade: string; hasActivity: boolean; netShares: number | null; buyCount: number; sellCount: number; latestDate: string | null; summary: string } | null;
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
