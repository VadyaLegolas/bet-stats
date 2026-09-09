import { expect, test } from "@playwright/test";

test("EVAL-01..08 production scorecard evidence", async ({ page }) => {
  await page.goto("/scorecards");
  await expect(page.getByRole("heading", { name: "Forecast evidence scorecard" })).toBeVisible();
  await expect(page.getByTestId("phase-04-production-acceptance")).toBeVisible();
});
