import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link, useNavigate } from "react-router";
import { ChevronRight, Copy, Check, Loader2, Key, Trash2, Shield, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { toast } from "sonner";
import { useAuth } from "../../auth/AuthContext";
import { authFetch } from "../../auth/tokenStore";
import { useState } from "react";

export function ApiKeysPage() {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [apiKeys, setApiKeys] = useState<Array<{id: string, prefix: string, suffix: string, type: "production" | "sandbox", created_at: string, last_used?: string, full_key?: string}>>([]);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState<"production" | "sandbox" | false>(false);
  const [revokingKey, setRevokingKey] = useState<string | false>(false);

  const API_BASE = import.meta.env.VITE_API_URL || "/api";

  const fetchApiKeys = async () => {
    if (!user) return;
    try {
      const res = await authFetch(`${API_BASE}/users/${user!.id}/api-keys`);
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch (err) {
      console.error("Failed to fetch API keys", err);
      toast.error("Failed to load API keys");
    }
  };

  const handleGenerateApiKey = async (type: "production" | "sandbox") => {
    if (!user) return;
    setGeneratingKey(type);
    try {
      const res = await authFetch(`${API_BASE}/users/${user.id}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.key) {
          setNewApiKey(data.key.full_key);
          toast.success(`${type} API key generated successfully`);
        }
        await fetchApiKeys();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to generate API key");
      }
    } catch (err) {
      toast.error("Failed to generate API key");
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!user) return;
    if (!confirm("Are you sure you want to revoke this API key? This action cannot be undone.")) return;
    setRevokingKey(keyId);
    try {
      const res = await authFetch(`${API_BASE}/users/${user.id}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("API key revoked");
        await fetchApiKeys();
      } else {
        toast.error("Failed to revoke API key");
      }
    } catch (err) {
      toast.error("Failed to revoke API key");
    } finally {
      setRevokingKey(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white">
        <PublicBrandHeader />
        <main className="pt-28">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0D7490] border-t-transparent" />
          </div>
        </main>
        <PublicBrandFooter />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white">
        <PublicBrandHeader />
        <main className="pt-28">
          <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 text-center">
            <div className="mx-auto max-w-xl">
              <Key className="size-16 text-[#0D7490] mx-auto mb-4" />
              <h1 className="text-3xl font-bold text-[#102B50]">Sign in to manage API keys</h1>
              <p className="mt-4 text-[#52647A]">You need to be signed in to generate and manage your API keys.</p>
              <div className="mt-8 flex justify-center gap-4">
                <Button asChild size="lg">
                  <Link to="/login?redirect=/developers/api-keys">Sign In</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/login?redirect=/developers/api-keys">Create Account</Link>
                </Button>
              </div>
            </div>
          </section>
        </main>
        <PublicBrandFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 border-b border-[#DCE5F0]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Link to="/developers" className="text-sm text-[#52647A] hover:text-[#0D7490] mb-2 inline-flex items-center gap-1">
                <ChevronRight className="size-4 rotate-180" />
                Developer Portal
              </Link>
              <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[#102B50]">API Keys</h1>
              <p className="mt-2 text-[#52647A]">Generate and manage your API keys for programmatic access to the StocksIntels API.</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/developers">← Back to Developer Portal</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center gap-3 mb-4">
                <Key className="w-6 h-6 text-[#0D7490]" />
                <div>
                  <CardTitle className="text-[#102B50]">Your API Keys</CardTitle>
                  <p className="text-sm text-[#52647A]">Manage your sandbox and production API keys.</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={() => handleGenerateApiKey("sandbox")}
                  disabled={generatingKey !== false}
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted"
                >
                  {generatingKey === "sandbox" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Generate Sandbox Key
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => handleGenerateApiKey("production")}
                  disabled={generatingKey !== false}
                  className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white"
                >
                  {generatingKey === "production" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Generate Production Key
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {newApiKey && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-green-900 font-medium">New API Key Generated</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { navigator.clipboard.writeText(newApiKey); toast.success("Copied!"); }}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <div className="bg-white border border-green-200 rounded p-3 font-mono text-sm text-green-900 break-all">
                    {newApiKey}
                  </div>
                  <p className="text-green-700 text-sm mt-2">
                    Save this key now — it won't be shown again. Store it securely in your environment variables.
                  </p>
                </div>
              )}

              <div className="pt-4 border-t border-border">
                <h4 className="text-foreground font-medium mb-4">Your API Keys</h4>
                {apiKeys.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Key className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>No API keys yet. Generate one to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {apiKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${key.type === "production" ? "bg-green-500" : "bg-amber-500"}`} />
                          <div>
                            <div className="font-mono text-sm text-foreground">{key.prefix}••••••••{key.suffix}</div>
                            <div className="text-muted-foreground text-xs">
                              {key.type === "production" ? "Production" : "Sandbox"} • Created {new Date(key.created_at).toLocaleDateString()}
                              {key.last_used && ` • Last used ${new Date(key.last_used).toLocaleDateString()}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(`${key.prefix}${key.suffix}`, "API Key ID")}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleRevokeKey(key.id)}
                            disabled={revokingKey === key.id}
                          >
                            {revokingKey === key.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}