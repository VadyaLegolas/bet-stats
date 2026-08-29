import { expect, test } from "@playwright/test";

import { FIXED_NOW, FIXED_TIME_ZONE } from "../helpers/time.js";

test.use({ timezoneId: FIXED_TIME_ZONE });

test("renders one normalized Premier League fixture through the production path", async ({ page }) => {
  await page.addInitScript((now) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length === 0 ? [now] : args));
      }
      static override now(): number { return new NativeDate(now).valueOf(); }
    }
    globalThis.Date = FixedDate as DateConstructor;
  }, FIXED_NOW);

  await page.goto("/fixtures");

  await expect(page.getByRole("heading", { level: 1, name: "Upcoming fixtures" })).toBeVisible();
  await expect(page.getByLabel("Competition")).toHaveValue("Premier League");
  await expect(page.getByRole("link", { name: "Arsenal vs Chelsea" })).toBeVisible();
  await expect(page.getByText("Europe/Warsaw")).toBeVisible();
  await expect(page.getByRole("button", { name: /prediction|odds|value|bet/i })).toHaveCount(0);
});
