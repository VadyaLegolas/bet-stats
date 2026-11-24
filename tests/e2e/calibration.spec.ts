import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { createPrismaCalibrationRepository, createPrismaClient, type PrismaClient } from "../../packages/database/src/index.js";
import type { CalibratorIdentity, ScoreMarket } from "../../packages/domain/src/index.js";
import { makeFitted } from "../helpers/calibration-db.js";
import { readLiveReleaseState } from "./live-release-stack.js";

/** Fixture of the owned release stack that carries the production forecasts (V1 identity); local on purpose. */
const CALIBRATION_FIXTURE = "live-comparison-fixture";
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const DISCLOSURE = "Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.";
const INSUFFICIENT = /Недостаточно данных для калибровки: нужно не меньше 300 исходов, сейчас \d+/;
const FORBIDDEN = [/точнее/iu, /улучш/iu, /лучше/iu, /надёжнее/iu, /уверенн/iu];

async function openFixture(page: Page): Promise<void> {
  await page.goto(`/fixtures/${CALIBRATION_FIXTURE}`);
  await expect(page.getByRole("heading", { level: 3, name: "Замороженный прогноз" })).toBeVisible();
}

async function stackIdentity(database: PrismaClient): Promise<CalibratorIdentity> {
  const snapshot = await database.forecastSnapshot.findFirstOrThrow({ where: { fixtureId: CALIBRATION_FIXTURE, state: "ISSUED", origin: "PRODUCTION" }, orderBy: { issuedAt: "desc" }, select: { modelVersion: true, configHash: true } });
  return { modelVersion: snapshot.modelVersion as CalibratorIdentity["modelVersion"], configHash: snapshot.configHash };
}

test("calibration state, promotion and rollback are visible on the match page of the release stack", async ({ page }, testInfo) => {
  const state = readLiveReleaseState();
  const database = createPrismaClient(state.databaseUrl);
  const repository = createPrismaCalibrationRepository(database);
  const identity = await stackIdentity(database);
  // The seeded calibrators are unique per browser project, so the second project does not collide with the first.
  const seedBase = testInfo.project.name === "mobile-chromium" ? 2_000 : 1_000;
  const projectDay = testInfo.project.name === "mobile-chromium" ? 20 : 10;
  const promoted = new Map<ScoreMarket, string>();
  const versions = new Map<ScoreMarket, number>();

  try {
    // The stack carries no calibrator and no calibration history before this spec.
    for (const market of MARKETS) expect(await repository.findActiveCalibrator(identity, market)).toBeNull();

    // 1. Not enough data: the exact sentence with the numbers from the API, no version label, no calibrated table.
    await openFixture(page);
    const insufficient = page.locator('[data-calibration-state="INSUFFICIENT_DATA"]');
    await expect(insufficient).toHaveCount(3);
    for (const index of [0, 1, 2]) await expect(insufficient.nth(index)).toContainText(INSUFFICIENT);
    await expect(page.locator('[data-calibration-state="CALIBRATED"]')).toHaveCount(0);
    await expect(page.getByText(/Калибровка v\d/)).toHaveCount(0);
    await expect(page.getByText(DISCLOSURE).first()).toBeVisible();

    // 2. A calibrator of the forecast's own identity is promoted through the repository: version 1 appears for every market.
    for (const [index, market] of MARKETS.entries()) {
      const { calibratorId } = await repository.persistCalibrator(makeFitted({ identity, market, seed: seedBase + index }));
      promoted.set(market, calibratorId);
      await repository.promoteCalibrator({ identity, market, calibratorId, predecessorCalibratorId: null, asOf: new Date(Date.UTC(2027, 3, projectDay)).toISOString(), reasonCode: "FIRST_PROMOTION", evaluation: {} });
      // The version is the promotion number of the market: 1 in the first browser project, 2 in the second (the first one was rolled back).
      versions.set(market, (await repository.findActiveCalibrator(identity, market))!.version);
      if (testInfo.project.name === "desktop-chromium") expect(versions.get(market)).toBe(1);
    }
    await openFixture(page);
    const calibrated = page.locator('[data-calibration-state="CALIBRATED"]');
    await expect(calibrated).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      const panel = calibrated.nth(index);
      await expect(panel).toContainText(`Калибровка v${versions.get(MARKETS[index]!)}`);
      await expect(panel).toContainText("Отложенная выборка:");
      await expect(panel).toContainText("Сырая вероятность");
      await expect(panel).toContainText("Калиброванная вероятность");
      await expect(panel).toContainText("Brier на отложенной выборке: сырые");
      await expect(panel).toContainText("Калиброванные вероятности — тоже оценки, а не гарантии.");
      await expect(panel).toContainText("Расчёт value по-прежнему использует сырые вероятности.");
      await expect(panel).toContainText("Как устроена калибровка");
      const panelText = (await panel.textContent()) ?? "";
      for (const pattern of FORBIDDEN) expect(panelText, String(pattern)).not.toMatch(pattern);
    }
    await expect(page.getByText(INSUFFICIENT)).toHaveCount(0);
    // The permanent risk disclosure stays next to the new block.
    await expect(page.getByText(DISCLOSURE).first()).toBeVisible();
    await expect(page.getByText("Вероятности — это оценки, а не гарантии. Доказательства могут быть неполными или устаревшими.").first()).toBeAttached();

    // 3. Accessibility and reflow in the CALIBRATED state.
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.setViewportSize({ width: 320, height: 900 });
    await openFixture(page);
    await expect(page.locator('[data-calibration-state="CALIBRATED"]')).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const narrow = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(narrow.violations).toEqual([]);

    // 4. The panel's link leads to the methodology section.
    const link = page.getByRole("link", { name: "Как устроена калибровка" }).first();
    await expect(link).toHaveAttribute("href", "/methodology#calibration");
    await link.click();
    await expect(page).toHaveURL(/\/methodology#calibration$/);
    await expect(page.getByRole("heading", { level: 2, name: "Калибровка вероятностей" })).toBeVisible();

    // 5. Rollback through the repository: the page is back to "not enough data" and shows no version label.
    for (const market of MARKETS) {
      await repository.rollbackCalibrator({ identity, market, calibratorId: promoted.get(market)!, restoredCalibratorId: null, asOf: new Date(Date.UTC(2027, 3, projectDay + 1)).toISOString(), reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });
    }
    await openFixture(page);
    await expect(page.locator('[data-calibration-state="INSUFFICIENT_DATA"]')).toHaveCount(3);
    await expect(page.locator('[data-calibration-state="CALIBRATED"]')).toHaveCount(0);
    await expect(page.getByText(/Калибровка v\d/)).toHaveCount(0);
    await expect(page.getByText(INSUFFICIENT).first()).toBeVisible();
    for (const market of MARKETS) expect(await repository.findActiveCalibrator(identity, market)).toBeNull();
  } finally {
    // Leave the stack clean for the other specs: no active calibrator, whatever happened above.
    for (const market of MARKETS) {
      const active = await repository.findActiveCalibrator(identity, market).catch(() => null);
      if (active) {
        await repository.rollbackCalibrator({ identity, market, calibratorId: active.calibratorId, restoredCalibratorId: active.restoreTargetId, asOf: new Date(Date.UTC(2027, 3, projectDay + 2)).toISOString(), reasonCode: "HOLDOUT_REGRESSION", evaluation: { cleanup: 1 } }).catch(() => undefined);
      }
    }
    await database.$disconnect();
  }
});
