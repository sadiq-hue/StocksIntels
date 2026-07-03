import { useEffect, useState } from "react";
import { Users, DollarSign, TrendingUp, ArrowUp, TrendingDown } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar } from "recharts";
import { api, type Lead, type Payment, type Expense, type Activity, type FinancialSummary } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

type ActivityItem = { type: string; name: string; detail: string; time: string; avatar: string };

const initialFinancialData = [
  { date: "Apr 5", revenue: 4200, expenses: 2100, leads: 12 },
  { date: "Apr 6", revenue: 5800, expenses: 2300, leads: 18 },
  { date: "Apr 7", revenue: 4500, expenses: 1900, leads: 15 },
  { date: "Apr 8", revenue: 7200, expenses: 2500, leads: 22 },
  { date: "Apr 9", revenue: 6100, expenses: 2200, leads: 19 },
  { date: "Apr 10", revenue: 8500, expenses: 2800, leads: 25 },
  { date: "Apr 11", revenue: 9200, expenses: 3100, leads: 28 },
];

const initialFunnelData = [
  { stage: "Leads", count: 139, percentage: 100 },
  { stage: "Qualified", count: 98, percentage: 70 },
  { stage: "Booked", count: 50, percentage: 36 },
  { stage: "Paid", count: 42, percentage: 30 },
];

const initialActivity: ActivityItem[] = [
  { type: "payment", name: "Sarah Chen", detail: "Payment received: $2,400", time: "2 min ago", avatar: "SC" },
  { type: "lead", name: "Michael Rodriguez", detail: "New lead from WhatsApp", time: "12 min ago", avatar: "MR" },
  { type: "meeting", name: "Emma Williams", detail: "Meeting booked for tomorrow", time: "1 hour ago", avatar: "EW" },
  { type: "payment", name: "David Park", detail: "Payment received: $1,800", time: "2 hours ago", avatar: "DP" },
];

const initials = (name: string) =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

