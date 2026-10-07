import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import {
  Check,
  X,
  Zap,
  Shield,
  ShieldCheck,
  Crown,
  ArrowRight,
  HelpCircle,
  Loader2
} from "lucide-react";
import { Button } from "../components/ui/button";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth, getTrialInfo } from "../auth/AuthContext";
import { toast } from "sonner";
import { useSEO } from "../hooks/useSEO";
import { trackEvent, MetaEvents } from "../utils/metaPixel";
import { PLANS, YEARLY_SAVINGS_LABEL, MONEY_BACK_GUARANTEE } from "../data/plans";

// Cards render from the shared plan config. Icon and CTA variant are the only
// page-specific presentation choices.
const PLAN_ICONS: Record<string, typeof Shield> = { core: Zap, pro: Shield, premium: Crown };

const plans = PLANS.map((p) => ({
  ...p,
  description: p.tagline,
  icon: PLAN_ICONS[p.id],
  cta: "Start 7-Day Trial",
  ctaVariant: (p.id === "premium" ? "outline" : "default") as "default" | "outline",
}));

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
    answer: "We accept credit/debit cards and major digital wallets, billed in USD.",
  },
  {
    question: "How does M-Pesa pricing work?",
    answer: "M-Pesa is no longer a pricing option. All plans are billed in USD for a simple, global experience.",
  },
  {
    question: "What's the difference between Premium and Pro?",
    answer: "Premium includes all Pro features plus AI multi-market stock screening, cross-market intelligence, human analyst insights and research, analyst market commentary, and priority analyst Q&A support. Pro is designed for active researchers while Premium is for serious investors who need institutional-grade tools.",
  },
  {
    question: "What's the difference between Pro and Core?",
    answer: "Pro includes all Core features plus advanced fundamentals and technical analysis, insider activity intelligence, AI stock comparison, advanced stock screening, investment thesis and bull/bear case analysis, and portfolio risk analysis. Core is ideal for beginners while Pro is for active researchers.",
  },
  {
    question: "Can I cancel my subscription?",
    answer: "You can cancel anytime from your account settings. You'll retain access until the end of your current billing period.",
  },
  {
    question: "Is there a money-back guarantee?",
    answer: `Yes. Every plan comes with a ${MONEY_BACK_GUARANTEE}. If StocksIntels isn't right for you, contact support within 30 days of your payment and we'll refund you in full.`,
  },
];

