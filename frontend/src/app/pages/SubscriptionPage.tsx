import { useState, useEffect } from "react";
import { useParams, Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Check, CreditCard, Landmark, ArrowRight, Shield, Zap, Crown, Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";

const planDetails = {
  starter: {
    name: "Starter",
    monthlyPrice: 10,
    yearlyPrice: 99.99,
    icon: Zap,
    features: ["Real-time African + global data", "5 AI signals per day", "Stock screener", "Portfolio tracking", "Email support"],
  },
  premium: {
    name: "Premium",
    monthlyPrice: 49,
    yearlyPrice: 499,
    icon: Shield,
    features: ["Unlimited NSE AI signals", "10 global signals per day", "African + global market data", "Advanced NSE screener", "NSE technical analysis", "Email support"],
  },
  pro: {
    name: "Pro",
    monthlyPrice: 20,
    yearlyPrice: 199,
    icon: Shield,
    features: ["Unlimited AI signals", "All African + global market data", "Advanced charting", "Risk scoring & analysis", "Priority support"],
  },
  institutional: {
    name: "Institutional",
    monthlyPrice: 200,
    yearlyPrice: 2000,
    icon: Crown,
    features: ["API access", "White-label analytics", "Dedicated support 24/7", "Team seats", "Custom data feeds", "Everything in Pro"],
  },
};

export function SubscriptionPage() {
  const { planId } = useParams<{ planId: string }>();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") === "yearly" ? "yearly" : "monthly";
  const [paymentMethod, setPaymentMethod] = useState<"paypal" | "mpesa">("paypal");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [pollStatus, setPollStatus] = useState<"idle" | "waiting" | "success" | "failed">("idle");

  // Handle PayPal return redirect
  useEffect(() => {
    const paypalStatus = searchParams.get("paypal");
    if (paypalStatus === "success") {
      setIsSuccess(true);
      refreshUser().then(() => {});
      toast.success(`Successfully subscribed to ${selectedPlan.name}!`);
    } else if (paypalStatus === "failed" || paypalStatus === "cancelled") {
      toast.error(paypalStatus === "cancelled" ? "PayPal checkout was cancelled." : "Payment failed. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const selectedPlan = planDetails[planId?.toLowerCase() as keyof typeof planDetails] || planDetails.starter;
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
      } else {
        const res = await fetch(`${API_URL}/payments/paypal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: price * 130,
            plan: selectedPlan.name,
            userId: user?.id,
            durationMonths,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to create PayPal checkout");
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
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">StocksIntels</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-10">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Complete your subscription</h1>
          <p className="text-gray-600 mt-2">
            Secure checkout for the <span className="text-[#0D7490] font-bold">{selectedPlan.name}</span> plan
            <span className="text-gray-500"> ({period === "yearly" ? "Yearly" : "Monthly"})</span>
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {isSuccess ? (
            <Card className="md:col-span-3 p-12 text-center border-gray-100 animate-in zoom-in-95 duration-500">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-gray-900 mb-2">Subscription Confirmed!</h2>
              <p className="text-gray-600 mb-8">Welcome to the <span className="font-bold text-[#0D7490]">{selectedPlan.name}</span> plan. Your account is now active.</p>
              <Button 
                onClick={async () => { await refreshUser(); navigate("/app/dashboard"); }}
                className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-8 h-12 font-bold shadow-lg shadow-[#0D7490]/20"
              >
                Go to Dashboard
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Card>
          ) : pollStatus === "waiting" || pollStatus === "failed" ? (
            <Card className="md:col-span-3 p-12 text-center border-gray-100">
              {pollStatus === "waiting" ? (
                <>
                  <div className="w-20 h-20 bg-[#0D7490]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Loader2 className="w-12 h-12 text-[#0D7490] animate-spin" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">Waiting for Payment</h2>
                  <p className="text-gray-500 mb-2">STK Push sent to your phone. Enter your M-Pesa PIN to complete payment.</p>
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming payment...
                  </div>
                  <p className="text-xs text-gray-400 mt-6">Reference: {paymentRef}</p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <X className="w-12 h-12 text-red-600" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">Payment Failed</h2>
                  <p className="text-gray-500 mb-8">Your payment was declined. Please try again.</p>
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
            <Card className="p-6 sticky top-28 border-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 shrink-0 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                  <PlanIcon className="w-6 h-6 text-[#0D7490]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900 leading-tight">{selectedPlan.name}</h3>
                  <p className="text-xs text-gray-500 font-medium">{period === "yearly" ? "Yearly Plan" : "Monthly Plan"}</p>
                </div>
              </div>
              
              <div className="border-y border-gray-100 py-4 my-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900 font-bold">${price}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tax</span>
                  <span className="text-gray-900 font-bold">$0.00</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 mb-6">
                <span className="font-bold text-gray-900">Total</span>
                <span className="text-2xl font-black text-[#0D7490]">${price}</span>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">Included features:</p>
                {selectedPlan.features.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-xs text-gray-600">
                    <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Checkout Details */}
          <div className="md:col-span-2 space-y-6">
            <Card className="p-8 border-gray-100">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#0D7490]" />
                Payment Method
              </h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                <button
                  onClick={() => setPaymentMethod("paypal")}
                  className={`p-4 border-2 rounded-xl flex flex-col items-center gap-2 transition-all ${
                    paymentMethod === "paypal" ? "border-[#0D7490] bg-[#0D7490]/5" : "border-gray-50 hover:border-gray-200"
                  }`}
                >
                  <CreditCard className={`w-6 h-6 ${paymentMethod === "paypal" ? "text-[#0D7490]" : "text-gray-400"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "paypal" ? "text-[#0D7490]" : "text-gray-600"}`}>PayPal</span>
                </button>
                <button
                  onClick={() => setPaymentMethod("mpesa")}
                  className={`p-4 border-2 rounded-xl flex flex-col items-center gap-2 transition-all ${
                    paymentMethod === "mpesa" ? "border-[#0D7490] bg-[#0D7490]/5" : "border-gray-50 hover:border-gray-200"
                  }`}
                >
                  <Landmark className={`w-6 h-6 ${paymentMethod === "mpesa" ? "text-[#0D7490]" : "text-gray-400"}`} />
                  <span className={`text-sm font-bold ${paymentMethod === "mpesa" ? "text-[#0D7490]" : "text-gray-600"}`}>M-Pesa</span>
                </button>
              </div>

              <div className="space-y-4">
                {paymentMethod === "paypal" ? (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-[11px] text-blue-800 leading-relaxed font-medium">
                        1. You will be redirected to PayPal&apos;s secure checkout.<br />
                        2. Log in or pay with your card via PayPal.<br />
                        3. Your subscription activates instantly upon confirmation.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1.5">M-Pesa Phone Number</label>
                      <input 
                        className="w-full px-4 h-12 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-gray-900" 
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
              
              <p className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-6">
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