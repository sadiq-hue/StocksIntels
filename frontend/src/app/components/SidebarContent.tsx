import { Link, useLocation } from "react-router";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Signal, PieChart, Star,
  LineChart, Newspaper, FileText, MessageSquare, Users,
  BarChart3, Briefcase, Layers, User, LifeBuoy, Cpu,
  DollarSign,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
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
        { path: "/app/signals/engine", icon: Cpu, label: "Engine" },
        { path: "/app/news", icon: Newspaper, label: "News" },
        { path: "/app/financials", icon: FileText, label: "Financials" },
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

  return (
    <>
      <div className="p-6">
        <div className="flex items-center gap-3">
          <img src="/logo1.jpg" alt="" className="size-8 rounded-lg object-cover" />
          <div className="flex-1 min-w-0">
            <p className="text-muted-foreground text-xs">African & Global Markets</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          {marketStatus && ["nse", "global"].map((m) => {
            const s = marketStatus[m as "nse" | "global"];
            return (
              <div key={m} className={`flex flex-col items-center px-3 py-1.5 rounded-lg border flex-1 ${s.open ? "bg-green-50 border-green-200" : "bg-sidebar-accent border-sidebar-border"}`}>
                <span className={`text-[10px] font-semibold uppercase ${s.open ? "text-green-700" : "text-muted-foreground"}`}>
                  {m.toUpperCase()}
                </span>
                <span className={`text-[11px] font-medium ${s.open ? "text-green-600" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-6 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider px-3 mb-2">
              {section.title}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all ${
                    isActive(item.path)
                      ? "bg-[#0D7490] text-white shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="bg-sidebar-accent p-3 rounded-lg border border-sidebar-border">
          <p className="text-muted-foreground text-xs mb-1">Market Status</p>
          {marketStatus ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${marketStatus.nse.open ? 'bg-[#10B981] animate-pulse' : 'bg-muted-foreground'}`}></div>
                <span className="text-sidebar-foreground text-sm font-medium">NSE</span>
                <span className={`text-xs ml-auto ${marketStatus.nse.open ? 'text-[#10B981]' : 'text-muted-foreground'}`}>
                  {marketStatus.nse.label} · {marketStatus.nse.eventLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${marketStatus.global.open ? 'bg-[#10B981] animate-pulse' : 'bg-muted-foreground'}`}></div>
                <span className="text-sidebar-foreground text-sm font-medium">Global</span>
                <span className={`text-xs ml-auto ${marketStatus.global.open ? 'text-[#10B981]' : 'text-muted-foreground'}`}>
                  {marketStatus.global.label} · {marketStatus.global.eventLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-muted-foreground rounded-full"></div>
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
