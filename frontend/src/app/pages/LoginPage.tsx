import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, Sparkles, Zap,
  AlertCircle, CheckCircle2, Loader2, User, KeyRound,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import { jwtDecode } from "jwt-decode";
import { useAuth } from "../auth/AuthContext";
import { motion, AnimatePresence } from "motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DecodedToken = { sub: string; name: string; email: string; picture: string };
type AuthMode = "login" | "register" | "forgot" | "reset" | "otp-login";
type RegStage = "form" | "verify";
type OtpStage = "send" | "verify";

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

function FloatingMarkets() {
  const items = [
    { id: 'ngx', label: 'NGX', sub: '₦' },
    { id: 'jse', label: 'JSE', sub: 'R' },
    { id: 'nse', label: 'NSE', sub: 'KSh' },
    { id: 'egx', label: 'EGX', sub: 'EGP' },
    // global markets
    { id: 'nyse', label: 'NYSE', sub: '$' },
    { id: 'nasdaq', label: 'NASDAQ', sub: '$' },
    { id: 'lse', label: 'LSE', sub: '£' },
    { id: 'hkex', label: 'HKEX', sub: 'HK$' },
    { id: 'tse', label: 'TSE', sub: '¥' },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none">
      {items.map((it, i) => (
        <motion.div key={it.id} className="absolute flex items-center gap-2 bg-white/80 text-gray-800 text-xs px-3 py-1 rounded-full shadow-sm"
          style={{ left: `${10 + (i * 80) / items.length}%`, top: `${8 + (i * 13) % 60}%`, transform: 'translateX(-50%)' }}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: [0.85, 1, 0.85], y: [ -4, 4, -4 ] }}
          transition={{ repeat: Infinity, duration: 7 + i * 1.2, ease: 'easeInOut', delay: i * 0.35 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0" xmlns="http://www.w3.org/2000/svg"><path fill="#0B69A3" d="M12 2C7.03 2 3 6.03 3 11c0 4.97 4.03 9 9 9s9-4.03 9-9c0-4.97-4.03-9-9-9zm3 12h-2v2h-2v-2H9v-2h2V9h2v2h2v2z"/></svg>
          <div className="font-semibold">{it.label}</div>
          <div className="text-[10px] text-gray-500">{it.sub}</div>
        </motion.div>
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

function CompactHero() {
  return (
    <div className="mb-4 text-center">
      <div className="mx-auto flex items-center justify-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-[#0B69A3] to-[#2D8FD6] rounded-xl flex items-center justify-center shadow-sm">
          <img src="/logo1.jpg" alt="logo" className="w-6 h-6" />
        </div>
        <div className="text-left">
          <div className="text-gray-700 text-sm font-semibold">StocksIntels</div>
          <div className="text-[#0B69A3] text-2xl font-extrabold leading-tight">StocksIntels</div>
        </div>
      </div>
      <p className="text-gray-500 text-xs mt-2">Welcome back</p>
    </div>
  );
}
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/app";
  const { login, register, sendVerificationCode, verifyEmailAndRegister, forgotPassword, resetPassword, sendOtp, verifyOtp, requestLoginOtp, verifyLoginOtp } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [regStage, setRegStage] = useState<RegStage>("form");
  const [otpStage, setOtpStage] = useState<OtpStage>("send");
  const [loginStage, setLoginStage] = useState<"password" | "otp">("password");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("id_token=")) {
      const params = new URLSearchParams(hash.substring(1));
      const idToken = params.get("id_token");
      if (idToken) {
        window.location.hash = "";
        handleGoogleSuccess({ credential: idToken });
      }
    }
  }, []);

  const clear = () => { setError(null); setSuccess(null); };

  const getPwStrength = (pw: string) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return Math.min(score, 4);
  };
  const pwStrength = getPwStrength(password);
  const pwLabel = ["Weak", "Fair", "Good", "Strong", "Very Strong"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (mode === "login") {
      if (loginStage === "password") {
        if (!email || !password) { setError("Email and password are required"); return; }
        setIsLoading(true);
        try {
          const res = await requestLoginOtp(email, password);
          setCountdown(res.expiresIn);
          setSuccess("OTP sent to your email");
          setLoginStage("otp");
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to send login OTP"); }
        finally { setIsLoading(false); }
      } else {
        if (!otpCode || otpCode.length < 6) { setError("Enter the 6-digit OTP"); return; }
        setIsLoading(true);
        try { await verifyLoginOtp(email, otpCode); navigate(redirectTo); }
        catch (err) { setError(err instanceof Error ? err.message : "OTP verification failed"); }
        finally { setIsLoading(false); }
      }
    } else if (mode === "register") {
      if (regStage === "form") {
        if (!email) { setError("Email is required"); return; }
        setIsLoading(true);
        try {
          const res = await sendVerificationCode(email);
          setCountdown(res.expiresIn);
          setSuccess("Verification code sent to your email");
          setRegStage("verify");
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to send verification code"); }
        finally { setIsLoading(false); }
      } else {
        if (!verifyCode || verifyCode.length < 6) { setError("Enter the 6-digit verification code"); return; }
        if (!fullName.trim()) { setError("Full name is required"); return; }
        if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
        if (password !== confirmPassword) { setError("Passwords do not match"); return; }
        if (pwStrength < 3) { setError("Password is too weak — include uppercase, lowercase, number or symbol"); return; }
        setIsLoading(true);
        try {
          await verifyEmailAndRegister(fullName.trim(), email, password, verifyCode);
          navigate(redirectTo);
        } catch (err) { setError(err instanceof Error ? err.message : "Verification or registration failed"); }
        finally { setIsLoading(false); }
      }
    } else if (mode === "otp-login") {
      if (otpStage === "send") {
        if (!email) { setError("Email is required"); return; }
        setIsLoading(true);
        try {
          const res = await sendOtp(email);
          setCountdown(res.expiresIn);
          setSuccess("OTP sent to your email");
          setOtpStage("verify");
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to send OTP"); }
        finally { setIsLoading(false); }
      } else {
        if (!otpCode || otpCode.length < 6) { setError("Enter the 6-digit OTP"); return; }
        setIsLoading(true);
        try {
          await verifyOtp(email, otpCode);
          navigate(redirectTo);
        } catch (err) { setError(err instanceof Error ? err.message : "OTP verification failed"); }
        finally { setIsLoading(false); }
      }
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
        setTimeout(() => { setMode("login"); setLoginStage("password"); setPassword(""); setOtpCode(""); setNewPassword(""); }, 2000);
      } catch (err) { setError(err instanceof Error ? err.message : "Password reset failed"); }
      finally { setIsLoading(false); }
    }
  };

  const handleResendLoginOtp = async () => {
    if (!email || !password) return;
    clear(); setIsLoading(true);
    try {
      const res = await requestLoginOtp(email, password);
      setCountdown(res.expiresIn);
      setSuccess("A new OTP has been sent to your email");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to resend OTP"); }
    finally { setIsLoading(false); }
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
  }, [navigate, login, register, redirectTo]);

  const handleGoogleError = useCallback(() => {
    setError("Google auth failed — check VITE_GOOGLE_CLIENT_ID in frontend/.env");
  }, []);

  const loginWithGoogle = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "269380955616-346nscd402cen6cr0ts8ppiiv6i85i1r.apps.googleusercontent.com";
    const currentRedirect = searchParams.get("redirect");
    const redirectUri = window.location.origin + "/login" + (currentRedirect ? `?redirect=${encodeURIComponent(currentRedirect)}` : "");
    const nonce = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce,
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }, [searchParams]);

  const inputClasses = (fieldName: string) => cn(
    "pl-10 pr-3 h-10 bg-gray-50/80 border-2 text-gray-900 rounded-xl transition-all duration-200",
    "placeholder:text-gray-400",
    focusedField === fieldName
      ? "border-[#0B69A3] bg-white shadow-md shadow-[#0B69A3]/8 ring-4 ring-[#0B69A3]/5"
      : "border-gray-200 hover:border-gray-300",
    error && "border-red-300 focus:border-red-500"
  );

  return (
    <div className="min-h-screen overflow-auto overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 flex">
      <FloatingMarkets />
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8 relative">
        <div className="w-full max-w-sm relative z-10">
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
            <CompactHero />
            <Card className="bg-white/90 backdrop-blur-xl border-gray-100/80 shadow-md shadow-gray-200/30 rounded-2xl p-4">
              
              <div className="mb-6">
                <h2 className="text-gray-900 text-xl font-bold mb-1.5">
                  {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Reset Password" : mode === "otp-login" ? "Sign in with OTP" : "Set New Password"}
                </h2>
                <p className="text-gray-500 text-sm">
                  {mode === "login"
                    ? (loginStage === "password" ? "Enter your credentials to request a one-time password" : "Enter the OTP sent to your email")
                    : mode === "register"
                    ? "Enter your credentials to access your dashboard"
                    : mode === "forgot"
                    ? "Enter your email to receive a reset code"
                    : mode === "otp-login"
                    ? "Enter your email to receive a one-time password"
                    : "Enter the reset code and your new password"}
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

              <form onSubmit={handleSubmit} className="space-y-4">
                {(mode === "login" || mode === "register") && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                        <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                          className={inputClasses("email")} required autoComplete="email" disabled={(mode === "register" && regStage === "verify") || (mode === "login" && loginStage === "otp")} />
                      </div>
                    </div>
                    {mode === "login" && loginStage === "password" && (
                      <>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between ml-1">
                            <label className="text-gray-700 text-sm font-semibold">Password</label>
                            <button type="button" onClick={() => { setMode("forgot"); clear(); }}
                              className="text-xs text-[#0B69A3] hover:text-[#2D8FD6] font-semibold hover:underline">
                              Forgot password?
                            </button>
                          </div>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "password" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                              onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("password"), "pr-8 h-10")} required autoComplete="current-password" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <Button type="submit" disabled={isLoading || !email || !password}
                          className="w-full h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending OTP...</span>
                            : <span className="flex items-center gap-2">Sign In <ArrowRight className="w-4 h-4" /></span>}
                        </Button>
                        <button type="button" onClick={() => { setMode("otp-login"); setOtpStage("send"); setOtpCode(""); clear(); }}
                          className="w-full text-xs text-[#0B69A3] hover:text-[#2D8FD6] font-semibold text-center">
                          Sign in with OTP only
                        </button>
                      </>
                    )}
                    {mode === "login" && loginStage === "otp" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">One-Time Password</label>
                          <div className="relative">
                            <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "otpCode" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              onFocus={() => setFocusedField("otpCode")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("otpCode"), "text-center text-2xl tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                          </div>
                          {countdown > 0 && <p className="text-xs text-gray-400 text-center mt-1">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                          {countdown === 0 && (
                            <button type="button" onClick={handleResendLoginOtp} disabled={isLoading}
                              className="w-full text-xs text-[#0B69A3] hover:text-[#2D8FD6] font-semibold text-center disabled:opacity-50">
                              {isLoading ? "Resending..." : "Didn't receive it? Resend OTP"}
                            </button>
                          )}
                        </div>
                        <Button type="submit" disabled={isLoading || otpCode.length < 6}
                          className="w-full h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Verifying...</span>
                            : <span className="flex items-center gap-2">Verify & Sign In <ArrowRight className="w-4 h-4" /></span>}
                        </Button>
                        <button type="button" onClick={() => { setLoginStage("password"); setOtpCode(""); clear(); }}
                          className="w-full text-xs text-[#0B69A3] hover:text-[#2D8FD6] font-semibold text-center">
                          Back to password
                        </button>
                      </>
                    )}
                    {mode === "otp-login" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">Email Address</label>
                          <div className="relative">
                            <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                              onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                              className={inputClasses("email")} required autoComplete="email" disabled={otpStage === "verify"} />
                          </div>
                        </div>
                        {otpStage === "verify" && (
                          <div className="space-y-1.5">
                            <label className="text-gray-700 text-sm font-semibold block ml-1">One-Time Password</label>
                            <div className="relative">
                              <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "otpCode" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                              <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                onFocus={() => setFocusedField("otpCode")} onBlur={() => setFocusedField(null)}
                                className={cn(inputClasses("otpCode"), "text-center text-2xl tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                            </div>
                            {countdown > 0 && <p className="text-xs text-gray-400 text-center mt-1">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                          </div>
                        )}
                        <Button type="submit" disabled={isLoading || (otpStage === "send" ? !email : otpCode.length < 6)}
                          className="w-full h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                            : otpStage === "send" ? <span className="flex items-center gap-2">Send OTP <ArrowRight className="w-4 h-4" /></span>
                            : <span className="flex items-center gap-2">Verify & Sign In <ArrowRight className="w-4 h-4" /></span>}
                        </Button>
                        <button type="button" onClick={() => { setMode("login"); setLoginStage("password"); setOtpStage("send"); setOtpCode(""); clear(); }}
                          className="w-full text-xs text-[#0B69A3] hover:text-[#2D8FD6] font-semibold text-center">
                          Sign in with password instead
                        </button>
                      </>
                    )}
                    {mode === "register" && regStage === "form" && (
                      <Button type="submit" disabled={isLoading || !email}
                        className="w-full h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                        {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                          : <span className="flex items-center gap-2">Send Verification Code <ArrowRight className="w-4 h-4" /></span>}
                      </Button>
                    )}
                    {mode === "register" && regStage === "verify" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">Verification Code</label>
                          <div className="relative">
                            <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "vcode" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type="text" placeholder="000000" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              onFocus={() => setFocusedField("vcode")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("vcode"), "text-center text-2xl tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                          </div>
                          {countdown > 0 && <p className="text-xs text-gray-400 text-center mt-1">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">Full Name</label>
                          <div className="relative">
                            <User className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "name" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type="text" placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)}
                              onFocus={() => setFocusedField("name")} onBlur={() => setFocusedField(null)}
                              className={inputClasses("name")} required />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">Password</label>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "password" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)}
                              onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("password"), "pr-8 h-10")} required minLength={8} autoComplete="new-password" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {password && (
                            <div className="mt-1.5">
                              <div className="flex gap-1">
                                {[0, 1, 2, 3, 4].map((i) => (
                                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                                    i <= pwStrength ? ["bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-lime-500", "bg-emerald-500"][pwStrength] : "bg-gray-200"
                                  }`} />
                                ))}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5 text-right">{pwLabel[pwStrength]}</p>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-gray-700 text-sm font-semibold block ml-1">Confirm Password</label>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "cpw" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                            <Input type={showConfirmPw ? "text" : "password"} placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                              onFocus={() => setFocusedField("cpw")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("cpw"), "pr-8 h-10")} required minLength={8} autoComplete="new-password" />
                            <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                              {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {confirmPassword && password !== confirmPassword && (
                            <p className="text-xs text-red-500 mt-0.5">Passwords do not match</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setRegStage("form"); setVerifyCode(""); setError(null); }}
                            className="w-1/3 h-10 text-sm text-gray-500 hover:text-[#0B69A3] font-semibold border border-gray-200 rounded-xl hover:bg-gray-50 transition-all">
                            Back
                          </button>
                          <Button type="submit" disabled={isLoading || verifyCode.length < 6 || !fullName.trim() || password.length < 8 || password !== confirmPassword || pwStrength < 3}
                            className="flex-1 h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                            {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Creating account...</span>
                              : <span className="flex items-center gap-2">Create Account <ArrowRight className="w-4 h-4" /></span>}
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}

                {(mode === "forgot") && (
                  <div className="space-y-1.5">
                    <label className="text-gray-700 text-sm font-semibold block ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#AEB7C2]" : "text-gray-400"}`} />
                      <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                        className={inputClasses("email")} required autoComplete="email" />
                    </div>
                    <Button type="submit" disabled={isLoading}
                      className="w-full mt-3 h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all disabled:opacity-70 text-sm">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                        : <span className="flex items-center gap-2">Send Reset Code <ArrowRight className="w-4 h-4" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("login"); setLoginStage("password"); clear(); }}
                      className="w-full text-sm text-[#AEB7C2] hover:text-[#0B69A3] font-semibold text-center">
                      Back to sign in
                    </button>
                  </div>
                )}

                {(mode === "reset") && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">Reset Code</label>
                      <div className="relative">
                        <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "code" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                        <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onFocus={() => setFocusedField("code")} onBlur={() => setFocusedField(null)}
                          className={cn(inputClasses("code"), "text-center text-2xl tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-gray-700 text-sm font-semibold block ml-1">New Password</label>
                      <div className="relative">
                        <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "pw" ? "text-[#0B69A3]" : "text-gray-400"}`} />
                          <Input type={showPassword ? "text" : "password"} placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                            onFocus={() => setFocusedField("pw")} onBlur={() => setFocusedField(null)}
                            className={cn(inputClasses("pw"), "pr-8 h-10")} required minLength={6} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {countdown > 0 && <p className="text-xs text-gray-400 text-center">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                    <Button type="submit" disabled={isLoading || otpCode.length < 6 || newPassword.length < 6}
                      className="w-full h-10 bg-gradient-to-r from-[#0B69A3] to-[#2D8FD6] hover:from-[#0A5F8E] hover:to-[#0B69A3] text-white font-semibold rounded-xl shadow transition-all disabled:opacity-70 text-sm">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Resetting...</span>
                        : <span className="flex items-center gap-2">Reset Password <ArrowRight className="w-4 h-4" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("forgot"); setOtpCode(""); setNewPassword(""); clear(); }}
                      className="w-full text-sm text-[#AEB7C2] hover:text-[#0B69A3] font-semibold text-center">
                      Resend code
                    </button>
                  </>
                )}
              </form>

              {((mode === "login" && loginStage === "password") || mode === "register") && (
                <>
                  <div className="flex items-center my-4">
                    <div className="flex-1 h-px bg-gray-200" />
                    <div className="px-3 text-xs text-gray-400 whitespace-nowrap bg-white/90 rounded mx-3">Or continue with</div>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div className="relative">
                    <button type="button" onClick={() => setSocialOpen(!socialOpen)}
                      className="w-full flex items-center justify-between h-11 px-4 bg-gray-50 rounded-xl border border-gray-200 text-sm font-semibold">
                      <span>Sign in with</span>
                      <svg className={`w-4 h-4 transition-transform ${socialOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {socialOpen && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <button type="button" onClick={() => loginWithGoogle()}
                            className="w-full flex items-center justify-center gap-3 h-11 bg-white border border-gray-200 rounded-xl transition-all text-gray-700 font-semibold text-sm">
                            <svg className="w-5 h-5" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg"><path d="M533.5 278.4c0-18.5-1.5-37.3-4.7-55.1H272v104.5h146.9c-6.3 33.8-25.5 62.5-54.3 81.6v67.8h87.7c51.3-47.3 81.2-116.9 81.2-198.8z" fill="#4285F4"/><path d="M272 544.3c73.5 0 135.3-24.1 180.4-65.4l-87.7-67.8c-24.4 16.4-55.7 26.1-92.7 26.1-71 0-131.3-48-152.8-112.5H31.8v70.5C76.9 494.9 168.2 544.3 272 544.3z" fill="#34A853"/><path d="M119.2 323.7c-11.9-35.3-11.9-73.1 0-108.4V144.8H31.8C11.3 190.9 0 233.6 0 278.4s11.3 87.5 31.8 133.6l87.4-88.3z" fill="#FBBC05"/><path d="M272 109.7c39.9-.6 78.2 14 107.4 40.3l80.5-80.5C404.7 24.5 345.5 0 272 0 168.2 0 76.9 49.4 31.8 144.8l87.4 70.5C140.7 157.7 201 109.7 272 109.7z" fill="#EA4335"/></svg>
                            <span>Sign in with Google</span>
                          </button>
                        </div>
                        <button type="button" onClick={() => { console.log('Apple Sign in clicked'); }}
                          className="w-full flex items-center justify-center gap-3 h-11 bg-black text-white rounded-xl transition-all text-sm font-semibold">
                            <span>Continue with Apple</span>
                        </button>
                        <button type="button" onClick={() => { console.log('Passkey Sign in clicked'); }}
                          className="w-full flex items-center justify-center gap-3 h-11 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-all text-gray-700 font-semibold text-sm">
                          <KeyRound className="w-5 h-5" />
                          <span>Sign in with Passkey</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="mt-4 pt-2 border-t border-gray-100">
                {(mode === "login" || mode === "otp-login" || mode === "register") && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-0 text-center text-gray-500 text-xs flex items-center justify-center gap-2">
                    <span className="text-xs text-gray-500">{mode === "register" ? "Already have an account?" : "Don't have an account?"}</span>
                      <button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setLoginStage("password"); setRegStage("form"); setVerifyCode(""); setError(null); }}
                      className="text-[#0B69A3] hover:text-[#2D8FD6] font-medium text-xs transition-colors">
                      {mode === "register" ? "Sign in" : "Create one now"}
                    </button>
                  </motion.p>
                )}
              </div>
            </Card>
          </motion.div>
        </div>
      </div>

      
    </div>
  );
}
