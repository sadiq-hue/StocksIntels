import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Globe2,
  Landmark,
  LineChart,
  Mail,
  Menu,
  Newspaper,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { fetchRealtimeQuotesBatch, type RealtimeStockQuote } from "../services/marketDataService";
import { useSEO } from "../hooks/useSEO";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const HERO_SYMBOLS = ["NSE:SCOM", "NSE:EQTY", "NSE:KCB", "AAPL", "MSFT", "NVDA"];

type Article = {
  id: string;
  title: string;
  summary?: string;
  source?: string;
  publishedAt?: string;
  slug?: string;
  url?: string;
};

const navItems = [
  { label: "Platform", href: "#platform" },
  { label: "Market Intelligence", href: "#intelligence" },
  { label: "Research & Analysts", href: "#human-expertise" },
  { label: "For Businesses", href: "#audiences" },
];

const intelligenceLayers = [
  { number: "01", title: "Computational", text: "Processes market, company and pricing information across the research workflow." },
  { number: "02", title: "Fundamental", text: "Examines business quality, valuation context and company performance." },
  { number: "03", title: "Technical", text: "Adds trend, momentum, volatility and market-structure evidence." },
  { number: "04", title: "Financial", text: "Interprets statements, cash generation, leverage and operating history." },
  { number: "05", title: "Macroeconomic", text: "Connects rates, inflation, currencies and growth conditions to markets." },
  { number: "06", title: "Sentiment & news", text: "Tracks corporate developments and the information shaping market attention." },
  { number: "07", title: "Human expertise", text: "Keeps research grounded in context, judgement and responsible interpretation." },
];

const capabilities = [
  { icon: FileText, label: "Fundamental analysis", text: "Company quality, valuation and business drivers." },
  { icon: LineChart, label: "Technical analysis", text: "Trend, momentum and volatility indicators." },
  { icon: BarChart3, label: "Financial performance", text: "Statements, ratios and reported operating history." },
  { icon: Globe2, label: "Macroeconomic context", text: "Rates, inflation, FX and economic conditions." },
  { icon: Newspaper, label: "News intelligence", text: "Corporate developments and relevant market reporting." },
  { icon: ShieldCheck, label: "Risk context", text: "Evidence quality, uncertainty and downside awareness." },
];

const exchanges = [
  { code: "NSE", city: "Nairobi", market: "Kenya" },
  { code: "NGX", city: "Lagos", market: "Nigeria" },
  { code: "JSE", city: "Johannesburg", market: "South Africa" },
  { code: "GSE", city: "Accra", market: "Ghana" },
  { code: "GLOBAL", city: "International", market: "Global equities" },
];

