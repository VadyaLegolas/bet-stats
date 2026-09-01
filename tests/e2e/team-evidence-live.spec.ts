import { expect, test } from "@playwright/test";

import { appendLaterCorrection, LIVE_API_ORIGIN, LIVE_CUTOFF, LIVE_LATER_CUTOFF, LIVE_TEAM_ID } from "./live-evidence-stack";

test("live published cutoff crosses PostgreSQL, Nest, Next, and the browser", async ({ page, request }) => {
  const response = await request.get(`${LIVE_API_ORIGIN}/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  expect(response.ok()).toBeTruthy();
  const evidence = await response.json() as { resolvedAsOfUtc: string };

  await page.goto(`/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  const resolvedCutoff = page.locator("dt", { hasText: "Resolved cutoff (UTC)" }).locator("xpath=following-sibling::dd[1]");
  await expect(resolvedCutoff).toHaveText(evidence.resolvedAsOfUtc);
  expect(evidence.resolvedAsOfUtc).toBe(LIVE_CUTOFF);
});

test("renders the full live evidence matrix and preserves the original cutoff after correction", async ({ page, request }) => {
  const originalResponse = await request.get(`${LIVE_API_ORIGIN}/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json() as any;
  expect(original.components.form5).toMatchObject({ sampleSize: 5, value: expect.any(Number) });
  expect(original.components.form10).toMatchObject({ sampleSize: 10, value: expect.any(Number) });
  expect(original.components.awayStrength).toMatchObject({ value: null, limitation: "NO_ELIGIBLE_HISTORY" });
  expect(original.receipt.inputs).toHaveLength(10);
  expect(original.receipt.inputs.map((input: { effectiveAt: string }) => input.effectiveAt)).toEqual(
    [...original.receipt.inputs].map((input: { effectiveAt: string }) => input.effectiveAt).sort(),
  );

  await page.goto(`/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  await expect(page.getByText("5/5", { exact: true })).toBeVisible();
  await expect(page.getByText("10/10", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Eligible match trace" })).toBeVisible();
  await expect(page.getByText("live-past-01", { exact: true })).toBeVisible();
  await expect(page.getByText("live-past-10", { exact: true })).toBeVisible();
  const awayStrength = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Away strength$/ }) });
  await awayStrength.locator("summary").click();
  await expect(awayStrength.getByText("Value: Not available", { exact: true })).toBeVisible();
  await expect(awayStrength.getByText("NO_ELIGIBLE_HISTORY", { exact: true })).toBeVisible();
  const receiptLabel = new RegExp(`Reproduction receipt.*${original.receipt.configVersion}.*10 inputs`);
  await expect(page.locator("summary").filter({ hasText: receiptLabel })).toBeVisible();

  await appendLaterCorrection();
  const later = await (await request.get(`${LIVE_API_ORIGIN}/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_LATER_CUTOFF)}`)).json() as any;
  expect(later.buildId).not.toBe(original.buildId);
  expect(later.receipt.inputs).toContainEqual(expect.objectContaining({ payloadHash: "live-correction-hash", payloadBytes: 38 }));
  const repeated = await (await request.get(`${LIVE_API_ORIGIN}/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`)).json();
  expect(repeated).toEqual(original);
  await page.reload();
  await expect(page.locator("summary").filter({ hasText: receiptLabel })).toBeVisible();
});
