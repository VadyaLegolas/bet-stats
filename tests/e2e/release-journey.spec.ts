import { expect, test } from "@playwright/test";
import { createPrismaClient, SETTLEMENT_PIPELINE_POLICY_HASH } from "../../packages/database/src/index.js";
import { createSettlementQueue } from "../../workers/data-sync/src/queues/index.js";
import { LIVE_FIXTURES } from "./live-provider-stack.js";
import { readLiveReleaseState } from "./live-release-stack.js";

const fixtureId = LIVE_FIXTURES.comparison;
const headers = {
  "x-eligibility-region": "PL",
  "x-age-acknowledged": "true",
  "x-eligibility-checked-at": new Date().toISOString(),
};

test("D-15 crosses fixture, forecast, manual odds, value, result, settlement and scorecard boundaries", async ({ page, request }) => {
  const state = readLiveReleaseState();
  let intercepted = 0;
  page.on("request", (request) => { if (request.isNavigationRequest() && request.url().startsWith("data:")) intercepted += 1; });

  await page.goto(`/fixtures/${fixtureId}`);
  const forecastId = await page.getByLabel("Forecast snapshot").inputValue();
  expect(forecastId).toMatch(/^forecast-/);
  await page.getByLabel("Market").selectOption("ONE_X_TWO");
  await page.getByLabel("Bookmaker or source label").fill("Release acceptance bookmaker");
  await page.getByLabel("Home decimal odds").fill("4");
  await page.getByLabel("Draw decimal odds").fill("2");
  await page.getByLabel("Away decimal odds").fill("2");
  await page.getByRole("button", { name: "Save complete immutable odds book" }).click();
  const oddsStatus = page.getByRole("status").filter({ hasText: "Immutable odds snapshot" });
  await expect(oddsStatus).toBeVisible();
  const oddsId = (await oddsStatus.textContent())?.match(/snapshot ([a-f0-9-]+) saved/i)?.[1];
  expect(oddsId).toBeTruthy();

  const valueResponsePromise = page.waitForResponse((response) => response.url().includes(`/internal-api/fixtures/${fixtureId}/value`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Compare exact snapshots" }).click();
  const valueResponse = await valueResponsePromise;
  expect(valueResponse.ok()).toBeTruthy();
  const value = await valueResponse.json() as { id: string; forecastSnapshotId: string; oddsSnapshotId: string; outcome: string };
  expect(value).toMatchObject({ forecastSnapshotId: forecastId, oddsSnapshotId: oddsId, outcome: "VALUE_CANDIDATE" });
  await page.getByText("Exact immutable decision receipt").click();
  await expect(page.locator("pre").filter({ hasText: `\"id\": \"${value.id}\"` })).toBeVisible();

  const database = createPrismaClient(state.databaseUrl);
  const resultId = "release-result-v1";
  try {
    await database.fixture.update({ where: { id: fixtureId }, data: { status: "FINISHED" } });
    await database.sourceObservation.create({ data: { id: "release-result-observation", provider: "release-acceptance", endpointFamily: "RESULTS", externalIdentity: fixtureId, observedAt: new Date("2026-09-21T17:00:00.000Z"), payloadHash: "sha256:release-result-v1", rawPayload: { home: 2, away: 1 }, payloadBytes: 19 } });
    await database.resultVersion.create({ data: { id: resultId, fixtureId, observationId: "release-result-observation", effectiveAt: new Date("2026-09-21T15:00:00.000Z"), observedAt: new Date("2026-09-21T17:00:00.000Z"), homeGoals: 2, awayGoals: 1, status: "FINISHED", revision: 1 } });
    const queue = createSettlementQueue({ redisUrl: state.redisUrl, prefix: state.workerPrefix });
    await queue.enqueue({ fixtureId, resultVersionId: resultId, forecastSnapshotId: forecastId, policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId: "release-journey" });
    await queue.close();
    await expect.poll(async () => database.settlementReceipt.count({ where: { resultVersionId: resultId, forecastSnapshotId: forecastId } }), { timeout: 30_000 }).toBe(1);
    await expect.poll(async () => database.forecastScore.count({ where: { forecastSnapshotId: forecastId } }), { timeout: 30_000 }).toBe(1);
    const settlement = await database.settlementReceipt.findFirstOrThrow({ where: { resultVersionId: resultId, forecastSnapshotId: forecastId } });
    const score = await database.forecastScore.findFirstOrThrow({ where: { settlementReceiptId: settlement.id } });
    expect(score.fixtureId).toBe(fixtureId);
  } finally {
    await database.$disconnect();
  }

  const query = new URLSearchParams({ modelVersion: "poisson-ensemble-v1", competitionId: "live-pl", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }).toString();
  const scorecardResponse = await request.get(`${state.apiOrigin}/evaluation/scorecard?${query}`, { headers });
  expect(scorecardResponse.ok()).toBeTruthy();
  const scorecard = await scorecardResponse.json() as { denominators: { fixtureCount: number; forecastCount: number; eventCount: number; valueCount: number } };
  expect(scorecard.denominators).toEqual({ fixtureCount: 1, forecastCount: 1, eventCount: 3, valueCount: 1 });
  await page.goto(`/scorecards?${query}`);
  await expect(page.getByRole("heading", { name: "Limited evidence" })).toBeVisible();
  await expect(page.getByText("1 fixtures · 1 forecasts · 3 probability events · 1 value candidates")).toBeVisible();
  expect(intercepted).toBe(0);
});
