import { expect, test } from "@playwright/test";

const user = {
  id: 1,
  full_name: "Test Trader",
  email: "test@example.com",
  role: "user",
  is_verified: true,
  subscription_tier: "free",
  subscription_status: "trialing",
  trial_start_date: new Date().toISOString(),
};

const indexRow = (symbol: string, market: string, name: string, value: string, change = "+0.20%") => ({
  symbol,
  market,
  name,
  value,
  change,
  volume: "0",
  isPositive: !change.startsWith("-"),
});

const indices = [
  indexRow("NSE:NSEASI", "NSE", "NSE All Share Index", "240.57"),
  indexRow("NGX:ASI", "NGX", "NGX All Share Index", "248329.65", "-0.40%"),
  indexRow("^J203.JO", "JSE", "FTSE/JSE All Share Index", "106218.39", "-3.98%"),
  indexRow("NSE:NSE20", "NSE", "NSE 20 Share Index", "4177.38"),
  indexRow("NGX:NGX30", "NGX", "NGX 30 Index", "9140.44", "-0.41%"),
  indexRow("^J200.JO", "JSE", "FTSE/JSE Top 40 Index", "98404.82", "-4.23%"),
  indexRow("^GSPC", "Global", "S&P 500", "7323.63"),
  indexRow("^IXIC", "Global", "NASDAQ Composite", "24429.88"),
  indexRow("^DJI", "Global", "Dow Jones", "50198.17", "-1.11%"),
  indexRow("^NYA", "Global", "NYSE Composite", "23559.61", "-1.06%"),
  indexRow("^FTSE", "Global", "FTSE 100", "10510.40", "-0.39%"),
  indexRow("^N225", "Global", "Nikkei 225", "59444.21"),
  indexRow("^GDAXI", "Global", "DAX", "25743.41"),
];

const sectors = ["Media", "Insurance", "Other", "Automobiles", "Consumer Goods", "Banking"]
  .map((sector, index) => ({ sector, avgChange: 3.5 - index * 0.4, count: index + 1 }));

const recentIpos = ["WWB", "VVVV", "JAN", "RACC", "BULL", "FIGR"].map((ticker, index) => ({
  id: index + 1,
  company_name: `${ticker} Holdings`,
  ticker,
  exchange: index % 2 ? "NASDAQ" : "NYSE",
  listing_date: `2026-11-${String(16 - index).padStart(2, "0")}`,
  status: "listed",
  since_ipo_pct: index % 2 ? -4.5 - index : 8.5 + index,
}));

test("dashboard balances market cards and recent IPOs", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === "/api/auth/refresh" || path === "/api/auth/me") body = { token: "test-token", user };
    else if (path === "/api/market/indices") body = indices;
    else if (path === "/api/market/sectors") body = sectors;
    else if (path === "/api/ipo/recent") body = { ipos: recentIpos };
    else if (path === "/api/market/movers") body = { combined: { gainers: [], losers: [] }, active: [] };
    else if (path === "/api/market/pulse") body = {
      nse: { label: "Neutral", score: 50, idxPositive: 1, idxTotal: 2 },
      global: { label: "Neutral", score: 50, idxPositive: 1, idxTotal: 2 },
      summary: "",
      indices: {},
      topSector: null,
    };
    else if (path === "/api/portfolio/performance") body = { data: [], hasHistory: false };
    else if (path === "/api/signals") body = { success: true, signals: [] };

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/app", { waitUntil: "domcontentloaded" });

  const africanCard = page.getByRole("heading", { name: "African Indices" }).locator("xpath=ancestor::div[@data-slot='card']");
  const globalCard = page.getByRole("heading", { name: "Global Indices" }).locator("xpath=ancestor::div[@data-slot='card']");
  const sectorCard = page.getByRole("heading", { name: "Sector Performance" }).locator("xpath=ancestor::div[@data-slot='card']");

  await expect(africanCard.getByText("NGX All Share Index")).toBeVisible();
  await expect(africanCard.getByText("FTSE/JSE All Share Index")).toBeVisible();
  await expect(africanCard.getByText("NSE All Share Index")).toBeVisible();
  await expect(africanCard.locator(".min-h-14")).toHaveCount(6);
  await expect(globalCard.locator(".min-h-14")).toHaveCount(6);
  await expect(sectorCard.locator(".min-h-14")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "NSE Indices" })).toHaveCount(0);

  const combinedMarketCard = page.getByRole("heading", { name: "Watchlist / Most Active" }).locator("xpath=ancestor::div[@data-slot='card']");
  const intelligenceCard = page.getByRole("heading", { name: "Today's Market Intelligence" }).locator("xpath=ancestor::div[@data-slot='card']");
  await expect(combinedMarketCard.getByRole("heading", { name: "Recent IPOs" })).toBeVisible();
  await expect(combinedMarketCard.getByTestId("recent-ipos-list").getByRole("link")).toHaveCount(6);
  const marketBox = await combinedMarketCard.boundingBox();
  const intelligenceBox = await intelligenceCard.boundingBox();
  expect(marketBox?.x || 0).toBeLessThan(intelligenceBox?.x || 0);
  expect(Math.abs((marketBox?.y || 0) - (intelligenceBox?.y || 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((marketBox?.height || 0) - (intelligenceBox?.height || 0))).toBeLessThanOrEqual(2);
  expect(marketBox?.height || 0).toBeLessThanOrEqual(902);

  const heights = await Promise.all([africanCard, globalCard, sectorCard].map(async card => (await card.boundingBox())?.height || 0));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(24);

  await page.setViewportSize({ width: 375, height: 812 });
  const pageWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(pageWidth).toBeLessThanOrEqual(377);
  await context.close();
});
