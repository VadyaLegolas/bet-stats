import { expect, test } from "@playwright/test";
const LIVE_FIXTURES = { comparison: "live-comparison-fixture" } as const;

test("exact URL pair survives reload and newer revision until explicit keyboard swap", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  const options = page.getByLabel("Left snapshot").locator("option");
  const leftId = await options.filter({ hasText: "INITIAL" }).getAttribute("value");
  const rightId = await options.filter({ hasText: "PRE_MATCH" }).getAttribute("value");
  const newerId = await options.filter({ hasText: "LINEUP_CONFIRMED" }).getAttribute("value");
  expect(leftId).toBeTruthy(); expect(rightId).toBeTruthy(); expect(newerId).toBeTruthy();
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}?left=${leftId}&right=${rightId}`);
  await expect(page.getByLabel("Left snapshot")).toHaveValue(leftId!);
  await expect(page.getByLabel("Right snapshot")).toHaveValue(rightId!);
  await expect(page.getByLabel("Left snapshot").locator(`option[value="${newerId}"]`)).toHaveCount(1);

  await page.reload();
  await expect(page.getByLabel("Left snapshot")).toHaveValue(leftId!);
  await expect(page.getByLabel("Right snapshot")).toHaveValue(rightId!);
  const comparisonResponse = page.waitForResponse((response) => response.url().includes("/forecasts/compare?") && response.ok());
  await page.getByRole("button", { name: "Compare revisions" }).click();
  await expect(page.getByRole("heading", { name: "Comparison result" })).toBeVisible();
  const receipt = await (await comparisonResponse).json() as { left: { id: string }; right: { id: string } };
  expect(receipt).toMatchObject({ left: { id: leftId }, right: { id: rightId } });

  await page.getByRole("button", { name: "Swap snapshots" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Left snapshot")).toHaveValue(rightId!);
  await expect(page.getByLabel("Right snapshot")).toHaveValue(leftId!);
  await expect(page).toHaveURL(new RegExp(`left=${rightId}&right=${leftId}`));
});

test("comparison remains operable at narrow width and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByRole("button", { name: "Swap snapshots" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
