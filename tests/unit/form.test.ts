import { describe, expect, it } from "vitest";

async function formModule(): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ new URL("../../packages/domain/src/form.js", import.meta.url).href);
  } catch (error) {
    throw new Error("Missing Phase 2 production symbol: calculateWeightedForm in packages/domain/src/form.ts", { cause: error });
  }
}

describe("weighted form", () => {
  it("D-05 uses the available sample without padding missing evidence to zero", async () => {
    const { calculateWeightedForm } = await formModule() as { calculateWeightedForm: (input: Record<string, unknown>) => Record<string, unknown> };
    const result = calculateWeightedForm({ windowSize: 5, matches: [{ fixtureId: "f-1", kickoffUtc: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", points: 3 }] });
    expect(result).toMatchObject({ sampleSize: 1, requestedWindow: 5, limitation: "LIMITED_SAMPLE" });
    expect(result).not.toMatchObject({ sampleSize: 5 });
  });

  it("D-04 is stable for shuffled input and ties by kickoff, capture time, then fixture ID", async () => {
    const { calculateWeightedForm } = await formModule() as { calculateWeightedForm: (input: Record<string, unknown>) => Record<string, unknown> };
    const matches = [{ fixtureId: "b", kickoffUtc: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", points: 1 }, { fixtureId: "a", kickoffUtc: "2026-08-01T12:00:00.000Z", observedAt: "2026-08-01T15:00:00.000Z", points: 3 }];
    expect(calculateWeightedForm({ windowSize: 5, matches })).toEqual(calculateWeightedForm({ windowSize: 5, matches: [...matches].reverse() }));
  });
});
