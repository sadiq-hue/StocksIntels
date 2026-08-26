import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Loader2, Mail, Send, Check, X, Eye, RefreshCw, Trash2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface NewsletterDraft {
  id: number;
  draft_date: string;
  subject: string;
  status: string;
  sent_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  content?: any;
}

const statusColors: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  sent: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
};

export function AdminNewsletter() {
  const { user, apiFetch } = useAuth();
  const [drafts, setDrafts] = useState<NewsletterDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [preview, setPreview] = useState<NewsletterDraft | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);

  if (user?.role !== "admin") {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground text-sm">Access denied. Admin only.</p>
      </div>
    );
  }

  const fetchDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/admin/newsletter/drafts?limit=30`);
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch (e) {
      console.error("Failed to fetch drafts:", e);
    }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch(`${API_URL}/admin/newsletter/generate`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        fetchDrafts();
      } else {
        alert(data.error || "Failed to generate draft");
      }
    } catch (e) {
      alert("Generation failed");
    }
    setGenerating(false);
  };

  const handleAction = async (id: number, action: string) => {
    setActionLoading(id);
    try {
      const res = await apiFetch(`${API_URL}/admin/newsletter/drafts/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        fetchDrafts();
      } else {
        alert(data.error || `Failed to ${action}`);
      }
    } catch (e) {
      alert(`Action failed`);
    }
    setActionLoading(null);
  };

  const handlePreview = async (draft: NewsletterDraft) => {
    setPreview(draft);
    setPreviewLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/admin/newsletter/preview/${draft.id}`);
      const html = await res.text();
      setPreviewHtml(html);
    } catch (e) {
      setPreviewHtml("<p>Failed to load preview</p>");
    }
    setPreviewLoading(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Reject this draft?")) return;
    await handleAction(id, "reject");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-[#0D7490]" />
            Stock Insights Newsletter
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Semi-automated daily stock insights. Generate drafts, review, and send.
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-[#0D7490] hover:bg-[#0A5F7A]"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Generate Draft
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : drafts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No drafts yet. Click "Generate Draft" to create one.
                </TableCell>
              </TableRow>
            ) : (
              drafts.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {new Date(draft.draft_date).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="font-medium text-sm max-w-xs truncate">
                    {draft.subject}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[draft.status] || ""}>
                      {draft.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {draft.sent_count || 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handlePreview(draft)}
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {draft.status === "draft" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAction(draft.id, "approve")}
                            disabled={actionLoading === draft.id}
                            title="Approve"
                            className="text-emerald-600 hover:text-emerald-700"
                          >
                            {actionLoading === draft.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(draft.id)}
                            title="Reject"
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {draft.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction(draft.id, "send")}
                          disabled={actionLoading === draft.id}
                          title="Send Now"
                          className="text-blue-600 hover:text-blue-700"
                        >
                          {actionLoading === draft.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-sm">{preview.subject}</h3>
              <div className="flex items-center gap-2">
                {preview.status === "draft" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => { handleAction(preview.id, "approve"); setPreview(null); }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Check className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { handleAction(preview.id, "reject"); setPreview(null); }}
                    >
                      <X className="w-4 h-4 mr-1" /> Reject
                    </Button>
                  </>
                )}
                {preview.status === "approved" && (
                  <Button
                    size="sm"
                    onClick={() => { handleAction(preview.id, "send"); setPreview(null); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Send className="w-4 h-4 mr-1" /> Send Now
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="overflow-auto max-h-[calc(90vh-60px)]">
              {previewLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <iframe
                  srcDoc={previewHtml}
                  className="w-full border-0"
                  style={{ minHeight: "600px" }}
                  title="Newsletter Preview"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
