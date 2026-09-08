import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { aggregateFlatOneUnit, FLAT_ONE_UNIT_POLICY_VERSION, settleFlatOneUnit } from "../../packages/domain/src/evaluation/financial.js";
import { calculateComparableClv, ODDS_RATIO_CLV_POLICY_VERSION } from "../../packages/domain/src/evaluation/clv.js";

describe("flat-one-unit-v1", () => {
  it.each([
    ["WIN", "2.5", "1", "2.5", "1.5"],
    ["LOSS", "2.5", "1", "0", "-1"],
    ["VOID", "2.5", "1", "1", "0"],
  ] as const)("settles a frozen candidate %s exactly", (result, odds, stake, returned, profit) => {
    expect(settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: result, decimalOdds: odds })).toEqual({
      status: "SETTLED",
      policyVersion: FLAT_ONE_UNIT_POLICY_VERSION,
      stakeUnits: stake,
      returnUnits: returned,
      profitUnits: profit,
    });
  });

  it("keeps pending and ineligible decisions out of financial observations", () => {
    expect(settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "PENDING", decimalOdds: "2.5" })).toEqual({ status: "PENDING", policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, reason: "SETTLEMENT_PENDING" });
    expect(settleFlatOneUnit({ valueOutcome: "NO_VALUE", settlementOutcome: "LOSS", decimalOdds: "2.5" })).toEqual({ status: "INELIGIBLE", policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, reason: "VALUE_OUTCOME_NOT_CANDIDATE" });
    expect(settleFlatOneUnit({ valueOutcome: "INSUFFICIENT_EVIDENCE", settlementOutcome: "LOSS", decimalOdds: "2.5" })).toEqual({ status: "INELIGIBLE", policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, reason: "VALUE_OUTCOME_NOT_CANDIDATE" });
  });

  it("discloses the same profit/stake definition for ROI and Yield", () => {
    const observations = [
      settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "WIN", decimalOdds: "2.5" }),
      settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "LOSS", decimalOdds: "1.8" }),
      settleFlatOneUnit({ valueOutcome: "NO_VALUE", settlementOutcome: "LOSS", decimalOdds: "3" }),
    ];
    expect(aggregateFlatOneUnit(observations)).toEqual({ policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, numerator: "0.5", denominator: "2", count: 2, totalProfitUnits: "0.5", totalStakedUnits: "2", roi: "0.25", yield: "0.25", definition: "totalProfitUnits / totalStakedUnits" });
    expect(aggregateFlatOneUnit([])).toMatchObject({ numerator: "0", denominator: "0", count: 0, roi: null, yield: null });
  });

  it.each([
    ["fixture mismatch", { fixtureId: "other" }, "FIXTURE_MISMATCH"],
    ["market mismatch", { market: "BTTS" }, "MARKET_MISMATCH"],
    ["selection mismatch", { selection: "DRAW" }, "SELECTION_MISMATCH"],
    ["format mismatch", { oddsFormat: "FRACTIONAL" }, "ODDS_FORMAT_MISMATCH"],
    ["source convention mismatch", { sourceConvention: "EXCHANGE" }, "SOURCE_CONVENTION_MISMATCH"],
    ["manual closing observation", { observationKind: "MANUAL" }, "CLOSING_OBSERVATION_NOT_MARKET_CLOSE"],
    ["closing at kickoff", { observedAt: "2026-09-10T18:00:00.000Z" }, "CLOSING_TIMESTAMP_NOT_PRE_KICKOFF"],
  ] as const)("fails closed for %s", (_name, closingOverride, reason) => {
    const result = calculateComparableClv({ candidate: candidate(), closing: { ...closing(), ...closingOverride }, kickoffUtc: "2026-09-10T18:00:00.000Z" });
    expect(result).toEqual({ status: "UNAVAILABLE", policyVersion: ODDS_RATIO_CLV_POLICY_VERSION, reason });
  });

  it("returns the exact comparable price tuple and odds-ratio CLV", () => {
    expect(calculateComparableClv({ candidate: candidate(), closing: closing(), kickoffUtc: "2026-09-10T18:00:00.000Z" })).toEqual({
      status: "AVAILABLE",
      policyVersion: ODDS_RATIO_CLV_POLICY_VERSION,
      candidateOdds: "2.4",
      closingOdds: "2",
      candidateObservedAt: "2026-09-10T16:00:00.000Z",
      closingObservedAt: "2026-09-10T17:59:00.000Z",
      clv: "0.2",
    });
  });

  it("keeps financial evidence free of D-08 advice and certainty language", () => {
    const sources = ["../../packages/domain/src/evaluation/financial.ts", "../../packages/domain/src/evaluation/clv.ts"]
      .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/bankroll|personalized recommendation|guaranteed profit|automatic wager|stake sizing/i);
  });
});

function candidate() {
  return { fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MANUAL" as const, observedAt: "2026-09-10T16:00:00.000Z", decimalOdds: "2.4" };
}

function closing() {
  return { fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MARKET_CLOSE" as const, observedAt: "2026-09-10T17:59:00.000Z", decimalOdds: "2" };
}
