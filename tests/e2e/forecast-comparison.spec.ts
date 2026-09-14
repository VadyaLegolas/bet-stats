import { expect, test } from "@playwright/test";
const LIVE_FIXTURES = { comparison: "live-comparison-fixture" } as const;

test("exact URL pair survives reload and newer revision until explicit keyboard swap", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}?left=live-left&right=live-right`);
  await expect(page.getByLabel("Left snapshot")).toHaveValue("live-left");
  await expect(page.getByLabel("Right snapshot")).toHaveValue("live-right");
  await expect(page.getByLabel("Left snapshot").locator('option[value="live-newer"]')).toHaveCount(1);

  await page.reload();
  await expect(page.getByLabel("Left snapshot")).toHaveValue("live-left");
  await expect(page.getByLabel("Right snapshot")).toHaveValue("live-right");
  const comparisonResponse = page.waitForResponse((response) => response.url().includes("/forecasts/compare?") && response.ok());
  await page.getByRole("button", { name: "Compare revisions" }).click();
  await expect(page.getByRole("heading", { name: "Comparison result" })).toBeVisible();
  const receipt = await (await comparisonResponse).json() as { left: { id: string }; right: { id: string } };
  expect(receipt).toMatchObject({ left: { id: "live-left" }, right: { id: "live-right" } });

  await page.getByRole("button", { name: "Swap snapshots" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Left snapshot")).toHaveValue("live-right");
  await expect(page.getByLabel("Right snapshot")).toHaveValue("live-left");
  await expect(page).toHaveURL(/left=live-right&right=live-left/);
});

test("comparison remains operable at narrow width and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}?left=live-left&right=live-right`);
  await expect(page.getByRole("button", { name: "Swap snapshots" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
