import { useState, useEffect } from "react";
import { Copy, Check, Users, DollarSign, Link, BarChart3, Gift, ArrowRight, Loader2, Wallet, Banknote, Clock } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";

interface AffiliateStats {
  registered: boolean;
  referral_code?: string;
  referral_link?: string;
  total_earned?: number;
  pending_balance?: number;
  total_referrals?: number;
  pending_referrals?: number;
}

interface Referral {
  id: number;
  full_name: string;
  email: string;
  subscription_tier: string;
  commission_amount: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  user_signed_up: string;
}

const commissionRates = [
  { tier: "Starter", rate: "$1", per: "referral" },
  { tier: "Premium", rate: "$2", per: "referral" },
  { tier: "Pro", rate: "$5", per: "referral" },
  { tier: "Institutional", rate: "$20", per: "referral" },
];

interface Payout {
  id: number;
  amount: string;
  payment_method: string;
  payment_details: string;
  status: string;
  notes: string | null;
  created_at: string;
  processed_at: string | null;
}

const payoutStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-blue-100 text-blue-700",
    paid: "bg-emerald-100 text-emerald-700",
    rejected: "bg-red-100 text-red-600",
  };
  return styles[status] || "bg-gray-100 text-gray-600";
};

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-700",
    pending: "bg-yellow-100 text-yellow-700",
    cancelled: "bg-red-100 text-red-600",
  };
  return styles[status] || "bg-gray-100 text-gray-600";
};

