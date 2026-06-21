import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  TrendingUp, TrendingDown, Search, RefreshCcw, Landmark,
  BarChart3, Building2, Briefcase, CalendarDays, Percent,
  DollarSign, LineChart, ChevronDown, ChevronUp, ExternalLink,
  Info, Clock, TrendingUp as ArrowUpRight,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface Bond {
  id: string; type: string; issuer: string; name: string;
  coupon: number; maturity: string; ytm: number; price: number;
  currency: string; rating: string; amountIssued: number; description: string;
  cbkCode?: string; cusip?: string;
  lastUpdated: string; change: number; changePercent: number; changeDirection: string;
  dataSource?: string;
}

interface YieldPoint { term: string; kenya: number; us: number; }

interface AccessMethod {
  method: string; description: string; link: string | null;
}

const MARKET_ACCESS_INFO: Record<string, { title: string; description: string }> = {
  Government: { title: "Government Bonds", description: "Sovereign debt issued by national governments. Lowest risk, fixed coupon payments." },
  Infrastructure: { title: "Infrastructure Bonds", description: "Tax-free bonds issued to fund infrastructure projects. Attractive for high-tax-bracket investors." },
  Corporate: { title: "Corporate Bonds", description: "Debt issued by companies. Higher yield than government bonds with varying credit risk." },
  "T-Bill": { title: "Treasury Bills", description: "Short-term government securities (91-364 days). Zero coupon, sold at discount. Most liquid fixed income instrument." },
};

