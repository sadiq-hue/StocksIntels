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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Search, Upload, Trash2, Download, Plus, Loader2, FileText,
  TrendingUp, BarChart3, DollarSign, Building2, Activity,
} from "lucide-react";
const API_URL = import.meta.env.VITE_API_URL || "/api";

interface NseStock {
  id: number; ticker: string; name: string; sector: string | null;
  market: string; currency: string; is_active: boolean;
  pe_ratio: number | null; pb_ratio: number | null;
  market_cap: number | null; dividend_yield: number | null;
}

interface FinancialStatement {
  id: number; stock_id: number; period_type: string;
  period_end_date: string | null; file_name: string;
  file_size: number | null; status: string; parsed_data: Record<string, number> | null;
  error_message: string | null; uploaded_at: string; parsed_at: string | null;
  processed_by: string | null; ticker: string; stock_name: string;
}

type TabValue = "stocks" | "statements";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-KE", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    processing: "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    failed: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <Badge className={`${variants[status] || "bg-gray-100"} font-medium`} variant="outline">
      {status}
    </Badge>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number | null }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
      <div className="p-2 rounded-full bg-primary/10">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-sm font-semibold">{value ?? "N/A"}</p>
      </div>
    </div>
  );
}

export function AdminStocks() {
  const { apiFetch } = useAuth();
  const [tab, setTab] = useState<TabValue>("stocks");

  // Stocks state
  const [stocks, setStocks] = useState<NseStock[]>([]);
  const [stocksTotal, setStocksTotal] = useState(0);
  const [stocksPage, setStocksPage] = useState(1);
  const [stocksSearch, setStocksSearch] = useState("");
  const [stocksLoading, setStocksLoading] = useState(false);

  // Statements state
  const [statements, setStatements] = useState<FinancialStatement[]>([]);
  const [statementsTotal, setStatementsTotal] = useState(0);
  const [statementsPage, setStatementsPage] = useState(1);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [selectedStockId, setSelectedStockId] = useState<string>("all");

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadStockId, setUploadStockId] = useState("");
  const [uploadPeriodType, setUploadPeriodType] = useState("annual");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Detail / fundamentals
  const [detailStock, setDetailStock] = useState<NseStock | null>(null);
  const [fundamentals, setFundamentals] = useState<any>(null);
  const [fundStatements, setFundStatements] = useState<FinancialStatement[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const PER_PAGE = 20;

  // ── Fetch stocks ──
  const fetchStocks = useCallback(async (page = 1, search = "") => {
    setStocksLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (search) params.set("search", search);
      const res = await apiFetch(`${API_URL}/admin/nse-stocks?${params}`);
      const data = await res.json();
      setStocks(data.stocks || []);
      setStocksTotal(data.total || 0);
      setStocksPage(data.page || 1);
    } catch (e) {
      console.error("Failed to fetch stocks", e);
    } finally {
      setStocksLoading(false);
    }
  }, [apiFetch]);

  // ── Fetch statements ──
  const fetchStatements = useCallback(async (page = 1, stockId?: string) => {
    setStatementsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (stockId && stockId !== "all") params.set("stock_id", stockId);
      const res = await apiFetch(`${API_URL}/admin/financial-statements?${params}`);
      const data = await res.json();
      setStatements(data.statements || []);
      setStatementsTotal(data.total || 0);
      setStatementsPage(data.page || 1);
    } catch (e) {
      console.error("Failed to fetch statements", e);
    } finally {
      setStatementsLoading(false);
    }
  }, [apiFetch]);

  // ── Fetch fundamentals ──
  const fetchFundamentals = useCallback(async (stockId: number) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/admin/financial-statements/fundamentals/${stockId}`);
      const data = await res.json();
      setFundamentals(data.fundamentals);
      setFundStatements(data.statements || []);
    } catch (e) {
      console.error("Failed to fetch fundamentals", e);
    } finally {
      setDetailLoading(false);
    }
  }, [apiFetch]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: number, type: "stock" | "statement") => {
    try {
      const endpoint = type === "stock" ? `nse-stocks/${id}` : `financial-statements/${id}`;
      const res = await apiFetch(`${API_URL}/admin/${endpoint}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteId(null);
      if (type === "stock") fetchStocks(stocksPage, stocksSearch);
      else fetchStatements(statementsPage, selectedStockId);
    } catch (e) {
      console.error("Delete error", e);
    }
  }, [apiFetch, fetchStocks, fetchStatements, stocksPage, stocksSearch, statementsPage, selectedStockId]);

  // ── Upload ──
  const handleUpload = useCallback(async () => {
    if (!uploadFile || !uploadStockId) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("stock_id", uploadStockId);
      formData.append("period_type", uploadPeriodType);
      const res = await apiFetch(`${API_URL}/admin/financial-statements/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      setUploadFile(null);
      setUploadStockId("");
      fetchStatements(statementsPage, selectedStockId);
    } catch (e) {
      console.error("Upload error", e);
    } finally {
      setUploading(false);
    }
  }, [apiFetch, uploadFile, uploadStockId, uploadPeriodType, fetchStatements, statementsPage, selectedStockId]);

  // ── Native drag-and-drop ──
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === "application/pdf" && file.size <= 20 * 1024 * 1024) {
      setUploadFile(file);
    }
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setUploadFile(file);
  };

  // Initial loads
  useEffect(() => { fetchStocks(); }, [fetchStocks]);
  useEffect(() => { fetchStatements(1, selectedStockId); }, [fetchStatements, selectedStockId]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NSE Stock Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage NSE stocks, upload financial statements, and view fundamentals
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="stocks" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Stocks
          </TabsTrigger>
          <TabsTrigger value="statements" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Statements
          </TabsTrigger>
        </TabsList>

        {/* ── Stocks Tab ── */}
        <TabsContent value="stocks" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search stocks..."
                className="pl-9"
                value={stocksSearch}
                onChange={(e) => { setStocksSearch(e.target.value); fetchStocks(1, e.target.value); }}
              />
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-1" /> Add Stock</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add NSE Stock</DialogTitle></DialogHeader>
                <AddStockForm onSuccess={() => fetchStocks(1, stocksSearch)} apiFetch={apiFetch} />
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">P/E</TableHead>
                  <TableHead className="text-right">Div Yield</TableHead>
                  <TableHead className="text-right">Market Cap</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stocksLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : stocks.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No stocks found</TableCell></TableRow>
                ) : stocks.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-semibold">{s.ticker}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell><Badge variant="outline">{s.sector || "-"}</Badge></TableCell>
                    <TableCell className="text-right">{s.pe_ratio?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{s.dividend_yield != null ? `${s.dividend_yield.toFixed(2)}%` : "-"}</TableCell>
                    <TableCell className="text-right">{s.market_cap != null ? `${(s.market_cap / 1e9).toFixed(2)}B` : "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => { setDetailStock(s); fetchFundamentals(s.id); }}>
                              <BarChart3 className="w-3.5 h-3.5" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader><DialogTitle>{s.ticker} - {s.name}</DialogTitle></DialogHeader>
                            {detailLoading ? (
                              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                  <MetricCard icon={TrendingUp} label="P/E Ratio" value={fundamentals?.pe_ratio?.toFixed(2)} />
                                  <MetricCard icon={BarChart3} label="P/B Ratio" value={fundamentals?.pb_ratio?.toFixed(2)} />
                                  <MetricCard icon={Activity} label="ROE" value={fundamentals?.roe != null ? `${fundamentals.roe.toFixed(2)}%` : null} />
                                  <MetricCard icon={DollarSign} label="Dividend Yield" value={fundamentals?.dividend_yield != null ? `${fundamentals.dividend_yield.toFixed(2)}%` : null} />
                                  <MetricCard icon={TrendingUp} label="Revenue Growth" value={fundamentals?.revenue_growth != null ? `${fundamentals.revenue_growth.toFixed(2)}%` : null} />
                                  <MetricCard icon={TrendingUp} label="EPS Growth" value={fundamentals?.eps_growth != null ? `${fundamentals.eps_growth.toFixed(2)}%` : null} />
                                </div>
                                <h3 className="font-semibold text-sm mt-4 mb-2">Parsed Statements</h3>
                                {fundStatements.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No parsed statements yet</p>
                                ) : (
                                  <div className="space-y-2">
                                    {fundStatements.map((stmt) => (
                                      <Card key={stmt.id} className="p-3">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm font-medium">{stmt.file_name}</span>
                                            <StatusBadge status={stmt.status} />
                                          </div>
                                          <span className="text-xs text-muted-foreground">{formatDate(stmt.uploaded_at)}</span>
                                        </div>
                                        {stmt.parsed_data && Object.keys(stmt.parsed_data).length > 0 && (
                                          <div className="flex flex-wrap gap-2 mt-2">
                                            {Object.entries(stmt.parsed_data).map(([key, val]) => (
                                              <Badge key={key} variant="secondary" className="text-xs">
                                                {key.replace(/_/g, " ")}: {val}
                                              </Badge>
                                            ))}
                                          </div>
                                        )}
                                        {stmt.status === "failed" && stmt.error_message && (
                                          <p className="text-xs text-red-500 mt-1">{stmt.error_message}</p>
                                        )}
                                      </Card>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                        <Button variant="outline" size="sm" onClick={() => setDeleteId(s.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {stocksTotal > PER_PAGE && (
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" disabled={stocksPage <= 1}
                onClick={() => fetchStocks(stocksPage - 1, stocksSearch)}>Previous</Button>
              <span className="text-sm text-muted-foreground self-center">
                Page {stocksPage} of {Math.ceil(stocksTotal / PER_PAGE)}
              </span>
              <Button variant="outline" size="sm" disabled={stocksPage >= Math.ceil(stocksTotal / PER_PAGE)}
                onClick={() => fetchStocks(stocksPage + 1, stocksSearch)}>Next</Button>
            </div>
          )}
        </TabsContent>

        {/* ── Statements Tab ── */}
        <TabsContent value="statements" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={selectedStockId} onValueChange={(v) => { setSelectedStockId(v); fetchStatements(1, v); }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All stocks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stocks</SelectItem>
                {stocks.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.ticker} - {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Dialog>
              <DialogTrigger asChild>
                <Button><Upload className="w-4 h-4 mr-1" /> Upload Statement</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Upload Financial Statement</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Stock</label>
                    <Select value={uploadStockId} onValueChange={setUploadStockId}>
                      <SelectTrigger><SelectValue placeholder="Select stock" /></SelectTrigger>
                      <SelectContent>
                        {stocks.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.ticker} - {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Period Type</label>
                    <Select value={uploadPeriodType} onValueChange={setUploadPeriodType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="annual">Annual</SelectItem>
                        <SelectItem value="half-yearly">Half-Yearly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40"}`}
                    onClick={() => document.getElementById("pdf-upload-input")?.click()}
                  >
                    <input id="pdf-upload-input" type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileChange} />
                    {uploadFile ? (
                      <div className="space-y-1">
                        <FileText className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium">{uploadFile.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(uploadFile.size)}</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Drop PDF here or click to browse</p>
                        <p className="text-xs text-muted-foreground">Max 20MB</p>
                      </div>
                    )}
                  </div>
                  <Button className="w-full" disabled={!uploadFile || !uploadStockId || uploading} onClick={handleUpload}>
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Uploading...</> : "Upload"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stock</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statementsLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : statements.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No statements uploaded</TableCell></TableRow>
                ) : statements.map((stmt) => (
                  <TableRow key={stmt.id}>
                    <TableCell>
                      <span className="font-semibold">{stmt.ticker}</span>
                      <span className="text-xs text-muted-foreground ml-1">{stmt.stock_name}</span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{stmt.file_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{stmt.period_type}</Badge>
                    </TableCell>
                    <TableCell>{formatFileSize(stmt.file_size)}</TableCell>
                    <TableCell><StatusBadge status={stmt.status} /></TableCell>
                    <TableCell className="text-sm">{formatDate(stmt.uploaded_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => window.open(`${API_URL}/admin/financial-statements/${stmt.id}/pdf`, "_blank")}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setDeleteId(-stmt.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {statementsTotal > PER_PAGE && (
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" disabled={statementsPage <= 1}
                onClick={() => fetchStatements(statementsPage - 1, selectedStockId)}>Previous</Button>
              <span className="text-sm text-muted-foreground self-center">
                Page {statementsPage} of {Math.ceil(statementsTotal / PER_PAGE)}
              </span>
              <Button variant="outline" size="sm" disabled={statementsPage >= Math.ceil(statementsTotal / PER_PAGE)}
                onClick={() => fetchStatements(statementsPage + 1, selectedStockId)}>Next</Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Delete</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteId !== null && deleteId < 0
              ? "Are you sure you want to delete this statement? This action cannot be undone."
              : "Are you sure you want to delete this stock? This will also remove all associated statements."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (deleteId !== null) {
                handleDelete(Math.abs(deleteId), deleteId < 0 ? "statement" : "stock");
              }
            }}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddStockForm({ onSuccess, apiFetch }: { onSuccess: () => void; apiFetch: any }) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!ticker || !name) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`${API_URL}/admin/nse-stocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, name, sector: sector || undefined }),
      });
      if (res.ok) { onSuccess(); setTicker(""); setName(""); setSector(""); }
    } catch (e) {
      console.error("Add stock error", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Ticker</label>
        <Input placeholder="e.g. SCOM" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
      </div>
      <div>
        <label className="text-sm font-medium">Company Name</label>
        <Input placeholder="e.g. Safaricom PLC" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="text-sm font-medium">Sector</label>
        <Input placeholder="e.g. Telecommunications" value={sector} onChange={(e) => setSector(e.target.value)} />
      </div>
      <Button className="w-full" disabled={!ticker || !name || submitting} onClick={handleSubmit}>
        {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Adding...</> : "Add Stock"}
      </Button>
    </div>
  );
}
