import { expect, test } from "@playwright/test";
const LIVE_FIXTURES = { fallback: "live-fallback-fixture", limited: "live-limited-fixture", comparison: "live-comparison-fixture" } as const;

test("fallback and sole-source notices preserve canonical fixture identity", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.fallback}`);
  await expect(page.getByRole("heading", { name: "Arsenal против Chelsea" })).toBeVisible();
  const fallback = page.getByLabel("Статус поставщика");
  await expect(fallback.getByText("Использован резервный источник", { exact: true })).toBeVisible();
  await expect(fallback).toContainText("api-football");
  await fallback.getByText("Точная квитанция поставщика").click();
  await expect(fallback).toContainText("provider-route-v1:live-pl:live-pl-2026:FIXTURES:live-fallback");

  await page.goto(`/fixtures/${LIVE_FIXTURES.limited}`);
  await expect(page.getByRole("heading", { name: "Roma против Ajax" })).toBeVisible();
  const limited = page.getByLabel("Статус поставщика");
  await expect(limited.getByText("Неполные данные", { exact: true })).toBeVisible();
  await expect(limited).toContainText("api-football");
  await expect(limited).toContainText("PROVIDER_UNAVAILABLE");
  await expect(limited).toContainText("Последний корректный захват");
  await expect(limited.locator("time")).toHaveCount(1);
});

test("official lineup enrichment is visible through production boundaries", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByLabel("Сравнение ревизий прогнозов").getByText("LINEUP_CONFIRMED", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Левый снимок").locator("option").filter({ hasText: "LINEUP_CONFIRMED" })).toHaveCount(1);
  await expect(page.getByLabel("Раскрытие рисков ставок").getByText("Вероятности — это оценки, а не гарантии.", { exact: false })).toBeVisible();
});

test("provider state remains operable at narrow width and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/fixtures/${LIVE_FIXTURES.limited}`);
  await expect(page.getByLabel("Статус поставщика")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
