import { createHash, createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";
import { readLiveReleaseState } from "./live-release-stack.js";

const operatorSubject = "release-operator";
const signingSecret = "phase-06-operations-signing-secret-32-bytes";
function signedHeaders(pathname: string, method: "GET" | "POST") {
  const timestamp = new Date().toISOString();
  const digest = createHash("sha256").update("").digest("base64url");
  const signature = createHmac("sha256", signingSecret).update(`${operatorSubject}\n${timestamp}\n${method}\n${pathname}\n${digest}`).digest("base64url");
  return { "x-operator-subject": operatorSubject, "x-operator-timestamp": timestamp, "x-operator-signature": signature };
}

test.beforeAll(async () => {
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "CLOSED" }, update: { state: "CLOSED", updatedAt: new Date() } });
  } finally { await database.$disconnect(); }
});

async function completeIngestionPreview(page: import("@playwright/test").Page) {
  await page.goto("/internal/pipeline/replay");
  await page.getByLabel("Recovery reason").fill("Recover the exact result window after the audited provider interruption.");
  await page.getByLabel("Recovery domain").selectOption("INGESTION");
  await page.getByLabel("Endpoint family").selectOption("RESULTS");
  await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/preview", "POST"));
  await page.getByRole("button", { name: "Preview recovery impact" }).click();
  await expect(page.getByRole("heading", { name: "Recovery impact" })).toBeVisible();
}

test("preview, impact review and confirmation preserve focus and expose frozen recovery facts", async ({ page }) => {
  await completeIngestionPreview(page);
  await expect(page.getByText("Exact scope")).toBeVisible();
  await expect(page.getByText("Quota effect")).toBeVisible();
  await expect(page.getByText("Immutable guarantees")).toBeVisible();
  await expect(page.getByText("Preview expiry")).toBeVisible();

  const trigger = page.getByRole("button", { name: "Review and confirm recovery" });
  await trigger.click();
  await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/queue", "POST"));
  const dialog = page.getByRole("dialog", { name: "Queue recovery for the exact scope shown?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const confirm = dialog.getByRole("button", { name: "Confirm and queue recovery" });
  await confirm.click();
  await expect(page.getByText(/Recovery queued\. Correlation ID: .+\. Existing immutable facts were not changed\./)).toBeVisible();
  await expect(page.getByText("Plan ID")).toBeVisible();
  await expect(page.getByText("Queued", { exact: true }).or(page.getByText("Existing plan", { exact: true }))).toBeVisible();
});

test("stale confirmation returns to preview without permitting direct queue", async ({ page }) => {
  await completeIngestionPreview(page);
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN" }, update: { state: "OPEN", updatedAt: new Date() } });
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/queue", "POST"));
    await page.getByRole("button", { name: "Review and confirm recovery" }).click();
    await page.getByRole("button", { name: "Confirm and queue recovery" }).click();
    await expect(page.getByText("This preview is no longer current. Preview recovery again.")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "Preview recovery impact" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Review and confirm recovery" })).toBeDisabled();
  } finally {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "CLOSED" }, update: { state: "CLOSED", updatedAt: new Date() } }).catch(() => undefined);
    await database.$disconnect();
  }
});
