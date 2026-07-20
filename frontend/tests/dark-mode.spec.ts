import { test, expect } from "@playwright/test";

// End-to-end verification that dark mode works at runtime.
// Marketing pages are publicly reachable; we verify (a) the ThemeToggle button
// flips `.dark` on <html>, and (b) semantic surfaces actually resolve to dark
// tokens. We also force `.dark` directly to prove the CSS variables switch.

async function toggleToDark(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /switch to dark mode/i });
  await btn.first().click();
  await expect(page.locator("html")).toHaveClass(/dark/);
}

// Sum of RGB channels; white = 765, dark card << 200.
function rgbSum(rgb: string): number {
  const nums = rgb.match(/\d+/g);
  if (!nums) return 0;
  return nums.slice(0, 3).reduce((a, b) => a + Number(b), 0);
}

test.describe("dark mode end-to-end (public pages)", () => {
  test("About: toggle adds .dark and surfaces go dark", async ({ page }) => {
    await page.goto("/about");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await toggleToDark(page);
    // Find a real surface element to inspect.
    const bg = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("[class*='bg-card'], section, main"));
      const node = candidates.find((c) => getComputedStyle(c).backgroundColor !== "rgba(0, 0, 0, 0)") || document.body;
      return getComputedStyle(node).backgroundColor;
    });
    expect(rgbSum(bg)).toBeLessThan(200);
  });

  test("Pricing: toggle adds .dark and persists across navigation", async ({ page }) => {
    await page.goto("/pricing");
    await toggleToDark(page);
    await page.goto("/about");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("Login: theme toggle present and flips .dark", async ({ page }) => {
    await page.goto("/login");
    await toggleToDark(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  });

  test("forced .dark drives semantic token (theme.css variables)", async ({ page }) => {
    await page.goto("/blog");
    // Force dark without the toggle to prove the CSS layer itself switches.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const cardBg = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "bg-card";
      document.body.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    });
    // Dark --card is oklch(0.21 ...) -> very dark (low RGB sum), not white.
    expect(rgbSum(cardBg)).toBeLessThan(200);
  });
});