export function AffiliatesPage() {
  const { user, apiFetch } = useAuth();
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"referrals" | "commissions" | "payouts">("referrals");
  const [registrantName, setRegistrantName] = useState("");
  const [registrantEmail, setRegistrantEmail] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("mpesa");
  const [paymentDetails, setPaymentDetails] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, referralsRes, payoutsRes] = await Promise.all([
          apiFetch("/affiliates/stats"),
          apiFetch("/affiliates/referrals"),
          apiFetch("/affiliates/payouts"),
        ]);
        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats(data);
        }
        if (referralsRes.ok) {
          const data = await referralsRes.json();
          setReferrals(data);
        }
        if (payoutsRes.ok) {
          const data = await payoutsRes.json();
          setPayouts(data);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [apiFetch]);

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const res = await apiFetch("/affiliates/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: registrantName || user?.full_name, email: registrantEmail || user?.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      // Re-fetch stats to get full dashboard data
      const [statsRes, refRes, payoutsRes] = await Promise.all([
        apiFetch("/affiliates/stats"),
        apiFetch("/affiliates/referrals"),
        apiFetch("/affiliates/payouts"),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (refRes.ok) setReferrals(await refRes.json());
      if (payoutsRes.ok) setPayouts(await payoutsRes.json());
      toast.success("You are now an affiliate! Share your referral link to start earning.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register as affiliate");
    } finally {
      setRegistering(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Referral link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWithdraw = async () => {
    if (!paymentDetails.trim()) {
      toast.error("Please enter your payment details");
      return;
    }
    setWithdrawing(true);
    try {
      const res = await apiFetch("/affiliates/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: paymentMethod, payment_details: paymentDetails }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Withdrawal failed");
      toast.success(data.message || "Withdrawal request submitted!");
      // Refresh stats and payouts
      const [statsRes, payoutsRes] = await Promise.all([
        apiFetch("/affiliates/stats"),
        apiFetch("/affiliates/payouts"),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (payoutsRes.ok) setPayouts(await payoutsRes.json());
      setPaymentDetails("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request withdrawal");
    } finally {
      setWithdrawing(false);
    }
  };

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 pt-24 pb-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#0D7490] animate-spin" />
      </div>
    );
  }

  if (!stats?.registered) {
    return (
      <div className="min-h-screen bg-gray-50 pt-24 pb-12">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="p-10 border-gray-100 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#0D7490]/20">
              <Gift className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">Earn Money by Referring Traders</h1>
            <p className="text-gray-600 max-w-xl mx-auto mb-8 leading-relaxed">
              Share StocksIntels with other traders and earn commissions on every referral that subscribes.
              Our program rewards you for helping grow the community.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8">
              {commissionRates.map((c) => (
                <div key={c.tier} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{c.tier}</p>
                  <p className="text-xl font-bold text-[#0D7490]">{c.rate}</p>
                  <p className="text-[11px] text-gray-400">{c.per}</p>
                </div>
              ))}
            </div>

            <div className="max-w-md mx-auto space-y-4 mb-6">
              <input
                type="text"
                placeholder="Your full name"
                value={registrantName}
                onChange={(e) => setRegistrantName(e.target.value)}
                className="w-full px-4 h-12 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-gray-900"
              />
              <input
                type="email"
                placeholder="Your email address"
                value={registrantEmail}
                onChange={(e) => setRegistrantEmail(e.target.value)}
                className="w-full px-4 h-12 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-gray-900"
              />
            </div>

            <Button
              onClick={handleRegister}
              disabled={registering}
              className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-10 h-12 text-base font-bold shadow-lg shadow-[#0D7490]/25"
            >
              {registering ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Registering...
                </span>
              ) : (
                <>
                  Register Now
                  <ArrowRight className="ml-2 w-5 h-5" />
                </>
              )}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Affiliate Dashboard</h1>
          <p className="text-gray-600 mt-1">Track your referrals and earnings</p>
        </div>

        {/* Referral Link */}
        {stats.referral_link && (
          <Card className="p-6 border-gray-100 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="size-10 shrink-0 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                  <Link className="w-5 h-5 text-[#0D7490]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">Your Referral Link</p>
                  <p className="text-sm font-medium text-gray-900 truncate">{stats.referral_link}</p>
                </div>
              </div>
              <Button
                onClick={() => handleCopy(stats.referral_link!)}
                className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white shrink-0"
              >
                {copied ? (
                  <span className="flex items-center gap-2"><Check className="w-4 h-4" /> Copied</span>
                ) : (
                  <span className="flex items-center gap-2"><Copy className="w-4 h-4" /> Copy Link</span>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          <Card className="border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <DollarSign className="size-4 text-emerald-600" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">Total Earned</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{formatCurrency(stats.total_earned || 0)}</div>
          </Card>

          <Card className="border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-8 rounded-lg bg-yellow-100 flex items-center justify-center">
                <BarChart3 className="size-4 text-yellow-600" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">Pending Balance</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{formatCurrency(stats.pending_balance || 0)}</div>
          </Card>

          <Card className="border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="size-4 text-blue-600" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">Total Referrals</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{stats.total_referrals ?? 0}</div>
          </Card>

          <Card className="border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="size-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <Users className="size-4 text-purple-600" />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">Pending Referrals</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{stats.pending_referrals ?? 0}</div>
          </Card>
        </div>

        {/* Tabbed Section */}
        <div className="overflow-x-auto mb-6">
          <div className="flex items-center gap-1 p-1 bg-gray-100/80 border rounded-lg w-full min-w-0">
            <button
              onClick={() => setActiveTab("referrals")}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === "referrals"
                  ? "bg-white text-gray-900 shadow-sm border"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Users className="size-3.5 sm:size-4" />
              Referrals
            </button>
            <button
              onClick={() => setActiveTab("commissions")}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === "commissions"
                  ? "bg-white text-gray-900 shadow-sm border"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <DollarSign className="size-3.5 sm:size-4" />
              Commissions
            </button>
            <button
              onClick={() => setActiveTab("payouts")}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === "payouts"
                  ? "bg-white text-gray-900 shadow-sm border"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Wallet className="size-3.5 sm:size-4" />
              Payouts
            </button>
          </div>
        </div>

        {activeTab === "referrals" ? (
          <Card className="border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80">
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Commission</th>
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.length > 0 ? (
                    referrals.map((ref) => (
                      <tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900">{ref.full_name}</td>
                        <td className="px-6 py-4 text-gray-600">{ref.email}</td>
                        <td className="px-6 py-4">
                          <span className="text-[11px] font-semibold text-[#0D7490] bg-[#0D7490]/5 px-2 py-1 rounded-md uppercase">
                            {ref.subscription_tier}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-semibold text-gray-900">${parseFloat(ref.commission_amount).toFixed(2)}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex text-[11px] font-semibold px-2 py-1 rounded-md ${statusBadge(ref.status)}`}>
                            {ref.status.charAt(0).toUpperCase() + ref.status.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-500">{new Date(ref.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                        <Users className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                        <p className="text-sm font-medium">No referrals yet</p>
                        <p className="text-xs mt-1">Share your referral link to start earning commissions</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : activeTab === "commissions" ? (
          <div className="grid md:grid-cols-2 gap-4">
            {commissionRates.map((c) => (
              <Card key={c.tier} className="border-gray-100 p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{c.tier}</p>
                  <p className="text-xs text-gray-500">{c.per}</p>
                </div>
                <p className="text-2xl font-bold text-[#0D7490]">{c.rate}</p>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Withdraw Form */}
            <Card className="border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-1">Request Withdrawal</h3>
                <p className="text-xs text-gray-500 mb-4">
                  Your balance of <span className="font-semibold text-gray-700">{formatCurrency(stats.pending_balance || 0)}</span> is ready for withdrawal (minimum $1)
                </p>
                <div className="flex flex-col sm:flex-row gap-3 mb-3">
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full sm:w-48 px-4 h-10 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-sm text-gray-900"
                  >
                    <option value="mpesa">M-Pesa</option>
                    <option value="airtel">Airtel Money</option>
                    <option value="paypal">PayPal</option>
                    <option value="bank">Bank Transfer</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Phone number or payment details"
                    value={paymentDetails}
                    onChange={(e) => setPaymentDetails(e.target.value)}
                    className="flex-1 px-4 h-10 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0D7490] focus:bg-white outline-none transition-all text-sm text-gray-900"
                  />
                </div>
                <Button
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                  className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white"
                >
                  {withdrawing ? (
                    <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Requesting...</span>
                  ) : (
                    <span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Request Withdrawal</span>
                  )}
                </Button>
              </Card>

            {/* Payout History */}
            <Card className="border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Payout History</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/80">
                      <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Method</th>
                      <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Details</th>
                      <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-6 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.length > 0 ? (
                      payouts.map((p) => (
                        <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 font-semibold text-gray-900">${parseFloat(p.amount).toFixed(2)}</td>
                          <td className="px-6 py-4 text-gray-600 capitalize">{p.payment_method}</td>
                          <td className="px-6 py-4 text-gray-600">{p.payment_details}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex text-[11px] font-semibold px-2 py-1 rounded-md ${payoutStatusBadge(p.status)}`}>
                              {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                          <Clock className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                          <p className="text-sm font-medium">No payouts yet</p>
                          <p className="text-xs mt-1">Earn commissions from referrals to request a withdrawal</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