export function PricingPage() {
  useSEO({
    title: "Pricing – StocksIntels Investment Plans",
    description: "Choose from Core, Pro, or Premium plans. Get AI-powered market intelligence, advanced analytics, and expert insights. Starting at $79/year with a 7-day free trial.",
    canonical: "/pricing",
    keywords: "stock market intelligence pricing, investment research plans, AI stock analysis, portfolio management tools, stock screening software",
  });

  useEffect(() => {
    const productSchemas = plans.map(plan => ({
      "@context": "https://schema.org",
      "@type": "Product",
      name: `StocksIntels ${plan.name}`,
      description: `AI-powered stock market intelligence plan for ${plan.description.toLowerCase()}. ${plan.features.filter(f => f.included).map(f => f.text).join(', ')}.`,
      brand: { "@type": "Brand", name: "StocksIntels" },
      offers: {
        "@type": "AggregateOffer",
        lowPrice: plan.monthlyPrice,
        highPrice: plan.yearlyPrice,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: "https://stocksintels.com/pricing",
      },
    }));
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map(f => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    };
    const els = [...productSchemas.map((s, i) => {
      const el = document.createElement("script"); el.type = "application/ld+json"; el.id = `ld-product-${i}`; el.text = JSON.stringify(s);
      document.head.appendChild(el); return el;
    }), (() => { const el = document.createElement("script"); el.type = "application/ld+json"; el.id = "ld-faq-pricing"; el.text = JSON.stringify(faqSchema); document.head.appendChild(el); return el; })()];
    return () => els.forEach(el => el.remove());
  }, []);

  useEffect(() => {
    trackEvent(MetaEvents.ViewContent, { content_name: "Pricing" });
  }, []);

  const navigate = useNavigate();
  const { user, apiFetch, updateUser, isLoading } = useAuth();
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [startingTrial, setStartingTrial] = useState<string | null>(null);
  const [payingCommitment, setPayingCommitment] = useState(false);
  const trialInfo = getTrialInfo(user);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
    // Check if commitment fee has been paid
    if (!(user as any).commitment_fee_paid) {
      try {
        const res = await apiFetch('/payments/commitment-fee', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        updateUser({ ...user, commitment_fee_paid: true });
      } catch (error) {
        toast.error('Please pay the $1 commitment fee to start your trial.');
        return;
      }
    }
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
      trackEvent(MetaEvents.StartTrial, { plan: planName });
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
    if (trialInfo.isWithinTrial || !trialInfo.canStartTrial) {
      trackEvent(MetaEvents.InitiateCheckout, { content_name: planName });
      navigate(`/subscribe/${planName.toLowerCase()}`);
      return;
    }
    handleTrialClick(planName);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link to="/login">
                <Button variant="ghost" className="text-muted-foreground hover:text-[#0D7490]">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

       {/* Hero */}
       <section className="pt-32 pb-16">
         <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
           <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Pricing</p>
           <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
             Investment plans for every level
           </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Choose the plan that matches your investment journey. All plans include a 7-day free trial
            and a {MONEY_BACK_GUARANTEE}.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 bg-muted rounded-full p-1.5">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                !isYearly
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yearly
               <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                 {YEARLY_SAVINGS_LABEL}
               </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;

              return (
                <div
                  key={plan.name}
                  className={`relative rounded-2xl p-6 sm:p-8 transition-all duration-300 ${
                    plan.popular
                      ? "bg-gray-900 dark:bg-[#0a0a0b] text-white shadow-2xl shadow-gray-900/20 scale-105 z-10"
                      : "bg-card border border-border hover:border-[#0D7490]/20 hover:shadow-xl hover:shadow-[#0D7490]/5"
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
                    <p className={`text-sm ${plan.popular ? "text-gray-400" : "text-muted-foreground"}`}>
                      {plan.description}
                    </p>
                  </div>

                    <div className="mb-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold">${isYearly ? plan.yearlyPrice : plan.monthlyPrice.toFixed(2)}</span>
                        <span className={`text-sm ${plan.popular ? "text-gray-400" : "text-muted-foreground"}`}>
                          /{isYearly ? "year" : "mo"}
                        </span>
                      </div>
                      {isYearly && price > 0 && (
                        <p className="text-green-600 text-sm font-medium mt-1">
                          {YEARLY_SAVINGS_LABEL}
                        </p>
                      )}
                    </div>

                  <Button
                    onClick={() => handlePlanClick(plan.name)}
                    disabled={plan.name !== "Free" && startingTrial === plan.name}
                    className={`w-full py-6 text-base font-semibold mb-2 transition-all hover:-translate-y-0.5 ${
                      plan.popular
                        ? "bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 dark:hover:bg-white/10 shadow-xl"
                        : plan.ctaVariant === "default"
                        ? "bg-[#0D7490] hover:bg-[#0A5F7A] text-white shadow-lg shadow-[#0D7490]/25"
                        : "border-border text-muted-foreground hover:bg-muted"
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

                  <p className={`mb-6 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium ${
                    plan.popular ? "text-gray-400" : "text-muted-foreground"
                  }`}>
                    <ShieldCheck className="size-3.5 shrink-0" />
                    {MONEY_BACK_GUARANTEE}
                  </p>

                  <div className="space-y-4">
                    <p className={`text-sm font-semibold ${plan.popular ? "text-gray-300" : "text-foreground"}`}>
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
                            plan.popular ? "bg-white/10" : "bg-muted"
                          }`}>
                            <X className={`w-3 h-3 ${plan.popular ? "text-gray-500" : "text-gray-400"}`} />
                          </div>
                        )}
                        <span className={`text-sm ${
                          feature.included
                            ? plan.popular ? "text-gray-200" : "text-muted-foreground"
                            : plan.popular ? "text-gray-500" : "text-muted-foreground"
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
      <section className="py-20 bg-muted">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-4">Compare all features</h2>
            <p className="text-muted-foreground">See exactly what you get with each plan</p>
          </div>

          <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                 <thead>
                   <tr className="border-b border-border">
                     <th className="text-left py-4 px-6 text-sm font-semibold text-foreground">Feature</th>
                     <th className="text-center py-4 px-6 text-sm font-semibold text-foreground">Core</th>
                     <th className="text-center py-4 px-6 text-sm font-semibold text-[#0D7490] bg-[#0D7490]/5">Pro</th>
                     <th className="text-center py-4 px-6 text-sm font-semibold text-foreground">Premium</th>
                   </tr>
                 </thead>
                 <tbody>
                   {[
                     { name: "Core promise", starter: "Understand the market", pro: "Research better", premium: "Operate like a serious investor" },
                     { name: "AI Analyst Chat", starter: "Basic", pro: "Advanced / Unlimited", premium: "Advanced research chat" },
                     { name: "AI market intelligence", starter: "Essential", pro: "Advanced", premium: "Advanced" },
                     { name: "Market coverage", starter: "African + Global", pro: "African + Global", premium: "African + Global + Cross-market" },
                     { name: "Fundamentals", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Financials & Financial Health", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Valuation analysis", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Technical intelligence", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "News & sentiment", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Insider activity", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "AI stock comparison", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Stock screening", starter: "Basic", pro: "Advanced", premium: "AI multi-market" },
                     { name: "Investment thesis", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Bull / Bear case analysis", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Market & sector analysis", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Portfolio tracking", starter: "Yes", pro: "Yes", premium: "Yes" },
                     { name: "Portfolio intelligence", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Portfolio risk analysis", starter: "—", pro: "Basic", premium: "Advanced" },
                     { name: "Alerts", starter: "Basic", pro: "Advanced", premium: "Priority" },
                     { name: "AI research", starter: "Limited", pro: "Unlimited", premium: "Advanced" },
                     { name: "AI-powered opportunity discovery", starter: "Basic", pro: "Advanced", premium: "Advanced multi-market" },
                     { name: "Cross-market intelligence", starter: "—", pro: "Limited", premium: "Core" },
                     { name: "Human analyst insights", starter: "—", pro: "—", premium: "Yes" },
                     { name: "Analyst research", starter: "—", pro: "—", premium: "Yes" },
                     { name: "Analyst market commentary", starter: "—", pro: "—", premium: "Yes" },
                     { name: "Analyst Q&A", starter: "—", pro: "—", premium: "Priority" },
                     { name: "Priority intelligence", starter: "—", pro: "—", premium: "Yes" },
                      { name: "Price", starter: isYearly ? `$${PLANS[0].yearlyPrice}/year` : `$${PLANS[0].monthlyPrice}/mo`, pro: isYearly ? `$${PLANS[1].yearlyPrice}/year` : `$${PLANS[1].monthlyPrice}/mo`, premium: isYearly ? `$${PLANS[2].yearlyPrice}/year` : `$${PLANS[2].monthlyPrice}/mo` },
                   ].map((row, idx) => (
                     <tr key={row.name} className={idx % 2 === 0 ? "bg-muted/50" : ""}>
                       <td className="py-4 px-6 text-sm text-muted-foreground">{row.name}</td>
                       <td className="py-4 px-6 text-center text-sm text-muted-foreground">{row.starter}</td>
                       <td className="py-4 px-6 text-center text-sm font-medium text-[#0D7490] bg-[#0D7490]/5">{row.pro}</td>
                       <td className="py-4 px-6 text-center text-sm text-muted-foreground">{row.premium}</td>
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
            <h2 className="text-3xl font-bold text-foreground mb-4">Frequently asked questions</h2>
            <p className="text-muted-foreground">Everything you need to know about our pricing</p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, idx) => (
              <div key={idx} className="border border-border rounded-xl overflow-hidden transition-all">
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-6 text-left hover:bg-muted transition-colors"
                >
                  <span className="font-semibold text-foreground pr-4">{faq.question}</span>
                  <HelpCircle className={`w-5 h-5 text-muted-foreground flex-shrink-0 transition-transform ${
                    openFaq === idx ? "rotate-180" : ""
                  }`} />
                </button>
                {openFaq === idx && (
                  <div className="px-6 pb-6">
                    <p className="text-muted-foreground leading-relaxed">{faq.answer}</p>
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
                <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 dark:hover:bg-white/10 px-8 py-6 text-base font-semibold shadow-xl"
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
      <footer className="bg-gray-900 dark:bg-[#0a0a0b] text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="size-8 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-lg font-bold">StocksIntels</span>
            </div>
            <p className="text-muted-foreground text-sm">© 2026 StocksIntels. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
