import { useState } from "react";
import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link, useNavigate } from "react-router";
import { ChevronRight, Check, X, Shield, Zap, Crown, ArrowRight, ExternalLink, Copy, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { PLANS, planById } from "../../data/plans";
import { useAuth } from "../../auth/AuthContext";
import { authFetch } from "../../auth/tokenStore";
import { toast } from "sonner";

const apiPricingTiers = PLANS.filter(p => p.id !== 'core' && p.id !== 'pro' && p.id !== 'premium')
  .map(p => ({
    tier: p.name,
    requests: p.highlights.find(h => h.includes('requests/day'))?.replace(' requests/day', '') || p.monthlyPrice.toString(),
    websocket: p.features.some(f => f.text.includes('WebSocket') && f.included),
    features: p.features.filter(f => f.included).map(f => f.text),
    price: p.monthlyPrice === 0 ? 'Free' : `$${p.monthlyPrice}/month`,
    popular: p.popular,
    planId: p.id,
    limited: p.id === 'free',
  }));

export function ApiPricingPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [freeKey, setFreeKey] = useState<{ prefix: string; suffix: string; full_key: string } | null>(null);
  const [generatingFreeKey, setGeneratingFreeKey] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || "/api";

  const generateFreeKey = async () => {
    if (!user) return;
    setGeneratingFreeKey(true);
    try {
      const res = await authFetch(`${API_BASE}/users/${user.id}/api-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "production" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFreeKey(data.key);
        toast.success("Free production API key generated (1,000 requests/day)");
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Free key generation failed:", res.status, err);
        toast.error(err.error || `Failed to generate free key (${res.status})`);
      }
    } catch (err: any) {
      console.error("Free key generation error:", err);
      toast.error(
        err.message ||
        "Failed to generate free key. Check that the backend is running on port 3001 and you are logged in."
      );
    } finally {
      setGeneratingFreeKey(false);
    }
  };

  const handlePlanClick = (planName: string) => {
    const plan = planById(planName);
    if (!plan) return;

    // Free tier: generate a sandbox key directly (login required)
    if (plan.id === 'free' || plan.monthlyPrice === 0) {
      if (authLoading) return;
      if (!user) {
        navigate("/login?redirect=/developers/pricing");
        return;
      }
      generateFreeKey();
      return;
    }
    if (plan.id === 'enterprise') {
      navigate("/login?redirect=/developers/docs");
      return;
    }
    // Starter and Pro go to subscription page for payment
    navigate(`/subscribe/${plan.id}`);
  };

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        {/* Header */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 border-b border-[#DCE5F0]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Link to="/developers" className="text-sm text-[#52647A] hover:text-[#0D7490] mb-2 inline-flex items-center gap-1">
                <ChevronRight className="size-4 rotate-180" />
                Developer Portal
              </Link>
              <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[#102B50]">API Pricing</h1>
              <p className="mt-2 text-[#52647A]">Simple, transparent pricing for the StocksIntels Financial Intelligence API. Start free, scale as you grow.</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/developers">← Back to Developer Portal</Link>
            </Button>
          </div>
        </section>

        {/* Pricing Table */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#DCE5F0]">
                  <th className="pb-3 font-semibold text-[#102B50]">Tier</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-right">Requests/Day</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-center">WebSocket</th>
                  <th className="pb-3 font-semibold text-[#102B50]">Key Features</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {apiPricingTiers.map((tier, i) => (
                  <tr key={i} className={`border-b border-[#DCE5F0]/50 ${tier.popular ? "bg-[#0D7490]/5" : ""}`}>
                    <td className="py-4 font-medium text-[#102B50]">
                      {tier.popular && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#0D7490] text-white mr-2">Most Popular</span>}
                      {tier.limited && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 mr-2">Limited</span>}
                      {tier.tier}
                    </td>
                    <td className="py-4 text-[#52647A] text-right">{tier.requests}</td>
                    <td className="py-4 text-center">
                      {tier.websocket ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          ✅ Included
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          ❌ Not included
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-[#52647A]">{tier.features.slice(0, 3).join(", ")}{tier.features.length > 3 ? "…" : ""}</td>
                    <td className="py-4 font-semibold text-[#2563A6] text-right">{tier.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Feature Comparison Cards */}
          <div className="mt-16 grid gap-6 lg:grid-cols-4">
            {apiPricingTiers.map((tier, i) => (
              <Card key={i} className={`border-[#DCE5F0] ${tier.popular ? "border-[#0D7490] ring-1 ring-[#0D7490]" : ""}`}>
                {tier.popular && (
                  <div className="bg-[#0D7490] text-white px-4 py-1 text-center text-sm font-medium">
                    Most Popular
                  </div>
                )}
                {tier.limited && (
                  <div className="bg-amber-500 text-white px-4 py-1 text-center text-sm font-medium">
                    Limited
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-[#102B50]">{tier.tier}</CardTitle>
                  <div className="mt-2 text-3xl font-bold text-[#0D7490]">{tier.price}</div>
                  <p className="text-sm text-[#52647A]">{tier.requests} requests/day</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {tier.features.map((f, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm">
                        <Check className="size-4 text-green-600 flex-shrink-0" />
                        <span className="text-[#102B50]">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button 
                    onClick={() => handlePlanClick(tier.tier)}
                    className="mt-6 w-full"
                    variant={tier.popular ? "default" : "outline"}
                    size="lg"
                    disabled={tier.limited && generatingFreeKey}
                  >
                    {tier.price === "Custom" ? (
                      <>Contact Sales <ArrowRight className="ml-2 w-4 h-4" /></>
                    ) : tier.limited && generatingFreeKey ? (
                      <>Generating... <Loader2 className="ml-2 w-4 h-4 animate-spin" /></>
                    ) : (
                      <>Start {tier.tier} <ArrowRight className="ml-2 w-4 h-4" /></>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Free Key Generated */}
        {freeKey && (
          <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-[#102B50] mb-1">Free Production API Key Generated</h3>
                    <p className="text-sm text-[#52647A]">
                      Limited to 1,000 requests/day. Use on api.stocksintels.com.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <code className="bg-white px-3 py-2 rounded font-mono text-sm text-[#102B50] border border-amber-200 flex-1 md:w-80 break-all">
                      {freeKey.full_key}
                    </code>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(freeKey.full_key);
                          toast.success("API key copied to clipboard");
                        }}
                      >
                        <Copy className="size-4 mr-1" />
                        Copy
                      </Button>
                      <Button asChild size="sm">
                        <Link to="/developers/api-keys">
                          Manage API Keys <ArrowRight className="ml-2 w-4 h-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* CTA */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 text-center bg-[#F5F8FC] border-y border-[#DCE5F0]">
          <h2 className="text-3xl font-bold text-[#102B50]">Ready to Build?</h2>
          <p className="mt-4 text-lg text-[#52647A] max-w-xl mx-auto">
            Choose your tier and start integrating StocksIntels Financial Intelligence API today.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button onClick={() => handlePlanClick("Starter")} size="lg">
              Start Starter <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/developers">Back to Developer Portal</Link>
            </Button>
          </div>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}