function useHeroQuotes() {
  const [quotes, setQuotes] = useState<Record<string, RealtimeStockQuote>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchRealtimeQuotesBatch(HERO_SYMBOLS);
        if (alive) {
          setQuotes(data);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return { quotes, error };
}

function findQuote(quotes: Record<string, RealtimeStockQuote>, symbol: string) {
  return quotes[symbol] || quotes[symbol.replace(/^NSE:/, "")] || null;
}

function quoteText(quote: RealtimeStockQuote | null, currency: string) {
  if (!quote || !Number.isFinite(Number(quote.price)) || Number(quote.price) <= 0) return `${currency} --`;
  return `${currency} ${Number(quote.price).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function changeText(quote: RealtimeStockQuote | null) {
  const change = Number(quote?.changePercent);
  if (!Number.isFinite(change)) return "--";
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function QuoteRow({
  symbol,
  name,
  currency,
  quotes,
}: {
  symbol: string;
  name: string;
  currency: string;
  quotes: Record<string, RealtimeStockQuote>;
}) {
  const quote = findQuote(quotes, symbol);
  const change = Number(quote?.changePercent);
  const up = Number.isFinite(change) && change >= 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-white/10 py-3 last:border-0">
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-semibold tracking-[0.12em] text-cyan-200">{symbol.replace("NSE:", "")}</p>
        <p className="truncate text-xs text-slate-300">{name}</p>
      </div>
      <p className="font-mono text-xs tabular-nums text-white">{quoteText(quote, currency)}</p>
      <p className={`min-w-14 text-right font-mono text-xs font-semibold tabular-nums ${up ? "text-emerald-300" : "text-rose-300"}`}>
        {changeText(quote)}
      </p>
    </div>
  );
}

function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`mb-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.24em] ${light ? "text-cyan-200" : "text-[#2563A6]"}`}>
      <span className={`h-px w-9 ${light ? "bg-cyan-300/60" : "bg-[#2563A6]/45"}`} />
      {children}
    </p>
  );
}

function ProductPreview({ quotes, error }: { quotes: Record<string, RealtimeStockQuote>; error: boolean }) {
  const scom = findQuote(quotes, "NSE:SCOM");

  return (
    <div className="relative mx-auto w-full max-w-[720px]" aria-label="StocksIntels platform interface preview">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-[#4386C8]/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#102B50] shadow-[0_35px_80px_-36px_rgba(16,43,80,0.8)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">Research workspace</span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">LIVE OR DELAYED BY EXCHANGE</span>
        </div>

        <div className="grid lg:grid-cols-[1.15fr_.85fr]">
          <div className="border-b border-white/10 p-5 sm:p-7 lg:border-b-0 lg:border-r">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">NSE / SCOM</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Safaricom PLC</h3>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-mono text-2xl font-semibold tabular-nums text-white">{quoteText(scom, "KES")}</p>
                <p className={`font-mono text-xs ${Number(scom?.changePercent) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {changeText(scom)} latest session
                </p>
              </div>
            </div>

            <div className="mb-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
              {[
                ["Evidence", "Multi-factor"],
                ["Coverage", "African + global"],
                ["Context", "Risk-aware"],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#102B50] px-3 py-4">
                  <p className="text-[9px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Intelligence evidence</span>
                <span className="text-[9px] uppercase tracking-[0.18em] text-slate-400">Availability varies</span>
              </div>
              <div className="space-y-3">
                {[
                  ["Fundamental", 82],
                  ["Financial", 70],
                  ["Technical", 58],
                  ["Macro & news", 66],
                ].map(([label, width]) => (
                  <div key={label as string}>
                    <div className="mb-1 flex justify-between text-[10px] text-slate-300"><span>{label}</span><span>research layer</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#4386C8] to-[#16A085]" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Market desk</h3>
              <Activity className="size-4 text-cyan-300" />
            </div>
            <QuoteRow symbol="NSE:EQTY" name="Equity Group" currency="KES" quotes={quotes} />
            <QuoteRow symbol="AAPL" name="Apple Inc." currency="$" quotes={quotes} />
            <QuoteRow symbol="NVDA" name="NVIDIA" currency="$" quotes={quotes} />
            <QuoteRow symbol="MSFT" name="Microsoft" currency="$" quotes={quotes} />
            <div className="mt-5 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">Research principle</p>
              <p className="mt-2 text-xs leading-5 text-slate-300">No single indicator explains a market. StocksIntels brings the evidence together.</p>
            </div>
            {error && <p className="mt-3 text-[10px] text-amber-200">Quote feed temporarily unavailable. Platform preview remains available.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  useSEO({
    title: "Financial Intelligence. Elevated.",
    description: "StocksIntels brings together advanced technology, multi-dimensional financial analysis and human expertise for African and global markets.",
    canonical: "/",
    keywords: "financial intelligence, African markets, NSE, NGX, JSE, market research, company analysis, StocksIntels",
  });

  const { quotes, error: quoteError } = useHeroQuotes();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [contactSending, setContactSending] = useState(false);
  const [contactStatus, setContactStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  useEffect(() => {
    fetch(`${API_URL}/market-intel?limit=3`)
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setArticles(Array.isArray(data) ? data.slice(0, 3) : []))
      .catch(() => setArticles([]));
  }, []);

  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setContactStatus(null);
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      setContactStatus({ type: "error", message: "Please complete your name, email and message." });
      return;
    }
    setContactSending(true);
    try {
      const response = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to send message");
      setContactStatus({ type: "success", message: "Message received. Our team will follow up." });
      setContactForm({ name: "", email: "", subject: "", message: "" });
    } catch (error) {
      setContactStatus({ type: "error", message: error instanceof Error ? error.message : "Unable to send message" });
    } finally {
      setContactSending(false);
    }
  };

  return (
    <div className="si-landing min-h-screen overflow-x-hidden bg-[#F5F8FC] text-[#202B3A] selection:bg-[#4386C8]/25">
      <header className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${scrolled || mobileOpen ? "border-[#DCE5F0] bg-[#F5F8FC]/95 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link to="/" className="flex items-center gap-3" aria-label="StocksIntels home">
            <img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" />
            <div>
              <span className="block text-sm font-extrabold tracking-[-0.02em] text-[#102B50]">StocksIntels</span>
              <span className="block text-[8px] font-bold uppercase tracking-[0.24em] text-[#4386C8]">Financial Intelligence</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 lg:flex" aria-label="Primary navigation">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-[13px] font-semibold text-[#405168] transition-colors hover:text-[#174A7E]">{item.label}</a>
            ))}
            <Link to="/about" className="text-[13px] font-semibold text-[#405168] transition-colors hover:text-[#174A7E]">About</Link>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Button asChild variant="ghost" className="text-sm text-[#174A7E]"><Link to="/login">Sign in</Link></Button>
            <Button asChild className="rounded-full bg-[#2563A6] px-5 text-sm text-white hover:bg-[#174A7E]"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
          </div>

          <button
            type="button"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-nav"
            onClick={() => setMobileOpen((open) => !open)}
            className="grid size-10 place-items-center rounded-full border border-[#D7E1EC] bg-white text-[#102B50] lg:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {mobileOpen && (
          <nav id="landing-mobile-nav" className="max-h-[calc(100vh-72px)] overflow-y-auto border-t border-[#DCE5F0] bg-[#F5F8FC] px-5 py-6 lg:hidden" aria-label="Mobile navigation">
            <div className="mx-auto flex max-w-2xl flex-col gap-1">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-4 py-3 text-sm font-semibold text-[#24364C] hover:bg-white">{item.label}</a>
              ))}
              <Link to="/about" onClick={() => setMobileOpen(false)} className="rounded-xl px-4 py-3 text-sm font-semibold text-[#24364C] hover:bg-white">About</Link>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button asChild variant="outline" className="border-[#BFCFE1] bg-white text-[#174A7E]"><Link to="/login">Sign in</Link></Button>
                <Button asChild className="bg-[#2563A6] text-white"><Link to="/login">Explore</Link></Button>
              </div>
            </div>
          </nav>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#F5F8FC] pb-20 pt-32 sm:pb-28 sm:pt-40">
          <div className="si-grid absolute inset-0 opacity-55" />
          <div className="absolute right-[-18%] top-[-20%] size-[700px] rounded-full bg-[#4386C8]/10 blur-[130px]" />
          <div className="relative mx-auto grid max-w-[1440px] items-center gap-16 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:px-12">
            <div className="max-w-[650px]">
              <div className="mb-7 inline-flex items-center gap-3 rounded-full border border-[#BFD1E6] bg-white/75 px-4 py-2">
                <span className="grid size-6 place-items-center rounded-full bg-[#102B50] text-[9px] font-black tracking-wider text-white">SI</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#174A7E]">Introducing Super Intelligence</span>
              </div>
              <h1 className="si-display max-w-[720px] text-[3.5rem] font-medium leading-[0.93] tracking-[-0.045em] text-[#102B50] sm:text-[4.8rem] lg:text-[5.65rem]">
                See the markets <span className="text-[#2563A6]">beyond</span> the numbers.
              </h1>
              <p className="mt-8 max-w-[600px] text-base leading-7 text-[#52647A] sm:text-lg sm:leading-8">
                StocksIntels combines Super Intelligence, multi-dimensional financial analysis and human expertise to bring greater clarity to African and global markets.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#2563A6] px-7 text-sm text-white hover:bg-[#174A7E]"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-[#B9CAE0] bg-white/65 px-7 text-sm text-[#174A7E] hover:bg-white"><a href="#intelligence">Discover our intelligence</a></Button>
              </div>
              <div className="mt-10 grid max-w-[560px] grid-cols-1 gap-3 border-t border-[#D8E2ED] pt-6 text-xs text-[#52647A] sm:grid-cols-3">
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> African market depth</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> Global exposure</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#16A085]" /> Evidence-led research</span>
              </div>
            </div>
            <ProductPreview quotes={quotes} error={quoteError} />
          </div>
        </section>

        <section id="intelligence" className="scroll-mt-24 bg-[#102B50] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 sm:px-8 lg:grid-cols-[.75fr_1.25fr] lg:px-12">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionLabel light>Super Intelligence</SectionLabel>
              <h2 className="si-display text-4xl leading-[1.02] tracking-[-0.035em] text-white sm:text-6xl">More than data. More than conventional analysis.</h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-slate-300">
                SI is the StocksIntels philosophy: combine complementary forms of intelligence into one coherent research experience. It is not a claim of artificial superintelligence.
              </p>
              <div className="mt-10 flex items-center gap-5 border-t border-white/15 pt-6">
                <div className="si-display text-6xl text-cyan-200">SI</div>
                <p className="max-w-[240px] text-xs leading-5 text-slate-400">Technology, analysis and human judgement working in concert.</p>
              </div>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {intelligenceLayers.map((layer) => (
                <div key={layer.number} className="group grid gap-3 py-6 sm:grid-cols-[60px_210px_1fr] sm:items-start">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-cyan-300/70">{layer.number}</span>
                  <h3 className="text-base font-semibold text-white transition-colors group-hover:text-cyan-200">{layer.title}</h3>
                  <p className="text-sm leading-6 text-slate-300">{layer.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
              <div>
                <SectionLabel>Multi-dimensional intelligence</SectionLabel>
                <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">One company. Multiple analytical perspectives.</h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-[#607187] lg:justify-self-end">
                Financial markets do not resolve into a single score. StocksIntels helps users inspect the evidence across company fundamentals, statements, price behaviour, macro conditions and current developments.
              </p>
            </div>

            <div className="mt-14 grid border-y border-[#DCE5EF] md:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`group min-h-56 border-[#DCE5EF] p-7 transition-colors hover:bg-[#F5F8FC] ${index % 3 !== 2 ? "lg:border-r" : ""} ${index < 3 ? "border-b" : ""} ${index % 2 === 0 ? "md:border-r lg:border-r" : ""}`}>
                    <div className="flex items-start justify-between">
                      <Icon className="size-5 text-[#2563A6]" />
                      <span className="font-mono text-[10px] text-[#9AA9BA]">0{index + 1}</span>
                    </div>
                    <h3 className="mt-10 text-lg font-semibold text-[#102B50]">{item.label}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#607187]">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#EDF3F9] py-20 sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid items-center gap-16 lg:grid-cols-[.95fr_1.05fr]">
              <div className="order-2 lg:order-1">
                <ProductPreview quotes={quotes} error={quoteError} />
              </div>
              <div className="order-1 lg:order-2 lg:pl-8">
                <SectionLabel>The actual platform</SectionLabel>
                <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">A research workspace, not a prediction feed.</h2>
                <p className="mt-7 text-base leading-7 text-[#607187]">Move from market context to company detail without leaving the evidence behind.</p>
                <div className="mt-8 divide-y divide-[#CEDAE7] border-y border-[#CEDAE7]">
                  {[
                    "Company analysis and financial statements",
                    "Technical indicators and price history",
                    "Market movers, heatmaps and intelligence briefs",
                    "Watchlists, portfolio analytics and paper trading",
                  ].map((text) => (
                    <div key={text} className="flex items-center gap-4 py-4 text-sm font-medium text-[#334A64]">
                      <ChevronRight className="size-4 text-[#2563A6]" /> {text}
                    </div>
                  ))}
                </div>
                <Button asChild variant="link" className="mt-5 px-0 text-[#174A7E]"><Link to="/login">Enter the platform <ArrowRight className="size-4" /></Link></Button>
              </div>
            </div>
          </div>
        </section>

        <section id="human-expertise" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <SectionLabel>Technology + human expertise</SectionLabel>
            <h2 className="si-display max-w-4xl text-4xl leading-[1.04] tracking-[-0.035em] text-[#102B50] sm:text-6xl">Intelligence enhanced by technology. Strengthened by human expertise.</h2>
            <div className="mt-14 grid overflow-hidden rounded-[1.5rem] border border-[#D7E1EC] lg:grid-cols-2">
              <article className="bg-[#102B50] p-8 text-white sm:p-12">
                <Cpu className="size-6 text-cyan-300" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">Advanced technology</p>
                <h3 className="mt-4 text-2xl font-semibold">Built to process complexity.</h3>
                <p className="mt-5 text-sm leading-7 text-slate-300">Technology helps organize financial information, identify analytical patterns and support research across multiple market factors.</p>
              </article>
              <article className="bg-[#F9F5EC] p-8 sm:p-12">
                <Users className="size-6 text-[#B1822C]" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-[#9B732B]">Human judgement</p>
                <h3 className="mt-4 text-2xl font-semibold text-[#3C3427]">Context still matters.</h3>
                <p className="mt-5 text-sm leading-7 text-[#675B49]">Human expertise contributes qualitative context, market judgement and responsible interpretation. Not every automated output is manually reviewed.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#102B50] py-20 text-white sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
              <div>
                <SectionLabel light>African + global</SectionLabel>
                <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] sm:text-6xl">African market intelligence. Global perspective.</h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-slate-300 lg:justify-self-end">A platform designed around African market relevance, with the international context investors and institutions use to understand capital, sectors and companies.</p>
            </div>
            <div className="mt-14 divide-y divide-white/10 border-y border-white/10">
              {exchanges.map((exchange) => (
                <div key={exchange.code} className="grid items-center gap-2 py-5 sm:grid-cols-[140px_1fr_auto]">
                  <span className="font-mono text-sm font-bold tracking-[0.14em] text-cyan-200">{exchange.code}</span>
                  <span className="text-sm text-slate-200">{exchange.city}</span>
                  <span className="text-xs text-slate-400">{exchange.market}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="audiences" className="scroll-mt-24 bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <SectionLabel>Who we serve</SectionLabel>
            <h2 className="si-display max-w-3xl text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">One intelligence foundation. Two paths forward.</h2>
            <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-[#D5E0EB] bg-[#D5E0EB] lg:grid-cols-2">
              <article className="bg-[#F8FAFD] p-8 sm:p-12">
                <Search className="size-6 text-[#2563A6]" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-[#2563A6]">Investors & market participants</p>
                <h3 className="mt-4 text-2xl font-semibold text-[#102B50]">Research with more context.</h3>
                <ul className="mt-7 space-y-3 text-sm text-[#566A80]">
                  {[
                    "Company and financial analysis",
                    "Fundamental and technical evidence",
                    "Watchlists, portfolios and paper trading",
                    "Market intelligence across regions",
                  ].map((item) => <li key={item} className="flex gap-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#16A085]" />{item}</li>)}
                </ul>
                <Button asChild className="mt-9 rounded-full bg-[#2563A6] px-6 text-white"><Link to="/login">Explore the platform <ArrowRight className="size-4" /></Link></Button>
              </article>
              <article className="bg-[#F2F6FA] p-8 sm:p-12">
                <Building2 className="size-6 text-[#174A7E]" />
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.22em] text-[#174A7E]">Businesses & financial institutions</p>
                <h3 className="mt-4 text-2xl font-semibold text-[#102B50]">Intelligence for research workflows.</h3>
                <ul className="mt-7 space-y-3 text-sm text-[#566A80]">
                  {[
                    "Market and company intelligence",
                    "Research and analytical support",
                    "Financial information infrastructure",
                    "Integration conversations where supported",
                  ].map((item) => <li key={item} className="flex gap-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#16A085]" />{item}</li>)}
                </ul>
                <Button asChild variant="outline" className="mt-9 rounded-full border-[#AFC2D8] bg-white px-6 text-[#174A7E]"><a href="#contact">Discuss your needs <ArrowRight className="size-4" /></a></Button>
              </article>
            </div>
          </div>
        </section>

        {articles.length > 0 && (
          <section className="bg-[#EDF3F9] py-20 sm:py-24">
            <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
                <div>
                  <SectionLabel>Current intelligence</SectionLabel>
                  <h2 className="si-display text-4xl tracking-[-0.03em] text-[#102B50] sm:text-5xl">Developments shaping the market.</h2>
                </div>
                <Link to="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-[#174A7E]">View research & insights <ArrowRight className="size-4" /></Link>
              </div>
              <div className="mt-12 divide-y divide-[#CFDBE8] border-y border-[#CFDBE8]">
                {articles.map((article, index) => {
                  const href = article.url || (article.slug ? `https://mystocks.africa/market-intel/${article.slug}` : "/blog");
                  return (
                    <a key={article.id || index} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined} className="group grid gap-4 py-7 sm:grid-cols-[100px_1fr_auto] sm:items-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#8192A6]">{article.source || "Market intelligence"}</span>
                      <div>
                        <h3 className="text-base font-semibold text-[#102B50] transition-colors group-hover:text-[#2563A6]">{article.title}</h3>
                        {article.summary && <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#607187]">{article.summary}</p>}
                      </div>
                      <ExternalLink className="size-4 text-[#8294A8] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section id="contact" className="scroll-mt-24 bg-[#F5F8FC] py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1440px] gap-14 px-5 sm:px-8 lg:grid-cols-[.85fr_1.15fr] lg:px-12">
            <div>
              <SectionLabel>Contact StocksIntels</SectionLabel>
              <h2 className="si-display text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">Start a more intelligent market conversation.</h2>
              <p className="mt-7 max-w-lg text-base leading-7 text-[#607187]">Talk to us about the platform, financial research workflows, business enquiries or supported integrations.</p>
              <div className="mt-10 space-y-4 text-sm text-[#52647A]">
                <a href="mailto:support@stocksintels.com" className="flex items-center gap-3 hover:text-[#174A7E]"><Mail className="size-4 text-[#2563A6]" /> support@stocksintels.com</a>
                <a href="tel:+254792754435" className="flex items-center gap-3 hover:text-[#174A7E]"><Phone className="size-4 text-[#2563A6]" /> +254 792 754 435</a>
                <p className="flex items-center gap-3"><Landmark className="size-4 text-[#2563A6]" /> Nairobi, Kenya</p>
              </div>
            </div>

            <form onSubmit={submitContact} className="rounded-3xl border border-[#D7E1EC] bg-white p-6 shadow-[0_25px_60px_-48px_rgba(16,43,80,0.8)] sm:p-9">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-xs font-semibold text-[#3A4C62]">Name
                  <input value={contactForm.name} onChange={(event) => setContactForm((form) => ({ ...form, name: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" autoComplete="name" />
                </label>
                <label className="text-xs font-semibold text-[#3A4C62]">Email
                  <input type="email" value={contactForm.email} onChange={(event) => setContactForm((form) => ({ ...form, email: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" autoComplete="email" />
                </label>
              </div>
              <label className="mt-5 block text-xs font-semibold text-[#3A4C62]">Subject
                <input value={contactForm.subject} onChange={(event) => setContactForm((form) => ({ ...form, subject: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" />
              </label>
              <label className="mt-5 block text-xs font-semibold text-[#3A4C62]">Message
                <textarea value={contactForm.message} onChange={(event) => setContactForm((form) => ({ ...form, message: event.target.value }))} className="mt-2 min-h-32 w-full resize-y rounded-xl border border-[#D4DFEA] bg-[#F8FAFC] px-4 py-3 text-sm outline-none focus:border-[#4386C8] focus:ring-2 focus:ring-[#4386C8]/15" />
              </label>
              {contactStatus && <p role="status" className={`mt-4 text-xs ${contactStatus.type === "success" ? "text-emerald-700" : "text-rose-600"}`}>{contactStatus.message}</p>}
              <Button type="submit" disabled={contactSending} className="mt-6 h-11 w-full rounded-full bg-[#2563A6] text-white hover:bg-[#174A7E]">{contactSending ? "Sending..." : "Send enquiry"} <ArrowRight className="size-4" /></Button>
            </form>
          </div>
        </section>

        <section className="bg-[#174A7E] py-20 text-white sm:py-24">
          <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-9 px-5 sm:px-8 lg:flex-row lg:items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">Financial intelligence. Elevated.</p>
              <h2 className="si-display mt-5 max-w-3xl text-4xl leading-[1.02] tracking-[-0.035em] sm:text-6xl">Understand the market. Beyond the obvious.</h2>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-blue-100">Experience a more comprehensive approach to financial intelligence, bringing together technology, market analysis and human expertise.</p>
            </div>
            <Button asChild size="lg" className="h-12 shrink-0 rounded-full bg-white px-7 text-[#174A7E] hover:bg-cyan-50"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
          </div>
        </section>
      </main>

      <footer className="bg-[#0B203D] text-white">
        <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8 lg:px-12">
          <div className="grid gap-10 border-b border-white/10 pb-12 sm:grid-cols-2 lg:grid-cols-[1.35fr_1fr_1fr_1fr_1fr]">
            <div>
              <Link to="/" className="flex items-center gap-3">
                <img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" />
                <span className="text-sm font-extrabold">StocksIntels</span>
              </Link>
              <p className="mt-5 max-w-xs text-sm leading-6 text-slate-400">Super Intelligence. Financial Research. Human Expertise.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Platform</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/app/stocks" className="block hover:text-white">Stocks</Link><Link to="/app/markets" className="block hover:text-white">Markets</Link><Link to="/app/market-movers" className="block hover:text-white">Market movers</Link><Link to="/app/portfolio" className="block hover:text-white">Portfolio</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Intelligence</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/app/financials" className="block hover:text-white">Financials</Link><Link to="/app/news" className="block hover:text-white">News</Link><Link to="/blog" className="block hover:text-white">Research & insights</Link><Link to="/app/sectors" className="block hover:text-white">Sectors</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Company</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/about" className="block hover:text-white">About</Link><Link to="/careers" className="block hover:text-white">Careers</Link><a href="#contact" className="block hover:text-white">Business enquiries</a><Link to="/pricing" className="block hover:text-white">Pricing</Link></div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">Legal</p>
              <div className="mt-5 space-y-3 text-sm text-slate-400"><Link to="/privacy" className="block hover:text-white">Privacy</Link><Link to="/terms" className="block hover:text-white">Terms</Link><Link to="/security" className="block hover:text-white">Security</Link><Link to="/disclaimer" className="block hover:text-white">Risk disclaimer</Link></div>
            </div>
          </div>
          <div className="flex flex-col gap-4 pt-7 text-[11px] leading-5 text-slate-500 sm:flex-row sm:items-start sm:justify-between">
            <p>Copyright {new Date().getFullYear()} StocksIntels. All rights reserved.</p>
            <p className="max-w-3xl sm:text-right">StocksIntels provides data, analytics and research tools for informational purposes. It is not a broker or financial adviser. Market data may be delayed. Investing involves risk.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
