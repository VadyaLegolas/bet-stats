import { expect, test } from "@playwright/test";

test.describe("forecast and manual value workbench", () => {
  test("keeps risk and insufficient-evidence context visible when no issued forecast exists", async ({ page }) => {
    await page.goto("/fixtures/fixture-premier-league-001");
    await expect(page.getByRole("heading", { level: 2, name: "Forecast and manual value workbench" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Insufficient evidence" })).toBeVisible();
    await expect(page.getByLabel("Betting risk disclosure")).toContainText("Probabilities are estimates, not guarantees");
    await expect(page.getByRole("button", { name: /compare exact snapshots/i })).toHaveCount(0);
  });

  test("reflows the workbench without horizontal page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 }); await page.goto("/fixtures/fixture-premier-league-001"); await page.evaluate(() => { document.body.style.fontSize = "200%"; });
    await expect(page.getByRole("heading", { level: 2, name: "Forecast and manual value workbench" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
