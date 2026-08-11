import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { TrendingUp, BookOpen, AlertTriangle, Info, GraduationCap, ArrowRight, BarChart3, Globe2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface CorporateAction {
  id: number;
  ticker: string;
  exchange?: string | null;
  action_type: string;
  title: string;
  description: string | null;
  event_date: string | null;
  record_date: string | null;
  status: string;
  current_price: number | null;
  price_change: number | null;
  price_change_pct: number | null;
}

const actionIcons: Record<string, string> = {
  'dividend': '💵',
  'bonus': '🎁',
  'rights': '📜',
  'split': '✂️',
  'buyback': '🔄',
  'delisting': '🚫',
  'default': '📋',
};

const concepts = [
  {
    title: "What Are Derivatives?",
    icon: BookOpen,
    content: "Derivatives are financial contracts whose value derives from an underlying asset (stocks, currencies, commodities). On the NSE, derivatives include single-stock futures and index futures.",
    color: "blue",
  },
  {
    title: "Single-Stock Futures (SSFs)",
    icon: TrendingUp,
    content: "SSFs allow investors to buy or sell a specific stock at a predetermined price on a future date. NSE offers SSFs on top-tier companies like Safaricom, KCB, and Equity Bank. Useful for hedging or leveraged exposure.",
    color: "emerald",
  },
  {
    title: "Index Futures (NSE 25)",
    icon: BarChart3,
    content: "NSE 25 Index Futures track the performance of 25 mid-cap and large-cap stocks. Traders use them to speculate on market direction without owning individual stocks.",
    color: "purple",
  },
  {
    title: "Key Risks",
    icon: AlertTriangle,
    content: "Derivatives carry leverage risk, time decay (theta), counterparty risk, and liquidity risk. NSE derivatives market has lower liquidity than developed markets — be cautious with position sizing.",
    color: "amber",
  },
  {
    title: "Getting Started",
    icon: GraduationCap,
    content: "To trade NSE derivatives: (1) Open a CDS account with a licensed stockbroker, (2) Sign a derivatives trading agreement, (3) Maintain minimum margin requirements (~10-20% of contract value), (4) Start with SSFs before attempting index futures.",
    color: "indigo",
  },
];

export function DerivativesPage() {
  const [nseActions, setNseActions] = useState<CorporateAction[]>([]);
  const [globalActions, setGlobalActions] = useState<CorporateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'nse' | 'global'>('nse');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/nse/corporate-actions?status=pending`)
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setNseActions(d); }).catch(() => {}),
      fetch(`${API_BASE}/global/corporate-actions?status=pending`)
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setGlobalActions(d); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const actions = tab === 'nse' ? nseActions : globalActions;

  const sortedActions = [...actions].sort((a, b) => {
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return new Date(a.event_date).getTime() - new Date(b.event_date).getTime();
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-8 rounded-lg bg-purple-100 dark:bg-purple-950/40 flex items-center justify-center">
          <TrendingUp className="size-4 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Derivatives & Corporate Actions</h1>
          <p className="text-xs text-muted-foreground">Learn about derivatives and track corporate events across markets</p>
        </div>
      </div>

      {/* Educational Cards */}
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <GraduationCap className="size-4 text-purple-600 dark:text-purple-400" /> Derivatives Education
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {concepts.map((concept) => {
          const Icon = concept.icon;
          const colorMap: Record<string, string> = {
            blue: "border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20",
            emerald: "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20",
            purple: "border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-950/20",
            amber: "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20",
            indigo: "border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-950/20",
          };
          const iconColorMap: Record<string, string> = {
            blue: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/40",
            emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40",
            purple: "text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/40",
            amber: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40",
            indigo: "text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/40",
          };
          return (
            <Card key={concept.title} className={`p-4 border ${colorMap[concept.color] || ''} shadow-sm`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`size-7 rounded-lg flex items-center justify-center ${iconColorMap[concept.color] || ''}`}>
                  <Icon className="size-3.5" />
                </div>
                <h3 className="text-xs font-semibold text-foreground">{concept.title}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{concept.content}</p>
            </Card>
          );
        })}
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-4 w-fit">
        <button onClick={() => setTab('nse')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === 'nse' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          NSE Events
        </button>
        <button onClick={() => setTab('global')} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${tab === 'global' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          <Globe2 className="size-3" /> Global Events
        </button>
      </div>

      {/* Upcoming Corporate Actions */}
      <div className="flex items-center gap-2 mb-3">
        <Info className="size-4 text-purple-600 dark:text-purple-400" />
        <h2 className="text-sm font-semibold text-foreground">
          {tab === 'nse' ? 'NSE' : 'Global'} Corporate Events
        </h2>
        {loading && <span className="text-xs text-muted-foreground ml-auto">Loading...</span>}
      </div>

      {!loading && sortedActions.length === 0 && (
        <Card className="p-6 text-center border-dashed mb-6">
          <p className="text-sm text-muted-foreground">No upcoming corporate actions at this time.</p>
        </Card>
      )}

      {sortedActions.length > 0 && (
        <div className="space-y-2 mb-6">
          {sortedActions.map((action) => (
            <Card key={action.id} className="p-3 border shadow-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="text-lg">{actionIcons[action.action_type] || actionIcons.default}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground">{action.ticker}</span>
                  {action.exchange && <span className="text-[10px] text-muted-foreground">({action.exchange})</span>}
                  <Badge className="text-[10px] px-1.5 py-0 font-medium bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50">
                    {action.action_type}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{action.title}</span>
                </div>
                {action.description && <p className="text-[11px] text-muted-foreground mt-0.5">{action.description}</p>}
                {action.current_price != null && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] font-medium text-foreground">${action.current_price.toFixed(2)}</span>
                    {action.price_change_pct != null && (
                      <span className={`text-[10px] font-medium ${action.price_change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {action.price_change_pct >= 0 ? '+' : ''}{action.price_change_pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                {action.event_date && (
                  <span className="flex items-center gap-1"><ArrowRight className="size-3" />{action.event_date}</span>
                )}
                {action.record_date && (
                  <span className="text-[10px]">Record: {action.record_date}</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <Card className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border-amber-200 dark:border-amber-800/50">
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">Derivatives Risk Warning</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Derivatives trading involves substantial risk of loss and is not suitable for all investors. The NSE derivatives market
              may have limited liquidity. Always ensure you understand the terms of each contract before trading. Consider consulting
              a licensed financial advisor. Past performance of derivatives is not indicative of future results.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
