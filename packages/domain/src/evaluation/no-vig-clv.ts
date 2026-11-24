import type { OddsMarket, OddsSelection } from "../odds/contract.js";

export const NO_VIG_CLV_POLICY_VERSION = "no-vig-clv-v1";

export interface NoVigClvPriceSet {
  readonly sourceConvention: string;
  readonly observedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export interface NoVigClvInput {
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
  readonly candidate: NoVigClvPriceSet | null | undefined;
  readonly closing: NoVigClvPriceSet | null | undefined;
  readonly kickoffUtc: string;
}

export type NoVigClvUnavailableReason =
  | "CLOSING_SET_MISSING"
  | "CLOSING_SET_INCOMPLETE"
  | "CANDIDATE_SET_INCOMPLETE"
  | "SOURCE_CONVENTION_MISMATCH"
  | "INVALID_TIMESTAMP"
  | "CLOSING_BEFORE_CANDIDATE"
  | "CLOSING_NOT_PRE_KICKOFF"
  | "INVALID_ODDS";

export type NoVigClvReceipt =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: typeof NO_VIG_CLV_POLICY_VERSION; reason: NoVigClvUnavailableReason }>
  | Readonly<{
      status: "AVAILABLE";
      policyVersion: typeof NO_VIG_CLV_POLICY_VERSION;
      market: OddsMarket;
      selection: OddsSelection;
      sourceConvention: string;
      candidateObservedAt: string;
      closingObservedAt: string;
      pCandidateFair: string;
      pCloseFair: string;
      clv: string;
    }>;

// RED stub: behavior is intentionally absent until the GREEN step.
export function calculateNoVigClv(_input: NoVigClvInput): NoVigClvReceipt {
  return { status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason: "CLOSING_SET_MISSING" };
}
