import { describe, expect, it } from "vitest";

import { calculateConfidence, CONFIDENCE_CONFIG } from "../../packages/domain/src/forecast/confidence.js";
import { fairOddsForProbability, FORECAST_CONFIG } from "../../packages/domain/src/forecast/config.js";
import { createForecast } from "../../packages/domain/src/forecast/model.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

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

function forecast(home = projection("home"), away = projection("away")) {
  return createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: false, sourceReliability: 0.8 });
}

describe("forecast mathematical and evidence invariants", () => {
  it.each([projection("home"), projection("home", { components: { ...projection("home").components, goalRates: { ...projection("home").components.goalRates!, value: { for: 100, against: 0 } } } })])("normalizes every marginal from one retained matrix within configured tolerance", (home) => {
    const result = forecast(home);
    expect(result.scoreMatrix).toHaveLength(64);
    expect(result.normalizationVersion).toBe("retained-mass-v1");
    expect(result.retainedMass + result.tailMass).toBeCloseTo(1, 12);
    for (const market of Object.values(result.markets)) expect(Math.abs(market.reduce((sum, item) => sum + item.probability, 0) - 1)).toBeLessThanOrEqual(FORECAST_CONFIG.probabilityTolerance);
    for (const [market, raw] of Object.entries(result.rawMarginals)) expect(raw.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(result.retainedMass, 12, market);
    expect(result.tailWarning).toBe(result.tailMass > FORECAST_CONFIG.tailWarningThreshold);
  });

  it("bounds transforms, lambdas, and the deliberately low H2H contribution", () => {
    const result = forecast();
    expect(result.expectedGoals.home).toBeGreaterThanOrEqual(FORECAST_CONFIG.lambdaBounds[0]);
    expect(result.expectedGoals.home).toBeLessThanOrEqual(FORECAST_CONFIG.lambdaBounds[1]);
    for (const transform of Object.values(result.adjustments.home.components)) expect(transform.applied).toBeGreaterThanOrEqual(transform.bounds[0]);
    for (const transform of Object.values(result.adjustments.home.components)) expect(transform.applied).toBeLessThanOrEqual(transform.bounds[1]);
    expect(Math.abs(result.adjustments.home.components.h2h.applied)).toBeLessThanOrEqual(FORECAST_CONFIG.h2hBounds[1]);
    expect(FORECAST_CONFIG.coefficients.h2h).toBeLessThan(FORECAST_CONFIG.coefficients.form);
  });

  it("keeps exact source fingerprints and output deterministic under source permutation", () => {
    const home = projection("home");
    const extra = { ...home.receipt.inputs[0]!, observationId: "z-observation", payloadHash: "sha256:z" };
    const first = forecast({ ...home, receipt: { ...home.receipt, inputs: [extra, ...home.receipt.inputs] } });
    const second = forecast({ ...home, receipt: { ...home.receipt, inputs: [...home.receipt.inputs, extra] } });
    expect(first).toEqual(second);
    expect(first.sources).toEqual(expect.arrayContaining([extra, home.receipt.inputs[0]]));
  });

  it.each([
    [{ state: "LIMITED" as const }, "HOME_EVIDENCE_LIMITED", "completeness"],
    [{ freshness: "STALE" as const }, "HOME_EVIDENCE_STALE", "freshness"],
    [{ freshness: "UNAVAILABLE" as const }, "HOME_EVIDENCE_UNAVAILABLE", "freshness"],
  ])("surfaces weak evidence and fails its %s confidence component", (override, reason, component) => {
    const result = forecast(projection("home", override));
    expect(result.limitations).toContain(reason);
    expect(result.confidence.components[component as keyof typeof result.confidence.components]).toBe(0);
  });

  it("reports absent components as limitations instead of neutral inputs", () => {
    const base = projection("home");
    const result = forecast({ ...base, components: { ...base.components, goalRates: undefined, elo: undefined } });
    expect(result.limitations).toEqual(expect.arrayContaining(["MISSING_HOME_GOAL_RATES", "MISSING_HOME_ELO"]));
    expect(result.confidence.components.completeness).toBe(0);
  });

  it("keeps confidence as a versioned sibling that cannot alter event probability", () => {
    const withoutLineup = forecast();
    const withLineup = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: true, sourceReliability: 1 });
    expect(withLineup.markets).toEqual(withoutLineup.markets);
    expect(withLineup.confidence.score).toBeGreaterThan(withoutLineup.confidence.score);
    expect(withLineup.confidence.version).toBe(CONFIDENCE_CONFIG.version);
    expect(CONFIDENCE_CONFIG.weights).toEqual({ completeness: 0.3, lineupAvailability: 0.1, freshness: 0.25, sourceReliability: 0.2, modelStability: 0.15 });
  });

  it.each([[0, null], [-1, null], [Number.NaN, null], [Number.POSITIVE_INFINITY, null], [1.1, null], [0.25, "4"]] as const)("returns safe fair odds for %s", (probability, expected) => {
    expect(fairOddsForProbability(probability)).toBe(expected);
  });
});
