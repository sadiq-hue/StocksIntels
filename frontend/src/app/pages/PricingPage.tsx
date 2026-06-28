import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { 
  Check, 
  X, 
  Zap, 
  Shield, 
  Crown,
  ArrowRight,
  HelpCircle,
  Loader2
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useAuth, getTrialInfo } from "../auth/AuthContext";
import { toast } from "sonner";

const plans = [
  {
    name: "Starter",
    description: "For retail investors",
    monthlyPrice: 9.9,
    yearlyPrice: 99,
    icon: Zap,
    popular: false,
    features: [
      { text: "Real-time African + global data", included: true },
      { text: "5 AI signals per day", included: true },
      { text: "Stock screener", included: true },
      { text: "Portfolio tracking", included: true },
      { text: "Email support", included: true },
      { text: "Advanced charting", included: false },
      { text: "Risk analysis tools", included: false },
      { text: "Unlimited signals", included: false },
    ],
    cta: "Start 7-Day Trial",
    ctaVariant: "default" as const,
  },
  {
    name: "Pro",
    description: "For active traders",
    monthlyPrice: 19.9,
    yearlyPrice: 199,
    icon: Shield,
    popular: true,
    features: [
      { text: "Unlimited AI signals", included: true },
      { text: "All African + global market data", included: true },
      { text: "Advanced charting", included: true },
      { text: "Risk scoring & analysis", included: true },
      { text: "Priority support", included: true },
      { text: "Stock screener", included: true },
      { text: "API access", included: false },
      { text: "White-label analytics", included: false },
    ],
    cta: "Start 7-Day Trial",
    ctaVariant: "default" as const,
  },
  {
    name: "Premium",
    description: "For NSE-focused traders",
    monthlyPrice: 49.9,
    yearlyPrice: 499,
    icon: Shield,
    popular: false,
    features: [
      { text: "Unlimited NSE AI signals", included: true },
      { text: "10 global signals per day", included: true },
      { text: "African + global market data", included: true },
      { text: "Advanced NSE screener", included: true },
      { text: "NSE technical analysis", included: true },
      { text: "Email support", included: true },
      { text: "Advanced charting", included: false },
      { text: "Risk scoring", included: false },
    ],
    cta: "Start 7-Day Trial",
    ctaVariant: "outline" as const,
  },
];

const faqs = [
  {
    question: "Can I switch plans anytime?",
    answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.",
  },
  {
    question: "Is there a free trial for paid plans?",
    answer: "Yes! Start your 7-day trial — you'll get full access to your chosen plan for 7 days.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept M-Pesa (KES) for African users and credit/debit cards (USD) for global users.",
  },
  {
    question: "How does M-Pesa pricing work?",
    answer: "M-Pesa amounts are in KES: Starter 1,299 KES/mo, Pro 2,599 KES/mo, Premium 6,499 KES/mo. You'll receive an STK push on your phone to confirm.",
  },
  {
    question: "What's the difference between Premium and Pro?",
    answer: "Premium is built for NSE-focused traders — unlimited NSE signals + 10 global signals/day, NSE advanced screener and technical analysis. Pro gives you unlimited everything across all markets plus advanced charting, risk scoring, and priority support.",
  },
  {
    question: "Can I cancel my subscription?",
    answer: "You can cancel anytime from your account settings. You'll retain access until the end of your current billing period.",
  },
];

