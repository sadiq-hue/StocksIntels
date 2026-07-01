import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router";
import {
  ArrowRight, BarChart3, Menu, X, Star, Users, Award,
  CheckCircle2, Phone, Mail, MapPin, Twitter, Linkedin, Github, ChevronUp,
  ChevronRight, Clock, TrendingUp,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useRealtimeQuotes } from "../contexts/RealtimeQuotesContext";

function StockChartBg() {
  const path = useMemo(() => {
    const points = [
      { x: 0, y: 70 }, { x: 5, y: 65 }, { x: 10, y: 68 }, { x: 15, y: 55 }, { x: 20, y: 58 },
      { x: 25, y: 45 }, { x: 30, y: 50 }, { x: 35, y: 40 }, { x: 40, y: 35 }, { x: 45, y: 38 },
      { x: 50, y: 30 }, { x: 55, y: 33 }, { x: 60, y: 28 }, { x: 65, y: 32 }, { x: 70, y: 25 },
      { x: 75, y: 20 }, { x: 80, y: 22 }, { x: 85, y: 18 }, { x: 90, y: 15 }, { x: 95, y: 18 },
      { x: 100, y: 12 },
    ];
    const d = points.map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cx = (prev.x + p.x) / 2;
      const cy = (prev.y + p.y) / 2;
      return `Q ${cx} ${cy} ${p.x} ${p.y}`;
    }).join(" ");
    return d;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute bottom-0 left-0 w-full h-[80%] opacity-[0.1]"
        viewBox="0 0 100 80"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0D7490" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#0D7490" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L 100 80 L 0 80 Z`} fill="url(#chart-gradient)" />
        <path
          d={path}
          fill="none"
          stroke="#0D7490"
          strokeWidth="0.6"
        />
      </svg>
      <svg
        className="absolute bottom-0 right-0 w-[60%] h-[60%] opacity-[0.07]"
        viewBox="0 0 100 80"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chart-gradient-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0" />
            <stop offset="50%" stopColor="#0EA5E9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M 0 60 Q 20 50 40 55 T 80 30 T 100 25 L 100 80 L 0 80 Z`} fill="url(#chart-gradient-2)" />
        <path d="M 0 60 Q 20 50 40 55 T 80 30 T 100 25" fill="none" stroke="#0EA5E9" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

const floatingShapes = [
  { size: 60, top: "8%", left: "3%", delay: 0, depth: 1 },
  { size: 40, top: "18%", right: "5%", delay: 1.2, depth: 3 },
  { size: 90, top: "50%", left: "1%", delay: 0.7, depth: 2 },
  { size: 35, top: "70%", right: "3%", delay: 1.8, depth: 1 },
  { size: 50, top: "35%", left: "12%", delay: 0.3, depth: 3 },
  { size: 30, top: "82%", left: "18%", delay: 2.2, depth: 2 },
  { size: 45, top: "12%", left: "45%", delay: 0.5, depth: 3 },
  { size: 35, top: "42%", right: "15%", delay: 1.5, depth: 2 },
  { size: 55, top: "60%", left: "30%", delay: 0.9, depth: 1 },
  { size: 25, top: "28%", right: "22%", delay: 2.5, depth: 3 },
];

const features = [
  {
    title: "Market Intelligence for NSE & Global Stocks",
    description: "AI-powered buy, sell, and hold recommendations on Safaricom, Equity, KCB, EABL, plus NYSE and NASDAQ stocks. Updated throughout the trading day.",
    stat: "50+ NSE + global",
  },
  {
    title: "Real-Time Market Data",
    description: "Live prices, bid-ask spreads, and volume data across NSE, NYSE, NASDAQ, and LSE. See the same data institutional traders use.",
    stat: "< 1s refresh",
  },
  {
    title: "Portfolio Analytics",
    description: "Track your real and paper portfolios. See your P&L, sector allocation, and risk exposure across all your holdings in one place.",
    stat: "Real-time P&L",
  },
  {
    title: "Price Alerts",
    description: "Set alerts for when Safaricom hits your target or when a US stock moves more than you expect. Get notified via email and in-app.",
    stat: "Instant alerts",
  },
  {
    title: "Paper Trading",
    description: "Practice trading NSE and US stocks with KES 1M virtual cash. Test strategies before risking real money. No broker account needed.",
    stat: "KES 1M virtual",
  },
  {
    title: "Market Scanner",
    description: "Screen NSE and US stocks by price, volume, sector, and technical indicators. Find opportunities you would otherwise miss scrolling through individual charts.",
    stat: "10+ filters",
  },
];

