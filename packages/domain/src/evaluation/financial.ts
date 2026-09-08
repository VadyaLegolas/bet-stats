import { Decimal } from "decimal.js";

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
