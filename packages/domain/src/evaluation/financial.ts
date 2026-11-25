import { Decimal } from "decimal.js";

import { AH_RETURN_SHARES, type AhResult } from "../markets/asian-handicap.js";
import { canonicalizeDecimalOdds } from "../odds/contract.js";

export const FLAT_ONE_UNIT_POLICY_VERSION = "flat-one-unit-v1";
export const FINANCIAL_RATE_DEFINITION = "totalProfitUnits / totalStakedUnits";

export type ValueDecisionOutcome = "VALUE_CANDIDATE" | "NO_VALUE" | "INSUFFICIENT_EVIDENCE";
export type FinancialSettlementOutcome = "WIN" | "LOSS" | "VOID" | "PENDING";

export type FlatOneUnitReceipt =
  | Readonly<{ status: "SETTLED"; policyVersion: typeof FLAT_ONE_UNIT_POLICY_VERSION; stakeUnits: string; returnUnits: string; profitUnits: string }>
  | Readonly<{ status: "PENDING" | "INELIGIBLE"; policyVersion: typeof FLAT_ONE_UNIT_POLICY_VERSION; reason: "SETTLEMENT_PENDING" | "VALUE_OUTCOME_NOT_CANDIDATE" }>;

export function settleFlatOneUnit(input: Readonly<{ valueOutcome: ValueDecisionOutcome; settlementOutcome: FinancialSettlementOutcome; decimalOdds: string }>): FlatOneUnitReceipt {
  if (input.valueOutcome !== "VALUE_CANDIDATE") return { status: "INELIGIBLE", policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, reason: "VALUE_OUTCOME_NOT_CANDIDATE" };
  if (input.settlementOutcome === "PENDING") return { status: "PENDING", policyVersion: FLAT_ONE_UNIT_POLICY_VERSION, reason: "SETTLEMENT_PENDING" };

  const odds = new Decimal(canonicalizeDecimalOdds(input.decimalOdds));
  const returned = input.settlementOutcome === "WIN" ? odds : input.settlementOutcome === "VOID" ? new Decimal(1) : new Decimal(0);
  return {
    status: "SETTLED",
    policyVersion: FLAT_ONE_UNIT_POLICY_VERSION,
    stakeUnits: "1",
    returnUnits: returned.toString(),
    profitUnits: returned.minus(1).toString(),
  };
}

export interface FlatOneUnitAggregate {
  readonly policyVersion: typeof FLAT_ONE_UNIT_POLICY_VERSION;
  readonly numerator: string;
  readonly denominator: string;
  readonly count: number;
  readonly totalProfitUnits: string;
  readonly totalStakedUnits: string;
  readonly roi: string | null;
  readonly yield: string | null;
  readonly definition: typeof FINANCIAL_RATE_DEFINITION;
}

export function aggregateFlatOneUnit(receipts: readonly FlatOneUnitReceipt[]): FlatOneUnitAggregate {
  const settled = receipts.filter((receipt): receipt is Extract<FlatOneUnitReceipt, { status: "SETTLED" }> => receipt.status === "SETTLED");
  const totalProfit = settled.reduce((sum, receipt) => sum.plus(receipt.profitUnits), new Decimal(0));
  const totalStake = settled.reduce((sum, receipt) => sum.plus(receipt.stakeUnits), new Decimal(0));
  const rate = totalStake.isZero() ? null : totalProfit.div(totalStake).toString();
  return {
    policyVersion: FLAT_ONE_UNIT_POLICY_VERSION,
    numerator: totalProfit.toString(),
    denominator: totalStake.toString(),
    count: settled.length,
    totalProfitUnits: totalProfit.toString(),
    totalStakedUnits: totalStake.toString(),
    roi: rate,
    yield: rate,
    definition: FINANCIAL_RATE_DEFINITION,
  };
}

/**
 * Policy `flat-one-unit-v2` (D-16): the same single unit stake as v1, but a result may return a fraction of the stake.
 * It sits beside the frozen v1 and never replaces it; the two policies are always aggregated separately.
 */
export const FLAT_ONE_UNIT_V2_POLICY_VERSION = "flat-one-unit-v2";

export type FlatOneUnitV2Receipt =
  | Readonly<{ status: "SETTLED"; policyVersion: typeof FLAT_ONE_UNIT_V2_POLICY_VERSION; result: AhResult; stakeUnits: string; returnUnits: string; profitUnits: string }>
  | Readonly<{ status: "PENDING" | "INELIGIBLE"; policyVersion: typeof FLAT_ONE_UNIT_V2_POLICY_VERSION; reason: "SETTLEMENT_PENDING" | "VALUE_OUTCOME_NOT_CANDIDATE" }>;

/** 200 significant digits hold the largest canonical odds (107 integer plus 20 fractional digits) and the half-share exactly. */
const ExactDecimal = Decimal.clone({ precision: 200, rounding: Decimal.ROUND_HALF_EVEN });
/** Rate digits follow the working precision of the forecast domain, as in v1. */
const RateDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export function settleFlatOneUnitV2(input: Readonly<{ valueOutcome: ValueDecisionOutcome; result: AhResult | "PENDING"; decimalOdds: string }>): FlatOneUnitV2Receipt {
  if (input.valueOutcome !== "VALUE_CANDIDATE") return { status: "INELIGIBLE", policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION, reason: "VALUE_OUTCOME_NOT_CANDIDATE" };
  if (input.result === "PENDING") return { status: "PENDING", policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION, reason: "SETTLEMENT_PENDING" };

  const shares = AH_RETURN_SHARES[input.result];
  const odds = new ExactDecimal(canonicalizeDecimalOdds(input.decimalOdds));
  const returned = odds.times(shares.oddsShare).plus(shares.refundShare);
  return {
    status: "SETTLED",
    policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION,
    result: input.result,
    stakeUnits: "1",
    returnUnits: returned.toFixed(),
    profitUnits: returned.minus(1).toFixed(),
  };
}

