import { expect, test } from "@playwright/test";

const reviewCase = { id: "case-1", version: 1, provider: "provider <script>alert(1)</script>", externalId: "external-1", incomingSnapshot: { name: "<img src=x onerror=alert(1)>" }, openedAt: "2026-01-01T00:00:00.000Z", candidates: [{ id: "candidate-1", canonicalEntityId: "team-1", confidence: 0.82, method: "MANUAL_REVIEW", evidence: { normalized: "arsenal" }, createdAt: "2026-01-01T00:00:00.000Z" }], decisions: [] };

test.beforeEach(async ({ page }) => {
  await page.route("**/internal-api/reconciliation/case-1/suggestions", (route) => route.fulfill({ json: { items: [{ provider: "THESPORTSDB", capturedAt: "2026-09-13T10:00:00.000Z", externalId: "133604", name: "Arsenal FC", aliases: ["The Gunners"], logoRef: null }] } }));
  await page.route("**/internal-api/reconciliation**", async (route) => {
    if (route.request().url().endsWith("/suggestions")) return route.fallback();
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [reviewCase], nextCursor: null } });
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { decision: { id: `decision-${body.kind ?? "saved"}`, action: body.kind === "reject-create" ? "CREATE" : "LINK", actor: "operator", evidence: { note: body.note }, canonicalEntityId: body.canonicalEntityId ?? "team-1", decidedAt: "2026-01-01T01:00:00.000Z", confidence: 1 }, version: 2 } });
  });
});

test("keeps TheSportsDB suggestions separate from reconciliation decisions", async ({ page }) => {
  await page.goto("/internal/reconciliation");
  await expect(page.getByText(/review aids only/i)).toBeVisible();
  await page.getByRole("button", { name: "Use as review input" }).click();
  await expect(page.getByLabel("New canonical name")).toHaveValue("Arsenal FC");
  await expect(page.getByText("Decision recorded", { exact: true })).toHaveCount(0);
});

test("renders escaped evidence and keeps review absent from public navigation", async ({ page }) => {
  await page.goto("/internal/reconciliation");
  await expect(page.getByRole("heading", { name: "Ambiguity review queue" })).toBeVisible();
  await expect(page.getByText("provider <script>alert(1)</script>")).toBeVisible();
  expect(await page.locator("script").allTextContents()).not.toContain("alert(1)");
  await page.goto("/");
  await expect(page.getByRole("navigation")).not.toContainText("Review");
});

test("validates evidence, records approve, manual link, create and correction actions", async ({ page }) => {
  await page.goto("/internal/reconciliation");
  await page.getByRole("radio", { name: /team-1/ }).check();
  await page.getByRole("button", { name: "Approve selected match" }).click();
  await expect(page.getByText(/Evidence note must contain at least 10/)).toBeVisible();
  await page.getByLabel("Evidence note").fill("Compared against official source");
  await page.getByRole("button", { name: "Approve selected match" }).click();
  await expect(page.getByText("Decision recorded", { exact: true })).toBeVisible();

  await page.getByLabel("Manual canonical entity ID").fill("team-manual");
  await page.getByRole("button", { name: "Link manually" }).click();
  await expect(page.getByText("Decision recorded", { exact: true })).toBeVisible();
  await page.getByLabel("New canonical name").fill("New Team");
  await page.getByLabel("Country code").fill("PL");
  await page.getByRole("button", { name: "Reject all and create canonical" }).click();
  await expect(page.getByRole("dialog")).toContainText("Create a new canonical entity?");
  await page.getByRole("button", { name: "Create canonical entity" }).click();
  await expect(page.getByText("Decision recorded", { exact: true })).toBeVisible();
});

test("preserves input and focuses reload on optimistic conflict", async ({ page }) => {
  await page.route("**/internal-api/reconciliation**", (route) => route.request().method() === "GET" ? route.fulfill({ json: { items: [reviewCase], nextCursor: null } }) : route.fulfill({ status: 409, json: { message: "Review case changed" } }));
  await page.goto("/internal/reconciliation");
  await page.getByLabel("Evidence note").fill("Reviewed against current source");
  await page.getByLabel("Manual canonical entity ID").fill("team-manual");
  await page.getByRole("button", { name: "Link manually" }).click();
  await expect(page.getByText(/This case changed while you were reviewing it/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload case" })).toBeFocused();
  await expect(page.getByLabel("Evidence note")).toHaveValue("Reviewed against current source");
});

test("contains large escaped evidence and remains operable at mobile and desktop widths", async ({ page }) => {
  const largeCase = { ...reviewCase, provider: `<script>${"provider-text-".repeat(100)}</script>`, incomingSnapshot: { payload: `<img onerror=alert(1)>${"x".repeat(10_000)}` } };
  await page.route("**/internal-api/reconciliation**", (route) => route.fulfill({ json: { items: [largeCase], nextCursor: null } }));
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/internal/reconciliation");
    await page.getByText("Raw provider snapshot").click();
    await expect(page.getByRole("button", { name: "Approve selected match" })).toBeVisible();
    expect(await page.locator("script").allTextContents()).not.toContain("alert(1)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
