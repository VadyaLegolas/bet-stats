import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { LIVE_FIXTURES } from "./live-provider-stack.js";

test("versioned model card presents plain-language and exact technical evidence", async ({ page }) => {
  await page.goto("/methodology");

  await expect(page.getByRole("heading", { level: 1, name: "How forecasts work" })).toBeVisible();
  await expect(page.getByText("Model card version", { exact: true })).toBeVisible();
  await expect(page.getByText("Effective date", { exact: true })).toBeVisible();
  await expect(page.getByText("poisson-ensemble-v1 / forecast-config-v1", { exact: true })).toBeVisible();

  const sectionNames = ["Inputs", "What is excluded", "Confidence", "Limitations", "Evaluation", "Responsible use", "Change history"];
  await expect(page.locator("main h2")).toHaveText(sectionNames);
  for (const name of sectionNames.slice(0, -1)) {
    const section = page.getByRole("heading", { level: 2, name }).locator("xpath=..");
    await expect(section.getByText("Technical details", { exact: true })).toBeVisible();
  }

  await page.locator("#evaluation").getByText("Technical details", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Proper score formulas" })).toContainText("Brier");
  await expect(page.locator("#evaluation-technical")).toContainText("proper-score-v1");
  await expect(page.locator("#evaluation-technical")).toContainText("settlement-policy-v1");
  await expect(page.locator("#confidence-technical")).toContainText("minimum 5 matches");
  await page.locator("#inputs").getByText("Technical details", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Forecast receipt details" })).toHaveAttribute("href", "/fixtures#forecast-receipts");

  const changes = page.locator("#change-history article");
  await expect(changes).toHaveCount(2);
  const effectiveDates = await changes.locator("time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime")));
  expect(effectiveDates).toEqual([...effectiveDates].sort().reverse());

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("contextual warnings repeat exact limitations with clean stable links", async ({ page }) => {
  await page.goto(`/fixtures/${LIVE_FIXTURES.comparison}?left=private-left&right=private-right`);

  const forecast = page.locator('[data-methodology-context="forecast"]');
  await expect(forecast).toContainText("Probabilities are estimates, not guarantees. Evidence may be incomplete or stale.");
  await expect(forecast.getByRole("link", { name: "Methodology and limitations" })).toHaveAttribute("href", "/methodology#limitations");

  const value = page.locator('[data-methodology-context="value"]');
  await expect(value).toContainText("A positive expected value is a model estimate, not a promise of profit.");
  await expect(value.getByRole("link", { name: "Methodology and limitations" })).toHaveAttribute("href", "/methodology#limitations");

  const query = new URLSearchParams({ modelVersion: "poisson-ensemble-v1", competitionId: "live-pl", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
  await page.goto(`/scorecards?${query}`);
  const scorecard = page.locator('[data-methodology-context="scorecard"]');
  await expect(scorecard).toContainText("Historical evaluation does not guarantee future performance.");
  const link = scorecard.getByRole("link", { name: "Methodology and limitations" });
  await expect(link).toHaveAttribute("href", "/methodology#limitations");
  expect(new URL(await link.getAttribute("href") ?? "", page.url()).search).toBe("");
  await expect(page.getByRole("contentinfo")).toContainText("Outcomes remain uncertain");
});
