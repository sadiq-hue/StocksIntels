import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, Sparkles, Zap,
  AlertCircle, CheckCircle2, Loader2, User, KeyRound,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import { GoogleLogin, googleLogout } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { useAuth } from "../auth/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DecodedToken = { sub: string; name: string; email: string; picture: string };
type AuthMode = "login" | "register" | "forgot" | "reset";

function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(6)].map((_, i) => (
        <motion.div key={i} className="absolute rounded-full bg-white/5"
          style={{ width: Math.random() * 300 + 100, height: Math.random() * 300 + 100, left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
          animate={{ x: [0, Math.random() * 100 - 50, 0], y: [0, Math.random() * 100 - 50, 0], scale: [1, 1.2, 1] }}
          transition={{ duration: Math.random() * 10 + 10, repeat: Infinity, ease: "easeInOut" }} />
      ))}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, delay }: { icon: React.ElementType; title: string; desc: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.5 }}
      className="group flex items-center gap-4 p-4 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 hover:bg-white/15 transition-all duration-300 cursor-default">
      <div className="w-12 h-12 bg-gradient-to-br from-white/20 to-white/5 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <h3 className="text-white font-semibold text-base">{title}</h3>
        <p className="text-white/60 text-sm mt-0.5">{desc}</p>
      </div>
    </motion.div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/app";
  const { login, register, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const clear = () => { setError(null); setSuccess(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (mode === "login") {
      setIsLoading(true);
      try { await login(email, password); navigate(redirectTo); }
      catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
      finally { setIsLoading(false); }
    } else if (mode === "register") {
      if (!fullName.trim()) { setError("Full name is required"); return; }
      setIsLoading(true);
      try { await register(fullName.trim(), email, password); navigate(redirectTo); }
      catch (err) { setError(err instanceof Error ? err.message : "Registration failed"); }
      finally { setIsLoading(false); }
    } else if (mode === "forgot") {
      if (!email) { setError("Email is required"); return; }
      setIsLoading(true);
      try {
        const res = await forgotPassword(email);
        setCountdown(res.expiresIn);
        setSuccess("Check your email for the reset code");
        setMode("reset");
      } catch (err) { setError(err instanceof Error ? err.message : "Failed to send reset code"); }
      finally { setIsLoading(false); }
    } else if (mode === "reset") {
      if (!otpCode || otpCode.length < 6) { setError("Enter the 6-digit reset code"); return; }
      if (!newPassword || newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
      setIsLoading(true);
      try {
        await resetPassword(email, otpCode, newPassword);
        setSuccess("Password reset successful. Sign in with your new password.");
        setTimeout(() => { setMode("login"); setPassword(""); setOtpCode(""); setNewPassword(""); }, 2000);
      } catch (err) { setError(err instanceof Error ? err.message : "Password reset failed"); }
      finally { setIsLoading(false); }
    }
  };

  const handleGoogleSuccess = useCallback(async (credentialResponse: any) => {
    if (credentialResponse?.credential) {
      const decoded = jwtDecode<DecodedToken>(credentialResponse.credential);
      try { setIsLoading(true); await login(decoded.email, "google_oauth_" + decoded.sub); }
      catch {
        try { await register(decoded.name, decoded.email, "google_oauth_" + decoded.sub); }
        catch { setError("Account exists. Try logging in with email/password."); setIsLoading(false); return; }
      }
      setIsLoading(false); navigate(redirectTo);
    }
  }, [navigate, login, register]);

  const handleGoogleError = useCallback(() => {
    setError("Google auth failed — check VITE_GOOGLE_CLIENT_ID in frontend/.env");
  }, []);

  useEffect(() => { return () => { googleLogout(); }; }, []);

  const inputClasses = (fieldName: string) => cn(
    "pl-12 pr-4 h-14 bg-gray-50/80 border-2 text-gray-900 rounded-xl transition-all duration-200",
    "placeholder:text-gray-400",
    focusedField === fieldName
      ? "border-[#0D7490] bg-white shadow-lg shadow-[#0D7490]/10 ring-4 ring-[#0D7490]/5"
      : "border-gray-200 hover:border-gray-300",
    error && "border-red-300 focus:border-red-500"
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex">
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative">
        <div className="w-full max-w-md relative z-10">
          <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="mb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                <img src="/logo.svg" alt="StocksIntels" className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-gray-900 text-2xl font-bold tracking-tight">StocksIntels</h1>
                <p className="text-gray-500 text-sm font-medium">Welcome back</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
            <Card className="bg-white/90 backdrop-blur-xl border-gray-100/80 shadow-2xl shadow-gray-200/60 rounded-3xl p-8">
              
              <div className="mb-6">
                <h2 className="text-gray-900 text-xl font-bold mb-1.5">
                  {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Reset Password" : "Set New Password"}
                </h2>
                <p className="text-gray-500 text-sm">
                  {mode === "login" || mode === "register" ? "Enter your credentials to access your dashboard" : mode === "forgot" ? "Enter your email to receive a reset code" : "Enter the reset code and your new password"}
                </p>
              </div>

              <AnimatePresence mode="wait">
                {error && (
                  <motion.div key="err" initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -10, height: 0 }}
                    className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </motion.div>
                )}
                {success && (
                  <motion.div key="ok" initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -10, height: 0 }}
                    className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <p className="text-emerald-700 text-sm font-medium">{success}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-5">
                {(mode === "login" || mode === "register") && (
                  <>
                    {mode === "register" && (
                      <div className="space-y-1.5">
                        <label className="text-gray-700 text-sm font-semibold block ml-1">Full Name</label>
                        <div className="relative">
                          <User className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "name" ? "text-[#0D7490]" : "text-gray-400"}`} />
                          <Input type="text" placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)}
                            onFocus={() => setFocusedField("name")} onBlur={() => setFocusedField(null)}
                            className={inputClasses("name")} required />
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0D7490]" : "text-gray-400"}`} />
                        <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                          className={inputClasses("email")} required autoComplete="email" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between ml-1">
                        <label className="text-gray-700 text-sm font-semibold">Password</label>
                        {mode === "login" && (
                          <button type="button" onClick={() => { setMode("forgot"); clear(); }}
                            className="text-xs text-[#0D7490] hover:text-[#0A5F7A] font-semibold hover:underline">
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "password" ? "text-[#0D7490]" : "text-gray-400"}`} />
                        <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                          onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                          className={cn(inputClasses("password"), "pr-12")} required minLength={6} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" disabled={isLoading}
                      className="w-full h-14 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-bold rounded-xl shadow-lg shadow-[#0D7490]/25 hover:shadow-[#0D7490]/40 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 disabled:opacity-70 text-base">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-5 h-5" /> Processing...</span>
                        : <span className="flex items-center gap-2">{mode === "register" ? "Create Account" : "Sign In"} <ArrowRight className="w-5 h-5" /></span>}
                    </Button>
                  </>
                )}

                {(mode === "forgot") && (
                  <div className="space-y-1.5">
                    <label className="text-gray-700 text-sm font-semibold block ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0D7490]" : "text-gray-400"}`} />
                      <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                        className={inputClasses("email")} required autoComplete="email" />
                    </div>
                    <Button type="submit" disabled={isLoading}
                      className="w-full mt-5 h-14 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-bold rounded-xl shadow-lg shadow-[#0D7490]/25 transition-all disabled:opacity-70 text-base">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-5 h-5" /> Sending...</span>
                        : <span className="flex items-center gap-2">Send Reset Code <ArrowRight className="w-5 h-5" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("login"); clear(); }}
                      className="w-full text-sm text-[#0D7490] hover:text-[#0A5F7A] font-semibold text-center">
                      Back to sign in
                    </button>
                  </div>
                )}

                {(mode === "reset") && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">Reset Code</label>
                      <div className="relative">
                        <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "code" ? "text-[#0D7490]" : "text-gray-400"}`} />
                        <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onFocus={() => setFocusedField("code")} onBlur={() => setFocusedField(null)}
                          className={cn(inputClasses("code"), "text-center text-2xl tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">New Password</label>
                      <div className="relative">
                        <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "pw" ? "text-[#0D7490]" : "text-gray-400"}`} />
                        <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                          onFocus={() => setFocusedField("pw")} onBlur={() => setFocusedField(null)}
                          className={cn(inputClasses("pw"), "pr-12")} required minLength={6} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                    {countdown > 0 && <p className="text-xs text-gray-400 text-center">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                    <Button type="submit" disabled={isLoading || otpCode.length < 6 || newPassword.length < 6}
                      className="w-full h-14 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-bold rounded-xl shadow-lg shadow-[#0D7490]/25 transition-all disabled:opacity-70 text-base">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-5 h-5" /> Resetting...</span>
                        : <span className="flex items-center gap-2">Reset Password <ArrowRight className="w-5 h-5" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("forgot"); setOtpCode(""); setNewPassword(""); clear(); }}
                      className="w-full text-sm text-[#0D7490] hover:text-[#0A5F7A] font-semibold text-center">
                      Resend code
                    </button>
                  </>
                )}
              </form>

              {(mode === "login" || mode === "register") && (
                <>
                  <div className="relative my-8">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="px-4 bg-white text-gray-400 font-medium uppercase tracking-wider">Or continue with</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="[&>div]:w-full [&>div>button]:w-full [&>div>button]:rounded-xl [&>div>button]:h-11">
                      <GoogleLogin onSuccess={handleGoogleSuccess} onError={handleGoogleError} />
                    </div>
                    <button type="button"
                      className="flex items-center justify-center gap-2 h-11 bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-xl transition-all text-gray-700 font-semibold text-sm hover:shadow-md active:scale-[0.98]">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                      GitHub
                    </button>
                  </div>
                </>
              )}
            </Card>
          </motion.div>

          {(mode === "login" || mode === "register") && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-8 text-center text-gray-500 text-sm">
              {mode === "register" ? "Already have an account?" : "Don't have an account?"}{" "}
              <button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(null); }}
                className="text-[#0D7490] hover:text-[#0A5F7A] font-bold transition-colors hover:underline underline-offset-2">
                {mode === "register" ? "Sign in" : "Create one now"}
              </button>
            </motion.p>
          )}
        </div>
      </div>

      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0D7490] via-[#0A8BA8] to-[#0EA5E9]">
          <FloatingOrbs />
          <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
            <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" /></pattern></defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/5 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center items-center w-full p-12">
          <div className="max-w-lg text-white">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10 shadow-lg">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="text-white/90 font-bold text-lg tracking-wide">AI-Powered Trading</span>
            </motion.div>
            <motion.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="text-5xl font-bold mb-6 leading-[1.1] tracking-tight">
              Make Smarter<br /><span className="text-white/90">Trading Decisions</span>
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="text-white/70 text-lg mb-12 leading-relaxed max-w-md">
              Get real-time AI insights, comprehensive market analysis, and powerful trading signals for African and global markets.
            </motion.p>
            <div className="space-y-4">
              <FeatureCard icon={Zap} title="Real-time Market Data" desc="Live NSE and global market data with millisecond precision" delay={0.7} />
              <FeatureCard icon={Sparkles} title="AI Trading Signals" desc="Smart recommendations powered by advanced machine learning" delay={0.8} />
              <FeatureCard icon={CheckCircle2} title="Portfolio Analytics" desc="Track, analyze and optimize your investments automatically" delay={0.9} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
