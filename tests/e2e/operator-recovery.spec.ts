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
  await page.getByLabel("Причина восстановления").fill("Recover the exact result window after the audited provider interruption.");
  await page.getByLabel("Область восстановления").selectOption("INGESTION");
  await page.getByLabel("Группа эндпоинтов").selectOption("RESULTS");
  await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/preview", "POST"));
  await page.getByRole("button", { name: "Предпросмотр влияния восстановления" }).click();
  await expect(page.getByRole("heading", { name: "Влияние восстановления" })).toBeVisible();
}

test("preview, impact review and confirmation preserve focus and expose frozen recovery facts", async ({ page }) => {
  await completeIngestionPreview(page);
  await expect(page.getByText("Точная область")).toBeVisible();
  await expect(page.getByText("Влияние на квоту")).toBeVisible();
  await expect(page.getByText("Неизменяемые гарантии")).toBeVisible();
  await expect(page.getByText("Срок действия предпросмотра")).toBeVisible();

  const trigger = page.getByRole("button", { name: "Проверить и подтвердить восстановление" });
  await trigger.click();
  await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/queue", "POST"));
  const dialog = page.getByRole("dialog", { name: "Поставить в очередь восстановление для показанной точной области?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const confirm = dialog.getByRole("button", { name: "Подтвердить и поставить в очередь" });
  await confirm.click();
  await expect(page.getByText(/Восстановление поставлено в очередь\. Корреляционный ID: .+\. Существующие неизменяемые факты не изменены\./)).toBeVisible();
  await expect(page.getByText("ID плана")).toBeVisible();
  await expect(page.getByText("В очереди", { exact: true }).or(page.getByText("Существующий план", { exact: true }))).toBeVisible();
});

test("stale confirmation returns to preview without permitting direct queue", async ({ page }) => {
  await completeIngestionPreview(page);
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN" }, update: { state: "OPEN", updatedAt: new Date() } });
    await page.setExtraHTTPHeaders(signedHeaders("/internal-api/pipeline/replay/queue", "POST"));
    await page.getByRole("button", { name: "Проверить и подтвердить восстановление" }).click();
    await page.getByRole("button", { name: "Подтвердить и поставить в очередь" }).click();
    await expect(page.getByText("Этот предпросмотр больше не актуален. Повторите предпросмотр восстановления.")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "Предпросмотр влияния восстановления" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Проверить и подтвердить восстановление" })).toBeDisabled();
  } finally {
    await database.providerCircuitState.upsert({ where: { provider_endpointFamily: { provider: "football-data.org", endpointFamily: "RESULTS" } }, create: { provider: "football-data.org", endpointFamily: "RESULTS", state: "CLOSED" }, update: { state: "CLOSED", updatedAt: new Date() } }).catch(() => undefined);
    await database.$disconnect();
  }
});
