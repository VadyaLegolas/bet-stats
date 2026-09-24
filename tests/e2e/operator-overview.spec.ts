import { createHash, createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";

import { readLiveReleaseState } from "./live-release-stack.js";

const secret = "phase-06-operations-signing-secret-32-bytes";
const subject = "release-operator";
const canaries = ["secret-token-canary", "raw-payload-canary", "authorization-header-canary", "environment-canary", "stack-trace-canary", "unrestricted-log-canary"];

function signedHeaders(pathname: string, search: string) {
  const timestamp = new Date().toISOString();
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const digest = createHash("sha256").update(new URLSearchParams(pairs).toString()).digest("base64url");
  const signature = createHmac("sha256", secret).update(`${subject}\n${timestamp}\nGET\n${pathname}\n${digest}`).digest("base64url");
  return { "x-operator-subject": subject, "x-operator-timestamp": timestamp, "x-operator-signature": signature };
}

test.beforeAll(async () => {
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.sourceObservation.upsert({ where: { id: "operator-canary-observation" }, update: {}, create: { id: "operator-canary-observation", provider: "operator-canary", endpointFamily: "RESULTS", externalIdentity: "operator-canary", observedAt: new Date(), payloadHash: "sha256:operator-canary", rawPayload: { secret: canaries }, payloadBytes: 128 } });
    await database.syncRun.upsert({ where: { id: "operator-failed-run" }, update: {}, create: { id: "operator-failed-run", logicalKey: "operator-failed-job", revision: 1, provider: "football-data.org", endpointFamily: "RESULTS", lane: "critical", windowFrom: new Date("2026-09-20T10:00:00Z"), windowTo: new Date("2026-09-20T11:00:00Z"), state: "FAILED", correlationId: "corr-operator-failure" } });
    await database.syncAttempt.upsert({ where: { id: "operator-failed-attempt" }, update: {}, create: { id: "operator-failed-attempt", syncRunId: "operator-failed-run", attemptNumber: 1, state: "FAILED", classifiedReason: "UPSTREAM_5XX", startedAt: new Date(), finishedAt: new Date() } });
  } finally { await database.$disconnect(); }
});

for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 320, height: 900 }]] as const) {
  test(`${name} renders the ordered secret-safe operations center`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const search = "?page=1&pageSize=25&windowHours=24";
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/operations/overview", search));
    await page.goto(`/internal/operations${search}`);
    await expect(page.getByRole("heading", { level: 1, name: "Operations center" })).toBeVisible();
    const headings = await page.locator("main h2").allTextContents();
    expect(headings).toEqual(["System readiness", "Provider health", "Quota consumption", "Failed and dead-lettered work", "Data-quality errors", "Recent incidents"]);
    await expect(page.getByText(/Last checked/).first()).toBeVisible();
    await expect(page.getByText("UPSTREAM_5XX").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy correlation ID corr-operator-failure" }).first()).toBeVisible();
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const canary of canaries) expect(body).not.toContain(canary);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
