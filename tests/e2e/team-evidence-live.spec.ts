import { expect, test } from "@playwright/test";

import { LIVE_API_ORIGIN, LIVE_CUTOFF, LIVE_TEAM_ID } from "./live-evidence-stack";

test("live published cutoff crosses PostgreSQL, Nest, Next, and the browser", async ({ page, request }) => {
  const response = await request.get(`${LIVE_API_ORIGIN}/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  expect(response.ok()).toBeTruthy();
  const evidence = await response.json() as { resolvedAsOfUtc: string };

  await page.goto(`/teams/${LIVE_TEAM_ID}/evidence?asOf=${encodeURIComponent(LIVE_CUTOFF)}`);
  const resolvedCutoff = page.locator("dt", { hasText: "Resolved cutoff (UTC)" }).locator("xpath=following-sibling::dd[1]");
  await expect(resolvedCutoff).toHaveText(evidence.resolvedAsOfUtc);
  expect(evidence.resolvedAsOfUtc).toBe(LIVE_CUTOFF);
});
