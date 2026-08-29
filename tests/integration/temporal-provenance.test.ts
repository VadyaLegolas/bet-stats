import { describe, expect, it } from "vitest";

async function phase2Persistence(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../workers/data-sync/src/persistence/observations.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: persistObservedFact in workers/data-sync/src/persistence/observations.ts", { cause: error });
  }
}

describe("temporal provenance contract", () => {
  it("D-01/D-14 commits an immutable observation and normalized fact in one transaction", async () => {
    const { persistObservedFact } = await phase2Persistence() as { persistObservedFact: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const result = await persistObservedFact({ provider: "football-data.org", endpoint: "RESULTS", observedAt: "2026-08-29T10:00:00.000Z", sourceUpdatedAt: null, rawPayload: { fixture: 42, home: 2, away: 1 }, fact: { fixtureId: "fixture-42", homeGoals: 2, awayGoals: 1 } });
    expect(result).toMatchObject({ observation: { provider: "football-data.org", endpoint: "RESULTS", sourceUpdatedAt: null }, fact: { fixtureId: "fixture-42" }, committedAtomically: true });
    expect(result.observation).toHaveProperty("payloadHash");
    expect(result.observation).toHaveProperty("rawPayload");
  });

  it("D-03 appends corrections instead of rewriting an observation visible at an earlier cutoff", async () => {
    const { persistObservedFact } = await phase2Persistence() as { persistObservedFact: (input: Record<string, unknown>) => Promise<Record<string, unknown>> };
    const first = await persistObservedFact({ provider: "football-data.org", endpoint: "RESULTS", observedAt: "2026-08-29T10:00:00.000Z", rawPayload: { fixture: 42, home: 2, away: 1 }, fact: { fixtureId: "fixture-42", homeGoals: 2, awayGoals: 1 } });
    const correction = await persistObservedFact({ provider: "football-data.org", endpoint: "RESULTS", observedAt: "2026-08-30T10:00:00.000Z", rawPayload: { fixture: 42, home: 1, away: 1 }, fact: { fixtureId: "fixture-42", homeGoals: 1, awayGoals: 1 }, supersedesObservationId: (first.observation as { id: string }).id });
    expect((correction.observation as { id: string }).id).not.toBe((first.observation as { id: string }).id);
    expect(correction).toMatchObject({ supersedesObservationId: (first.observation as { id: string }).id });
  });
});
