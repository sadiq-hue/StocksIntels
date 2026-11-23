import { expect, test } from "@playwright/test";

const user = {
  id: 1,
  full_name: "Chart Tester",
  email: "charts@example.com",
  role: "user",
  is_verified: true,
  subscription_tier: "free",
  subscription_status: "trialing",
  trial_start_date: new Date().toISOString(),
};

const bars = Array.from({ length: 90 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 1 + index));
  const open = 180 + index * 0.15 + Math.sin(index / 4) * 3;
  const close = open + Math.sin(index / 2) * 1.8;
  return {
    date: date.toISOString().slice(0, 10),
    timestamp: Math.floor(date.getTime() / 1000),
    open,
    high: Math.max(open, close) + 1.2,
    low: Math.min(open, close) - 1.1,
    close,
    adjclose: close,
    volume: 25_000_000 + index * 100_000,
  };
});

test("stock route keeps a structured shell while its page bundle loads", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const releaseChunk = { resolve: () => {} };
  const chunkGate = new Promise<void>((resolve) => { releaseChunk.resolve = resolve; });

  await page.route("**/api/auth/refresh", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token: "test-token", user }),
  }));
  await page.route(/\/assets\/StockAnalysisPage-.*\.js/, async (route) => {
    await chunkGate;
    await route.continue();
  });

  await page.goto("/app/stock/AAPL?market=us", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Loading stock analysis" })).toBeVisible();
  await expect(page.locator("aside")).toBeVisible();

  releaseChunk.resolve();
  await expect(page.getByRole("heading", { name: "Price Chart" })).toBeVisible();
  await context.close();
});

test("stock analysis switches between line and candlestick charts", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const stockMatch = path.match(/^\/api\/stock\/(AAPL|MSFT)(?:\/(history|profile|holders))?$/);
    const financialMatch = path.match(/^\/api\/financials\/(AAPL|MSFT)$/);
    let status = 200;
    let body: unknown = {};

    if (path === "/api/auth/refresh" || path === "/api/auth/me") body = { token: "test-token", user };
    else if (stockMatch?.[2] === "history") body = { symbol: stockMatch[1], bars, count: bars.length };
    else if (stockMatch && !stockMatch[2]) body = {
      symbol: stockMatch[1], company_name: stockMatch[1] === "AAPL" ? "Apple Inc." : "Microsoft Corporation", price: 193.4, change: 1.2, changePercent: 0.62,
      volume: 41_200_000, dayHigh: 194.8, dayLow: 190.2, previousClose: 192.2,
      marketState: "REGULAR", marketCap: 2_900_000_000_000, currency: "USD", exchange: "NASDAQ",
    };
    else if (stockMatch?.[2] === "profile") body = { profile: { companyName: stockMatch[1] === "AAPL" ? "Apple Inc." : "Microsoft Corporation", sector: "Technology", exchange: "NASDAQ" } };
    else if (stockMatch?.[2] === "holders") body = { topHolders: [], etfHolders: [] };
    else if (path === "/api/market/premarket") body = {};
    else if (path === "/api/market/quotes") body = { quotes: {} };
    else if (path === "/api/signals") body = { signals: [] };
    else if (financialMatch) body = { data: { quote: {}, keyMetrics: {}, incomeStatementHistory: [], dividendHistory: [] } };
    else if (path.startsWith("/api/africa/stocks")) body = { data: [] };
    else if (path === "/api/stock-tracking/prompt-status") body = { dismissed: true };
    else if (path === "/api/stock-tracking/consecutive-days") body = { qualifiesForPrompt: false };
    else if (path === "/api/stock-tracking/view") body = { success: true };
    else if (["/api/holdings", "/api/broker-connections", "/api/notifications", "/api/paper/trades"].includes(path)) body = [];
    else if (path === "/api/paper/account") body = null;
    else { status = 503; body = { error: "Not mocked" }; }

    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/app/stock/AAPL?market=us", { waitUntil: "domcontentloaded" });
  const chart = page.locator("#price-chart");
  const lineButton = chart.getByRole("button", { name: "Line chart" });
  const candleButton = chart.getByRole("button", { name: "Candlestick chart" });

  await expect(lineButton).toHaveAttribute("aria-pressed", "true");
  await expect(chart.locator(".recharts-line-curve")).toBeVisible();

  await candleButton.click();
  await expect(candleButton).toHaveAttribute("aria-pressed", "true");
  const candleSvg = chart.getByRole("img", { name: /Candlestick price chart/ });
  await expect(candleSvg).toBeVisible();
  expect(await candleSvg.locator("rect").count()).toBeGreaterThan(20);

  await candleSvg.hover({ position: { x: 260, y: 120 } });
  await expect(chart.getByText("Open", { exact: true })).toBeVisible();
  await expect(chart.getByText("Close", { exact: true })).toBeVisible();

  const intradayRequest = page.waitForRequest((request) => request.url().includes("/api/stock/AAPL/history") && request.url().includes("interval=5m"));
  await chart.getByRole("button", { name: "1D", exact: true }).click();
  await intradayRequest;

  const microsoftHistory = page.waitForRequest((request) => request.url().includes("/api/stock/MSFT/history"));
  await page.evaluate(() => {
    history.pushState({}, "", "/app/stock/MSFT?market=us");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await microsoftHistory;
  await expect(page.getByRole("heading", { name: /Microsoft Corporation/ })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 700 });
  const pageWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(pageWidth).toBeLessThanOrEqual(322);
  await context.close();
});
