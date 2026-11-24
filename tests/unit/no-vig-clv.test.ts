import { describe, expect, it } from "vitest";

import { calculateComparableClv } from "../../packages/domain/src/evaluation/clv.js";
import { calculateNoVigClv, NO_VIG_CLV_POLICY_VERSION, type NoVigPriceSet } from "../../packages/domain/src/evaluation/no-vig-clv.js";

const kickoff = "2026-12-01T20:00:00.000Z";
const set = (odds: [string, string, string], observedAt: string, sourceConvention = "pinnacle"): NoVigPriceSet => ({
  market: "ONE_X_TWO",
  sourceConvention,
  observedAt,
  selections: [{ selection: "HOME", decimalOdds: odds[0] }, { selection: "DRAW", decimalOdds: odds[1] }, { selection: "AWAY", decimalOdds: odds[2] }],
});
const candidate = set(["2.10", "3.40", "3.60"], "2026-11-30T12:00:00.000Z");
const closing = set(["1.90", "3.50", "4.20"], "2026-12-01T19:00:00.000Z");

describe("calculateNoVigClv (CLV-02)", () => {
  it("de-vigs both sets and reports pClose_fair / pCandidate_fair - 1 with a policy label", () => {
    const result = calculateNoVigClv({ selection: "HOME", candidate, closing, kickoffUtc: kickoff });
    expect(result.status).toBe("AVAILABLE");
    if (result.status !== "AVAILABLE") return;
    expect(result.policyVersion).toBe(NO_VIG_CLV_POLICY_VERSION);
    const impliedCandidate = [1 / 2.1, 1 / 3.4, 1 / 3.6];
    const impliedClose = [1 / 1.9, 1 / 3.5, 1 / 4.2];
    const pCandidate = impliedCandidate[0]! / impliedCandidate.reduce((a, b) => a + b, 0);
    const pClose = impliedClose[0]! / impliedClose.reduce((a, b) => a + b, 0);
    expect(Number(result.pCandidateFair)).toBeCloseTo(pCandidate, 12);
    expect(Number(result.pCloseFair)).toBeCloseTo(pClose, 12);
    expect(Number(result.clv)).toBeCloseTo(pClose / pCandidate - 1, 12);
    expect(Number(result.clv)).toBeGreaterThan(0);
    expect(result.closingObservedAt).toBe(closing.observedAt);
    expect(result.sourceConvention).toBe("pinnacle");
  });

  it("is negative when the market moved away and zero when prices are unchanged", () => {
    const away = calculateNoVigClv({ selection: "AWAY", candidate, closing, kickoffUtc: kickoff });
    expect(away.status === "AVAILABLE" && Number(away.clv) < 0).toBe(true);
    const same = calculateNoVigClv({ selection: "DRAW", candidate, closing: { ...candidate, observedAt: closing.observedAt }, kickoffUtc: kickoff });
    expect(same.status === "AVAILABLE" && Number(same.clv)).toBe(0);
  });

  it("removes the margin: a uniformly scaled book gives zero CLV while the raw odds ratio does not", () => {
    const scaled = set(["2.00", "3.00", "6.00"], "2026-12-01T19:00:00.000Z");
    const cheaper = set(["1.90", "2.85", "5.70"], "2026-11-30T12:00:00.000Z");
    const noVig = calculateNoVigClv({ selection: "HOME", candidate: cheaper, closing: scaled, kickoffUtc: kickoff });
    expect(noVig.status === "AVAILABLE" && Math.abs(Number(noVig.clv)) < 1e-12).toBe(true);
    const raw = calculateComparableClv({
      candidate: { fixtureId: "f", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "pinnacle", observationKind: "MANUAL", observedAt: cheaper.observedAt, decimalOdds: "1.90" },
      closing: { fixtureId: "f", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "pinnacle", observationKind: "MARKET_CLOSE", observedAt: scaled.observedAt, decimalOdds: "2.00" },
      kickoffUtc: kickoff,
    });
    expect(raw.status === "AVAILABLE" && Number(raw.clv)).not.toBe(0);
  });

  it("reports typed unavailable reasons and never synthesizes a value", () => {
    const reason = (input: Parameters<typeof calculateNoVigClv>[0]) => {
      const result = calculateNoVigClv(input);
      return result.status === "UNAVAILABLE" ? result.reason : "AVAILABLE";
    };
    expect(reason({ selection: "HOME", candidate, closing: null, kickoffUtc: kickoff })).toBe("CLOSING_SET_MISSING");
    expect(reason({ selection: "HOME", candidate, closing: { ...closing, selections: closing.selections.slice(0, 2) }, kickoffUtc: kickoff })).toBe("CLOSING_SET_INCOMPLETE");
    expect(reason({ selection: "HOME", candidate: { ...candidate, selections: candidate.selections.slice(0, 2) }, closing, kickoffUtc: kickoff })).toBe("CANDIDATE_SET_INCOMPLETE");
    expect(reason({ selection: "HOME", candidate, closing: { ...closing, sourceConvention: "bet365" }, kickoffUtc: kickoff })).toBe("SOURCE_CONVENTION_MISMATCH");
    expect(reason({ selection: "HOME", candidate, closing: { ...closing, market: "BTTS" }, kickoffUtc: kickoff })).toBe("MARKET_MISMATCH");
    expect(reason({ selection: "YES", candidate, closing, kickoffUtc: kickoff })).toBe("SELECTION_NOT_IN_MARKET");
    expect(reason({ selection: "HOME", candidate, closing: { ...closing, observedAt: "2026-11-29T12:00:00.000Z" }, kickoffUtc: kickoff })).toBe("CLOSING_BEFORE_CANDIDATE");
    expect(reason({ selection: "HOME", candidate, closing: { ...closing, observedAt: kickoff }, kickoffUtc: kickoff })).toBe("CLOSING_NOT_PRE_KICKOFF");
    expect(reason({ selection: "HOME", candidate, closing: set(["0.50", "3.50", "4.20"], closing.observedAt), kickoffUtc: kickoff })).toBe("INVALID_ODDS");
  });

  it("leaves the frozen odds-ratio-clv-v1 policy label untouched", async () => {
    const { ODDS_RATIO_CLV_POLICY_VERSION } = await import("../../packages/domain/src/evaluation/clv.js");
    expect(ODDS_RATIO_CLV_POLICY_VERSION).toBe("odds-ratio-clv-v1");
  });
});