export interface FlatOneUnitV2Aggregate {
  readonly policyVersion: typeof FLAT_ONE_UNIT_V2_POLICY_VERSION;
  readonly numerator: string;
  readonly denominator: string;
  readonly count: number;
  readonly totalProfitUnits: string;
  readonly totalStakedUnits: string;
  readonly roi: string | null;
  readonly yield: string | null;
  readonly definition: typeof FINANCIAL_RATE_DEFINITION;
}

export type SettlementPolicyVersion = typeof FLAT_ONE_UNIT_POLICY_VERSION | typeof FLAT_ONE_UNIT_V2_POLICY_VERSION;
export type PolicyAggregate = FlatOneUnitAggregate | FlatOneUnitV2Aggregate;
const POLICY_ORDER: readonly SettlementPolicyVersion[] = [FLAT_ONE_UNIT_POLICY_VERSION, FLAT_ONE_UNIT_V2_POLICY_VERSION];

function unknownPolicy(): never {
  throw Object.assign(new Error("UNKNOWN_SETTLEMENT_POLICY"), { code: "UNKNOWN_SETTLEMENT_POLICY" });
}

function aggregateV2(receipts: readonly FlatOneUnitV2Receipt[]): FlatOneUnitV2Aggregate {
  const settled = receipts.filter((receipt): receipt is Extract<FlatOneUnitV2Receipt, { status: "SETTLED" }> => receipt.status === "SETTLED");
  const totalProfit = settled.reduce((sum, receipt) => sum.plus(receipt.profitUnits), new ExactDecimal(0));
  const totalStake = settled.reduce((sum, receipt) => sum.plus(receipt.stakeUnits), new ExactDecimal(0));
  const rate = totalStake.isZero() ? null : new RateDecimal(totalProfit).div(new RateDecimal(totalStake)).toString();
  return {
    policyVersion: FLAT_ONE_UNIT_V2_POLICY_VERSION,
    numerator: totalProfit.toFixed(),
    denominator: totalStake.toFixed(),
    count: settled.length,
    totalProfitUnits: totalProfit.toFixed(),
    totalStakedUnits: totalStake.toFixed(),
    roi: rate,
    yield: rate,
    definition: FINANCIAL_RATE_DEFINITION,
  };
}

/**
 * One aggregate per policy that has at least one receipt, v1 first, then v2. The two policies are never summed together:
 * there is no combined total. An unknown policy version is a hard error rather than a silent bucket.
 */
export function aggregateFlatOneUnitByPolicy(receipts: readonly (FlatOneUnitReceipt | FlatOneUnitV2Receipt)[]): readonly PolicyAggregate[] {
  const v1: FlatOneUnitReceipt[] = [];
  const v2: FlatOneUnitV2Receipt[] = [];
  for (const receipt of receipts) {
    if (receipt.policyVersion === FLAT_ONE_UNIT_POLICY_VERSION) v1.push(receipt as FlatOneUnitReceipt);
    else if (receipt.policyVersion === FLAT_ONE_UNIT_V2_POLICY_VERSION) v2.push(receipt as FlatOneUnitV2Receipt);
    else unknownPolicy();
  }
  const aggregates: PolicyAggregate[] = [];
  if (v1.length > 0) aggregates.push(aggregateFlatOneUnit(v1));
  if (v2.length > 0) aggregates.push(aggregateV2(v2));
  return aggregates;
}

export interface PolicyPageRow {
  readonly policyVersion: SettlementPolicyVersion;
  readonly stakeUnits: string;
  readonly profitUnits: string;
}

export interface PolicyPageTotals {
  readonly policyVersion: SettlementPolicyVersion;
  readonly count: number;
  readonly stakeUnits: string;
  readonly profitUnits: string;
}

/** Page totals per policy, v1 then v2, a policy without rows omitted; a v1 row and a v2 row are never added together. */
export function pageTotalsByPolicy(rows: readonly PolicyPageRow[]): readonly PolicyPageTotals[] {
  const totals = new Map<SettlementPolicyVersion, { count: number; stake: Decimal; profit: Decimal }>();
  for (const row of rows) {
    if (!POLICY_ORDER.includes(row.policyVersion)) unknownPolicy();
    const bucket = totals.get(row.policyVersion) ?? { count: 0, stake: new ExactDecimal(0), profit: new ExactDecimal(0) };
    bucket.count += 1;
    bucket.stake = bucket.stake.plus(row.stakeUnits);
    bucket.profit = bucket.profit.plus(row.profitUnits);
    totals.set(row.policyVersion, bucket);
  }
  return POLICY_ORDER.flatMap((policyVersion) => {
    const bucket = totals.get(policyVersion);
    return bucket === undefined ? [] : [{ policyVersion, count: bucket.count, stakeUnits: bucket.stake.toFixed(), profitUnits: bucket.profit.toFixed() }];
  });
}
