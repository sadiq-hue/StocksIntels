import { useEffect, useState } from "react";
import { TrendingUp, Users, DollarSign, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { api, type Lead, type Payment, type FinancialSummary } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

type ConvStage = { stage: string; count: number; rate: number };
type ChannelPerf = { channel: string; leads: number; conversions: number; revenue: number };

const defaultConversionData: ConvStage[] = [
  { stage: "Leads", count: 139, rate: 100 },
  { stage: "Qualified", count: 98, rate: 70.5 },
  { stage: "Booked", count: 50, rate: 51.0 },
  { stage: "Paid", count: 42, rate: 84.0 },
];

const defaultChannelPerf: ChannelPerf[] = [
  { channel: "WhatsApp", leads: 85, conversions: 32, revenue: 24800 },
  { channel: "Email", leads: 54, conversions: 10, revenue: 9800 },
];

const defaultTimeToConv = [
  { week: "Week 1", avgDays: 14 },
  { week: "Week 2", avgDays: 12 },
  { week: "Week 3", avgDays: 10 },
  { week: "Week 4", avgDays: 8 },
];

export function Analytics() {
  const { business } = useBusiness();
  const [conversionData, setConversionData] = useState<ConvStage[]>(defaultConversionData);
  const [channelPerformance, setChannelPerformance] = useState<ChannelPerf[]>(defaultChannelPerf);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!business) return;
    const bid = business.id;

    Promise.all([
      api.leads.list({ business_id: bid }).catch(() => null),
      api.payments.list({ business_id: bid }).catch(() => null),
      api.financialSummaries.list({ business_id: bid }).catch(() => null),
    ]).then(([leadsRes, paymentsRes, summariesRes]) => {
      const leads = leadsRes?.leads ?? [];
      const payments = paymentsRes?.payments ?? [];
      const summaries = summariesRes?.rows ?? [];

      if (leads.length > 0) {
        const total = leads.length;
        const qualified = leads.filter((l: Lead) => ['qualified', 'booked', 'won'].includes(l.status)).length;
        const booked = leads.filter((l: Lead) => ['booked', 'won'].includes(l.status)).length;
        const won = leads.filter((l: Lead) => l.status === 'won').length;

        setConversionData([
          { stage: "Leads", count: total, rate: 100 },
          { stage: "Qualified", count: qualified, rate: total > 0 ? Number(((qualified / total) * 100).toFixed(1)) : 0 },
          { stage: "Booked", count: booked, rate: qualified > 0 ? Number(((booked / qualified) * 100).toFixed(1)) : 0 },
          { stage: "Won", count: won, rate: booked > 0 ? Number(((won / booked) * 100).toFixed(1)) : 0 },
        ]);
      }

      if (summaries.length > 0 || payments.length > 0) {
        const summary = summaries[summaries.length - 1] as FinancialSummary | undefined;
        if (summary?.revenue_by_channel) {
          const chData = Object.entries(summary.revenue_by_channel).map(([ch, rev]) => ({
            channel: ch.charAt(0).toUpperCase() + ch.slice(1),
            leads: leads.filter((l: Lead) => l.channel === ch).length,
            conversions: leads.filter((l: Lead) => l.channel === ch && l.status === 'won').length,
            revenue: Number(rev),
          }));
          if (chData.length > 0) setChannelPerformance(chData);
        }
      }

      setLoading(false);
    });
  }, [business]);

  const totalLeads = conversionData[0]?.count || 0;
  const totalPaid = conversionData[3]?.count || 0;
  const overallConversion = totalLeads > 0 ? ((totalPaid / totalLeads) * 100).toFixed(1) : "0.0";
  const bestChannel = [...channelPerformance].sort((a, b) => b.leads - a.leads)[0];
  const totalRevenue = channelPerformance.reduce((s, c) => s + c.revenue, 0);
  const avgDealSize = totalPaid > 0 ? (totalRevenue / totalPaid).toFixed(0) : "0";

  return (
    <div className="h-full p-8 space-y-6 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1>Analytics</h1>
        <p className="text-muted-foreground">Connected insights across your entire business</p>
      </div>

      <div className="grid grid-cols-4 gap-6 shrink-0">
        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Conversion Rate</span>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <div className="space-y-1">
            <span className="text-3xl font-semibold text-green-600">{loading ? '...' : `${overallConversion}%`}</span>
            <p className="text-sm text-muted-foreground">Lead to paid</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Avg Deal Size</span>
            <DollarSign className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <span className="text-3xl font-semibold">{loading ? '...' : `$${avgDealSize}`}</span>
            <p className="text-sm text-muted-foreground">Per customer</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Time to Convert</span>
            <Clock className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <span className="text-3xl font-semibold">{loading ? '...' : '8 days'}</span>
            <p className="text-sm text-muted-foreground">Average</p>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Top Channel</span>
            <Users className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <span className="text-3xl font-semibold">{loading ? '...' : (bestChannel?.channel || 'N/A')}</span>
            <p className="text-sm text-muted-foreground">{bestChannel ? `${Math.round((bestChannel.leads / (totalLeads || 1)) * 100)}% of leads` : 'No data'}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
      <div className="p-6 border border-border rounded-xl bg-card">
        <h3 className="mb-6">Conversion Funnel</h3>
        <div className="space-y-6">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading data...</div>
          ) : (
          conversionData.map((stage, i) => {
            const dropoff = i > 0 ? conversionData[i - 1].count - stage.count : 0;
            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{stage.stage}</span>
                    <span className="text-sm text-muted-foreground">{stage.count} leads</span>
                    {i > 0 && <span className="text-sm text-red-600">-{dropoff} dropped</span>}
                  </div>
                  <span className="font-medium">{stage.rate}%</span>
                </div>
                <div className="relative h-12 bg-muted rounded-lg overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-green-500 flex items-center justify-center text-white transition-all"
                    style={{ width: `${stage.rate}%` }}
                  >
                    {stage.rate >= 30 && <span className="text-sm font-medium">{stage.count} leads</span>}
                  </div>
                </div>
              </div>
            );
          }))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="p-6 border border-border rounded-xl bg-card">
          <h3 className="mb-6">Revenue by Channel</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={channelPerformance}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="channel" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="revenue" fill="hsl(var(--chart-2))" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card">
          <h3 className="mb-6">Time to Conversion Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={defaultTimeToConv}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Line type="monotone" dataKey="avgDays" stroke="hsl(var(--chart-1))" strokeWidth={3} name="Avg Days" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-6 border border-border rounded-xl bg-card">
        <h3 className="mb-6">Channel Performance Comparison</h3>
        <div className="space-y-6">
          {channelPerformance.map((channel) => {
            const conversionRate = ((channel.conversions / channel.leads) * 100).toFixed(1);
            const avgRevenue = (channel.revenue / channel.conversions).toFixed(0);
            return (
              <div key={channel.channel} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4>{channel.channel}</h4>
                  <div className="flex gap-6 text-sm">
                    <div>
                      <span className="text-muted-foreground">Leads: </span>
                      <span className="font-medium">{channel.leads}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Conversions: </span>
                      <span className="font-medium">{channel.conversions}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Revenue: </span>
                      <span className="font-medium">${channel.revenue.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-accent/50">
                    <p className="text-sm text-muted-foreground mb-1">Conversion Rate</p>
                    <p className="text-xl font-semibold">{conversionRate}%</p>
                  </div>
                  <div className="p-4 rounded-lg bg-accent/50">
                    <p className="text-sm text-muted-foreground mb-1">Avg Deal Value</p>
                    <p className="text-xl font-semibold">${avgRevenue}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-accent/50">
                    <p className="text-sm text-muted-foreground mb-1">Total Revenue</p>
                    <p className="text-xl font-semibold">${(channel.revenue / 1000).toFixed(1)}k</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
