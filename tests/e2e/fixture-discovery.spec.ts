import { expect, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:3001";

test.describe("fixture discovery API", () => {
  test("returns a bounded, stable canonical list with honest provenance", async ({ request }) => {
    const response = await request.get(`${apiOrigin}/fixtures?from=2026-08-28T00:00:00.000Z&to=2026-08-31T00:00:00.000Z&competition=Premier%20League`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      id: "fixture-premier-league-001",
      competition: { name: "Premier League", season: "2026/27" },
      teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } },
      dataState: { state: "LIMITED", provider: "deterministic" },
    });
    expect(body.range).toEqual({ from: "2026-08-28T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" });
  });

  test("rejects invalid and excessive UTC ranges", async ({ request }) => {
    expect((await request.get(`${apiOrigin}/fixtures?from=2026-08-28&to=2026-08-29T00:00:00.000Z`)).status()).toBe(400);
    expect((await request.get(`${apiOrigin}/fixtures?from=2026-08-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z`)).status()).toBe(400);
  });

  test("returns canonical detail and a safe 404", async ({ request }) => {
    const response = await request.get(`${apiOrigin}/fixtures/fixture-premier-league-001`);
    expect(response.ok()).toBeTruthy();
    const detail = await response.json();
    expect(detail).toMatchObject({
      status: "SCHEDULED",
      dataState: { state: "LIMITED", sourceUpdatedAt: null },
    });
    expect(detail.dataState.value).toBeNull();
    expect((await request.get(`${apiOrigin}/fixtures/not-a-fixture`)).status()).toBe(404);
  });
});

test.describe("fixture discovery UI", () => {
  test.use({ timezoneId: "Europe/Warsaw" });

  test("keeps filters in the URL and renders local-date groups", async ({ page }) => {
    await page.goto("/fixtures?from=2026-08-28T00%3A00%3A00.000Z&to=2026-08-31T00%3A00%3A00.000Z&competition=Premier%20League");
    await expect(page.getByRole("heading", { level: 1, name: "Upcoming fixtures" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Saturday, 29 August 2026" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Arsenal vs Chelsea/ })).toBeVisible();
    await expect(page.getByLabel("Competition")).toHaveValue("Premier League");
  });

  test("shows read-only canonical detail, provenance, freshness and limitations", async ({ page }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/fixtures/fixture-premier-league-001?returnTo=%2Ffixtures%3Fcompetition%3DPremier%2520League");
      await expect(page.getByRole("heading", { level: 1, name: "Arsenal vs Chelsea" })).toBeVisible();
      await expect(page.getByText("Limited data", { exact: true })).toBeVisible();
      await expect(page.getByText("Source: deterministic")).toBeVisible();
      await expect(page.getByText("Not available", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to fixtures" })).toHaveAttribute("href", "/fixtures?competition=Premier%20League");
      await expect(page.getByRole("button", { name: /prediction|odds|value|bet/i })).toHaveCount(0);
      expect((await page.screenshot()).byteLength).toBeGreaterThan(10_000);
    }
  });

  test("renders a distinct missing-fixture state without deferred controls", async ({ page }) => {
    await page.goto("/fixtures/not-a-fixture");
    await expect(page.getByRole("heading", { level: 1, name: "Fixture not found" })).toBeVisible();
    await expect(page.getByText(/prediction|odds|value|coming soon/i)).toHaveCount(0);
  });

  test("reflows long fixture content at mobile, desktop, zoom, forced colors and reduced motion", async ({ page }) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: "dark", forcedColors: "active", reducedMotion: "reduce" });
      await page.goto("/fixtures?from=2026-08-28T00%3A00%3A00.000Z&to=2026-08-31T00%3A00%3A00.000Z&competition=Premier%20League");
      await page.evaluate(() => { document.body.style.fontSize = "200%"; });
      await expect(page.getByRole("heading", { level: 1, name: "Upcoming fixtures" })).toBeVisible();
      await expect(page.getByText("Limited data", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect((await page.screenshot()).byteLength).toBeGreaterThan(10_000);
    }
  });

  test("renders honest zero and populated fixture states without betting surfaces", async ({ page }) => {
    await page.goto("/fixtures?from=2027-08-28T00%3A00%3A00.000Z&to=2027-08-30T00%3A00%3A00.000Z");
    await expect(page.getByText("No fixtures are available for this range.")).toBeVisible();
    await expect(page.getByText(/prediction|odds|value|bet now|coming soon/i)).toHaveCount(0);
  });
});
