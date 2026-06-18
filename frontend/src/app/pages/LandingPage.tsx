import { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  Zap, PieChart, ArrowRight, Shield, Globe, BarChart3,
  ChevronRight, Star, Users, Award, Menu, X, Play,
  CheckCircle2, ArrowUpRight, Bell, Lock, Smartphone,
  Clock, Target, Sparkles, HeartHandshake, Check, Crown,
  Phone, Mail, MapPin, Twitter, Linkedin, Github, ChevronUp,
  LineChart, TrendingUp, Bot, AlertTriangle,
} from "lucide-react";
import { Button } from "../components/ui/button";

const features = [
  {
    icon: Zap,
    title: "Real-time Market Data",
    description: "Live NSE and global market data with instant updates and customizable watchlists for your favorite assets.",
    color: "from-[#0D7490] to-[#0EA5E9]",
    stat: "< 50ms latency",
  },
  {
    icon: Sparkles,
    title: "AI Trading Signals",
    description: "Smart buy/sell recommendations powered by advanced machine learning algorithms trained on historical data.",
    color: "from-amber-500 to-orange-500",
    stat: "92% accuracy",
  },
  {
    icon: PieChart,
    title: "Portfolio Analytics",
    description: "Track and optimize your investments with detailed analytics, risk assessment, and performance insights.",
    color: "from-purple-500 to-pink-500",
    stat: "Real-time P&L",
  },
  {
    icon: Shield,
    title: "Risk Management",
    description: "Advanced risk scoring and portfolio protection tools to safeguard your investments in volatile markets.",
    color: "from-green-500 to-emerald-500",
    stat: "VaR calculations",
  },
  {
    icon: Globe,
    title: "Multi-Market Access",
    description: "Seamlessly trade across African exchanges and international markets from a single unified platform.",
    color: "from-blue-500 to-indigo-500",
    stat: "15+ exchanges",
  },
  {
    icon: BarChart3,
    title: "Advanced Charts",
    description: "Professional-grade charting with technical indicators, drawing tools, and pattern recognition.",
    color: "from-rose-500 to-red-500",
    stat: "50+ indicators",
  },
];

const steps = [
  { step: "01", title: "Create Account", description: "Sign up in under 2 minutes with your email. No complex paperwork required.", icon: Smartphone },
  { step: "02", title: "Connect Portfolio", description: "Link your existing broker or start with our paper trading simulator.", icon: Lock },
  { step: "03", title: "Get AI Insights", description: "Receive real-time signals and analytics to make smarter trading decisions.", icon: Target },
];

const testimonials = [
  {
    name: "James Mwangi",
    role: "Day Trader, Nairobi",
    content: "The AI signals have completely transformed my trading strategy. I've seen a 40% improvement in my win rate since joining.",
    rating: 5,
    avatar: "JM",
    color: "from-blue-500 to-cyan-500",
  },
  {
    name: "Amara Okafor",
    role: "Portfolio Manager, Lagos",
    content: "Real-time NSE data and the analytics dashboard are game-changers. Best platform for African market trading.",
    rating: 5,
    avatar: "AO",
    color: "from-purple-500 to-pink-500",
  },
  {
    name: "David Mensah",
    role: "Retail Investor, Accra",
    content: "As a beginner, the AI recommendations gave me the confidence to start investing. The interface is incredibly intuitive.",
    rating: 5,
    avatar: "DM",
    color: "from-green-500 to-emerald-500",
  },
];

const trustLogos = [
  "Nairobi Securities Exchange",
  "Ghana Stock Exchange",
  "Nigerian Exchange Group",
  "Johannesburg Stock Exchange",
  "Botswana Stock Exchange",
];

const whyChoose = [
  { icon: Clock, title: "Real-Time Execution", description: "Sub-50ms data feeds ensure you never miss a market opportunity." },
  { icon: Bell, title: "Smart Alerts", description: "Get notified instantly when AI detects trading opportunities." },
  { icon: Lock, title: "Bank-Grade Security", description: "256-bit encryption and 2FA protect your data and funds." },
  { icon: HeartHandshake, title: "Local Support", description: "Dedicated support teams in Nairobi, Lagos, and Accra." },
];

