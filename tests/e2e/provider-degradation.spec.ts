import { expect, test } from "@playwright/test";
const LIVE_FIXTURES = { fallback: "live-fallback-fixture", limited: "live-limited-fixture", comparison: "live-comparison-fixture" } as const;

test("fallback and sole-source notices preserve canonical fixture identity", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.fallback}`);
  await expect(page.getByRole("heading", { name: "Arsenal vs Chelsea" })).toBeVisible();
  const fallback = page.getByLabel("Provider status");
  await expect(fallback.getByText("Fallback source used", { exact: true })).toBeVisible();
  await expect(fallback).toContainText("api-football");
  await fallback.getByText("Exact provider receipt").click();
  await expect(fallback).toContainText("live-fallback-route");

  await page.goto(`/fixtures/${LIVE_FIXTURES.limited}`);
  await expect(page.getByRole("heading", { name: "Roma vs Ajax" })).toBeVisible();
  const limited = page.getByLabel("Provider status");
  await expect(limited.getByText("Limited data — no production fallback", { exact: true })).toBeVisible();
  await expect(limited).toContainText("api-football");
  await expect(limited).toContainText("PROVIDER_UNAVAILABLE");
  await expect(limited).toContainText("Last valid capture");
  await expect(limited.locator("time")).toHaveCount(1);
});

test("official lineup enrichment is visible through production boundaries", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByLabel("Compare forecast revisions").getByText("LINEUP_CONFIRMED", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Left snapshot").locator('option[value="live-newer"]')).toHaveCount(1);
  await expect(page.getByLabel("Betting risk disclosure").getByText("Probabilities are estimates, not guarantees.", { exact: false })).toBeVisible();
});

test("provider state remains operable at narrow width and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/fixtures/${LIVE_FIXTURES.limited}`);
  await expect(page.getByLabel("Provider status")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
