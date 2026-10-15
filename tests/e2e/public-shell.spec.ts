import { expect, test } from "@playwright/test";

test("renders the neutral public shell and persistent disclosure", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Достоверные данные о футбольных матчах" })).toBeVisible();
  await expect(page.getByText("Только футбольные данные и аналитическая информация.")).toBeVisible();
});
