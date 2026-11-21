import { describe, expect, it } from "vitest";

import { currentForecastConfigHash } from "../../packages/domain/src/evaluation/forecast-orchestrator.js";
import { parseForecastResponse } from "../../packages/domain/src/forecast/contract.js";
import { DIXON_COLES_CONFIG, FORECAST_CONFIG, FORECAST_CONFIGS, FORECAST_CONFIG_VERSION_BY_MODEL, forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { createForecast } from "../../packages/domain/src/forecast/model.js";
import { DEFAULT_FORECAST_MODEL_VERSION, MODEL_VERSIONS, isForecastModelVersion } from "../../packages/domain/src/forecast/model-version.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(side: "home" | "away"): EvidenceProjectionDto {
  const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${side}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId: side,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE",
    freshness: "FRESH",
    buildId: `build-${side}`,
    publishedAt: cutoff,
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", side === "home" ? 2.1 : 1.2, 5),
      form10: component("form10", side === "home" ? 1.9 : 1.3),
      elo: component("elo", side === "home" ? 1640 : 1420),
      homeStrength: component("homeStrength", 2.3),
      awayStrength: component("awayStrength", 0.9),
      goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
      restDays: component("restDays", side === "home" ? 20 : 1, 1),
      h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
    },
  };
}

const input = {
  fixtureId: "fixture-1",
  forecastSnapshotId: "forecast-1",
  cutoff,
  canonicalIdentityState: "RESOLVED" as const,
  home: projection("home"),
  away: projection("away"),
  lineupAvailable: false,
  sourceReliability: 0.8,
};

function v1Response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const forecast = createForecast(input);
  return {
    id: "snapshot-1",
    fixtureId: forecast.fixtureId,
    kind: "PRE_MATCH",
    officialLineupObservationId: null,
    revision: 1,
    cutoff: forecast.cutoff,
    modelVersion: forecast.modelVersion,
    modelHash: "sha256:model",
    configVersion: forecast.configVersion,
    configHash: forecast.configHash,
    inputHash: forecast.inputHash,
    evidenceFingerprint: "sha256:evidence",
    evidenceBuildIds: forecast.evidenceBuildIds,
    probabilities: forecast.markets,
    confidence: forecast.confidence,
    limitations: forecast.limitations,
    tail: { retainedMass: forecast.retainedMass, tailMass: forecast.tailMass, warning: forecast.tailWarning, normalizationVersion: forecast.normalizationVersion },
    assumptions: forecast.assumptions,
    receipt: { forecastSnapshotId: "snapshot-1", officialLineupObservationId: null, evidenceBuildIds: forecast.evidenceBuildIds, sourceRefs: forecast.sources, expectedGoals: forecast.expectedGoals, adjustments: forecast.adjustments },
    issuedAt: cutoff,
    ...overrides,
  };
}

describe("forecast model version union", () => {
  it("declares exactly the two accepted versions and defaults to dixon-coles", () => {
    expect(MODEL_VERSIONS).toEqual(["poisson-ensemble-v1", "dixon-coles-ensemble-v1"]);
    expect(DEFAULT_FORECAST_MODEL_VERSION).toBe("dixon-coles-ensemble-v1");
    expect(isForecastModelVersion(DEFAULT_FORECAST_MODEL_VERSION)).toBe(true);
  });

  it.each(["poisson-ensemble-v1", "dixon-coles-ensemble-v1"])("accepts %s", (version) => {
    expect(isForecastModelVersion(version)).toBe(true);
  });

  it.each(["", "poisson-ensemble-v2", "dixon-coles-ensemble-v2", "Poisson-Ensemble-V1", null, 42, undefined, {}])("rejects unknown version %s fail-closed", (value) => {
    expect(isForecastModelVersion(value)).toBe(false);
  });
});

describe("per-version config identity", () => {
  it("maps each model version to its own config version", () => {
    expect(FORECAST_CONFIG_VERSION_BY_MODEL["poisson-ensemble-v1"]).toBe("forecast-config-v1");
    expect(FORECAST_CONFIG_VERSION_BY_MODEL["dixon-coles-ensemble-v1"]).toBe("forecast-config-v2");
  });

  it("keeps the frozen v1 config object as the v1 entry and exposes dixon-coles separately", () => {
    expect(FORECAST_CONFIGS["poisson-ensemble-v1"]).toBe(FORECAST_CONFIG);
    expect(FORECAST_CONFIGS["dixon-coles-ensemble-v1"]).toBe(DIXON_COLES_CONFIG);
    expect(FORECAST_CONFIG.version).toBe("forecast-config-v1");
    expect(DIXON_COLES_CONFIG.version).toBe("forecast-config-v2");
    expect(DIXON_COLES_CONFIG.baselineGoals).toEqual(FORECAST_CONFIG.baselineGoals);
  });

  it("publishes the historical v1 hash through the per-version selector", () => {
    const v1Hash = forecastConfigHashFor("poisson-ensemble-v1");
    const dcHash = forecastConfigHashFor("dixon-coles-ensemble-v1");
    expect(v1Hash).toBe(currentForecastConfigHash());
    expect(v1Hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dcHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dcHash).not.toBe(v1Hash);
  });
});

describe("createForecast model identity", () => {
  it("defaults to poisson-ensemble-v1 with forecast-config-v1 when no version is given", () => {
    const forecast = createForecast(input);
    expect(forecast.modelVersion).toBe("poisson-ensemble-v1");
    expect(forecast.configVersion).toBe("forecast-config-v1");
    expect(forecast.configHash).toBe(forecastConfigHashFor("poisson-ensemble-v1"));
  });

  it("rejects the dixon-coles version without explicit rho parameters", () => {
    expect(() => createForecast({ ...input, modelVersion: "dixon-coles-ensemble-v1" })).toThrow("DIXON_COLES_RHO_REQUIRED");
  });
});

describe("forecast response contract across versions", () => {
  it("accepts a legacy v1 response without a dixonColes block", () => {
    expect(parseForecastResponse(v1Response()).modelVersion).toBe("poisson-ensemble-v1");
  });

  it("rejects a dixon-coles response carrying the v1 config version", () => {
    expect(() => parseForecastResponse(v1Response({ modelVersion: "dixon-coles-ensemble-v1", configVersion: "forecast-config-v1" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });

  it("rejects a v1 response carrying the dixon-coles config version", () => {
    expect(() => parseForecastResponse(v1Response({ configVersion: "forecast-config-v2" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });

  it("rejects an unknown model version", () => {
    expect(() => parseForecastResponse(v1Response({ modelVersion: "poisson-ensemble-v2" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });
});
