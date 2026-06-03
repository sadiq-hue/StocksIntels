import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { 
  Check, 
  X, 
  Zap, 
  Shield, 
  Crown,
  ArrowRight,
  HelpCircle
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useAuth } from "../auth/AuthContext";

const plans = [
  {
    name: "Starter",
    description: "Perfect for beginners exploring the markets",
    monthlyPrice: 1,
    yearlyPrice: 10,
    icon: Zap,
    popular: false,
    features: [
      { text: "Real-time NSE data", included: true },
      { text: "3 AI signals per day", included: true },
      { text: "Basic portfolio tracking", included: true },
      { text: "Email support", included: true },
      { text: "Advanced charting", included: false },
      { text: "Risk analysis tools", included: false },
      { text: "API access", included: false },
      { text: "Priority support", included: false },
    ],
    cta: "Get Started Free",
    ctaVariant: "outline" as const,
  },
  {
    name: "Pro",
    description: "For active traders who need an edge",
    monthlyPrice: 29,
    yearlyPrice: 290,
    icon: Shield,
    popular: true,
    features: [
      { text: "Real-time NSE + global data", included: true },
      { text: "Unlimited AI signals", included: true },
      { text: "Advanced portfolio analytics", included: true },
      { text: "Priority email support", included: true },
      { text: "Advanced charting", included: true },
      { text: "Risk analysis tools", included: true },
      { text: "API access", included: false },
      { text: "Priority support", included: false },
    ],
    cta: "Start Pro Trial",
    ctaVariant: "default" as const,
  },
  {
    name: "Enterprise",
    description: "For institutions and professional teams",
    monthlyPrice: 99,
    yearlyPrice: 990,
    icon: Crown,
    popular: false,
    features: [
      { text: "All markets + custom feeds", included: true },
      { text: "Unlimited AI signals", included: true },
      { text: "White-label analytics", included: true },
      { text: "24/7 dedicated support", included: true },
      { text: "Advanced charting", included: true },
      { text: "Risk analysis tools", included: true },
      { text: "Full API access", included: true },
      { text: "Priority support", included: true },
    ],
    cta: "Contact Sales",
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
    answer: "Absolutely. Both Pro and Enterprise plans come with a 14-day free trial. No credit card required to start.",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards, M-Pesa, bank transfers, and mobile money across African markets.",
  },
  {
    question: "Do you offer refunds?",
    answer: "Yes, we offer a 30-day money-back guarantee on all paid plans if you're not satisfied with the service.",
  },
  {
    question: "Can I cancel my subscription?",
    answer: "You can cancel anytime from your account settings. You'll retain access until the end of your current billing period.",
  },
];

export function PricingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const savingsPercent = (monthly: number, yearly: number) => {
    if (monthly === 0) return 0;
    const monthlyTotal = monthly * 12;
    return Math.round(((monthlyTotal - yearly) / monthlyTotal) * 100);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                <img src="/favicon.svg" alt="StocksIntels" className="w-5 h-5" />
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
            Choose the plan that fits your trading style. All plans include a 14-day free trial.
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
          <div className="grid md:grid-cols-3 gap-8">
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
                    onClick={() => {
                      if (user) {
                        navigate(`/subscribe/${plan.name.toLowerCase()}`);
                      } else {
                        navigate(`/login?redirect=/subscribe/${plan.name.toLowerCase()}`);
                      }
                    }}
                    className={`w-full py-6 text-base font-semibold mb-8 transition-all hover:-translate-y-0.5 ${
                      plan.popular
                        ? "bg-white text-gray-900 hover:bg-gray-100 shadow-xl"
                        : plan.ctaVariant === "default"
                        ? "bg-[#0D7490] hover:bg-[#0A5F7A] text-white shadow-lg shadow-[#0D7490]/25"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                    variant={plan.popular ? "default" : plan.ctaVariant}
                  >
                    {plan.cta}
                    <ArrowRight className="ml-2 w-4 h-4" />
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
                    <th className="text-center py-4 px-6 text-sm font-semibold text-gray-900">Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Real-time market data", starter: "NSE only", pro: "NSE + Global", enterprise: "All + Custom" },
                    { name: "AI trading signals", starter: "3/day", pro: "Unlimited", enterprise: "Unlimited" },
                    { name: "Portfolio tracking", starter: "Basic", pro: "Advanced", enterprise: "White-label" },
                    { name: "Charting tools", starter: "Basic", pro: "Advanced", enterprise: "Advanced" },
                    { name: "Risk analysis", starter: "—", pro: "✓", enterprise: "✓" },
                    { name: "API access", starter: "—", pro: "—", enterprise: "Full access" },
                    { name: "Support", starter: "Email", pro: "Priority", enterprise: "24/7 Dedicated" },
                    { name: "Team members", starter: "1", pro: "1", enterprise: "Unlimited" },
                    { name: "Historical data", starter: "1 year", pro: "5 years", enterprise: "Unlimited" },
                    { name: "Export reports", starter: "PDF", pro: "PDF, CSV, Excel", enterprise: "All formats" },
                  ].map((row, idx) => (
                    <tr key={row.name} className={idx % 2 === 0 ? "bg-gray-50/50" : ""}>
                      <td className="py-4 px-6 text-sm text-gray-700">{row.name}</td>
                      <td className="py-4 px-6 text-center text-sm text-gray-600">{row.starter}</td>
                      <td className="py-4 px-6 text-center text-sm font-medium text-[#0D7490] bg-[#0D7490]/5">{row.pro}</td>
                      <td className="py-4 px-6 text-center text-sm text-gray-600">{row.enterprise}</td>
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
                <Link to="/login">
                  <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 px-8 py-6 text-base font-semibold shadow-xl">
                    Start Free Trial
                  </Button>
                </Link>
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
                <img src="/favicon.svg" alt="StocksIntels" className="w-5 h-5" />
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
