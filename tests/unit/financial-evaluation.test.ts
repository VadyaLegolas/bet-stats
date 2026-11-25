import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  aggregateFlatOneUnit,
  aggregateFlatOneUnitByPolicy,
  FLAT_ONE_UNIT_POLICY_VERSION,
  FLAT_ONE_UNIT_V2_POLICY_VERSION,
  pageTotalsByPolicy,
  settleFlatOneUnit,
  settleFlatOneUnitV2,
} from "../../packages/domain/src/evaluation/financial.js";
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

describe("flat-one-unit-v2 (D-16)", () => {
  it("pins the policy versions", () => {
    expect(FLAT_ONE_UNIT_POLICY_VERSION).toBe("flat-one-unit-v1");
    expect(FLAT_ONE_UNIT_V2_POLICY_VERSION).toBe("flat-one-unit-v2");
  });

  it.each([
    ["WIN", "2.1", "1.1"],
    ["HALF_WIN", "1.55", "0.55"],
    ["PUSH", "1", "0"],
    ["HALF_LOSS", "0.5", "-0.5"],
    ["LOSS", "0", "-1"],
  ] as const)("settles %s at odds 2.10 with return %s and profit %s", (result, returned, profit) => {
    expect(settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result, decimalOdds: "2.10" })).toEqual({
      status: "SETTLED",
      policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION,
      result,
      stakeUnits: "1",
      returnUnits: result === "WIN" ? "2.1" : returned,
      profitUnits: profit,
    });
  });

  it("keeps pending and ineligible decisions out of the money result", () => {
    expect(settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "PENDING", decimalOdds: "2.1" })).toEqual({ status: "PENDING", policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION, reason: "SETTLEMENT_PENDING" });
    expect(settleFlatOneUnitV2({ valueOutcome: "NO_VALUE", result: "LOSS", decimalOdds: "2.1" })).toEqual({ status: "INELIGIBLE", policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION, reason: "VALUE_OUTCOME_NOT_CANDIDATE" });
  });

  it("rejects non-canonical odds the way v1 does", () => {
    expect(() => settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "WIN", decimalOdds: "1" })).toThrow("INVALID_DECIMAL_ODDS");
    expect(() => settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "WIN", decimalOdds: "abc" })).toThrow("INVALID_DECIMAL_ODDS");
  });

  it("is exact on the pathological odds of 107 integer and 20 fractional digits", () => {
    const integer = "1".repeat(107);
    const fraction = "1".repeat(20);
    const odds = `${integer}.${fraction}`;
    const win = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "WIN", decimalOdds: odds });
    expect(win).toMatchObject({ status: "SETTLED", returnUnits: odds, profitUnits: `${"1".repeat(106)}0.${fraction}` });
    // Independent exact arithmetic on integers scaled by 10^21: (odds + 1) / 2 needs one digit beyond the 20 of the input.
    const scaledOdds = BigInt(`${integer}${fraction}`) * 10n;
    const halfWin = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "HALF_WIN", decimalOdds: odds });
    expect(halfWin).toMatchObject({ status: "SETTLED", returnUnits: fromScaled((scaledOdds + 10n ** 21n) / 2n, 21), profitUnits: fromScaled((scaledOdds + 10n ** 21n) / 2n - 10n ** 21n, 21) });
    const loss = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "HALF_LOSS", decimalOdds: odds });
    expect(loss).toMatchObject({ returnUnits: "0.5", profitUnits: "-0.5" });
  });
});

