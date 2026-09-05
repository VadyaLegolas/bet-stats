import { describe, expect, it } from "vitest";

import { createForecast } from "../../packages/domain/src/forecast/model.js";
import { normalizeOddsBook } from "../../packages/domain/src/odds/normalize.js";
import { decideValue } from "../../packages/domain/src/value/decision.js";

const cutoff = "2026-09-12T12:00:00.000Z";

function projection(teamId: string, buildId: string, values: Partial<Record<string, unknown>> = {}) {
  const source = { fixtureId: `${teamId}-history`, effectiveAt: "2026-09-01T12:00:00.000Z", observedAt: "2026-09-01T14:00:00.000Z", sourceUpdatedAt: null, payloadHash: `sha256:${teamId}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, unit: string, sampleSize = 10) => ({ kind, value, unit, sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE" as const,
    freshness: "FRESH" as const,
    buildId,
    publishedAt: "2026-09-12T12:00:01.000Z",
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", 2.1, "points-per-match", 5),
      form10: component("form10", 1.9, "points-per-match"),
      elo: component("elo", teamId === "home" ? 1580 : 1490, "rating-points"),
      homeStrength: component("homeStrength", 2.2, "points-per-match"),
      awayStrength: component("awayStrength", 1.1, "points-per-match"),
      goalRates: component("goalRates", teamId === "home" ? { for: 1.9, against: 1.0 } : { for: 1.1, against: 1.6 }, "goals-per-match"),
      restDays: component("restDays", 6, "days", 1),
      h2h: component("h2h", { pointsPerMatch: 1.8, weight: 0.03 }, "points-per-match", 4),
      ...values,
    },
  };
}

describe("forecast to manual value tracer", () => {
  it("derives every market from one 64-cell matrix and produces a reproducible value receipt", () => {
    const forecast = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home", "build-home"), away: projection("away", "build-away"), lineupAvailable: false, sourceReliability: 0.95 });
    expect(forecast.scoreMatrix).toHaveLength(64);
    expect(forecast.retainedMass + forecast.tailMass).toBeCloseTo(1, 12);
    expect(forecast.markets.ONE_X_TWO.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 12);
    expect(forecast.markets.OVER_UNDER_2_5.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 12);
    expect(forecast.markets.BTTS.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 12);

    const odds = normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "manual-test", capturedAt: cutoff, selections: [{ selection: "HOME", decimalOdds: "2.40" }, { selection: "DRAW", decimalOdds: "3.40" }, { selection: "AWAY", decimalOdds: "3.10" }] });
    expect(odds.selections.reduce((sum, item) => sum + Number(item.noVigProbability), 0)).toBeCloseTo(1, 12);
    expect(Number(odds.overround)).toBeGreaterThan(0);

    const result = decideValue({ forecast, odds, selection: "HOME" });
    expect(result.outcome).toBe("VALUE_CANDIDATE");
    expect(result.receipt).toMatchObject({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", cutoff, modelVersion: "poisson-ensemble-v1", configVersion: "forecast-config-v1", valuePolicyVersion: "value-policy-v1", evidenceBuildIds: ["build-away", "build-home"] });
    expect(result.receipt.sources.length).toBeGreaterThan(0);
    expect(result.receipt.gates.every((gate) => gate.passed)).toBe(true);
    expect(result.receipt.formulas).toContain("expectedValue=modelProbability*decimalOdds-1");
  });

  it("returns NO_VALUE for sufficient evidence that misses value thresholds", () => {
    const forecast = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home", "build-home"), away: projection("away", "build-away"), lineupAvailable: true, sourceReliability: 1 });
    const odds = normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "manual-test", capturedAt: cutoff, selections: [{ selection: "HOME", decimalOdds: "1.20" }, { selection: "DRAW", decimalOdds: "7.00" }, { selection: "AWAY", decimalOdds: "12.00" }] });
    const result = decideValue({ forecast, odds, selection: "HOME" });
    expect(result.outcome).toBe("NO_VALUE");
    expect(result.reasons).toEqual(expect.arrayContaining(["EDGE_BELOW_THRESHOLD", "EV_BELOW_THRESHOLD"]));
  });

  it("returns ordered INSUFFICIENT_EVIDENCE reasons before value gates", () => {
    const forecast = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "UNRESOLVED", home: projection("home", "build-home"), away: projection("away", "build-away", { goalRates: undefined }), lineupAvailable: false, sourceReliability: 0.4 });
    const odds = normalizeOddsBook({ fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "manual-test", capturedAt: cutoff, selections: [{ selection: "HOME", decimalOdds: "9.00" }, { selection: "DRAW", decimalOdds: "9.00" }, { selection: "AWAY", decimalOdds: "1.20" }] });
    const result = decideValue({ forecast, odds, selection: "HOME" });
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.slice(0, 2)).toEqual(["UNRESOLVED_CANONICAL_IDENTITY", "MISSING_AWAY_GOAL_RATES"]);
  });
});
