import { createElement } from "../../apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { describe, expect, it } from "vitest";

import { availabilityReasonCopy, ForecastComparisonPanel, ForecastWorkbench, initializeComparisonPair, swapComparisonPair, ValueOutcomeSection, type ValueResult } from "../../apps/web/app/fixtures/[fixtureId]/forecast-workbench.js";
import { compareForecastPair } from "../../packages/domain/src/forecast/comparison.js";
import { snapshot } from "./forecast-comparison.test.js";

describe("forecast revision comparison UI", () => {
  it("initializes missing URL IDs once and never substitutes selected snapshots on refresh", () => {
    const forecasts = [snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4)];
    expect(initializeComparisonPair(new URLSearchParams(), forecasts)).toEqual({ leftId: "left", rightId: "right", initialized: true });
    expect(initializeComparisonPair(new URLSearchParams("left=kept-left&right=kept-right"), [...forecasts, snapshot("newest", "LINEUP_CONFIRMED", 0.55, [], 0.8, 1.5)])).toEqual({ leftId: "kept-left", rightId: "kept-right", initialized: false });
    expect(swapComparisonPair({ leftId: "left", rightId: "right" })).toEqual({ leftId: "right", rightId: "left" });
  });
  it.each([["CAPABILITY_DENIED", "Возможности поставщика запрещены."], ["BUDGET_PROTECTED", "Бюджет поставщика защищён."], ["PROVIDER_UNAVAILABLE", "Поставщик недоступен."], ["NO_CONFIRMED_LINEUP", "Официальный подтверждённый состав отсутствовал до отсечки."], ["INSUFFICIENT_EVIDENCE", "Доказательств недостаточно для этого снимка."]])("renders server reason %s exactly", (reason, copy) => expect(availabilityReasonCopy(reason)).toBe(copy));

  it("renders server semantic deltas with written direction and exact receipt IDs", () => {
    const comparison = compareForecastPair(snapshot("left", "INITIAL", 0.45, ["OLD"], 0.6, 1.2), snapshot("right", "PRE_MATCH", 0.5, ["NEW"], 0.7, 1.4));
    const markup = renderToStaticMarkup(createElement(ForecastComparisonPanel, { comparison }));
    expect(markup).toContain("Значимые изменения доказательств, модели и ограничений");
    expect(markup).toContain("вырос на");
    expect(markup).toContain("+5.0%");
    expect(markup).toContain("left");
    expect(markup).toContain("right");
    expect(markup).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
  });

  it("renders composite evidence changes when fixture IDs are unchanged", () => {
    const left = snapshot("left", "INITIAL", 0.45, [], 0.6, 1.2);
    const right = snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4);
    Object.assign(left.receipt.sourceRefs[0]!, { fixtureId: "shared", payloadHash: "hash-before" });
    Object.assign(right.receipt.sourceRefs[0]!, { fixtureId: "shared", payloadHash: "hash-after" });
    const markup = renderToStaticMarkup(createElement(ForecastComparisonPanel, { comparison: compareForecastPair(left, right) }));
    expect(markup).toContain("hash-before");
    expect(markup).toContain("hash-after");
    expect(markup).not.toContain("Отображаемые компоненты модели не изменились");
  });

  it("renders evidence diffs as named matches with short fingerprints, UTC dates and labelled limitations", () => {
    const left = snapshot("left", "INITIAL", 0.45, ["WEAK_HOME_ELO"], 0.6, 1.2);
    const right = snapshot("right", "PRE_MATCH", 0.5, [], 0.7, 1.4);
    const fixtureId = "56bd9f79-9362-4b26-802f-9a485e5cb928";
    Object.assign(left.receipt.sourceRefs[0]!, { fixtureId, payloadHash: "b2005c8405abd62e4265d2e3fb7397bdc00432730e8127d04eaa8f4dc25d05b0", effectiveAt: "2026-10-11T13:00:00.000Z", observedAt: "2026-10-16T09:23:56.301Z" });
    Object.assign(right.receipt.sourceRefs[0]!, { fixtureId, payloadHash: "730cbb95426ef4038d7c80b08f69840ff97e07c5da9702a45706a25857b8482", effectiveAt: "2026-10-11T13:00:00.000Z", observedAt: "2026-10-18T01:28:06.011Z" });
    const diff = compareForecastPair(left, right);
    const markup = renderToStaticMarkup(createElement(ForecastComparisonPanel, { comparison: { ...diff, fixtureLabels: { [fixtureId]: "Ювентус против Лацио" } } }));
    expect(markup).toContain("<strong>Ювентус против Лацио</strong>");
    expect(markup).toContain("11.10.2026 13:00 UTC");
    expect(markup).toContain("16.10.2026 09:23 UTC");
    expect(markup).toContain("18.10.2026 01:28 UTC");
    expect(markup).toContain("b2005c8405ab…");
    expect(markup).toContain("730cbb95426e…");
    expect(markup).toContain("отпечаток");
    expect(markup).toContain("мало данных: рейтинг Эло хозяев"); // removed limitation label
    expect(markup).toContain("Добавленные ограничения: нет");
    expect(markup).toContain(`Матч: ${fixtureId} · отпечаток:`); // exact identity stays in the hover receipt
    /* Without labels the long UUID degrades to a short readable stub, never a raw wall of symbols. */
    const unlabeled = renderToStaticMarkup(createElement(ForecastComparisonPanel, { comparison: diff }));
    expect(unlabeled).toContain("<strong>56bd9f79…</strong>");
    expect(unlabeled).not.toContain("Ювентус");
  });

  it("renders documented one-snapshot and absent-lineup states with persistent risk disclosure", () => {
    const markup = renderToStaticMarkup(createElement(ForecastWorkbench, { fixtureId: "fixture-1", forecasts: [snapshot("only", "INITIAL", 0.45, [], 0.6, 1.2)] }));
    expect(markup).toContain("Сопоставимая пара прогнозов пока недоступна");
    expect(markup).toContain("Нет снимка по подтверждённому составу: до отсечки не было официальной квитанции подтверждённого состава.");
    expect(markup).toContain("Вероятности — это оценки, а не гарантии. Вы можете потерять деньги при ставках.");
    expect(markup).not.toContain("PRE_MATCH");
    expect(markup).not.toContain("LINEUP_CONFIRMED");
  });

  it("renders the value verdict in Russian with translated reasons and snapshot labels", () => {
    const result: ValueResult = {
      id: "receipt-1", fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1",
      market: "ONE_X_TWO", selection: "HOME", outcome: "NO_VALUE",
      reasons: ["CONFIDENCE_BELOW_THRESHOLD", "EDGE_BELOW_THRESHOLD", "EV_BELOW_THRESHOLD"],
      modelProbability: "0.381", noVigProbability: "0.55", fairOdds: "2.62", edge: "-0.169", expectedValue: "-0.352",
      receipt: { modelVersion: "model-v1", cutoff: "2026-10-17T16:00:00.000Z", sources: [], evidenceBuildIds: [], assumptions: [], formulas: [], thresholds: {}, gates: [] },
      createdAt: "2026-10-17T16:00:01.000Z",
    };
    const markup = renderToStaticMarkup(createElement(ValueOutcomeSection, { result, canonicalReceipt: "{}", copyMessage: "", copyReceipt: () => {} }));
    expect(markup).toContain("<h3 id=\"outcome-heading\">Нет value-сигнала</h3>");
    expect(markup).toContain("ни один из настроенных порогов value-сигнала не пройден");
    expect(markup).toContain("Снимок прогноза");
    expect(markup).toContain("Снимок коэффициентов");
    expect(markup).toContain("<li>уверенность ниже порога</li>");
    expect(markup).toContain("<li>преимущество ниже порога</li>");
    expect(markup).toContain("<li>ожидаемое value ниже порога</li>");
    expect(markup).toContain("<dt>Вероятность без перекрытия</dt>");
    expect(markup).toContain("<dt>Преимущество</dt>");
    expect(markup).toContain("<dt>Ожидаемое value</dt>");
    expect(markup).toContain("38.1%");
    expect(markup).toContain("role=\"status\"");
  });
});
