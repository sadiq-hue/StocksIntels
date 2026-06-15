export interface Signal {
  id: string;
  ticker: string;
  name: string;
  price: number;
  change: number;
  type: "Intraday" | "Swing Trade" | "Long Term";
  signal: "Strong Buy" | "Buy" | "Accumulate" | "Hold" | "Reduce" | "Sell" | "Strong Sell";
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  confidence: number;
  timeframe: string;
  sector: string;
  volume: string;
  reason: string;
  country?: string;
  market?: string;
  positionSize?: string;
  var95?: string;
  var99?: string;
  cvar95?: string;
  mlWinProb?: string;
  regime?: string;
  weeklyTrend?: string;
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
