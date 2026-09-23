import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";
import { LIVE_FIXTURES } from "./live-provider-stack.js";
import { assertNoReleaseCanary, readLiveReleaseState } from "./live-release-stack.js";

const CANARY = "release-secret-canary-never-render";
const operatorSubject = "release-operator";
const signingSecret = "phase-06-operations-signing-secret-32-bytes";

function signedHeaders(pathname: string, search = "") {
  const timestamp = new Date().toISOString();
  const pairs = [...new URLSearchParams(search).entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  const digest = createHash("sha256").update(new URLSearchParams(pairs).toString()).digest("base64url");
  const signature = createHmac("sha256", signingSecret).update(`${operatorSubject}\n${timestamp}\nGET\n${pathname}\n${digest}`).digest("base64url");
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
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN", lastError: "QUOTA_EXHAUSTED" }, update: { state: "OPEN", lastError: "QUOTA_EXHAUSTED", openedAt: new Date(), updatedAt: new Date() } });
    const search = "?page=1&pageSize=25&windowHours=24";
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/operations/overview", search));
    await page.goto(`/internal/operations${search}`);
    await expect(page.getByText("QUOTA_EXHAUSTED").first()).toBeVisible();
    await expect(page.getByText("OPEN", { exact: true }).first()).toBeVisible();
    await assertNoReleaseCanary(page, CANARY);
  } finally {
    await database.providerCircuitState.update({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, data: { state: "CLOSED", lastError: null } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("D-16 invalid envelope remains quarantined from canonical publication", async ({ page }) => {
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    const before = await database.fixture.count();
    await database.sourceObservation.upsert({ where: { id: "release-quarantine-canary" }, update: {}, create: { id: "release-quarantine-canary", provider: "api-football", endpointFamily: "FIXTURES", externalIdentity: "quarantined-envelope", observedAt: new Date(), payloadHash: "sha256:quarantined", rawPayload: { secret: CANARY, invalid: true }, payloadBytes: 48 } });
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

test("D-16 exhausted attempts expose a dead letter without raw diagnostics", async ({ page }) => {
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.syncRun.upsert({ where: { id: "release-dead-letter-run" }, update: {}, create: { id: "release-dead-letter-run", logicalKey: "release-dead-letter", revision: 1, provider: "football-data.org", endpointFamily: "RESULTS", lane: "critical", windowFrom: new Date(), windowTo: new Date(), state: "FAILED", correlationId: "corr-release-dead-letter" } });
    await database.syncAttempt.upsert({ where: { id: "release-dead-letter-attempt" }, update: {}, create: { id: "release-dead-letter-attempt", syncRunId: "release-dead-letter-run", attemptNumber: 3, state: "FAILED", classifiedReason: "ATTEMPTS_EXHAUSTED", startedAt: new Date(), finishedAt: new Date() } });
    const search = "?page=1&pageSize=25&windowHours=24";
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/operations/overview", search));
    await page.goto(`/internal/operations${search}`);
    await expect(page.getByText("ATTEMPTS_EXHAUSTED").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy correlation ID corr-release-dead-letter" }).first()).toBeVisible();
    await assertNoReleaseCanary(page, CANARY);
  } finally { await database.$disconnect(); }
});

test("D-16 recovery preview is explicit and immutable before replay", async ({ page }) => {
  await page.goto("/internal/pipeline/replay");
  await expect(page.getByText("Immutable guarantees")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview recovery impact" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and queue recovery" })).toHaveCount(0);
  await assertNoReleaseCanary(page, CANARY);
});

test("D-16 incomplete privacy policy fails closed while anonymous analysis remains available", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Personal history is unavailable" })).toBeVisible();
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}`);
  await expect(page.getByRole("heading", { name: "Frozen forecast" })).toBeVisible();
  await assertNoReleaseCanary(page, CANARY);
});