export function PricingPage() {
  const navigate = useNavigate();
  const { user, apiFetch, updateUser, isLoading } = useAuth();
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [startingTrial, setStartingTrial] = useState<string | null>(null);
  const [payingCommitment, setPayingCommitment] = useState(false);
  const trialInfo = getTrialInfo(user);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0D7490]" />
      </div>
    );
  }

  const handlePayCommitment = async () => {
    if (!user) { navigate('/login?redirect=/pricing'); return; }
    setPayingCommitment(true);
    try {
      const res = await apiFetch('/payments/commitment-fee', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process commitment fee');
      updateUser({ ...user, commitment_fee_paid: true });
      toast.success('Commitment fee paid! Now start your trial.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to process commitment fee');
    } finally {
      setPayingCommitment(false);
    }
  };

  const handleTrialClick = async (planName: string) => {
    if (!user) {
      navigate(`/login?redirect=/pricing`);
      return;
    }
    // TODO: Enable $1 commitment fee post-MVP
    // Check if commitment fee has been paid
    // if (!(user as any).commitment_fee_paid) {
    //   try {
    //     const res = await apiFetch('/payments/commitment-fee', { method: 'POST' });
    //     const data = await res.json();
    //     if (!res.ok) throw new Error(data.error || 'Failed');
    //     updateUser({ ...user, commitment_fee_paid: true });
    //   } catch (error) {
    //     toast.error('Please pay the $1 commitment fee to start your trial.');
    //     return;
    //   }
    // }
    setStartingTrial(planName);
    try {
      const res = await apiFetch(`/payments/start-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start trial");
      updateUser(data.user);
      toast.success(`7-day trial started!`);
      navigate("/app/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start trial");
    } finally {
      setStartingTrial(null);
    }
  };

  const handlePlanClick = async (planName: string) => {
    if (!user) {
      navigate(`/login?redirect=/pricing`);
      return;
    }
    // Start trial
    if (trialInfo.isWithinTrial) {
      navigate(`/subscribe/${planName.toLowerCase()}`);
      return;
    }
    handleTrialClick(planName);
  };

  return (
    <div className="min-h-screen bg-white">
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
            <Link to="/login">
              <Button variant="ghost" className="text-gray-600 hover:text-[#0D7490]">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Pricing</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-10">
            Choose the plan that fits your trading style. All plans include a 7-day free trial.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 bg-gray-100 rounded-full p-1.5">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                !isYearly
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Yearly
              <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                Save 17%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;

              return (
                <div
                  key={plan.name}
                  className={`relative rounded-2xl p-8 transition-all duration-300 ${
                    plan.popular
                      ? "bg-gray-900 text-white shadow-2xl shadow-gray-900/20 scale-105 z-10"
                      : "bg-white border border-gray-100 hover:border-[#0D7490]/20 hover:shadow-xl hover:shadow-[#0D7490]/5"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="mb-6">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                      plan.popular ? "bg-white/10" : "bg-[#0D7490]/10"
                    }`}>
                      <Icon className={`w-6 h-6 ${plan.popular ? "text-white" : "text-[#0D7490]"}`} />
                    </div>
                    <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                    <p className={`text-sm ${plan.popular ? "text-gray-400" : "text-gray-500"}`}>
                      {plan.description}
                    </p>
                  </div>

                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">${price}</span>
                      <span className={`text-sm ${plan.popular ? "text-gray-400" : "text-gray-500"}`}>
                        /{isYearly ? "year" : "month"}
                      </span>
                    </div>
                    {isYearly && price > 0 && (
                      <p className="text-green-600 text-sm font-medium mt-1">
                        Save ${plan.monthlyPrice * 12 - plan.yearlyPrice}/year
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={() => handlePlanClick(plan.name)}
                    disabled={plan.name !== "Free" && startingTrial === plan.name}
                    className={`w-full py-6 text-base font-semibold mb-8 transition-all hover:-translate-y-0.5 ${
                      plan.popular
                        ? "bg-white text-gray-900 hover:bg-gray-100 shadow-xl"
                        : plan.ctaVariant === "default"
                        ? "bg-[#0D7490] hover:bg-[#0A5F7A] text-white shadow-lg shadow-[#0D7490]/25"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    } ${plan.name !== "Free" && startingTrial === plan.name ? "opacity-70 cursor-not-allowed" : ""}`}
                    variant={plan.popular ? "default" : plan.ctaVariant}
                  >
                    {startingTrial === plan.name ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        {user && trialInfo.isWithinTrial && plan.name !== "Free" ? `Subscribe to ${plan.name}` : plan.cta}
                        <ArrowRight className="ml-2 w-4 h-4" />
                      </>
                    )}
                  </Button>

                  <div className="space-y-4">
                    <p className={`text-sm font-semibold ${plan.popular ? "text-gray-300" : "text-gray-900"}`}>
                      What's included:
                    </p>
                    {plan.features.map((feature) => (
                      <div key={feature.text} className="flex items-start gap-3">
                        {feature.included ? (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            plan.popular ? "bg-white/20" : "bg-green-100"
                          }`}>
                            <Check className={`w-3 h-3 ${plan.popular ? "text-white" : "text-green-600"}`} />
                          </div>
                        ) : (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            plan.popular ? "bg-white/10" : "bg-gray-100"
                          }`}>
                            <X className={`w-3 h-3 ${plan.popular ? "text-gray-500" : "text-gray-400"}`} />
                          </div>
                        )}
                        <span className={`text-sm ${
                          feature.included
                            ? plan.popular ? "text-gray-200" : "text-gray-700"
                            : plan.popular ? "text-gray-500" : "text-gray-400"
                        }`}>
                          {feature.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Compare all features</h2>
            <p className="text-gray-600">See exactly what you get with each plan</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-4 px-6 text-sm font-semibold text-gray-900">Feature</th>
                    <th className="text-center py-4 px-6 text-sm font-semibold text-gray-900">Starter</th>
                    <th className="text-center py-4 px-6 text-sm font-semibold text-[#0D7490] bg-[#0D7490]/5">Pro</th>
                    <th className="text-center py-4 px-6 text-sm font-semibold text-gray-900">Premium</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Market data", starter: "African + Global", pro: "All markets", premium: "African + Global" },
                    { name: "NSE signals", starter: "5/day", pro: "Unlimited", premium: "Unlimited" },
                    { name: "Global signals", starter: "5/day", pro: "Unlimited", premium: "10/day" },
                    { name: "Stock screener", starter: "✓", pro: "✓", premium: "Advanced NSE" },
                    { name: "Technical analysis", starter: "Basic", pro: "Advanced", premium: "NSE-focused" },
                    { name: "Portfolio tracking", starter: "Basic", pro: "Advanced", premium: "Basic" },
                    { name: "Charting", starter: "Basic", pro: "Advanced", premium: "Basic" },
                    { name: "Risk scoring", starter: "—", pro: "✓", premium: "—" },
                    { name: "API access", starter: "—", pro: "—", premium: "—" },
                    { name: "Support", starter: "Email", pro: "Priority", premium: "Email" },
                    { name: "Price (USD)", starter: "$9.9/mo", pro: "$19.9/mo", premium: "$49.9/mo" },
                    { name: "Price (KES)", starter: "1,299/mo", pro: "2,599/mo", premium: "6,499/mo" },
                  ].map((row, idx) => (
                    <tr key={row.name} className={idx % 2 === 0 ? "bg-gray-50/50" : ""}>
                      <td className="py-4 px-6 text-sm text-gray-700">{row.name}</td>
                      <td className="py-4 px-6 text-center text-sm text-gray-600">{row.starter}</td>
                      <td className="py-4 px-6 text-center text-sm font-medium text-[#0D7490] bg-[#0D7490]/5">{row.pro}</td>
                      <td className="py-4 px-6 text-center text-sm text-gray-600">{row.premium}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Frequently asked questions</h2>
            <p className="text-gray-600">Everything you need to know about our pricing</p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => (
              <div key={idx} className="border border-gray-100 rounded-xl overflow-hidden transition-all">
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-900 pr-4">{faq.question}</span>
                  <HelpCircle className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${
                    openFaq === idx ? "rotate-180" : ""
                  }`} />
                </button>
                {openFaq === idx && (
                  <div className="px-6 pb-6">
                    <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] rounded-3xl p-12 lg:p-16 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-3xl font-bold text-white mb-4">Still have questions?</h2>
              <p className="text-lg text-white/80 mb-8">
                Our team is here to help you find the perfect plan for your trading needs.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 px-8 py-6 text-base font-semibold shadow-xl"
                  onClick={() => {
                    const planName = "Pro";
                    if (user) {
                      handleTrialClick(planName);
                    } else {
                      navigate("/login?redirect=/pricing");
                    }
                  }}
                  disabled={startingTrial === "Pro"}
                >
                  {startingTrial === "Pro" ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    "Start Free Trial"
                  )}
                </Button>
                <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 px-8 py-6 text-base">
                  Chat with Sales
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-lg flex items-center justify-center">
                <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5" />
              </div>
              <span className="text-lg font-bold">StocksIntels</span>
            </div>
            <p className="text-gray-500 text-sm">© 2026 StocksIntels. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
