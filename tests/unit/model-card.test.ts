import { describe, expect, it } from "vitest";

import {
  DIXON_COLES_CONFIG,
  FORECAST_CONFIG,
  FORECAST_CONFIG_VERSION_BY_MODEL,
  forecastConfigHashFor,
} from "../../packages/domain/src/forecast/config.js";
import { DIXON_COLES_CONVENTION } from "../../packages/domain/src/forecast/dixon-coles.js";
import { DEFAULT_FORECAST_MODEL_VERSION } from "../../packages/domain/src/forecast/model-version.js";
import { MODEL_CARD, MODEL_CARD_SECTION_IDS } from "../../packages/domain/src/methodology/model-card.js";

describe("model card v1.1.0", () => {
  it("names the dixon-coles hybrid and keeps the previous sections", () => {
    expect(MODEL_CARD.version).toBe("model-card-v1.1.0");
    expect(MODEL_CARD.effectiveDate).toBe("2026-11-21");
    expect([...MODEL_CARD_SECTION_IDS]).toEqual(["inputs", "dixon-coles", "what-is-excluded", "confidence", "limitations", "evaluation", "responsible-use"]);
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
    expect(dixonColes.rhoBounds).toBe("max(−1/(λh·λa), −1/λh, −1/λa) < ρ < min(1/(λh·λa), 1)");
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
    expect(latest.version).toBe("model-card-v1.1.0");
    expect(latest.affected).toContain("dixon-coles-ensemble-v1");
    expect(latest.affected).toContain("poisson-ensemble-v1");
    expect(latest.interpretation).toContain("не переписаны");
    expect(MODEL_CARD.changeHistory.map((entry) => entry.version)).toEqual(["model-card-v1.1.0", "model-card-v1.0.0", "model-card-v0.9.0"]);
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
