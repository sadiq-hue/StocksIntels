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
import { MarketMoversPage } from "./pages/MarketMoversPage";
import { NewsPage } from "./pages/NewsPage";
import { FinancialsPage } from "./pages/FinancialsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SectorsPage } from "./pages/SectorsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { IpoPage } from "./pages/IpoPage";
import { DevelopersPage } from "./pages/DevelopersPage";
import { ApiDocsPage } from "./pages/developers/ApiDocsPage";
import { SdksPage } from "./pages/developers/SdksPage";
import { PlaygroundPage } from "./pages/developers/PlaygroundPage";
import { AuthGuidePage } from "./pages/developers/AuthGuidePage";
import { ApiPricingPage } from "./pages/developers/ApiPricingPage";
import { ApiKeysPage } from "./pages/developers/ApiKeysPage";
// import { DerivativesPage } from "./pages/DerivativesPage"; // Derivatives page disabled
import { AdminStocks } from "./pages/AdminStocks";
import { SignalEnginePage } from "./pages/SignalEnginePage";
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
    path: "/developers/docs",
    Component: ApiDocsPage,
  },
  {
    path: "/developers/sdks",
    Component: SdksPage,
  },
  {
    path: "/developers/playground",
    Component: PlaygroundPage,
  },
  {
    path: "/developers/auth",
    Component: AuthGuidePage,
  },
  {
    path: "/developers/pricing",
    Component: ApiPricingPage,
  },
  {
    path: "/developers/api-keys",
    Component: ApiKeysPage,
  },
  {
    path: "/developers",
    Component: DevelopersPage,
  },
  {
    path: "/app",
    Component: MainLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: "markets", Component: MarketPage },
      { path: "market-movers", Component: MarketMoversPage },
      { path: "stocks", Component: StocksPage },
      { path: "sectors", Component: SectorsPage },
      { path: "stock/:ticker", Component: StockAnalysisPage },
      { path: "signals", Component: SignalsPage },
      { path: "news", Component: NewsPage },
      { path: "financials", Component: FinancialsPage },
      { path: "watchlist", Component: WatchlistPage },
      { path: "portfolio", Component: PortfolioPage },
      { path: "notifications", Component: NotificationsPage },
      { path: "settings", Component: SettingsPage }, 
      { path: "ipos", Component: IpoPage },
      // { path: "derivatives", Component: DerivativesPage },
      { path: "dashboard", loader: () => redirect("/app") },
      { path: "admin/stocks", Component: AdminStocks },
      { path: "signals/engine", Component: SignalEnginePage },
    ],
  },
  { path: "/markets", loader: ({ request }) => redirect(`/app/markets${new URL(request.url).search}`) },
  { path: "/stocks", loader: ({ request }) => redirect(`/app/stocks${new URL(request.url).search}`) },
  { path: "/sectors", loader: ({ request }) => redirect(`/app/sectors${new URL(request.url).search}`) },
  { path: "/signals", loader: ({ request }) => redirect(`/app/signals${new URL(request.url).search}`) },
  { path: "/signals/engine", loader: ({ request }) => redirect(`/app/signals/engine${new URL(request.url).search}`) },
  { path: "/news", loader: ({ request }) => redirect(`/app/news${new URL(request.url).search}`) },
  { path: "/financials", loader: ({ request }) => redirect(`/app/financials${new URL(request.url).search}`) },
  { path: "/watchlist", loader: ({ request }) => redirect(`/app/watchlist${new URL(request.url).search}`) },
  { path: "/portfolio", loader: ({ request }) => redirect(`/app/portfolio${new URL(request.url).search}`) },
  { path: "/notifications", loader: ({ request }) => redirect(`/app/notifications${new URL(request.url).search}`) },
  { path: "/settings", loader: ({ request }) => redirect(`/app/settings${new URL(request.url).search}`) },
]);
