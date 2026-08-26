import React, { Suspense, useEffect } from "react";
import { createBrowserRouter, RouterProvider, Link, Navigate, Outlet, useLocation } from "react-router";
import { useAuth, getTrialInfo } from "./auth/AuthContext";
import { trackPageView } from "./utils/metaPixel";
import { trackXPageView } from "./utils/xPixel";

function MetaPixelPageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView();
    trackXPageView();
  }, [location.pathname]);
  return null;
}

const MainLayout = React.lazy(() => import("./layouts/MainLayout").then(m => ({ default: m.MainLayout })));

const LandingPage = React.lazy(() => import("./pages/LandingPage").then(m => ({ default: m.LandingPage })));
const LoginPage = React.lazy(() => import("./pages/LoginPage").then(m => ({ default: m.LoginPage })));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const MarketPage = React.lazy(() => import("./pages/MarketPage"));
const WatchlistPage = React.lazy(() => import("./pages/WatchlistPage").then(m => ({ default: m.WatchlistPage })));
const SignalsPage = React.lazy(() => import("./pages/SignalsPage").then(m => ({ default: m.SignalsPage })));
const AIInsightsPage = React.lazy(() => import("./pages/AIInsightsPage").then(m => ({ default: m.AIInsightsPage })));
// const PeoplePage = React.lazy(() => import("./pages/PeoplePage").then(m => ({ default: m.PeoplePage })));
// const GroupPage = React.lazy(() => import("./pages/GroupPage").then(m => ({ default: m.GroupPage })));
const NewsPage = React.lazy(() => import("./pages/NewsPage").then(m => ({ default: m.NewsPage })));
const FinancialsPage = React.lazy(() => import("./pages/FinancialsPage").then(m => ({ default: m.FinancialsPage })));
const PortfolioPage = React.lazy(() => import("./pages/PortfolioPage").then(m => ({ default: m.PortfolioPage })));
const PricingPage = React.lazy(() => import("./pages/PricingPage").then(m => ({ default: m.PricingPage })));
const SubscriptionPage = React.lazy(() => import("./pages/SubscriptionPage").then(m => ({ default: m.SubscriptionPage })));
const StockAnalysisPage = React.lazy(() => import("./pages/StockAnalysisPage").then(m => ({ default: m.StockAnalysisPage })));
const StocksPage = React.lazy(() => import("./pages/StocksPage").then(m => ({ default: m.StocksPage })));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const SectorsPage = React.lazy(() => import("./pages/SectorsPage").then(m => ({ default: m.SectorsPage })));
// const ChatPage = React.lazy(() => import("./pages/ChatPage").then(m => ({ default: m.ChatPage })));
const NotificationsPage = React.lazy(() => import("./pages/NotificationsPage").then(m => ({ default: m.NotificationsPage })));
const BondsPage = React.lazy(() => import("./pages/BondsPage").then(m => ({ default: m.BondsPage })));
const ETFsPage = React.lazy(() => import("./pages/ETFsPage").then(m => ({ default: m.ETFsPage })));
const ProfilePage = React.lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })));
const SupportCenterPage = React.lazy(() => import("./pages/SupportCenterPage").then(m => ({ default: m.SupportCenterPage })));
const AboutPage = React.lazy(() => import("./pages/AboutPage").then(m => ({ default: m.AboutPage })));
const BlogPage = React.lazy(() => import("./pages/BlogPage").then(m => ({ default: m.BlogList })));
const BlogArticlePage = React.lazy(() => import("./pages/BlogPage").then(m => ({ default: m.BlogArticle })));
const CareersPage = React.lazy(() => import("./pages/CareersPage").then(m => ({ default: m.CareersPage })));
const PrivacyPage = React.lazy(() => import("./pages/PrivacyPage").then(m => ({ default: m.PrivacyPage })));
const TermsPage = React.lazy(() => import("./pages/TermsPage").then(m => ({ default: m.TermsPage })));
const SecurityPage = React.lazy(() => import("./pages/SecurityPage").then(m => ({ default: m.SecurityPage })));
const DisclaimerPage = React.lazy(() => import("./pages/DisclaimerPage").then(m => ({ default: m.DisclaimerPage })));
const AffiliatesPage = React.lazy(() => import("./pages/AffiliatesPage").then(m => ({ default: m.AffiliatesPage })));
const IpoPage = React.lazy(() => import("./pages/IpoPage").then(m => ({ default: m.IpoPage })));
const DerivativesPage = React.lazy(() => import("./pages/DerivativesPage").then(m => ({ default: m.DerivativesPage })));
const AdminNewsletter = React.lazy(() => import("./pages/AdminNewsletter").then(m => ({ default: m.AdminNewsletter })));


