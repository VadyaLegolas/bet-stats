import { describe, expect, it } from "vitest";

import { compareForecastPair, parseForecastComparisonRequest } from "../../packages/domain/src/forecast/comparison.js";
import type { ForecastResponseDto } from "../../packages/domain/src/forecast/contract.js";

describe("forecast comparison contract", () => {
  it("rejects unknown request fields and identical IDs", () => {
    expect(parseForecastComparisonRequest({ leftId: "left", rightId: "right" })).toEqual({ leftId: "left", rightId: "right" });
    expect(() => parseForecastComparisonRequest({ leftId: "left", rightId: "right", latest: true })).toThrow("UNKNOWN_FORECAST_COMPARISON_KEY");
    expect(() => parseForecastComparisonRequest({ leftId: "same", rightId: "same" })).toThrow("FORECAST_PAIR_MUST_DIFFER");
  });

  it("calculates stable semantic deltas without replacing either selected receipt", () => {
    const left = snapshot("left", "INITIAL", 0.45, ["SOURCE_A"], 0.6, 1.2);
    const right = snapshot("right", "PRE_MATCH", 0.5, ["SOURCE_B"], 0.7, 1.4);
    const result = compareForecastPair(left, right);
    expect(result).toMatchObject({ fixtureId: "fixture-1", left: { id: "left" }, right: { id: "right" }, cutoff: { direction: "increase" }, expectedGoals: { home: { delta: 0.2, direction: "increase" } }, confidence: { score: { delta: 0.1, direction: "increase" } }, limitations: { added: ["SOURCE_B"], removed: ["SOURCE_A"] } });
    expect(result.sources).toEqual({ added: ["provider:B"], removed: ["provider:A"] });
    expect(result.probabilities.map((entry) => `${entry.market}:${entry.selection}`)).toEqual(["ONE_X_TWO:HOME", "ONE_X_TWO:DRAW", "ONE_X_TWO:AWAY", "OVER_UNDER_2_5:OVER_2_5", "OVER_UNDER_2_5:UNDER_2_5", "BTTS:YES", "BTTS:NO"]);
    expect(result.probabilities[0]).toMatchObject({ left: 0.45, right: 0.5, delta: 0.05, direction: "increase" });
  });
});

export function snapshot(id: string, kind: ForecastResponseDto["kind"], home: number, limitations: string[], confidence: number, homeXg: number): ForecastResponseDto {
  const oneXTwo = [home, 0.25, 0.75 - home];
  return {
    id, fixtureId: "fixture-1", kind, officialLineupObservationId: kind === "LINEUP_CONFIRMED" ? "lineup-1" : null, revision: 1,
    cutoff: kind === "INITIAL" ? "2026-09-12T10:00:00.000Z" : "2026-09-12T11:00:00.000Z", modelVersion: "poisson-ensemble-v1", modelHash: "model", configVersion: "forecast-config-v1", configHash: "config", inputHash: `input-${id}`, evidenceFingerprint: `evidence-${id}`, evidenceBuildIds: ["away", "home"],
    probabilities: { ONE_X_TWO: ["HOME", "DRAW", "AWAY"].map((selection, index) => ({ selection, probability: oneXTwo[index]!, fairOdds: "2" })) as never, OVER_UNDER_2_5: [{ selection: "OVER_2_5", probability: 0.4, fairOdds: "2.5" }, { selection: "UNDER_2_5", probability: 0.6, fairOdds: "1.67" }], BTTS: [{ selection: "YES", probability: 0.45, fairOdds: "2.22" }, { selection: "NO", probability: 0.55, fairOdds: "1.82" }] },
    confidence: { version: "confidence-v1", score: confidence, components: { completeness: confidence, lineupAvailability: kind === "LINEUP_CONFIRMED" ? 1 : 0, freshness: 1, sourceReliability: confidence, modelStability: 1 } }, limitations,
    tail: { retainedMass: 1, tailMass: 0, warning: false, normalizationVersion: "retained-mass-v1" }, assumptions: [],
    receipt: { forecastSnapshotId: id, officialLineupObservationId: kind === "LINEUP_CONFIRMED" ? "lineup-1" : null, evidenceBuildIds: ["away", "home"], sourceRefs: [{ fixtureId: `provider:${id === "left" ? "A" : "B"}`, effectiveAt: "2026-09-01T00:00:00.000Z", observedAt: "2026-09-01T00:00:00.000Z", sourceUpdatedAt: null, payloadHash: `hash-${id}`, payloadBytes: 1 }], expectedGoals: { home: homeXg, away: 1 }, adjustments: { home: { multiplier: homeXg, components: {} as never }, away: { multiplier: 1, components: {} as never } } }, issuedAt: "2026-09-12T11:00:01.000Z",
  };
}
