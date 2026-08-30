import { expect, test, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const axePackage = readdirSync(resolve(process.cwd(), "node_modules/.pnpm")).find((entry) => entry.startsWith("axe-core@"));
if (!axePackage) throw new Error("axe-core is required for accessibility scans");
const axePath = resolve(process.cwd(), "node_modules/.pnpm", axePackage, "node_modules/axe-core/axe.min.js");

const secret = "api-key-super-secret";
const rawException = "ECONNRESET at ProviderClient.call (provider.ts:42)";

async function missing(name: string, assertion: () => Promise<unknown>) {
  try {
    await assertion();
  } catch {
    throw new Error(`Missing Phase 2 pipeline-replay behavior: ${name}`);
  }
}

async function stubReplay(page: Page) {
  let previewVersion = 1;
  let confirmations = 0;
  await page.route("**/internal-api/pipeline/replay**", async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    if (method === "GET") {
      return route.fulfill({ json: { provider: "api-football", circuit: "OPEN", endpointFamily: "fixtures", allowance: null, observedAllowance: 500, configuredAllowance: 100, reserved: 12, remaining: null, resetAt: null, alreadyAuthorizedCritical: 3, blockedReason: "Blocked before reservation", internal: { secret, rawException } } });
    }
    if (url.pathname.endsWith("/preview")) {
      previewVersion += 1;
      return route.fulfill({ json: { previewId: `preview-${previewVersion}`, version: previewVersion, units: 2, estimatedReservations: 2, lane: "OPERATOR_REPLAY", stale: false, logicalIdentity: "api-football:fixtures:2026-08-01:2026-08-02", warnings: [] } });
    }
    confirmations += 1;
    if (confirmations > 1) return route.fulfill({ status: 409, json: { code: "DUPLICATE_CONFIRMATION", message: rawException } });
    return route.fulfill({ json: { planId: "replay-plan-1", unitCount: 2, lane: "OPERATOR_REPLAY", correlationId: "corr-safe-1", status: "QUEUED" } });
  });
}

test("serializes browser-local replay windows as exact UTC instants", async ({ page }) => {
  const previewBodies: Record<string, unknown>[] = [];
  await page.unroute("**/internal-api/pipeline/replay**");
  await page.route("**/internal-api/pipeline/replay**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") return route.fulfill({ json: { circuit: "CLOSED" } });
    if (url.pathname.endsWith("/preview")) {
      previewBodies.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { previewId: "utc-preview", previewVersion: "utc-v1", units: 1, lane: "standard", input: request.postDataJSON() } });
    }
    return route.fulfill({ json: { replayPlanId: "utc-plan", status: "QUEUED" } });
  });
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await page.getByLabel("From (local time)").fill("2026-08-01T12:34");
  await page.getByLabel("To (local time)").fill("2026-08-01T13:45");
  const expected = await page.evaluate(() => ({
    from: new Date(2026, 7, 1, 12, 34).toISOString(),
    to: new Date(2026, 7, 1, 13, 45).toISOString(),
  }));
  await page.getByRole("button", { name: "Preview replay" }).click();
  await expect(page.getByText(/1 logical units/)).toBeVisible();
  expect(previewBodies).toHaveLength(1);
  expect(previewBodies[0]).toMatchObject(expected);
  expect(String(previewBodies[0]?.from)).toMatch(/:\d{2}\.\d{3}Z$/);
  await expect(page.getByText(expected.from, { exact: true })).toBeVisible();
  await expect(page.getByText(expected.to, { exact: true })).toBeVisible();
});

test("blocks DST-ambiguous local time without sending a preview request", async ({ page }) => {
  let previewRequests = 0;
  await page.unroute("**/internal-api/pipeline/replay**");
  await page.route("**/internal-api/pipeline/replay**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: {} });
    previewRequests += 1;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await page.getByLabel("From (local time)").fill("2026-10-25T02:30");
  await page.getByRole("button", { name: "Preview replay" }).click();
  await expect(page.getByRole("alert")).toContainText(/could not be interpreted/i);
  expect(previewRequests).toBe(0);
});

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(2_000);
  await stubReplay(page);
});

test("requires preview before confirmation and queues existing logical identities once", async ({ page }) => {
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await missing("mandatory bounded replay preview", async () => {
    await expect(page.getByRole("heading", { name: "Historical pipeline replay" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue replay" })).toHaveCount(0);
    await page.getByRole("button", { name: "Preview replay" }).click();
    await expect(page.getByText(/2 logical units/)).toBeVisible();
  });
  await missing("idempotent replay confirmation and success identifiers", async () => {
    await page.getByRole("button", { name: "Queue replay" }).click();
    await expect(page.getByRole("dialog")).toContainText("existing logical identities");
    const confirm = page.getByRole("button", { name: /confirm queue replay/i });
    await confirm.dblclick();
    await expect(page.getByText("Replay queued", { exact: true })).toBeVisible();
    await expect(page.getByText("replay-plan-1", { exact: true })).toBeVisible();
    await expect(page.getByText("corr-safe-1", { exact: true })).toBeVisible();
  });
});

test("blocks stale previews and requires an explicit forced-revision reason", async ({ page }) => {
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await missing("stale preview prevents queueing", async () => {
    await page.getByRole("button", { name: "Preview replay" }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("replay-preview-stale")));
    await expect(page.getByText(/preview.*changed|preview.*stale/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue replay" })).toBeDisabled();
  });
  await missing("forced revision has separate confirmation and required reason", async () => {
    await page.getByLabel(/force new revision/i).check();
    await expect(page.getByLabel(/revision reason/i)).toHaveAttribute("required", "");
    await expect(page.getByRole("dialog")).toContainText(/new immutable revision/i);
  });
});

test("provider uncertainty fails closed without widening configured allowance", async ({ page }) => {
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await missing("unknown allowance and reset render Not available and cannot be called", async () => {
    await expect(page.getByText("Allowance: Not available", { exact: true })).toBeVisible();
    await expect(page.getByText("Reset: Not available", { exact: true })).toBeVisible();
    await expect(page.getByText("Blocked before reservation", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /call provider|retry provider/i })).toHaveCount(0);
  });
  await missing("runtime quota observation cannot widen configured allowance", async () => {
    await expect(page.getByText(/Configured allowance: 100/)).toBeVisible();
    await expect(page.getByText(/Effective allowance: 100/)).toBeVisible();
    await expect(page.getByText(/Effective allowance: 500/)).toHaveCount(0);
  });
  await missing("already-authorized critical work remains distinguishable", () =>
    expect(page.getByText("Already-authorized critical work: 3", { exact: true })).toBeVisible(),
  );
});

test("projects only classified safe status and never renders secrets or raw exceptions", async ({ page }) => {
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await missing("safe provider and replay status projection", async () => {
    await expect(page.getByText("Circuit: Open", { exact: true })).toBeVisible();
    await expect(page.getByText("Endpoint: fixtures", { exact: true })).toBeVisible();
    await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
    await expect(page.getByText(rawException, { exact: false })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("provider.ts:42");
  });
});

test("has no serious or critical accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/internal/pipeline/replay", { timeout: 10_000 });
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (globalThis as unknown as { axe: { run: (root: Document) => Promise<{ violations: { impact: string | null; id: string }[] }> } }).axe;
    const result = await axe.run(document);
    return result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id);
  });
  expect(violations).toEqual([]);
});
