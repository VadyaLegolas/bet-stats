import { Decimal } from "decimal.js";

import { canonicalizeDecimalOdds, CANONICAL_UTC_INSTANT_PATTERN } from "../odds/contract.js";

export const ODDS_RATIO_CLV_POLICY_VERSION = "odds-ratio-clv-v1";

export interface ClvPriceObservation {
  readonly fixtureId: string;
  readonly market: string;
  readonly selection: string;
  readonly oddsFormat: string;
  readonly sourceConvention: string;
  readonly observationKind: "MANUAL" | "MARKET_CLOSE";
  readonly observedAt: string;
  readonly decimalOdds: string;
}

export type ClvUnavailableReason =
  | "FIXTURE_MISMATCH"
  | "MARKET_MISMATCH"
  | "SELECTION_MISMATCH"
  | "ODDS_FORMAT_MISMATCH"
  | "SOURCE_CONVENTION_MISMATCH"
  | "CANDIDATE_TIMESTAMP_INVALID"
  | "CANDIDATE_TIMESTAMP_NOT_PRE_KICKOFF"
  | "CLOSING_TIMESTAMP_INVALID"
  | "CLOSING_TIMESTAMP_NOT_PRE_KICKOFF"
  | "CLOSING_TIMESTAMP_BEFORE_CANDIDATE"
  | "CLOSING_OBSERVATION_NOT_MARKET_CLOSE"
  | "INVALID_CANDIDATE_ODDS"
  | "INVALID_CLOSING_ODDS";

export type ComparableClvReceipt =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: typeof ODDS_RATIO_CLV_POLICY_VERSION; reason: ClvUnavailableReason }>
  | Readonly<{ status: "AVAILABLE"; policyVersion: typeof ODDS_RATIO_CLV_POLICY_VERSION; candidateOdds: string; closingOdds: string; candidateObservedAt: string; closingObservedAt: string; clv: string }>;

function canonicalInstant(value: string): boolean {
  return CANONICAL_UTC_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function calculateComparableClv(input: Readonly<{ candidate: ClvPriceObservation; closing: ClvPriceObservation; kickoffUtc: string }>): ComparableClvReceipt {
  const { candidate, closing } = input;
  if (candidate.fixtureId !== closing.fixtureId) return unavailable("FIXTURE_MISMATCH");
  if (candidate.market !== closing.market) return unavailable("MARKET_MISMATCH");
  if (candidate.selection !== closing.selection) return unavailable("SELECTION_MISMATCH");
  if (candidate.oddsFormat !== "DECIMAL" || closing.oddsFormat !== "DECIMAL" || candidate.oddsFormat !== closing.oddsFormat) return unavailable("ODDS_FORMAT_MISMATCH");
  if (candidate.sourceConvention !== closing.sourceConvention) return unavailable("SOURCE_CONVENTION_MISMATCH");
  if (closing.observationKind !== "MARKET_CLOSE") return unavailable("CLOSING_OBSERVATION_NOT_MARKET_CLOSE");
  if (!canonicalInstant(candidate.observedAt)) return unavailable("CANDIDATE_TIMESTAMP_INVALID");
  if (!canonicalInstant(closing.observedAt)) return unavailable("CLOSING_TIMESTAMP_INVALID");
  const kickoff = Date.parse(input.kickoffUtc);
  const candidateAt = Date.parse(candidate.observedAt);
  const closingAt = Date.parse(closing.observedAt);
  if (candidateAt >= kickoff) return unavailable("CANDIDATE_TIMESTAMP_NOT_PRE_KICKOFF");
  if (closingAt >= kickoff) return unavailable("CLOSING_TIMESTAMP_NOT_PRE_KICKOFF");
  if (closingAt < candidateAt) return unavailable("CLOSING_TIMESTAMP_BEFORE_CANDIDATE");

  let candidateOdds: string;
  let closingOdds: string;
  try { candidateOdds = canonicalizeDecimalOdds(candidate.decimalOdds); } catch { return unavailable("INVALID_CANDIDATE_ODDS"); }
  try { closingOdds = canonicalizeDecimalOdds(closing.decimalOdds); } catch { return unavailable("INVALID_CLOSING_ODDS"); }
  return {
    status: "AVAILABLE",
    policyVersion: ODDS_RATIO_CLV_POLICY_VERSION,
    candidateOdds,
    closingOdds,
    candidateObservedAt: candidate.observedAt,
    closingObservedAt: closing.observedAt,
    clv: new Decimal(candidateOdds).div(closingOdds).minus(1).toString(),
  };
}

function unavailable(reason: ClvUnavailableReason): ComparableClvReceipt {
  return { status: "UNAVAILABLE", policyVersion: ODDS_RATIO_CLV_POLICY_VERSION, reason };
}