function InactivityBanner() {
  const { inactivityWarning, logout, refreshUser } = useAuth();
  if (!inactivityWarning) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-3 bg-amber-500 text-white px-4 py-3 text-sm font-medium shadow-lg">
      <span>Your session will expire in 5 minutes due to inactivity.</span>
      <button onClick={refreshUser} className="underline font-bold hover:text-amber-100">Stay Logged In</button>
      <button onClick={logout} className="underline font-bold hover:text-amber-100">Log Out Now</button>
    </div>
  );
}

function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0D7490]" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check active subscription (paid) or within 7-day trial
  const hasPaid = user.subscription_status === 'active' && user.subscription_tier !== 'free' && user.subscription_tier !== null && user.subscription_tier !== undefined;
  const trialInfo = getTrialInfo(user);
  if (!hasPaid && !trialInfo.isWithinTrial) {
    return <Navigate to="/pricing" replace />;
  }

  return (
    <>
      <InactivityBanner />
      <Outlet />
    </>
  );
}

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
    element: (
      <>
        <MetaPixelPageViewTracker />
        <Outlet />
      </>
    ),
    children: [
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
  { path: "/about", element: <AboutPage />, errorElement: <NotFoundPage /> },
  { path: "/blog", element: <BlogPage />, errorElement: <NotFoundPage /> },
  { path: "/blog/:slug", element: <BlogArticlePage />, errorElement: <NotFoundPage /> },
  { path: "/careers", element: <CareersPage />, errorElement: <NotFoundPage /> },
  { path: "/privacy", element: <PrivacyPage />, errorElement: <NotFoundPage /> },
  { path: "/terms", element: <TermsPage />, errorElement: <NotFoundPage /> },
  { path: "/security", element: <SecurityPage />, errorElement: <NotFoundPage /> },
  { path: "/disclaimer", element: <DisclaimerPage />, errorElement: <NotFoundPage /> },
  {
    path: "/app",
    element: <ProtectedRoute />,
    errorElement: <NotFoundPage />,
    children: [
      {
        element: <MainLayout />,
        children: [
      { index: true, element: <DashboardPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "markets", element: <MarketPage /> },
      { path: "stocks", element: <StocksPage /> },
      { path: "watchlist", element: <WatchlistPage /> },
      { path: "signals", element: <SignalsPage /> },
      { path: "ai-insights", element: <AIInsightsPage /> },
      // { path: "people", element: <PeoplePage /> },
      // { path: "groups", element: <GroupPage /> },
      { path: "news", element: <NewsPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "financials", element: <FinancialsPage /> },
      { path: "portfolio", element: <PortfolioPage /> },
      { path: "stock/:ticker", element: <StockAnalysisPage /> },
      // { path: "chat", element: <ChatPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "sectors", element: <SectorsPage /> },
      { path: "bonds", element: <BondsPage /> },
      { path: "ipos", element: <IpoPage /> },
      { path: "derivatives", element: <DerivativesPage /> },
      { path: "etfs", element: <ETFsPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "affiliates", element: <AffiliatesPage /> },
      { path: "support", element: <SupportCenterPage /> },
      { path: "admin/newsletter", element: <AdminNewsletter /> },

      { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
    ],
  },
]);

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0D7490]" /></div>}>
      <RouterProvider router={router} />
    </Suspense>
  );
}