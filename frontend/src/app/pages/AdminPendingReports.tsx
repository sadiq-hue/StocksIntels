import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import {
  Loader2, CheckCircle2, XCircle, RefreshCw, FileCheck2, AlertTriangle,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface PendingReport {
  id: number;
  ticker: string;
  name: string;
  period_type: string;
  period_end_date: string;
  file_name: string | null;
  parsed_data: Record<string, number> | null;
  processed_by: string | null;
  parsed_at: string | null;
  error_message: string | null;
}

const METRIC_LABELS: Record<string, string> = {
  total_revenue: "Revenue",
  net_income: "Net Income",
  eps: "EPS",
  total_assets: "Total Assets",
  total_liabilities: "Total Liabilities",
  shareholders_equity: "Equity",
  current_assets: "Current Assets",
  current_liabilities: "Current Liabilities",
  total_debt: "Total Debt",
  cost_of_revenue: "Cost of Revenue",
  operating_income: "Operating Income",
  retained_earnings: "Retained Earnings",
  cash_from_operations: "Cash from Ops",
  dividend_per_share: "DPS",
};

function fmt(n: number | undefined | null) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const opts: Intl.NumberFormatOptions = abs >= 1e9
    ? { notation: "compact", maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", ...opts }).format(n);
}

export default function AdminPendingReports() {
  const { user, apiFetch } = useAuth();
  const [items, setItems] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingReport | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_URL}/admin/financial-statements/pending`);
      if (!res.ok) throw new Error(`Failed to load pending reports (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load pending reports");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: number) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`${API_URL}/admin/financial-statements/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`Approve failed (${res.status})`);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e: any) {
      setError(e?.message || "Approve failed");
    } finally {
      setBusyId(null);
    }
  };

  const openReject = (r: PendingReport) => {
    setRejectTarget(r);
    setRejectReason("");
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      const res = await apiFetch(`${API_URL}/admin/financial-statements/${rejectTarget.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || "Rejected by admin" }),
      });
      if (!res.ok) throw new Error(`Reject failed (${res.status})`);
      setItems(prev => prev.filter(i => i.id !== rejectTarget.id));
      setRejectTarget(null);
    } catch (e: any) {
      setError(e?.message || "Reject failed");
    } finally {
      setBusyId(null);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center">
        <AlertTriangle className="size-16 mx-auto mb-4 text-gray-300" />
        <h2 className="text-xl font-bold text-gray-800">Staff Access Only</h2>
        <p className="text-gray-500 mt-2">You need admin privileges to review pending NSE reports.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCheck2 className="size-6 text-[#0D7490]" /> Pending NSE Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Auto-detected NSE financial reports are held here for review before going live. Approve to publish, reject to discard.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-2.5">
          {error}
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Ticker</TableHead>
              <TableHead className="w-[180px]">Company</TableHead>
              <TableHead className="w-[120px]">Period</TableHead>
              <TableHead>Parsed Data (KES)</TableHead>
              <TableHead className="w-[120px]">Detected</TableHead>
              <TableHead className="w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No reports awaiting approval.
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">{r.ticker}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.period_type}</Badge>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.period_end_date}</div>
                  </TableCell>
                  <TableCell>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                      {r.parsed_data ? (
                        Object.entries(r.parsed_data).slice(0, 8).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{METRIC_LABELS[k] || k}</span>
                            <span className="font-medium tabular-nums">{fmt(v)}</span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">No data</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.parsed_at ? new Date(r.parsed_at).toLocaleString() : "—"}
                    {r.processed_by && <div className="text-[10px] mt-0.5">{r.processed_by}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        disabled={busyId === r.id}
                        onClick={() => approve(r.id)}
                      >
                        {busyId === r.id ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busyId === r.id} onClick={() => openReject(r)}>
                        <XCircle className="size-4" /> Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject report: {rejectTarget?.ticker} ({rejectTarget?.period_type})</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This report will be marked failed and will not be re-parsed automatically. Provide a reason (optional).
          </p>
          <Textarea
            placeholder="Reason for rejection (e.g. figures don't match the PDF / wrong period)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={busyId !== null}>
              {busyId !== null ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
