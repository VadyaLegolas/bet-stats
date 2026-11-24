import { describe, expect, it } from "vitest";

import { calculateComparableClv, ODDS_RATIO_CLV_POLICY_VERSION } from "../../packages/domain/src/evaluation/clv.js";
import { calculateNoVigClv, NO_VIG_CLV_POLICY_VERSION, type NoVigClvInput, type NoVigClvPriceSet } from "../../packages/domain/src/evaluation/no-vig-clv.js";

const KICKOFF = "2026-12-01T20:00:00.000Z";
const CANDIDATE_AT = "2026-11-28T10:00:00.000Z";
const CLOSING_AT = "2026-12-01T19:55:00.000Z";
const SOURCE = "manual-source-a";

function set(sourceConvention: string, observedAt: string, odds: readonly [string, string, string]): NoVigClvPriceSet {
  return { sourceConvention, observedAt, selections: [{ selection: "HOME", decimalOdds: odds[0] }, { selection: "DRAW", decimalOdds: odds[1] }, { selection: "AWAY", decimalOdds: odds[2] }] };
}

// 1X2 by hand. Candidate 2 / 3.5 / 4: implied 1/2, 2/7, 1/4, total 29/28 -> fair HOME 14/29, DRAW 8/29.
// Closing 1.8 / 4 / 5: implied 5/9, 1/4, 1/5, total 181/180 -> fair HOME 100/181, DRAW 45/181.
const input: NoVigClvInput = {
  market: "ONE_X_TWO",
  selection: "HOME",
  candidate: set(SOURCE, CANDIDATE_AT, ["2", "3.5", "4"]),
  closing: set(SOURCE, CLOSING_AT, ["1.8", "4", "5"]),
  kickoffUtc: KICKOFF,
};

function unavailable(patch: Partial<NoVigClvInput>) {
  const result = calculateNoVigClv({ ...input, ...patch });
  expect(result.status).toBe("UNAVAILABLE");
  return result.status === "UNAVAILABLE" ? result.reason : undefined;
}

