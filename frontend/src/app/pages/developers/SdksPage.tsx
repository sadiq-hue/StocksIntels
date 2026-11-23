import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link } from "react-router";
import { ChevronRight, Github, ExternalLink, Copy, Check, Terminal, Package, Code2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useState } from "react";

const sdks = [
  {
    id: "typescript",
    name: "TypeScript / JavaScript",
    description: "Full-featured SDK with TypeScript types, auto-completion, and tree-shaking support.",
    install: "npm install @stocksintels/sdk",
    version: "1.2.0",
    github: "https://github.com/stocksintels/sdk-js",
    npm: "https://www.npmjs.com/package/@stocksintels/sdk",
    features: ["TypeScript definitions included", "ESM + CommonJS support", "Browser & Node.js compatible", "WebSocket client built-in", "Automatic token refresh", "Retry with exponential backoff"],
    example: `import { StocksIntels } from '@stocksintels/sdk';

const client = new StocksIntels({
  apiKey: 'sk_live_...',
  environment: 'production' // or 'sandbox'
});

// Market data
const quote = await client.market.getQuote('SCOM');
console.log(quote.price, quote.changePercent);

// Recommended positions
const positions = await client.recommendedPositions.getAll();
console.log(positions);

// Financials
const financials = await client.financials.getIncomeStatement('AAPL');
console.log(financials.revenue);

// WebSocket streaming
const stream = client.market.createQuoteStream(['SCOM', 'AAPL']);
stream.on('data', (quote) => {
  console.log('Real-time:', quote.symbol, quote.price);
});`,
  },
  {
    id: "python",
    name: "Python",
    description: "Pythonic SDK with async support, type hints, and pandas integration for data analysis.",
    install: "pip install stocksintels",
    version: "1.1.0",
    github: "https://github.com/stocksintels/sdk-python",
    pypi: "https://pypi.org/project/stocksintels/",
    features: ["Async/await support", "Type hints (PEP 561)", "Pandas DataFrame integration", "Automatic pagination handling", "Jupyter notebook friendly", "Datetime parsing built-in"],
    example: `from stocksintels import StocksIntels
import pandas as pd

client = StocksIntels(
    api_key="sk_live_...",
    environment="production"
)

# Market data
quote = client.market.get_quote("SCOM")
print(f"{quote.symbol}: {quote.price} {quote.currency}")

# Recommended positions as DataFrame
positions = client.recommended_positions.get_all()
df = pd.DataFrame([p.dict() for p in positions])
print(df[['symbol', 'recommendation', 'confidence', 'entry']])

# Financials
income = client.financials.get_income_statement("AAPL")
print(income.revenue)

# Async usage
import asyncio
async def main():
    async with StocksIntels(api_key="sk_live_...") as client:
        quotes = await client.market.get_quotes(["SCOM", "AAPL", "MSFT"])
        for q in quotes:
            print(q.symbol, q.price)

asyncio.run(main())`,
  },
  {
    id: "go",
    name: "Go",
    description: "High-performance Go SDK with zero dependencies, context support, and idiomatic error handling.",
    install: "go get github.com/stocksintels/sdk-go",
    version: "1.0.0",
    github: "https://github.com/stocksintels/sdk-go",
    pkg: "https://pkg.go.dev/github.com/stocksintels/sdk-go",
    features: ["Zero external dependencies", "Context-aware cancellation", "Structured error types", "Concurrent-safe client", "Minimal memory allocation", "Standard library only"],
    example: `package main

import (
    "context"
    "fmt"
    "log"
    
    "github.com/stocksintels/sdk-go"
)

func main() {
    client := stocksintels.NewClient(&stocksintels.Config{
        APIKey:     "sk_live_...",
        Environment: stocksintels.EnvironmentProduction,
    })
    defer client.Close()

    // Market data
    quote, err := client.Market.GetQuote(context.Background(), "SCOM")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("%s: %.2f %s\\n", quote.Symbol, quote.Price, quote.Currency)

    // Recommended positions
    positions, err := client.RecommendedPositions.GetAll(context.Background())
    if err != nil {
        log.Fatal(err)
    }
    for _, p := range positions {
        fmt.Printf("%s: %s (%.0f%% confidence)\\n", p.Symbol, p.Recommendation, p.Confidence*100)
    }

    // Financials
    income, err := client.Financials.GetIncomeStatement(context.Background(), "AAPL")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Revenue: %s\\n", income.Revenue)
}`,
  },
];

