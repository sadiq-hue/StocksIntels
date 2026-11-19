import { expect, test } from "@playwright/test";

const publicPages = [
  {
    path: "/",
    title: "StocksIntels | Financial Market Intelligence for Africa & Global Markets",
    description: "Discover StocksIntels, a Super Intelligence-powered financial research platform combining market analysis, company financials, investment insights and human analyst expertise across African and global equity markets.",
    canonical: "https://stocksintels.com",
  },
  {
    path: "/about",
    title: "About StocksIntels | African & Global Market Intelligence",
    description: "Learn how StocksIntels combines Super Intelligence, company financials, market analysis and human analyst expertise to deepen research across African and global equity markets.",
    canonical: "https://stocksintels.com/about",
  },
  {
    path: "/pricing",
    title: "StocksIntels Pricing | Financial Intelligence Plans",
    description: "Compare StocksIntels Core, Pro and Premium plans for Super Intelligence-powered market research, company financials, investment insights and portfolio tools.",
    canonical: "https://stocksintels.com/pricing",
  },
  {
    path: "/blog",
    title: "StocksIntels Insights | African & Global Market Research",
    description: "Read StocksIntels research and market insights covering company performance, financial markets and investment context across African and global equities.",
    canonical: "https://stocksintels.com/blog",
  },
  {
    path: "/careers",
    title: "Careers at StocksIntels | Build Financial Intelligence",
    description: "Join StocksIntels and help build Super Intelligence-powered financial research, data and analytical infrastructure for African and global equity markets.",
    canonical: "https://stocksintels.com/careers",
  },
  {
    path: "/login",
    title: "StocksIntels Login | Access Your Research Workspace",
    description: "Log in to StocksIntels to access financial market intelligence, company financials, investment insights, portfolio tools and research across African and global markets.",
    canonical: "https://stocksintels.com/login",
  },
];

for (const pageSeo of publicPages) {
  test(`${pageSeo.path} exposes its canonical SEO metadata`, async ({ page }) => {
    await page.goto(pageSeo.path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(pageSeo.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", pageSeo.description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", pageSeo.canonical);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", pageSeo.title);
  });
}
