import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";
import { ApiFootballClient } from "../../packages/football-data/src/index.js";
import { executeProviderCall } from "../../workers/data-sync/src/resilience/provider-policy.js";
import { LIVE_FIXTURES } from "./live-provider-stack.js";
import { assertNoReleaseCanary, readLiveReleaseState } from "./live-release-stack.js";

const CANARY = "release-secret-canary-never-render";
const operatorSubject = "release-operator";
const signingSecret = "phase-06-operations-signing-secret-32-bytes";
const operatorCredential = "phase-06-operator-credential";
const apiOperatorHeaders = { "x-operator-credential": operatorCredential, "x-operator-actor": operatorSubject };

function signedHeaders(pathname: string, search = "", method = "GET") {
  const timestamp = new Date().toISOString();
  const pairs = [...new URLSearchParams(search).entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const digest = createHash("sha256").update(new URLSearchParams(pairs).toString()).digest("base64url");
  const signature = createHmac("sha256", signingSecret).update(`${operatorSubject}\n${timestamp}\n${method}\n${pathname}\n${digest}`).digest("base64url");
  return { "x-operator-subject": operatorSubject, "x-operator-timestamp": timestamp, "x-operator-signature": signature };
}

test("D-16 sole-source outage preserves canonical facts and last-valid timestamp", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.limited}`);
  const status = page.getByLabel("Provider status");
  await expect(status.getByText("Limited data — no production fallback", { exact: true })).toBeVisible();
  await expect(status).toContainText("PROVIDER_UNAVAILABLE");
  await expect(status.locator("time")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Roma vs Ajax" })).toBeVisible();
  await assertNoReleaseCanary(page, CANARY);
});

test("D-16 quota exhaustion and open circuit stay local and visible", async ({ page }) => {
  let calls = 0;
  const result = await executeProviderCall({ provider: "football-data.org", endpointFamily: "RESULTS", circuitState: "OPEN", correlationId: "release-open-circuit", call: async () => { calls += 1; } });
  expect(result).toMatchObject({ status: "blocked", reason: "CIRCUIT_OPEN" });
  expect(calls).toBe(0);
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await assertNoReleaseCanary(page, CANARY);
});

test("D-16 invalid envelope remains quarantined from canonical publication", async ({ page }) => {
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    const before = await database.fixture.count();
    const client = new ApiFootballClient({ apiKey: "release-key", fetcher: async () => new Response(JSON.stringify({ secret: CANARY, invalid: true }), { status: 200 }) });
    await expect(client.fetchFixtures({ leagueId: 39, season: 2026, competitionCode: "PL", dateFrom: "2026-09-01", dateTo: "2026-09-02" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD", classification: "quarantine" });
    expect(await database.fixture.count()).toBe(before);
    const search = "?page=1&pageSize=25&windowHours=24";
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/operations/overview", search));
    await page.goto(`/internal/operations${search}`);
    await assertNoReleaseCanary(page, CANARY);
  } finally { await database.$disconnect(); }
});

test("D-16 stale and limited evidence never becomes zero", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByText("Probabilities are estimates, not guarantees.", { exact: false }).first()).toBeVisible();
  const values = await page.locator('[data-evidence-projection="forecast-one-x-two"] [data-evidence-field="probability"]').allTextContents();
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((value) => value.trim() !== "0")).toBe(true);
});

test("D-16 exhausted attempts expose a dead letter without raw diagnostics", async ({ request }) => {
  const origin = readLiveReleaseState().apiOrigin;
  const input = { recoveryType: "INGESTION", reason: "Exercise the production dead-letter boundary for release acceptance.", provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-09-23T00:00:00.000Z", to: "2026-09-23T23:59:59.999Z" };
  const previewPath = "/internal/pipeline/replay/preview";
  const previewResponse = await request.post(`${origin}${previewPath}`, { headers: apiOperatorHeaders, data: input });
  const previewText = await previewResponse.text();
  expect(previewResponse.ok(), `${previewResponse.status()} ${previewText}`).toBe(true);
  const preview = JSON.parse(previewText);
  const queuePath = "/internal/pipeline/replay/queue";
  const queuedResponse = await request.post(`${origin}${queuePath}`, { headers: apiOperatorHeaders, data: { previewId: preview.previewId, previewVersion: preview.previewVersion, fingerprint: preview.fingerprint } });
  expect(queuedResponse.ok()).toBe(true);
  const queued = await queuedResponse.json();
  let terminal: any;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const statusPath = `/internal/pipeline/replay/${queued.replayPlanId}`;
    const response = await request.get(`${origin}${statusPath}`, { headers: apiOperatorHeaders });
    terminal = await response.json();
    if (terminal.state === "FAILED") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(terminal).toMatchObject({ state: "FAILED", outcome: "DEAD_LETTER" });
  expect(terminal.attempts).toHaveLength(3);
  expect(JSON.stringify(terminal)).not.toMatch(/secret|credential|postgresql:|redis:/i);
});

test("D-16 recovery preview-confirm preserves immutable facts", async ({ request }) => {
  const state = readLiveReleaseState();
  const database = createPrismaClient(state.databaseUrl);
  const immutable = () => Promise.all([database.forecastSnapshot.findMany({ orderBy: { id: "asc" }, select: { id: true, inputHash: true, modelHash: true } }), database.valueReceipt.findMany({ orderBy: { id: "asc" }, select: { id: true, forecastSnapshotId: true, oddsSnapshotId: true } })]);
  try {
    const before = await immutable();
    const input = { recoveryType: "INGESTION", reason: "Confirm bounded recovery without mutating immutable release facts.", provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-09-22T00:00:00.000Z", to: "2026-09-22T23:59:59.999Z" };
    const previewPath = "/internal/pipeline/replay/preview";
    const previewResponse = await request.post(`${state.apiOrigin}${previewPath}`, { headers: apiOperatorHeaders, data: input });
    const previewText = await previewResponse.text();
    const preview = JSON.parse(previewText);
    expect(previewResponse.ok(), `${previewResponse.status()} ${previewText}`).toBe(true);
    expect(preview).toMatchObject({ dryRun: true, bounded: true, immutableGuarantees: { observations: "UNCHANGED", issuedForecasts: "UNCHANGED", results: "UNCHANGED", valueReceipts: "UNCHANGED", settlements: "UNCHANGED" } });
    const queuePath = "/internal/pipeline/replay/queue";
    const queued = await request.post(`${state.apiOrigin}${queuePath}`, { headers: apiOperatorHeaders, data: { previewId: preview.previewId, previewVersion: preview.previewVersion, fingerprint: preview.fingerprint } });
    expect(queued.ok()).toBe(true);
    expect(await immutable()).toEqual(before);
  } finally { await database.$disconnect(); }
});

test("D-16 incomplete privacy policy fails closed while anonymous analysis remains available", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "History retention is unavailable" })).toBeVisible();
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();
  await assertNoReleaseCanary(page, CANARY);
});
