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
  await expect(page.getByText(/только вспомогательные материалы для проверки/i)).toBeVisible();
  await page.getByRole("button", { name: "Использовать как входные данные проверки" }).click();
  await expect(page.getByLabel("Новое каноническое имя")).toHaveValue("Arsenal FC");
  await expect(page.getByText("Решение записано", { exact: true })).toHaveCount(0);
});

test("renders escaped evidence and keeps review absent from public navigation", async ({ page }) => {
  await page.goto("/internal/reconciliation");
  await expect(page.getByRole("heading", { name: "Очередь проверки неоднозначных случаев" })).toBeVisible();
  await expect(page.getByText("provider <script>alert(1)</script>")).toBeVisible();
  expect(await page.locator("script").allTextContents()).not.toContain("alert(1)");
  await page.goto("/");
  await expect(page.getByRole("navigation")).not.toContainText("Review");
});

test("validates evidence, records approve, manual link, create and correction actions", async ({ page }) => {
  await page.goto("/internal/reconciliation");
  await page.getByRole("radio", { name: /team-1/ }).check();
  await page.getByRole("button", { name: "Подтвердить выбранное соответствие" }).click();
  await expect(page.getByText(/Заметка о доказательствах должна содержать не менее 10/)).toBeVisible();
  await page.getByLabel("Заметка о доказательствах").fill("Compared against official source");
  await page.getByRole("button", { name: "Подтвердить выбранное соответствие" }).click();
  await expect(page.getByText("Решение записано", { exact: true })).toBeVisible();

  await page.getByLabel("ID канонической сущности вручную").fill("team-manual");
  await page.getByRole("button", { name: "Связать вручную" }).click();
  await expect(page.getByText("Решение записано", { exact: true })).toBeVisible();
  await page.getByLabel("Новое каноническое имя").fill("New Team");
  await page.getByLabel("Код страны").fill("PL");
  await page.getByRole("button", { name: "Отклонить всё и создать каноническую сущность" }).click();
  await expect(page.getByRole("dialog")).toContainText("Создать новую каноническую сущность?");
  await page.getByRole("button", { name: "Создать каноническую сущность", exact: true }).click();
  await expect(page.getByText("Решение записано", { exact: true })).toBeVisible();
});

test("preserves input and focuses reload on optimistic conflict", async ({ page }) => {
  await page.route("**/internal-api/reconciliation**", (route) => route.request().method() === "GET" ? route.fulfill({ json: { items: [reviewCase], nextCursor: null } }) : route.fulfill({ status: 409, json: { message: "Review case changed" } }));
  await page.goto("/internal/reconciliation");
  await page.getByLabel("Заметка о доказательствах").fill("Reviewed against current source");
  await page.getByLabel("ID канонической сущности вручную").fill("team-manual");
  await page.getByRole("button", { name: "Связать вручную" }).click();
  await expect(page.getByText(/Этот случай изменился, пока вы его рассматривали/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Перезагрузить случай" })).toBeFocused();
  await expect(page.getByLabel("Заметка о доказательствах")).toHaveValue("Reviewed against current source");
});

test("contains large escaped evidence and remains operable at mobile and desktop widths", async ({ page }) => {
  const largeCase = { ...reviewCase, provider: `<script>${"provider-text-".repeat(100)}</script>`, incomingSnapshot: { payload: `<img onerror=alert(1)>${"x".repeat(10_000)}` } };
  await page.route("**/internal-api/reconciliation**", (route) => route.fulfill({ json: { items: [largeCase], nextCursor: null } }));
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/internal/reconciliation");
    await page.getByText("Исходный снимок поставщика").click();
    await expect(page.getByRole("button", { name: "Подтвердить выбранное соответствие" })).toBeVisible();
    expect(await page.locator("script").allTextContents()).not.toContain("alert(1)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
