import { useState, useEffect, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
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
import { PublicBrandHeader, PublicBrandFooter } from "../components/PublicBrandChrome";
import { useAuth, getTrialInfo } from "../auth/AuthContext";
import { toast } from "sonner";
import { useSEO } from "../hooks/useSEO";
import { trackEvent, MetaEvents } from "../utils/metaPixel";
import { PLANS, YEARLY_SAVINGS_LABEL, MONEY_BACK_GUARANTEE } from "../data/plans";

// Cards render from the shared plan config. Icon and CTA variant are the only
// page-specific presentation choices.
const PLAN_ICONS: Record<string, typeof Shield> = { core: Zap, pro: Shield, premium: Crown };

const marketingPlans = PLANS.filter(p => ["core", "pro", "premium"].includes(p.id));
const plans = marketingPlans.map((p) => ({
  ...p,
  description: p.tagline,
  icon: PLAN_ICONS[p.id],
  cta: "Start 7-Day Access",
  ctaVariant: (p.id === "premium" ? "outline" : "default") as "default" | "outline",
}));

const faqs = [
  {
    question: "Can I switch plans anytime?",
    answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.",
  },
  {
    question: "How does trial access work?",
    answer: "Pay the $1 commitment fee to begin 7-day access to your selected plan. The commitment fee helps prevent automated abuse of the research platform.",
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
    answer: "Premium includes all Pro features plus multi-market stock screening, cross-market intelligence, human analyst insights and research, analyst market commentary, and priority analyst Q&A support. Pro is designed for active researchers while Premium offers the greatest research depth.",
  },
  {
    question: "What's the difference between Pro and Core?",
    answer: "Pro includes all Core features plus advanced fundamentals and technical analysis, insider activity intelligence, company comparison, advanced screening, investment thesis and bull/bear case analysis, and portfolio risk analysis. Core provides essential intelligence while Pro is built for active research.",
  },
  {
    question: "Can I cancel my subscription?",
    answer: "You can cancel anytime from your account settings. You'll retain access until the end of your current billing period.",
  },
  {
    question: "Is there a money-back guarantee?",
    answer: `Yes. Yearly subscriptions are covered by a ${MONEY_BACK_GUARANTEE}: request a refund within 30 days of your annual payment and we'll refund you in full. Monthly subscriptions can be cancelled at any time and run to the end of the paid period; partial months are not refunded.`,
  },
];

export function PricingPage() {
  useSEO({
    title: "StocksIntels Pricing | Financial Intelligence Plans",
    absoluteTitle: true,
    description: "Compare StocksIntels Core, Pro and Premium plans for Super Intelligence-powered market research, company financials, investment insights and portfolio tools.",
    canonical: "/pricing",
    keywords: "financial market intelligence pricing, investment research plans, African equity research, portfolio analysis tools, company financials",
  });

  useEffect(() => {
    const productSchemas = plans.map(plan => ({
      "@context": "https://schema.org",
      "@type": "Product",
      name: `StocksIntels ${plan.name}`,
      description: `StocksIntels financial intelligence plan for ${plan.description.toLowerCase()}. ${plan.features.filter(f => f.included).map(f => f.text).join(', ')}.`,
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

  const [searchParams] = useSearchParams();
  const planParam = searchParams.get("plan");

  const navigate = useNavigate();
  const { user, apiFetch, updateUser, isLoading } = useAuth();
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [startingTrial, setStartingTrial] = useState<string | null>(null);
  const [payingCommitment, setPayingCommitment] = useState(false);
  const trialInfo = getTrialInfo(user);
  const planCardsRef = useRef<Record<string, HTMLDivElement | null>>({});

  // Scroll to the plan card when coming from landing page with ?plan= query param
  useEffect(() => {
    if (planParam && planCardsRef.current[planParam]) {
      planCardsRef.current[planParam]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [planParam]);

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
      const redirectUrl = planName !== "Free" ? `/subscribe/${planName.toLowerCase()}` : "/pricing";
      navigate(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      return;
    }
    // Paid plans (Starter, Pro, Premium) always go to subscription page
    // Free plan goes to trial flow
    if (planName !== "Free") {
      trackEvent(MetaEvents.InitiateCheckout, { content_name: planName });
      navigate(`/subscribe/${planName.toLowerCase()}`);
      return;
    }
    // Free plan - trial flow
    if (trialInfo.isWithinTrial || !trialInfo.canStartTrial) {
      trackEvent(MetaEvents.InitiateCheckout, { content_name: planName });
      navigate(`/subscribe/${planName.toLowerCase()}`);
      return;
    }
    handleTrialClick(planName);
  };

  return (
    <div className="si-landing min-h-screen bg-[#F5F8FC] text-[#202B3A]">
      <PublicBrandHeader />

       {/* Hero */}
       <section className="relative overflow-hidden pt-32 pb-16">
         <div className="si-grid pointer-events-none absolute inset-0" />
         <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
           <p className="text-[#2563A6] font-semibold text-xs uppercase tracking-[0.22em] mb-3">Access StocksIntels</p>
           <h1 className="si-display text-4xl sm:text-6xl font-medium tracking-[-0.035em] text-[#102B50] mb-4">
              Choose your research depth.
            </h1>
           <p className="text-base font-medium leading-7 text-[#40556D] max-w-2xl mx-auto mb-5">
             Core, Pro and Premium provide progressively deeper market intelligence, company research and portfolio tools.
           </p>
           <p className="mx-auto mb-10 w-fit rounded-full border border-[#D5A64A]/35 bg-[#D5A64A]/10 px-4 py-2 text-xs font-semibold text-[#70521D]">7-day access begins after the $1 commitment fee. {MONEY_BACK_GUARANTEE}.</p>

          {/* Billing Toggle */}
           <div className="inline-flex items-center gap-2 border border-[#B8CADC] bg-white rounded-full p-1.5 shadow-sm">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                !isYearly
                   ? "bg-[#102B50] text-white shadow-sm"
                   : "text-[#52647A] hover:text-[#102B50]"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                   ? "bg-[#102B50] text-white shadow-sm"
                   : "text-[#52647A] hover:text-[#102B50]"
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
                  ref={(el) => { planCardsRef.current[plan.id] = el; }}
                  key={plan.name}
                  className={`relative rounded-2xl p-6 sm:p-8 transition-all duration-300 ${
                    plan.popular
                       ? "bg-[#102B50] text-white border border-[#174A7E] shadow-2xl shadow-[#102B50]/20 lg:scale-[1.02] z-10"
                       : `bg-white border ${plan.id === "premium" ? "border-[#D5A64A]/60" : "border-[#D5E0EB]"} hover:shadow-xl`
                   }`}
              >
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider">
                        Most selected
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
                         ? "bg-white text-[#102B50] hover:bg-cyan-50 shadow-xl"
                        : plan.ctaVariant === "default"
                         ? plan.id === "premium" ? "bg-[#D5A64A] hover:bg-[#C69941] text-[#2F291F]" : "bg-[#2563A6] hover:bg-[#174A7E] text-white shadow-lg shadow-[#2563A6]/20"
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
                      { name: "Research assistant", starter: "Basic", pro: "Advanced / Unlimited", premium: "Advanced research chat" },
                      { name: "Market intelligence", starter: "Essential", pro: "Advanced", premium: "Advanced" },
                     { name: "Market coverage", starter: "African + Global", pro: "African + Global", premium: "African + Global + Cross-market" },
                     { name: "Fundamentals", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Financials & Financial Health", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Valuation analysis", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Technical intelligence", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "News & sentiment", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Insider activity", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                      { name: "Company comparison", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Stock screening", starter: "Basic", pro: "Advanced", premium: "AI multi-market" },
                     { name: "Investment thesis", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Bull / Bear case analysis", starter: "—", pro: "Yes", premium: "Advanced" },
                     { name: "Market & sector analysis", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Portfolio tracking", starter: "Yes", pro: "Yes", premium: "Yes" },
                     { name: "Portfolio intelligence", starter: "Basic", pro: "Advanced", premium: "Advanced" },
                     { name: "Portfolio risk analysis", starter: "—", pro: "Basic", premium: "Advanced" },
                     { name: "Alerts", starter: "Basic", pro: "Advanced", premium: "Priority" },
                      { name: "Intelligent research", starter: "Limited", pro: "Unlimited", premium: "Advanced" },
                      { name: "Opportunity discovery", starter: "Basic", pro: "Advanced", premium: "Advanced multi-market" },
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
           <div className="relative bg-[#174A7E] rounded-3xl p-12 lg:p-16 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-3xl font-bold text-white mb-4">Still have questions?</h2>
              <p className="text-lg text-white/80 mb-8">
                 Our team can help you choose the right level of research access.
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
                     "Start 7-Day Access"
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

       <PublicBrandFooter />
    </div>
  );
}
