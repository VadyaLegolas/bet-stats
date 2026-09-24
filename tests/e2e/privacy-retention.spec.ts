import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../packages/database/src/index.js";
import { readLiveReleaseState } from "./live-release-stack.js";

const subjectId = "release-privacy-subject";
const signingSecret = "phase-06-privacy-signing-secret-32-bytes";

function projectSubject(projectName: string) {
  return `${subjectId}-${projectName}`;
}

function subjectHeaders(activeSubjectId: string) {
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", signingSecret).update(`${activeSubjectId}\n${timestamp}`).digest("base64url");
  return { "x-privacy-subject": activeSubjectId, "x-privacy-timestamp": timestamp, "x-privacy-signature": signature };
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders(subjectHeaders(projectSubject(testInfo.project.name)));
});

test("retention starts off, requires explicit consent, and cancellation keeps consent", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy and retained history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "History retention is off", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Allow retention/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Allow retention/ }).click();
  await expect(page.getByText("History retention is on")).toBeVisible();
  await page.getByRole("button", { name: "Withdraw consent and delete history" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete retained betting history?" });
  await expect(dialog.getByRole("heading")).toBeFocused();
  await dialog.getByRole("button", { name: "Keep consent" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Withdraw consent and delete history" })).toBeFocused();
  await expect(page.getByText("History retention is on")).toBeVisible();
});

test("withdrawal reports success only after deletion and future retention is denied", async ({ page, request }, testInfo) => {
  const activeSubjectId = projectSubject(testInfo.project.name);
  await page.goto("/privacy");
  if (await page.getByRole("heading", { name: "History retention is off", exact: true }).isVisible()) await page.getByRole("checkbox", { name: /Allow retention/ }).click();
  const retained = await request.post(`${readLiveReleaseState().webOrigin}/internal-api/privacy/history/view`, {
    headers: subjectHeaders(activeSubjectId), data: { resourceType: "RESULT", resourceId: "live-comparison-fixture" },
  });
  expect(retained.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Withdraw consent and delete history" }).click();
  await page.getByRole("button", { name: "Delete history and withdraw consent" }).click();
  await expect(page.getByRole("heading", { name: "Consent withdrawn" })).toBeFocused();
  await expect(page.getByText("Consent withdrawn. Retained betting history was deleted and future retention is off.")).toBeVisible();
  const database = createPrismaClient(readLiveReleaseState().databaseUrl);
  try {
    expect(await database.retainedViewHistory.count({ where: { subjectId: activeSubjectId } })).toBe(0);
    expect((await database.retentionSubject.findUniqueOrThrow({ where: { id: activeSubjectId } })).retentionBlockedAt).not.toBeNull();
  } finally { await database.$disconnect(); }
  const denied = await request.post(`${readLiveReleaseState().webOrigin}/internal-api/privacy/history/view`, {
    headers: subjectHeaders(activeSubjectId), data: { resourceType: "RESULT", resourceId: "live-comparison-fixture" },
  });
  expect(denied.status()).toBe(409);
});

test("missing subject assertion fails closed while ordinary analysis remains available", async ({ browser }, testInfo) => {
  const page = await browser.newPage();
  await page.goto("/privacy");
  await expect(page.getByText("History retention is unavailable until the retention policy is complete")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Allow retention/ })).toBeDisabled();
  if (testInfo.project.name === "mobile-chromium") await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Fixtures" })).toBeVisible();
  await page.close();
});
