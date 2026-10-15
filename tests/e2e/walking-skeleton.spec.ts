import { expect, test } from "@playwright/test";

import { FIXED_TIME_ZONE } from "../helpers/time.js";

test.use({ timezoneId: FIXED_TIME_ZONE });

test("renders one normalized Premier League fixture through the production path", async ({ page }) => {
  // The deterministic fixture keeps a rolling kickoff (today/tomorrow 14:00 UTC), so the
  // window always covering it is derived from the real clock: now-1h … now+48h.
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await page.goto(`/fixtures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&competition=${encodeURIComponent("Premier League")}`);

  await expect(page.getByRole("heading", { level: 1, name: "Предстоящие матчи" })).toBeVisible();
  await expect(page.getByLabel("Соревнование")).toHaveValue("Premier League");
  await expect(page.getByRole("link", { name: "Arsenal против Chelsea" })).toBeVisible();
  await expect(page.getByText("Europe/Warsaw")).toBeVisible();
  await expect(page.getByRole("button", { name: /prediction|odds|value|bet/i })).toHaveCount(0);
});
