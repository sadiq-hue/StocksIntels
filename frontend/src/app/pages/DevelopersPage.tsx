import { PublicBrandHeader, PublicBrandFooter } from "../components/PublicBrandChrome";
import { Link, useNavigate } from "react-router";
import { Github, Terminal, BookOpen, Shield, Zap, Users, FlaskConical, Key, Copy, Check, AlertTriangle, ExternalLink, ArrowRight, CheckCircle, Server, Wifi, Clock, Database, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { useState } from "react";

const features = [
  {
    icon: Terminal,
    title: "Market Data API",
    description: "Access market quotes, historical prices and index data across supported African and international exchanges through REST endpoints and WebSocket connections.",
    endpoint: "/api/market",
  },
  {
    icon: BookOpen,
    title: "Company Financials API",
    description: "Retrieve structured company financial information, including income statements, balance sheets, cash flow statements, key financial metrics and dividend information.",
    endpoint: "/api/financials",
  },
  {
    icon: Zap,
    title: "Recommended Positions API",
    description: "Integrate StocksIntels research outputs into your applications. Access recommended positions, analytical confidence scores, entry and exit references, risk parameters and risk-reward assessments where supported. These outputs are designed to support research and decision-making, not guarantee investment outcomes.",
    endpoint: "/api/recommended-positions",
  },
  {
    icon: Shield,
    title: "Authentication API",
    description: "Secure your integrations with supported authentication mechanisms, including API keys, JWT authentication, token refresh and role-based access controls.",
    endpoint: "/api/auth",
  },
  {
    icon: Github,
    title: "Webhooks API",
    description: "Connect your application to supported market and research events. Subscribe to event notifications such as price alerts, recommended-position updates, earnings releases and news intelligence.",
    endpoint: "/api/webhooks",
  },
  {
    icon: Users,
    title: "Portfolio & Watchlist API",
    description: "Integrate portfolio tracking, watchlist management and paper-trading functionality into your applications.",
    endpoint: "/api/portfolio",
  },
];

const apiResponseExample = `{
  "symbol": "SCOM",
  "name": "Safaricom Plc",
  "price": 28.45,
  "currency": "KES",
  "change": -0.35,
  "changePercent": -1.21,
  "exchange": "NSE",
  "timestamp": "2026-11-23T10:30:00Z",
  "volume": 2847562,
  "marketCap": 1142000000000,
  "dayHigh": 28.95,
  "dayLow": 28.10,
  "yearHigh": 32.50,
  "yearLow": 22.10
}`;

const onboardingSteps = [
  { number: 1, title: "Create Account", description: "Sign up for a StocksIntels developer account", icon: CheckCircle },
  { number: 2, title: "Generate API Key", description: "Create production or sandbox credentials in your dashboard", icon: Key },
  { number: 3, title: "Make First Request", description: "Test with cURL, SDK, or the interactive playground", icon: Terminal },
  { number: 4, title: "Explore Endpoints", description: "Browse market data, financials, positions, and webhooks", icon: BookOpen },
  { number: 5, title: "Deploy", description: "Switch to production credentials and scale your integration", icon: Server },
];

const reliabilityInfo = [
  { 
    icon: Wifi, 
    title: "Uptime", 
    value: "99.95%", 
    description: "90-day rolling uptime across all API endpoints. Pro: 99.9% SLA with credits; Enterprise: 99.99% with financial backing" 
  },
  { 
    icon: Server, 
    title: "Status & Incidents", 
    value: "status.stocksintels.com", 
    description: "Real-time status page with incident history, scheduled maintenance windows, and RSS/JSON feeds for monitoring" 
  },
  { 
    icon: Clock, 
    title: "Rate Limits", 
    value: "Per-tier headers", 
    description: "X-RateLimit-Limit/Remaining/Reset on every response. Free: 1K/day, 10/sec burst. Pro: 100K/day, 50/sec. Enterprise: custom. 429 returns Retry-After" 
  },
  { 
    icon: AlertCircle, 
    title: "Error Format", 
    value: "RFC 9457", 
    description: "Standardized problem details: type, title, status, detail, instance, trace_id. Codes: 400/401/403/404/422/429/500/503. trace_id for support correlation" 
  },
  { 
    icon: Database, 
    title: "Pagination", 
    value: "Cursor + offset", 
    description: "Cursor-based for real-time feeds (positions, quotes), offset/limit for historical (financials, history). Max page size: 500. Stable cursors for 24h" 
  },
  { 
    icon: RotateCcw, 
    title: "WebSocket", 
    value: "Native + SSE", 
    description: "WebSocket (ws://api.stocksintels.com/stream) with auto-reconnect: 1s, 2s, 4s, 8s, 16s, max 30s + 30s heartbeat. SSE fallback at /api/market/stream. Max 50 symbols/connection" 
  },
  { 
    icon: Clock, 
    title: "African Markets", 
    value: "Real-time", 
    description: "Live tick feed across NSE (Kenya), NGX (Nigeria), JSE (South Africa), BSE (Botswana), DSE (Tanzania), USE (Uganda), RSE (Rwanda) during local market hours. Pre-open, post-close, corporate actions within 5 min" 
  },
  { 
    icon: Clock, 
    title: "Global Markets", 
    value: "Real-time", 
    description: "US equities (IEX, Cboe, NYSE, NASDAQ), European & Asian exchanges — all real-time via aggregated exchange feeds. Sub-second US, 1-sec Europe/Asia. Equities only" 
  },
];

const pricingTiers = [
  {
    tier: "Free",
    requests: "1,000",
    websocket: false,
    features: "REST API, end-of-day data",
    price: "Free",
  },
  {
    tier: "Starter",
    requests: "10,000",
    websocket: false,
    features: "REST API, real-time quotes, basic recommended positions",
    price: "$29.94/month",
  },
  {
    tier: "Pro",
    requests: "100,000",
    websocket: true,
    features: "Real-time data, recommended positions, webhooks, WebSocket streaming",
    price: "$49.83/month",
  },
  {
    tier: "Enterprise",
    requests: "Custom",
    websocket: true,
    features: "Dedicated infrastructure, service-level agreements and tailored data access",
    price: "Custom",
  },
];

const sandboxEndpoints = [
  { method: "GET", path: "/api/sandbox/market/quote/:symbol", description: "Retrieve a simulated market quote" },
  { method: "GET", path: "/api/sandbox/market/quotes", description: "Retrieve simulated quotes for multiple symbols" },
  { method: "GET", path: "/api/sandbox/financials/:symbol", description: "Retrieve mock company financial statements" },
  { method: "GET", path: "/api/sandbox/recommended-positions/:symbol", description: "Retrieve simulated research outputs" },
  { method: "GET", path: "/api/sandbox/portfolio", description: "Retrieve a simulated paper-trading portfolio" },
  { method: "POST", path: "/api/sandbox/orders", description: "Simulate market, limit and stop order workflows" },
  { method: "GET", path: "/api/sandbox/webhooks/test", description: "Test webhook event handling" },
];

const quickStartCode = {
  curl: `curl -H "Authorization: Bearer YOUR_TOKEN" \\
  "https://api.stocksintels.com/api/market/quote/SCOM"`,
  javascript: `import { StocksIntels } from '@stocksintels/sdk';

const client = new StocksIntels({ apiKey: 'YOUR_API_KEY' });

const quote = await client.market.getQuote('SCOM');
console.log(quote.price, quote.changePercent);`,
  python: `from stocksintels import StocksIntels

client = StocksIntels(api_key="YOUR_API_KEY")

position = client.recommended_positions.get_latest("AAPL")
print(position.recommendation, position.confidence, position.entry)`,
};

const prodSandboxComparison = [
  { label: "Base URL", production: "https://api.stocksintels.com", sandbox: "https://api-sandbox.stocksintels.com" },
  { label: "Key Prefix", production: "sk_live_...", sandbox: "sk_sandbox_..." },
  { label: "Data Source", production: "Live market data", sandbox: "Simulated/mock data" },
  { label: "Rate Limits", production: "Per tier (see pricing)", sandbox: "No enforced limits" },
  { label: "Webhooks", production: "Delivered to your URLs", sandbox: "Logged only (not delivered)" },
  { label: "Orders", production: "Real execution", sandbox: "Simulated only" },
];

const sandboxCodeExamples = {
  bash: `curl -H "Authorization: Bearer sk_sandbox_..." \\
  "https://api-sandbox.stocksintels.com/api/sandbox/market/quote/SCOM"`,
  javascript: `import { StocksIntels } from '@stocksintels/sdk';

const client = new StocksIntels({
  apiKey: 'sk_sandbox_...',
  environment: 'sandbox'
});

const quote = await client.market.getQuote('SCOM');
console.log(quote.price, quote.changePercent);`,
  python: `from stocksintels import StocksIntels

client = StocksIntels(
    api_key="sk_sandbox_...",
    environment="sandbox"
)

quote = client.market.get_quote("SCOM")
print(quote.price, quote.change_percent)`,
};

export function DevelopersPage() {
  const [sandboxKey, setSandboxKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const generateSandboxKey = () => {
    const key = `sk_sandbox_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    setSandboxKey(key);
    setCopied(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        {/* Hero with Code Editor Visual */}
        <section className="relative mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0D7490]/10 text-[#0D7490] text-sm font-medium mb-6">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                StocksIntels Financial Intelligence API
              </span>
              <h1 className="text-4xl font-extrabold tracking-[-0.02em] text-[#102B50] sm:text-5xl lg:text-6xl leading-tight">
                Build financial products on African & global market infrastructure
              </h1>
              <p className="mt-6 text-lg leading-7 text-[#4386C8] max-w-xl">
                Market data, company financials, Super Intelligence-driven research outputs, and portfolio tooling — one unified API.
              </p>
<div className="mt-8 flex flex-wrap gap-4">
              <Button asChild size="lg">
                <Link to="/developers/pricing">Get API Key</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/developers/docs">Explore API Documentation</Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <a href="https://github.com/stocksintels" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                  View on GitHub <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
              <p className="mt-6 text-sm text-[#52647A]">
                Trusted by fintechs, brokerages, wealth platforms & institutional researchers across Africa
              </p>
            </div>

            {/* Code Editor / API Response Preview */}
            <div className="relative">
              <div className="rounded-xl border border-[#DCE5F0] bg-[#0B203D] overflow-hidden shadow-2xl">
                {/* Editor toolbar */}
                <div className="flex items-center gap-2 px-4 py-3 bg-[#112744] border-b border-white/10">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                    <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  </div>
                  <div className="flex-1 text-center text-xs text-slate-500 font-mono">GET /api/market/quote/SCOM</div>
                  <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">200 OK</span>
                </div>
                {/* Response preview */}
                <pre className="p-4 overflow-x-auto max-h-96"><code className="text-sm text-slate-200 font-mono leading-relaxed">{apiResponseExample}</code></pre>
                {/* Response headers */}
                <div className="px-4 py-3 bg-[#112744] border-t border-white/10 text-xs text-slate-500 font-mono">
                  <div>content-type: application/json</div>
                  <div>x-ratelimit-limit: 100000</div>
                  <div>x-ratelimit-remaining: 99847</div>
                  <div>x-ratelimit-reset: 1700737200</div>
                </div>
              </div>
              {/* Floating badge */}
              <div className="absolute -top-4 -right-4 bg-[#0D7490] text-white px-3 py-1 rounded-lg text-xs font-medium shadow-lg">
                Live API response
              </div>
            </div>
          </div>
        </section>

        {/* Developer Onboarding Sequence */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl font-bold text-[#102B50]">Get Integrated in Minutes</h2>
              <p className="mt-4 text-[#52647A]">A straightforward path from account to production deployment</p>
            </div>
            <div className="relative">
              {/* Connecting line */}
              <div className="absolute top-8 left-0 right-0 h-0.5 bg-[#DCE5F0]" />
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                {onboardingSteps.map((step, i) => (
                  <div key={step.number} className="relative flex flex-col items-center z-10">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-white border-2 border-[#DCE5F0] relative z-10">
                      <span className="text-2xl font-bold text-[#0D7490]">{step.number}</span>
                    </div>
                    <div className="mt-4 text-center w-40 sm:w-48">
                      <h3 className="font-semibold text-[#102B50]">{step.title}</h3>
                      <p className="mt-1 text-sm text-[#52647A]">{step.description}</p>
                    </div>
                    {step.icon && (
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white border-2 border-[#DCE5F0] flex items-center justify-center">
                        <step.icon className="size-5 text-green-500" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* API Capabilities */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-[#102B50]">API Capabilities</h2>
            <p className="mt-4 text-[#52647A]">
              Financial data and intelligence through one API.
            </p>
            <p className="mt-2 text-[#52647A]">
              Access the market information, company fundamentals and analytical capabilities needed to build modern financial products.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <Card key={i} className="border-[#DCE5F0] hover:border-[#2563A6]/50 transition-colors">
                <CardHeader>
                  <feature.icon className="size-6 text-[#2563A6] mb-2" />
                  <CardTitle className="text-[#102B50]">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[#52647A] text-sm">{feature.description}</p>
                  <code className="mt-3 block text-xs bg-[#F1F5F9] px-2 py-1 rounded font-mono text-[#2563A6]">
                    {feature.endpoint}
                  </code>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Quick Start with Actual Response */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-3xl font-bold text-[#102B50]">Quick Start</h2>
              <p className="mt-4 text-[#52647A]">
                Make your first API request.
              </p>
              <p className="mt-2 text-[#52647A]">
                Start integrating StocksIntels in minutes. Choose your preferred development environment and retrieve your first market quote.
              </p>
            </div>
            
            {/* Request/Response Pair */}
            <div className="grid lg:grid-cols-2 gap-6 mb-8">
              <div className="rounded-xl border border-[#DCE5F0] bg-white overflow-hidden">
                <div className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] flex items-center justify-between">
                  <span className="text-xs font-mono text-[#52647A]">Request</span>
                  <span className="text-xs text-[#52647A]">GET /api/market/quote/SCOM</span>
                </div>
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-[#0B203D] font-mono leading-relaxed">{quickStartCode.curl}</code></pre>
              </div>
              <div className="rounded-xl border border-[#DCE5F0] bg-[#0B203D] overflow-hidden">
                <div className="px-4 py-3 bg-[#112744] border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">Response</span>
                  <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">200 OK</span>
                </div>
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-slate-200 font-mono leading-relaxed">{apiResponseExample}</code></pre>
              </div>
            </div>

            {/* Multi-language examples */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-[#DCE5F0] bg-white overflow-hidden">
                <div className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] flex items-center justify-between">
                  <span className="text-xs font-mono text-[#52647A]">cURL</span>
                </div>
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-[#0B203D] font-mono leading-relaxed">{quickStartCode.curl}</code></pre>
              </div>
              <div className="rounded-xl border border-[#DCE5F0] bg-white overflow-hidden">
                <div className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] flex items-center justify-between">
                  <span className="text-xs font-mono text-[#52647A]">JavaScript</span>
                </div>
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-[#0B203D] font-mono leading-relaxed">{quickStartCode.javascript}</code></pre>
              </div>
              <div className="rounded-xl border border-[#DCE5F0] bg-white overflow-hidden">
                <div className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] flex items-center justify-between">
                  <span className="text-xs font-mono text-[#52647A]">Python</span>
                </div>
                <pre className="p-4 overflow-x-auto"><code className="text-sm text-[#0B203D] font-mono leading-relaxed">{quickStartCode.python}</code></pre>
              </div>
            </div>
            <p className="mt-8 text-center text-sm text-[#52647A]">
              *Replace credentials and example values with valid integration details. Refer to the API documentation for the current authentication and response schemas.
            </p>
          </div>
        </section>

        {/* Developer Resources */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold text-[#102B50]">Developer Resources</h2>
            <p className="mt-4 text-[#52647A]">
              Everything you need to build, test and deploy your integration.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-[#DCE5F0]">
              <CardContent className="pt-6">
                <BookOpen className="size-6 text-[#2563A6] mb-3" />
                <h3 className="font-semibold text-[#102B50] mb-2">API Reference</h3>
                <p className="text-sm text-[#52647A] mb-4">Explore available endpoints, authentication requirements, request parameters, response schemas and error codes.</p>
                <Button asChild variant="link" className="text-sm p-0">
                  <Link to="/developers/docs">Read API Documentation →</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardContent className="pt-6">
                <Github className="size-6 text-[#2563A6] mb-3" />
                <h3 className="font-semibold text-[#102B50] mb-2">SDKs & Libraries</h3>
                <p className="text-sm text-[#52647A] mb-4">Explore available client libraries, integration examples and implementation guidance for supported programming languages.</p>
                <Button asChild variant="link" className="text-sm p-0">
                  <a href="https://github.com/stocksintels/sdks" target="_blank" rel="noopener noreferrer">Explore SDKs →</a>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardContent className="pt-6">
                <Terminal className="size-6 text-[#2563A6] mb-3" />
                <h3 className="font-semibold text-[#102B50] mb-2">Interactive API Playground</h3>
                <p className="text-sm text-[#52647A] mb-4">Experiment with supported API endpoints, inspect responses and test integration workflows in an interactive environment.</p>
                <Button asChild variant="link" className="text-sm p-0">
                  <Link to="/developers/playground">Open Playground →</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardContent className="pt-6">
                <Shield className="size-6 text-[#2563A6] mb-3" />
                <h3 className="font-semibold text-[#102B50] mb-2">Authentication Guide</h3>
                <p className="text-sm text-[#52647A] mb-4">Understand API keys, authentication flows, token management, access permissions and security requirements.</p>
                <Button asChild variant="link" className="text-sm p-0">
                  <Link to="/developers/auth">View Authentication Guide →</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* API Reliability Information */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-3xl font-bold text-[#102B50]">API Reliability & Operations</h2>
              <p className="mt-4 text-[#52647A]">
                Production-grade infrastructure metrics, data freshness guarantees, and integration contracts — verified and continuously monitored.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {reliabilityInfo.map((item, i) => (
                <Card key={i} className="border-[#DCE5F0]">
                  <CardContent className="pt-6">
                    <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                      <item.icon className="size-5 text-[#0D7490]" />
                    </div>
                    <h3 className="font-semibold text-[#102B50] mb-1">{item.title}</h3>
                    <p className="text-lg font-bold text-[#0D7490] mb-1">{item.value}</p>
                    <p className="text-sm text-[#52647A]">{item.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* API Plans & Rate Limits */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl font-bold text-[#102B50]">API Plans & Rate Limits</h2>
            <p className="mt-4 text-[#52647A]">
              Start free. Scale as your application grows.
            </p>
            <p className="mt-2 text-[#52647A]">
              Choose an API access tier based on your integration requirements, data access needs and application usage.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#DCE5F0]">
                  <th className="pb-3 font-semibold text-[#102B50]">Tier</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-right">Requests per day</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-center">WebSocket</th>
                  <th className="pb-3 font-semibold text-[#102B50]">Access</th>
                  <th className="pb-3 font-semibold text-[#102B50] text-right">Pricing</th>
                </tr>
              </thead>
              <tbody>
                {pricingTiers.map((tier, i) => (
                  <tr key={i} className="border-b border-[#DCE5F0]/50">
                    <td className="py-4 font-medium text-[#102B50]">{tier.tier}</td>
                    <td className="py-4 text-[#52647A] text-right">{tier.requests}</td>
                    <td className="py-4 text-center">
                      {tier.websocket ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          Included
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          Not included
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-[#52647A]">{tier.features}</td>
                    <td className="py-4 font-semibold text-[#2563A6] text-right">{tier.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-center text-sm text-[#52647A]">
            *Availability of specific datasets, exchanges and analytical endpoints depends on your subscription and applicable data permissions. Enterprise limits and service terms are agreed individually.
          </p>
          <div className="mt-8 text-center">
            <Button asChild variant="outline" size="lg">
              <Link to="/pricing">View API Pricing →</Link>
            </Button>
          </div>
        </section>

        {/* Production vs Sandbox Credentials */}
        <section className="bg-white py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <Shield className="size-8 text-[#0D7490] mx-auto mb-4" />
              <h2 className="text-3xl font-bold text-[#102B50]">Production vs Sandbox Credentials</h2>
              <p className="mt-4 text-[#52647A]">
                Clear separation between environments. Use the right credentials for the right stage.
              </p>
            </div>

            <div className="overflow-x-auto mb-8">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-[#DCE5F0]">
                    <th className="pb-3 font-semibold text-[#102B50] w-32">Property</th>
                    <th className="pb-3 font-semibold text-[#102B50] text-center">Production</th>
                    <th className="pb-3 font-semibold text-[#102B50] text-center">Sandbox</th>
                  </tr>
                </thead>
                <tbody>
                  {prodSandboxComparison.map((row, i) => (
                    <tr key={i} className="border-b border-[#DCE5F0]/50">
                      <td className="py-3 font-medium text-[#102B50]">{row.label}</td>
                      <td className="py-3 text-center">
                        <code className="bg-[#F5F8FC] px-2 py-1 rounded font-mono text-sm text-[#0D7490]">{row.production}</code>
                      </td>
                      <td className="py-3 text-center">
                        <code className="bg-[#F5F8FC] px-2 py-1 rounded font-mono text-sm text-amber-600">{row.sandbox}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Warning Card */}
            <Card className="border-red-200 bg-red-50 mb-8">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <AlertTriangle className="size-5 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-red-900 mb-2">Important: Never use production credentials in development</h4>
                    <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
                      <li>Production keys (sk_live_...) access real market data and execute real orders</li>
                      <li>Sandbox keys (sk_sandbox_...) only work on api-sandbox.stocksintels.com</li>
                      <li>Rate limits and billing apply only to production usage</li>
                      <li>Rotate production keys immediately if exposed in client-side code or public repos</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sandbox Section */}
            <FlaskConical className="size-8 text-amber-500 mx-auto mb-4 hidden sm:block" />
            <h3 className="text-2xl font-bold text-[#102B50] text-center mb-4">Sandbox Environment</h3>
            <p className="text-center text-[#52647A] mb-8 max-w-2xl mx-auto">
              Develop and validate your integration in a dedicated sandbox environment without relying on live market data or executing real transactions.
            </p>

            {/* Sandbox base URL */}
            <Card className="border-[#DCE5F0] mb-8">
              <CardContent className="pt-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-semibold text-[#102B50] mb-1">Sandbox base URL</h4>
                    <code className="bg-[#F1F5F9] px-3 py-1.5 rounded text-sm font-mono text-[#2563A6]">
                      https://api-sandbox.stocksintels.com
                    </code>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generate Sandbox Key */}
            {!sandboxKey ? (
              <Card className="border-[#DCE5F0] mb-8">
                <CardContent className="pt-6">
                  <div className="text-center py-4">
                    <Key className="size-10 text-[#2563A6]/50 mx-auto mb-3" />
                    <h3 className="font-semibold text-[#102B50] mb-2">Generate a Sandbox API Key</h3>
                    <p className="text-sm text-[#52647A] mb-4 max-w-md mx-auto">
                      Create a sandbox credential to start testing supported endpoints. Basic sandbox access is available without a production subscription.
                    </p>
                    <Button onClick={generateSandboxKey} className="w-full sm:w-auto">
                      <Key className="size-4 mr-2" />
                      Generate Sandbox Key
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-amber-200 bg-amber-50 mb-8">
                <CardContent className="pt-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <Key className="size-5 text-amber-600" />
                      <div>
                        <p className="font-medium text-[#102B50]">Your Sandbox API Key</p>
                        <p className="text-sm text-[#52647A]">Save this — it won&apos;t be shown again</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <code className="bg-white px-3 py-2 rounded font-mono text-sm text-[#102B50] border border-amber-200 flex-1 md:w-80 break-all">
                        {sandboxKey}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(sandboxKey)}
                        disabled={copied}
                      >
                        {copied ? (
                          <>
                            <Check className="size-4 mr-2 text-green-600" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="size-4 mr-2" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sandbox Endpoints */}
            <div className="mb-8">
              <h3 className="font-semibold text-[#102B50] mb-4">Sandbox Endpoints</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-[#DCE5F0]">
                      <th className="pb-3 font-semibold text-[#102B50] w-24">Method</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Endpoint</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sandboxEndpoints.map((ep, i) => (
                      <tr key={i} className="border-b border-[#DCE5F0]/50 hover:bg-[#F8FAFC]">
                        <td className="py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#2563A6]/10 text-[#2563A6]">
                            {ep.method}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-[#102B50]">{ep.path}</td>
                        <td className="py-3 text-[#52647A]">{ep.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sandbox Quick Start */}
            <div className="mb-8">
              <h3 className="font-semibold text-[#102B50] mb-4">Sandbox Quick Start</h3>
              <div className="grid gap-6 lg:grid-cols-3">
                {Object.entries(sandboxCodeExamples).map(([lang, code]) => (
                  <div key={lang} className="rounded-xl bg-[#0B203D] border border-white/10 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                      <span className="text-xs font-mono text-cyan-300">{lang}</span>
                      <span className="text-xs text-slate-500">Sandbox</span>
                    </div>
                    <pre className="p-4 overflow-x-auto"><code className="text-sm text-slate-200 font-mono leading-relaxed">{code}</code></pre>
                  </div>
                ))}
              </div>
            </div>

            {/* Important Sandbox Information */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <AlertTriangle className="size-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-amber-900 mb-2">Important Sandbox Information</h4>
                    <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
                      <li>Sandbox market prices, financial statements and recommended positions are simulated.</li>
                      <li>Sandbox credentials are restricted to the sandbox environment.</li>
                      <li>No live trades or real-money transactions are executed.</li>
                      <li>Order requests simulate execution workflows only.</li>
                      <li>Sandbox webhook events are logged for testing and are not delivered to external URLs.</li>
                      <li>Sandbox results should not be used for investment decisions.</li>
                      <li>Switch to the production environment and use production credentials when your integration is ready.</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 text-center">
          <h2 className="text-3xl font-bold text-[#102B50]">Ready to Build with StocksIntels?</h2>
          <p className="mt-4 text-lg text-[#52647A] max-w-xl mx-auto">
            Your application. Our financial intelligence infrastructure.
          </p>
          <p className="mt-2 text-[#52647A] max-w-xl mx-auto">
            Integrate market data, company financials and research capabilities into your next financial product.
          </p>
          <p className="mt-2 text-[#52647A] max-w-xl mx-auto">
            Start with the free API tier and expand as your application grows.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button asChild size="lg">
              <Link to="/login?redirect=/settings?tab=api-keys">Get Started Free</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/pricing">Explore API Pricing</Link>
            </Button>
          </div>
          <p className="mt-8 text-xl font-semibold text-[#102B50]">
            StocksIntels — Financial Intelligence. Elevated.
          </p>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}