import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeDueKinds, computeInitialCutoff, EVIDENCE_CONFIG_HASH, runForecastPublicationSweep } from "../../workers/data-sync/src/jobs/forecast-sweep.js";

const kickoff = "2026-11-08T18:00:00.000Z";
// kickoff minus 7d = 2026-11-01T18:00:00.000Z; kickoff minus 6h = 2026-11-08T12:00:00.000Z

function at(offsetHours: number): string {
  return new Date(Date.parse(kickoff) + offsetHours * 60 * 60 * 1_000).toISOString();
}

describe("forecast sweep due-kind policy", () => {
  it("returns no kinds before either cutoff", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-168.001), issuedKinds: [] })).toEqual([]);
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-169), issuedKinds: [] })).toEqual([]);
  });

  it("returns INITIAL exactly at kickoff minus 7d and until kickoff minus 6h", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-168), issuedKinds: [] })).toEqual(["INITIAL"]);
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-12), issuedKinds: [] })).toEqual(["INITIAL"]);
  });

  it("returns PRE_MATCH exactly at kickoff minus 6h together with INITIAL", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-6), issuedKinds: [] })).toEqual(["INITIAL", "PRE_MATCH"]);
  });

  it("returns both kinds for a fixture less than 6h away with nothing issued", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-1), issuedKinds: [] })).toEqual(["INITIAL", "PRE_MATCH"]);
  });

  it("removes kinds already in ISSUED state so later ticks never re-issue them", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-1), issuedKinds: ["INITIAL"] })).toEqual(["PRE_MATCH"]);
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-1), issuedKinds: ["INITIAL", "PRE_MATCH"] })).toEqual([]);
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-12), issuedKinds: ["PRE_MATCH"] })).toEqual(["INITIAL"]);
  });

  it("ignores unrelated issued kinds and tolerates an invalid kickoff without crashing", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-12), issuedKinds: ["LINEUP_CONFIRMED"] })).toEqual(["INITIAL"]);
    expect(computeDueKinds({ kickoffUtc: "not-a-date", now: at(-12), issuedKinds: [] })).toEqual([]);
  });
});

describe("forecast sweep initial cutoff policy", () => {
  it("returns kickoff minus 7d when that moment is still ahead", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-200) })).toBe("2026-11-01T18:00:00.000Z");
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-200), issuedKinds: [] })).toEqual([]);
  });

  it("returns the issue moment for a late-discovered fixture whose kickoff minus 7d already passed", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-20) })).toBe(at(-20));
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-20), issuedKinds: [] })).toEqual(["INITIAL"]);
  });

  it("anchors at kickoff minus 7d exactly at the boundary", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-168) })).toBe("2026-11-01T18:00:00.000Z");
  });
});

describe("evidence config hash", () => {
  it("is the sha256 hex digest of the evidence-v1 config literal", () => {
    expect(EVIDENCE_CONFIG_HASH).toBe(createHash("sha256").update("evidence-v1", "utf8").digest("hex"));
    expect(EVIDENCE_CONFIG_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("forecast sweep DB-only contract", () => {
  it("completes one full tick with zero fixture_failed when the deps supply no enqueue function at all", async () => {
    const nowDate = new Date("2026-11-01T00:00:00.000Z");
    const events: Array<Record<string, unknown>> = [];
    const database = {
      fixture: {
        findMany: async () => [
          {
            id: "3f2a1b7c-0000-4000-8000-000000000001",
            kickoffUtc: new Date("2026-11-11T00:00:00.000Z"),
            homeTeamId: "3f2a1b7c-0000-4000-8000-0000000000a1",
            awayTeamId: "3f2a1b7c-0000-4000-8000-0000000000a2",
          },
        ],
      },
      forecastSnapshot: { findMany: async () => [] },
    };
    const deps = {
      database,
      now: () => nowDate,
      logger: (event: Record<string, unknown>) => { events.push(event); },
    } as unknown as Parameters<typeof runForecastPublicationSweep>[0];

    const result = await runForecastPublicationSweep(deps);

    expect(result).toEqual({ fixtures: 1, issued: 0, skipped: 0 });
    expect(events.some((event) => event.event === "forecast.sweep.completed")).toBe(true);
    expect(events.filter((event) => event.event === "forecast.sweep.fixture_failed")).toEqual([]);
  });
});
