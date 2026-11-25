import { Decimal } from "decimal.js";

import { selectionsFor } from "../markets/registry.js";
import { canonicalizeDecimalOdds, CANONICAL_UTC_INSTANT_PATTERN, type OddsBookInput, type OddsMarket, type OddsSelection } from "../odds/contract.js";
import { normalizeOddsBook } from "../odds/normalize.js";

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

function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UTC_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function unavailable(reason: NoVigClvUnavailableReason): NoVigClvReceipt {
  return { status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason };
}

function isEmpty(set: NoVigClvPriceSet | null | undefined): boolean {
  return !set || !Array.isArray(set.selections) || set.selections.length === 0;
}

/** True only when the set holds exactly the selections of the market, each once. */
function isCompleteSet(set: NoVigClvPriceSet, expected: readonly OddsSelection[]): boolean {
  if (!Array.isArray(set.selections)) return false;
  const names = set.selections.map((item) => (item && typeof item === "object" ? item.selection : undefined));
  return names.length === expected.length && new Set(names).size === names.length && expected.every((selection) => names.includes(selection));
}

/** Multiplicative de-vig through the frozen normalizer; the selection's fair probability or null on invalid odds. */
function fairProbability(set: NoVigClvPriceSet, market: OddsMarket, selection: OddsSelection, label: string): string | null {
  try {
    const selections = set.selections.map((item) => {
      if (typeof item.decimalOdds !== "string") throw new Error("INVALID_DECIMAL_ODDS");
      return { selection: item.selection, decimalOdds: canonicalizeDecimalOdds(item.decimalOdds) };
    });
    const book: OddsBookInput = { fixtureId: "no-vig-clv", oddsSnapshotId: label, market, sourceLabel: set.sourceConvention, capturedAt: set.observedAt, selections };
    return normalizeOddsBook(book).selections.find((item) => item.selection === selection)?.noVigProbability ?? null;
  } catch {
    return null;
  }
}

/**
 * D-04 read-time evaluation layer `no-vig-clv-v1`: clv = pClose_fair / pCandidate_fair - 1 on the candidate
 * selection, both probabilities de-vigged multiplicatively over the FULL set of the SAME market and SAME
 * source convention. Pure: no clock, database or network. A missing or non-comparable price is reported as
 * UNAVAILABLE with a typed reason and is never interpolated or synthesized.
 *
 * Check order (pinned by tests): closing missing, candidate incomplete, closing incomplete, source mismatch,
 * invalid timestamp, closing not pre-kickoff, closing before candidate, invalid odds. A selection or market
 * outside the supported set cannot be served by the candidate set and is reported as CANDIDATE_SET_INCOMPLETE.
 */
export function calculateNoVigClv(input: NoVigClvInput): NoVigClvReceipt {
  const { candidate, closing } = input;
  if (isEmpty(closing)) return unavailable("CLOSING_SET_MISSING");
  const expected = selectionsFor(input.market);
  if (!expected || !expected.includes(input.selection) || isEmpty(candidate) || !isCompleteSet(candidate!, expected)) return unavailable("CANDIDATE_SET_INCOMPLETE");
  if (!isCompleteSet(closing!, expected)) return unavailable("CLOSING_SET_INCOMPLETE");
  if (typeof candidate!.sourceConvention !== "string" || !candidate!.sourceConvention.trim() || candidate!.sourceConvention !== closing!.sourceConvention) return unavailable("SOURCE_CONVENTION_MISMATCH");
  if (!canonicalInstant(candidate!.observedAt) || !canonicalInstant(closing!.observedAt) || !canonicalInstant(input.kickoffUtc)) return unavailable("INVALID_TIMESTAMP");

  const kickoffMs = Date.parse(input.kickoffUtc);
  const candidateMs = Date.parse(candidate!.observedAt);
  const closingMs = Date.parse(closing!.observedAt);
  if (closingMs >= kickoffMs) return unavailable("CLOSING_NOT_PRE_KICKOFF");
  if (closingMs < candidateMs) return unavailable("CLOSING_BEFORE_CANDIDATE");

  const pCandidateFair = fairProbability(candidate!, input.market, input.selection, "candidate");
  const pCloseFair = fairProbability(closing!, input.market, input.selection, "closing");
  if (pCandidateFair === null || pCloseFair === null) return unavailable("INVALID_ODDS");

  return {
    status: "AVAILABLE",
    policyVersion: NO_VIG_CLV_POLICY_VERSION,
    market: input.market,
    selection: input.selection,
    sourceConvention: candidate!.sourceConvention,
    candidateObservedAt: candidate!.observedAt,
    closingObservedAt: closing!.observedAt,
    pCandidateFair,
    pCloseFair,
    clv: new Decimal(pCloseFair).div(pCandidateFair).minus(1).toString(),
  };
}
