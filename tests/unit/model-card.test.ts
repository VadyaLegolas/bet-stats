import { describe, expect, it } from "vitest";

import {
  DIXON_COLES_CONFIG,
  FORECAST_CONFIG,
  FORECAST_CONFIG_VERSION_BY_MODEL,
  forecastConfigHashFor,
} from "../../packages/domain/src/forecast/config.js";
import { CALIBRATION_CONFIG, CALIBRATION_CONFIG_HASH } from "../../packages/domain/src/calibration/config.js";
import { DIXON_COLES_CONVENTION } from "../../packages/domain/src/forecast/dixon-coles.js";
import { DEFAULT_FORECAST_MODEL_VERSION } from "../../packages/domain/src/forecast/model-version.js";
import { MODEL_CARD, MODEL_CARD_SECTION_IDS } from "../../packages/domain/src/methodology/model-card.js";

describe("model card v1.2.0", () => {
  it("names the dixon-coles hybrid and keeps the previous sections, with calibration between evaluation and responsible use", () => {
    expect(MODEL_CARD.version).toBe("model-card-v1.2.0");
    expect(MODEL_CARD.effectiveDate).toBe("2026-11-24");
    expect([...MODEL_CARD_SECTION_IDS]).toEqual(["inputs", "dixon-coles", "what-is-excluded", "confidence", "limitations", "evaluation", "calibration", "responsible-use"]);
    expect(MODEL_CARD.forecast.dixonColes.integration).toBe("hybrid-elo-form-poisson-with-tau");
    expect(MODEL_CARD.forecast.dixonColes.integration).not.toBe("dixon-coles");
  });

  it("tracks the production default and its config identity", () => {
    expect(MODEL_CARD.currentModel.modelVersion).toBe(DEFAULT_FORECAST_MODEL_VERSION);
    expect(MODEL_CARD.currentModel.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(MODEL_CARD.currentModel.configVersion).toBe(FORECAST_CONFIG_VERSION_BY_MODEL[DEFAULT_FORECAST_MODEL_VERSION]);
    expect(MODEL_CARD.currentModel.configVersion).toBe("forecast-config-v2");
    expect(MODEL_CARD.currentModel.configHash).toBe(forecastConfigHashFor(DEFAULT_FORECAST_MODEL_VERSION));
    expect(MODEL_CARD.currentModel.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("publishes the pinned tau convention and all four formulas", () => {
    const { dixonColes } = MODEL_CARD.forecast;
    expect(dixonColes.convention).toBe(DIXON_COLES_CONVENTION);
    expect(dixonColes.convention).toBe("tau-1x2-v1");
    for (const formula of ["τ(0,0)=1−λh·λa·ρ", "τ(1,0)=1+λa·ρ", "τ(0,1)=1+λh·ρ", "τ(1,1)=1−ρ"]) {
      expect(dixonColes.tau).toContain(formula);
    }
    expect(dixonColes.rhoBounds).toBe("max(−1/λh, −1/λa) < ρ < min(1/(λh·λa), 1)");
  });

  it("derives rho policy from the frozen config instead of hardcoding it", () => {
    const estimation = DIXON_COLES_CONFIG.dixonColes.estimation;
    expect(MODEL_CARD.forecast.dixonColes.rhoPolicy).toEqual({
      method: estimation.method,
      windowDays: estimation.windowDays,
      minLeagueMatches: estimation.minLeagueMatches,
      minPooledMatches: estimation.minPooledMatches,
      fallback: estimation.fallback,
    });
    expect(MODEL_CARD.forecast.dixonColes.rhoPolicy).toEqual({
      method: "mle-low-score-v1",
      windowDays: 730,
      minLeagueMatches: 150,
      minPooledMatches: 300,
      fallback: "zero",
    });
  });

  it("states the O/U 2.5 neutrality and the hybrid limitation in plain text", () => {
    const text = MODEL_CARD.forecast.dixonColes.effects.join(" ");
    const limitations = MODEL_CARD.forecast.dixonColes.limitations.join(" ");
    expect(text).toContain("тотала 2.5 нейтрален");
    expect(limitations).toContain("гибридная");
    expect(limitations).toContain("не полный DC-refit");
    expect(limitations).toContain("ρ = 0");
    expect(limitations).toMatch(/не гарантия лучших вероятностей/u);
  });

  it("keeps V1 available for rollback and comparison", () => {
    expect(MODEL_CARD.alternatives).toHaveLength(1);
    expect(MODEL_CARD.alternatives[0]).toEqual({
      modelVersion: "poisson-ensemble-v1",
      configVersion: FORECAST_CONFIG.version,
      configHash: forecastConfigHashFor("poisson-ensemble-v1"),
      role: "ROLLBACK_AND_COMPARISON",
    });
    expect(MODEL_CARD.alternatives[0]!.configHash).toBe(forecastConfigHashFor("poisson-ensemble-v1"));
  });

  it("records the model change without rewriting historical receipts", () => {
    const latest = MODEL_CARD.changeHistory[0]!;
    expect(latest.version).toBe("model-card-v1.2.0");
    expect(latest.affected).toContain("calibration-config-v1");
    expect(latest.interpretation).toContain("не переписаны");
    expect(latest.interpretation).toContain("при чтении");
    const previous = MODEL_CARD.changeHistory[1]!;
    expect(previous.version).toBe("model-card-v1.1.0");
    expect(previous.affected).toContain("dixon-coles-ensemble-v1");
    expect(previous.affected).toContain("poisson-ensemble-v1");
    expect(previous.interpretation).toContain("не переписаны");
    expect(MODEL_CARD.changeHistory.map((entry) => entry.version)).toEqual(["model-card-v1.2.0", "model-card-v1.1.0", "model-card-v1.0.0", "model-card-v0.9.0"]);
    const dates = MODEL_CARD.changeHistory.map((entry) => entry.effectiveDate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe(MODEL_CARD.effectiveDate);
  });

  it("preserves the previously published policy and formula fields", () => {
    expect(MODEL_CARD.forecast.scoreGrid).toContain("Poisson");
    expect(MODEL_CARD.forecast.minimumSamples).toEqual(FORECAST_CONFIG.minimumSamples);
    expect(MODEL_CARD.forecast.valueFormulas).toHaveLength(2);
    expect(MODEL_CARD.policies.scoreFormula).toBe("proper-score-v1");
    expect(MODEL_CARD.evaluation.brier).toContain("Brier");
    expect(MODEL_CARD.evaluation.logLoss).toContain("Log Loss");
  });

  it("contains no profit promises and no secrets", () => {
    const serialized = JSON.stringify(MODEL_CARD);
    expect(serialized).not.toMatch(/гарантир|точно выигра|прибыль гарант/iu);
    expect(serialized).not.toMatch(/api[_-]?key|token|password/iu);
  });
});

describe("model card calibration block", () => {
  const block = MODEL_CARD.calibration;

  it("derives every value from calibration-config-v1, not from literals", () => {
    expect(block.configVersion).toBe(CALIBRATION_CONFIG.version);
    expect(block.configHash).toBe(CALIBRATION_CONFIG_HASH);
    expect(block.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(block.markets).toEqual(CALIBRATION_CONFIG.markets);
    expect(block.minimumSamples).toEqual(CALIBRATION_CONFIG.minimumSamples);
    expect(block.holdoutFraction).toBe(CALIBRATION_CONFIG.holdoutFraction);
    expect(block.materiality).toBe(CALIBRATION_CONFIG.materiality);
    expect(block.rollback).toEqual(CALIBRATION_CONFIG.rollback);
    expect(block.probabilityClipEpsilon).toBe(CALIBRATION_CONFIG.probabilityClipEpsilon);
    expect(block.cadence).toEqual(CALIBRATION_CONFIG.cadence);
    expect(block.fit).toEqual({ kinds: CALIBRATION_CONFIG.fit.kinds, servedKinds: CALIBRATION_CONFIG.fit.servedKinds });
  });

  it("pins the D-07 numbers once", () => {
    expect(block.minimumSamples).toEqual({ platt: 300, isotonic: 1500, holdout: 60 });
    expect(block.materiality).toBe(0.002);
    expect(block.rollback).toEqual({ consecutiveWorse: 3, minimumEvaluationSample: 30 });
  });

  it("states the method, the rollback policy and the frozen-receipt rule in the published texts using the config numbers", () => {
    const effects = block.effects.join(" ");
    expect(effects).toContain("Platt");
    expect(effects).toContain("один против всех");
    expect(effects).toContain("суммы 1");
    expect(effects).toContain(`${CALIBRATION_CONFIG.minimumSamples.isotonic} и более`);
    expect(effects).toContain("изотоническая регрессия");
    expect(effects).toContain("предматчевые прогнозы PRODUCTION");
    expect(effects).toContain("закреплён за точной версией модели и конфигурации");
    expect(effects).toContain(`${CALIBRATION_CONFIG.rollback.consecutiveWorse} подряд`);
    expect(effects).toContain(`не меньше ${CALIBRATION_CONFIG.rollback.minimumEvaluationSample} исходов`);
    // WR-01: the re-promotion rule is the one the lifecycle enforces, with the config numbers, not a bare promise.
    expect(effects).toContain("Тот же самый калибратор повторно не продвигается");
    expect(effects).toContain("после отката");
    expect(effects).toContain(`не меньше ${CALIBRATION_CONFIG.minimumSamples.holdout} в отложенной выборке кандидата`);
    expect(effects).toContain(`опережать откатанный калибратор не меньше чем на ${CALIBRATION_CONFIG.materiality} по Brier`);
    expect(effects).not.toContain("откатанный калибратор повторно не продвигается");
    expect(effects).toContain("Замороженные снимки");
    expect(effects).toContain("сырые вероятности");
  });

  it("lists the honest limitations, including the two read-time ones", () => {
    const limitations = block.limitations.join(" ");
    expect(limitations).toContain(`${CALIBRATION_CONFIG.minimumSamples.platt} исходов`);
    expect(limitations).toContain("не обещает");
    expect(limitations).toContain("первичный прогноз");
    expect(limitations).toContain("многоклассовая");
    // WR-04: the holdout used to choose the method also scores it; the card says so instead of hiding the optimism.
    expect(limitations).toContain("одну и ту же отложенную выборку");
    expect(limitations).toContain("лучший из двух методов");
    expect(limitations).toContain(`от ${CALIBRATION_CONFIG.minimumSamples.isotonic} исходов`);
    // The calibrator is fitted on PRE_MATCH snapshots and also shown for LINEUP_CONFIRMED ones.
    expect(limitations).toContain("по подтверждённому составу");
    // The state is computed at read time with today's census and today's calibrator.
    expect(limitations).toContain("сегодняшним калибратором");
  });

  it("never promises an improvement or a guarantee", () => {
    const text = [...block.effects, ...block.limitations, MODEL_CARD.changeHistory[0]!.summary, MODEL_CARD.changeHistory[0]!.interpretation].join(" ");
    expect(text).not.toMatch(/гарантир|точно выигра|прибыль гарант|улучш|точнее|надёжнее/iu);
  });
});