describe("policy-separated aggregation (D-16)", () => {
  const v1Win = settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "WIN", decimalOdds: "2.5" });
  const v1Loss = settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "LOSS", decimalOdds: "1.8" });
  const v2Half = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "HALF_WIN", decimalOdds: "2.1" });
  const v2Loss = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result: "LOSS", decimalOdds: "2" });

  it("leaves the frozen v1 results unchanged on pinned data", () => {
    expect(settleFlatOneUnit({ valueOutcome: "VALUE_CANDIDATE", settlementOutcome: "WIN", decimalOdds: "2.5" })).toEqual({ status: "SETTLED", policyVersion: "flat-one-unit-v1", stakeUnits: "1", returnUnits: "2.5", profitUnits: "1.5" });
    expect(aggregateFlatOneUnit([v1Win, v1Loss])).toEqual({ policyVersion: "flat-one-unit-v1", numerator: "0.5", denominator: "2", count: 2, totalProfitUnits: "0.5", totalStakedUnits: "2", roi: "0.25", yield: "0.25", definition: "totalProfitUnits / totalStakedUnits" });
  });

  it("returns two separate aggregates on a mix of v1 and v2, never one combined total", () => {
    const aggregates = aggregateFlatOneUnitByPolicy([v1Win, v2Half, v1Loss, v2Loss]);
    expect(aggregates).toHaveLength(2);
    expect(aggregates[0]).toEqual(aggregateFlatOneUnit([v1Win, v1Loss]));
    expect(aggregates[1]).toEqual({ policyVersion: "flat-one-unit-v2", numerator: "-0.45", denominator: "2", count: 2, totalProfitUnits: "-0.45", totalStakedUnits: "2", roi: "-0.225", yield: "-0.225", definition: "totalProfitUnits / totalStakedUnits" });
  });

  it("omits a policy without receipts and keeps the order v1 then v2", () => {
    expect(aggregateFlatOneUnitByPolicy([v2Half]).map(({ policyVersion }) => policyVersion)).toEqual(["flat-one-unit-v2"]);
    expect(aggregateFlatOneUnitByPolicy([v2Half, v1Win]).map(({ policyVersion }) => policyVersion)).toEqual(["flat-one-unit-v1", "flat-one-unit-v2"]);
    expect(aggregateFlatOneUnitByPolicy([])).toEqual([]);
  });

  it("pageTotalsByPolicy sums per policy, omits an empty policy and orders v1 then v2", () => {
    const rows = [
      { policyVersion: "flat-one-unit-v2", stakeUnits: "1", profitUnits: "0.55" },
      { policyVersion: "flat-one-unit-v1", stakeUnits: "1", profitUnits: "1.5" },
      { policyVersion: "flat-one-unit-v2", stakeUnits: "1", profitUnits: "-0.5" },
      { policyVersion: "flat-one-unit-v1", stakeUnits: "1", profitUnits: "-1" },
    ] as const;
    expect(pageTotalsByPolicy(rows)).toEqual([
      { policyVersion: "flat-one-unit-v1", count: 2, stakeUnits: "2", profitUnits: "0.5" },
      { policyVersion: "flat-one-unit-v2", count: 2, stakeUnits: "2", profitUnits: "0.05" },
    ]);
    expect(pageTotalsByPolicy(rows.filter(({ policyVersion }) => policyVersion === "flat-one-unit-v2"))).toEqual([{ policyVersion: "flat-one-unit-v2", count: 2, stakeUnits: "2", profitUnits: "0.05" }]);
    expect(pageTotalsByPolicy([])).toEqual([]);
  });

  it("fails closed on an unknown policy version", () => {
    expect(() => pageTotalsByPolicy([{ policyVersion: "flat-one-unit-v3" as never, stakeUnits: "1", profitUnits: "0" }])).toThrow("UNKNOWN_SETTLEMENT_POLICY");
  });
});

/** Plain decimal text of an integer scaled by 10^scale, without trailing fractional zeros. */
function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

function candidate() {
  return { fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MANUAL" as const, observedAt: "2026-09-10T16:00:00.000Z", decimalOdds: "2.4" };
}

function closing() {
  return { fixtureId: "fixture-1", market: "ONE_X_TWO", selection: "HOME", oddsFormat: "DECIMAL", sourceConvention: "BOOKMAKER_BACK", observationKind: "MARKET_CLOSE" as const, observedAt: "2026-09-10T17:59:00.000Z", decimalOdds: "2" };
}
