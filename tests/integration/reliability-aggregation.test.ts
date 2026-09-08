import { describe, expect, it } from "vitest";

import {
  aggregateReliabilityCohort,
  expandCategoricalScore,
} from "@bet-stats/domain";

describe("reliability cohort aggregation", () => {
  const score = (fixtureId: string, leagueId: string, modelVersion: string, market = "ONE_X_TWO") =>
    expandCategoricalScore({
      settlementReceiptId: `settlement-${fixtureId}`,
      forecastSnapshotId: `forecast-${fixtureId}`,
      fixtureId,
      leagueId,
      market,
      modelVersion,
      kickoffUtc: "2026-09-01T12:00:00.000Z",
      outcome: "HOME",
      probabilities: [
        { selection: "HOME", probability: 0.6 },
        { selection: "DRAW", probability: 0.25 },
        { selection: "AWAY", probability: 0.15 },
      ],
    });

  it("aggregates only the exact requested cohort without widening filters", () => {
    const requested = Array.from({ length: 50 }, (_, index) => score(`target-${index}`, "league-a", "model-a")).flat();
    const noise = [
      ...score("wrong-league", "league-b", "model-a"),
      ...score("wrong-model", "league-a", "model-b"),
      ...score("wrong-market", "league-a", "model-a", "BTTS"),
    ];
    const result = aggregateReliabilityCohort([...requested, ...noise], {
      leagueId: "league-a",
      modelVersion: "model-a",
      market: "ONE_X_TWO",
      fromUtc: "2026-09-01T00:00:00.000Z",
      toUtcExclusive: "2026-10-01T00:00:00.000Z",
    });

    expect(result.denominators).toEqual({ fixtureCount: 50, forecastCount: 50, eventCount: 150, valueCount: 0 });
    expect(result.reliability.eventCount).toBe(150);
    expect(result.cohort).toMatchObject({ leagueId: "league-a", modelVersion: "model-a", market: "ONE_X_TWO" });
  });

  it("does not silently substitute a broader cohort when no rows match", () => {
    const result = aggregateReliabilityCohort(score("fixture-1", "league-a", "model-a"), {
      leagueId: "missing",
      modelVersion: "model-a",
      market: "ONE_X_TWO",
      fromUtc: "2026-09-01T00:00:00.000Z",
      toUtcExclusive: "2026-10-01T00:00:00.000Z",
    });
    expect(result.health).toMatchObject({ state: "UNAVAILABLE", reasons: ["NO_SCOREABLE_FIXTURES"] });
    expect(result.denominators.fixtureCount).toBe(0);
  });
});
