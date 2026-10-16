import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeDueKinds, computeInitialCutoff, EVIDENCE_CONFIG_HASH } from "../../workers/data-sync/src/jobs/forecast-sweep.js";

const kickoff = "2026-11-08T18:00:00.000Z";
// kickoff minus 24h = 2026-11-07T18:00:00.000Z; kickoff minus 6h = 2026-11-08T12:00:00.000Z

function at(offsetHours: number): string {
  return new Date(Date.parse(kickoff) + offsetHours * 60 * 60 * 1_000).toISOString();
}

describe("forecast sweep due-kind policy", () => {
  it("returns no kinds before either cutoff", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-48), issuedKinds: [] })).toEqual([]);
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-24.001), issuedKinds: [] })).toEqual([]);
  });

  it("returns INITIAL exactly at kickoff minus 24h and until kickoff minus 6h", () => {
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-24), issuedKinds: [] })).toEqual(["INITIAL"]);
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
  it("returns kickoff minus 24h when that moment is still ahead", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-48) })).toBe("2026-11-07T18:00:00.000Z");
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-48), issuedKinds: [] })).toEqual([]);
  });

  it("returns the issue moment for a late-discovered fixture whose kickoff minus 24h already passed", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-20) })).toBe(at(-20));
    expect(computeDueKinds({ kickoffUtc: kickoff, now: at(-20), issuedKinds: [] })).toEqual(["INITIAL"]);
  });

  it("anchors at kickoff minus 24h exactly at the boundary", () => {
    expect(computeInitialCutoff({ kickoffUtc: kickoff, now: at(-24) })).toBe("2026-11-07T18:00:00.000Z");
  });
});

describe("evidence config hash", () => {
  it("is the sha256 hex digest of the evidence-v1 config literal", () => {
    expect(EVIDENCE_CONFIG_HASH).toBe(createHash("sha256").update("evidence-v1", "utf8").digest("hex"));
    expect(EVIDENCE_CONFIG_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
