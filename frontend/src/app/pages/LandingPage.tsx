import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  Globe2,
  Landmark,
  Layers,
  LineChart,
  LockKeyhole,
  Mail,
  Menu,
  Scale,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useSEO } from "../hooks/useSEO";
import { PLANS, YEARLY_SAVINGS_LABEL } from "../data/plans";
import { fetchRealtimeQuotesBatch, type RealtimeStockQuote } from "../services/marketDataService";

const HERO_SYMBOLS = ["NSE:SCOM", "NSE:EQTY", "NSE:KCB", "NSE:EABL", "AAPL", "MSFT", "NVDA"];

type MarketArticle = {
  id?: string;
  title: string;
  summary?: string;
  source?: string;
  publishedAt?: string;
  slug?: string;
  url?: string;
};

type DailyBrief = {
  aiSignal?: string;
  aiSignalContext?: string;
  analystTake?: string;
  globalToNseConnection?: string;
};

const QUICK_LINKS = [
  { label: "Nairobi (NSE)", description: "Kenyan equities, banks and Safaricom", to: "/app/markets?exchange=NSE", icon: Landmark },
  { label: "Nigeria (NGX)", description: "Lagos-listed companies and sector breadth", to: "/app/markets?exchange=NGX", icon: Globe2 },
  { label: "Johannesburg (JSE)", description: "South African large caps and industrials", to: "/app/markets?exchange=JSE", icon: BarChart3 },
  { label: "US markets", description: "NYSE and Nasdaq companies with SEC filings", to: "/app/markets?exchange=Global", icon: LineChart },
  { label: "AI market signals", description: "Risk-aware Buy, Hold and Sell intelligence", to: "/app/signals", icon: Layers },
  { label: "Financial statements", description: "Annual and quarterly reports with TTM data", to: "/app/financials", icon: FileText },
  { label: "Insider activity", description: "SEC Forms 3, 4 and 5 ownership changes", to: "/app/insider", icon: Users },
  { label: "Compare companies", description: "Put fundamentals and valuation side by side", to: "/app/compare", icon: Scale },
];

const EVENTS = [
  { market: "NSE", session: "Nairobi", time: "09:00 – 15:00 EAT", detail: "Continuous trading, Monday to Friday" },
  { market: "NGX", session: "Lagos", time: "10:00 – 14:20 WAT", detail: "Nigerian Exchange trading session" },
  { market: "JSE", session: "Johannesburg", time: "09:00 – 16:50 SAST", detail: "Johannesburg Stock Exchange session" },
  { market: "US", session: "New York", time: "09:30 – 16:00 ET", detail: "NYSE and Nasdaq regular session" },
];

const COVERAGE = [
  { market: "NSE", name: "Nairobi Securities Exchange", count: "65", note: "Kenyan equities" },
  { market: "NGX", name: "Nigerian Exchange", count: "155", note: "Nigerian equities" },
  { market: "JSE", name: "Johannesburg Stock Exchange", count: "396", note: "South African equities" },
  { market: "US", name: "NYSE / Nasdaq", count: "10,000+", note: "SEC-reporting companies" },
];

const FAQS = [
  {
    q: "What does StocksIntels cover?",
    a: "StocksIntels covers NSE Kenya, NGX Nigeria, JSE South Africa and US markets, with prices, financial statements, insider filings, market news and risk-aware signals. Coverage depends on your plan.",
  },
  {
    q: "Where does the data come from?",
    a: "Market prices come from exchange and market-data providers. US financial statements use SEC EDGAR filings. African listings use the MyStocks Africa partner feed and local filing data. Each screen states its source and freshness.",
  },
  {
    q: "How are signals and price targets produced?",
    a: "Signals combine fundamental, financial, technical, macro, news and ML evidence. Stops and targets follow an explicit risk framework, including structural support, ATR-based distance, liquidity, event risk and position sizing.",
  },
  {
    q: "Is StocksIntels affiliated with the SEC or a government agency?",
    a: "No. StocksIntels is an independent financial data platform. We reference SEC EDGAR filings as a public data source, but we are not affiliated with, endorsed by, or operated by the SEC or any government agency.",
  },
];

