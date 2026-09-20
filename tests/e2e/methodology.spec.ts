import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("link", { name: "Forecast receipt details" })).toHaveAttribute("href", "/fixtures#forecast-receipts");

  const changes = page.locator("#change-history article");
  await expect(changes).toHaveCount(2);
  const effectiveDates = await changes.locator("time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime")));
  expect(effectiveDates).toEqual([...effectiveDates].sort().reverse());

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});
