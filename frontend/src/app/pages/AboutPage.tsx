import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  Eye, Heart, Users, ArrowRight, Brain, Activity, Globe2,
  LineChart, PieChart, Wallet, Star, Zap, Shield, Newspaper,
  Landmark, Rocket, Layers, Gauge, Bell, CheckCircle2,
} from "lucide-react";
import { useSEO } from "../hooks/useSEO";

const values = [
  {
    icon: Eye,
    title: "Transparency",
    description: "How our AI signals are generated — fully open about our methodologies and data sources.",
  },
  {
    icon: Heart,
    title: "Accuracy Over Hype",
    description: "We publish our real signal performance. No inflated claims, just honest results.",
  },
  {
    icon: Users,
    title: "Local First",
    description: "Built for African market hours, conditions, and infrastructure — by traders who trade these markets.",
  },
];

const team = [
  { name: "Team of Engineers", role: "Building the platform" },
  { name: "Data Scientists", role: "Training AI models on African market dynamics" },
  { name: "Finance Professionals", role: "Ensuring market accuracy and relevance" },
];

const features = [
  { icon: Brain, title: "AI Market Intelligence", description: "Daily buy, sell, and hold signals with confidence scores, entry points, and targets — trained on both African and global market dynamics." },
  { icon: Activity, title: "Real-Time Market Data", description: "Live prices, bid-ask spreads, and volume across NSE, JSE, NGX, NYSE, NASDAQ, and LSE — the same data institutional traders use." },
  { icon: Globe2, title: "African + Global Coverage", description: "One platform for Safaricom, Equity, MTN, Dangote, and Apple. Track 15+ exchanges with a single watchlist." },
  { icon: PieChart, title: "Portfolio Analytics", description: "Track real and paper portfolios with P&L, sector allocation, and risk exposure — all in one place." },
  { icon: LineChart, title: "Advanced Charting", description: "Interactive TradingView charts with technical indicators — RSI, MACD, Bollinger Bands, and moving averages." },
  { icon: Wallet, title: "Paper Trading", description: "Practice with $10,000 in virtual cash before risking real money. No broker account needed to start." },
  { icon: Bell, title: "Price Alerts", description: "Get notified by email and in-app when your watchlist stocks hit your target or move beyond expectations." },
  { icon: Star, title: "Watchlists & Screener", description: "Build personalized watchlists and screen stocks by price, volume, sector, and technical indicators." },
  { icon: Shield, title: "Financial Health", description: "Deep-dive metrics on ROE, margins, debt ratios, and valuation — clear signals on company fundamentals." },
  { icon: Landmark, title: "Bonds & Fixed Income", description: "Treasury bills, government bonds, and corporate debt data for Kenyan and global fixed-income markets." },
  { icon: Rocket, title: "IPOs & New Listings", description: "Stay ahead of upcoming IPOs and recent listings across African and global exchanges." },
  { icon: Layers, title: "ETFs & Derivatives", description: "Track exchange-traded funds, futures, and derivatives to diversify beyond single stocks." },
];

const markets = [
  { label: "NSE", name: "Nairobi Securities Exchange", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  { label: "JSE", name: "Johannesburg Stock Exchange", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  { label: "NGX", name: "Nigerian Exchange Group", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  { label: "GSE", name: "Ghana Stock Exchange", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  { label: "NYSE", name: "New York Stock Exchange", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  { label: "NASDAQ", name: "Nasdaq Stock Market", color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
  { label: "LSE", name: "London Stock Exchange", color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
];

const stats = [
  { value: "15+", label: "African & global exchanges" },
  { value: "50+", label: "NSE stocks covered" },
  { value: "< 1s", label: "Real-time data refresh" },
  { value: "7-day", label: "Free trial on every plan" },
];

export function AboutPage() {
  useSEO({
    title: "About Us",
    description: "Learn about StocksIntels, the AI-powered market intelligence platform covering African and global stock exchanges for retail and institutional investors.",
    canonical: "/about",
    keywords: "about StocksIntels, African stock market, fintech Kenya, AI market intelligence",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-xl font-bold text-foreground tracking-tight">StocksIntels</span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link to="/login">
                <Button variant="ghost" className="text-muted-foreground hover:text-[#0D7490]">Sign In</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="pt-32 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">About</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-8">About StocksIntels</h1>

          <div className="prose prose-lg max-w-none text-muted-foreground space-y-6">
            <p>
              StocksIntels was founded in Nairobi, Kenya, with a single conviction: African traders deserve the same caliber of market intelligence that institutional investors on Wall Street take for granted.
            </p>
            <p>
              We built StocksIntels to close that gap — combining real-time market data from 15+ African and global exchanges with AI models trained specifically on African market dynamics. The result is a platform that gives retail and professional traders alike the clarity, speed, and confidence to make better decisions.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">What We Offer</p>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">A complete platform for modern traders</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              From real-time prices to AI-powered signals, everything you need to research, practice, and trade African and global markets in one place.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg hover:border-[#0D7490]/20 transition-all duration-300">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <h3 className="font-bold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl md:text-4xl font-bold text-[#0D7490]">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Markets */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Markets We Cover</p>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">From Nairobi to New York</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Trade the markets you know and explore the ones you don't — all from one dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {markets.map((m) => (
              <div key={m.label} className={`flex items-center gap-3 px-5 py-3 rounded-xl ${m.bg} ${m.border} border`}>
                <span className={`font-black text-lg tracking-tight ${m.color}`}>{m.label}</span>
                <span className="text-xs text-muted-foreground hidden sm:block">{m.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">Our Mission</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              To democratize financial intelligence across Africa — making professional-grade market analysis accessible to every trader, from Nairobi to Lagos to Accra.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Our Team</p>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">Meet the People Behind StocksIntels</h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              We are a team of engineers, data scientists, and finance professionals based across East and West Africa. We understand the structural nuances of African markets — from NSE liquidity cycles to currency risk on cross-border trades — because we trade them ourselves.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {team.map((member) => (
              <div key={member.name} className="bg-card border border-border rounded-2xl p-6 text-center hover:shadow-lg transition-shadow">
                <div className="w-16 h-16 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-white" />
                </div>
                <h3 className="font-bold text-foreground">{member.name}</h3>
                <p className="text-sm text-muted-foreground">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-muted">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Our Values</p>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">What We Stand For</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {values.map((value) => {
              const Icon = value.icon;
              return (
                <div key={value.title} className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow">
                  <div className="w-12 h-12 bg-[#0D7490]/10 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <h3 className="font-bold text-foreground mb-2">{value.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] rounded-3xl p-4 md:p-6 lg:p-16 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Ready to trade smarter?</h2>
              <p className="text-lg text-white/80 mb-8">Join 2,500+ traders using AI-powered insights.</p>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-8 text-white/80 text-sm">
                {["7-day free trial", "No credit card required", "Cancel anytime"].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" /> {item}
                  </span>
                ))}
              </div>
              <Link to="/login">
                <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 dark:hover:bg-white/10 px-8 py-6 text-base font-semibold shadow-xl">
                  Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 dark:bg-[#0a0a0b] text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="size-8 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-lg font-bold">StocksIntels</span>
            </div>
            <p className="text-gray-500 text-sm">© 2026 StocksIntels. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
