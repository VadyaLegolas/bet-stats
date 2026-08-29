import { describe, expect, it } from "vitest";

async function chronologicalModule(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../packages/domain/src/chronological-features.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: buildChronologicalFeatures in packages/domain/src/chronological-features.ts", { cause: error });
  }
}

describe("chronological feature contract", () => {
  it("D-02 excludes facts whose effective or observed time is after the cutoff", async () => {
    const { buildChronologicalFeatures } = await chronologicalModule() as { buildChronologicalFeatures: (input: Record<string, unknown>) => Record<string, unknown> };
    const matches = [{ fixtureId: "eligible", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z" }, { fixtureId: "late-capture", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-03T15:00:00.000Z" }, { fixtureId: "future-event", effectiveAt: "2026-08-04T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z" }];
    expect(buildChronologicalFeatures({ asOf: "2026-08-02T00:00:00.000Z", matches })).toMatchObject({ inputFixtureIds: ["eligible"] });
  });

  it("D-06 returns null with a limitation reason for missing evidence", async () => {
    const { buildChronologicalFeatures } = await chronologicalModule() as { buildChronologicalFeatures: (input: Record<string, unknown>) => Record<string, unknown> };
    const result = buildChronologicalFeatures({ asOf: "2026-08-02T00:00:00.000Z", matches: [] });
    expect(result).toMatchObject({ form5: { value: null, sampleSize: 0, limitation: "NO_ELIGIBLE_HISTORY" }, restDays: { value: null, limitation: "NO_ELIGIBLE_PRIOR_MATCH" } });
  });

  it("uses observedAt as the cutoff clock when sourceUpdatedAt is absent and labels truncated history LIMITED", async () => {
    const { buildChronologicalFeatures } = await chronologicalModule() as { buildChronologicalFeatures: (input: Record<string, unknown>) => Record<string, unknown> };
    const result = buildChronologicalFeatures({ asOf: "2026-08-02T00:00:00.000Z", historyTruncated: true, matches: [{ fixtureId: "f-1", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", sourceUpdatedAt: null }] });
    expect(result).toMatchObject({ state: "LIMITED", newestSourceUpdatedAt: null, newestObservedAt: "2026-08-01T15:00:00.000Z" });
  });

  it("keeps raw payload identity immutable and exposes hash and byte size in the receipt", async () => {
    const { buildChronologicalFeatures } = await chronologicalModule() as { buildChronologicalFeatures: (input: Record<string, unknown>) => Record<string, unknown> };
    const result = buildChronologicalFeatures({ asOf: "2026-08-02T00:00:00.000Z", matches: [{ fixtureId: "f-1", effectiveAt: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", rawPayload: { score: "2-1" }, payloadHash: "sha256:abc", payloadBytes: 15 }] });
    expect(result).toMatchObject({ receipt: { inputs: [{ fixtureId: "f-1", payloadHash: "sha256:abc", payloadBytes: 15 }] } });
  });
});
