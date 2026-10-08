import { useEffect } from "react";
import { Outlet, useLocation, Link } from "react-router";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { Toaster } from "../components/ui/sonner";
import { useAuth } from "../auth/AuthContext";
import { BeginnerModeProvider } from "../contexts/BeginnerModeContext";
import { GuidedTour } from "../components/GuidedTour";
import "../pages/DashboardTour";
import "../pages/SignalsTour";
import "../pages/FinancialsTour";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export function MainLayout() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user?.id) return;
    fetch(`${API_URL}/activity/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, action: "page_view", details: { path: location.pathname } })
    }).catch(() => {});
  }, [location.pathname, user?.id]);

  return (
    <BeginnerModeProvider>
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
          <footer className="border-t border-border px-4 md:px-6 py-6 mt-8">
            <p className="max-w-[1400px] mx-auto text-[11px] leading-relaxed text-muted-foreground">
              StocksIntels provides automated, informational market ratings based on public data. It is{" "}
              <strong className="text-foreground">not investment advice</strong> and not a recommendation or solicitation
              to buy or sell any security. Market data may be delayed. You are solely responsible for your decisions;
              verify independently and consult a licensed adviser.{" "}
              <Link to="/disclaimer" className="underline hover:text-foreground">Risk Disclaimer</Link>
              {" · "}
              <Link to="/terms" className="underline hover:text-foreground">Terms</Link>
            </p>
          </footer>
        </main>
      </div>
      <Toaster position="top-right" />
    </div>
    <GuidedTour />
    </BeginnerModeProvider>
  );
}