const installationGuide = [
  { step: 1, title: "Install the SDK", description: "Use your preferred package manager to add the SDK to your project." },
  { step: 2, title: "Get an API Key", description: "Sign up at StocksIntels and generate a production or sandbox API key from your dashboard." },
  { step: 3, title: "Initialize the Client", description: "Create a client instance with your API key and chosen environment." },
  { step: 4, title: "Make Your First Request", description: "Call any endpoint — market quotes, financials, recommended positions, or portfolio data." },
];

const commonPatterns = [
  {
    title: "Error Handling",
    typescript: `try {
  const quote = await client.market.getQuote('SCOM');
} catch (error) {
  if (error instanceof StocksIntels.RateLimitError) {
    // Wait and retry
    await new Promise(r => setTimeout(r, error.retryAfter * 1000));
  } else if (error instanceof StocksIntels.AuthError) {
    // Redirect to login
  }
}`,
    python: `from stocksintels import StocksIntels
from stocksintels.errors import RateLimitError, AuthError

try:
    quote = client.market.get_quote("SCOM")
except RateLimitError as e:
    import time
    time.sleep(e.retry_after)
except AuthError:
    # Redirect to login
    pass`,
    go: `quote, err := client.Market.GetQuote(ctx, "SCOM")
if err != nil {
    var rateErr *stocksintels.RateLimitError
    if errors.As(err, &rateErr) {
        time.Sleep(time.Duration(rateErr.RetryAfter) * time.Second)
        return
    }
    var authErr *stocksintels.AuthError
    if errors.As(err, &authErr) {
        // Redirect to login
        return
    }
    log.Fatal(err)
}`,
  },
  {
    title: "Pagination",
    typescript: `// Cursor-based pagination
let cursor: string | undefined;
do {
  const response = await client.recommendedPositions.getHistory({ cursor, limit: 100 });
  positions.push(...response.data);
  cursor = response.nextCursor;
} while (cursor);`,
    python: `cursor = None
while True:
    response = client.recommended_positions.get_history(cursor=cursor, limit=100)
    positions.extend(response.data)
    cursor = response.next_cursor
    if not cursor:
        break`,
    go: `var cursor string
for {
    resp, err := client.RecommendedPositions.GetHistory(ctx, &stocksintels.HistoryParams{
        Cursor: cursor,
        Limit:  100,
    })
    if err != nil {
        log.Fatal(err)
    }
    positions = append(positions, resp.Data...)
    cursor = resp.NextCursor
    if cursor == "" {
        break
    }
}`,
  },
];

