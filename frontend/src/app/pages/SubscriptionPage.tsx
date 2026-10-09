import { useState, useEffect } from "react";
import { useParams, Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Check, CreditCard, Landmark, ArrowRight, Shield, Zap, Crown, Loader2, CheckCircle2, X, Bitcoin, Wallet, Smartphone } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ThemeToggle } from "../components/ThemeToggle";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { trackEvent, MetaEvents } from "../utils/metaPixel";
import { trackXEvent, XEvents } from "../utils/xPixel";
import { PLANS, planById } from "../data/plans";

const PLAN_ICONS: Record<string, typeof Shield> = { core: Zap, pro: Shield, premium: Crown };

// Checkout reads the same config the marketing pages render, so the amount
// charged can never drift from the advertised price. Legacy slugs
// (e.g. /subscribe/starter) resolve through planById.
const planDetails: Record<string, { name: string; monthlyPrice: number; yearlyPrice: number; icon: typeof Shield; features: string[] }> =
  Object.fromEntries(
    PLANS.map((p) => [p.id, {
      name: p.name,
      monthlyPrice: p.monthlyPrice,
      yearlyPrice: p.yearlyPrice,
      icon: PLAN_ICONS[p.id],
      features: p.highlights,
    }])
  );

// Small brand marks for the Bachs method rows (dependency-free, inline).
function BrandChip({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded px-1 h-4 text-[8px] font-extrabold tracking-tight leading-none ${className}`}>
      {label}
    </span>
  );
}

function MastercardMark() {
  return (
    <span className="inline-flex items-center h-4" aria-label="Mastercard" title="Mastercard">
      <span className="size-4 rounded-full bg-[#EB001B]" />
      <span className="-ml-1.5 size-4 rounded-full bg-[#F79E1B] mix-blend-multiply" />
    </span>
  );
}

export function SubscriptionPage() {
  const { planId } = useParams<{ planId: string }>();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") === "yearly" ? "yearly" : "monthly";
  const [paymentMethod, setPaymentMethod] = useState<"mpesa" | "bachs">("bachs");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [pollStatus, setPollStatus] = useState<"idle" | "waiting" | "success" | "failed">("idle");

  // Handle Crypto, Pesapal & Bachs return redirects
  useEffect(() => {
    const cryptoStatus = searchParams.get("crypto");
    const pesapalStatus = searchParams.get("pesapal");
    const bachsStatus = searchParams.get("bachs") || "";
    const bachsSuccess = bachsStatus.startsWith("success") || Boolean(searchParams.get("checkout_id"));
    const bachsRef = searchParams.get("ref");
    if (cryptoStatus === "success" || pesapalStatus === "success" || bachsSuccess) {
      setIsSuccess(true);
      trackEvent(MetaEvents.Purchase, {
        value: period === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice,
        currency: "USD",
        content_name: selectedPlan.name,
        content_type: "product",
        billing_period: period,
        payment_method: bachsSuccess ? "bachs" : cryptoStatus ? "crypto" : "card",
      });
      trackXEvent(XEvents.Purchase, {
        value: (period === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice).toString(),
        currency: "USD",
        content_name: selectedPlan.name,
      });
      toast.success(`Successfully subscribed to ${selectedPlan.name}!`);
      // Confirm the Bachs session server-side (covers a webhook that lagged or
      // never arrived), then refresh the user while it settles.
      if (bachsRef) {
        fetch(`${import.meta.env.VITE_API_URL || "/api"}/payments/bachs-status?reference=${encodeURIComponent(bachsRef)}`).catch(() => {});
      }
      let attempts = 0;
      const poll = setInterval(() => {
        refreshUser();
        if (++attempts >= 10) clearInterval(poll);
      }, 2000);
    } else if (cryptoStatus === "cancelled" || pesapalStatus === "cancelled" || bachsStatus.startsWith("cancelled")) {
      toast.error("Checkout was cancelled.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire ViewContent when checkout page loads
  useEffect(() => {
    trackEvent(MetaEvents.ViewContent, {
      content_name: selectedPlan.name,
      content_type: "product",
      value: period === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice,
      currency: "USD",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);
  
  const selectedPlan = planDetails[planId?.toLowerCase() || ""] || planDetails[planById(planId).id];
  const PlanIcon = selectedPlan.icon;
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const price = period === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
  const durationMonths = period === "yearly" ? 12 : 1;

  if (!user) {
    return <Navigate to={`/login?redirect=/subscribe/${planId}`} replace />;
  }

  const API_URL = import.meta.env.VITE_API_URL || "/api";

  const handleSubscribe = async () => {
    setIsLoading(true);
    trackEvent(MetaEvents.InitiateCheckout, {
      content_name: selectedPlan.name,
      content_type: "product",
      value: price,
      currency: "USD",
      billing_period: period,
    });

    try {
      if (paymentMethod === "mpesa") {
        const cleanedPhone = phoneNumber.replace(/\+/g, "").trim();
        if (!cleanedPhone.match(/^(?:254|0)(7\d{8}|1\d{8,9})$/)) {
          toast.error("Please enter a valid M-Pesa number (e.g., 254712345678 or 0110123456)");
          setIsLoading(false);
          return;
        }

        const formattedPhone = cleanedPhone.startsWith("0")
          ? "254" + cleanedPhone.slice(1)
          : cleanedPhone;

        const res = await fetch(`${API_URL}/payments/mpesa-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumber: formattedPhone,
            amount: price * 130,
            plan: selectedPlan.name,
            userId: user?.id,
            durationMonths,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.detail?.error_message || data.error || "Payment initiation failed");
        }

        const ref = data.externalReference || data.reference;
        if (!ref) throw new Error("No payment reference returned");

        setPaymentRef(ref);
        toast.success("STK Push sent! Enter your M-Pesa PIN on your phone.");
        setPollStatus("waiting");

        const poll = async () => {
          const MAX_ATTEMPTS = 40;
          for (let i = 0; i < MAX_ATTEMPTS; i++) {
            await new Promise(r => setTimeout(r, 3000));
            try {
              const statusRes = await fetch(`${API_URL}/payments/status?reference=${ref}`);
              const statusData = await statusRes.json();
              const currentStatus = statusData.found ? statusData.status : (statusData.providerSuccess ? 'success' : statusData.providerStatus?.toLowerCase());
              if (currentStatus === "success") {
                setPollStatus("success");
                setIsSuccess(true);
                trackEvent(MetaEvents.Purchase, {
                  value: price,
                  currency: "USD",
                  content_name: selectedPlan.name,
                  content_type: "product",
                  billing_period: period,
                  payment_method: "mpesa",
                });
                trackXEvent(XEvents.Purchase, {
                  value: price.toString(),
                  currency: "USD",
                  content_name: selectedPlan.name,
                });
                toast.success(`Successfully subscribed to ${selectedPlan.name}!`);
                return;
              }
              if (currentStatus === "failed") {
                setPollStatus("failed");
                throw new Error("Payment was declined. Please try again.");
              }
            } catch (pollErr) {
              if (pollErr instanceof Error && pollErr.message.includes("declined")) throw pollErr;
            }
          }
          throw new Error("Payment confirmation timed out. Check your M-Pesa transaction status.");
        };

        await poll();
      } else if (paymentMethod === "bachs") {
        const res = await fetch(`${API_URL}/payments/bachs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: price,
            currency: "USD",
            plan: selectedPlan.name,
            userId: user?.id,
            durationMonths,
            email: user?.email,
            name: user?.full_name,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to create Bachs checkout");
        }

        window.location.href = data.checkoutUrl;
      }
    } catch (error) {
      console.error("Subscription error:", error);
      toast.error(error instanceof Error ? error.message : "An error occurred during checkout. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted pt-24 pb-12">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-xl font-bold text-foreground tracking-tight">StocksIntels</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-10">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Complete your subscription</h1>
          <p className="text-muted-foreground mt-2">
            Secure checkout for the <span className="text-[#0D7490] font-bold">{selectedPlan.name}</span> plan
            <span className="text-muted-foreground"> ({period === "yearly" ? "Yearly" : "Monthly"})</span>
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {isSuccess ? (
            <Card className="md:col-span-3 p-12 text-center border-border animate-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-foreground mb-2">Subscription Confirmed!</h2>
              <p className="text-muted-foreground mb-8">Welcome to the <span className="font-bold text-[#0D7490]">{selectedPlan.name}</span> plan. Your account is now active.</p>
              <Button 
                onClick={async () => { await refreshUser(); navigate("/app/dashboard"); }}
                className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-8 h-12 font-bold shadow-lg shadow-[#0D7490]/20"
              >
                Go to Home
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Card>
          ) : pollStatus === "waiting" || pollStatus === "failed" ? (
            <Card className="md:col-span-3 p-12 text-center border-border">
              {pollStatus === "waiting" ? (
                <>
                  <div className="w-20 h-20 bg-[#0D7490]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Loader2 className="w-12 h-12 text-[#0D7490] animate-spin" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2">Waiting for Payment</h2>
                  <p className="text-muted-foreground mb-2">STK Push sent to your phone. Enter your M-Pesa PIN to complete payment.</p>
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming payment...
                  </div>
                  <p className="text-xs text-muted-foreground mt-6">Reference: {paymentRef}</p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <X className="w-12 h-12 text-red-600" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2">Payment Failed</h2>
                  <p className="text-muted-foreground mb-8">Your payment was declined. Please try again.</p>
                  <Button onClick={() => { setPollStatus("idle"); setIsLoading(false); }} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-8 h-12 font-bold">
                    Try Again
                  </Button>
                </>
              )}
            </Card>
          ) : (
            <>
          {/* Order Summary */}
          <div className="md:col-span-1">
            <Card className="p-6 sticky top-28 border-border">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 shrink-0 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                  <PlanIcon className="w-6 h-6 text-[#0D7490]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-foreground leading-tight">{selectedPlan.name}</h3>
                  <p className="text-xs text-muted-foreground font-medium">{period === "yearly" ? "Yearly Plan" : "Monthly Plan"}</p>
                </div>
              </div>
              
              <div className="border-y border-border py-4 my-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="text-foreground font-bold">${price}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="text-foreground font-bold">$0.00</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 mb-6">
                <span className="font-bold text-foreground">Total</span>
                <span className="text-2xl font-black text-[#0D7490]">${price}</span>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2">Included features:</p>
                {selectedPlan.features.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Checkout Details */}
          <div className="md:col-span-2 space-y-6">
            <Card className="p-8 border-border">
              <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#0D7490]" />
                Payment Method
              </h2>
              
              <div className="grid grid-cols-2 gap-3 mb-8">
                <button
                  onClick={() => setPaymentMethod("bachs")}
                  className={`p-4 border-2 rounded-xl flex flex-col items-center gap-1.5 transition-all ${
                    paymentMethod === "bachs" ? "border-[#0D7490] bg-[#0D7490]/5" : "border-muted hover:border-border"
                  }`}
                >
                  <Wallet className={`w-6 h-6 ${paymentMethod === "bachs" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "bachs" ? "text-[#0D7490]" : "text-muted-foreground"}`}>Bachs</span>
                  <span className="text-[9px] text-muted-foreground text-center leading-tight">Cards · Mobile Money · Crypto</span>
                </button>
                <button
                  onClick={() => setPaymentMethod("mpesa")}
                  className={`p-4 border-2 rounded-xl flex flex-col items-center gap-1.5 transition-all ${
                    paymentMethod === "mpesa" ? "border-[#0D7490] bg-[#0D7490]/5" : "border-muted hover:border-border"
                  }`}
                >
                  <Landmark className={`w-6 h-6 ${paymentMethod === "mpesa" ? "text-[#0D7490]" : "text-muted-foreground"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "mpesa" ? "text-[#0D7490]" : "text-muted-foreground"}`}>M-Pesa</span>
                  <span className="text-[9px] text-muted-foreground text-center leading-tight">PayHero STK push</span>
                </button>
              </div>

              <div className="space-y-4">
                {paymentMethod === "mpesa" ? (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div>
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1.5">M-Pesa Phone Number</label>
                      <input 
                        className="w-full px-4 h-12 bg-muted border border-border rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-foreground" 
                        placeholder="254700000000" 
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                      />
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                      <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                        1. You will receive an M-Pesa STK push on your phone.<br />
                        2. Enter your M-Pesa PIN to authorize the payment.<br />
                        3. Your subscription will be activated instantly upon confirmation.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
                      <p className="text-[11px] text-teal-800 leading-relaxed font-medium mb-3">
                        You'll be redirected to the Bachs secure checkout and can pay with any of these:
                      </p>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/70 border border-teal-100 p-3">
                          <div className="size-9 rounded-lg bg-[#0D7490]/10 flex items-center justify-center shrink-0">
                            <CreditCard className="size-4 text-[#0D7490]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-teal-900">Card</p>
                            <p className="text-[11px] text-teal-700">Visa, Mastercard &amp; more</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <BrandChip label="VISA" className="bg-[#1A1F71] text-white" />
                            <MastercardMark />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/70 border border-teal-100 p-3">
                          <div className="size-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                            <Smartphone className="size-4 text-emerald-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-teal-900">Mobile Money</p>
                            <p className="text-[11px] text-teal-700">M-Pesa, Airtel Money &amp; more</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <BrandChip label="M-PESA" className="bg-[#43B02A] text-white" />
                            <BrandChip label="Airtel" className="bg-[#E40000] text-white" />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white/70 border border-teal-100 p-3">
                          <div className="size-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                            <Bitcoin className="size-4 text-amber-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-teal-900">Crypto</p>
                            <p className="text-[11px] text-teal-700">USDT, USDC, ETH, SOL &amp; BNB</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 shrink-0">
                            <span className="inline-flex items-center justify-center size-4 rounded-full bg-[#26A17B] text-white text-[9px] font-bold leading-none" title="Tether">₮</span>
                            <span className="inline-flex items-center justify-center size-4 rounded-full bg-[#2775CA] text-white text-[9px] font-bold leading-none" title="USD Coin">$</span>
                            <BrandChip label="ETH" className="bg-[#627EEA] text-white" />
                            <BrandChip label="SOL" className="bg-black text-white" />
                            <BrandChip label="BNB" className="bg-[#F3BA2F] text-black" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
                      <p className="text-[11px] text-teal-800 leading-relaxed font-medium">
                        After you subscribe, your account activates automatically once the payment is confirmed.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Button 
                className="w-full mt-8 bg-[#0D7490] hover:bg-[#0A5F7A] text-white h-14 text-base font-bold shadow-lg shadow-[#0D7490]/25 transition-all active:scale-[0.98]"
                onClick={handleSubscribe}
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </span>
                ) : (
                  <>
                    Subscribe Now
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </>
                )}
              </Button>
              
              <p className="text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-6">
                Secure 256-bit SSL Encrypted Checkout
              </p>
            </Card>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}