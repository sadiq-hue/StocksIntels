import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LandingPage } from "./app/pages/LandingPage";
import { LoginPage } from "./app/pages/LoginPage";
import { DashboardPage } from "./app/pages/DashboardPage";
import MarketPage from "./app/pages/MarketPage";
import { WatchlistPage } from "./app/pages/WatchlistPage";
import { SignalsPage } from "./app/pages/SignalsPage";
import { AIInsightsPage } from "./app/pages/AIInsightsPage";
import { PeoplePage } from "./app/pages/PeoplePage";
import { GroupPage } from "./app/pages/GroupPage";
import { NewsPage } from "./app/pages/NewsPage";
import { FinancialsPage } from "./app/pages/FinancialsPage";
import { PortfolioPage } from "./app/pages/PortfolioPage";
import { PricingPage } from "./app/pages/PricingPage";
import { SubscriptionPage } from "./app/pages/SubscriptionPage";
import { StockAnalysisPage } from "./app/pages/StockAnalysisPage";
import { SettingsPage } from "./app/pages/SettingsPage";
import { SectorsPage } from "./app/pages/SectorsPage";

// A simple layout for authenticated routes (you might have a more complex one with a sidebar/navbar)
const AppLayout = ({ children }: { children: React.ReactNode }) => {
  // In a real app, you'd have a persistent navbar/sidebar here
  return <div className="pt-16">{children}</div>; // Add padding for fixed header
};

const NotFound = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-700 text-xl font-semibold">
    404 - Page Not Found
  </div>
);

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/subscribe/:planId" element={<SubscriptionPage />} />
        {/* Protected routes under /app */}
        <Route path="/app/*" element={<AppLayout />}>
          <Route index element={<DashboardPage />} /> {/* Default route for /app */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="markets" element={<MarketPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="signals" element={<SignalsPage />} />
          <Route path="ai-insights" element={<AIInsightsPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="groups" element={<GroupPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="financials" element={<FinancialsPage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="stock/:ticker" element={<StockAnalysisPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="sectors" element={<SectorsPage />} />
          <Route path="*" element={<NotFound />} /> {/* Catch-all for /app */}
        </Route>
        <Route path="*" element={<NotFound />} /> {/* Catch-all for any other unmatched routes */}
      </Routes>
    </BrowserRouter>
  );
}