export function Dashboard() {
  const { business } = useBusiness();
  const [financialData, setFinancialData] = useState(initialFinancialData);
  const [funnelData, setFunnelData] = useState(initialFunnelData);
  const [activities, setActivities] = useState<ActivityItem[]>(initialActivity);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!business) return;
    const bid = business.id;

    Promise.all([
      api.leads.list({ business_id: bid }).catch(() => null),
      api.payments.list({ business_id: bid }).catch(() => null),
      api.expenses.list({ business_id: bid }).catch(() => null),
      api.activities.list({ business_id: bid }).catch(() => null),
      api.financialSummaries.list({ business_id: bid }).catch(() => null),
    ]).then(([leadsRes, paymentsRes, expensesRes, activitiesRes, summariesRes]) => {
      const allLeads = leadsRes?.leads ?? [];
      const allPayments = paymentsRes?.payments ?? [];
      const allExpenses = expensesRes?.expenses ?? [];
      const allActivities = activitiesRes?.activities ?? [];
      const summaries = summariesRes?.rows ?? [];

      // Build weekly revenue vs expenses from payments + expenses
      if (summaries.length > 0 || allPayments.length > 0) {
        setFinancialData(
          summaries.length > 0
            ? summaries.map((s: FinancialSummary) => ({
                date: `${s.period_year}-${String(s.period_month).padStart(2, '0')}`,
                revenue: s.total_revenue,
                expenses: s.total_expenses,
                leads: s.new_leads,
              })).slice(-7)
            : allPayments
                .filter((p: Payment) => p.status === 'confirmed' || p.status === 'paid')
                .slice(0, 7)
                .map((p: Payment) => ({
                  date: new Date(p.paid_at ?? p.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
                  revenue: p.amount,
                  expenses: 0,
                  leads: 0,
                }))
        );
      }

      // Build funnel
      const leadCount = allLeads.length;
      const qualified = allLeads.filter((l: Lead) => l.status === 'qualified' || l.status === 'booked' || l.status === 'won').length;
      const booked = allLeads.filter((l: Lead) => l.status === 'booked' || l.status === 'won').length;
      const won = allLeads.filter((l: Lead) => l.status === 'won').length;
      const maxVal = Math.max(leadCount, 1);
      setFunnelData([
        { stage: "Leads", count: leadCount, percentage: 100 },
        { stage: "Qualified", count: qualified, percentage: Math.round((qualified / maxVal) * 100) },
        { stage: "Booked", count: booked, percentage: Math.round((booked / maxVal) * 100) },
        { stage: "Won", count: won, percentage: Math.round((won / maxVal) * 100) },
      ]);

      // Build activity feed
      if (allActivities.length > 0) {
        setActivities(
          allActivities.slice(0, 5).map((a: Activity) => ({
            type: a.type === 'call' || a.type === 'meeting' ? 'meeting' : a.type === 'message' ? 'lead' : 'payment',
            name: a.summary.slice(0, 20),
            detail: a.summary,
            time: formatTimeAgo(a.occurred_at),
            avatar: a.user_id ? initials(a.user_id) : '??',
          }))
        );
      }

      setLoading(false);
    });
  }, [business]);

  const totalRevenue = financialData.reduce((sum, d) => sum + d.revenue, 0);
  const totalExpenses = financialData.reduce((sum, d) => sum + d.expenses, 0);
  const netCashFlow = totalRevenue - totalExpenses;

  return (
    <div className="h-full p-8 space-y-8 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1>Business Overview</h1>
        <p className="text-muted-foreground">Real-time insights across sales, payments, and finance</p>
      </div>

      <div className="grid grid-cols-4 gap-6 shrink-0">
        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Leads</span>
            <Users className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">139</span>
              <span className="text-sm text-green-600 flex items-center gap-1">
                <ArrowUp className="w-3 h-3" />
                12%
              </span>
            </div>
            <p className="text-sm text-muted-foreground">Last 7 days</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Revenue</span>
            <DollarSign className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">${(totalRevenue / 1000).toFixed(1)}k</span>
              <span className="text-sm text-green-600 flex items-center gap-1">
                <ArrowUp className="w-3 h-3" />
                18%
              </span>
            </div>
            <p className="text-sm text-muted-foreground">This week</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Expenses</span>
            <TrendingDown className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">${(totalExpenses / 1000).toFixed(1)}k</span>
              <span className="text-sm text-red-600 flex items-center gap-1">
                <ArrowUp className="w-3 h-3" />
                5%
              </span>
            </div>
            <p className="text-sm text-muted-foreground">This week</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Net Cash Flow</span>
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">${(netCashFlow / 1000).toFixed(1)}k</span>
              <span className="text-sm text-green-600 flex items-center gap-1">
                <ArrowUp className="w-3 h-3" />
                24%
              </span>
            </div>
            <p className="text-sm text-muted-foreground">Profit this week</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-8">
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 p-6 border border-border rounded-xl bg-card">
          <h3 className="mb-6">Revenue vs Expenses</h3>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={financialData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--chart-2))" fill="url(#colorRevenue)" strokeWidth={2} />
              <Bar dataKey="expenses" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card">
          <h3 className="mb-6">Conversion Funnel</h3>
          <div className="space-y-4">
            {funnelData.map((stage, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">{stage.stage}</span>
                  <span className="font-medium">{stage.count}</span>
                </div>
                <div className="h-8 bg-muted rounded-lg overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-green-500 flex items-center justify-end pr-3 text-white text-sm transition-all"
                    style={{ width: `${stage.percentage}%` }}
                  >
                    {stage.percentage}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 border border-border rounded-xl bg-card">
        <h3 className="mb-6">Recent Activity</h3>
        {loading ? (
          <div className="text-center text-muted-foreground py-8">Loading activity...</div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity, i) => (
              <div key={i} className="flex items-start gap-4 p-3 rounded-lg hover:bg-accent/50 transition-colors">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm flex-shrink-0">
                  {activity.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{activity.name}</p>
                  <p className="text-sm text-muted-foreground">{activity.detail}</p>
                </div>
                <span className="text-sm text-muted-foreground flex-shrink-0">{activity.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
