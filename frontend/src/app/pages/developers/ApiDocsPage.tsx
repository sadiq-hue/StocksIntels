import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link } from "react-router";
import { ChevronRight, Copy, Check, Search, ExternalLink, Key, Loader2, AlertTriangle, Shield, Crown, Terminal, Globe, Lock, BookOpen, Code, Zap, Layers, Info, ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Badge } from "../../components/ui/badge";
import { Separator } from "../../components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../components/ui/accordion";
import { useState, useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";

interface Endpoint {
  method: string;
  path: string;
  description: string;
  auth: boolean;
  params?: string[];
  body?: string[];
  query?: string[];
  responseExample?: string;
  curlExample?: string;
  jsExample?: string;
  pythonExample?: string;
  responses?: { code: number; title: string; description: string; example?: string }[];
}

interface TabConfig {
  id: string;
  label: string;
  count: number;
  icon: React.ReactNode;
}

const endpoints: Record<string, Endpoint[]> = {
  market: [
    {
      method: "GET",
      path: "/api/market/quote/:symbol",
      description: "Get real-time quote for a single symbol",
      auth: true,
      params: ["symbol"],
      responseExample: `{
  "symbol": "SCOM",
  "name": "Safaricom Plc",
  "price": 28.45,
  "currency": "KES",
  "change": -0.35,
  "changePercent": -1.21,
  "exchange": "NSE",
  "timestamp": "2026-01-15T10:30:00Z",
  "volume": 2847562,
  "marketCap": 1142000000000,
  "dayHigh": 28.95,
  "dayLow": 28.10,
  "yearHigh": 32.50,
  "yearLow": 22.10
}`,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/quote/SCOM"`,
      jsExample: `const quote = await client.market.getQuote('SCOM');
console.log(quote.price, quote.changePercent);`,
      pythonExample: `quote = client.market.get_quote("SCOM")
print(quote.price, quote.change_percent)`,
      responses: [
        { code: 200, title: "OK", description: "Successful response" },
        { code: 401, title: "Unauthorized", description: "Invalid or missing API key" },
        { code: 404, title: "Not Found", description: "Symbol not found" },
        { code: 429, title: "Too Many Requests", description: "Rate limit exceeded" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/quotes",
      description: "Get batch quotes for multiple symbols (max 100)",
      auth: true,
      query: ["symbols (comma-separated)"],
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/quotes?symbols=SCOM,AAPL,MSFT"`,
      responses: [
        { code: 200, title: "OK", description: "Array of quote objects" },
        { code: 400, title: "Bad Request", description: "Invalid symbols parameter" },
        { code: 429, title: "Too Many Requests", description: "Rate limit exceeded" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/history/:symbol",
      description: "Get historical price data for a symbol",
      auth: true,
      params: ["symbol"],
      query: ["interval (1m,5m,15m,1h,1d,1w,1M)", "from (ISO date)", "to (ISO date)", "limit (max 5000)"],
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/history/SCOM?interval=1d&from=2026-01-01&to=2026-12-31"`,
      responses: [
        { code: 200, title: "OK", description: "Array of OHLCV data points" },
        { code: 400, title: "Bad Request", description: "Invalid interval or date format" },
        { code: 404, title: "Not Found", description: "Symbol not found" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/indices",
      description: "Get all market indices with current values",
      auth: true,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/indices"`,
      responses: [
        { code: 200, title: "OK", description: "Array of index objects with value, change, changePercent" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/movers",
      description: "Get top gainers and losers",
      auth: true,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/movers"`,
      responses: [
        { code: 200, title: "OK", description: "Object with gainers and losers arrays" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/active",
      description: "Get most actively traded stocks",
      auth: true,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/market/active"`,
      responses: [
        { code: 200, title: "OK", description: "Array of active stocks with volume and turnover" }
      ]
    },
    {
      method: "GET",
      path: "/api/market/stream",
      description: "Server-Sent Events stream for real-time market updates",
      auth: true,
      query: ["symbols (optional, comma-separated)"],
      jsExample: `const eventSource = new EventSource(
  "https://api.stocksintels.com/api/market/stream?symbols=SCOM,AAPL",
  { headers: { Authorization: "Bearer YOUR_API_KEY" } }
);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Real-time update:", data);
};`,
      responses: [
        { code: 200, title: "OK", description: "SSE stream with real-time quote updates" }
      ]
    }
  ],
  financials: [
    {
      method: "GET",
      path: "/api/financials/:symbol",
      description: "Get company financial overview",
      auth: true,
      params: ["symbol"],
      responses: [
        { code: 200, title: "OK", description: "Financial overview with key metrics" },
        { code: 404, title: "Not Found", description: "Company not found" }
      ]
    },
    {
      method: "GET",
      path: "/api/financials/:symbol/income-statement",
      description: "Get income statement (annual/quarterly)",
      auth: true,
      params: ["symbol"],
      query: ["period (annual|quarterly)", "limit"],
      responses: [
        { code: 200, title: "OK", description: "Income statement data with revenue, expenses, net income" }
      ]
    },
    {
      method: "GET",
      path: "/api/financials/:symbol/balance-sheet",
      description: "Get balance sheet (annual/quarterly)",
      auth: true,
      params: ["symbol"],
      query: ["period (annual|quarterly)", "limit"],
      responses: [
        { code: 200, title: "OK", description: "Balance sheet with assets, liabilities, equity" }
      ]
    },
    {
      method: "GET",
      path: "/api/financials/:symbol/cash-flow",
      description: "Get cash flow statement (annual/quarterly)",
      auth: true,
      params: ["symbol"],
      query: ["period (annual|quarterly)", "limit"],
      responses: [
        { code: 200, title: "OK", description: "Cash flow from operations, investing, financing" }
      ]
    },
    {
      method: "GET",
      path: "/api/financials/:symbol/key-metrics",
      description: "Get key financial metrics and ratios",
      auth: true,
      params: ["symbol"],
      responses: [
        { code: 200, title: "OK", description: "PE, PB, ROE, ROA, debt ratios, margins, growth rates" }
      ]
    },
    {
      method: "GET",
      path: "/api/financials/:symbol/dividends",
      description: "Get dividend history",
      auth: true,
      params: ["symbol"],
      responses: [
        { code: 200, title: "OK", description: "Array of dividend payments with dates and amounts" }
      ]
    }
  ],
  positions: [
    {
      method: "GET",
      path: "/api/recommended-positions",
      description: "Get all current recommended positions",
      auth: true,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/recommended-positions"`,
      responses: [
        { code: 200, title: "OK", description: "Array of recommended positions with entry, stop, targets" }
      ]
    },
    {
      method: "GET",
      path: "/api/recommended-positions/:symbol",
      description: "Get recommended position for a specific symbol",
      auth: true,
      params: ["symbol"],
      responses: [
        { code: 200, title: "OK", description: "Single position with entry, stop, targets, confidence" },
        { code: 404, title: "Not Found", description: "No position found for symbol" }
      ]
    },
    {
      method: "GET",
      path: "/api/recommended-positions/history",
      description: "Get historical recommended positions",
      auth: true,
      query: ["from", "to", "limit", "symbol"],
      responses: [
        { code: 200, title: "OK", description: "Paginated history of recommended positions" }
      ]
    }
  ],
  auth: [
    {
      method: "POST",
      path: "/api/auth/register",
      description: "Register new user account",
      auth: false,
      body: ["email", "password", "full_name"],
      curlExample: `curl -X POST "https://api.stocksintels.com/api/auth/register" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "securepass", "full_name": "John Doe"}'`,
      responses: [
        { code: 201, title: "Created", description: "User created, verification email sent" },
        { code: 400, title: "Bad Request", description: "Validation error" },
        { code: 409, title: "Conflict", description: "Email already registered" }
      ]
    },
    {
      method: "POST",
      path: "/api/auth/login",
      description: "Login with email/password, returns JWT access token",
      auth: false,
      body: ["email", "password"],
      curlExample: `curl -X POST "https://api.stocksintels.com/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "password"}'`,
      responses: [
        { code: 200, title: "OK", description: "Returns access_token, refresh_token, user object" },
        { code: 401, title: "Unauthorized", description: "Invalid credentials" }
      ]
    },
    {
      method: "POST",
      path: "/api/auth/refresh",
      description: "Refresh access token using refresh token",
      auth: false,
      curlExample: `curl -X POST "https://api.stocksintels.com/api/auth/refresh" \\
  -H "Content-Type: application/json" \\
  -d '{"refresh_token": "your_refresh_token"}'`,
      responses: [
        { code: 200, title: "OK", description: "New access_token and refresh_token" },
        { code: 401, title: "Unauthorized", description: "Invalid or expired refresh token" }
      ]
    },
    {
      method: "POST",
      path: "/api/auth/logout",
      description: "Logout and revoke refresh token",
      auth: true,
      responses: [
        { code: 200, title: "OK", description: "Logged out successfully" }
      ]
    }
  ],
  webhooks: [
    {
      method: "POST",
      path: "/api/webhooks",
      description: "Register webhook endpoint",
      auth: true,
      body: ["url", "events", "secret"],
      curlExample: `curl -X POST "https://api.stocksintels.com/api/webhooks" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://your-app.com/webhook", "events": ["quote.update", "position.new"], "secret": "your_webhook_secret"}'`,
      responses: [
        { code: 201, title: "Created", description: "Webhook created with signing secret" },
        { code: 400, title: "Bad Request", description: "Invalid URL or events" }
      ]
    },
    {
      method: "GET",
      path: "/api/webhooks",
      description: "List registered webhooks",
      auth: true,
      responses: [
        { code: 200, title: "OK", description: "Array of webhook endpoints" }
      ]
    },
    {
      method: "DELETE",
      path: "/api/webhooks/:id",
      description: "Delete webhook",
      auth: true,
      params: ["id"],
      responses: [
        { code: 200, title: "OK", description: "Webhook deleted" }
      ]
    },
    {
      method: "POST",
      path: "/api/webhooks/:id/test",
      description: "Send test event to webhook",
      auth: true,
      params: ["id"],
      responses: [
        { code: 200, title: "OK", description: "Test event sent" }
      ]
    }
  ],
  portfolio: [
    {
      method: "GET",
      path: "/api/portfolio",
      description: "Get user portfolio summary",
      auth: true,
      curlExample: `curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://api.stocksintels.com/api/portfolio"`,
      responses: [
        { code: 200, title: "OK", description: "Portfolio summary with total value, P&L, cash" }
      ]
    },
    {
      method: "GET",
      path: "/api/portfolio/holdings",
      description: "Get current holdings",
      auth: true,
      responses: [
        { code: 200, title: "OK", description: "Array of holdings with quantity, avg price, current value, P&L" }
      ]
    },
    {
      method: "GET",
      path: "/api/portfolio/history",
      description: "Get portfolio value history",
      auth: true,
      query: ["from", "to", "interval"],
      responses: [
        { code: 200, title: "OK", description: "Time series of portfolio value" }
      ]
    },
    {
      method: "GET",
      path: "/api/watchlist",
      description: "Get user watchlist",
      auth: true,
      responses: [
        { code: 200, title: "OK", description: "Array of watchlist items with target prices" }
      ]
    },
    {
      method: "POST",
      path: "/api/watchlist",
      description: "Add item to watchlist",
      auth: true,
      body: ["symbol", "notes", "target_price"],
      curlExample: `curl -X POST "https://api.stocksintels.com/api/watchlist" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol": "SCOM", "notes": "Long term hold", "target_price": 35}'`,
      responses: [
        { code: 201, title: "Created", description: "Item added to watchlist" },
        { code: 400, title: "Bad Request", description: "Invalid symbol" }
      ]
    },
    {
      method: "DELETE",
      path: "/api/watchlist/:id",
      description: "Remove item from watchlist",
      auth: true,
      params: ["id"],
      responses: [
        { code: 200, title: "OK", description: "Item removed" }
      ]
    }
  ]
};

const tabs: TabConfig[] = [
  { id: "market", label: "Market Data", count: 7, icon: <Globe className="w-4 h-4" /> },
  { id: "financials", label: "Company Financials", count: 6, icon: <BookOpen className="w-4 h-4" /> },
  { id: "positions", label: "Recommended Positions", count: 3, icon: <Zap className="w-4 h-4" /> },
  { id: "auth", label: "Authentication", count: 4, icon: <Lock className="w-4 h-4" /> },
  { id: "webhooks", label: "Webhooks", count: 4, icon: <Globe className="w-4 h-4" /> },
  { id: "portfolio", label: "Portfolio & Watchlist", count: 6, icon: <Layers className="w-4 h-4" /> },
];

const errorCodes = [
  { code: 400, title: "Bad Request", description: "Invalid request parameters or malformed JSON" },
  { code: 401, title: "Unauthorized", description: "Missing or invalid authentication token" },
  { code: 403, title: "Forbidden", description: "Insufficient permissions for this resource" },
  { code: 404, title: "Not Found", description: "Resource or endpoint does not exist" },
  { code: 422, title: "Unprocessable Entity", description: "Request validation failed" },
  { code: 429, title: "Too Many Requests", description: "Rate limit exceeded. Check X-RateLimit headers" },
  { code: 500, title: "Internal Server Error", description: "Unexpected server error" },
  { code: 503, title: "Service Unavailable", description: "Service temporarily unavailable (maintenance or overload)" },
];

const rateLimitHeaders = [
  { header: "X-RateLimit-Limit", description: "Maximum requests allowed in current window" },
  { header: "X-RateLimit-Remaining", description: "Requests remaining in current window" },
  { header: "X-RateLimit-Reset", description: "Unix timestamp when rate limit window resets" },
  { header: "Retry-After", description: "Seconds to wait before retrying (on 429 response)" },
];

const authInfo = {
  headers: [
    { name: "Authorization", value: "Bearer <your_api_key>", required: true, description: "API key for production, sandbox key for testing" },
    { name: "Content-Type", value: "application/json", required: true, description: "Required for POST/PUT/PATCH requests" },
  ],
  authMethods: [
    { name: "API Key (Production)", header: "Authorization: Bearer sk_live_...", scope: "All production endpoints" },
    { name: "API Key (Sandbox)", header: "Authorization: Bearer sk_sandbox_...", scope: "Sandbox environment only" },
    { name: "JWT Token (User)", header: "Authorization: Bearer <jwt_token>", scope: "User-specific endpoints" },
  ],
  keyFormats: [
    { name: "Production", prefix: "sk_live_", description: "Live market data, real orders" },
    { name: "Sandbox", prefix: "sk_sandbox_", description: "Simulated data, no rate limits" },
  ]
};

function MethodBadge({ method }: { method: string }) {
  const styles: Record<string, string> = {
    GET: "bg-green-100 text-green-700",
    POST: "bg-blue-100 text-blue-700",
    PUT: "bg-yellow-100 text-yellow-700",
    DELETE: "bg-red-100 text-red-700",
    PATCH: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${styles[method] || "bg-purple-100 text-purple-700"}`}>
      {method}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="h-8" aria-label={`Copy ${label}`}>
      {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
    </Button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="bg-[#0B203D] p-4 rounded font-mono text-sm text-slate-200 overflow-x-auto"><code>{code}</code></pre>
      <CopyButton text={code} label="code" />
    </div>
  );
}

function ParameterSection({ label, items, badgeVariant }: { label: string; items: string[]; badgeVariant: "outline" | "secondary" | "destructive" }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-3 p-3 bg-[#F5F8FC] rounded">
          <Badge variant={badgeVariant}>{label}</Badge>
          <code className="font-mono text-sm text-[#0D7490]">{item}</code>
          <span className="text-sm text-[#52647A]">{label === "Path" ? "Required" : label === "Body" ? "Required" : "Optional"}</span>
        </div>
      ))}
    </div>
  );
}

export function ApiDocsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("market");
  const [searchQuery, setSearchQuery] = useState("");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white">
        <PublicBrandHeader />
        <main className="pt-28">
          <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0D7490]" />
            </div>
          </div>
        </main>
        <PublicBrandFooter />
      </div>
    );
  }

  const canGenerateProductionKey = useMemo(
    () => user && (user.subscription_status === "active" || user.subscription_tier === "free"),
    [user]
  );

  const currentEndpoints = endpoints[activeTab] || [];
  const filteredEndpoints = currentEndpoints.filter(ep =>
    ep.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ep.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        {/* Quick Start Bar */}
        <section className="bg-[#0D7490] text-white py-6">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <Zap className="w-6 h-6 text-yellow-300" />
                <div>
                  <h2 className="text-lg font-semibold">Quick Start</h2>
                  <p className="text-sm text-blue-100">Get your first quote in 30 seconds</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-white/20">
                  <Link to="/developers/pricing">Get API Key</Link>
                </Button>
                <Button asChild variant="ghost" className="text-white hover:bg-white/10">
                  <Link to="/developers/playground">Try Playground</Link>
                </Button>
                <Button asChild variant="ghost" className="text-white hover:bg-white/10">
                  <Link to="/developers/sdks">View SDKs</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Start Guide */}
        <section className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
          <div className="grid gap-6 lg:grid-cols-4">
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                  <Terminal className="w-5 h-5 text-[#0D7490]" />
                </div>
                <CardTitle className="text-[#102B50]">1. Get API Key</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#52647A] text-sm mb-4">Get your API key from the developer portal. Free tier available.</p>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/developers/pricing">Get API Key</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                  <Code className="w-5 h-5 text-[#0D7490]" />
                </div>
                <CardTitle className="text-[#102B50]">2. Install SDK</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#52647A] text-sm mb-4">Install the official SDK for your language.</p>
                <div className="space-y-2 text-sm font-mono bg-[#F5F8FC] p-3 rounded">
                  <div>npm install @stocksintels/sdk</div>
                  <div>pip install stocksintels</div>
                  <div>go get github.com/stocksintels/sdk-go</div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                  <Terminal className="w-5 h-5 text-[#0D7490]" />
                </div>
                <CardTitle className="text-[#102B50]">3. Make First Request</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#52647A] text-sm mb-4">Get your first quote in seconds.</p>
                <div className="space-y-2 text-sm font-mono bg-[#F5F8FC] p-3 rounded">
                  <div className="text-[#0D7490]">curl -H "Authorization: Bearer YOUR_KEY" \\</div>
                  <div className="ml-4">"https://api.stocksintels.com/api/market/quote/SCOM"</div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                  <BookOpen className="w-5 h-5 text-[#0D7490]" />
                </div>
                <CardTitle className="text-[#102B50]">4. Explore Docs</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[#52647A] text-sm mb-4">Browse full API reference, try playground, read guides.</p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/developers/docs">Full Reference</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/developers/playground">Try Playground</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/developers/sdks">SDKs & Libraries</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Authentication Guide */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-[#102B50] mb-2">Authentication</h2>
              <p className="text-[#52647A]">Choose the right authentication method for your use case.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {authInfo.authMethods.map((method, i) => (
                <Card key={i} className="border-[#DCE5F0] h-full">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Lock className="w-5 h-5 text-[#0D7490]" />
                      <CardTitle className="text-[#102B50]">{method.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <code className="block bg-[#F5F8FC] px-3 py-2 rounded font-mono text-sm text-[#0D7490] mb-2">{method.header}</code>
                    <p className="text-sm text-[#52647A]">{method.scope}</p>
                    <Badge variant="secondary" className="mt-2">{method.name.split(" ")[0]}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-8">
              <h3 className="font-semibold text-[#102B50] mb-4">Key Formats</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {authInfo.keyFormats.map((fmt, i) => (
                  <Card key={i} className="border-[#DCE5F0]">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold text-[#102B50]">{fmt.name}</h4>
                          <code className="block mt-1 font-mono text-sm text-[#0D7490]">{fmt.prefix}...</code>
                        </div>
                        <Badge variant="secondary">{fmt.name}</Badge>
                      </div>
                      <p className="text-sm text-[#52647A] mt-3">{fmt.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="mt-6">
                <h3 className="font-semibold text-[#102B50] mb-4">Required Headers</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#DCE5F0]">
                        <th className="pb-3 font-semibold text-[#102B50] text-left w-40">Header</th>
                        <th className="pb-3 font-semibold text-[#102B50] text-left w-48">Value</th>
                        <th className="pb-3 font-semibold text-[#102B50]">Required</th>
                        <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authInfo.headers.map((h, i) => (
                        <tr key={i} className="border-b border-[#DCE5F0]/50">
                          <td className="py-3 font-mono text-sm text-[#0D7490]">{h.name}</td>
                          <td className="py-3 font-mono text-sm text-[#52647A]">{h.value}</td>
                          <td className="py-3 text-center">
                            <Badge variant={h.required ? "default" : "secondary"}>{h.required ? "Yes" : "No"}</Badge>
                          </td>
                          <td className="py-3 text-[#52647A] text-sm">{h.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Reference - Base URLs & Rate Limits */}
        <section className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
          <div className="grid gap-6 lg:grid-cols-2 mb-12">
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <CardTitle className="text-[#102B50] flex items-center gap-2">
                  <Globe className="w-5 h-5 text-[#0D7490]" />
                  Base URLs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#102B50] mb-1">Production</label>
                  <code className="block bg-[#F1F5F9] px-4 py-3 rounded font-mono text-lg text-[#0D7490] break-all">
                    https://api.stocksintels.com
                  </code>
                  <p className="text-sm text-[#52647A] mt-1">Use with production API keys (sk_live_...)</p>
                </div>
                <div className="border-t border-[#DCE5F0] pt-4">
                  <label className="text-sm font-medium text-[#102B50] mb-1">Sandbox</label>
                  <code className="block bg-amber-50 px-4 py-3 rounded font-mono text-lg text-amber-600 border border-amber-200 break-all">
                    https://api-sandbox.stocksintels.com
                  </code>
                  <p className="text-sm text-[#52647A] mt-1">Use with sandbox API keys (sk_sandbox_...). No rate limits.</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-[#DCE5F0]">
              <CardHeader>
                <CardTitle className="text-[#102B50] flex items-center gap-2">
                  <Zap className="w-5 h-5 text-[#0D7490]" />
                  Rate Limits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#DCE5F0]">
                        <th className="pb-3 font-semibold text-[#102B50]">Tier</th>
                        <th className="pb-3 font-semibold text-[#102B50] text-right">Requests/Day</th>
                        <th className="pb-3 font-semibold text-[#102B50] text-center">Burst</th>
                        <th className="pb-3 font-semibold text-[#102B50]">WebSocket</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-medium text-[#102B50]">Free</td>
                        <td className="py-3 text-[#52647A] text-right">1,000</td>
                        <td className="py-3 text-center"><Badge variant="secondary">10/sec</Badge></td>
                        <td className="py-3 text-center"><Badge variant="secondary">No</Badge></td>
                      </tr>
                      <tr className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-medium text-[#102B50]">Starter</td>
                        <td className="py-3 text-[#52647A] text-right">10,000</td>
                        <td className="py-3 text-center"><Badge variant="default">50/sec</Badge></td>
                        <td className="py-3 text-center"><Badge variant="secondary">No</Badge></td>
                      </tr>
                      <tr className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-medium text-[#102B50]">Pro</td>
                        <td className="py-3 text-[#52647A] text-right">100,000</td>
                        <td className="py-3 text-center"><Badge variant="default">200/sec</Badge></td>
                        <td className="py-3 text-center"><Badge variant="default">Yes</Badge></td>
                      </tr>
                      <tr>
                        <td className="py-3 font-medium text-[#102B50]">Enterprise</td>
                        <td className="py-3 text-[#52647A] text-right">Custom</td>
                        <td className="py-3 text-center"><Badge variant="default">Custom</Badge></td>
                        <td className="py-3 text-center"><Badge variant="default">Yes</Badge></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-sm text-[#52647A]">
                  Rate limit headers on every response: 
                  <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Limit</code>, 
                  <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Remaining</code>, 
                  <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Reset</code>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* SDK Links */}
          <div className="mt-8">
            <h3 className="font-semibold text-[#102B50] mb-4">Official SDKs</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-[#DCE5F0] hover:border-[#0D7490]/50 transition-colors">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                      <Code className="w-5 h-5 text-[#0D7490]" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#102B50]">TypeScript / JavaScript</h4>
                      <p className="text-sm text-[#52647A]">@stocksintels/sdk</p>
                    </div>
                  </div>
                  <code className="block bg-[#F5F8FC] p-3 rounded font-mono text-sm text-[#0D7490] mb-3">npm install @stocksintels/sdk</code>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href="https://github.com/stocksintels/sdk-js" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1">
                      <ExternalLink className="w-4 h-4" /> View on GitHub
                    </a>
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-[#DCE5F0]">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                      <Terminal className="w-5 h-5 text-[#0D7490]" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#102B50]">Python</h4>
                      <p className="text-sm text-[#52647A]">stocksintels</p>
                    </div>
                  </div>
                  <code className="block bg-[#F5F8FC] p-3 rounded font-mono text-sm text-[#0D7490] mb-3">pip install stocksintels</code>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href="https://github.com/stocksintels/sdk-python" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1">
                      <ExternalLink className="w-4 h-4" /> View on GitHub
                    </a>
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-[#DCE5F0]">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                      <Globe className="w-5 h-5 text-[#0D7490]" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#102B50]">Go</h4>
                      <p className="text-sm text-[#52647A]">github.com/stocksintels/sdk-go</p>
                    </div>
                  </div>
                  <code className="block bg-[#F5F8FC] p-3 rounded font-mono text-sm text-[#0D7490] mb-3">go get github.com/stocksintels/sdk-go</code>
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href="https://github.com/stocksintels/sdk-go" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1">
                      <ExternalLink className="w-4 h-4" /> View on GitHub
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Endpoints Documentation */}
        <section className="mx-auto max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-12">
          {/* Search & Tabs */}
          <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-12">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#52647A]" />
                <Input
                  type="text"
                  placeholder="Search endpoints..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} className="data-[state=active]:bg-[#0D7490] data-[state=active]:text-white flex items-center justify-center gap-2">
                    {tab.icon}
                    {tab.label}
                    <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#DCE5F0] data-[state=active]:bg-white/20 data-[state=active]:text-white">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Endpoints */}
          <div className="mx-auto max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-12">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              {tabs.map((tab) => (
                <TabsContent key={tab.id} value={tab.id} className="mt-6">
                  <div className="space-y-4">
                    {filteredEndpoints.map((ep, i) => (
                      <Accordion key={i} type="single" collapsible className="border-[#DCE5F0]">
                        <AccordionItem value={ep.path}>
                          <AccordionTrigger className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] hover:bg-[#E8EEF4] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <MethodBadge method={ep.method} />
                              <code className="font-mono text-sm text-[#102B50] truncate max-w-[400px]">{ep.path}</code>
                            </div>
                            <div className="flex items-center gap-2">
                              {ep.auth ? (
                                <Badge variant="default" className="text-xs">Auth Required</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">Public</Badge>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(ep.path)} className="h-8" aria-label="Copy endpoint path">
                                <Copy className="size-4" />
                              </Button>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="p-4 space-y-4">
                            <div>
                              <p className="text-[#52647A] text-sm">{ep.description}</p>
                            </div>

                            {/* Request Examples */}
                            {(ep.curlExample || ep.jsExample || ep.pythonExample) && (
                              <Accordion type="single" collapsible className="border-[#DCE5F0]">
                                <AccordionItem value="request-examples">
                                  <AccordionTrigger className="px-4 py-2 bg-[#F5F8FC] flex items-center gap-2 text-sm font-medium text-[#52647A]">
                                    <Code className="w-4 h-4" /> Request Examples
                                    <ChevronDown className="w-4 h-4" />
                                  </AccordionTrigger>
                                  <AccordionContent className="p-4 space-y-4">
                                    {ep.curlExample && (
                                      <div>
                                        <label className="block text-xs font-medium text-[#52647A] mb-1">cURL</label>
                                        <CodeBlock code={ep.curlExample} />
                                      </div>
                                    )}
                                    {ep.jsExample && (
                                      <div>
                                        <label className="block text-xs font-medium text-[#52647A] mb-1">JavaScript (SDK)</label>
                                        <CodeBlock code={ep.jsExample} />
                                      </div>
                                    )}
                                    {ep.pythonExample && (
                                      <div>
                                        <label className="block text-xs font-medium text-[#52647A] mb-1">Python (SDK)</label>
                                        <CodeBlock code={ep.pythonExample} />
                                      </div>
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}

                            {/* Response Example */}
                            {ep.responseExample && (
                              <Accordion type="single" collapsible className="border-[#DCE5F0]">
                                <AccordionItem value="response-example">
                                  <AccordionTrigger className="px-4 py-2 bg-[#F5F8FC] flex items-center gap-2 text-sm font-medium text-[#52647A]">
                                    <Code className="w-4 h-4" /> Response Example
                                    <ChevronDown className="w-4 h-4" />
                                  </AccordionTrigger>
                                  <AccordionContent className="p-4">
                                    <CodeBlock code={ep.responseExample} />
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}

                            {/* Response Codes */}
                            {ep.responses && ep.responses.length > 0 && (
                              <Accordion type="single" collapsible className="border-[#DCE5F0]">
                                <AccordionItem value="responses">
                                  <AccordionTrigger className="px-4 py-2 bg-[#F5F8FC] flex items-center gap-2 text-sm font-medium text-[#52647A]">
                                    <Info className="w-4 h-4" /> Response Codes
                                    <ChevronDown className="w-4 h-4" />
                                  </AccordionTrigger>
                                  <AccordionContent className="p-4">
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="border-b border-[#DCE5F0]">
                                            <th className="pb-3 font-semibold text-[#102B50] w-16">Code</th>
                                            <th className="pb-3 font-semibold text-[#102B50] w-40">Status</th>
                                            <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {ep.responses.map((r, i) => (
                                            <tr key={i} className="border-b border-[#DCE5F0]/50">
                                              <td className="py-3 font-mono font-semibold text-[#0D7490]">{r.code}</td>
                                              <td className="py-3 text-[#52647A]">{r.title}</td>
                                              <td className="py-3 text-[#52647A]">{r.description}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}

                            {/* Parameters */}
                            {(ep.params?.length || ep.query?.length || ep.body?.length) && (
                              <Accordion type="single" collapsible className="border-[#DCE5F0]">
                                <AccordionItem value="params">
                                  <AccordionTrigger className="px-4 py-2 bg-[#F5F8FC] flex items-center gap-2 text-sm font-medium text-[#52647A]">
                                    <Layers className="w-4 h-4" /> Parameters
                                    <ChevronDown className="w-4 h-4" />
                                  </AccordionTrigger>
                                  <AccordionContent className="p-4 space-y-3">
                                    <ParameterSection label="Path" items={ep.params || []} badgeVariant="outline" />
                                    <ParameterSection label="Query" items={ep.query || []} badgeVariant="secondary" />
                                    <ParameterSection label="Body" items={ep.body || []} badgeVariant="destructive" />
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ))}
                    {filteredEndpoints.length === 0 && (
                      <div className="text-center py-12 text-[#52647A]">
                        No endpoints match your search.
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </section>

        {/* Error Codes */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <h2 className="text-2xl font-bold text-[#102B50] mb-8">Error Codes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-[#DCE5F0]">
                    <th className="pb-3 font-semibold text-[#102B50] w-16">Code</th>
                    <th className="pb-3 font-semibold text-[#102B50] w-40">Title</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {errorCodes.map((e, i) => (
                    <tr key={i} className="border-b border-[#DCE5F0]/50">
                      <td className="py-3 font-mono font-semibold text-[#0D7490]">{e.code}</td>
                      <td className="py-3 text-[#52647A]">{e.title}</td>
                      <td className="py-3 text-[#52647A]">{e.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Rate Limit Headers */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12">
          <h2 className="text-2xl font-bold text-[#102B50] mb-8">Rate Limit Headers</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-[#DCE5F0]">
                  <th className="pb-3 font-semibold text-[#102B50] w-64">Header</th>
                  <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                </tr>
              </thead>
              <tbody>
                {rateLimitHeaders.map((h, i) => (
                  <tr key={i} className="border-b border-[#DCE5F0]/50">
                    <td className="py-3 font-mono text-sm text-[#0D7490]">{h.header}</td>
                    <td className="py-3 text-[#52647A]">{h.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 text-center bg-[#F5F8FC] border-y border-[#DCE5F0]">
          <h2 className="text-3xl font-bold text-[#102B50]">Ready to Build?</h2>
          <p className="mt-4 text-lg text-[#52647A] max-w-xl mx-auto">
            Get your API key and start integrating StocksIntels Financial Intelligence API today.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button asChild size="lg">
              <Link to="/developers/pricing">Get API Key <ChevronRight className="ml-2 w-4 h-4" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/developers/playground">Try Playground</Link>
            </Button>
          </div>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}