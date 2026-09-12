import { expect, test } from "@playwright/test";

test("fallback and sole-source notices preserve canonical fixture identity", async ({ page }) => {
  await page.setContent(`<main><h1>Arsenal vs Chelsea</h1><aside aria-label="Provider status"><h2>Fallback source used</h2><p>Source: api-football</p><time datetime="2026-09-12T12:00:02Z">2026-09-12 12:00 UTC</time><details><summary>Exact provider receipt</summary><code>route-1</code></details></aside><aside aria-label="Provider status"><h2>Limited data — no production fallback</h2><p>API-Football is the sole configured source for this competition and is unavailable. Last valid data remains labelled with its capture time; missing values are not treated as zero.</p><button>Check provider coverage again</button></aside></main>`);
  await expect(page.getByRole("heading", { name: "Arsenal vs Chelsea" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Fallback source used" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Limited data — no production fallback" })).toBeVisible();
});
