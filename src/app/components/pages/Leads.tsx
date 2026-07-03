import { useEffect, useState, useCallback } from "react";
import { Search, Filter, Plus, X, CheckCircle2, Clock, User, Bot } from "lucide-react";
import { api, type Lead, type Deal, type Conversation as ApiConversation } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

type DealCard = { id: number; leadId?: string; dealId?: string; name: string; company: string; value: number; source: string; avatar: string; };

const initials = (name: string) =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

export function Leads() {
  const { business } = useBusiness();
  const [dealsByStage, setDealsByStage] = useState<Record<string, DealCard[]>>({ new: [], qualified: [], negotiation: [], won: [], lost: [] });
  const [stats, setStats] = useState({ totalValue: 0, avgDeal: 0, winRate: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<DealCard | null>(null);
  const [leadDetail, setLeadDetail] = useState<Lead | null>(null);
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!business) return;
    Promise.all([
      api.deals.list({ business_id: business.id }).catch(() => null),
      api.leads.list({ business_id: business.id }).catch(() => null),
    ]).then(([dealsRes, leadsRes]) => {
      const deals: Deal[] = dealsRes?.rows ?? [];
      const leads: Lead[] = leadsRes?.leads ?? [];

      if (deals.length === 0 && leads.length === 0) { setLoading(false); return; }

      const grouped: Record<string, DealCard[]> = { new: [], qualified: [], negotiation: [], won: [], lost: [] };

      if (deals.length > 0) {
        deals.forEach((d: Deal) => {
          const stageKey = d.status === 'new' ? 'new' : d.status === 'qualified' ? 'qualified' : d.status === 'booked' ? 'negotiation' : d.status === 'won' ? 'won' : 'lost';
          grouped[stageKey].push({
            id: parseInt(d.id.slice(0, 8), 16) % 10000,
            leadId: d.lead_id,
            dealId: d.id,
            name: d.title || `Deal ${d.id.slice(0, 6)}`,
            company: d.currency,
            value: d.amount,
            source: d.notes?.slice(0, 20) || 'Manual',
            avatar: initials(d.title || d.id),
          });
        });
      } else {
        leads.forEach((l: Lead) => {
          const stageKey = l.status === 'new' ? 'new' : l.status === 'contacted' || l.status === 'qualified' ? 'qualified' : l.status === 'booked' ? 'negotiation' : l.status === 'won' ? 'won' : 'lost';
          grouped[stageKey].push({
            id: parseInt(l.id.slice(0, 8), 16) % 10000,
            leadId: l.id,
            name: l.name || `Lead ${l.id.slice(0, 6)}`,
            company: (l.metadata as any)?.company || l.source_ref || l.channel,
            value: l.score * 100,
            source: l.channel,
            avatar: initials(l.name || l.id),
          });
        });
      }

      setDealsByStage(grouped);
      const allGroups = [...grouped.new, ...grouped.qualified, ...grouped.negotiation, ...grouped.won, ...grouped.lost];
      const totalVal = allGroups.reduce((sum, d) => sum + d.value, 0);
      setStats({
        totalValue: totalVal,
        avgDeal: allGroups.length > 0 ? Math.round(totalVal / allGroups.length) : 0,
        winRate: allGroups.length > 0 ? Math.round((grouped.won.length / allGroups.length) * 100) : 0,
        active: grouped.new.length + grouped.qualified.length + grouped.negotiation.length,
      });
      setLoading(false);
    });
  }, [business]);

  const openDetail = useCallback(async (card: DealCard) => {
    setSelectedCard(card);
    setDetailLoading(true);
    setLeadDetail(null);
    setConversations([]);
    if (card.leadId) {
      try {
        const [leadRes, convRes] = await Promise.all([
          api.leads.get(card.leadId),
          api.whatsapp.messages(card.leadId).catch(() => null),
        ]);
        setLeadDetail(leadRes);
        if (convRes) setConversations(convRes.messages);
      } catch (err) {
        console.error('Failed to load lead detail:', err);
      }
    }
    setDetailLoading(false);
  }, []);

  const closeDetail = () => {
    setSelectedCard(null);
    setLeadDetail(null);
    setConversations([]);
  };

  const stages = [
    { id: "new", title: "New", deals: dealsByStage.new, color: "bg-gray-100" },
    { id: "qualified", title: "Qualified", deals: dealsByStage.qualified, color: "bg-blue-100" },
    { id: "negotiation", title: "Negotiation", deals: dealsByStage.negotiation, color: "bg-purple-100" },
    { id: "won", title: "Won", deals: dealsByStage.won, color: "bg-green-100" },
    { id: "lost", title: "Lost", deals: dealsByStage.lost, color: "bg-red-100" },
  ];

  const meta = leadDetail?.metadata as Record<string, any> || {};
  const scoreBreakdown = {
    intent: meta.intent ?? (leadDetail ? Math.min(leadDetail.score + 10, 100) : 65),
    budget: meta.budget ?? (leadDetail?.score ?? 55),
    timeline: meta.timeline ?? (leadDetail ? Math.max(leadDetail.score - 10, 0) : 45),
    authority: meta.authority ?? (leadDetail ? Math.min(leadDetail.score + 5, 100) : 60),
  };
  const tags: string[] = meta.tags || (leadDetail ? [leadDetail.channel.charAt(0).toUpperCase() + leadDetail.channel.slice(1)] : ['WhatsApp']);
  const activities = conversations.slice(-5).map(c => ({
    type: c.direction === 'inbound' ? 'inbound' : 'ai',
    content: c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content,
    time: formatTimeAgo(c.sent_at),
  }));
  const checklist = meta.checklist || [
    { item: "Budget confirmed", completed: (leadDetail?.score ?? 0) > 60 },
    { item: "Timeline discussed", completed: (leadDetail?.score ?? 0) > 40 },
    { item: "Decision maker identified", completed: (leadDetail?.score ?? 0) > 70 },
    { item: "Demo scheduled", completed: leadDetail?.status === 'booked' || leadDetail?.status === 'won' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      <div className={`flex-1 p-8 space-y-6 min-h-0 flex flex-col overflow-hidden ${selectedCard ? 'min-w-0' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <h1>Deals Pipeline</h1>
            <p className="text-muted-foreground">Track leads through your sales process</p>
          </div>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add Deal
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input type="text" placeholder="Search deals by name or company..." className="w-full pl-10 pr-4 py-2 rounded-lg bg-input-background border border-border" />
          </div>
          <button className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filter
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="flex gap-4 overflow-x-auto h-full pb-4">
          {stages.map((stage) => (
            <div key={stage.id} className="flex-shrink-0 w-80 flex flex-col h-full">
              <div className="mb-4 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h3>{stage.title}</h3>
                  <span className="px-2 py-1 rounded-full bg-muted text-sm">{stage.deals.length}</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full ${stage.color}`} style={{ width: "60%" }} />
                </div>
              </div>
              <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    onClick={() => openDetail(deal)}
                    className={`p-4 border rounded-xl bg-card hover:shadow-md transition-all cursor-pointer ${
                      selectedCard?.id === deal.id ? 'border-primary ring-1 ring-primary' : 'border-border'
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm flex-shrink-0">
                        {deal.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{deal.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{deal.company}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-green-600">${deal.value.toLocaleString()}</span>
                      <span className="text-xs px-2 py-1 rounded-full bg-muted">{deal.source}</span>
                    </div>
                  </div>
                ))}
                <button className="w-full p-3 border border-dashed border-border rounded-xl text-muted-foreground hover:bg-accent/50 transition-colors flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add deal
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-6 shrink-0">
          <div className="p-6 border border-border rounded-xl bg-card">
            <p className="text-muted-foreground mb-2">Total Pipeline Value</p>
            <p className="text-2xl font-semibold">${stats.totalValue.toLocaleString()}</p>
          </div>
          <div className="p-6 border border-border rounded-xl bg-card">
            <p className="text-muted-foreground mb-2">Average Deal Size</p>
            <p className="text-2xl font-semibold">${stats.avgDeal.toLocaleString()}</p>
          </div>
          <div className="p-6 border border-border rounded-xl bg-card">
            <p className="text-muted-foreground mb-2">Win Rate</p>
            <p className="text-2xl font-semibold">{stats.winRate}%</p>
          </div>
          <div className="p-6 border border-border rounded-xl bg-card">
            <p className="text-muted-foreground mb-2">Active Deals</p>
            <p className="text-2xl font-semibold">{stats.active}</p>
          </div>
        </div>
      </div>

      {/* Lead Detail Panel */}
      {selectedCard && (
        <div className="w-96 border-l border-border bg-background p-6 space-y-6 overflow-y-auto flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3>Lead Details</h3>
            <button onClick={closeDetail} className="p-1 rounded hover:bg-accent transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {detailLoading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
          ) : (
            <>
              {/* Lead Details */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{leadDetail?.name || selectedCard.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="text-blue-600">{meta.email || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p>{leadDetail?.phone_number || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Company</p>
                  <p>{meta.company || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">WhatsApp</p>
                  <p>{leadDetail?.phone_number || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p>{meta.location || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Source</p>
                  <p>{leadDetail?.channel ? leadDetail.channel.charAt(0).toUpperCase() + leadDetail.channel.slice(1) : selectedCard.source}</p>
                </div>
              </div>

              {/* Lead Score */}
              <div>
                <h4 className="mb-3">Lead Score</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${leadDetail?.score || 55}%` }} />
                    </div>
                    <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                      {leadDetail?.score || 55}/100
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Intent:</span>
                      <span className="font-medium">{scoreBreakdown.intent}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Budget:</span>
                      <span className="font-medium">{scoreBreakdown.budget}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Timeline:</span>
                      <span className="font-medium">{scoreBreakdown.timeline}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Authority:</span>
                      <span className="font-medium">{scoreBreakdown.authority}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div>
                <h4 className="mb-3">Status</h4>
                <div className="space-y-2">
                  <select
                    value={leadDetail?.status || 'new'}
                    className="w-full px-3 py-2 rounded-lg bg-input-background border border-border text-sm"
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="qualified">Qualified</option>
                    <option value="booked">Booked</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </select>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Active</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <span>Awaiting response</span>
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4>Tags</h4>
                  <button className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200">+ Add</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag, i) => (
                    <span key={i} className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm flex items-center gap-1">
                      {tag}
                      <button className="ml-1 text-blue-500 hover:text-blue-700">×</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Qualification Checklist */}
              <div>
                <h4 className="mb-3">Qualification Checklist</h4>
                <div className="space-y-2">
                  {checklist.map((item: any, index: number) => (
                    <label key={index} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={item.completed} className="rounded border-border" />
                      <span className={item.completed ? "line-through text-muted-foreground" : ""}>{item.item}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div>
                <h4 className="mb-3">Recent Activity</h4>
                <div className="space-y-3">
                  {activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent activity</p>
                  ) : activities.map((act, i) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${act.type === 'ai' ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div className="flex-1">
                        <p className="flex items-center gap-1">
                          {act.type === 'ai' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          <span className="font-medium text-xs text-muted-foreground">{act.type === 'ai' ? 'AI' : 'Inbound'}:</span>
                        </p>
                        <p className="text-muted-foreground">{act.content}</p>
                        <p className="text-xs text-muted-foreground">{act.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
