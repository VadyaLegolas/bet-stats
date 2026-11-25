import { AH_RETURN_SHARES, AH_SETTLEMENT_VERSION, settleAsianHandicap, type AhResult, type AhSide } from "./asian-handicap.js";
import { EXACT_SCORE_BUCKETS_V1, parseExactScoreSelection } from "./exact-score.js";
import { marketFamilyOf, parseMarketId, type MarketFamily, type MarketId } from "./registry.js";

/**
 * Settlement rules of the extended markets (D-15, D-17). The Asian handicap rule lives in exactly one place,
 * `settleAsianHandicap`; this module only routes a registered market to it and adds the exact score rule. A market
 * family without a rule is a compile error: both `settlementPolicyFor` and `settleExtendedMarket` end in an exhaustive
 * check over `MarketFamily`, and `SETTLEMENT_RULES` is a `Record` over the same type. Pure functions only.
 */

export { AH_SETTLEMENT_VERSION };
export const EXACT_SCORE_SETTLEMENT_VERSION = "exact-score-settlement-v1" as const;

export type SettlementPolicy = "flat-one-unit-v1" | "flat-one-unit-v2";
export type SettlementKind = "THREE_WAY_OUTCOME" | "ASIAN_HANDICAP" | "EXACT_SCORE";

export interface ReturnShares {
  readonly oddsShare: number;
  readonly refundShare: number;
}

export interface ExtendedSettlement {
  readonly result: AhResult;
  readonly shares: ReturnShares;
}

/** The money policy and the rule family of every market family; exhaustive by type. */
export const SETTLEMENT_RULES: Readonly<Record<MarketFamily, Readonly<{ policy: SettlementPolicy; kind: SettlementKind }>>> = Object.freeze({
  ONE_X_TWO: Object.freeze({ policy: "flat-one-unit-v1", kind: "THREE_WAY_OUTCOME" }),
  OVER_UNDER_2_5: Object.freeze({ policy: "flat-one-unit-v1", kind: "THREE_WAY_OUTCOME" }),
  BTTS: Object.freeze({ policy: "flat-one-unit-v1", kind: "THREE_WAY_OUTCOME" }),
  ASIAN_HANDICAP: Object.freeze({ policy: "flat-one-unit-v2", kind: "ASIAN_HANDICAP" }),
  EXACT_SCORE: Object.freeze({ policy: "flat-one-unit-v2", kind: "EXACT_SCORE" }),
});

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function assertNever(value: never): never {
  return fail(`UNSETTLEABLE_MARKET:${String(value)}`);
}

function familyOrThrow(market: unknown): MarketFamily {
  const family = marketFamilyOf(market);
  return family === null ? fail("UNSETTLEABLE_MARKET") : family;
}

/** The money policy a market is settled under: v1 for the three core markets, v2 for Asian handicap and exact score. */
export function settlementPolicyFor(market: MarketId): SettlementPolicy {
  const family = familyOrThrow(market);
  switch (family) {
    case "ONE_X_TWO":
    case "OVER_UNDER_2_5":
    case "BTTS":
      return "flat-one-unit-v1";
    case "ASIAN_HANDICAP":
    case "EXACT_SCORE":
      return "flat-one-unit-v2";
    default:
      return assertNever(family);
  }
}

function assertFinalScore(homeGoals: number, awayGoals: number): void {
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) fail("INVALID_FINAL_SCORE");
}

/**
 * Rule `exact-score-settlement-v1`: a listed score wins on exactly that final score; OTHER wins when either side scored
 * above `maxGoals` (three). So any score above three goals is OTHER and loses every listed cell.
 */
export function settleExactScore(selection: string, homeGoals: number, awayGoals: number): ExtendedSettlement {
  assertFinalScore(homeGoals, awayGoals);
  const parsed = parseExactScoreSelection(selection);
  if (parsed === null) return fail("INVALID_EXACT_SCORE_SELECTION");
  const won = parsed === "OTHER"
    ? homeGoals > EXACT_SCORE_BUCKETS_V1.maxGoals || awayGoals > EXACT_SCORE_BUCKETS_V1.maxGoals
    : parsed.homeGoals === homeGoals && parsed.awayGoals === awayGoals;
  const result: AhResult = won ? "WIN" : "LOSS";
  return { result, shares: AH_RETURN_SHARES[result] };
}

export interface SettleExtendedMarketInput {
  readonly market: MarketId;
  readonly selection: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
}

/**
 * Result and return shares per unit stake of an extended market on the stored final score. The three core markets are
 * settled by the frozen v1 path and rejected here with `NOT_AN_EXTENDED_MARKET`.
 */
export function settleExtendedMarket(input: SettleExtendedMarketInput): ExtendedSettlement {
  const parsed = parseMarketId(input.market);
  if (parsed === null) return fail("UNSETTLEABLE_MARKET");
  const family = parsed.family;
  switch (family) {
    case "ONE_X_TWO":
    case "OVER_UNDER_2_5":
    case "BTTS":
      return fail("NOT_AN_EXTENDED_MARKET");
    case "ASIAN_HANDICAP": {
      assertFinalScore(input.homeGoals, input.awayGoals);
      if (parsed.line === undefined) return fail("UNSETTLEABLE_MARKET");
      if (input.selection !== "HOME" && input.selection !== "AWAY") return fail("INVALID_SELECTION");
      const side: AhSide = input.selection;
      return settleAsianHandicap(parsed.line, side, input.homeGoals, input.awayGoals);
    }
    case "EXACT_SCORE":
      if (parseExactScoreSelection(input.selection) === null) return fail("INVALID_SELECTION");
      return settleExactScore(input.selection, input.homeGoals, input.awayGoals);
    default:
      return assertNever(family);
  }
}