describe("calculateNoVigClv", () => {
  it("pins the policy version", () => {
    expect(NO_VIG_CLV_POLICY_VERSION).toBe("no-vig-clv-v1");
  });

  it("computes clv = pClose_fair / pCandidate_fair - 1 on a hand-worked 1X2 example", () => {
    const result = calculateNoVigClv(input);
    expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") return;
    expect(result.policyVersion).toBe("no-vig-clv-v1");
    expect(Number(result.pCandidateFair)).toBeCloseTo(14 / 29, 12);
    expect(Number(result.pCloseFair)).toBeCloseTo(100 / 181, 12);
    expect(Number(result.clv)).toBeCloseTo(183 / 1267, 12);
    expect(result.candidateObservedAt).toBe(CANDIDATE_AT);
    expect(result.closingObservedAt).toBe(CLOSING_AT);
    expect(result.sourceConvention).toBe(SOURCE);
    expect(result.market).toBe("ONE_X_TWO");
    expect(result.selection).toBe("HOME");
  });

  it("is positive when the market moved toward the selection and negative when away", () => {
    const home = calculateNoVigClv(input);
    const draw = calculateNoVigClv({ ...input, selection: "DRAW" });
    expect(home.status === "AVAILABLE" && Number(home.clv) > 0).toBe(true);
    expect(draw.status).toBe("AVAILABLE");
    if (draw.status !== "AVAILABLE") return;
    expect(Number(draw.pCandidateFair)).toBeCloseTo(8 / 29, 12);
    expect(Number(draw.pCloseFair)).toBeCloseTo(45 / 181, 12);
    expect(Number(draw.clv)).toBeCloseTo(-143 / 1448, 12);
  });

  it("de-vigs both sides: a two-way market differs from the raw odds ratio", () => {
    // BTTS YES: candidate 1.8/2.0 -> fair 10/19; closing 1.6/2.5 -> fair 25/41; clv = 13/82. Raw odds ratio would be 1.8/1.6 - 1 = 0.125.
    const result = calculateNoVigClv({
      market: "BTTS",
      selection: "YES",
      candidate: { sourceConvention: SOURCE, observedAt: CANDIDATE_AT, selections: [{ selection: "NO", decimalOdds: "2.0" }, { selection: "YES", decimalOdds: "1.8" }] },
      closing: { sourceConvention: SOURCE, observedAt: CLOSING_AT, selections: [{ selection: "YES", decimalOdds: "1.6" }, { selection: "NO", decimalOdds: "2.5" }] },
      kickoffUtc: KICKOFF,
    });
    expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") return;
    expect(Number(result.clv)).toBeCloseTo(13 / 82, 12);
    expect(Number(result.clv)).not.toBeCloseTo(0.125, 6);
  });

  it("works for the totals market", () => {
    const result = calculateNoVigClv({
      market: "OVER_UNDER_2_5",
      selection: "UNDER_2_5",
      candidate: { sourceConvention: SOURCE, observedAt: CANDIDATE_AT, selections: [{ selection: "OVER_2_5", decimalOdds: "2" }, { selection: "UNDER_2_5", decimalOdds: "2" }] },
      closing: { sourceConvention: SOURCE, observedAt: CLOSING_AT, selections: [{ selection: "OVER_2_5", decimalOdds: "4" }, { selection: "UNDER_2_5", decimalOdds: "1.3333333333" }] },
      kickoffUtc: KICKOFF,
    });
    expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") return;
    // candidate fair UNDER = 1/2; closing implied 1/4 and ~3/4 -> fair UNDER ~ 3/4; clv ~ 0.5
    expect(Number(result.clv)).toBeCloseTo(0.5, 6);
  });

  it("symmetry: margin-free sets give exactly the raw odds ratio of the frozen policy", () => {
    // Candidate 2 / 4 / 4 (implied 1/2, 1/4, 1/4, total 1); closing 1.6 / 4 / 8 (5/8, 1/4, 1/8, total 1).
    const free = { ...input, candidate: set(SOURCE, CANDIDATE_AT, ["2", "4", "4"]), closing: set(SOURCE, CLOSING_AT, ["1.6", "4", "8"]) };
    const noVig = calculateNoVigClv(free);
    expect(noVig.status).toBe("AVAILABLE");
    if (noVig.status !== "AVAILABLE") return;
    const raw = calculateComparableClv({
      candidate: { fixtureId: "f", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: SOURCE, observationKind: "MANUAL", observedAt: CANDIDATE_AT, decimalOdds: "2" },
      closing: { fixtureId: "f", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: SOURCE, observationKind: "MARKET_CLOSE", observedAt: CLOSING_AT, decimalOdds: "1.6" },
      kickoffUtc: KICKOFF,
    });
    expect(raw.status).toBe("AVAILABLE");
    if (raw.status !== "AVAILABLE") return;
    expect(raw.policyVersion).toBe(ODDS_RATIO_CLV_POLICY_VERSION);
    expect(noVig.clv).toBe(raw.clv);
    expect(noVig.clv).toBe("0.25");
  });

  it("does not depend on the order of selections inside a set", () => {
    const reversed: NoVigClvInput = { ...input, candidate: { ...input.candidate!, selections: [...input.candidate!.selections].reverse() }, closing: { ...input.closing!, selections: [...input.closing!.selections].reverse() } };
    expect(calculateNoVigClv(reversed)).toEqual(calculateNoVigClv(input));
  });

  it("allows a closing set observed at exactly the candidate instant", () => {
    expect(calculateNoVigClv({ ...input, closing: { ...input.closing!, observedAt: CANDIDATE_AT } }).status).toBe("AVAILABLE");
  });

  it("is pure and does not mutate its input", () => {
    const snapshot = JSON.stringify(input);
    expect(calculateNoVigClv(input)).toEqual(calculateNoVigClv(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  describe("UNAVAILABLE reasons", () => {
    it("CLOSING_SET_MISSING: null, undefined and empty", () => {
      expect(unavailable({ closing: null })).toBe("CLOSING_SET_MISSING");
      expect(unavailable({ closing: undefined })).toBe("CLOSING_SET_MISSING");
      expect(unavailable({ closing: { sourceConvention: SOURCE, observedAt: CLOSING_AT, selections: [] } })).toBe("CLOSING_SET_MISSING");
    });

    it("CLOSING_SET_INCOMPLETE: partial, duplicate and foreign selections", () => {
      const closing = input.closing!;
      expect(unavailable({ closing: { ...closing, selections: closing.selections.slice(0, 2) } })).toBe("CLOSING_SET_INCOMPLETE");
      expect(unavailable({ closing: { ...closing, selections: [closing.selections[0]!, closing.selections[0]!, closing.selections[1]!] } })).toBe("CLOSING_SET_INCOMPLETE");
      expect(unavailable({ closing: { ...closing, selections: [closing.selections[0]!, closing.selections[1]!, { selection: "YES", decimalOdds: "2" }] } })).toBe("CLOSING_SET_INCOMPLETE");
    });

    it("CANDIDATE_SET_INCOMPLETE: missing, empty, partial, and selection outside the market", () => {
      const candidate = input.candidate!;
      expect(unavailable({ candidate: null })).toBe("CANDIDATE_SET_INCOMPLETE");
      expect(unavailable({ candidate: undefined })).toBe("CANDIDATE_SET_INCOMPLETE");
      expect(unavailable({ candidate: { ...candidate, selections: [] } })).toBe("CANDIDATE_SET_INCOMPLETE");
      expect(unavailable({ candidate: { ...candidate, selections: candidate.selections.slice(0, 2) } })).toBe("CANDIDATE_SET_INCOMPLETE");
      expect(unavailable({ selection: "YES" })).toBe("CANDIDATE_SET_INCOMPLETE");
      expect(unavailable({ market: "ASIAN_HANDICAP" as never })).toBe("CANDIDATE_SET_INCOMPLETE");
    });

    it("SOURCE_CONVENTION_MISMATCH: different or blank sources", () => {
      expect(unavailable({ closing: { ...input.closing!, sourceConvention: "manual-source-b" } })).toBe("SOURCE_CONVENTION_MISMATCH");
      expect(unavailable({ candidate: { ...input.candidate!, sourceConvention: "  " }, closing: { ...input.closing!, sourceConvention: "  " } })).toBe("SOURCE_CONVENTION_MISMATCH");
    });

    it("INVALID_TIMESTAMP: non-canonical candidate, closing or kickoff instants", () => {
      expect(unavailable({ candidate: { ...input.candidate!, observedAt: "2026-11-28T10:00:00Z" } })).toBe("INVALID_TIMESTAMP");
      expect(unavailable({ closing: { ...input.closing!, observedAt: "not-a-date" } })).toBe("INVALID_TIMESTAMP");
      expect(unavailable({ kickoffUtc: "2026-12-01 20:00" })).toBe("INVALID_TIMESTAMP");
    });

    it("CLOSING_NOT_PRE_KICKOFF: closing at or after kickoff", () => {
      expect(unavailable({ closing: { ...input.closing!, observedAt: KICKOFF } })).toBe("CLOSING_NOT_PRE_KICKOFF");
      expect(unavailable({ closing: { ...input.closing!, observedAt: "2026-12-01T20:30:00.000Z" } })).toBe("CLOSING_NOT_PRE_KICKOFF");
    });

    it("CLOSING_BEFORE_CANDIDATE: closing observed earlier than the candidate", () => {
      expect(unavailable({ closing: { ...input.closing!, observedAt: "2026-11-28T09:59:59.999Z" } })).toBe("CLOSING_BEFORE_CANDIDATE");
    });

    it("INVALID_ODDS: bad odds on either side", () => {
      expect(unavailable({ closing: set(SOURCE, CLOSING_AT, ["1", "4", "5"]) })).toBe("INVALID_ODDS");
      expect(unavailable({ candidate: set(SOURCE, CANDIDATE_AT, ["2", "abc", "4"]) })).toBe("INVALID_ODDS");
      expect(unavailable({ candidate: set(SOURCE, CANDIDATE_AT, ["2", "0.5", "4"]) })).toBe("INVALID_ODDS");
      expect(unavailable({ closing: { ...input.closing!, selections: [{ selection: "HOME", decimalOdds: 1.8 as never }, input.closing!.selections[1]!, input.closing!.selections[2]!] } })).toBe("INVALID_ODDS");
    });

    it("never fabricates a value: UNAVAILABLE carries only status, policy version and reason", () => {
      const result = calculateNoVigClv({ ...input, closing: null });
      expect(result).toEqual({ status: "UNAVAILABLE", policyVersion: "no-vig-clv-v1", reason: "CLOSING_SET_MISSING" });
    });
  });

  describe("check order is fixed", () => {
    const empty: NoVigClvPriceSet = { sourceConvention: "", observedAt: "bad", selections: [] };
    it("closing missing beats everything", () => {
      expect(unavailable({ candidate: empty, closing: empty, kickoffUtc: "bad" })).toBe("CLOSING_SET_MISSING");
    });
    it("candidate incomplete beats closing incomplete", () => {
      const partial = { ...input.closing!, selections: input.closing!.selections.slice(0, 1) };
      expect(unavailable({ candidate: empty, closing: partial })).toBe("CANDIDATE_SET_INCOMPLETE");
    });
    it("closing incomplete beats source mismatch", () => {
      const partial = { ...input.closing!, sourceConvention: "other", selections: input.closing!.selections.slice(0, 1) };
      expect(unavailable({ closing: partial })).toBe("CLOSING_SET_INCOMPLETE");
    });
    it("source mismatch beats timestamp problems", () => {
      expect(unavailable({ closing: { ...input.closing!, sourceConvention: "other", observedAt: "bad" } })).toBe("SOURCE_CONVENTION_MISMATCH");
    });
    it("invalid timestamp beats ordering", () => {
      expect(unavailable({ closing: { ...input.closing!, observedAt: "bad" } })).toBe("INVALID_TIMESTAMP");
    });
    it("not pre-kickoff beats before-candidate", () => {
      expect(unavailable({ candidate: { ...input.candidate!, observedAt: "2026-12-01T21:00:00.000Z" }, closing: { ...input.closing!, observedAt: "2026-12-01T20:30:00.000Z" } })).toBe("CLOSING_NOT_PRE_KICKOFF");
    });
    it("timestamp ordering beats invalid odds", () => {
      expect(unavailable({ closing: set(SOURCE, "2026-11-28T09:00:00.000Z", ["1", "4", "5"]) })).toBe("CLOSING_BEFORE_CANDIDATE");
    });
  });
});