const steps = [
  { step: "01", title: "Create Your Account", description: "Sign up with your email. Start your trial today." },
  { step: "02", title: "Explore the Markets", description: "Browse NSE and US stocks, check AI insights, set up your watchlist. Start with paper trading if you are new." },
  { step: "03", title: "Trade with Confidence", description: "Use AI market intelligence alongside your own research. Track your performance and refine your strategy over time." },
];

const testimonials = [
  {
    name: "Caleb S.",
    role: "Retail trader, Nairobi",
    content: "I was relying on tips from Twitter groups before. Now I get daily AI market intelligence on my watchlist stocks. It does not replace my own research but it saves hours of screen time.",
    rating: 5,
    initials: "CS",
  },
  {
    name: "Joseph K.",
    role: "Part-time investor, Mombasa",
    content: "The paper trading feature helped me learn without losing real money. After three months of practicing, I felt ready to open a live brokerage account.",
    rating: 5,
    initials: "JK",
  },
  {
    name: "Paya W.",
    role: "Freelancer, Nairobi",
    content: "I check the insights on my phone during lunch breaks. The price alerts are what I use most — they ping me when Safaricom or Equity hit my targets.",
    rating: 4,
    initials: "PW",
  },
];

const whyChoose = [
  { title: "Built for NSE & Global Traders", description: "We cover Nairobi Securities Exchange alongside NYSE, NASDAQ, and LSE. One platform for local and international stocks." },
  { title: "AI Trained on Both Markets", description: "Our models train on NSE and US market data. Kenyan and global market patterns differ — our intelligence respects both." },
  { title: "No Fancy Jargon", description: "We explain recommendations in plain English. Buy, sell, or hold — with a short reason why. You stay in control of your decisions." },
  { title: "Local Support", description: "Based in Nairobi. If something breaks or you have a question, you get a response from someone who understands the Kenyan market." },
];

