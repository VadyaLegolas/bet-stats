import { Decimal } from "decimal.js";

import { CANONICAL_UTC_INSTANT_PATTERN, MARKET_SELECTIONS, type OddsMarket, type OddsSelection } from "../odds/contract.js";
import { normalizeOddsBook } from "../odds/normalize.js";

export const NO_VIG_CLV_POLICY_VERSION = "no-vig-clv-v1";

export interface NoVigPriceSet {
  readonly market: OddsMarket;
  readonly sourceConvention: string;
  /** Candidate side: snapshot submission time. Closing side: observation time. */
  readonly observedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export type NoVigClvUnavailableReason =
  | "CLOSING_SET_MISSING"
  | "CLOSING_SET_INCOMPLETE"
  | "CANDIDATE_SET_INCOMPLETE"
  | "SOURCE_CONVENTION_MISMATCH"
  | "MARKET_MISMATCH"
  | "SELECTION_NOT_IN_MARKET"
  | "CLOSING_BEFORE_CANDIDATE"
  | "CLOSING_NOT_PRE_KICKOFF"
  | "INVALID_ODDS";

export type NoVigClvReceipt =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: typeof NO_VIG_CLV_POLICY_VERSION; reason: NoVigClvUnavailableReason }>
  | Readonly<{
      status: "AVAILABLE";
      policyVersion: typeof NO_VIG_CLV_POLICY_VERSION;
      selection: OddsSelection;
      pCandidateFair: string;
      pCloseFair: string;
      clv: string;
      sourceConvention: string;
      candidateObservedAt: string;
      closingObservedAt: string;
    }>;

const unavailable = (reason: NoVigClvUnavailableReason): NoVigClvReceipt => ({ status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason });

function complete(set: NoVigPriceSet): boolean {
  const expected = MARKET_SELECTIONS[set.market];
  const names = set.selections.map((item) => item.selection);
  return new Set(names).size === names.length && names.length === expected.length && expected.every((selection) => names.includes(selection));
}

function fairProbabilities(set: NoVigPriceSet): Map<OddsSelection, Decimal> | null {
  try {
    const book = normalizeOddsBook({
      fixtureId: "no-vig-clv",
      oddsSnapshotId: "no-vig-clv",
      market: set.market,
      sourceLabel: set.sourceConvention,
      capturedAt: set.observedAt,
      selections: set.selections,
    });
    return new Map(book.selections.map((item) => [item.selection, new Decimal(item.noVigProbability)]));
  } catch {
    return null;
  }
}

/**
 * Read-time, evaluation-only CLV (D-04): both prices are de-vigged by multiplicative normalization over the full
 * selection set of the same market and source; clv = pClose_fair / pCandidate_fair - 1. A missing or incomparable
 * price is reported as UNAVAILABLE and never synthesized.
 */
export function calculateNoVigClv(input: Readonly<{ selection: OddsSelection; candidate: NoVigPriceSet; closing: NoVigPriceSet | null; kickoffUtc: string }>): NoVigClvReceipt {
  const { candidate, closing } = input;
  if (closing === null) return unavailable("CLOSING_SET_MISSING");
  if (candidate.market !== closing.market) return unavailable("MARKET_MISMATCH");
  if (!MARKET_SELECTIONS[candidate.market].includes(input.selection)) return unavailable("SELECTION_NOT_IN_MARKET");
  if (!complete(candidate)) return unavailable("CANDIDATE_SET_INCOMPLETE");
  if (!complete(closing)) return unavailable("CLOSING_SET_INCOMPLETE");
  if (candidate.sourceConvention !== closing.sourceConvention) return unavailable("SOURCE_CONVENTION_MISMATCH");
  if (!CANONICAL_UTC_INSTANT_PATTERN.test(candidate.observedAt) || !CANONICAL_UTC_INSTANT_PATTERN.test(closing.observedAt)) return unavailable("INVALID_ODDS");
  const candidateAt = Date.parse(candidate.observedAt);
  const closingAt = Date.parse(closing.observedAt);
  if (closingAt >= Date.parse(input.kickoffUtc)) return unavailable("CLOSING_NOT_PRE_KICKOFF");
  if (closingAt < candidateAt) return unavailable("CLOSING_BEFORE_CANDIDATE");
  const pCandidate = fairProbabilities(candidate)?.get(input.selection);
  const pClose = fairProbabilities(closing)?.get(input.selection);
  if (!pCandidate || !pClose) return unavailable("INVALID_ODDS");
  return {
    status: "AVAILABLE",
    policyVersion: NO_VIG_CLV_POLICY_VERSION,
    selection: input.selection,
    pCandidateFair: pCandidate.toString(),
    pCloseFair: pClose.toString(),
    clv: pClose.div(pCandidate).minus(1).toString(),
    sourceConvention: candidate.sourceConvention,
    candidateObservedAt: candidate.observedAt,
    closingObservedAt: closing.observedAt,
  };
}