function useHeroQuotes() {
  const [quotes, setQuotes] = useState<Record<string, RealtimeStockQuote>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchRealtimeQuotesBatch(HERO_SYMBOLS);
        if (active) setQuotes(data || {});
      } catch {
        /* leave the snapshot empty rather than inventing prices */
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return { quotes, loading };
}

function quoteFor(quotes: Record<string, RealtimeStockQuote>, symbol: string) {
  return quotes[symbol] || quotes[symbol.replace(/^NSE:/, "")] || quotes[`NSE:${symbol}`];
}

function formatPrice(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-300 pb-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1a4480]">{eyebrow}</p>
        <h2 className="mt-1 font-serif text-2xl font-bold text-[#0b2d4d] sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function LandingPage() {
  useSEO({
    title: "StocksIntels | African & Global Market Intelligence",
    description:
      "Institutional-grade market intelligence for NSE Kenya, NGX Nigeria, JSE South Africa and US markets. Prices, financial statements, insider filings and risk-aware signals in one platform.",
    canonical: "/",
    keywords:
      "NSE Kenya, NGX Nigeria, JSE South Africa, African stocks, SEC EDGAR, stock signals, market intelligence",
  });

  const navigate = useNavigate();
  const { quotes, loading: quotesLoading } = useHeroQuotes();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [articles, setArticles] = useState<MarketArticle[]>([]);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [contact, setContact] = useState({ name: "", email: "", subject: "General enquiry", message: "" });
  const [contactStatus, setContactStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market-intel?limit=4", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setArticles(data.slice(0, 4));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    fetch("/api/market/daily-brief", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !data.error) setBrief(data);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const id = "ld-org-sec-style";
    if (document.getElementById(id)) return;
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    el.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "StocksIntels",
      url: "https://stocksintels.com",
      logo: "https://stocksintels.com/logo1.jpg",
      description:
        "Independent market intelligence for African and global equities, financial statements, insider activity and risk-aware signals.",
      sameAs: [],
    });
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const snapshot = useMemo(
    () => ["NSE:SCOM", "NSE:EQTY", "NSE:KCB", "AAPL"].map((symbol) => ({
      symbol,
      label: symbol.replace("NSE:", ""),
      isNse: symbol.startsWith("NSE:"),
      quote: quoteFor(quotes, symbol),
    })),
    [quotes],
  );

  const search = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/app/markets?search=${encodeURIComponent(q)}` : "/app/markets");
  };

  const submitContact = async (event: FormEvent) => {
    event.preventDefault();
    setContactStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact),
      });
      if (!res.ok) throw new Error("Contact request failed");
      setContactStatus("sent");
      setContact({ name: "", email: "", subject: "General enquiry", message: "" });
    } catch {
      setContactStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#0b2d4d] focus:outline focus:outline-2 focus:outline-[#1a4480]"
      >
        Skip to main content
      </a>

      {/* Trust strip — benchmarked against the SEC.gov utility banner without
          claiming government affiliation. */}
      <div className="bg-[#0b2d4d] text-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-5 gap-y-1 px-4 py-2 text-[10.5px] sm:text-[11px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Independent financial intelligence
            </span>
            <span className="hidden items-center gap-1.5 text-white/75 sm:inline-flex">
              <LockKeyhole className="size-3" aria-hidden="true" /> Secure platform
            </span>
            <span className="hidden text-white/75 md:inline">Data: NSE · NGX · JSE · SEC EDGAR</span>
          </div>
          <div className="flex items-center gap-4 text-white/80">
            <span className="hidden sm:inline">Not affiliated with the SEC</span>
            <Link to="/login" className="font-semibold text-white hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto max-w-[1180px] px-4">
          <div className="flex min-h-[86px] items-center justify-between gap-5 py-3">
            <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="StocksIntels home">
              <span className="flex size-11 shrink-0 items-center justify-center border-2 border-[#0b2d4d] bg-[#0b2d4d] font-serif text-xl font-bold text-white">
                SI
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-[19px] font-bold tracking-[0.08em] text-[#0b2d4d] sm:text-[22px]">
                  STOCKSINTELS
                </span>
                <span className="block truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  African &amp; global market intelligence
                </span>
              </span>
            </Link>

            <form onSubmit={search} className="hidden max-w-md flex-1 items-stretch border border-slate-400 lg:flex" role="search">
              <label htmlFor="landing-search" className="sr-only">
                Search stocks and markets
              </label>
              <input
                id="landing-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a ticker, company or market"
                className="min-w-0 flex-1 px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-[#1a4480]"
              />
              <button type="submit" className="inline-flex items-center gap-1.5 bg-[#1a4480] px-4 text-sm font-semibold text-white hover:bg-[#0b2d4d]">
                <Search className="size-4" aria-hidden="true" />
                Search
              </button>
            </form>

            <div className="hidden items-center gap-2 sm:flex">
              <Link to="/login" className="border border-[#1a4480] px-3 py-2 text-sm font-semibold text-[#1a4480] hover:bg-[#f2f6fa]">
                Sign in
              </Link>
              <Link to="/login" className="inline-flex items-center gap-1 bg-[#1a4480] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0b2d4d]">
                Start free trial <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex size-10 items-center justify-center border border-slate-400 text-[#0b2d4d] sm:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>

          <nav aria-label="Primary" className="hidden border-t border-slate-200 lg:block">
            <ul className="flex flex-wrap items-center gap-x-7 text-[13px] font-semibold text-slate-700">
              {[
                { label: "Markets", to: "/app/markets" },
                { label: "Intelligence", to: "/app/signals" },
                { label: "Research", to: "/app/financials" },
                { label: "Insider activity", to: "/app/insider" },
                { label: "Compare", to: "/app/compare" },
                { label: "Pricing", to: "#plans" },
                { label: "Company", to: "/about" },
              ].map((item) =>
                item.to.startsWith("#") ? (
                  <li key={item.label}>
                    <a href={item.to} className="block border-b-2 border-transparent py-3 hover:border-[#1a4480] hover:text-[#0b2d4d]">
                      {item.label}
                    </a>
                  </li>
                ) : (
                  <li key={item.label}>
                    <Link to={item.to} className="block border-b-2 border-transparent py-3 hover:border-[#1a4480] hover:text-[#0b2d4d]">
                      {item.label}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>

          <form onSubmit={search} className="flex border border-slate-400 pb-3 lg:hidden" role="search">
            <label htmlFor="landing-search-mobile" className="sr-only">
              Search stocks and markets
            </label>
            <input
              id="landing-search-mobile"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a ticker, company or market"
              className="min-w-0 flex-1 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-[#1a4480]"
            />
            <button type="submit" aria-label="Search" className="bg-[#1a4480] px-3 text-white">
              <Search className="size-4" />
            </button>
          </form>
        </div>

        {mobileOpen && (
          <div className="border-t border-slate-300 bg-white px-4 py-3 lg:hidden">
            <div className="grid gap-1">
              {QUICK_LINKS.slice(0, 5).map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className="border-b border-slate-200 px-1 py-2.5 text-sm font-semibold text-slate-700"
                >
                  {item.label}
                </Link>
              ))}
              <a href="#plans" onClick={() => setMobileOpen(false)} className="border-b border-slate-200 px-1 py-2.5 text-sm font-semibold text-slate-700">
                Pricing
              </a>
              <Link to="/about" onClick={() => setMobileOpen(false)} className="px-1 py-2.5 text-sm font-semibold text-slate-700">
                Company
              </Link>
            </div>
          </div>
        )}
      </header>

      <main id="main-content">
        <div className="mx-auto max-w-[1180px] px-4">
          <nav aria-label="Breadcrumb" className="border-b border-slate-200 py-3 text-[11px] text-slate-500">
            <ol className="flex items-center gap-1.5">
              <li><Link to="/" className="text-[#1a4480] hover:underline">Home</Link></li>
              <li aria-hidden="true"><ChevronRight className="size-3" /></li>
              <li aria-current="page">Market intelligence</li>
            </ol>
          </nav>

          {/* Mission / hero */}
          <section className="grid gap-8 border-b border-slate-300 py-10 lg:grid-cols-[1.35fr_0.65fr] lg:gap-12 lg:py-14">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#1a4480]">Independent market intelligence</p>
              <h1 className="mt-3 max-w-3xl font-serif text-[2.6rem] font-bold leading-[1.05] tracking-[-0.02em] text-[#0b2d4d] sm:text-5xl lg:text-[3.6rem]">
                We make African markets <em className="text-[#1a4480]">legible.</em>
              </h1>
              <p className="mt-5 max-w-2xl text-[15px] leading-7 text-slate-700">
                StocksIntels turns prices, filings, fundamentals, insider activity and market sentiment into clear,
                risk-aware intelligence across <strong className="font-semibold text-slate-900">NSE Kenya</strong>,{" "}
                <strong className="font-semibold text-slate-900">NGX Nigeria</strong>,{" "}
                <strong className="font-semibold text-slate-900">JSE South Africa</strong> and US markets.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link to="/login" className="inline-flex items-center gap-2 bg-[#1a4480] px-5 py-3 text-sm font-semibold text-white hover:bg-[#0b2d4d]">
                  Explore the platform <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <a href="#coverage" className="inline-flex items-center gap-2 border border-[#1a4480] px-5 py-3 text-sm font-semibold text-[#1a4480] hover:bg-[#f2f6fa]">
                  View coverage
                </a>
              </div>
              <div className="mt-8 grid max-w-xl grid-cols-3 gap-4 border-t border-slate-200 pt-5">
                <div>
                  <p className="font-serif text-2xl font-bold text-[#0b2d4d]">4</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Exchange groups</p>
                </div>
                <div>
                  <p className="font-serif text-2xl font-bold text-[#0b2d4d]">10,000+</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Instruments tracked</p>
                </div>
                <div>
                  <p className="font-serif text-2xl font-bold text-[#0b2d4d]">1</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Research workspace</p>
                </div>
              </div>
            </div>

            <aside className="border border-slate-300 bg-[#f7f9fb]" aria-label="Market snapshot">
              <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#1a4480]">Market snapshot</p>
                  <p className="text-[11px] text-slate-500">Delayed quotes · {quotesLoading ? "loading" : "live"}</p>
                </div>
                <LineChart className="size-5 text-[#1a4480]" aria-hidden="true" />
              </div>
              <dl className="divide-y divide-slate-200">
                {snapshot.map((row) => {
                  const q = row.quote;
                  const change = q?.changePercent;
                  return (
                    <div key={row.symbol} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <dt className="font-mono text-sm font-bold text-slate-900">{row.label}</dt>
                        <dd className="text-[10px] uppercase tracking-wide text-slate-500">{row.isNse ? "NSE Kenya · KES" : "US · USD"}</dd>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-slate-900">
                          {row.isNse ? "KSh " : "$"}{formatPrice(q?.price)}
                        </p>
                        <p className={`text-[11px] font-semibold ${change == null ? "text-slate-400" : change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {formatChange(change)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </dl>
              <div className="border-t border-slate-300 px-4 py-3">
                <Link to="/app/markets" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1a4480] hover:underline">
                  Open full market data <ArrowRight className="size-3.5" />
                </Link>
              </div>
            </aside>
          </section>

          {/* Quick links */}
          <section className="border-b border-slate-300 py-10" aria-labelledby="quick-links-heading">
            <SectionHeading eyebrow="Start here" title="Quick links" />
            <div className="grid gap-px border border-slate-300 bg-slate-300 sm:grid-cols-2 lg:grid-cols-4">
              {QUICK_LINKS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="group bg-white p-4 transition-colors hover:bg-[#f2f6fa]"
                  >
                    <Icon className="size-5 text-[#1a4480]" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-bold text-[#0b2d4d] group-hover:underline">{item.label}</h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-600">{item.description}</p>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Latest news + upcoming sessions */}
          <div className="grid gap-10 border-b border-slate-300 py-10 lg:grid-cols-[1.25fr_0.75fr]">
            <section aria-labelledby="latest-news-heading">
              <SectionHeading
                eyebrow="Newsroom"
                title="Latest market intelligence"
                action={
                  <Link to="/app/news" className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#1a4480] hover:underline">
                    View all <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {(articles.length > 0 ? articles : [
                  { title: "How StocksIntels scores a stock", summary: "The evidence, gates and risk controls behind every rating.", source: "StocksIntels research" },
                  { title: "Coverage across NSE, NGX, JSE and US markets", summary: "One research workspace for African and global equities.", source: "StocksIntels research" },
                  { title: "Risk-aware targets and stops", summary: "How structure, ATR, liquidity and event risk shape a trade plan.", source: "StocksIntels research" },
                ]).map((article, index) => {
                  const href = (article as MarketArticle).url
                    || ((article as MarketArticle).slug ? `https://mystocks.africa/market-intel/${(article as MarketArticle).slug}` : "/app/news");
                  const date = (article as MarketArticle).publishedAt;
                  return (
                    <a key={(article as MarketArticle).id || index} href={href} className="group flex gap-4 py-4 first:pt-0 last:pb-0">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-bold uppercase tracking-wide text-[#1a4480]">
                          {(article as MarketArticle).source || "Market intelligence"}
                        </span>
                        <span className="mt-1 block font-serif text-lg font-bold leading-snug text-[#0b2d4d] group-hover:underline">
                          {article.title}
                        </span>
                        {(article as MarketArticle).summary && (
                          <span className="mt-1 block text-[12px] leading-5 text-slate-600">{(article as MarketArticle).summary}</span>
                        )}
                      </span>
                      {date && (
                        <span className="hidden shrink-0 pt-5 text-[11px] text-slate-500 sm:block">
                          {new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="events-heading">
              <SectionHeading
                eyebrow="Market calendar"
                title="Trading sessions"
                action={<Link to="/app/markets" className="text-[11px] font-bold uppercase tracking-wide text-[#1a4480] hover:underline">Markets</Link>}
              />
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {EVENTS.map((event) => (
                  <div key={event.market} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex size-10 shrink-0 items-center justify-center border border-slate-300 bg-[#f7f9fb] font-mono text-[10px] font-bold text-[#1a4480]">
                      {event.market}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0b2d4d]">{event.session}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-600">
                        <Clock3 className="size-3" aria-hidden="true" /> {event.time}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{event.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Featured intelligence */}
          <section className="border-b border-slate-300 py-10" aria-labelledby="featured-heading">
            <SectionHeading eyebrow="Featured research" title="The read" />
            <div className="grid gap-0 border border-slate-300 bg-[#f7f9fb] lg:grid-cols-[1fr_280px]">
              <div className="p-5 sm:p-7">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#1a4480]">Daily market intelligence</p>
                <p className="mt-3 font-serif text-xl font-bold leading-snug text-[#0b2d4d] sm:text-2xl">
                  {brief?.aiSignal || "Bullish or bearish, the evidence comes first. Read the market brief for the drivers, breadth and risk context behind today’s tape."}
                </p>
                {(brief?.aiSignalContext || brief?.globalToNseConnection) && (
                  <p className="mt-3 text-[13px] leading-6 text-slate-700">
                    {brief.aiSignalContext || brief.globalToNseConnection}
                  </p>
                )}
                <Link to="/app/signals" className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#1a4480] hover:underline">
                  Read market intelligence <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <div className="border-t border-slate-300 p-5 lg:border-l lg:border-t-0">
                <Database className="size-6 text-[#1a4480]" aria-hidden="true" />
                <p className="mt-3 text-xs font-bold text-[#0b2d4d]">Evidence over narrative</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-600">
                  Prices, filings, fundamentals, ownership and macro data are scored together; missing data is shown as missing, never invented.
                </p>
                <Link to="/app/signals/engine" className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1a4480] hover:underline">
                  Signal methodology <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </div>
          </section>

          {/* How it works */}
          <section className="border-b border-slate-300 py-10" aria-labelledby="method-heading">
            <SectionHeading eyebrow="Methodology" title="How we build a market view" />
            <div className="grid gap-0 border border-slate-300 sm:grid-cols-3">
              {[
                { n: "01", title: "Collect", body: "Exchange prices, SEC and local filings, fundamentals, insider transactions, news and macro data." },
                { n: "02", title: "Evaluate", body: "Fundamental, financial, technical, macro, news and ML evidence is scored with explicit quality and data gates." },
                { n: "03", title: "Plan", body: "Stops, targets and position sizes follow the risk framework: structure, ATR, liquidity, event risk and exposure." },
              ].map((item, index) => (
                <div key={item.n} className={`p-5 ${index > 0 ? "border-t border-slate-300 sm:border-l sm:border-t-0" : ""}`}>
                  <p className="font-mono text-xs font-bold text-[#1a4480]">{item.n}</p>
                  <h3 className="mt-2 font-serif text-lg font-bold text-[#0b2d4d]">{item.title}</h3>
                  <p className="mt-2 text-[12px] leading-6 text-slate-600">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Coverage */}
          <section id="coverage" className="border-b border-slate-300 py-10" aria-labelledby="coverage-heading">
            <SectionHeading eyebrow="Coverage" title="Markets we cover" />
            <div className="overflow-hidden border border-slate-300">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-[#0b2d4d] text-white">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide">Exchange</th>
                    <th scope="col" className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide">Market</th>
                    <th scope="col" className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide">Tracked</th>
                    <th scope="col" className="hidden px-4 py-3 text-[11px] font-bold uppercase tracking-wide sm:table-cell">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {COVERAGE.map((row) => (
                    <tr key={row.market} className="hover:bg-[#f7f9fb]">
                      <td className="px-4 py-3 font-mono text-xs font-bold text-[#1a4480]">{row.market}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{row.name}</td>
                      <td className="px-4 py-3 text-right font-mono text-[13px] font-bold text-slate-900">{row.count}</td>
                      <td className="hidden px-4 py-3 text-[11px] text-slate-500 sm:table-cell">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              Counts reflect the current tracked universe and vary by plan and data availability. US coverage includes SEC-reporting companies.
            </p>
          </section>

          {/* Pricing */}
          <section id="plans" className="border-b border-slate-300 py-10" aria-labelledby="plans-heading">
            <SectionHeading
              eyebrow="Plans"
              title="Research access"
              action={
                <div className="inline-flex border border-slate-400 text-[11px] font-semibold">
                  <button type="button" onClick={() => setBilling("monthly")} className={`px-3 py-1.5 ${billing === "monthly" ? "bg-[#1a4480] text-white" : "bg-white text-slate-700"}`}>
                    Monthly
                  </button>
                  <button type="button" onClick={() => setBilling("yearly")} className={`border-l border-slate-400 px-3 py-1.5 ${billing === "yearly" ? "bg-[#1a4480] text-white" : "bg-white text-slate-700"}`}>
                    Yearly
                  </button>
                </div>
              }
            />
            {billing === "yearly" && <p className="mb-3 text-[11px] font-semibold text-[#1a4480]">{YEARLY_SAVINGS_LABEL}</p>}
            <div className="grid gap-4 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <div key={plan.id} className={`flex flex-col border bg-white p-5 ${plan.popular ? "border-[#1a4480] ring-1 ring-[#1a4480]" : "border-slate-300"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-serif text-xl font-bold text-[#0b2d4d]">{plan.name}</h3>
                    {plan.popular && <span className="bg-[#1a4480] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Most popular</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{plan.tagline}</p>
                  <p className="mt-4 font-serif text-3xl font-bold text-[#0b2d4d]">
                    ${billing === "yearly" ? plan.yearlyPrice : plan.monthlyPrice}
                    <span className="ml-1 font-sans text-[11px] font-normal text-slate-500">/{billing === "yearly" ? "year" : "month"}</span>
                  </p>
                  <ul className="mt-4 flex-1 space-y-2 border-t border-slate-200 pt-4">
                    {plan.highlights.map((item) => (
                      <li key={item} className="flex gap-2 text-[11px] leading-5 text-slate-700">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-[#1a4480]" aria-hidden="true" /> {item}
                      </li>
                    ))}
                  </ul>
                  <Link to="/login" className={`mt-5 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold ${plan.popular ? "bg-[#1a4480] text-white hover:bg-[#0b2d4d]" : "border border-[#1a4480] text-[#1a4480] hover:bg-[#f2f6fa]"}`}>
                    Start free trial <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="border-b border-slate-300 py-10" aria-labelledby="faq-heading">
            <SectionHeading eyebrow="Questions" title="Frequently asked" />
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {FAQS.map((item) => (
                <details key={item.q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-[#0b2d4d]">
                    {item.q}
                    <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                  </summary>
                  <p className="mt-2 max-w-3xl text-[12px] leading-6 text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Contact */}
          <section className="grid gap-8 border-b border-slate-300 py-10 lg:grid-cols-[0.9fr_1.1fr]" aria-labelledby="contact-heading">
            <div>
              <SectionHeading eyebrow="Contact" title="Talk to the team" />
              <p className="max-w-md text-[13px] leading-6 text-slate-700">
                Questions about coverage, plans or the signal engine? Send a message and we will respond directly.
              </p>
              <div className="mt-5 space-y-3 text-[12px] text-slate-700">
                <p className="inline-flex items-center gap-2"><Mail className="size-4 text-[#1a4480]" aria-hidden="true" /> support@stocksintels.com</p>
                <p className="inline-flex items-center gap-2"><Globe2 className="size-4 text-[#1a4480]" aria-hidden="true" /> Nairobi · Lagos · Johannesburg · Global</p>
              </div>
            </div>
            <form onSubmit={submitContact} className="border border-slate-300 bg-[#f7f9fb] p-4 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Name
                  <input required value={contact.name} onChange={(e) => setContact((v) => ({ ...v, name: e.target.value }))} className="mt-1 block w-full border border-slate-400 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a4480]" />
                </label>
                <label className="block text-[11px] font-semibold text-slate-700">
                  Email
                  <input required type="email" value={contact.email} onChange={(e) => setContact((v) => ({ ...v, email: e.target.value }))} className="mt-1 block w-full border border-slate-400 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a4480]" />
                </label>
              </div>
              <label className="mt-3 block text-[11px] font-semibold text-slate-700">
                Subject
                <input value={contact.subject} onChange={(e) => setContact((v) => ({ ...v, subject: e.target.value }))} className="mt-1 block w-full border border-slate-400 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a4480]" />
              </label>
              <label className="mt-3 block text-[11px] font-semibold text-slate-700">
                Message
                <textarea required rows={4} value={contact.message} onChange={(e) => setContact((v) => ({ ...v, message: e.target.value }))} className="mt-1 block w-full resize-y border border-slate-400 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#1a4480]" />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={contactStatus === "sending"} className="inline-flex items-center gap-1.5 bg-[#1a4480] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b2d4d] disabled:opacity-60">
                  {contactStatus === "sending" ? "Sending…" : "Send message"} <ArrowRight className="size-3.5" />
                </button>
                {contactStatus === "sent" && <p className="text-[11px] font-semibold text-emerald-700">Message sent. We will respond shortly.</p>}
                {contactStatus === "error" && <p className="text-[11px] font-semibold text-rose-700">Could not send. Please email support@stocksintels.com.</p>}
              </div>
            </form>
          </section>
        </div>
      </main>

      <footer className="bg-[#0b2d4d] text-white">
        <div className="mx-auto max-w-[1180px] px-4 py-10">
          <div className="grid gap-8 border-b border-white/20 pb-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="font-serif text-lg font-bold tracking-[0.08em]">STOCKSINTELS</p>
              <p className="mt-2 max-w-xs text-[11px] leading-5 text-white/70">
                Independent market intelligence for African and global equities.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">Platform</p>
              <ul className="mt-3 space-y-2 text-[11px] text-white/85">
                <li><Link to="/app/markets" className="hover:underline">Markets</Link></li>
                <li><Link to="/app/signals" className="hover:underline">Market intelligence</Link></li>
                <li><Link to="/app/financials" className="hover:underline">Financial statements</Link></li>
                <li><Link to="/app/insider" className="hover:underline">Insider activity</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">Coverage</p>
              <ul className="mt-3 space-y-2 text-[11px] text-white/85">
                <li><Link to="/app/markets?exchange=NSE" className="hover:underline">Nairobi (NSE)</Link></li>
                <li><Link to="/app/markets?exchange=NGX" className="hover:underline">Nigeria (NGX)</Link></li>
                <li><Link to="/app/markets?exchange=JSE" className="hover:underline">Johannesburg (JSE)</Link></li>
                <li><Link to="/app/markets?exchange=Global" className="hover:underline">US markets</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">Company</p>
              <ul className="mt-3 space-y-2 text-[11px] text-white/85">
                <li><Link to="/about" className="hover:underline">About</Link></li>
                <li><a href="#plans" className="hover:underline">Plans</a></li>
                <li><a href="mailto:support@stocksintels.com" className="hover:underline">Contact</a></li>
                <li><Link to="/login" className="hover:underline">Sign in</Link></li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 pt-6 text-[10px] leading-5 text-white/60">
            <p className="max-w-2xl">
              StocksIntels is an independent financial data and research platform. We are not affiliated with, endorsed by, or operated by the U.S. Securities and Exchange Commission or any government agency. Nothing on this page is investment advice.
            </p>
            <p>© {new Date().getFullYear()} StocksIntels</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
