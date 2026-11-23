import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link, useNavigate } from "react-router";
import { ChevronRight, Copy, Check, Loader2, Key, Trash2, Shield, AlertTriangle, Mail, Lock, User, Eye, EyeOff, RotateCcw, ArrowRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "sonner";
import { useAuth } from "../../auth/AuthContext";
import { authFetch } from "../../auth/tokenStore";
import { useState } from "react";

export function ApiKeysPage() {
const { user, isLoading: authContextLoading, login, register, sendVerificationCode, verifyEmailAndRegister, forgotPassword, resetPassword } = useAuth();
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

  // Inline auth state for unauthenticated users
  const [authMode, setAuthMode] = useState<"login" | "register" | "verify" | "forgot">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authOtpCode, setAuthOtpCode] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showAuthConfirmPassword, setShowAuthConfirmPassword] = useState(false);

  // Derived boolean flags to avoid TypeScript narrowing issues
  const isVerifyMode = authMode === "verify";
  const isLoginMode = authMode === "login";
  const isRegisterMode = authMode === "register";
  const isForgotMode = authMode === "forgot";
  const isPasswordMode = !isVerifyMode && !isForgotMode;
  const showPasswordFields = isLoginMode || isRegisterMode || isForgotMode;
  const showFullNameField = isRegisterMode || isVerifyMode;
  const showOtpField = isVerifyMode;
  const showConfirmPassword = isRegisterMode;
  const showPasswordToggle = !isVerifyMode && !isForgotMode;
  const showEmailField = true;
  const isEmailDisabled = isVerifyMode;

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (authMode === "login") {
        await login(authEmail, authPassword);
        toast.success("Signed in successfully");
      } else if (authMode === "register") {
        await sendVerificationCode(authEmail);
        setAuthMode("verify");
        toast.success("Verification code sent to your email");
      } else if (authMode === "verify") {
        await verifyEmailAndRegister(authEmail, authOtpCode, authFullName, authPassword);
        toast.success("Account created successfully");
      } else if (authMode === "forgot") {
        await forgotPassword(authEmail);
        toast.success("Reset code sent to your email");
        setAuthMode("login");
      }
    } catch (err: any) {
      setAuthError(err?.message || "An error occurred");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setAuthMode("forgot");
    setAuthError(null);
  };

  const handleBackToLogin = () => {
    setAuthMode("login");
    setAuthError(null);
    setAuthEmail("");
    setAuthOtpCode("");
    setAuthFullName("");
    setAuthPassword("");
    setAuthConfirmPassword("");
  };

  if (authContextLoading) {
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
          <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
            <div className="max-w-md mx-auto">
              <div className="text-center mb-8">
                <Link to="/developers" className="text-sm text-[#52647A] hover:text-[#0D7490] mb-4 inline-flex items-center gap-1">
                  <ChevronRight className="size-4 rotate-180" />
                  Developer Portal
                </Link>
                <Key className="size-16 text-[#0D7490] mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-[#102B50]">{isForgotMode ? "Reset Password" : isVerifyMode ? "Verify Email" : isLoginMode ? "Sign in to manage API keys" : "Create your account"}</h1>
                <p className="mt-4 text-[#52647A]">
                  {isForgotMode
                    ? "Enter your email to receive a reset code"
                    : isVerifyMode
                    ? "Enter the 6-digit code sent to your email"
                    : isLoginMode
                    ? "Sign in to generate and manage your API keys"
                    : "Create your StocksIntels developer account"}
                </p>
              </div>

              <Card className="bg-card border-border">
                <CardContent className="p-6 sm:p-8">
                  <form onSubmit={handleAuthSubmit} className="space-y-5">
                    {authError && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-red-700 text-sm font-medium min-w-0">{authError}</p>
                      </div>
                    )}

                    {(isRegisterMode || isVerifyMode) && (
                      <div className="space-y-1.5">
                        <Label htmlFor="fullName" className="text-muted-foreground/70 text-xs font-medium block ml-1">
                          Full Name
                        </Label>
                        <div className="relative">
                          <User className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors`} />
                          <Input
                            id="fullName"
                            type="text"
                            placeholder="John Doe"
                            value={authFullName}
                            onChange={(e) => setAuthFullName(e.target.value)}
                            onFocus={() => {}}
                            onBlur={() => {}}
                            className={`pl-10 pr-3 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200 ${
                              authFullName ? "border-[#4386C8] bg-white" : "border-[#D4DFEA] hover:border-[#9EB6D0]"
                            }`}
                            autoComplete="name"
                            required={isRegisterMode}
                            disabled={!isRegisterMode}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-muted-foreground/70 text-xs font-medium block ml-1">
                        Email Address
                      </Label>
                      <div className="relative">
                        <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors`} />
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          onFocus={() => {}}
                          onBlur={() => {}}
                          className={`pl-10 pr-3 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200 ${
                            authEmail ? "border-[#4386C8] bg-white" : "border-[#D4DFEA] hover:border-[#9EB6D0]"
                          }`}
                          autoComplete="email"
                          required
                          disabled={isVerifyMode}
                        />
                      </div>
                    </div>

                    {(isLoginMode || isRegisterMode || isForgotMode) && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 ml-1">
                          <Label htmlFor="password" className="text-muted-foreground/70 text-xs font-medium block ml-1">
                            Password
                          </Label>
{authMode !== "forgot" && (
                        <button type="button" onClick={() => setShowAuthPassword(!showAuthPassword)}
                          className="text-xs text-[#0D7490] hover:text-[#14A9B9] font-semibold hover:underline">
                        {showAuthPassword ? "Hide" : "Show"}
                      </button>
                    )}
                        </div>
                        <div className="relative">
                          <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors`} />
                          <Input
                            type={showAuthPassword ? "text" : "password"}
                            placeholder="********"
                            value={authPassword}
                            onChange={(e) => setAuthPassword(e.target.value)}
                            onFocus={() => {}}
                            onBlur={() => {}}
                            className={`pl-10 pr-10 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200 ${
                              authPassword ? "border-[#4386C8] bg-white" : "border-[#D4DFEA] hover:border-[#9EB6D0]"
                            }`}
                            autoComplete={isLoginMode ? "current-password" : "new-password"}
                            required={!isVerifyMode}
                            disabled={isVerifyMode}
                          />
                          <button type="button" onClick={() => setShowAuthPassword(!showAuthPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                            {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {isRegisterMode && (
                      <div className="space-y-1.5">
                        <Label htmlFor="confirmPassword" className="text-muted-foreground/70 text-xs font-medium block ml-1">
                          Confirm Password
                        </Label>
                        <div className="relative">
                          <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors`} />
                          <Input
                            type={showAuthConfirmPassword ? "text" : "password"}
                            placeholder="********"
                            value={authConfirmPassword}
                            onChange={(e) => setAuthConfirmPassword(e.target.value)}
                            onFocus={() => {}}
                            onBlur={() => {}}
                            className={`pl-10 pr-10 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200 ${
                              authConfirmPassword ? "border-[#4386C8] bg-white" : "border-[#D4DFEA] hover:border-[#9EB6D0]"
                            }`}
                            autoComplete="new-password"
                            required
                          />
                          <button type="button" onClick={() => setShowAuthConfirmPassword(!showAuthConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                            {showAuthConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {isVerifyMode && (
                      <div className="space-y-1.5">
                        <Label htmlFor="otpCode" className="text-muted-foreground/70 text-xs font-medium block ml-1">
                          Verification Code
                        </Label>
                        <div className="relative">
                          <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors`} />
                          <Input
                            id="otpCode"
                            type="text"
                            placeholder="000000"
                            value={authOtpCode}
                            onChange={(e) => setAuthOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            onFocus={() => {}}
                            onBlur={() => {}}
                            className={`pl-10 pr-3 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200 ${
                              authOtpCode ? "border-[#4386C8] bg-white" : "border-[#D4DFEA] hover:border-[#9EB6D0]"
                            }`}
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            maxLength={6}
                            required
                          />
                          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        </div>
                        <p className="text-[11px] text-muted-foreground/70">Enter the 6-digit code sent to <span className="font-medium">{authEmail}</span></p>
                      </div>
                    )}

                    {isForgotMode && (
                      <p className="text-sm text-muted-foreground">Enter your email to receive a password reset code.</p>
                    )}

                    <Button
                      type="submit"
                      disabled={authLoading}
                      className="w-full h-11 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm"
                    >
                      {authLoading ? (
                        <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> {isLoginMode ? "Signing in..." : isRegisterMode ? "Creating account..." : isVerifyMode ? "Verifying..." : "Sending code..."}</span>
                      ) : isLoginMode ? (
                        <span className="flex items-center gap-2">Sign In <ArrowRight className="w-4 h-4" /></span>
                      ) : isRegisterMode ? (
                        <span className="flex items-center gap-2">Send Verification Code <ArrowRight className="w-4 h-4" /></span>
                      ) : isVerifyMode ? (
                        <span className="flex items-center gap-2">Verify & Create Account <ArrowRight className="w-4 h-4" /></span>
                      ) : (
                        <span className="flex items-center gap-2">Send Reset Code <ArrowRight className="w-4 h-4" /></span>
                      )}
                    </Button>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-muted-foreground">
                      {authMode !== "forgot" && authMode !== "verify" && (
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          className="text-[#0D7490] hover:text-[#14A9B9] font-semibold hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                      {(isLoginMode || isForgotMode) && (
                        <>
                          <span className="text-[#D4DFEA]">or</span>
                          <button
                            type="button"
                            onClick={() => {
                              setAuthMode(isLoginMode ? "register" : "login");
                              setAuthError(null);
                              setAuthEmail("");
                              setAuthOtpCode("");
                              setAuthFullName("");
                              setAuthPassword("");
                              setAuthConfirmPassword("");
                            }}
                            className="text-[#0D7490] hover:text-[#14A9B9] font-semibold hover:underline"
                          >
                            {isLoginMode ? "Create an account" : "Sign in"}
                          </button>
                        </>
                      )}
{isVerifyMode && (
                        <button
                          type="button"
                          onClick={handleBackToLogin}
                          className="text-[#0D7490] hover:text-[#14A9B9] font-semibold hover:underline"
                        >
                          Back to sign in
                        </button>
                      )}
                    </div>
                  </form>
                </CardContent>
              </Card>
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