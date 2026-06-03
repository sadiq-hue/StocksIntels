import { createBrowserRouter, RouterProvider, Link } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import MarketPage from "./pages/MarketPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { SignalsPage } from "./pages/SignalsPage";
import { AIInsightsPage } from "./pages/AIInsightsPage";
import { PeoplePage } from "./pages/PeoplePage";
import { GroupPage } from "./pages/GroupPage";
import { NewsPage } from "./pages/NewsPage";
import { FinancialsPage } from "./pages/FinancialsPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { PricingPage } from "./pages/PricingPage";
import { SubscriptionPage } from "./pages/SubscriptionPage";
import { StockAnalysisPage } from "./pages/StockAnalysisPage";
import { StocksPage } from "./pages/StocksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SectorsPage } from "./pages/SectorsPage";
import { ChatPage } from "./pages/ChatPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { BondsPage } from "./pages/BondsPage";
import { ETFsPage } from "./pages/ETFsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SupportCenterPage } from "./pages/SupportCenterPage";

function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <p className="text-xl text-gray-600">Page not found</p>
        <p className="text-sm text-gray-400">The page you're looking for doesn't exist or has been moved.</p>
        <Link to="/app/dashboard" className="inline-block mt-4 px-6 py-2 bg-[#0D7490] text-white rounded-lg text-sm font-medium hover:bg-[#0A5F7A] transition-colors">
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
    errorElement: <NotFoundPage />,
  },
  {
    path: "/login",
    element: <LoginPage />,
    errorElement: <NotFoundPage />,
  },
  {
    path: "/pricing",
    element: <PricingPage />,
    errorElement: <NotFoundPage />,
  },
  {
    path: "/subscribe/:planId",
    element: <SubscriptionPage />,
    errorElement: <NotFoundPage />,
  },
  {
    path: "/app",
    element: <MainLayout />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "markets", element: <MarketPage /> },
      { path: "stocks", element: <StocksPage /> },
      { path: "watchlist", element: <WatchlistPage /> },
      { path: "signals", element: <SignalsPage /> },
      { path: "ai-insights", element: <AIInsightsPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "groups", element: <GroupPage /> },
      { path: "news", element: <NewsPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "financials", element: <FinancialsPage /> },
      { path: "portfolio", element: <PortfolioPage /> },
      { path: "stock/:ticker", element: <StockAnalysisPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "sectors", element: <SectorsPage /> },
      { path: "bonds", element: <BondsPage /> },
      { path: "etfs", element: <ETFsPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "support", element: <SupportCenterPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}