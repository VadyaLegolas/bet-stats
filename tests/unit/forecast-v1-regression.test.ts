import { describe, expect, it } from "vitest";

import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { createForecast } from "../../packages/domain/src/forecast/model.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

/**
 * Frozen `poisson-ensemble-v1` numeric vector (D-02 / D-15).
 *
 * Every literal below was captured from the pre-Phase-11 implementation. The test
 * must fail on ANY change to `FORECAST_CONFIG`, to the normalization order, to the
 * retained-mass denominator, or to the canonicalization fed into `inputHash`.
 */
const cutoff = "2026-09-13T12:00:00.000Z";

function projection(side: "home" | "away", overrides: Partial<EvidenceProjectionDto> = {}): EvidenceProjectionDto {
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
    ...overrides,
  };
}

function v1Forecast(fixtureId = "fixture-1") {
  return createForecast({ fixtureId, forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: false, sourceReliability: 0.8 });
}

const V1_VECTOR = {
  modelVersion: "poisson-ensemble-v1",
  configVersion: "forecast-config-v1",
  expectedGoals: { home: 1.9575, away: 0.7474999999999999 },
  retainedMass: 0.9990405464847887,
  probabilities: {
    HOME: 0.6585269286216904,
    DRAW: 0.20709279716164194,
    AWAY: 0.13438027421666768,
    OVER_2_5: 0.5071266454039375,
    UNDER_2_5: 0.4928733545960625,
    YES: 0.4520385604653406,
    NO: 0.5479614395346595,
  },
  configHash: "sha256:a08ff17e4ec37822ccce0b68a7ed24ad33c21c5732e2ee812645cac4cc159581",
  inputHash: "sha256:a64fcfc131e521f003391d5d89e481116ccfe8fbc8be99f8bfc68b3e418a7f56",
} as const;

describe("poisson-ensemble-v1 frozen regression vector", () => {
  it("reproduces the committed probabilities, expected goals and retained mass exactly", () => {
    const result = v1Forecast();
    expect(result.modelVersion).toBe(V1_VECTOR.modelVersion);
    expect(result.configVersion).toBe(V1_VECTOR.configVersion);
    expect(result.expectedGoals.home).toBe(V1_VECTOR.expectedGoals.home);
    expect(result.expectedGoals.away).toBe(V1_VECTOR.expectedGoals.away);
    expect(result.retainedMass).toBe(V1_VECTOR.retainedMass);
    for (const events of Object.values(result.markets)) {
      for (const event of events) expect(event.probability).toBe(V1_VECTOR.probabilities[event.selection]);
    }
  });

  it("reproduces the committed config and input hashes exactly", () => {
    const result = v1Forecast();
    expect(result.configHash).toBe(V1_VECTOR.configHash);
    expect(result.inputHash).toBe(V1_VECTOR.inputHash);
    expect(result.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic and independent of the fixture id", () => {
    expect(v1Forecast()).toEqual(v1Forecast());
    const other = v1Forecast("fixture-2");
    expect(other.markets).toEqual(v1Forecast().markets);
    expect(other.inputHash).not.toBe(v1Forecast().inputHash);
  });

  it("keeps the historical v1 config hash reachable through the per-version selector", () => {
    expect(forecastConfigHashFor("poisson-ensemble-v1")).toBe(V1_VECTOR.configHash);
  });
});
