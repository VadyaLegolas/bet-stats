import { describe, expect, it } from "vitest";

import { calculateWeightedForm, selectEligibleEvidence } from "../../packages/domain/src/index.js";

const cutoff = "2026-08-02T00:00:00.000Z";
const match = (fixtureId: string, points: 0 | 1 | 3, overrides: Record<string, unknown> = {}) => ({ fixtureId, kickoffUtc: "2026-08-01T12:00:00.000Z", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", sourceUpdatedAt: null, payloadHash: `sha256:${fixtureId}`, payloadBytes: 10, points, ...overrides });

describe("weighted form evidence", () => {
  it("excludes later corrections and future-effective facts at the exact UTC cutoff", () => {
    const result = selectEligibleEvidence({ asOf: cutoff, matches: [match("eligible", 3), match("late", 0, { observedAt: "2026-08-03T00:00:00.000Z" }), match("future", 1, { effectiveAt: "2026-08-03T00:00:00.000Z" })] });
    expect(result.map(({ fixtureId }) => fixtureId)).toEqual(["eligible"]);
  });

  it("is permutation invariant and ties by kickoff, observation, then fixture ID", () => {
    const matches = [match("b", 1), match("a", 3)];
    const forward = calculateWeightedForm({ asOf: cutoff, windowSize: 5, matches });
    const reverse = calculateWeightedForm({ asOf: cutoff, windowSize: 5, matches: [...matches].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward.sourceRefs.map(({ fixtureId }) => fixtureId)).toEqual(["a", "b"]);
  });

  it.each([0, 1, 5, 10])("reports an honest sample for %i available matches", (count) => {
    const matches = Array.from({ length: count }, (_, index) => match(`f-${index}`, 3, { effectiveAt: new Date(Date.parse("2026-07-01T12:00:00.000Z") + index * 86_400_000).toISOString(), kickoffUtc: new Date(Date.parse("2026-07-01T12:00:00.000Z") + index * 86_400_000).toISOString() }));
    const result = calculateWeightedForm({ asOf: cutoff, windowSize: 10, matches, historyTruncated: count > 0 && count < 10 });
    expect(result.sampleSize).toBe(count);
    expect(result.value).toBe(count === 0 ? null : 3);
    expect(result.limitation).toBe(count === 0 ? "NO_ELIGIBLE_HISTORY" : count < 10 ? "LIMITED_HISTORY" : null);
  });

  it("echoes cutoff, source coverage, bounds, and nullable source update time", () => {
    const result = calculateWeightedForm({ asOf: "2026-08-02T02:00:00+02:00", windowSize: 5, requestedFrom: "2026-07-01T00:00:00.000Z", requestedTo: cutoff, returnedFrom: "2026-08-01T00:00:00.000Z", returnedTo: cutoff, historyTruncated: true, matches: [match("f-1", 3)] });
    expect(result).toMatchObject({ requestedAsOf: "2026-08-02T02:00:00+02:00", resolvedAsOf: cutoff, sampleSize: 1, limitation: "LIMITED_HISTORY", oldestSourceUpdatedAt: null, newestSourceUpdatedAt: null, sourceWindow: { requestedFrom: "2026-07-01T00:00:00.000Z", returnedFrom: "2026-08-01T00:00:00.000Z" } });
  });
});