const faqs = [
  { q: "Which NSE stocks does StocksIntels cover?", a: "We cover all actively traded NSE stocks including Safaricom (SCOM), Equity Group (EQTY), KCB Group (KCB), EABL (EABL), Co-op Bank (COOP), Absa Kenya (ABSA), BAT Kenya (BAT), and 50+ more. Global stocks on NYSE and NASDAQ are also available." },
  { q: "How accurate is the AI market intelligence?", a: "Our models achieve around 70-75% directional accuracy on NSE stocks. We do not claim 92% — no honest provider does. We show you our reasoning and let you decide." },
  { q: "Can I try before I pay?", a: "Yes. Every paid plan comes with a 7-day trial. You'll get full access to your chosen plan for 7 days." },
  { q: "Do I need a broker account?", a: "Not to start. The paper trading feature gives you KES 1M in virtual cash to practice. When you are ready, you can connect your broker or trade manually based on the recommendations." },
  { q: "Is there a mobile app?", a: "The web app works on mobile browsers. We do not have an iOS or Android app yet but the site is fully responsive and works on phone screens." },
];

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [visibleSections, setVisibleSections] = useState<Set<number>>(new Set());
  const { getQuote } = useRealtimeQuotes();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  useEffect(() => {
    const observers = sectionRefs.current.map((el, i) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set(prev).add(i));
          }
        },
        { threshold: 0.1 }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach((obs) => obs?.disconnect());
  }, []);

  const setSectionRef = (i: number) => (el: HTMLDivElement | null) => {
    sectionRefs.current[i] = el;
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderFloatingShapes = () => floatingShapes.map((shape, i) => {
    const depthFactor = shape.depth * 6;
    const tx = (mousePos.x - window.innerWidth / 2) / depthFactor;
    const ty = (mousePos.y - window.innerHeight / 2) / depthFactor;
    return (
      <div
        key={i}
        className="absolute rounded-full bg-[#0D7490]/[0.06]"
        style={{
          top: shape.top,
          left: shape.left ?? undefined,
          right: shape.right ?? undefined,
          width: shape.size,
          height: shape.size,
          animation: `float-3d ${8 + shape.delay * 1.5}s ease-in-out infinite`,
          animationDelay: `${shape.delay}s`,
          transform: `translate3d(${tx}px, ${ty}px, 0)`,
          willChange: "transform",
        }}
      />
    );
  });

  return (
    <div className="min-h-screen bg-white selection:bg-[#0D7490]/20 relative">
      {/* Full-page floating stock elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {renderFloatingShapes()}
      </div>

      {/* HEADER */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-700 ${
        scrolled ? "bg-white/80 backdrop-blur-xl shadow-lg border-b border-gray-100/80" : "bg-transparent"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16 md:h-20">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="size-9 md:size-10 rounded-xl overflow-hidden shadow-lg group-hover:scale-105 transition-all duration-300">
                <img src="/logo1.jpg" alt="" className="size-full object-cover" />
              </div>
              <span className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">StocksIntels</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {["Features", "Testimonials", "Pricing", "Contact"].map((item) => (
                <a key={item} href={`#${item.toLowerCase()}`}
                  className="text-sm font-medium text-gray-600 hover:text-[#0D7490] transition-colors">
                  {item}
                </a>
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <Link to="/login">
                <Button variant="ghost" className="text-gray-600 hover:text-[#0D7490] font-medium">Sign In</Button>
              </Link>
              <Link to="/login">
                <Button className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white shadow-lg font-medium px-6">
                  Get Started
                </Button>
              </Link>
            </div>

            <button className="md:hidden p-2.5 rounded-xl hover:bg-gray-100 text-gray-600" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-gray-100 shadow-xl">
            <div className="px-4 py-6 space-y-1">
              {["Features", "Testimonials", "Pricing", "Contact"].map((item) => (
                <a key={item} href={`#${item.toLowerCase()}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-xl text-base font-medium text-gray-600 hover:text-[#0D7490] hover:bg-gray-50">
                  {item}
                </a>
              ))}
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <Link to="/login" className="block w-full" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full">Sign In</Button>
                </Link>
                <Link to="/login" className="block w-full" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-[#0D7490] text-white">Get Started</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section ref={heroRef} className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
        <div className="absolute inset-0">
          <StockChartBg />
        </div>

        {/* Stock Ticker Strip */}
        <div className="relative z-10 mb-12 overflow-hidden">
          <div className="flex whitespace-nowrap animate-[ticker_30s_linear_infinite]">
            {(() => {
              const tickerSymbols = [
                { sym: "SCOM", fallback: "17.50", fallbackChange: "+0.0%", up: true, isNse: true },
                { sym: "EQTY", fallback: "79.25", fallbackChange: "+0.0%", up: true, isNse: true },
                { sym: "KCB", fallback: "76.75", fallbackChange: "+0.0%", up: true, isNse: true },
                { sym: "EABL", fallback: "263.50", fallbackChange: "+0.0%", up: true, isNse: true },
                { sym: "AAPL", fallback: "283.72", fallbackChange: "-4.5%", up: false, isNse: false },
                { sym: "TSLA", fallback: "391.59", fallbackChange: "-3.3%", up: false, isNse: false },
                { sym: "MSFT", fallback: "377.86", fallbackChange: "+2.9%", up: true, isNse: false },
                { sym: "GOOGL", fallback: "347.11", fallbackChange: "-0.7%", up: false, isNse: false },
                { sym: "NVDA", fallback: "192.87", fallbackChange: "+0.0%", up: true, isNse: false },
              ];
              const items = tickerSymbols.map(t => {
                const q = getQuote(t.sym) || getQuote(`NSE:${t.sym}`);
                return {
                  sym: t.sym,
                  price: q?.price ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.fallback,
                  change: q?.changePercent != null ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(1)}%` : t.fallbackChange,
                  up: q?.changePercent != null ? q.changePercent >= 0 : t.up,
                  currency: t.isNse ? "KSh" : "$",
                };
              });
              return [...items, ...items].map((s, i) => (
                <div key={i} className="flex items-center gap-2 px-5 py-1.5 bg-white/60 backdrop-blur-sm border border-gray-100 rounded-lg mx-1.5 shrink-0">
                  <span className="font-bold text-xs text-gray-900">{s.sym}</span>
                  <span className="text-xs text-gray-600">{s.currency}{s.price}</span>
                  <span className={`text-xs font-semibold ${s.up ? "text-emerald-600" : "text-red-500"}`}>{s.change}</span>
                </div>
              ));
            })()}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#0D7490]/10 rounded-full mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-semibold text-[#0D7490]">Live market data</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-[1.1] tracking-tight">
                Trade smarter with{" "}
                <span className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] bg-clip-text text-transparent">AI-powered</span>{" "}
                stock intelligence
              </h1>

              <p className="text-lg sm:text-xl text-gray-600 mb-8 max-w-xl leading-relaxed">
                Real-time prices, market intelligence, and portfolio tracking for{" "}
                <span className="font-semibold text-gray-900">10,000+ stocks</span> across NSE, NYSE, NASDAQ, and LSE. From Safaricom to Tesla.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/login">
                  <Button size="lg" className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-8 py-6 text-base shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-0.5 font-semibold">
                    Start Free Trial
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <a href="#features">
                  <Button variant="outline" size="lg" className="border-gray-300 text-gray-700 hover:bg-gray-50 px-8 py-6 text-base font-medium">
                    See How It Works
                  </Button>
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-6 text-gray-400">
                {["Real-time data", "AI-powered insights", "Portfolio tracking"].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Stock Cards */}
            <div className="hidden lg:block relative">
              {/* Main dashboard card */}
              {(() => {
                const scom = getQuote("SCOM") || getQuote("NSE:SCOM");
                const price = scom?.price ?? 17.50;
                const chg = scom?.changePercent ?? 2.3;
                const isUp = chg >= 0;
                return (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-[#0D7490]/10 p-6 relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${isUp ? 'bg-emerald-100' : 'bg-red-100'} rounded-xl flex items-center justify-center`}>
                        <TrendingUp className={`w-5 h-5 ${isUp ? 'text-emerald-600' : 'text-red-600'}`} />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">SCOM</p>
                        <p className="text-xs text-gray-500">Safaricom PLC</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">KES {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className={`text-sm font-semibold ${isUp ? 'text-emerald-600' : 'text-red-600'}`}>{isUp ? '+' : ''}{chg.toFixed(1)}% today</p>
                    </div>
                  </div>
                {/* Mini chart */}
                <svg className="w-full h-24" viewBox="0 0 400 80">
                  <defs>
                    <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0D7490" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#0D7490" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 60 Q20 55 40 58 T80 50 T120 45 T160 48 T200 35 T240 38 T280 30 T320 32 T360 25 T400 20 L400 80 L0 80 Z" fill="url(#heroGrad)" />
                  <path d="M0 60 Q20 55 40 58 T80 50 T120 45 T160 48 T200 35 T240 38 T280 30 T320 32 T360 25 T400 20" fill="none" stroke="#0D7490" strokeWidth="2.5" />
                  <circle cx="400" cy="20" r="4" fill="#0D7490" />
                </svg>
                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>9:30 AM</span>
                  <span>10:15 AM</span>
                  <span>11:00 AM</span>
                  <span>12:30 PM</span>
                  <span>Now</span>
                </div>
              </div>
                );
              })()}

              {/* Floating mini cards */}
              {(() => {
                const cards = [
                  { sym: "AAPL", fallback: "+3.2", color: "blue", anim: "animate-[float-3d_6s_ease-in-out_infinite]", pos: "-top-6 -right-4" },
                  { sym: "NVDA", fallback: "+4.1", color: "purple", anim: "animate-[float-3d_7s_ease-in-out_infinite] animation-delay-1s", pos: "-bottom-4 -left-6" },
                  { sym: "EQTY", fallback: "+1.1", color: "emerald", anim: "animate-[float-3d_8s_ease-in-out_infinite] animation-delay-2s", pos: "top-1/2 -right-8" },
                ];
                return cards.map(c => {
                  const q = getQuote(c.sym);
                  const chg = q?.changePercent ?? parseFloat(c.fallback);
                  const isUp = chg >= 0;
                  return (
                    <div key={c.sym} className={`absolute ${c.pos} bg-white rounded-xl border border-gray-200 shadow-xl p-3 ${c.anim}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 bg-${c.color}-100 rounded-lg flex items-center justify-center`}>
                          <TrendingUp className={`w-4 h-4 text-${c.color}-600`} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">{c.sym}</p>
                          <p className={`text-[10px] font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>{isUp ? '+' : ''}{chg.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Quick stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-2xl mx-auto">
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">10,000+</p>
              <p className="text-sm text-gray-500">stocks across 4 exchanges</p>
            </div>
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">7</p>
              <p className="text-sm text-gray-500">days trial</p>
            </div>
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-[#0D7490]">KES</p>
              <p className="text-sm text-gray-500">local currency support</p>
            </div>
          </div>

          {/* Markets we cover */}
          <div className="mt-12 pt-8 border-t border-gray-100">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-widest mb-5 text-center">Markets we cover</p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
              {[
                { label: "NSE", sub: "Nairobi Securities Exchange", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
                { label: "NYSE", sub: "New York Stock Exchange", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
                { label: "NASDAQ", sub: "Nasdaq Stock Market", color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
                { label: "LSE", sub: "London Stock Exchange", color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
              ].map((m) => (
                <div key={m.label} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg ${m.bg} ${m.border} border`}>
                  <span className={`font-black text-lg tracking-tight ${m.color}`}>{m.label}</span>
                  <span className="text-xs text-gray-500 hidden sm:block">{m.sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative py-20 lg:py-28 bg-gray-50/80 overflow-hidden" ref={setSectionRef(2)}>
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #0D7490 1px, transparent 0)`,
          backgroundSize: "40px 40px",
        }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`text-center max-w-3xl mx-auto mb-14 transition-all duration-700 ${visibleSections.has(2) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Tools that help you trade NSE and global stocks better</h2>
            <p className="text-lg text-gray-600">No fluff. Just practical features for the Kenyan market.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, idx) => (
              <div key={feature.title} className="group bg-white rounded-xl p-6 border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-xl hover:shadow-[#0D7490]/5 transition-all duration-500 hover:-translate-y-1"
                style={{ animation: `fade-in-up 0.6s ease-out ${idx * 0.1}s forwards`, opacity: 0 }}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-[#0D7490] transition-colors duration-300">{feature.title}</h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-[#0D7490]/10 text-[#0D7490] group-hover:bg-[#0D7490] group-hover:text-white transition-all duration-300">
                    {feature.stat}
                  </span>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed group-hover:text-gray-900 transition-colors duration-300">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 lg:py-28 bg-white" ref={setSectionRef(3)}>
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(3) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Getting started takes five minutes</h2>
            <p className="text-lg text-gray-600">Sign up, explore the markets, and start using AI market intelligence — no broker or credit card needed.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((item, idx) => (
              <div key={item.step} className="text-center group"
                style={{ animation: `fade-in-up 0.6s ease-out ${idx * 0.15}s forwards`, opacity: 0 }}>
                <div className="w-14 h-14 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:shadow-xl group-hover:shadow-[#0D7490]/20 group-hover:scale-110 transition-all duration-300">
                  <span className="text-white font-bold text-lg">{item.step}</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-[#0D7490] transition-colors duration-300">{item.title}</h3>
                <p className="text-gray-600 max-w-xs mx-auto leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-14">
            <Link to="/login">
              <Button size="lg" className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-10 py-6 text-base shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-0.5 font-semibold">
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* WHY CHOOSE US */}
      <section className="relative py-20 lg:py-28 bg-gray-50/80 overflow-hidden" ref={setSectionRef(4)}>
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `linear-gradient(45deg, #0D7490 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
        }} />
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(4) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Built for traders in Kenya, not Silicon Valley</h2>
            <p className="text-lg text-gray-600">Most trading platforms ignore African markets. We built StocksIntels because Kenyan traders deserve better tools — whether you trade Safaricom or Apple.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
            {whyChoose.map((item, idx) => (
              <div key={item.title} className="group bg-white rounded-xl p-6 border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-lg hover:shadow-[#0D7490]/5 transition-all duration-500 hover:-translate-y-1"
                style={{ animation: `fade-in-up 0.5s ease-out ${idx * 0.1}s forwards`, opacity: 0 }}>
                <h4 className="font-bold text-gray-900 mb-1.5 group-hover:text-[#0D7490] transition-colors duration-300">{item.title}</h4>
                <p className="text-gray-600 text-sm leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className="py-20 lg:py-28 bg-white" ref={setSectionRef(5)}>
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(5) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">What users say</h2>
            <p className="text-lg text-gray-600">People using StocksIntels to track and trade NSE stocks.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {testimonials.map((t, i) => (
              <div key={i} className="group bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-xl hover:shadow-[#0D7490]/5 hover:-translate-y-1 transition-all duration-500"
                style={{ animation: `fade-in-up 0.5s ease-out ${i * 0.15}s forwards`, opacity: 0 }}>
                <div className="flex gap-1 mb-4">
                  {[...Array(t.rating)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed text-sm group-hover:text-gray-900 transition-colors duration-300">{t.content}</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-gray-700 font-bold text-sm">
                    {t.initials}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                    <p className="text-gray-500 text-xs">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="relative py-20 lg:py-28 bg-gray-50/80 overflow-hidden" ref={setSectionRef(6)}>
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #0D7490 1px, transparent 0)`,
          backgroundSize: "30px 30px",
        }} />
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(6) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="text-center max-w-3xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Simple pricing. Start your trial today.</h2>
            <p className="text-lg text-gray-600">Try any plan free for 7 days.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {/* Starter */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-xl hover:shadow-[#0D7490]/5 hover:-translate-y-1 transition-all duration-500"
              style={{ animation: `fade-in-up 0.5s ease-out 0s forwards`, opacity: 0 }}>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Starter</h3>
              <p className="text-sm text-gray-500 mb-4">Retail investors</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$9.9</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/pricing">
                <Button variant="outline" className="w-full mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
                  Start Trial
                </Button>
              </Link>
              <div className="space-y-2">
                {["Real-time NSE + global data", "5 AI insights per day", "Stock screener", "Portfolio tracking"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pro */}
            <div className="bg-gray-900 text-white rounded-xl p-6 border border-gray-900 shadow-xl scale-[1.02] z-10 hover:shadow-2xl hover:shadow-[#0D7490]/10 transition-all duration-500"
              style={{ animation: `fade-in-up 0.5s ease-out 0.1s forwards`, opacity: 0 }}>
              <div className="mb-2">
                <span className="bg-[#0D7490] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                  Most Popular
                </span>
              </div>
              <h3 className="text-xl font-bold mb-1">Pro</h3>
              <p className="text-sm text-gray-400 mb-4">Active traders</p>
              <div className="mb-4">
                <span className="text-3xl font-bold">$19.9</span>
                <span className="text-gray-400 text-sm">/mo</span>
              </div>
              <Link to="/pricing">
                <Button className="w-full mb-4 bg-white text-gray-900 hover:bg-gray-100 shadow-xl font-semibold cursor-pointer">
                  Start Trial
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
              <div className="space-y-2">
                {["Unlimited AI insights", "NSE + global data", "Advanced charting", "Risk scoring"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-white/70 flex-shrink-0" />
                    <span className="text-xs text-gray-200">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Premium */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-xl hover:shadow-[#0D7490]/5 hover:-translate-y-1 transition-all duration-500"
              style={{ animation: `fade-in-up 0.5s ease-out 0.2s forwards`, opacity: 0 }}>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Premium</h3>
              <p className="text-sm text-gray-500 mb-4">NSE-focused traders</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$49.9</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/pricing">
                <Button variant="outline" className="w-full mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">
                  Start Trial
                </Button>
              </Link>
              <div className="space-y-2">
                {["Unlimited NSE insights", "10 global insights/day", "Advanced NSE screener", "Technical analysis"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center mt-10">
            <Link to="/pricing" className="inline-flex items-center gap-1 text-[#0D7490] font-semibold hover:text-[#0A5F7A] transition-colors text-sm">
              View full comparison <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 lg:py-28 bg-white" ref={setSectionRef(7)}>
        <div className={`max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(7) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Common questions</h2>
            <p className="text-lg text-gray-600">Honest answers about what StocksIntels does and does not do.</p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-[#0D7490]/30 transition-all duration-300"
                style={{ animation: `fade-in-up 0.4s ease-out ${i * 0.08}s forwards`, opacity: 0 }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left cursor-pointer"
                >
                  <span className="font-semibold text-gray-900 text-sm">{faq.q}</span>
                  <div className={`w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 transition-all duration-300 ${openFaq === i ? "bg-[#0D7490] rotate-90" : ""}`}>
                    <ChevronRight className={`w-3.5 h-3.5 transition-colors duration-300 ${openFaq === i ? "text-white" : "text-gray-400"}`} />
                  </div>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-48" : "max-h-0"}`}>
                  <p className="px-5 pb-5 text-gray-600 text-sm leading-relaxed">{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="py-20 lg:py-28 bg-gray-50/80" ref={setSectionRef(8)}>
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 transition-all duration-700 ${visibleSections.has(8) ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Get in touch</h2>
              <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                Questions about the platform? Found a bug? Want to suggest a feature? Reach out — we reply within 24 hours.
              </p>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-md transition-all duration-300">
                  <div className="w-10 h-10 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                    <Phone className="w-5 h-5 text-[#0D7490]" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Phone</p>
                    <a href="tel:+254792754435" className="text-gray-900 font-semibold hover:text-[#0D7490]">+254 792 754 435</a>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-md transition-all duration-300">
                  <div className="w-10 h-10 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-[#0D7490]" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Email</p>
                    <a href="mailto:support@stocksintels.com" className="text-gray-900 font-semibold hover:text-[#0D7490]">support@stocksintels.com</a>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-md transition-all duration-300">
                  <div className="w-10 h-10 bg-[#0D7490]/10 rounded-lg flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-[#0D7490]" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Location</p>
                    <p className="text-gray-900 font-semibold">Nairobi, Kenya</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 lg:p-8 shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-300">
              <h3 className="text-xl font-bold text-gray-900 mb-2">Send us a message</h3>
              <p className="text-gray-600 text-sm mb-6">We will get back to you within 24 hours.</p>
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <input type="text" placeholder="Your name" className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-2 focus:ring-[#0D7490]/10 outline-none transition-all text-sm" />
                  <input type="email" placeholder="Your email" className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-2 focus:ring-[#0D7490]/10 outline-none transition-all text-sm" />
                </div>
                <input type="text" placeholder="Subject" className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-2 focus:ring-[#0D7490]/10 outline-none transition-all text-sm" />
                <textarea rows={4} placeholder="Tell us more..." className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-2 focus:ring-[#0D7490]/10 outline-none transition-all text-sm resize-none" />
                <Button className="w-full py-3 bg-[#0D7490] hover:bg-[#0A5F7A] text-white font-semibold shadow-lg transition-all duration-300 hover:-translate-y-0.5 cursor-pointer">
                  Send Message
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="py-16 lg:py-20 bg-gradient-to-r from-[#0D7490] to-[#0A5F7A] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `radial-gradient(circle at 20px 20px, white 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }} />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">Start your trial today</h2>
          <p className="text-lg text-white/80 mb-8 max-w-2xl mx-auto leading-relaxed">
            Try any plan free for 7 days. Cancel anytime. Join other Kenyan traders using AI-powered market intelligence for NSE and global stocks.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login">
              <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 px-10 py-6 text-base font-bold shadow-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-3xl cursor-pointer">
                Start Trial
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <a href="#contact">
              <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 px-10 py-6 text-base font-medium backdrop-blur-sm cursor-pointer">
                Contact Us
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-950 text-white pt-14 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12 mb-10">
            <div className="col-span-2 md:col-span-1">
              <Link to="/" className="flex items-center gap-2 mb-3 group">
                <div className="size-8 rounded-lg overflow-hidden group-hover:scale-110 transition-transform duration-300">
                  <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
                </div>
                <span className="text-base font-bold">StocksIntels</span>
              </Link>
              <p className="text-gray-500 text-xs leading-relaxed mb-4">AI-powered market intelligence for NSE and global equities.</p>
              <div className="flex items-center gap-2">
                {[{ icon: Twitter, href: "#" }, { icon: Linkedin, href: "#" }, { icon: Github, href: "#" }].map(({ icon: Icon }) => (
                  <a key={Icon.name} href="#" className="w-8 h-8 bg-gray-800 hover:bg-[#0D7490] rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110">
                    <Icon className="w-4 h-4 text-gray-400" />
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-4">Product</h4>
              <ul className="space-y-3">
                <li><Link to="/pricing" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Pricing</Link></li>
                <li><a href="#features" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Features</a></li>
                <li><a href="#testimonials" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Testimonials</a></li>
                <li><a href="#faq" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-4">Company</h4>
              <ul className="space-y-3">
                <li><Link to="/about" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">About</Link></li>
                <li><Link to="/blog" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Blog</Link></li>
                <li><a href="#contact" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Contact</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-4">Legal</h4>
              <ul className="space-y-3">
                <li><Link to="/privacy" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Privacy Policy</Link></li>
                <li><Link to="/terms" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Terms of Service</Link></li>
                <li><Link to="/disclaimer" className="text-sm text-gray-500 hover:text-white transition-colors duration-300">Disclaimer</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-4">Contact</h4>
              <ul className="space-y-3">
                <li>
                  <a href="tel:+254792754435" className="text-sm text-gray-500 hover:text-white transition-colors duration-300 flex items-center gap-2">
                    <Phone className="w-3 h-3" /> +254 792 754 435
                  </a>
                </li>
                <li>
                  <a href="mailto:support@stocksintels.com" className="text-sm text-gray-500 hover:text-white transition-colors duration-300 flex items-center gap-2">
                    <Mail className="w-3 h-3" /> support@stocksintels.com
                  </a>
                </li>
                <li>
                  <span className="text-sm text-gray-500 flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> Nairobi, Kenya
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-gray-600 text-xs">2026 StocksIntels. Built for NSE & global traders.</p>
            <button onClick={scrollToTop} className="w-7 h-7 bg-gray-800 hover:bg-[#0D7490] rounded-lg flex items-center justify-center transition-all duration-300 cursor-pointer">
              <ChevronUp className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        </div>
      </footer>

      {/* DISCLAIMER */}
      <div className="bg-gray-950 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <p className="text-[11px] text-gray-600 leading-relaxed">
            <strong className="text-gray-500">Risk Disclaimer:</strong> Trading stocks and other financial instruments involves substantial risk of loss. AI recommendations are for informational and educational purposes only and do not constitute financial advice. Past performance does not guarantee future results. StocksIntels is not a licensed broker or financial advisor. By using this platform, you acknowledge and accept these risks.{' '}
            <Link to="/disclaimer" className="text-gray-500 hover:text-gray-400 underline">Read full disclaimer</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
