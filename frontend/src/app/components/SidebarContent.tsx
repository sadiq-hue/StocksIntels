import { Link, useLocation } from "react-router";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Signal, PieChart, Star,
  LineChart, Newspaper, FileText, MessageSquare, Users,
  BarChart3, Briefcase, Layers, User, LifeBuoy,
  DollarSign, TrendingUp, GraduationCap, Lightbulb,
} from "lucide-react";
import { useBeginnerMode } from "../contexts/BeginnerModeContext";

const API_URL = import.meta.env.VITE_API_URL || "/api";

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 z-50 whitespace-nowrap rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground opacity-0 shadow-lg ring-1 ring-black/10 transition-all duration-150 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-x-0 translate-x-1">
        {label}
      </span>
    </span>
  );
}

export function SidebarContent({ onNavigate, onToggle, collapsed = false }: { onNavigate?: () => void; onToggle?: () => void; collapsed?: boolean }) {
  const location = useLocation();
  const { beginnerMode, toggleBeginnerMode } = useBeginnerMode();
  const [marketStatus, setMarketStatus] = useState<{ nse: { open: boolean; label: string; eventLabel: string }; global: { open: boolean; label: string; eventLabel: string } } | null>(null);

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${API_URL}/market/status`)
        .then((r) => r.json())
        .then(setMarketStatus)
        .catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const isActive = (path: string) => {
    if (path === "/app") return location.pathname === "/app";
    return location.pathname.startsWith(path);
  };

  const sections = [
    {
      title: "Work Space",
      items: [
        { path: "/app", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/app/portfolio", icon: PieChart, label: "Portfolio" },
        { path: "/app/watchlist", icon: Star, label: "Watchlist" },
        { path: "/app/chat", icon: MessageSquare, label: "Chat & Groups" },
        { path: "/app/people", icon: Users, label: "People" },
      ],
    },
    {
      title: "Capital Markets",
      items: [
        { path: "/app/markets", icon: BarChart3, label: "Markets" },
        { path: "/app/stocks", icon: LineChart, label: "Stocks" },
        { path: "/app/bonds", icon: Briefcase, label: "Bonds" },
        { path: "/app/etfs", icon: Layers, label: "ETFs" },
        { path: "/app/signals", icon: Signal, label: "Signals" },
        { path: "/app/news", icon: Newspaper, label: "News" },
        { path: "/app/financials", icon: FileText, label: "Financials" },
        { path: "/app/ipos", icon: TrendingUp, label: "IPOs" },
        { path: "/app/derivatives", icon: GraduationCap, label: "Derivatives" },
      ],
    },
    {
      title: "Account",
      items: [
        { path: "/app/profile", icon: User, label: "Profile" },
        { path: "/app/affiliates", icon: DollarSign, label: "Affiliates" },
        { path: "/app/support", icon: LifeBuoy, label: "Support Center" },
      ],
    },
  ];

  const NavLink = ({ item }: { item: { path: string; icon: React.ComponentType<{ className?: string }>; label: string } }) => {
    const Icon = item.icon;
    const active = isActive(item.path);
    const link = (
      <Link
        to={item.path}
        onClick={onNavigate}
        className={`relative flex items-center gap-3 rounded-xl mb-1 px-3 py-2.5 transition-all duration-200 group ${
          collapsed ? "justify-center" : ""
        } ${
          active
            ? "bg-gradient-to-r from-[#0D7490] to-[#0B5E74] text-white shadow-md shadow-[#0D7490]/25"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-white" />
        )}
        <Icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${active ? "" : "group-hover:scale-110"}`} />
        {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
      </Link>
    );
    return collapsed ? <Tooltip label={item.label}>{link}</Tooltip> : link;
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center ${collapsed ? "flex-col gap-3 py-5" : "justify-between px-5 py-4"} border-b border-sidebar-border`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
          <img src="/logo1.jpg" alt="StocksIntels" className="size-9 object-contain rounded-lg flex-shrink-0 ring-1 ring-sidebar-border" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-sidebar-foreground truncate">StocksIntels</p>
              <p className="text-[11px] text-muted-foreground leading-tight">African & Global Markets</p>
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex items-center justify-center rounded-lg text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
            collapsed ? "size-9" : "size-9"
          }`}
        >
          {collapsed ? (
            <ChevronsRight className="w-5 h-5" />
          ) : (
            <ChevronsLeft className="w-5 h-5" />
          )}
        </button>
      </div>

      {!collapsed && marketStatus && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-4">
          {["nse", "global"].map((m) => {
            const s = marketStatus[m as "nse" | "global"];
            return (
              <div key={m} className={`flex flex-col items-center px-2 py-2 rounded-xl border ${s.open ? "bg-emerald-50 border-emerald-200" : "bg-sidebar-accent border-sidebar-border"}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${s.open ? "text-emerald-700" : "text-muted-foreground"}`}>
                  {m}
                </span>
                <span className={`text-[11px] font-medium ${s.open ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider px-3 mb-2">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink key={item.path} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div className={`${collapsed ? "px-2 pb-3" : "px-4 pb-3"} border-t border-sidebar-border pt-3`}>
        <button
          onClick={toggleBeginnerMode}
          className={`group flex items-center gap-2 w-full px-3 py-2 rounded-xl text-xs transition-all duration-200 ${
            collapsed ? "justify-center" : ""
          } ${
            beginnerMode
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          }`}
        >
          <Lightbulb className={`size-4 ${beginnerMode ? 'text-amber-600' : ''}`} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left font-medium">{beginnerMode ? 'Beginner Mode ON' : 'Beginner Mode'}</span>
              <div className={`w-7 h-4 rounded-full transition-colors ${beginnerMode ? 'bg-amber-500' : 'bg-muted-foreground/30'} relative`}>
                <div className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-transform ${beginnerMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </div>
            </>
          )}
        </button>
        {!collapsed && (
          <div className="mt-3 bg-sidebar-accent p-3 rounded-xl border border-sidebar-border">
            <p className="text-muted-foreground text-[11px] mb-2 font-medium">Market Status</p>
            {marketStatus ? (
              <div className="space-y-2">
                {(["nse", "global"] as const).map((m) => {
                  const s = marketStatus[m];
                  return (
                    <div key={m} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${s.open ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
                      <span className="text-sidebar-foreground text-sm font-medium capitalize">{m}</span>
                      <span className={`text-xs ml-auto ${s.open ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
                <span className="text-muted-foreground text-sm">Loading...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
