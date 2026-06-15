import { useState, useEffect, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Activity, BarChart3, BookOpen, Settings, Shield, RefreshCw,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle,
  Clock, Cpu, Zap, Server, Database,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// ─── Types ───────────────────────────────────────────────────────────────────
interface BacktestStats {
  total: number; wins: number; losses: number; winRate: number;
  avgReturn: number; profitFactor: number; sharpe: number; maxDrawdown: number;
  bySignal: Record<string, { total: number; wins: number; losses: number; winRate: number; avgReturn: number }>;
}

interface ForwardTestStats {
  totalPredictions: number; pendingPredictions: number; accuracy: number;
  byConfidence: Record<string, { total: number; accurate: number; accuracy: number }>;
  bySymbol: Record<string, { total: number; correct: number; accuracy: number }>;
}

interface ForwardPrediction {
  symbol: string; signal: string; confidence: number; price: number;
  generatedAt: string; resolved: boolean; actualReturn: number | null; correct: boolean | null;
}

interface AuditEntry {
  type: string; message: string; details: any; ts: string;
}

interface AuditResult {
  entries: AuditEntry[]; total: number;
}

interface EngineConfig {
  enabled: boolean; signalInterval: number; maxSymbols: number; minConfidence: number;
  backtestDays: number; forwardTestMinAge: number;
  weights: { fundamental: number; technical: number; financial: number; macro: number };
  portfolio: { maxConcentration: number; maxDrawdown: number; stopLoss: number };
}

interface EngineHealth {
  status: string; uptime: number; signalCount: number; confidenceMultiplier: number;
  regime: string;
  sources: Record<string, { ok: boolean; failCount: number; lastFail: number }>;
  performance: { total: number; wins: number; losses: number; winRate: number };
  portfolio: { consecutiveLosses: number; totalTrades: number; maxDrawdown: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtPct(v: number) { return `${v >= 0 ? "" : ""}${v.toFixed(1)}%`; }
function fmtNum(v: number) { return new Intl.NumberFormat("en-US").format(v); }
function fmtDuration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// ─── Backtest Tab ────────────────────────────────────────────────────────────
function BacktestPanel() {
  const [stats, setStats] = useState<BacktestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");
  const [signalType, setSignalType] = useState("all");
  const { user } = useAuth();
  const userIdParam = user?.id ? `&userId=${user.id}` : '';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days, limit: "500" });
      if (signalType && signalType !== "all") params.set("signal", signalType);
      const res = await fetch(`${API_URL}/signals/backtest?${params}${userIdParam}`);
      const data = await res.json();
      if (data.success) setStats(data.stats);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [days, signalType, userIdParam]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Period:</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[100px] h-8 text-xs border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Signal:</span>
          <Select value={signalType} onValueChange={setSignalType}>
            <SelectTrigger className="w-[120px] h-8 text-xs border-border"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="Strong Buy">Strong Buy</SelectItem>
              <SelectItem value="Buy">Buy</SelectItem>
              <SelectItem value="Accumulate">Accumulate</SelectItem>
              <SelectItem value="Sell">Sell</SelectItem>
              <SelectItem value="Strong Sell">Strong Sell</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" size="sm" className="border-border h-8 text-xs">
          <RefreshCw className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />Run
        </Button>
      </div>

      {loading && !stats ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : !stats ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No backtest data available yet</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Total Signals</p>
              <p className="text-foreground text-xl font-bold">{stats.total}</p>
            </Card>
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Win Rate</p>
              <p className={`text-xl font-bold ${stats.winRate >= 60 ? "text-emerald-600" : stats.winRate >= 45 ? "text-yellow-600" : "text-red-600"}`}>{fmtPct(stats.winRate)}</p>
            </Card>
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Avg Return</p>
              <p className={`text-xl font-bold ${stats.avgReturn > 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtPct(stats.avgReturn)}</p>
            </Card>
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Wins / Losses</p>
              <p className="text-foreground text-xl font-bold">{stats.wins}<span className="text-sm text-muted-foreground"> / </span>{stats.losses}</p>
            </Card>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Sharpe Ratio</p>
              <p className={`text-lg font-bold ${stats.sharpe >= 1 ? "text-emerald-600" : stats.sharpe >= 0 ? "text-yellow-600" : "text-red-600"}`}>{stats.sharpe.toFixed(2)}</p>
            </Card>
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Profit Factor</p>
              <p className={`text-lg font-bold ${stats.profitFactor >= 1.5 ? "text-emerald-600" : stats.profitFactor >= 1 ? "text-yellow-600" : "text-red-600"}`}>{stats.profitFactor.toFixed(2)}</p>
            </Card>
            <Card className="bg-card border-border p-3">
              <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Max Drawdown</p>
              <p className="text-lg font-bold text-red-600">{fmtPct(stats.maxDrawdown)}</p>
            </Card>
          </div>

          {Object.keys(stats.bySignal).length > 0 && (
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">By Signal Type</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 text-muted-foreground font-medium">Signal</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Total</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Wins</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Losses</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Win Rate</th>
                      <th className="text-right py-2 px-2 text-muted-foreground font-medium">Avg Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.bySignal).map(([sig, s]) => (
                      <tr key={sig} className="border-b border-border hover:bg-accent">
                        <td className="py-2 px-2 font-medium text-foreground">{sig}</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">{s.total}</td>
                        <td className="py-2 px-2 text-right text-emerald-600">{s.wins}</td>
                        <td className="py-2 px-2 text-right text-red-600">{s.losses}</td>
                        <td className={`py-2 px-2 text-right font-medium ${s.winRate >= 60 ? "text-emerald-600" : "text-yellow-600"}`}>{fmtPct(s.winRate)}</td>
                        <td className={`py-2 px-2 text-right ${s.avgReturn > 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtPct(s.avgReturn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Forward Test Tab ────────────────────────────────────────────────────────
function ForwardTestPanel() {
  const [stats, setStats] = useState<ForwardTestStats | null>(null);
  const [predictions, setPredictions] = useState<ForwardPrediction[]>([]);
  const [predTotal, setPredTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<{ resolved: number; failed: number } | null>(null);
  const [predPage, setPredPage] = useState(0);
  const [predFilter, setPredFilter] = useState<"all" | "resolved" | "pending">("all");
  const [selectedSymbol, setSelectedSymbol] = useState("all");
  const predPerPage = 20;
  const { user } = useAuth();
  const userIdParam = user?.id ? `?userId=${user.id}` : '';

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signals/forward-test${userIdParam}`);
      const data = await res.json();
      if (data.success) setStats(data.stats);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [userIdParam]);

  const fetchPredictions = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(predPerPage), offset: String(predPage * predPerPage),
      });
      if (predFilter === "resolved") params.set("resolved", "true");
      else if (predFilter === "pending") params.set("resolved", "false");
      if (selectedSymbol !== "all") params.set("symbol", selectedSymbol);
      const res = await fetch(`${API_URL}/signals/forward-test?${params}${userIdParam ? '&' + userIdParam.replace('?', '') : ''}`);
      const data = await res.json();
      if (data.success) { setPredictions(data.predictions); setPredTotal(data.total); }
    } catch (e) { console.error(e); }
  }, [predPage, predFilter, selectedSymbol, userIdParam]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchPredictions(); }, [fetchPredictions]);

  const handleResolve = async () => {
    setResolving(true);
    setResolveResult(null);
    try {
      const res = await fetch(`${API_URL}/signals/forward-test/resolve${userIdParam}`, { method: "POST" });
      const data = await res.json();
      if (data.success) setResolveResult(data);
      await fetchStats();
      await fetchPredictions();
    } catch (e) { console.error(e); } finally { setResolving(false); }
  };

  const signalColors: Record<string, string> = {
    "Strong Buy": "text-emerald-600 bg-emerald-50 border-emerald-200",
    Buy: "text-green-600 bg-green-50 border-green-200",
    Accumulate: "text-teal-600 bg-teal-50 border-teal-200",
    Hold: "text-muted-foreground bg-muted border-border",
    Reduce: "text-orange-600 bg-orange-50 border-orange-200",
    Sell: "text-red-600 bg-red-50 border-red-200",
    "Strong Sell": "text-rose-600 bg-rose-50 border-rose-200",
  };

  const allSymbols = stats ? Object.keys(stats.bySymbol).sort() : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Tracks signal predictions forward and compares actual outcomes after 8 hours</p>
        <div className="flex items-center gap-2">
          {resolveResult && (
            <span className="text-xs text-emerald-600">
              Resolved {resolveResult.resolved}, failed {resolveResult.failed}
            </span>
          )}
          <Button onClick={handleResolve} disabled={resolving} variant="outline" size="sm" className="border-border h-8 text-xs">
            <Zap className={`w-3 h-3 mr-1.5 ${resolving ? "animate-pulse" : ""}`} />Resolve Now
          </Button>
          <Button onClick={fetchStats} disabled={loading} variant="outline" size="sm" className="border-border h-8 text-xs">
            <RefreshCw className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border p-3 text-center">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Resolved</p>
          <p className="text-2xl font-bold text-foreground">{stats?.totalPredictions ?? 0}</p>
        </Card>
        <Card className="bg-card border-border p-3 text-center">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Pending</p>
          <p className="text-2xl font-bold text-amber-600">{stats?.pendingPredictions ?? 0}</p>
        </Card>
        <Card className="bg-card border-border p-3 text-center">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Accuracy</p>
          <p className={`text-2xl font-bold ${!stats || stats.accuracy >= 60 ? "text-emerald-600" : stats.accuracy >= 45 ? "text-yellow-600" : "text-red-600"}`}>
            {stats ? fmtPct(stats.accuracy) : "—"}
          </p>
        </Card>
        <Card className="bg-card border-border p-3 text-center">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Status</p>
          <p className={`text-lg font-bold ${!stats ? "text-muted-foreground" : stats.accuracy >= 60 ? "text-emerald-600" : "text-yellow-600"}`}>
            {!stats ? "—" : stats.totalPredictions === 0 ? "No Data" : stats.accuracy >= 60 ? "Good" : "Needs Work"}
          </p>
        </Card>
      </div>

      {/* Main content */}
      {stats && (stats.totalPredictions > 0 || stats.pendingPredictions > 0) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: By Symbol */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">By Symbol</p>
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Symbol</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Total</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Correct</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {allSymbols.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No resolved predictions yet</td></tr>
                  ) : allSymbols.map(sym => {
                    const s = stats.bySymbol[sym];
                    return (
                      <tr key={sym} className="border-b border-border hover:bg-accent cursor-pointer"
                        onClick={() => { setSelectedSymbol(sym); setPredPage(0); }}>
                        <td className="py-2 px-3 font-medium text-foreground">{sym}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">{s.total}</td>
                        <td className="py-2 px-3 text-right text-emerald-600">{s.correct}</td>
                        <td className={`py-2 px-3 text-right font-medium ${s.accuracy >= 60 ? "text-emerald-600" : "text-yellow-600"}`}>{fmtPct(s.accuracy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: By Confidence */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">By Confidence Bucket</p>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-muted-foreground font-medium">Confidence</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Total</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Accurate</th>
                    <th className="text-right py-2 px-3 text-muted-foreground font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.byConfidence).length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No data yet</td></tr>
                  ) : Object.entries(stats.byConfidence).map(([bucket, s]) => (
                    <tr key={bucket} className="border-b border-border hover:bg-accent">
                      <td className="py-2 px-3 font-medium text-foreground capitalize">{bucket}</td>
                      <td className="py-2 px-3 text-right text-muted-foreground">{s.total}</td>
                      <td className="py-2 px-3 text-right text-emerald-600">{s.accurate}</td>
                      <td className={`py-2 px-3 text-right font-medium ${s.accuracy >= 60 ? "text-emerald-600" : "text-yellow-600"}`}>{fmtPct(s.accuracy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No predictions recorded yet. Predictions are created during each signal cycle and resolve after 8 hours.
        </div>
      )}

      {/* Predictions List */}
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p className="text-sm font-semibold text-foreground">Prediction Log</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Symbol:</span>
              <Select value={selectedSymbol} onValueChange={(v) => { setSelectedSymbol(v); setPredPage(0); }}>
                <SelectTrigger className="w-[100px] h-7 text-xs border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {allSymbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Select value={predFilter} onValueChange={(v: "all" | "resolved" | "pending") => { setPredFilter(v); setPredPage(0); }}>
                <SelectTrigger className="w-[100px] h-7 text-xs border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={fetchPredictions} variant="ghost" size="sm" className="h-7 text-xs">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-muted-foreground font-medium">Symbol</th>
                <th className="text-left py-2 px-3 text-muted-foreground font-medium">Signal</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium">Confidence</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium">Entry Price</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium">Return</th>
                <th className="text-center py-2 px-3 text-muted-foreground font-medium">Result</th>
                <th className="text-right py-2 px-3 text-muted-foreground font-medium">Generated</th>
              </tr>
            </thead>
            <tbody>
              {predictions.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No predictions match filters</td></tr>
              ) : predictions.map((p, i) => (
                <tr key={`${p.symbol}-${p.generatedAt}-${i}`} className="border-b border-border hover:bg-accent">
                  <td className="py-2 px-3 font-medium text-foreground">{p.symbol}</td>
                  <td className="py-2 px-3">
                    <Badge className={`text-[9px] font-medium border ${signalColors[p.signal] || "bg-muted text-muted-foreground border-border"}`}>
                      {p.signal}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{p.confidence}%</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">${p.price?.toFixed(2)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${p.actualReturn !== null ? (p.actualReturn > 0 ? "text-emerald-600" : "text-red-600") : "text-muted-foreground"}`}>
                    {p.actualReturn !== null ? `${p.actualReturn > 0 ? "+" : ""}${p.actualReturn.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {p.resolved ? (
                      p.correct ? <CheckCircle className="w-4 h-4 text-emerald-500 inline" /> : <XCircle className="w-4 h-4 text-red-500 inline" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400 inline" />
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-muted-foreground whitespace-nowrap">
                    {new Date(p.generatedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {predTotal > predPerPage && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">{predTotal} total · Page {predPage + 1}</span>
            <div className="flex gap-1">
              <Button disabled={predPage === 0} variant="outline" size="sm" className="border-border h-7 text-xs" onClick={() => setPredPage(p => p - 1)}>Previous</Button>
              <Button disabled={(predPage + 1) * predPerPage >= predTotal} variant="outline" size="sm" className="border-border h-7 text-xs" onClick={() => setPredPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Log Tab ───────────────────────────────────────────────────────────
function AuditLogPanel() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const perPage = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(perPage), offset: String(page * perPage) });
      if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`${API_URL}/signals/audit?${params}`);
      const data = await res.json();
      setResult(data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [typeFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const eventColor = (type: string) => {
    if (type === "signal_cycle") return "bg-blue-100 text-blue-700 border-blue-200";
    if (type === "config_change") return "bg-purple-100 text-purple-700 border-purple-200";
    if (type === "error") return "bg-red-100 text-red-700 border-red-200";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Type:</span>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px] h-8 text-xs border-border"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="signal_cycle">Signal Cycle</SelectItem>
              <SelectItem value="config_change">Config Change</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" size="sm" className="border-border h-8 text-xs">
          <RefreshCw className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{result?.total ?? 0} entries</span>
      </div>

      {loading && !result ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      ) : !result || result.entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No audit log entries yet</div>
      ) : (
        <>
          <div className="space-y-1.5">
            {result.entries.map((entry) => (
              <Card key={entry.ts + entry.type} className="bg-card border-border p-3 hover:border-border transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`text-[9px] font-medium border ${eventColor(entry.type)}`}>
                        {entry.type}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">{new Date(entry.ts).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-foreground">{entry.message}</p>
                    {entry.details && (
                      <pre className="mt-1.5 text-[10px] text-muted-foreground bg-muted p-2 rounded overflow-x-auto max-h-24">
                        {JSON.stringify(entry.details, null, 1)}
                      </pre>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <div className="flex gap-1">
              <Button disabled={page === 0} variant="outline" size="sm" className="border-border h-7 text-xs" onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button disabled={(page + 1) * perPage >= (result.total || 0)} variant="outline" size="sm" className="border-border h-7 text-xs" onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Config Tab ──────────────────────────────────────────────────────────────
function ConfigPanel() {
  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signals/engine/config`);
      const data = await res.json();
      if (data.success) setConfig(data.config);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const updateField = (path: string, value: any) => {
    if (!config) return;
    const newConfig = { ...config };
    const parts = path.split(".");
    let obj: any = newConfig;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    setConfig(newConfig);
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${API_URL}/signals/engine/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setMessage("Configuration saved successfully");
        setConfig(data.config);
      } else {
        setMessage("Failed to save configuration");
      }
    } catch (e) {
      setMessage("Error saving configuration");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 3000);
    }
  };

  if (loading && !config) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>;
  }
  if (!config) return <div className="text-center py-16 text-muted-foreground text-sm">Unable to load configuration</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Runtime engine configuration. Changes are persisted to the audit log.</p>
        <div className="flex items-center gap-2">
          {message && <span className="text-xs text-emerald-600">{message}</span>}
          <Button onClick={saveConfig} disabled={saving} size="sm" className="bg-[#0D7490] hover:bg-[#0A5C72] text-white h-8 text-xs">
            {saving ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> : <Shield className="w-3 h-3 mr-1.5" />}
            Save Config
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engine</p>
        <Card className="bg-card border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-medium text-foreground">Enabled</p><p className="text-xs text-muted-foreground">Allow signal generation to run</p></div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={config.enabled} onChange={e => updateField("enabled", e.target.checked)} className="sr-only peer" />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#0D7490]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0D7490]"></div>
            </label>
          </div>
          <FieldRow label="Signal Interval" value={config.signalInterval} unit="ms" onChange={v => updateField("signalInterval", parseInt(v) || 300000)} />
          <FieldRow label="Max Symbols" value={config.maxSymbols} onChange={v => updateField("maxSymbols", parseInt(v) || 200)} />
          <FieldRow label="Min Confidence" value={config.minConfidence} unit="%" onChange={v => updateField("minConfidence", parseInt(v) || 40)} />
          <FieldRow label="Backtest Days" value={config.backtestDays} unit="days" onChange={v => updateField("backtestDays", parseInt(v) || 30)} />
          <FieldRow label="Forward Test Min Age" value={config.forwardTestMinAge} unit="ms" onChange={v => updateField("forwardTestMinAge", parseInt(v) || 3600000)} />
        </Card>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Weights</p>
        <Card className="bg-card border-border p-4 grid grid-cols-2 gap-3">
          <FieldRow label="Fundamental" value={Math.round(config.weights.fundamental * 100)} unit="%" onChange={v => updateField("weights.fundamental", (parseInt(v) || 0) / 100)} />
          <FieldRow label="Technical" value={Math.round(config.weights.technical * 100)} unit="%" onChange={v => updateField("weights.technical", (parseInt(v) || 0) / 100)} />
          <FieldRow label="Financial" value={Math.round(config.weights.financial * 100)} unit="%" onChange={v => updateField("weights.financial", (parseInt(v) || 0) / 100)} />
          <FieldRow label="Macro" value={Math.round(config.weights.macro * 100)} unit="%" onChange={v => updateField("weights.macro", (parseInt(v) || 0) / 100)} />
        </Card>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Portfolio</p>
        <Card className="bg-card border-border p-4 grid grid-cols-3 gap-3">
          <FieldRow label="Max Concentration" value={Math.round(config.portfolio.maxConcentration * 100)} unit="%" onChange={v => updateField("portfolio.maxConcentration", (parseInt(v) || 0) / 100)} />
          <FieldRow label="Max Drawdown" value={Math.round(config.portfolio.maxDrawdown * 100)} unit="%" onChange={v => updateField("portfolio.maxDrawdown", (parseInt(v) || 0) / 100)} />
          <FieldRow label="Stop Loss" value={Math.round(config.portfolio.stopLoss * 100)} unit="%" onChange={v => updateField("portfolio.stopLoss", (parseInt(v) || 0) / 100)} />
        </Card>
      </div>
    </div>
  );
}

function FieldRow({ label, value, unit, onChange }: { label: string; value: number; unit?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-20 h-7 text-xs text-right border-border [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && <span className="text-[11px] text-muted-foreground w-8">{unit}</span>}
      </div>
    </div>
  );
}

// ─── Health Tab ──────────────────────────────────────────────────────────────
function HealthPanel() {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/signals/engine/health`);
      const data = await res.json();
      if (data.success) setHealth(data.health);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 30000); return () => clearInterval(i); }, [fetchData]);

  if (loading && !health) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>;
  }
  if (!health) return <div className="text-center py-16 text-muted-foreground text-sm">Unable to load engine health</div>;

  const statusColor = health.status === "healthy" ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-yellow-600 bg-yellow-50 border-yellow-200";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge className={`text-xs font-semibold border ${statusColor}`}>
            <Activity className="w-3 h-3 mr-1" />{health.status}
          </Badge>
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Uptime: {fmtDuration(health.uptime)}</span>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline" size="sm" className="border-border h-8 text-xs">
          <RefreshCw className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Market Regime</p>
          <p className={`text-lg font-bold capitalize ${health.regime === "bull" ? "text-emerald-600" : health.regime === "bear" || health.regime === "crash" ? "text-red-600" : "text-yellow-600"}`}>
            {health.regime}
          </p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Signal Count</p>
          <p className="text-lg font-bold text-foreground">{health.signalCount}</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Win Rate</p>
          <p className={`text-lg font-bold ${health.performance.winRate >= 60 ? "text-emerald-600" : "text-yellow-600"}`}>{fmtPct(health.performance.winRate)}</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Confidence Mult.</p>
          <p className="text-lg font-bold text-foreground">{health.confidenceMultiplier.toFixed(2)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Total Trades</p>
          <p className="text-lg font-bold text-foreground">{fmtNum(health.performance.total)}</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Wins</p>
          <p className="text-lg font-bold text-emerald-600">{fmtNum(health.performance.wins)}</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Losses</p>
          <p className="text-lg font-bold text-red-600">{fmtNum(health.performance.losses)}</p>
        </Card>
        <Card className="bg-card border-border p-3">
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Consec. Losses</p>
          <p className={`text-lg font-bold ${health.portfolio.consecutiveLosses >= 3 ? "text-red-600" : "text-foreground"}`}>{health.portfolio.consecutiveLosses}</p>
        </Card>
      </div>

      <div>
        <p className="text-sm font-semibold text-foreground mb-2">Source Health</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(health.sources).map(([name, src]) => (
            <Card key={name} className={`bg-card border p-3 ${src.ok ? "border-border" : "border-red-200 bg-red-50"}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {src.ok ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
                  <span className="text-sm font-medium text-foreground capitalize">{name.replace(/([A-Z])/g, " $1").trim()}</span>
                </div>
                <Badge className={`text-[9px] border ${src.ok ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                  {src.ok ? "Healthy" : "Degraded"}
                </Badge>
              </div>
              {src.failCount > 0 && (
                <p className="text-xs text-muted-foreground ml-6">{src.failCount} failure{src.failCount > 1 ? "s" : ""}</p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export function SignalEnginePage() {
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9]">
          <Cpu className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Signal Engine</h1>
          <p className="text-muted-foreground text-sm">Backtesting, forward testing, audit, and configuration management</p>
        </div>
      </div>

      <Tabs defaultValue="backtest" className="space-y-4">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger value="backtest" className="text-xs data-[state=active]:bg-card">
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />Backtest
          </TabsTrigger>
          <TabsTrigger value="forward" className="text-xs data-[state=active]:bg-card">
            <TrendingUp className="w-3.5 h-3.5 mr-1.5" />Forward Test
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs data-[state=active]:bg-card">
            <BookOpen className="w-3.5 h-3.5 mr-1.5" />Audit Log
          </TabsTrigger>
          <TabsTrigger value="config" className="text-xs data-[state=active]:bg-card">
            <Settings className="w-3.5 h-3.5 mr-1.5" />Config
          </TabsTrigger>
          <TabsTrigger value="health" className="text-xs data-[state=active]:bg-card">
            <Activity className="w-3.5 h-3.5 mr-1.5" />Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="backtest"><BacktestPanel /></TabsContent>
        <TabsContent value="forward"><ForwardTestPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        <TabsContent value="config"><ConfigPanel /></TabsContent>
        <TabsContent value="health"><HealthPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
