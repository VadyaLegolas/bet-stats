import { expect, test } from "@playwright/test";
import setup, { AVAILABLE_QUERY, EVALUATION_API_ORIGIN, EVALUATION_BOUNDS, EVALUATION_WEB_ORIGIN, LIMITED_QUERY, teardown, UNAVAILABLE_QUERY } from "./live-evaluation-stack";

const headers = { "x-eligibility-region": "PL", "x-age-acknowledged": "true", "x-eligibility-checked-at": new Date().toISOString() };
type Scorecard = { health: { state: string }; denominators: { fixtureCount: number; forecastCount: number; eventCount: number; valueCount: number }; metrics: { meanBrierScore: number; meanLogLoss: number }; reliability: { buckets: Array<{ count: number }> }; financial: { count: number; totalStakedUnits: string; totalProfitUnits: string }; clv: { status: string; comparableCount: number } };

test.beforeAll(async () => { test.setTimeout(240_000); await setup(); });
test.afterAll(async () => { await teardown(); });

test("EVAL-01..07 production API, DOM and accessible ledger reconcile exactly", async ({ page, request }) => {
  const response = await request.get(`${EVALUATION_API_ORIGIN}/evaluation/scorecard?${AVAILABLE_QUERY}`, { headers });
  expect(response.ok()).toBeTruthy(); const api = await response.json() as Scorecard;
  expect(api.health.state).toBe("AVAILABLE"); expect(api.denominators).toEqual({ fixtureCount: 50, forecastCount: 50, eventCount: 150, valueCount: 30 });

  await page.goto(`${EVALUATION_WEB_ORIGIN}/scorecards?${AVAILABLE_QUERY}`);
  await expect(page.getByRole("heading", { name: "Qualified evidence" })).toBeVisible();
  await expect(page.getByText(`${api.denominators.fixtureCount} fixtures · ${api.denominators.forecastCount} forecasts · ${api.denominators.eventCount} probability events · ${api.denominators.valueCount} value candidates`)).toBeVisible();
  await expect(page.getByText(`Brier score: ${api.metrics.meanBrierScore.toFixed(4)}`)).toBeVisible();
  await expect(page.getByText(`Log Loss: ${api.metrics.meanLogLoss.toFixed(4)}`)).toBeVisible();
  await expect(page.getByText(`${api.financial.count} settled candidates · ${api.financial.totalStakedUnits} units evaluated · ${api.financial.totalProfitUnits} units result`)).toBeVisible();
  const bucketCounts = await page.getByRole("table", { name: "Reliability evidence table" }).locator("tbody tr td:nth-child(4)").allTextContents();
  expect(bucketCounts.map(Number).reduce((sum, count) => sum + count, 0)).toBe(api.denominators.eventCount);
  const firstIds = await page.getByRole("heading", { name: "Candidate ledger" }).locator("..").locator("tbody tr").count();
  expect(firstIds).toBe(25); await page.getByRole("link", { name: "Next" }).click();
  await expect(page.getByText("Page totals: 5 candidates, 5 units staked, 7 units profit.")).toBeVisible();
});

test("EVAL-05/EVAL-07/EVAL-08 preserves canonical exact unavailable and limited cohorts", async ({ page }) => {
  await page.goto(`${EVALUATION_WEB_ORIGIN}/scorecards?from=${encodeURIComponent(EVALUATION_BOUNDS.from)}&to=${encodeURIComponent(EVALUATION_BOUNDS.to)}`);
  await expect(page).toHaveURL(new RegExp(`modelVersion=acceptance-v1.*competitionId=evaluation-league.*market=ONE_X_TWO`));
  await page.goto(`${EVALUATION_WEB_ORIGIN}/scorecards?${LIMITED_QUERY}`); await expect(page.getByRole("heading", { name: "Limited evidence" })).toBeVisible(); await expect(page.getByText(/Sample thresholds are not met/)).toBeVisible();
  await page.goto(`${EVALUATION_WEB_ORIGIN}/scorecards?${UNAVAILABLE_QUERY}`); await expect(page.getByRole("heading", { name: "Evidence unavailable" })).toBeVisible(); await expect(page.getByText(/Filters were not broadened/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp("modelVersion=missing-v1"));
});

test("T-04-07-01/T-04-07-03 keeps health-first responsible copy keyboard-accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${EVALUATION_WEB_ORIGIN}/scorecards?${AVAILABLE_QUERY}`);
  const health = page.getByRole("heading", { name: "Qualified evidence" }); const scores = page.getByRole("heading", { name: "Proper scores" });
  expect((await health.boundingBox())!.y).toBeLessThan((await scores.boundingBox())!.y);
  await expect(page.getByText("This is analytical evidence, not betting advice.")).toBeVisible();
  await page.getByRole("button", { name: "Apply exact cohort" }).focus(); await expect(page.getByRole("button", { name: "Apply exact cohort" })).toBeFocused();
  await page.getByText("Formula and policy receipts").click(); await expect(page.getByText(/sha256:/).first()).toBeVisible();
  await expect(page.getByText(/guaranteed profit|place this bet|sure win/i)).toHaveCount(0);
});
