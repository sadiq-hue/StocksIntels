import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link } from "react-router";
import { ChevronRight, Play, Copy, Check, ExternalLink, Terminal, Key, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { useState, useRef, useEffect } from "react";

interface PlaygroundEndpoint {
  id: string;
  label: string;
  method: string;
  path: string;
  requiresAuth: boolean;
  params: string[];
  exampleParams: Record<string, string>;
}

const playgroundEndpoints: PlaygroundEndpoint[] = [
  { id: "quote", label: "GET /api/market/quote/:symbol", method: "GET", path: "/api/market/quote/:symbol", requiresAuth: true, params: ["symbol"], exampleParams: { symbol: "SCOM" } },
  { id: "quotes", label: "GET /api/market/quotes", method: "GET", path: "/api/market/quotes", requiresAuth: true, params: ["symbols"], exampleParams: { symbols: "SCOM,AAPL,MSFT" } },
  { id: "history", label: "GET /api/market/history/:symbol", method: "GET", path: "/api/market/history/:symbol", requiresAuth: true, params: ["symbol", "interval", "from", "to"], exampleParams: { symbol: "SCOM", interval: "1d", from: "2026-10-01", to: "2026-11-01" } },
  { id: "indices", label: "GET /api/market/indices", method: "GET", path: "/api/market/indices", requiresAuth: true, params: [], exampleParams: {} },
  { id: "movers", label: "GET /api/market/movers", method: "GET", path: "/api/market/movers", requiresAuth: true, params: [], exampleParams: {} },
  { id: "financials", label: "GET /api/financials/:symbol", method: "GET", path: "/api/financials/:symbol", requiresAuth: true, params: ["symbol"], exampleParams: { symbol: "SCOM" } },
  { id: "income", label: "GET /api/financials/:symbol/income-statement", method: "GET", path: "/api/financials/:symbol/income-statement", requiresAuth: true, params: ["symbol"], exampleParams: { symbol: "AAPL" } },
  { id: "positions", label: "GET /api/recommended-positions", method: "GET", path: "/api/recommended-positions", requiresAuth: true, params: [], exampleParams: {} },
  { id: "position", label: "GET /api/recommended-positions/:symbol", method: "GET", path: "/api/recommended-positions/:symbol", requiresAuth: true, params: ["symbol"], exampleParams: { symbol: "AAPL" } },
  { id: "portfolio", label: "GET /api/portfolio", method: "GET", path: "/api/portfolio", requiresAuth: true, params: [], exampleParams: {} },
  { id: "watchlist", label: "GET /api/watchlist", method: "GET", path: "/api/watchlist", requiresAuth: true, params: [], exampleParams: {} },
];

const mockResponses: Record<string, any> = {
  quote: {
    symbol: "SCOM",
    name: "Safaricom Plc",
    price: 28.45,
    currency: "KES",
    change: -0.35,
    changePercent: -1.21,
    exchange: "NSE",
    timestamp: "2026-11-23T10:30:00Z",
    volume: 2847562,
    marketCap: 1142000000000,
    dayHigh: 28.95,
    dayLow: 28.10,
    yearHigh: 32.50,
    yearLow: 22.10,
  },
  quotes: {
    data: [
      { symbol: "SCOM", price: 28.45, change: -0.35, changePercent: -1.21 },
      { symbol: "AAPL", price: 189.25, change: 2.15, changePercent: 1.15 },
      { symbol: "MSFT", price: 415.30, change: -1.80, changePercent: -0.43 },
    ],
  },
  history: {
    symbol: "SCOM",
    interval: "1d",
    data: [
      { date: "2026-10-01", open: 27.50, high: 28.00, low: 27.20, close: 27.80, volume: 1500000 },
      { date: "2026-10-15", open: 27.90, high: 28.50, low: 27.60, close: 28.20, volume: 1800000 },
      { date: "2026-11-01", open: 28.10, high: 28.95, low: 28.10, close: 28.45, volume: 2847562 },
    ],
  },
  indices: [
    { symbol: "NSE20", name: "NSE 20 Share Index", value: 1847.32, change: 12.45, changePercent: 0.68 },
    { symbol: "NASI", name: "NSE All Share Index", value: 112.34, change: 0.89, changePercent: 0.80 },
    { symbol: "SPX", name: "S&P 500", value: 4567.89, change: 23.45, changePercent: 0.52 },
  ],
  movers: {
    gainers: [
      { symbol: "EQTY", name: "Equity Group", price: 48.50, change: 2.10, changePercent: 4.52 },
      { symbol: "KCB", name: "KCB Group", price: 32.25, change: 1.15, changePercent: 3.70 },
    ],
    losers: [
      { symbol: "EABL", name: "East African Breweries", price: 145.00, change: -4.50, changePercent: -3.01 },
      { symbol: "BAMB", name: "Bamburi Cement", price: 38.75, change: -1.20, changePercent: -3.00 },
    ],
  },
  financials: {
    symbol: "SCOM",
    name: "Safaricom Plc",
    marketCap: 1142000000000,
    peRatio: 12.5,
    pbRatio: 2.8,
    dividendYield: 4.2,
    revenue: 289000000000,
    netIncome: 91000000000,
    totalAssets: 456000000000,
    totalEquity: 189000000000,
  },
  income: {
    symbol: "AAPL",
    period: "annual",
    fiscalYear: 2024,
    revenue: 391035000000,
    grossProfit: 180683000000,
    operatingIncome: 123216000000,
    netIncome: 93736000000,
    eps: 6.08,
  },
  positions: [
    { symbol: "SCOM", name: "Safaricom Plc", recommendation: "BUY", confidence: 0.82, entry: 27.50, stopLoss: 25.00, target1: 32.00, target2: 35.50, riskReward: 2.8, timeframe: "3-6 months", sector: "Telecommunications" },
    { symbol: "EQTY", name: "Equity Group", recommendation: "BUY", confidence: 0.78, entry: 46.00, stopLoss: 42.00, target1: 54.00, target2: 59.00, riskReward: 2.5, timeframe: "3-6 months", sector: "Banking" },
  ],
  position: {
    symbol: "AAPL",
    name: "Apple Inc.",
    recommendation: "HOLD",
    confidence: 0.65,
    entry: 185.00,
    stopLoss: 170.00,
    target1: 205.00,
    target2: 220.00,
    riskReward: 2.0,
    timeframe: "6-12 months",
    sector: "Technology",
  },
  portfolio: {
    totalValue: 1250000,
    cash: 50000,
    holdings: [
      { symbol: "SCOM", quantity: 15000, avgPrice: 26.50, currentPrice: 28.45, value: 426750, pnl: 29250, pnlPercent: 7.36 },
      { symbol: "EQTY", quantity: 5000, avgPrice: 44.00, currentPrice: 48.50, value: 242500, pnl: 22500, pnlPercent: 10.23 },
      { symbol: "AAPL", quantity: 200, avgPrice: 175.00, currentPrice: 189.25, value: 37850, pnl: 2850, pnlPercent: 8.14 },
    ],
  },
  watchlist: [
    { id: 1, symbol: "SCOM", name: "Safaricom Plc", addedAt: "2026-01-15", notes: "Long-term hold", targetPrice: 35.00 },
    { id: 2, symbol: "AAPL", name: "Apple Inc.", addedAt: "2026-03-20", notes: "Monitor earnings", targetPrice: 210.00 },
    { id: 3, symbol: "TSLA", name: "Tesla Inc.", addedAt: "2026-06-10", notes: "Volatility play", targetPrice: 280.00 },
  ],
};

export function PlaygroundPage() {
  const [activeEndpoint, setActiveEndpoint] = useState(playgroundEndpoints[0].id);
  const [environment, setEnvironment] = useState<"production" | "sandbox">("sandbox");
  const [apiKey, setApiKey] = useState("");
  const [params, setParams] = useState<Record<string, string | undefined>>({});
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [quickSymbol, setQuickSymbol] = useState("SCOM");
  const responseRef = useRef<HTMLPreElement>(null);

  const currentEndpoint = playgroundEndpoints.find(e => e.id === activeEndpoint)!;

  useEffect(() => {
    setParams(currentEndpoint.exampleParams || {});
    if (currentEndpoint.exampleParams?.symbol) {
      setQuickSymbol(currentEndpoint.exampleParams.symbol);
    }
    setResponse(null);
    setError(null);
  }, [activeEndpoint]);

  const getBaseUrl = () => environment === "production" 
    ? "https://api.stocksintels.com" 
    : "https://api-sandbox.stocksintels.com";

  const buildUrl = () => {
    let path = currentEndpoint.path;
    Object.entries(params).forEach(([key, value]) => {
      if (value) path = path.replace(`:${key}`, value);
    });
    const url = new URL(path, getBaseUrl());
    Object.entries(params).forEach(([key, value]) => {
      if (!path.includes(`:${key}`) && value) {
        url.searchParams.append(key, value);
      }
    });
    return url.toString();
  };

  const handleRequest = async () => {
    setLoading(true);
    setError(null);

    try {
      const url = buildUrl();
      const headers: Record<string, string> = {};

      if (currentEndpoint.requiresAuth) {
        if (environment === "production" && !apiKey) {
          setError("Production requests require an API key.");
          setLoading(false);
          return;
        }
        headers["Authorization"] = `Bearer ${apiKey || "sk_sandbox_..."}`;
      }

      const res = await fetch(url, { headers });

      if (!res.ok) {
        let detail = "";
        try { detail = await res.text(); } catch { /* ignore */ }
        setError(`Request failed (${res.status}): ${detail}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      // Fallback to mock data when the sandbox is unreachable
      if (environment === "sandbox") {
        const mockData = mockResponses[activeEndpoint];
        if (mockData) {
          setResponse({ ...mockData, _note: "Sandbox unreachable — showing mock fallback data" });
        } else {
          setError("Sandbox unreachable and no mock data available for this endpoint.");
        }
      } else {
        setError("Request failed. Check your API key and parameters.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickTry = (symbol: string) => {
    setQuickSymbol(symbol);
    setActiveEndpoint("quote");
    setParams({ symbol });
    setResponse(null);
    setError(null);
  };

  const copyResponse = () => {
    if (response) {
      navigator.clipboard.writeText(JSON.stringify(response, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyCurl = () => {
    const url = buildUrl();
    const authHeader = apiKey ? `-H "Authorization: Bearer ${apiKey}"` : "";
    const curl = `curl ${authHeader} "${url}"`;
    navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        {/* Header */}
        <section className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12 border-b border-[#DCE5F0]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <Link to="/developers" className="text-sm text-[#52647A] hover:text-[#0D7490] mb-2 inline-flex items-center gap-1">
                <ChevronRight className="size-4 rotate-180" />
                Developer Portal
              </Link>
              <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[#102B50]">Interactive API Playground</h1>
              <p className="mt-2 text-[#52647A]">Test API endpoints live with your credentials. Sandbox hits api-sandbox.stocksintels.com and falls back to mock data if unreachable.</p>
            </div>
            <div className="flex items-center gap-3">
              <Label className="flex items-center gap-2 text-sm text-[#52647A] cursor-pointer">
                <Switch
                  checked={environment === "sandbox"}
                  onCheckedChange={(checked) => setEnvironment(checked ? "sandbox" : "production")}
                />
                <span>{environment === "sandbox" ? "Sandbox" : "Production"}</span>
              </Label>
              {environment === "production" && (
                <Button variant="ghost" size="sm" onClick={() => setShowKeyInput(true)}>
                  <Key className="size-4 mr-1" />
                  Enter API Key
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Playground */}
        <section className="mx-auto max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-12">
          {/* Quick Try any stock */}
          <Card className="border-[#DCE5F0] mb-8">
            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-[#102B50] mb-1">Try any stock</h3>
                  <p className="text-sm text-[#52647A]">
                    Enter a symbol (e.g. <code className="font-mono text-[#0D7490]">SCOM</code>, <code className="font-mono text-[#0D7490]">EQTY</code>, <code className="font-mono text-[#0D7490]">AAPL</code>) and hit Send.
                  </p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <Input
                    id="quick-symbol"
                    placeholder="SCOM"
                    value={quickSymbol}
                    onChange={(e) => setQuickSymbol(e.target.value.toUpperCase())}
                    className="w-full sm:w-48"
                  />
                  <Button
                    onClick={() => handleQuickTry(quickSymbol || "SCOM")}
                    disabled={loading}
                    className="gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-1" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        Send Request
                      </>
                    )}
                  </Button>
                  {environment === "production" && !apiKey && (
                    <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
                      API key required
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <p className="text-xs text-[#52647A] mr-2">Popular:</p>
                {["SCOM", "EQTY", "KCB", "EABL", "AAPL", "MSFT", "TSLA"].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleQuickTry(sym)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      quickSymbol === sym
                        ? "bg-[#0D7490] text-white border-[#0D7490]"
                        : "bg-[#F5F8FC] text-[#52647A] border-[#DCE5F0] hover:bg-white"
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Sidebar - Endpoint Selection */}
            <div className="lg:col-span-1">
              <Card className="border-[#DCE5F0] h-fit sticky top-24">
                <CardHeader>
                  <CardTitle className="text-[#102B50]">Endpoints</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="h-[500px] overflow-y-auto">
                    <div className="flex flex-col gap-1">
                      {playgroundEndpoints.map((ep) => (
                        <button
                          key={ep.id}
                          onClick={() => setActiveEndpoint(ep.id)}
                          className={`w-full flex items-start gap-2 px-3 py-2 text-sm text-left rounded-lg transition-colors ${
                            activeEndpoint === ep.id
                              ? "bg-[#0D7490] text-white"
                              : "hover:bg-[#F5F8FC] text-[#52647A]"
                          }`}
                        >
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium mr-2 shrink-0 ${
                            ep.method === "GET"
                              ? activeEndpoint === ep.id
                                ? "bg-white/20 text-white"
                                : "bg-green-100 text-green-700"
                              : activeEndpoint === ep.id
                                ? "bg-white/20 text-white"
                                : "bg-blue-100 text-blue-700"
                          }`}>
                            {ep.method}
                          </span>
                          <code className="font-mono text-xs truncate block flex-1">{ep.path}</code>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Environment Info */}
              <Card className="border-[#DCE5F0] mt-4">
                <CardHeader>
                  <CardTitle className="text-[#102B50]">Environment</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#52647A]">Base URL</span>
                    <code className="font-mono text-sm text-[#0D7490] bg-[#F1F5F9] px-2 py-1 rounded">
                      {getBaseUrl()}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#52647A]">Key Prefix</span>
                    <code className="font-mono text-sm text-[#52647A]">
                      {environment === "production" ? "sk_live_..." : "sk_sandbox_..."}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#52647A]">Data</span>
                    <span className="text-sm text-[#52647A]">
                      {environment === "production" ? "Live" : "Mock"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main - Request & Response */}
            <div className="lg:col-span-2 space-y-6">
              {/* Request Panel */}
              <Card className="border-[#DCE5F0]">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-[#102B50]">Request</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={copyCurl} disabled={copied}>
                      {copied ? <Check className="size-4 mr-1 text-green-600" /> : <Copy className="size-4 mr-1" />}
                      Copy cURL
                    </Button>
                    <Button 
                      onClick={handleRequest} 
                      disabled={loading || (currentEndpoint.requiresAuth && !apiKey && environment === "production")}
                      className="gap-2"
                    >
                      <Loader2 className="size-4 animate-spin" />
                      {loading ? "Sending..." : <Play className="size-4" />}
                      Send Request
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {/* URL Display */}
                  <div>
                    <Label className="text-sm text-[#52647A] mb-1 block">Request URL</Label>
                    <code className="block bg-[#F1F5F9] px-3 py-2 rounded font-mono text-sm text-[#102B50] break-all">
                      {buildUrl()}
                    </code>
                  </div>

                  {/* Auth Header */}
                  {currentEndpoint.requiresAuth && (
                    <div>
                      <Label className="text-sm text-[#52647A] mb-1 block">Authorization Header</Label>
                      {environment === "production" && !apiKey ? (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                          <p className="text-sm text-yellow-800 flex items-center gap-2">
                            <AlertTriangle className="size-4" />
                            Production endpoints require an API key.{" "}
                            <Button variant="ghost" size="sm" onClick={() => setShowKeyInput(true)} className="p-0 h-auto">
                              Enter Key
                            </Button>
                          </p>
                        </div>
                      ) : (
                        <code className="block bg-[#F1F5F9] px-3 py-2 rounded font-mono text-sm text-[#102B50] break-all">
                          Authorization: Bearer {environment === "production" ? (apiKey || "sk_live_...") : "sk_sandbox_..."}
                        </code>
                      )}
                    </div>
                  )}

                  {/* Parameters */}
                  {Object.keys(currentEndpoint.exampleParams || {}).length > 0 && (
                    <div>
                      <Label className="text-sm text-[#52647A] mb-2 block">Parameters</Label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {Object.entries(currentEndpoint.exampleParams).map(([key, defaultValue]) => (
                          <div key={key}>
                            <Label htmlFor={key} className="text-sm text-[#52647A] mb-1 block">
                              {key} <span className="text-yellow-600">*</span>
                            </Label>
                            <Input
                               id={key}
                               value={params[key] || defaultValue}
                               onChange={(e) => {
                                 const val = e.target.value;
                                 setParams(prev => ({ ...prev, [key]: val }));
                                 if (key === "symbol") setQuickSymbol(val.toUpperCase());
                               }}
                               placeholder={defaultValue}
                             />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generated cURL */}
                  <div className="pt-4 border-t border-[#DCE5F0]">
                    <Label className="text-sm text-[#52647A] mb-2 block">Generated cURL</Label>
                    <code className="block bg-[#0B203D] px-3 py-2 rounded font-mono text-sm text-slate-200 break-all">
                      {`curl ${currentEndpoint.requiresAuth ? `-H "Authorization: Bearer ${environment === "production" ? (apiKey || "YOUR_API_KEY") : "sk_sandbox_..."}"` : ""} "${buildUrl()}"`}
                    </code>
                  </div>
                </CardContent>
              </Card>

              {/* Response Panel */}
              <Card className="border-[#DCE5F0]">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-[#102B50]">Response</CardTitle>
                  {response && (
                    <Button variant="outline" size="sm" onClick={copyResponse} disabled={copied}>
                      {copied ? <Check className="size-4 mr-1 text-green-600" /> : <Copy className="size-4 mr-1" />}
                      Copy JSON
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="size-8 animate-spin text-[#0D7490]" />
                      <span className="ml-3 text-[#52647A]">Waiting for response...</span>
                    </div>
                  ) : error ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-red-800 flex items-center gap-2">
                        <AlertTriangle className="size-4" />
                        {error}
                      </p>
                    </div>
                  ) : response ? (
                    <pre ref={responseRef} className="bg-[#0B203D] p-4 rounded-lg overflow-x-auto max-h-96">
                      <code className="text-sm text-slate-200 font-mono leading-relaxed">
                        {JSON.stringify(response, null, 2)}
                      </code>
                    </pre>
                  ) : (
                    <div className="text-center py-12 text-[#52647A]">
                      <Terminal className="size-12 mx-auto mb-3 text-[#DCE5F0]" />
                      <p>Select an endpoint and click "Send Request" to see the response here.</p>
                      <p className="text-sm mt-1">Sandbox hits api-sandbox.stocksintels.com (falls back to mock data if unreachable). Production requires a valid API key.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* API Key Modal */}
        {showKeyInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle className="text-[#102B50]">Enter Production API Key</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-[#52647A]">
                  Your production API key (sk_live_...) is required for production environment requests.
                  Keys are never stored — they only persist for this session.
                </p>
                <Input
                  type="password"
                  placeholder="sk_live_..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setShowKeyInput(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={() => setShowKeyInput(false)} className="flex-1">
                    Save Key
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <PublicBrandFooter />
    </div>
  );
}