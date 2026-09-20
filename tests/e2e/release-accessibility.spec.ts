import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { LIVE_FIXTURES } from "./live-provider-stack.js";

const destinationNames = ["Fixtures", "Analysis", "Results", "Methodology"] as const;

test("navigation is equivalent on desktop and mobile", async ({ page }) => {
  await page.goto("/fixtures");

  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primary.getByRole("link")).toHaveText(destinationNames);
  await expect(primary.getByRole("link", { name: "Fixtures" })).toHaveAttribute("aria-current", "page");

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Menu" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(primary.getByRole("link")).toHaveText(destinationNames);
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  await menu.click();
  await primary.getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/scorecards/);
  await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

test("reflow keeps the page inside 320 CSS pixels and respects user media", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("contentinfo")).toContainText("Outcomes remain uncertain");

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("keyboard users can skip navigation and retain visible focus", async ({ page }) => {
  await page.goto("/fixtures");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const outline = await skip.evaluate((element) => getComputedStyle(element, ":focus-visible").outlineStyle);
  expect(outline).not.toBe("none");
});
