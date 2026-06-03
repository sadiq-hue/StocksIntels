import { createBrowserRouter, redirect } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { LoginPage } from "./pages/LoginPage";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { StockAnalysisPage } from "./pages/StockAnalysisPage";
import { SignalsPage } from "./pages/SignalsPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import MarketPage from "./pages/MarketPage";
import { StocksPage } from "./pages/StocksPage";
import { NewsPage } from "./pages/NewsPage";
import { FinancialsPage } from "./pages/FinancialsPage";
import { ChatPage } from "./pages/ChatPage";
import { GroupPage } from "./pages/GroupPage";
import { PeoplePage } from "./pages/PeoplePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SectorsPage } from "./pages/SectorsPage";
import { NotificationsPage } from "./pages/NotificationsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LandingPage,
  },
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/app",
    Component: MainLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: "markets", Component: MarketPage },
      { path: "stocks", Component: StocksPage },
      { path: "sectors", Component: SectorsPage },
      { path: "stock/:ticker", Component: StockAnalysisPage },
      { path: "signals", Component: SignalsPage },
      { path: "news", Component: NewsPage },
      { path: "financials", Component: FinancialsPage },
      { path: "chat", Component: ChatPage },
      { path: "groups", Component: GroupPage },
      { path: "people", Component: PeoplePage },
      { path: "watchlist", Component: WatchlistPage },
      { path: "portfolio", Component: PortfolioPage },
      { path: "notifications", Component: NotificationsPage },
      { path: "settings", Component: SettingsPage }, 
    ],
  },
  { path: "/markets", loader: () => redirect("/app/markets") },
  { path: "/stocks", loader: () => redirect("/app/stocks") },
  { path: "/sectors", loader: () => redirect("/app/sectors") },
  { path: "/signals", loader: () => redirect("/app/signals") },
  { path: "/news", loader: () => redirect("/app/news") },
  { path: "/financials", loader: () => redirect("/app/financials") },
  { path: "/chat", loader: () => redirect("/app/chat") },
  { path: "/people", loader: () => redirect("/app/people") },
  { path: "/watchlist", loader: () => redirect("/app/watchlist") },
  { path: "/portfolio", loader: () => redirect("/app/portfolio") },
  { path: "/notifications", loader: () => redirect("/app/notifications") },
  { path: "/settings", loader: () => redirect("/app/settings") },
]);