const faqs = [
  { q: "What markets does StocksIntels cover?", a: "We cover all major African exchanges (NSE, GSE, NGX, JSE, BSE) plus global markets including NYSE, NASDAQ, LSE, and more." },
  { q: "How accurate are the AI trading signals?", a: "Our AI models consistently achieve 92%+ accuracy through advanced machine learning trained on decades of historical data." },
  { q: "Is there a free trial available?", a: "Yes! All plans come with a 7-day free trial. No credit card required, cancel anytime." },
  { q: "Can I connect my existing broker?", a: "Absolutely. We support integration with major brokers including Interactive Brokers, Alpaca, OANDA, and Pepperstone." },
];

function useAnimatedCounter(end: number, duration: number = 2000) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let startTime: number;
    let animationFrame: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration]);
  return count;
}

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(15)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${Math.random() * 6 + 2}px`,
            height: `${Math.random() * 6 + 2}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: i % 3 === 0 ? "#0D7490" : i % 3 === 1 ? "#0EA5E9" : "#10B981",
            opacity: Math.random() * 0.3 + 0.1,
            animation: `float ${Math.random() * 10 + 10}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 5}s`,
          }}
        />
      ))}
    </div>
  );
}

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const tradersCount = useAnimatedCounter(2500);
  const marketsCount = useAnimatedCounter(15);
  const uptimeCount = useAnimatedCounter(99);
  const accuracyCount = useAnimatedCounter(92);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const animatedStats = [
    { icon: Users, value: tradersCount, label: "Active Traders", suffix: "+" },
    { icon: Globe, value: marketsCount, label: "Markets Covered", suffix: "+" },
    { icon: TrendingUp, value: uptimeCount, label: "Uptime", suffix: "%" },
    { icon: Award, value: accuracyCount, label: "AI Accuracy", suffix: "%" },
  ];

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) translateX(0px); }
          25% { transform: translateY(-20px) translateX(10px); }
          50% { transform: translateY(-10px) translateX(-10px); }
          75% { transform: translateY(-30px) translateX(5px); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(13, 116, 144, 0.15); }
          50% { box-shadow: 0 0 40px rgba(13, 116, 144, 0.3); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float { animation: float 8s ease-in-out infinite; }
        .animate-pulse-glow { animation: pulse-glow 3s ease-in-out infinite; }
        .animate-slide-up { animation: slide-up 0.6s ease-out forwards; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
        .delay-500 { animation-delay: 0.5s; }
      `}</style>

      {/* HEADER */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? "bg-white/95 backdrop-blur-lg shadow-lg shadow-gray-200/50 border-b border-gray-100" : "bg-transparent"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16 md:h-20">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 md:w-10 md:h-10 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20 group-hover:shadow-[#0D7490]/40 group-hover:scale-105 transition-all duration-300">
                <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5 md:w-6 md:h-6" />
              </div>
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent tracking-tight">StocksIntels</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {["Features", "How It Works", "Testimonials", "Pricing", "Contact"].map((item) => (
                <a key={item} href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                  className="text-sm font-medium text-gray-600 hover:text-[#0D7490] transition-colors relative group">
                  {item}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[#0D7490] transition-all group-hover:w-full" />
                </a>
              ))}
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <Link to="/login">
                <Button variant="ghost" className="text-gray-600 hover:text-[#0D7490] hover:bg-[#0D7490]/5 font-medium">Sign In</Button>
              </Link>
              <Link to="/login">
                <Button className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white shadow-lg shadow-[#0D7490]/25 hover:shadow-xl hover:shadow-[#0D7490]/30 transition-all duration-300 font-medium px-6">
                  Get Started
                </Button>
              </Link>
            </div>

            <button className="md:hidden p-2.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-600" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden bg-white/95 backdrop-blur-lg border-b border-gray-100 shadow-xl">
            <div className="px-4 py-6 space-y-1">
              {["Features", "How It Works", "Testimonials", "Pricing", "Contact"].map((item) => (
                <a key={item} href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-xl text-base font-medium text-gray-600 hover:text-[#0D7490] hover:bg-[#0D7490]/5 transition-colors">
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
      <section className="relative min-h-screen flex items-center pt-20 pb-20 lg:pt-28 lg:pb-28 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-[-20%] right-[-10%] w-[1000px] h-[1000px] bg-gradient-to-bl from-[#0D7490]/10 via-[#0EA5E9]/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] bg-gradient-to-tr from-[#0EA5E9]/10 via-[#0D7490]/5 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#10B981]/5 rounded-full blur-3xl" />
          <FloatingParticles />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-sm font-medium mb-6 border border-[#0D7490]/10 animate-float">
                <LineChart className="w-4 h-4" />
                Market Intelligence for African traders
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-gray-900 mb-6 leading-[1.05] tracking-tight">
                Smart Trading
                <br />
                <span className="bg-gradient-to-r from-[#0D7490] via-[#0A8BA8] to-[#0EA5E9] bg-clip-text text-transparent">
                  Powered by AI
                </span>
              </h1>

              <p className="text-lg sm:text-xl text-gray-600 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Get real-time insights, comprehensive market analysis, and AI-driven signals across African and global markets. Trade with clarity, speed, and confidence.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Link to="/login">
                  <Button size="lg" className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white px-8 py-6 text-base shadow-xl shadow-[#0D7490]/25 hover:shadow-2xl hover:shadow-[#0D7490]/30 transition-all duration-300 hover:-translate-y-1 active:translate-y-0 font-semibold">
                    Start Trading Free
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <Button variant="outline" size="lg" className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 px-8 py-6 text-base transition-all duration-300 hover:-translate-y-1 active:translate-y-0 font-medium" onClick={() => setShowDemoModal(true)}>
                  <Play className="mr-2 w-4 h-4" />
                  Watch Demo
                </Button>
              </div>

              <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto lg:mx-0">
                <div className="rounded-3xl bg-white/90 border border-gray-200 p-5 shadow-sm">
                  <p className="text-3xl font-bold text-gray-900">15+</p>
                  <p className="text-sm text-gray-500 mt-2">African + global markets in one platform</p>
                </div>
                <div className="rounded-3xl bg-white/90 border border-gray-200 p-5 shadow-sm">
                  <p className="text-3xl font-bold text-gray-900">2,500+</p>
                  <p className="text-sm text-gray-500 mt-2">active traders using StocksIntels</p>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-6 justify-center lg:justify-start text-gray-400">
                {[
                  { text: "No credit card", color: "text-green-500" },
                  { text: "7-day free trial", color: "text-green-500" },
                  { text: "Cancel anytime", color: "text-green-500" },
                ].map((item) => (
                  <div key={item.text} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className={`w-4 h-4 ${item.color}`} />
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:block relative">
              <div className="relative bg-white/80 backdrop-blur-xl rounded-3xl p-4 md:p-6 shadow-2xl border border-gray-100 overflow-hidden animate-pulse-glow">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0D7490] via-[#0EA5E9] to-[#10B981]" />
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Portfolio Value</p>
                    <p className="text-2xl md:text-3xl font-bold text-gray-900">$124,592.00</p>
                  </div>
                  <div className="flex items-center gap-1 text-green-600 bg-green-50/80 px-3 py-1.5 rounded-full text-sm font-medium border border-green-100 shrink-0">
                    <ArrowUpRight className="w-4 h-4" />
                    +12.5%
                  </div>
                </div>

                <div className="h-48 bg-gradient-to-t from-[#0D7490]/10 via-[#0EA5E9]/5 to-transparent rounded-xl mb-4 relative overflow-hidden">
                  <svg className="absolute bottom-0 left-0 right-0" viewBox="0 0 400 100" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#0D7490" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="transparent" />
                      </linearGradient>
                    </defs>
                    <path d="M0,80 Q50,70 100,60 T200,40 T300,30 T400,20" fill="none" stroke="url(#chartGrad)" strokeWidth="2" />
                    <path d="M0,80 Q50,70 100,60 T200,40 T300,30 T400,20 L400,100 L0,100 Z" fill="url(#chartGrad)" opacity="0.3" />
                    <circle cx="400" cy="20" r="3" fill="#0D7490" />
                  </svg>
                  <div className="absolute top-3 left-3 flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: "NSE", value: "+2.4%", color: "text-green-600", bg: "bg-green-50" },
                    { label: "AI Signal", value: "Buy", color: "text-[#0D7490]", bg: "bg-[#0D7490]/10" },
                    { label: "Risk Score", value: "Low", color: "text-blue-600", bg: "bg-blue-50" },
                  ].map((item) => (
                    <div key={item.label} className={`${item.bg} rounded-xl p-3 border border-transparent hover:border-current/10 transition-colors`}>
                      <p className="text-xs text-gray-500 mb-1 font-medium">{item.label}</p>
                      <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wider">Recent AI Signals</p>
                  <div className="space-y-2">
                    {[
                      { stock: "SAFARICOM", action: "BUY", confidence: "94%" },
                      { stock: "EQUITY", action: "HOLD", confidence: "87%" },
                    ].map((signal) => (
                      <div key={signal.stock} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors min-w-0">
                        <span className="font-semibold text-gray-700 text-sm truncate">{signal.stock}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2.5 py-1 rounded-md text-xs font-bold shrink-0 ${
                            signal.action === "BUY" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          }`}>
                            {signal.action}
                          </span>
                          <span className="text-gray-500 text-xs font-medium shrink-0">{signal.confidence}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="absolute -top-5 -right-5 bg-white rounded-3xl p-4 shadow-2xl border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-2xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">AI Confidence</p>
                    <p className="text-sm font-bold text-gray-900">92% predictive accuracy</p>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-5 -left-5 bg-white rounded-3xl p-4 shadow-2xl border border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-gradient-to-br from-[#0EA5E9] to-[#0D7490] rounded-2xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Live NSE Alerts</p>
                    <p className="text-sm font-bold text-gray-900">Stay ahead with instant market updates</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="py-16 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {animatedStats.map((stat, i) => (
              <div key={stat.label} className="text-center group">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-2xl mb-4 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-[#0D7490]/10">
                  <stat.icon className="w-7 h-7 text-[#0D7490]" />
                </div>
                <p className="text-3xl sm:text-4xl font-bold text-gray-900 tabular-nums">
                  {stat.value.toLocaleString()}{stat.suffix}
                </p>
                <p className="text-sm text-gray-500 mt-1.5 font-medium">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUSTED BY */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-gray-400 mb-8 uppercase tracking-[0.2em] font-semibold">Trusted by leading African exchanges</p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {trustLogos.map((logo) => (
              <div key={logo} className="group relative">
                <span className="text-sm font-bold text-gray-300 group-hover:text-gray-400 transition-colors whitespace-nowrap tracking-wide">{logo}</span>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-transparent via-[#0D7490]/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 lg:py-32 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
              Features
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 tracking-tight">Everything you need to trade smarter</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">Powerful tools designed for modern investors who demand precision and speed</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {features.map((feature, idx) => (
              <div
                key={feature.title}
                onMouseEnter={() => setActiveFeature(idx)}
                className={`group relative bg-white rounded-2xl p-4 md:p-6 border transition-all duration-500 cursor-pointer overflow-hidden ${
                  activeFeature === idx
                    ? "border-[#0D7490]/30 shadow-2xl shadow-[#0D7490]/10 -translate-y-2"
                    : "border-gray-100 hover:border-[#0D7490]/20 hover:shadow-xl hover:shadow-[#0D7490]/5 hover:-translate-y-1"
                }`}
              >
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${feature.color} opacity-[0.03] rounded-full -translate-y-1/2 translate-x-1/2`} />
                <div className={`w-14 h-14 bg-gradient-to-br ${feature.color} rounded-2xl flex items-center justify-center mb-6 shadow-lg transition-all duration-500 ${
                  activeFeature === idx ? "scale-110 shadow-xl" : "group-hover:scale-105"
                }`}>
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-xl font-bold text-gray-900">{feature.title}</h3>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold bg-gradient-to-r ${feature.color} text-white shadow-sm`}>
                    {feature.stat}
                  </span>
                </div>
                <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                <div className="mt-6 flex items-center text-[#0D7490] font-semibold text-sm opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                  Learn more <ChevronRight className="w-4 h-4 ml-1 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY CHOOSE US */}
      <section id="why-us" className="py-24 lg:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
                Why StocksIntels
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-6 tracking-tight">Built for traders,<br />powered by AI</h2>
              <p className="text-lg text-gray-600 mb-10 leading-relaxed">
                We understand the unique challenges of trading across African and global markets. Our platform is designed to give you the edge you need to succeed.
              </p>

              <div className="space-y-6">
                {whyChoose.map((item) => (
                  <div key={item.title} className="flex items-start gap-4 group p-4 rounded-2xl hover:bg-gray-50 transition-colors -mx-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all duration-300">
                      <item.icon className="w-6 h-6 text-[#0D7490]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-gray-900 mb-1">{item.title}</h4>
                      <p className="text-gray-600 text-sm leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[#0D7490]/5 to-[#0EA5E9]/5 rounded-3xl transform rotate-3 scale-105" />
              <div className="relative bg-white rounded-3xl p-8 shadow-2xl border border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <h4 className="font-bold text-gray-900">Market Overview</h4>
                  <span className="text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 shrink-0">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    Live
                  </span>
                </div>
                <div className="space-y-3">
                  {[
                    { name: "NSE 20 Share Index", value: "1,847.32", change: "+1.2%", up: true },
                    { name: "FTSE/JSE All Share", value: "73,421.50", change: "+0.8%", up: true },
                    { name: "GSE Composite Index", value: "2,945.18", change: "-0.3%", up: false },
                    { name: "NGX All-Share Index", value: "98,234.75", change: "+1.5%", up: true },
                  ].map((market) => (
                    <div key={market.name} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100 min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{market.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">{market.value}</p>
                      </div>
                      <span className={`text-sm font-bold flex items-center gap-1 shrink-0 ${market.up ? "text-green-600" : "text-red-600"}`}>
                        {market.up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5 rotate-90" />}
                        {market.change}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-24 lg:py-32 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
              How It Works
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 tracking-tight">Start trading in three simple steps</h2>
            <p className="text-lg text-gray-600">From signup to your first AI signal in under 5 minutes</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12 relative">
            <div className="hidden md:block absolute top-24 left-[16.66%] right-[16.66%] h-0.5 bg-gradient-to-r from-[#0D7490]/10 via-[#0D7490]/40 to-[#0D7490]/10" />

            {steps.map((item) => (
              <div key={item.step} className="relative text-center group">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-[#0D7490]/25 group-hover:shadow-2xl group-hover:shadow-[#0D7490]/40 transition-all duration-500 group-hover:-translate-y-2 group-hover:scale-105">
                  <item.icon className="w-7 h-7 md:w-8 md:h-8 text-white" />
                </div>
                <div className="inline-flex items-center justify-center w-9 h-9 bg-gradient-to-br from-gray-800 to-gray-900 text-white text-sm font-bold rounded-full mb-4 shadow-lg">
                  {item.step}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{item.title}</h3>
                <p className="text-gray-600 max-w-xs mx-auto leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-16">
            <Link to="/login">
              <Button size="lg" className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white px-10 py-6 text-base shadow-xl shadow-[#0D7490]/25 hover:shadow-2xl hover:shadow-[#0D7490]/30 transition-all duration-300 hover:-translate-y-1 font-semibold">
                Get Started Now
                <ArrowUpRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section id="testimonials" className="py-24 lg:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
              Testimonials
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 tracking-tight">Trusted by traders across Africa</h2>
            <p className="text-lg text-gray-600">See what our community has to say about their experience</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="group bg-white rounded-2xl p-4 md:p-6 border border-gray-100 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0D7490]/20 via-[#0EA5E9]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed text-sm">&ldquo;{testimonial.content}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonial.color} flex items-center justify-center text-white font-bold text-sm shadow-lg`}>
                    {testimonial.avatar}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{testimonial.name}</p>
                    <p className="text-gray-500 text-xs font-medium">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 lg:py-32 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
              Pricing
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4 tracking-tight">Simple, transparent pricing</h2>
            <p className="text-lg text-gray-600">Choose the plan that fits your trading style. All plans include a 7-day free trial.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 items-start">
            {/* Free */}
            <div className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 hover:border-[#0D7490]/20 hover:shadow-2xl hover:shadow-[#0D7490]/10 transition-all duration-500 group">
              <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-4 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all">
                <Zap className="w-6 h-6 text-[#0D7490]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Free</h3>
              <p className="text-sm text-gray-500 mb-4 font-medium">Casual investors</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$0</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/subscribe/free">
                <Button variant="outline" className="w-full py-4 text-sm font-semibold mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all group-hover:border-[#0D7490]/30">
                  Get Started
                </Button>
              </Link>
              <div className="space-y-2">
                {["Delayed data", "1 AI signal/day", "Basic watchlist"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-green-600" />
                    </div>
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Starter */}
            <div className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 hover:border-[#0D7490]/20 hover:shadow-2xl hover:shadow-[#0D7490]/10 transition-all duration-500 group">
              <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-4 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all">
                <Zap className="w-6 h-6 text-[#0D7490]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Starter</h3>
              <p className="text-sm text-gray-500 mb-4 font-medium">Retail investors</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$4.99</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/subscribe/starter">
                <Button variant="outline" className="w-full py-4 text-sm font-semibold mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all group-hover:border-[#0D7490]/30">
                  Start Free Trial
                </Button>
              </Link>
              <div className="space-y-2">
                {["Real-time African data", "5 AI signals/day", "Stock screener", "Portfolio tracking"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-green-600" />
                    </div>
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* NSE Pro */}
            <div className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 hover:border-[#0D7490]/20 hover:shadow-2xl hover:shadow-[#0D7490]/10 transition-all duration-500 group">
              <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-4 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all">
                <Shield className="w-6 h-6 text-[#0D7490]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">NSE Pro</h3>
              <p className="text-sm text-gray-500 mb-4 font-medium">Active NSE traders</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$7.99</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/subscribe/nse%20pro">
                <Button variant="outline" className="w-full py-4 text-sm font-semibold mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all group-hover:border-[#0D7490]/30">
                  Start Free Trial
                </Button>
              </Link>
              <div className="space-y-2">
                {["Unlimited NSE signals", "Advanced NSE screener", "NSE technical analysis", "Email support"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-green-600" />
                    </div>
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pro */}
            <div className="relative bg-gray-900 text-white rounded-2xl p-4 md:p-6 shadow-2xl shadow-gray-900/30 scale-105 z-10 overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-[#0D7490]/20 to-transparent rounded-full" />
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <span className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
                  Most Popular
                </span>
              </div>
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4 backdrop-blur-sm">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-bold mb-1">Pro</h3>
              <p className="text-sm text-gray-400 mb-4 font-medium">Active global traders</p>
              <div className="mb-4">
                <span className="text-3xl font-bold">$14.99</span>
                <span className="text-gray-400 text-sm">/mo</span>
              </div>
              <Link to="/subscribe/pro">
                <Button className="w-full py-4 text-sm font-semibold mb-4 bg-white text-gray-900 hover:bg-gray-100 shadow-xl transition-all hover:shadow-2xl">
                  Start Pro Trial
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
              <div className="space-y-2">
                {["Unlimited AI signals", "African + global data", "Advanced charting", "Risk scoring"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 backdrop-blur-sm">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                    <span className="text-xs text-gray-200">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Institutional */}
            <div className="bg-white rounded-2xl p-4 md:p-6 border border-gray-100 hover:border-[#0D7490]/20 hover:shadow-2xl hover:shadow-[#0D7490]/10 transition-all duration-500 group">
              <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-4 group-hover:from-[#0D7490]/20 group-hover:to-[#0EA5E9]/20 transition-all">
                <Crown className="w-6 h-6 text-[#0D7490]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">Institutional</h3>
              <p className="text-sm text-gray-500 mb-4 font-medium">Brokers & funds</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$200+</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <Link to="/subscribe/institutional">
                <Button variant="outline" className="w-full py-4 text-sm font-semibold mb-4 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all group-hover:border-[#0D7490]/30">
                  Contact Sales
                </Button>
              </Link>
              <div className="space-y-2">
                {["API access", "White-label analytics", "Dedicated support", "Team seats"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-green-600" />
                    </div>
                    <span className="text-xs text-gray-700">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link to="/pricing" className="inline-flex items-center gap-2 text-[#0D7490] font-semibold hover:text-[#0A5F7A] transition-colors group">
              View full comparison
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 lg:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
              FAQ
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 tracking-tight">Frequently asked questions</h2>
            <p className="text-lg text-gray-600">Everything you need to know about StocksIntels</p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden transition-all duration-300 hover:shadow-md hover:border-gray-200">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex flex-wrap items-center justify-between gap-4 p-5 md:p-6 text-left"
                >
                  <span className="font-semibold text-gray-900 pr-4 min-w-0">{faq.q}</span>
                  <ChevronRight className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-300 ${openFaq === i ? "rotate-90" : ""}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-40" : "max-h-0"}`}>
                  <p className="px-5 md:px-6 pb-5 md:pb-6 text-gray-600 text-sm leading-relaxed">{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="py-24 lg:py-32 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-full text-[#0D7490] text-xs font-semibold uppercase tracking-wider mb-4 border border-[#0D7490]/10">
                Contact Us
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-6 tracking-tight">Get in touch with our team</h2>
              <p className="text-lg text-gray-600 mb-10 leading-relaxed">
                Have questions about StocksIntels? Our support team is here to help you with everything from account setup to advanced trading strategies.
              </p>

              <div className="space-y-6">
                <div className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Phone className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-0.5">Phone</p>
                    <a href="tel:+254792754435" className="text-gray-900 font-semibold hover:text-[#0D7490] transition-colors">+254 792 754 435</a>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Mail className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-0.5">Email</p>
                    <a href="mailto:support@stocksintels.com" className="text-gray-900 font-semibold hover:text-[#0D7490] transition-colors">support@stocksintels.com</a>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-0.5">Location</p>
                    <p className="text-gray-900 font-semibold">Nairobi, Kenya</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-3xl p-4 md:p-6 lg:p-10 shadow-2xl border border-gray-100">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Send us a message</h3>
              <p className="text-gray-600 text-sm mb-8">We'll get back to you within 24 hours</p>
              <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                    <input type="text" placeholder="John Doe" className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-4 focus:ring-[#0D7490]/5 outline-none transition-all text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                    <input type="email" placeholder="john@example.com" className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-4 focus:ring-[#0D7490]/5 outline-none transition-all text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject</label>
                  <input type="text" placeholder="How can we help?" className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-4 focus:ring-[#0D7490]/5 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Message</label>
                  <textarea rows={4} placeholder="Tell us more about your inquiry..." className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-[#0D7490] focus:ring-4 focus:ring-[#0D7490]/5 outline-none transition-all text-sm resize-none" />
                </div>
                <Button className="w-full py-4 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-semibold shadow-lg shadow-[#0D7490]/25 hover:shadow-xl transition-all">
                  Send Message
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="py-20 lg:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0D7490] via-[#0A8BA8] to-[#0A5F7A]" />
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-white rounded-full blur-3xl" />
          <FloatingParticles />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight">Ready to trade smarter?</h2>
          <p className="text-lg text-white/80 mb-10 max-w-2xl mx-auto leading-relaxed">
            Join 2,500+ traders using AI-powered insights to maximize their returns. Start your free trial today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/login">
              <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 px-10 py-6 text-base font-bold shadow-2xl transition-all duration-300 hover:-translate-y-1 active:translate-y-0">
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10 px-10 py-6 text-base font-medium transition-all duration-300 hover:-translate-y-1 active:translate-y-0 backdrop-blur-sm">
              Contact Sales
            </Button>
          </div>
          <p className="text-white/60 text-sm mt-6 font-medium">No credit card required. 7-day free trial. Cancel anytime.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-950 text-white pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12 mb-12">
            <div className="col-span-2 md:col-span-1">
              <Link to="/" className="flex items-center gap-2 mb-4 group">
                <div className="w-9 h-9 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-[#0D7490]/40 transition-all">
                  <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5" />
                </div>
                <span className="text-lg font-bold">StocksIntels</span>
              </Link>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">AI-powered trading intelligence for African and global markets.</p>
              <div className="flex items-center gap-3">
                {[{ icon: Twitter, name: "twitter", href: "#" }, { icon: Linkedin, name: "linkedin", href: "#" }, { icon: Github, name: "github", href: "#" }].map(({ icon: Icon, name }) => (
                  <a key={name} href="#" className="w-9 h-9 bg-gray-800 hover:bg-[#0D7490] rounded-xl flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-[#0D7490]/25">
                    <Icon className="w-4 h-4 text-gray-400 group-hover:text-white" />
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm uppercase tracking-wider text-gray-400 mb-5">Product</h4>
              <ul className="space-y-3.5">
                <li><Link to="/pricing" className="text-sm text-gray-500 hover:text-white transition-colors">Pricing</Link></li>
                <li><a href="#features" className="text-sm text-gray-500 hover:text-white transition-colors">Features</a></li>
                <li><a href="#how-it-works" className="text-sm text-gray-500 hover:text-white transition-colors">How It Works</a></li>
                <li><a href="#faq" className="text-sm text-gray-500 hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm uppercase tracking-wider text-gray-400 mb-5">Company</h4>
              <ul className="space-y-3.5">
                <li><Link to="/about" className="text-sm text-gray-500 hover:text-white transition-colors">About</Link></li>
                <li><Link to="/blog" className="text-sm text-gray-500 hover:text-white transition-colors">Blog</Link></li>
                <li><Link to="/careers" className="text-sm text-gray-500 hover:text-white transition-colors">Careers</Link></li>
                <li><a href="#contact" className="text-sm text-gray-500 hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm uppercase tracking-wider text-gray-400 mb-5">Legal</h4>
              <ul className="space-y-3.5">
                <li><Link to="/privacy" className="text-sm text-gray-500 hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><Link to="/terms" className="text-sm text-gray-500 hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link to="/security" className="text-sm text-gray-500 hover:text-white transition-colors">Security</Link></li>
                <li><Link to="/disclaimer" className="text-sm text-gray-500 hover:text-white transition-colors">Disclaimer</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-sm uppercase tracking-wider text-gray-400 mb-5">Contact</h4>
              <ul className="space-y-3.5">
                <li>
                  <a href="tel:+254792754435" className="text-sm text-gray-500 hover:text-white transition-colors flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5" />
                    +254 792 754 435
                  </a>
                </li>
                <li>
                  <a href="mailto:support@stocksintels.com" className="text-sm text-gray-500 hover:text-white transition-colors flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" />
                    support@stocksintels.com
                  </a>
                </li>
                <li>
                  <span className="text-sm text-gray-500 flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5" />
                    Nairobi, Kenya
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-gray-600 text-sm">© 2026 StocksIntels. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <p className="text-gray-600 text-sm">Made with care for traders everywhere</p>
              <button onClick={scrollToTop} className="w-8 h-8 bg-gray-800 hover:bg-[#0D7490] rounded-lg flex items-center justify-center transition-all duration-300 hover:scale-110">
                <ChevronUp className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* DISCLAIMER */}
      <div className="bg-gray-950 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-gray-600 leading-relaxed">
              <strong className="text-gray-500">Risk Disclaimer:</strong> Trading stocks and other financial instruments involves substantial risk of loss. AI signals are for informational purposes only and do not constitute financial advice. Past performance does not guarantee future results. StocksIntels is not a licensed broker or financial advisor. By using this platform, you acknowledge and accept these risks.{' '}
              <Link to="/disclaimer" className="text-gray-500 hover:text-gray-400 underline">Read full disclaimer</Link>
            </p>
          </div>
        </div>
      </div>

      {/* DEMO MODAL */}
      {showDemoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowDemoModal(false)}>
          <div className="bg-white rounded-3xl p-4 md:p-6 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h3 className="text-xl font-bold text-gray-900">Watch Demo</h3>
              <button onClick={() => setShowDemoModal(false)} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="aspect-video bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl flex items-center justify-center mb-4 border border-gray-700">
              <div className="text-center text-white">
                <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Play className="w-8 h-8 text-white" />
                </div>
                <p className="text-sm text-gray-400 font-medium">Demo video coming soon</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm text-center leading-relaxed">See how StocksIntels helps traders make smarter decisions with AI-powered insights.</p>
          </div>
        </div>
      )}
    </div>
  );
}