export function BondsPage() {
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [summary, setSummary] = useState<{ kenya10Y: number; kenya10YChange: number; us10Y: number; us10YChange: number; kenyaTbill91D: number; kenyaTbill91DChange: number; lastUpdated: string; hasLiveData: boolean; yieldCurve: YieldPoint[] } | null>(null);
  const [access, setAccess] = useState<AccessMethod[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<"kenya" | "global">("kenya");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expandedBond, setExpandedBond] = useState<string | null>(null);
  const [showAccess, setShowAccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [bondsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/bonds?market=${market}`),
        fetch(`${API_URL}/bonds/summary`),
      ]);
      setBonds(await bondsRes.json());
      setSummary(await summaryRes.json());
    } catch (e) {
      console.error("Failed to load bonds:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [market]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [market]);

  const loadAccess = async (type: string) => {
    if (showAccess === type) { setShowAccess(null); return; }
    setShowAccess(type);
    try {
      const res = await fetch(`${API_URL}/bonds/${type}/access?market=${market}`);
      const data = await res.json();
      setAccess(data.methods);
    } catch { setAccess([]); }
  };

  const filtered = bonds.filter(b => {
    if (typeFilter !== "all" && b.type !== typeFilter) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase()) && !b.issuer.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatAmount = (v: number, c: string) => {
    const inBillions = v / 1000000000;
    return `${c === "KES" ? "KSh" : "$"}${inBillions.toFixed(1)}B`;
  };

  const getRatingColor = (r: string) => {
    if (r.startsWith("AAA") || r.startsWith("AA")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (r.startsWith("A") || r.startsWith("BBB")) return "bg-blue-100 text-blue-700 border-blue-200";
    if (r.startsWith("BB")) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const getTypeIcon = (t: string) => {
    switch (t) {
      case "Government": return <Landmark className="size-4" />;
      case "Infrastructure": return <Building2 className="size-4" />;
      case "Corporate": return <Briefcase className="size-4" />;
      case "T-Bill": return <BarChart3 className="size-4" />;
      default: return <Briefcase className="size-4" />;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Bonds</h2>
          <p className="text-sm text-muted-foreground">Fixed income securities — government bonds, T-bills, and corporate debt</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-muted transition-colors">
          <RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">KE 10-Year Yield</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-foreground">{summary.kenya10Y.toFixed(2)}%</p>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${summary.kenya10YChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {summary.kenya10YChange >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {summary.kenya10YChange >= 0 ? "+" : ""}{summary.kenya10YChange.toFixed(2)}%
              </span>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">US 10-Year Yield</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-foreground">{summary.us10Y.toFixed(2)}%</p>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${summary.us10YChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {summary.us10YChange >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {summary.us10YChange >= 0 ? "+" : ""}{summary.us10YChange.toFixed(2)}%
              </span>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">KE 91-Day T-Bill</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-foreground">{summary.kenyaTbill91D.toFixed(2)}%</p>
              <span className={`flex items-center gap-0.5 text-xs font-medium ${summary.kenyaTbill91DChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {summary.kenyaTbill91DChange >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {summary.kenyaTbill91DChange >= 0 ? "+" : ""}{summary.kenyaTbill91DChange.toFixed(2)}%
              </span>
            </div>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">KE-US Spread</p>
            <p className="text-2xl font-bold text-foreground">{(summary.kenya10Y - summary.us10Y).toFixed(2)}%</p>
            <p className="text-[10px] text-amber-600 font-medium mt-1">Risk premium</p>
          </Card>
        </div>
      )}

      {summary?.lastUpdated && (
        <div className="flex items-center gap-3">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="size-3" /> Last updated: {new Date(summary.lastUpdated).toLocaleTimeString()} &middot; Auto-refreshes every 30s
          </p>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider ${summary.hasLiveData ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
            {summary.hasLiveData ? '● Live' : '● CBK Auction'}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-muted rounded-lg p-1">
          <button onClick={() => setMarket("kenya")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${market === "kenya" ? "bg-[#0D7490] text-white" : "text-muted-foreground hover:text-foreground"}`}>Kenya</button>
          <button onClick={() => setMarket("global")} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${market === "global" ? "bg-[#0D7490] text-white" : "text-muted-foreground hover:text-foreground"}`}>Global</button>
        </div>
        <div className="flex bg-muted rounded-lg p-1">
          {["all", "Government", "Infrastructure", "Corporate", "T-Bill"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${typeFilter === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t === "all" ? "All" : t}</button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bonds..." className="pl-9" />
        </div>
      </div>

      {/* Bond List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-5 animate-pulse"><div className="h-4 bg-muted rounded w-3/4 mb-3" /><div className="h-3 bg-muted rounded w-1/2 mb-2" /><div className="h-3 bg-muted rounded w-2/3" /></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(bond => {
            const isExpanded = expandedBond === bond.id;
            const isPositive = bond.changeDirection === 'up';
            const info = MARKET_ACCESS_INFO[bond.type];

            return (
              <Card key={bond.id} className="overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-lg bg-muted flex items-center justify-center">
                        {getTypeIcon(bond.type)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-foreground">{bond.name}</h3>
                        <p className="text-xs text-muted-foreground">{bond.issuer}</p>
                      </div>
                    </div>
                    <Badge className={getRatingColor(bond.rating)}>{bond.rating}</Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Coupon</p>
                      <p className="text-sm font-bold text-foreground">{bond.coupon}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">YTM</p>
                      <div className="flex items-center justify-center gap-1">
                        <p className="text-sm font-bold text-[#0D7490]">{bond.ytm.toFixed(2)}%</p>
                        <span className={`text-[9px] ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                          {isPositive ? "▲" : "▼"}
                        </span>
                      </div>
                      {bond.dataSource === 'live' && <span className="text-[8px] text-emerald-600 font-semibold uppercase tracking-wider">Live</span>}
                      {bond.dataSource === 'cbk' && <span className="text-[8px] text-blue-600 font-semibold uppercase tracking-wider">CBK</span>}
                      {bond.dataSource === 'estimated' && <span className="text-[8px] text-amber-600 font-semibold uppercase tracking-wider">Est.</span>}
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Price</p>
                      <p className="text-sm font-bold text-foreground">{bond.price.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Maturity</p>
                      <p className="text-sm font-bold text-foreground">{bond.maturity.substring(0, 7)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CalendarDays className="size-3" /> {bond.maturity}</span>
                    <span className="flex items-center gap-1"><DollarSign className="size-3" /> {formatAmount(bond.amountIssued, bond.currency)}</span>
                    <span className="flex items-center gap-1"><Percent className="size-3" /> {bond.type}</span>
                  </div>

                  {bond.description && <p className="text-xs text-muted-foreground mt-2 italic">{bond.description}</p>}

                  <button
                    onClick={() => setExpandedBond(isExpanded ? null : bond.id)}
                    className="flex items-center gap-1 text-xs text-[#0D7490] font-medium mt-2 hover:underline"
                  >
                    {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    {isExpanded ? "Hide" : "Show"} market access
                  </button>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Info className="size-3 text-[#0D7490]" />
                        <p className="text-xs font-semibold text-foreground">{info?.title || bond.type} — How to Access</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mb-2">{info?.description}</p>
                      <div className="space-y-2">
                        {(bond.type === 'Government' ? (market === 'kenya' ? [
                          { method: 'CBK Primary Auction', description: 'Bid through Central Bank of Kenya weekly auctions. Minimum KSh 50,000.', link: 'https://www.centralbank.go.ke/securities/' },
                          { method: 'NSE Secondary Market', description: 'Trade via any licensed stockbroker on the NSE Fixed Income Market.', link: 'https://www.nse.co.ke' },
                          { method: 'M-Akiba', description: 'Buy from KSh 3,000 via M-Akiba mobile platform.', link: 'https://www.m-akiba.go.ke' },
                        ] : [
                          { method: 'TreasuryDirect', description: 'Buy US Treasuries directly. Minimum $100.', link: 'https://www.treasurydirect.gov' },
                          { method: 'Brokerage', description: 'Trade via IBKR, Schwab, Fidelity. Search by CUSIP.', link: null },
                        ]) : bond.type === 'T-Bill' ? (market === 'kenya' ? [
                          { method: 'CBK Weekly Auction', description: 'Bid every Wednesday. 91/182/364 day maturities.', link: 'https://www.centralbank.go.ke/securities/' },
                          { method: 'M-Akiba', description: 'Buy from KSh 3,000.', link: 'https://www.m-akiba.go.ke' },
                        ] : [
                          { method: 'TreasuryDirect', description: 'Buy T-Bills directly. Minimum $100.', link: 'https://www.treasurydirect.gov' },
                        ]) : bond.type === 'Corporate' ? (market === 'kenya' ? [
                          { method: 'NSE FISOM', description: 'Trade corporate bonds on NSE Fixed Income Market via a stockbroker.', link: 'https://www.nse.co.ke' },
                        ] : [
                          { method: 'Brokerage Bond Desk', description: 'Search corporate bonds by issuer/rating on your broker\'s platform.', link: null },
                        ]) : []
                        ).map((m, i) => (
                          <div key={i} className="p-2.5 rounded-lg bg-muted/50">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-xs font-medium text-foreground">{m.method}</p>
                                <p className="text-[10px] text-muted-foreground">{m.description}</p>
                              </div>
                              {m.link && (
                                <a href={m.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="shrink-0 p-1 hover:bg-muted rounded">
                                  <ExternalLink className="size-3 text-[#0D7490]" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-1 md:col-span-2 text-center py-12 text-muted-foreground text-sm">No bonds match your filters.</div>
          )}
        </div>
      )}

      {/* Yield Curve */}
      {summary && (
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2"><LineChart className="size-5 text-[#0D7490]" /> Yield Curve</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="text-left py-2 text-muted-foreground font-medium">Term</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Kenya</th>
                <th className="text-right py-2 text-muted-foreground font-medium">US</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Spread</th>
              </tr></thead>
              <tbody>
                {summary.yieldCurve.map(p => {
                  const spread = p.kenya - p.us;
                  return (
                    <tr key={p.term} className="border-b border-muted hover:bg-muted/50">
                      <td className="py-2.5 text-foreground font-medium">{p.term}</td>
                      <td className="py-2.5 text-right text-foreground">{p.kenya.toFixed(2)}%</td>
                      <td className="py-2.5 text-right text-foreground">{p.us.toFixed(2)}%</td>
                      <td className={`py-2.5 text-right font-medium ${spread > 8 ? "text-amber-600" : "text-foreground"}`}>+{spread.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
