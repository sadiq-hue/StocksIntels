import { test, expect, Page } from "@playwright/test";

const VIEWPORT_WIDTH = 375;
const TOLERANCE = 2;

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/pricing",
  "/about",
  "/blog",
  "/careers",
  "/privacy",
  "/terms",
  "/security",
  "/disclaimer",
];

const APP_ROUTES = [
  "/app",
  "/app/markets",
  "/app/stocks",
  "/app/watchlist",
  "/app/signals",
  "/app/ai-insights",
  "/app/people",
  "/app/groups",
  "/app/news",
  "/app/notifications",
  "/app/financials",
  "/app/portfolio",
  "/app/stock/EQTY",
  "/app/chat",
  "/app/settings",
  "/app/sectors",
  "/app/bonds",
  "/app/ipos",
  "/app/derivatives",
  "/app/etfs",
  "/app/profile",
  "/app/affiliates",
  "/app/support",
];

const fakeUser = {
  id: 1,
  full_name: "Test Trader",
  email: "test@example.com",
  role: "user",
  is_verified: true,
  subscription_tier: "free",
  subscription_status: "trialing",
  trial_start_date: new Date().toISOString(),
  subscription_end_date: null,
};

async function seedAuth(page: Page) {
  await page.addInitScript((user) => {
    localStorage.setItem("stockintel_user", JSON.stringify(user));
    localStorage.setItem("stockintel_token", "test-token");
  }, fakeUser);
}

async function findOverflows(page: Page) {
  return page.evaluate((vw) => {
    const results: { tag: string; cls: string; id: string; width: number; text: string }[] = [];
    const all = document.body.querySelectorAll<HTMLElement>("*");
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      // element extends beyond the right edge of the viewport
      if (rect.right > vw + 2 && rect.width > 0 && rect.width <= 4000) {
        const style = getComputedStyle(el);
        if (style.position === "fixed") continue; // fixed/off-canvas drawers are expected
        if (style.visibility === "hidden" || style.display === "none") continue;
        // Only report the element if none of its ancestors already clips overflow
        results.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 120),
          id: el.id || "",
          width: Math.round(rect.width),
          text: (el.textContent || "").trim().slice(0, 50),
        });
      }
    }
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders: results,
    };
  }, VIEWPORT_WIDTH);
}

test.describe("Mobile horizontal overflow @375px", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`public ${route}`, async ({ page }) => {
      await page.goto(route, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1500);
      const { docScrollWidth, bodyScrollWidth, offenders } = await findOverflows(page);
      const maxScroll = Math.max(docScrollWidth, bodyScrollWidth);
      if (maxScroll > VIEWPORT_WIDTH + TOLERANCE) {
        console.log(`\n[OVERFLOW] ${route} scrollWidth=${maxScroll}`);
        for (const o of offenders.slice(0, 12)) {
          console.log(`   <${o.tag}> w=${o.width} class="${o.cls}" text="${o.text}"`);
        }
      }
      expect(maxScroll, `${route} horizontal overflow (scrollWidth ${maxScroll} > ${VIEWPORT_WIDTH})`).toBeLessThanOrEqual(VIEWPORT_WIDTH + TOLERANCE);
    });
  }

  for (const route of APP_ROUTES) {
    test(`app ${route}`, async ({ page }) => {
      await seedAuth(page);
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(2000);
      const { docScrollWidth, bodyScrollWidth, offenders } = await findOverflows(page);
      const maxScroll = Math.max(docScrollWidth, bodyScrollWidth);
      if (maxScroll > VIEWPORT_WIDTH + TOLERANCE) {
        console.log(`\n[OVERFLOW] ${route} scrollWidth=${maxScroll}`);
        for (const o of offenders.slice(0, 12)) {
          console.log(`   <${o.tag}> w=${o.width} class="${o.cls}" text="${o.text}"`);
        }
      }
      expect(maxScroll, `${route} horizontal overflow (scrollWidth ${maxScroll} > ${VIEWPORT_WIDTH})`).toBeLessThanOrEqual(VIEWPORT_WIDTH + TOLERANCE);
    });
  }
});
