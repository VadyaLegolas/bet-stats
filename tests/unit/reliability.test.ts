import { describe, expect, it } from "vitest";

import {
  RELIABILITY_POLICY,
  aggregateReliability,
  assignReliabilityBucket,
  expandCategoricalScore,
} from "../../packages/domain/src/index.js";

describe("reliability-policy-v1", () => {
  it("assigns exact boundaries deterministically and closes the final edge", () => {
    expect([0, 0.1, 0.2, 0.9, 1].map((probability) => assignReliabilityBucket(probability, 10)))
      .toEqual([0, 1, 2, 9, 9]);
    expect(() => assignReliabilityBucket(-0.001, 10)).toThrow("INVALID_RELIABILITY_PROBABILITY");
  });

  it("expands a categorical score into selection-level binary events", () => {
    const events = expandCategoricalScore({
      settlementReceiptId: "settlement-1",
      forecastSnapshotId: "forecast-1",
      fixtureId: "fixture-1",
      leagueId: "league-1",
      market: "ONE_X_TWO",
      modelVersion: "model-v1",
      kickoffUtc: "2026-09-01T12:00:00.000Z",
      outcome: "DRAW",
      probabilities: [
        { selection: "HOME", probability: 0.5 },
        { selection: "DRAW", probability: 0.3 },
        { selection: "AWAY", probability: 0.2 },
      ],
    });
    expect(events.map(({ selection, probability, observed }) => ({ selection, probability, observed })))
      .toEqual([
        { selection: "HOME", probability: 0.5, observed: 0 },
        { selection: "DRAW", probability: 0.3, observed: 1 },
        { selection: "AWAY", probability: 0.2, observed: 0 },
      ]);
  });

  it("reports population, signed gap, direction, and insufficient bucket status", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      probability: 0.6,
      observed: index < 13 ? 1 as const : 0 as const,
    }));
    const bucket = aggregateReliability(events, RELIABILITY_POLICY).buckets[6]!;
    expect(bucket).toMatchObject({
      meanForecast: 0.6,
      observedFrequency: 0.65,
      count: 20,
      gap: 0.05,
      direction: "UNDER_CONFIDENT",
      evidenceState: "SUFFICIENT",
    });
    expect(aggregateReliability(events.slice(0, 19), RELIABILITY_POLICY).buckets[6])
      .toMatchObject({ count: 19, evidenceState: "INSUFFICIENT" });
  });

  it("preserves event counts and weighted means across sensitivity vectors", () => {
    const events = Array.from({ length: 101 }, (_, index) => ({
      probability: index / 100,
      observed: index % 3 === 0 ? 1 as const : 0 as const,
    }));
    for (const bucketCount of [5, 10, 20]) {
      const result = aggregateReliability(events, { ...RELIABILITY_POLICY, bucketCount });
      const total = result.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
      const weightedMean = result.buckets.reduce((sum, bucket) => sum + bucket.meanForecast * bucket.count, 0) / total;
      expect(total).toBe(events.length);
      expect(weightedMean).toBeCloseTo(0.5, 12);
    }
  });

  it("uses the configured alignment tolerance", () => {
    const aligned = aggregateReliability(
      Array.from({ length: 20 }, (_, index) => ({ probability: 0.5, observed: index < 10 ? 1 as const : 0 as const })),
      RELIABILITY_POLICY,
    ).buckets[5]!;
    expect(aligned.direction).toBe("ALIGNED");
    expect(RELIABILITY_POLICY).toMatchObject({ version: "reliability-policy-v1", bucketCount: 10, minimumBucketCount: 20, alignmentTolerance: 0.02 });
    expect(RELIABILITY_POLICY.identity).toMatch(/^sha256:/);
  });
});
