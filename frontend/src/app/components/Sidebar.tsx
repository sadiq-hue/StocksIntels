import { Link, useLocation } from "react-router";
import {
  LayoutDashboard, Signal, PieChart, Star,
  LineChart, Newspaper, FileText, MessageSquare, Users,
  BarChart3, Briefcase, Layers, User, LifeBuoy,
} from "lucide-react";
export function Sidebar() {
  const location = useLocation();

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
      ],
    },
    {
      title: "Account",
      items: [
        { path: "/app/profile", icon: User, label: "Profile" },
        { path: "/app/support", icon: LifeBuoy, label: "Support Center" },
      ],
    },
  ];

  return (
    <aside className="w-64 sticky top-0 h-screen bg-white border-r border-gray-200 flex flex-col hidden md:flex overflow-y-auto">
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="bg-[#0D7490] p-2 rounded-lg">
            <img src="/logo.svg" alt="StocksIntels" className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-gray-900 font-semibold">StocksIntels</h1>
            <p className="text-gray-500 text-xs">African & Global Markets</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider px-3 mb-2">
              {section.title}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all ${
                    isActive(item.path)
                      ? "bg-[#0D7490] text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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

      <div className="p-4 border-t border-gray-200 mt-auto">
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
          <p className="text-gray-500 text-xs mb-1">Market Status</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse"></div>
            <span className="text-gray-900 text-sm">Markets Live</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
