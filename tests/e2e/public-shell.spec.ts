import { expect, test } from "@playwright/test";

test("renders the neutral public shell and persistent disclosure", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Trustworthy football fixture data" })).toBeVisible();
  await expect(page.getByText("Football data and analytical information only.")).toBeVisible();
});
