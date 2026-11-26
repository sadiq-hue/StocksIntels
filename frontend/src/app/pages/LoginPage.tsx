import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight,
  AlertCircle, CheckCircle2, Loader2, User, KeyRound, Cpu, Globe2, FileText,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card } from "../components/ui/card";
import { jwtDecode } from "jwt-decode";
import { useAuth } from "../auth/AuthContext";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSEO } from "../hooks/useSEO";
import { useTurnstile } from "../hooks/useTurnstile";
import { trackEvent, MetaEvents } from "../utils/metaPixel";
import { trackXEvent, XEvents } from "../utils/xPixel";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getBrowserCoords(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, enableHighAccuracy: false }
    );
  });
}

type DecodedToken = { sub: string; name: string; email: string; picture: string };
type AuthMode = "login" | "register" | "forgot" | "reset" | "otp-login";
type RegStage = "form" | "verify";
type OtpStage = "send" | "verify";

function CompactHero() {
  return (
    <div className="mb-6 text-center">
      <div className="flex items-center justify-center gap-3">
        <img src="/logo1.jpg" alt="StocksIntels" className="size-10 rounded-xl shadow-lg shadow-black/10 ring-1 ring-white/20" />
        <h1 className="text-[#102B50] text-xl font-bold tracking-tight">StocksIntels</h1>
      </div>
      <p className="text-[#607187] text-xs mt-2">Financial Intelligence. Elevated.</p>
    </div>
  );
}
export function LoginPage() {
  useSEO({
    title: "StocksIntels Login | Access Your Research Workspace",
    absoluteTitle: true,
    description: "Log in to StocksIntels to access financial market intelligence, company financials, investment insights, portfolio tools and research across African and global markets.",
    canonical: "/login",
  });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/app";
  const refParam = searchParams.get("ref") || undefined;
  const { login, register, sendVerificationCode, verifyEmailAndRegister, forgotPassword, resetPassword, sendOtp, verifyOtp } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [regStage, setRegStage] = useState<RegStage>("form");
  const [otpStage, setOtpStage] = useState<OtpStage>("send");
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
  const [country, setCountry] = useState("");
  const [countries, setCountries] = useState<{ code: string; name: string; flag: string }[]>([]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const { containerRef: turnstileRef, token: turnstileToken, reset: resetTurnstile, enabled: turnstileEnabled, unavailable: turnstileUnavailable } = useTurnstile();

  useEffect(() => {
    fetch("/api/countries")
      .then(r => r.json())
      .then((data: { code: string; name: string; flag: string }[]) => setCountries(data))
      .catch(() => {});
  }, []);

  const filteredCountries = countries.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );
  const selectedCountry = countries.find(c => c.name === country);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    if (!countryOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-country-dropdown]')) setCountryOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [countryOpen]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); clear();
    if (mode === "login") {
      if (!email || !password) { setError("Email and password are required"); return; }
      setIsLoading(true);
      try {
        await login(email, password, turnstileToken);
        navigate(redirectTo);
      } catch (err) { setError(err instanceof Error ? err.message : "Sign in failed"); }
      finally { setIsLoading(false); }
    } else if (mode === "register") {
      if (regStage === "form") {
        const emailTrimmed = email.trim();
        if (!emailTrimmed) { setError("Email is required"); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError("Invalid email format"); return; }
        setIsLoading(true);
        try {
          const res = await sendVerificationCode(emailTrimmed, turnstileToken);
          setCountdown(res.expiresIn);
          setSuccess("Verification code sent to your email");
          setRegStage("verify");
          resetTurnstile();
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to send verification code"); }
        finally { setIsLoading(false); }
      } else {
        if (!verifyCode || verifyCode.length < 6) { setError("Enter the 6-digit verification code"); return; }
        if (!fullName.trim()) { setError("Full name is required"); return; }
        if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
        if (password !== confirmPassword) { setError("Passwords do not match"); return; }
        const emailTrimmed = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError("Invalid email format"); return; }
        setIsLoading(true);
        // Try browser geolocation for accurate location
        const coords = await getBrowserCoords();
        try {
          await verifyEmailAndRegister(fullName.trim(), emailTrimmed, password, verifyCode, refParam, coords?.lat, coords?.lng, country || undefined, turnstileToken);
          trackEvent(MetaEvents.CompleteRegistration, { method: "email" });
          trackXEvent(XEvents.Signup, { method: "email" });
          navigate(redirectTo);
        } catch (err) { setError(err instanceof Error ? err.message : "Verification or registration failed"); }
        finally { setIsLoading(false); }
      }
    } else if (mode === "otp-login") {
      if (otpStage === "send") {
        const emailTrimmed = email.trim();
        if (!emailTrimmed) { setError("Email is required"); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError("Invalid email format"); return; }
        setIsLoading(true);
        try {
          const res = await sendOtp(emailTrimmed, turnstileToken);
          setCountdown(res.expiresIn);
          setSuccess("OTP sent to your email");
          setOtpStage("verify");
          resetTurnstile();
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to send OTP"); }
        finally { setIsLoading(false); }
      } else {
        if (!otpCode || otpCode.length < 6) { setError("Enter the 6-digit OTP"); return; }
        const emailTrimmed = email.trim();
        setIsLoading(true);
        try {
          await verifyOtp(emailTrimmed, otpCode);
          navigate(redirectTo);
        } catch (err) { setError(err instanceof Error ? err.message : "OTP verification failed"); }
        finally { setIsLoading(false); }
      }
    } else if (mode === "forgot") {
      const emailTrimmed = email.trim();
      if (!emailTrimmed) { setError("Email is required"); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError("Invalid email format"); return; }
      setIsLoading(true);
      try {
        const res = await forgotPassword(emailTrimmed, turnstileToken);
        setCountdown(res.expiresIn);
        setSuccess("Check your email for the reset code");
        setMode("reset");
        resetTurnstile();
      } catch (err) { setError(err instanceof Error ? err.message : "Failed to send reset code"); }
      finally { setIsLoading(false); }
    } else if (mode === "reset") {
      if (!otpCode || otpCode.length < 6) { setError("Enter the 6-digit reset code"); return; }
      if (!newPassword || newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
      const emailTrimmed = email.trim();
      setIsLoading(true);
      try {
        await resetPassword(emailTrimmed, otpCode, newPassword);
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
        const coords = await getBrowserCoords();
        try { await register(decoded.name, decoded.email, "google_oauth_" + decoded.sub, refParam, coords?.lat, coords?.lng); trackEvent(MetaEvents.CompleteRegistration, { method: "google" }); trackXEvent(XEvents.Signup, { method: "google" }); }
        catch { setError("Account exists. Try logging in with email/password."); setIsLoading(false); return; }
      }
      setIsLoading(false); navigate(redirectTo);
    }
  }, [navigate, login, register, redirectTo]);

  const handleGoogleError = useCallback(() => {
    setError("Google sign-in failed. Please try email sign-in or contact support.");
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
    "pl-10 pr-3 h-11 bg-[#F8FAFC] border text-[#102B50] rounded-xl transition-all duration-200",
    "placeholder:text-[#8A98A9]",
    "border-[#D4DFEA]",
    focusedField === fieldName
      ? "border-[#4386C8] bg-white shadow-md shadow-[#4386C8]/10"
      : "hover:border-[#9EB6D0]",
    error && "border-red-300 focus:border-red-500 focus:ring-red-500/10"
  );

  return (
    <div className="si-landing grid min-h-screen bg-[#F5F8FC] text-[#202B3A] lg:grid-cols-[minmax(0,1fr)_560px]">
      <aside className="relative hidden overflow-hidden bg-[#102B50] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="si-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative">
          <Link to="/" className="flex items-center gap-3"><img src="/logo1.jpg" alt="" className="size-10 rounded-lg object-cover" /><div><span className="block text-sm font-extrabold">StocksIntels</span><span className="text-[8px] font-bold uppercase tracking-[0.22em] text-cyan-200">Financial Intelligence</span></div></Link>
        </div>
        <div className="relative max-w-2xl py-16">
          <span className="grid size-12 place-items-center rounded-full border border-[#D5A64A]/40 bg-[#D5A64A]/10 font-mono text-xs font-bold text-[#E1BE72]">SI</span>
          <h2 className="si-display mt-8 text-5xl leading-[1.02] tracking-[-0.04em] xl:text-6xl">Research the market beyond a single signal.</h2>
          <p className="mt-6 max-w-xl text-sm leading-7 text-slate-300">Access company financials, technical evidence, macro context, news intelligence and portfolio tools across African and global markets.</p>
          <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
            {[
              { icon: FileText, label: "Multi-dimensional company research" },
              { icon: Globe2, label: "African relevance with global context" },
              { icon: Cpu, label: "Technology designed to support judgement" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-4 py-4 text-sm text-slate-200"><Icon className="size-4 text-cyan-300" />{label}</div>
            ))}
          </div>
        </div>
        <p className="relative max-w-xl text-[11px] leading-5 text-slate-500">StocksIntels provides research and analytics for informational purposes. Market data may be delayed and investing involves risk.</p>
      </aside>

      <main className="relative flex min-h-screen items-center justify-center px-4 py-14 sm:px-8 lg:px-12">
        <Link to="/" className="absolute left-5 top-5 text-xs font-semibold text-[#52647A] hover:text-[#174A7E] sm:left-8 sm:top-7">Back to site</Link>
        <div className="w-full max-w-[420px] relative z-10">
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
            <div className="lg:hidden"><CompactHero /></div>
            <Card className="rounded-[24px] border border-[#D5E0EB] bg-white p-6 shadow-[0_28px_70px_-50px_rgba(16,43,80,0.7)] sm:p-7">
              
              <div className="mb-6">
                <h2 className="text-foreground text-xl font-bold tracking-tight mb-1.5">
                  {mode === "login" ? "Access your research workspace" : mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : mode === "otp-login" ? "Sign in with an email code" : "Set a new password"}
                </h2>
                <p className="text-muted-foreground/70 text-sm leading-relaxed">
                  {mode === "login"
                    ? "Sign in to your StocksIntels financial intelligence workspace."
                    : mode === "register"
                    ? "Begin with your email, then verify and complete your profile."
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
                    <p className="text-red-700 text-sm font-medium min-w-0">{error}</p>
                  </motion.div>
                )}
                {success && (
                  <motion.div key="ok" initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -10, height: 0 }}
                    className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <p className="text-emerald-700 text-sm font-medium min-w-0">{success}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-4">
                {turnstileEnabled && (
                  <div className="flex flex-col items-center gap-1">
                    <div ref={turnstileRef} />
                    {!turnstileToken && (
                      <p className="text-[11px] text-muted-foreground/70">
                        {turnstileUnavailable ? "Security check unavailable — continuing without it" : "Complete the security check to enable Sign In"}
                      </p>
                    )}
                  </div>
                )}
                {(mode === "login" || mode === "register") && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                        <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                          className={inputClasses("email")} required autoComplete="email" disabled={mode === "register" && regStage === "verify"} />
                      </div>
                    </div>
                    {mode === "login" && (
                      <>
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 ml-1">
                            <label className="text-muted-foreground text-sm font-semibold">Password</label>
                            <button type="button" onClick={() => { setMode("forgot"); clear(); }}
                              className="text-xs text-[#0D7490] hover:text-[#14A9B9] font-semibold hover:underline">
                              Forgot password?
                            </button>
                          </div>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "password" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                            <Input type={showPassword ? "text" : "password"} placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)}
                              onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("password"), "pr-8 h-10")} required autoComplete="current-password" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <Button type="submit" disabled={isLoading || !email || !password || (turnstileEnabled && !turnstileToken && !turnstileUnavailable)}
                          className="w-full h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                          {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Signing in...</span>
                            : <span className="flex items-center gap-2">Sign In <ArrowRight className="w-4 h-4" /></span>}
                        </Button>
                        <button type="button" onClick={() => { setMode("otp-login"); setOtpStage("send"); clear(); }}
                          className="w-full text-center text-xs text-[#0D7490] hover:text-[#14A9B9] font-semibold">
                          <KeyRound className="inline w-3.5 h-3.5 mr-1 -mt-0.5" /> Sign in with email code
                        </button>
                      </>
                    )}
                    {mode === "register" && regStage === "form" && (
                      <Button type="submit" disabled={isLoading || !email || (turnstileEnabled && !turnstileToken && !turnstileUnavailable)}
                        className="w-full h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                        {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                          : <span className="flex items-center gap-2">Send Verification Code <ArrowRight className="w-4 h-4" /></span>}
                      </Button>
                    )}
                    {mode === "register" && regStage === "verify" && (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Verification Code</label>
                          <div className="relative">
                            <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "vcode" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                            <Input type="text" placeholder="000000" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              onFocus={() => setFocusedField("vcode")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("vcode"), "text-center text-xl sm:text-2xl tracking-[0.3em] sm:tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                          </div>
                          {countdown > 0 && <p className="text-xs text-muted-foreground text-center mt-1">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Full Name</label>
                          <div className="relative">
                            <User className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "name" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                            <Input type="text" placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)}
                              onFocus={() => setFocusedField("name")} onBlur={() => setFocusedField(null)}
                              className={inputClasses("name")} required />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Country</label>
                          <div className="relative" data-country-dropdown>
                            <button type="button" onClick={() => { setCountryOpen(!countryOpen); setCountrySearch(""); }}
                              className={cn(inputClasses("country"), "h-10 w-full text-left flex items-center gap-2 pr-3 cursor-pointer")}>
                              {selectedCountry ? (
                                <>
                                  <img src={`https://flagcdn.com/24x18/${selectedCountry.code.toLowerCase()}.png`} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
                                  <span>{selectedCountry.name}</span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">Select your country</span>
                              )}
                              <svg className={`w-4 h-4 ml-auto text-muted-foreground transition-transform ${countryOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {countryOpen && (
                              <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-lg max-h-60 overflow-hidden">
                                <div className="sticky top-0 bg-card p-2 border-b border-border">
                                  <input type="text" placeholder="Search..." value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)}
                                    className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:border-[#0D7490]" autoFocus />
                                </div>
                                <div className="overflow-y-auto max-h-48">
                                  {filteredCountries.map((c) => (
                                    <button key={c.code} type="button"
                                      onClick={() => { setCountry(c.name); setCountryOpen(false); setCountrySearch(""); }}
                                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-muted ${country === c.name ? 'bg-[#0D7490]/5 text-[#0D7490] font-medium' : ''}`}>
                                      <img src={`https://flagcdn.com/24x18/${c.code.toLowerCase()}.png`} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
                                      <span>{c.name}</span>
                                    </button>
                                  ))}
                                  {filteredCountries.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No countries found</p>}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Password</label>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "password" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                            <Input type={showPassword ? "text" : "password"} placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)}
                              onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("password"), "pr-8 h-10")} required minLength={8} autoComplete="new-password" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Confirm Password</label>
                          <div className="relative">
                            <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "cpw" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                            <Input type={showConfirmPw ? "text" : "password"} placeholder="********" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                              onFocus={() => setFocusedField("cpw")} onBlur={() => setFocusedField(null)}
                              className={cn(inputClasses("cpw"), "pr-8 h-10")} required minLength={8} autoComplete="new-password" />
                            <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                              {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {confirmPassword && password !== confirmPassword && (
                            <p className="text-xs text-red-500 mt-0.5">Passwords do not match</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setRegStage("form"); setVerifyCode(""); setError(null); }}
                            className="w-full sm:w-1/3 h-10 text-sm text-muted-foreground hover:text-[#0D7490] font-semibold border border-border rounded-xl hover:bg-muted transition-all">
                            Back
                          </button>
                          <Button type="submit" disabled={isLoading || verifyCode.length < 6 || !fullName.trim() || password.length < 8 || password !== confirmPassword}
                            className="flex-1 h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                            {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Creating account...</span>
                              : <span className="flex items-center gap-2">Create Account <ArrowRight className="w-4 h-4" /></span>}
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}

                {mode === "otp-login" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Email Address</label>
                      <div className="relative">
                        <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                        <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                          className={inputClasses("email")} required autoComplete="email" disabled={otpStage === "verify"} />
                      </div>
                    </div>
                    {otpStage === "verify" && (
                      <div className="space-y-1.5">
                        <label className="text-muted-foreground/70 text-xs font-medium block ml-1">One-Time Password</label>
                        <div className="relative">
                          <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "otpCode" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                          <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                            onFocus={() => setFocusedField("otpCode")} onBlur={() => setFocusedField(null)}
                            className={cn(inputClasses("otpCode"), "text-center text-xl sm:text-2xl tracking-[0.3em] sm:tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                        </div>
                        {countdown > 0 && <p className="text-xs text-muted-foreground text-center mt-1">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                      </div>
                    )}
                    <Button type="submit" disabled={isLoading || (otpStage === "send" ? !email || (turnstileEnabled && !turnstileToken && !turnstileUnavailable) : otpCode.length < 6)}
                      className="w-full h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all duration-200 disabled:opacity-70 text-sm">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                        : otpStage === "send" ? <span className="flex items-center gap-2">Send OTP <ArrowRight className="w-4 h-4" /></span>
                        : <span className="flex items-center gap-2">Verify & Sign In <ArrowRight className="w-4 h-4" /></span>}
                    </Button>
                  </>
                )}

                {(mode === "forgot") && (
                  <div className="space-y-1.5">
                    <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "email" ? "text-[#AEB7C2]" : "text-muted-foreground"}`} />
                      <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                        className={inputClasses("email")} required autoComplete="email" />
                    </div>
                    <Button type="submit" disabled={isLoading}
                      className="w-full mt-3 h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all disabled:opacity-70 text-sm">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Sending...</span>
                        : <span className="flex items-center gap-2">Send Reset Code <ArrowRight className="w-4 h-4" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("login"); clear(); }}
                      className="w-full text-sm text-[#AEB7C2] hover:text-[#0D7490] font-semibold text-center">
                      Back to sign in
                    </button>
                  </div>
                )}

                {(mode === "reset") && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-muted-foreground/70 text-xs font-medium block ml-1">Reset Code</label>
                      <div className="relative">
                        <KeyRound className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "code" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                        <Input type="text" placeholder="000000" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onFocus={() => setFocusedField("code")} onBlur={() => setFocusedField(null)}
                          className={cn(inputClasses("code"), "text-center text-xl sm:text-2xl tracking-[0.3em] sm:tracking-[0.5em] font-mono font-bold")} maxLength={6} required />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-muted-foreground/70 text-xs font-medium block ml-1">New Password</label>
                      <div className="relative">
                        <Lock className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${focusedField === "pw" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                          <Input type={showPassword ? "text" : "password"} placeholder="********" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                            onFocus={() => setFocusedField("pw")} onBlur={() => setFocusedField(null)}
                            className={cn(inputClasses("pw"), "pr-8 h-10")} required minLength={6} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-1 rounded-lg hover:bg-accent">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {countdown > 0 && <p className="text-xs text-muted-foreground text-center">Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}</p>}
                    <Button type="submit" disabled={isLoading || otpCode.length < 6 || newPassword.length < 6}
                      className="w-full h-10 bg-[#2563A6] hover:bg-[#174A7E] text-white font-semibold rounded-xl shadow transition-all disabled:opacity-70 text-sm">
                      {isLoading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Resetting...</span>
                        : <span className="flex items-center gap-2">Reset Password <ArrowRight className="w-4 h-4" /></span>}
                    </Button>
                    <button type="button" onClick={() => { setMode("forgot"); setOtpCode(""); setNewPassword(""); clear(); }}
                      className="w-full text-sm text-[#AEB7C2] hover:text-[#0D7490] font-semibold text-center">
                      Resend code
                    </button>
                  </>
                )}
              </form>



              {(mode === "login" || mode === "register") && (
                <>
                  <div className="flex items-center my-5">
                    <div className="flex-1 h-px bg-[#DCE5EF]" />
                    <span className="px-3 text-[11px] text-muted-foreground/50 font-medium uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-[#DCE5EF]" />
                  </div>
                  <div className="relative">
                    <button type="button" onClick={() => setSocialOpen(!socialOpen)}
                      className="w-full flex items-center justify-between gap-2 h-11 px-4 bg-[#F8FAFC] border border-[#D4DFEA] rounded-xl text-sm font-medium text-[#52647A] hover:text-[#102B50] transition-colors">
                      <span>More sign-in options</span>
                      <svg className={`w-4 h-4 transition-transform ${socialOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {socialOpen && (
                      <div className="mt-2 space-y-2">
                        <button type="button" onClick={() => loginWithGoogle()}
                          className="w-full flex items-center justify-center gap-3 h-11 bg-[#F8FAFC] border border-[#D4DFEA] rounded-xl transition-all hover:bg-white text-[#102B50] font-medium text-sm">
                          <svg className="w-5 h-5" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg"><path d="M533.5 278.4c0-18.5-1.5-37.3-4.7-55.1H272v104.5h146.9c-6.3 33.8-25.5 62.5-54.3 81.6v67.8h87.7c51.3-47.3 81.2-116.9 81.2-198.8z" fill="#4285F4"/><path d="M272 544.3c73.5 0 135.3-24.1 180.4-65.4l-87.7-67.8c-24.4 16.4-55.7 26.1-92.7 26.1-71 0-131.3-48-152.8-112.5H31.8v70.5C76.9 494.9 168.2 544.3 272 544.3z" fill="#34A853"/><path d="M119.2 323.7c-11.9-35.3-11.9-73.1 0-108.4V144.8H31.8C11.3 190.9 0 233.6 0 278.4s11.3 87.5 31.8 133.6l87.4-88.3z" fill="#FBBC05"/><path d="M272 109.7c39.9-.6 78.2 14 107.4 40.3l80.5-80.5C404.7 24.5 345.5 0 272 0 168.2 0 76.9 49.4 31.8 144.8l87.4 70.5C140.7 157.7 201 109.7 272 109.7z" fill="#EA4335"/></svg>
                          <span>Sign in with Google</span>
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="mt-5 pt-4 border-t border-[#DCE5EF]">
                {(mode === "login" || mode === "otp-login" || mode === "register") && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="text-center text-muted-foreground/60 text-xs flex items-center justify-center gap-2">
                    <span>{mode === "register" ? "Already have an account?" : "Don't have an account?"}</span>
                      <button type="button" onClick={() => { setMode(mode === "register" ? "login" : "register"); setRegStage("form"); setVerifyCode(""); setError(null); }}
                      className="text-[#0D7490] hover:text-[#14A9B9] font-semibold text-xs transition-colors">
                      {mode === "register" ? "Sign in" : "Create one"}
                    </button>
                  </motion.p>
                )}
              </div>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
