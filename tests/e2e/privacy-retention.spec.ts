import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";
import { createTrustedSessionAssertion } from "../../apps/web/app/internal-api/privacy/[[...path]]/route.js";
import { readLiveReleaseState } from "./live-release-stack.js";

const subjectId = "release-privacy-subject";
const authSessionSecret = "phase-06-auth-session-secret-32-bytes";

function projectSubject(projectName: string) {
  return `${subjectId}-${projectName}`;
}

function authenticatedSession(activeSubjectId: string, sessionId = `session_${activeSubjectId.replace(/[^A-Za-z0-9_-]/g, "_")}`) {
  return createTrustedSessionAssertion({
    secret: authSessionSecret,
    subjectId: activeSubjectId,
    sessionId,
    expiresAt: Date.now() + 60_000,
  });
}

async function establishPrivacySession(page: import("@playwright/test").Page, activeSubjectId: string) {
  const webOrigin = readLiveReleaseState().webOrigin;
  await page.context().addCookies([{ name: "auth_session", value: authenticatedSession(activeSubjectId), url: webOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
  await page.goto(webOrigin);
  expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/session", { method: "POST" })).status)).toBe(201);
}

test("release runtime can import the trusted privacy-session boundary", () => {
  expect(authenticatedSession("release-runtime-import")).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
});

test.beforeEach(async ({ page }, testInfo) => establishPrivacySession(page, projectSubject(testInfo.project.name)));

test("retention starts off, requires explicit consent, and cancellation keeps consent", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Конфиденциальность и сохранённая история" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Хранение истории отключено", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Разрешить хранение/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Разрешить хранение/ }).click();
  await expect(page.getByText("Хранение истории включено")).toBeVisible();
  await page.getByRole("button", { name: "Отозвать согласие и удалить историю" }).click();
  const dialog = page.getByRole("dialog", { name: "Удалить сохранённую историю ставок?" });
  await expect(dialog.getByRole("heading")).toBeFocused();
  await dialog.getByRole("button", { name: "Оставить согласие" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Отозвать согласие и удалить историю" })).toBeFocused();
  await expect(page.getByText("Хранение истории включено")).toBeVisible();
});

test("withdrawal reports success only after deletion and future retention is denied", async ({ page }, testInfo) => {
  const activeSubjectId = projectSubject(testInfo.project.name);
  await page.goto("/privacy");
  if (await page.getByRole("heading", { name: "Хранение истории отключено", exact: true }).isVisible()) await page.getByRole("checkbox", { name: /Разрешить хранение/ }).click();
  expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/history/view", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceType: "RESULT", resourceId: "live-comparison-fixture" }),
  })).status)).toBe(201);
  await page.getByRole("button", { name: "Отозвать согласие и удалить историю" }).click();
  await page.getByRole("button", { name: "Удалить историю и отозвать согласие" }).click();
  await expect(page.getByRole("heading", { name: "Согласие отозвано" })).toBeFocused();
  await expect(page.getByText("Согласие отозвано. Сохранённая история ставок удалена, будущее хранение отключено.")).toBeVisible();
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    expect(await database.retainedViewHistory.count({ where: { subjectId: activeSubjectId } })).toBe(0);
    expect((await database.retentionSubject.findUniqueOrThrow({ where: { id: activeSubjectId } })).retentionBlockedAt).not.toBeNull();
  } finally { await database.$disconnect(); }
  expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/history/view", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceType: "RESULT", resourceId: "live-comparison-fixture" }),
  })).status)).toBe(409);
});

test("D-15 rejects retired direct and cross-subject privacy sessions", async ({ browser }, testInfo) => {
  const webOrigin = readLiveReleaseState().webOrigin;
  const ownerSubject = projectSubject(testInfo.project.name);
  const victimSubject = `${ownerSubject}-victim`;
  const legacySignature = createHmac("sha256", "phase-06-privacy-session-secret-32-bytes").update(`privacy-session\n${ownerSubject}`).digest("base64url");
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await context.addCookies([{ name: "privacy_session", value: `${ownerSubject}.${legacySignature}`, url: webOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    await page.goto(webOrigin);
    expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/status")).status)).toBe(400);

    await context.addCookies([{ name: "auth_session", value: authenticatedSession(ownerSubject), url: webOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/session", { method: "POST" })).status)).toBe(201);
    await context.addCookies([{ name: "auth_session", value: authenticatedSession(victimSubject), url: webOrigin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    expect(await page.evaluate(async () => (await fetch("/internal-api/privacy/status")).status)).toBe(400);
  } finally {
    await context.close();
  }
});

test("missing subject assertion fails closed while ordinary analysis remains available", async ({ browser }, testInfo) => {
  const page = await browser.newPage();
  await page.goto("/privacy");
  await expect(page.getByText("Хранение истории недоступно, пока политика хранения не завершена")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Разрешить хранение/ })).toBeDisabled();
  if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "Меню" }).click();
  await expect(page.getByRole("link", { name: "Матчи" })).toBeVisible();
  await page.close();
});
