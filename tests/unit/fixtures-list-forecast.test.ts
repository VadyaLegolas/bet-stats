import { describe, expect, it } from "vitest";

import { summarizeLatestForecasts, type AttachedForecast } from "../../apps/api/src/modules/fixtures/fixtures.service.js";

type SnapshotRow = { fixtureId: string; kind: unknown; cutoff: Date | string; probabilities: unknown };

const event = (selection: string, probability: number) => ({ selection, probability, fairOdds: probability === 0 ? Number.POSITIVE_INFINITY : 1 / probability });
const oneXTwo = (...events: Array<{ selection: string; probability: number }>): unknown => ({ ONE_X_TWO: events });
const validProbabilities = (): unknown => oneXTwo(event("HOME", 0.5), event("DRAW", 0.3), event("AWAY", 0.2));
const row = (fixtureId: string, overrides: Partial<Omit<SnapshotRow, "fixtureId">> = {}): SnapshotRow => ({
  fixtureId,
  kind: overrides.kind ?? "ONE_X_TWO",
  cutoff: overrides.cutoff ?? new Date("2026-10-17T12:00:00.000Z"),
  probabilities: overrides.probabilities ?? validProbabilities(),
});

describe("summarizeLatestForecasts", () => {
  it("accepts the newest pre-sorted row per fixture and ignores the older one", () => {
    const summaries = summarizeLatestForecasts([
      row("fx-1", { cutoff: new Date("2026-10-17T10:00:00.000Z"), probabilities: oneXTwo(event("HOME", 0.6), event("DRAW", 0.25), event("AWAY", 0.15)) }),
      row("fx-1", { cutoff: new Date("2026-10-16T10:00:00.000Z"), probabilities: oneXTwo(event("HOME", 0.4), event("DRAW", 0.35), event("AWAY", 0.25)) }),
    ]);
    expect(summaries.size).toBe(1);
    expect(summaries.get("fx-1")).toEqual({ kind: "ONE_X_TWO", cutoff: "2026-10-17T10:00:00.000Z", probabilities: { home: 0.6, draw: 0.25, away: 0.15 } });
  });

  it("falls through a malformed newest snapshot to the next valid row for the same fixture", () => {
    const summaries = summarizeLatestForecasts([
      row("fx-1", { probabilities: oneXTwo(event("HOME", 0.6), event("DRAW", 0.4)) }),
      row("fx-1", { cutoff: new Date("2026-10-16T10:00:00.000Z") }),
    ]);
    expect(summaries.get("fx-1")).toEqual({ kind: "ONE_X_TWO", cutoff: "2026-10-16T10:00:00.000Z", probabilities: { home: 0.5, draw: 0.3, away: 0.2 } });
  });

  it("skips rows whose probabilities lack the ONE_X_TWO key", () => {
    expect(summarizeLatestForecasts([row("fx-1", { probabilities: { OVER_UNDER_2_5: [event("OVER_2_5", 0.6), event("UNDER_2_5", 0.4)] } })]).size).toBe(0);
  });

  it("skips rows whose ONE_X_TWO holds only foreign selections", () => {
    expect(summarizeLatestForecasts([row("fx-1", { probabilities: oneXTwo(event("OVER_2_5", 0.6), event("UNDER_2_5", 0.4)) })]).size).toBe(0);
  });

  it("skips rows missing any of the HOME/DRAW/AWAY selections", () => {
    expect(summarizeLatestForecasts([row("fx-1", { probabilities: oneXTwo(event("HOME", 0.7), event("DRAW", 0.3)) })]).size).toBe(0);
    expect(summarizeLatestForecasts([row("fx-1", { probabilities: oneXTwo(event("HOME", 1)) })]).size).toBe(0);
  });

  it("skips rows with non-finite or out-of-range probabilities", () => {
    for (const probability of [Number.NaN, Number.POSITIVE_INFINITY, 1.2, -0.1]) {
      expect(summarizeLatestForecasts([row("fx-1", { probabilities: oneXTwo(event("HOME", probability), event("DRAW", 0.3), event("AWAY", 0.2)) })]).size).toBe(0);
    }
  });

  it("matches events by selection regardless of array position", () => {
    const summaries = summarizeLatestForecasts([row("fx-1", { probabilities: oneXTwo(event("AWAY", 0.2), event("DRAW", 0.3), event("HOME", 0.5)) })]);
    expect(summaries.get("fx-1")?.probabilities).toEqual({ home: 0.5, draw: 0.3, away: 0.2 });
  });

  it("skips rows with an empty kind", () => {
    expect(summarizeLatestForecasts([row("fx-1", { kind: "" })]).size).toBe(0);
  });

  it("normalizes Date and string cutoffs to ISO strings", () => {
    const summaries = summarizeLatestForecasts([
      row("fx-1", { cutoff: new Date("2026-10-17T12:00:00.000Z") }),
      row("fx-2", { cutoff: "2026-10-18T09:30:00.000Z" }),
    ]);
    expect(summaries.get("fx-1")?.cutoff).toBe("2026-10-17T12:00:00.000Z");
    expect(summaries.get("fx-2")?.cutoff).toBe("2026-10-18T09:30:00.000Z");
  });

  it("returns an empty map for empty input and omits fixtures whose only rows are invalid", () => {
    expect(summarizeLatestForecasts([]).size).toBe(0);
    const summaries: ReadonlyMap<string, AttachedForecast> = summarizeLatestForecasts([row("fx-valid"), row("fx-broken", { kind: "" })]);
    expect(summaries.has("fx-valid")).toBe(true);
    expect(summaries.has("fx-broken")).toBe(false);
  });
});
