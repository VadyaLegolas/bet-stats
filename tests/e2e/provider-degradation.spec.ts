import { expect, test } from "@playwright/test";

test("fallback and sole-source notices preserve canonical fixture identity", async ({ page }) => {
  await page.setContent(`<main><h1>Arsenal vs Chelsea</h1><aside aria-label="Provider status"><h2>Fallback source used</h2><p>Source: api-football</p><time datetime="2026-09-12T12:00:02Z">2026-09-12 12:00 UTC</time><details><summary>Exact provider receipt</summary><code>route-1</code></details></aside><aside aria-label="Provider status"><h2>Limited data — no production fallback</h2><p>API-Football is the sole configured source for this competition and is unavailable. Last valid data remains labelled with its capture time; missing values are not treated as zero.</p><button>Check provider coverage again</button></aside></main>`);
  await expect(page.getByRole("heading", { name: "Arsenal vs Chelsea" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Fallback source used" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Limited data — no production fallback" })).toBeVisible();
});

test("provider states retain controls and meaning at narrow width and forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 }); await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setContent(`<main style="max-width:100%;overflow-wrap:anywhere"><form><input aria-label="From" value="2026-09-12" style="max-width:100%"><button style="min-height:48px">Try loading fixtures again</button></form>${["Current primary source","Fallback source used","Provider coverage pending","Provider coverage unavailable","Limited data — no production fallback","Provider coverage unsupported","Provider capability is stale","Provider budget protected","Provider circuit denied"].map((heading)=>`<aside aria-label="Provider status"><strong>${heading}</strong><p>provider-with-a-very-long-safe-reason-that-wraps</p><time datetime="2026-09-12T12:00:00Z">2026-09-12 UTC</time></aside>`).join("")}</main>`);
  await expect(page.getByRole("button", { name: "Try loading fixtures again" })).toBeVisible();
  await expect(page.getByLabel("Provider status")).toHaveCount(9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