export function SdksPage() {
  const [activeTab, setActiveTab] = useState("typescript");
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
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
              <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[#102B50]">SDKs & Libraries</h1>
              <p className="mt-2 text-[#52647A]">Official client libraries for TypeScript, Python, and Go with full type safety and idiomatic APIs.</p>
            </div>
          </div>
        </section>

        {/* Installation Guide */}
        <section className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
          <h2 className="text-2xl font-bold text-[#102B50] mb-8">Quick Start</h2>
          <div className="flex flex-col sm:flex-row gap-6">
            {installationGuide.map((step) => (
              <Card key={step.step} className="border-[#DCE5F0] flex-1">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#0D7490]/10 flex items-center justify-center">
                      <span className="text-xl font-bold text-[#0D7490]">{step.step}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#102B50]">{step.title}</h3>
                      <p className="mt-1 text-sm text-[#52647A]">{step.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* SDK Tabs */}
        <section className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-12">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-2xl mx-auto mb-8">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="typescript" className="data-[state=active]:bg-[#0D7490]">
                <Code2 className="size-4 mr-2" /> TypeScript
              </TabsTrigger>
              <TabsTrigger value="python" className="data-[state=active]:bg-[#0D7490]">
                <Terminal className="size-4 mr-2" /> Python
              </TabsTrigger>
              <TabsTrigger value="go" className="data-[state=active]:bg-[#0D7490]">
                <Package className="size-4 mr-2" /> Go
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {sdks.filter(s => s.id === activeTab).map((sdk) => (
            <TabsContent key={sdk.id} value={sdk.id} className="space-y-6">
              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <CardTitle className="text-[#102B50]">{sdk.name} SDK</CardTitle>
                      <p className="text-[#52647A] mt-1">{sdk.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 text-sm font-mono bg-[#F1F5F9] rounded text-[#0D7490]">v{sdk.version}</span>
                      <Button variant="outline" size="sm" asChild>
                        <a href={sdk.github} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                          <Github className="size-4" /> GitHub
                        </a>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(sdk.install, "install")}>
                        <Copy className="size-4 mr-1" />
                        {copied === "install" ? <Check className="size-4 text-green-600" /> : "Copy Install"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-6">
                    <code className="block bg-[#0B203D] px-4 py-3 rounded font-mono text-sm text-slate-200 overflow-x-auto">
                      {sdk.install}
                    </code>
                  </div>

                  <h3 className="font-semibold text-[#102B50] mb-3">Features</h3>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {sdk.features.map((f, i) => (
                      <span key={i} className="px-3 py-1 text-sm bg-[#F5F8FC] border border-[#DCE5F0] rounded text-[#52647A]">
                        {f}
                      </span>
                    ))}
                  </div>

                  <h3 className="font-semibold text-[#102B50] mb-3">Quick Example</h3>
                  <div className="relative">
                    <pre className="bg-[#0B203D] rounded-xl overflow-hidden">
                      <code className="block p-6 text-sm text-slate-200 font-mono leading-relaxed overflow-x-auto">
                        {sdk.example}
                      </code>
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-3 right-3"
                      onClick={() => copyToClipboard(sdk.example, sdk.id)}
                    >
                      {copied === sdk.id ? (
                        <>
                          <Check className="size-4 mr-1 text-green-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="size-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="mt-4 flex gap-3">
                    {sdk.npm && (
                      <Button asChild variant="outline" size="sm">
                        <a href={sdk.npm} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                          <Package className="size-4" /> npm
                        </a>
                      </Button>
                    )}
                    {sdk.pypi && (
                      <Button asChild variant="outline" size="sm">
                        <a href={sdk.pypi} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                          <Package className="size-4" /> PyPI
                        </a>
                      </Button>
                    )}
                    {sdk.pkg && (
                      <Button asChild variant="outline" size="sm">
                        <a href={sdk.pkg} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                          <ExternalLink className="size-4" /> pkg.go.dev
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </section>

        {/* Common Patterns */}
        <section className="bg-[#F5F8FC] py-16 border-y border-[#DCE5F0]">
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
            <h2 className="text-2xl font-bold text-[#102B50] mb-8">Common Patterns</h2>
            {commonPatterns.map((pattern, i) => (
              <Card key={i} className="border-[#DCE5F0] mb-6">
                <CardHeader>
                  <CardTitle className="text-[#102B50]">{pattern.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="typescript" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-4">
                      <TabsTrigger value="typescript">TypeScript</TabsTrigger>
                      <TabsTrigger value="python">Python</TabsTrigger>
                      <TabsTrigger value="go">Go</TabsTrigger>
                    </TabsList>
                    <TabsContent value="typescript">
                      <pre className="bg-[#0B203D] p-4 rounded-lg overflow-x-auto"><code className="text-sm text-slate-200 font-mono">{pattern.typescript}</code></pre>
                    </TabsContent>
                    <TabsContent value="python">
                      <pre className="bg-[#0B203D] p-4 rounded-lg overflow-x-auto"><code className="text-sm text-slate-200 font-mono">{pattern.python}</code></pre>
                    </TabsContent>
                    <TabsContent value="go">
                      <pre className="bg-[#0B203D] p-4 rounded-lg overflow-x-auto"><code className="text-sm text-slate-200 font-mono">{pattern.go}</code></pre>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Community */}
        <section className="mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-12 text-center">
          <h2 className="text-2xl font-bold text-[#102B50] mb-4">Need a Different Language?</h2>
          <p className="text-[#52647A] mb-6 max-w-xl mx-auto">
            Community-maintained SDKs are available for Rust, Ruby, PHP, and more. 
            Check the <a href="https://github.com/stocksintels" target="_blank" rel="noopener noreferrer" className="text-[#0D7490] underline">GitHub organization</a> for the full list.
          </p>
          <p className="text-[#52647A] mb-6">
            Want to contribute an SDK? See our <a href="/developers/docs#contributing" className="text-[#0D7490] underline">contribution guide</a>.
          </p>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}