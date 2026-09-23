import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { LIVE_FIXTURES } from "./live-provider-stack.js";
import { prepareReleaseFixture } from "./live-release-stack.js";

const destinationNames = ["Fixtures", "Analysis", "Results", "Methodology"] as const;

test("navigation is equivalent on desktop and mobile", async ({ page }, testInfo) => {
  await page.goto("/fixtures");

  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "Menu" }).click();
  await expect(primary.getByRole("link")).toHaveText(destinationNames);
  await expect(primary.getByRole("link", { name: "Fixtures" })).toHaveAttribute("aria-current", "page");
  if (testInfo.project.name === "mobile-chromium") await page.keyboard.press("Escape");

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

test("declared release support is desktop and mobile Chromium", async ({}, testInfo) => {
  expect(["desktop-chromium", "mobile-chromium"]).toContain(testInfo.project.name);
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

test("200 percent text zoom keeps essential actions and content available", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await page.locator("html").evaluate((element) => { element.style.fontSize = "200%"; });
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save complete immutable odds book" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("methodology and fail-closed privacy expose accessible release facts", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "How forecasts work" })).toBeVisible();
  await expect(page.getByText(/Model card version/).first()).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "History retention is unavailable" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Allow retention/ })).toBeDisabled();
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

test("evidence parity keeps one complete field inventory across layouts", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  const projection = page.locator('[data-evidence-projection="forecast-one-x-two"]');
  await expect(projection).toBeVisible();
  const desktopFields = await projection.locator("[data-evidence-desktop] [data-evidence-field]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-evidence-field")));
  const mobileFields = await projection.locator("[data-evidence-mobile] [data-evidence-field]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-evidence-field")));
  expect(new Set(mobileFields)).toEqual(new Set(desktopFields));
  expect(desktopFields).toEqual(expect.arrayContaining(["selection", "probability", "fairOdds"]));
});

test("chart alternative exposes the complete reliability evidence", async ({ page }) => {
  const query = new URLSearchParams({ modelVersion: "poisson-ensemble-v1", competitionId: "live-pl", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
  await page.goto(`/scorecards?${query}`);
  const reliability = page.getByRole("region", { name: "Reliability evidence" });
  await expect(reliability.getByText(/Conclusion:/)).toBeVisible();
  const alternative = reliability.locator('table[aria-label="Complete reliability data"]');
  await expect(alternative).toBeAttached();
  await expect(alternative.locator("th")).toContainText(["Range", "Mean forecast", "Observed", "Count", "Direction"]);
});

test("manual odds workflow is keyboard operable without losing evidence", async ({ page }, testInfo) => {
  await prepareReleaseFixture(LIVE_FIXTURES.comparison);
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await page.getByLabel("Bookmaker or source label").focus();
  await page.keyboard.type(`Keyboard source ${testInfo.project.name}`);
  await page.keyboard.press("Tab");
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Immutable odds snapshot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();
});

test("local failure and retrying preserve valid siblings", async ({ context, page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  const snapshot = page.getByRole("heading", { name: "Exact snapshot comparison" }).locator("xpath=following-sibling::p").locator("code");
  const snapshotId = await snapshot.textContent();
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Refresh forecast availability" }).click();
  await expect(page.locator('[data-local-state="stale"]')).toContainText("Forecast availability is not current");
  await expect(snapshot).toHaveText(snapshotId ?? "");
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();

  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Updated" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh forecast availability" })).toBeFocused();
  await expect(snapshot).toHaveText(snapshotId ?? "");
});
