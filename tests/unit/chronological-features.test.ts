import { describe, expect, it } from "vitest";

import { buildTeamEvidence } from "../../packages/domain/src/index.js";

const match = (fixtureId: string, overrides: Record<string, unknown> = {}) => ({ fixtureId, kickoffUtc: "2026-08-01T12:00:00.000Z", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", sourceUpdatedAt: null, payloadHash: `hash:${fixtureId}`, payloadBytes: 20, teamId: "team", opponentId: "opponent", venue: "HOME", goalsFor: 2, goalsAgainst: 1, points: 3, ...overrides });

describe("chronological feature contract", () => {
  it("D-02 excludes facts whose effective or observed time is after the cutoff", () => {
    const matches = [match("eligible"), match("late-capture", { observedAt: "2026-08-03T15:00:00.000Z" }), match("future-event", { effectiveAt: "2026-08-04T12:00:00.000Z" })];
    expect(buildTeamEvidence({ teamId: "team", asOf: "2026-08-02T00:00:00.000Z", matches }).receipt.inputs.map(({ fixtureId }) => fixtureId)).toEqual(["eligible"]);
  });

  it("D-06 returns separate null components with reasons for missing evidence", () => {
    const result = buildTeamEvidence({ teamId: "team", asOf: "2026-08-02T00:00:00.000Z", matches: [] });
    expect(result).toMatchObject({ form5: { value: null, sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY" }, restDays: { value: null, limitation: "NO_ELIGIBLE_HISTORY" }, elo: { value: 1500, sampleSize: 0 } });
  });

  it("is deterministic under permutation and limits H2H contribution to five percent", () => {
    const matches = [match("b", { opponentId: "rival" }), match("a", { opponentId: "rival", goalsFor: 0, goalsAgainst: 1, points: 0 })];
    const result = buildTeamEvidence({ teamId: "team", opponentId: "rival", asOf: "2026-08-02T00:00:00.000Z", matches });
    expect(result).toEqual(buildTeamEvidence({ teamId: "team", opponentId: "rival", asOf: "2026-08-02T00:00:00.000Z", matches: [...matches].reverse() }));
    expect(result.h2h.value?.weight).toBeLessThanOrEqual(0.05);
  });

  it("exposes versioned reproducible inputs and no aggregate confidence or forecast", () => {
    const result = buildTeamEvidence({ teamId: "team", asOf: "2026-08-02T00:00:00.000Z", historyTruncated: true, matches: [match("f-1", { payloadHash: "sha256:abc", payloadBytes: 15 })] });
    expect(result).toMatchObject({ state: "LIMITED", receipt: { configVersion: "evidence-v1", inputs: [{ fixtureId: "f-1", payloadHash: "sha256:abc", payloadBytes: 15 }] }, goalRates: { value: { for: 2, against: 1 } } });
    expect(result).not.toHaveProperty("confidence");
    expect(result).not.toHaveProperty("forecast");
  });
});
