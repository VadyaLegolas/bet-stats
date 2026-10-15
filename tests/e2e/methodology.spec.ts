import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { LIVE_FIXTURES } from "./live-provider-stack.js";

test("versioned model card presents plain-language and exact technical evidence", async ({ page }) => {
  await page.goto("/methodology");

  await expect(page.getByRole("heading", { level: 1, name: "Как работают прогнозы" })).toBeVisible();
  await expect(page.getByText("Версия карточки модели", { exact: true })).toBeVisible();
  await expect(page.getByText("Дата вступления в силу", { exact: true })).toBeVisible();
  await expect(page.getByText("poisson-ensemble-v1 / forecast-config-v1", { exact: true })).toBeVisible();

  const sectionNames = ["Входы", "Что исключается", "Уверенность", "Ограничения", "Оценка", "Ответственное использование", "История изменений"];
  await expect(page.locator("main h2")).toHaveText(sectionNames);
  for (const name of sectionNames.slice(0, -1)) {
    const section = page.getByRole("heading", { level: 2, name }).locator("xpath=..");
    await expect(section.getByText("Технические подробности", { exact: true })).toBeVisible();
  }

  await page.locator("#evaluation").getByText("Технические подробности", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Формулы корректных очков" })).toContainText("Brier");
  await expect(page.locator("#evaluation-technical")).toContainText("proper-score-v1");
  await expect(page.locator("#evaluation-technical")).toContainText("settlement-policy-v1");
  await expect(page.locator("#confidence-technical")).toContainText("минимум 5 матчей");
  await page.locator("#inputs").getByText("Технические подробности", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Подробности квитанции прогноза" })).toHaveAttribute("href", "/fixtures#forecast-receipts");

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
  await expect(forecast).toContainText("Вероятности — это оценки, а не гарантии. Доказательства могут быть неполными или устаревшими.");
  await expect(forecast.getByRole("link", { name: "Методология и ограничения" })).toHaveAttribute("href", "/methodology#limitations");

  const value = page.locator('[data-methodology-context="value"]');
  await expect(value).toContainText("Положительное ожидаемое value — это оценка модели, а не обещание прибыли.");
  await expect(value.getByRole("link", { name: "Методология и ограничения" })).toHaveAttribute("href", "/methodology#limitations");

  const query = new URLSearchParams({ modelVersion: "poisson-ensemble-v1", competitionId: "live-pl", market: "ONE_X_TWO", from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
  await page.goto(`/scorecards?${query}`);
  const scorecard = page.locator('[data-methodology-context="scorecard"]');
  await expect(scorecard).toContainText("Историческая оценка не гарантирует будущих результатов.");
  const link = scorecard.getByRole("link", { name: "Методология и ограничения" });
  await expect(link).toHaveAttribute("href", "/methodology#limitations");
  expect(new URL(await link.getAttribute("href") ?? "", page.url()).search).toBe("");
  await expect(page.getByRole("contentinfo")).toContainText("Исходы остаются неопределёнными");
});
