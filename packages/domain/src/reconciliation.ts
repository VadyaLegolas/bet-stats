const CANDIDATE_WINDOW_MS = 36 * 60 * 60 * 1_000;

export interface IncomingFixtureIdentity {
  provider: string;
  externalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffUtc: string;
}

export interface FixtureCandidate {
  canonicalFixtureId: string;
  kickoffUtc: string;
  teamPairExact: boolean;
  identityConfidence: "strong" | "fuzzy";
}

export interface FixtureExternalReference {
  canonicalFixtureId: string;
  provider: string;
  externalId: string;
}

export interface ReconciliationContext {
  externalReference?: FixtureExternalReference;
  candidates: readonly FixtureCandidate[];
  suspectedPostponement?: boolean;
}

export type FixtureReconciliationResult =
  | {
      disposition: "resolved";
      canonicalFixtureId: string;
      method: "EXACT_EXTERNAL_REF" | "UNIQUE_CONSERVATIVE_MATCH";
      updateKickoff: boolean;
    }
  | {
      disposition: "review";
      reason:
        | "AMBIGUOUS_CANDIDATES"
        | "INSUFFICIENT_IDENTITY_EVIDENCE"
        | "NO_CANDIDATES"
        | "POSTPONEMENT_WITHOUT_LINEAGE";
      candidateFixtureIds: string[];
    };

export interface ReconciliationDecision {
  id: string;
  action: "LINK" | "CREATE" | "QUARANTINE" | "REJECT";
  method: "EXACT_EXTERNAL_REF" | "UNIQUE_CONSERVATIVE_MATCH" | "MANUAL_REVIEW" | "OPERATOR_CONFIRMED";
  evidence: Readonly<Record<string, unknown>>;
  confidence: number;
  actor: string;
  decidedAt: string;
  supersedesDecisionId?: string;
}

export function reconcileFixture(
  incoming: IncomingFixtureIdentity,
  context: ReconciliationContext,
): FixtureReconciliationResult {
  const exactReference = context.externalReference;
  if (
    exactReference &&
    exactReference.provider === incoming.provider &&
    exactReference.externalId === incoming.externalId
  ) {
    return {
      disposition: "resolved",
      canonicalFixtureId: exactReference.canonicalFixtureId,
      method: "EXACT_EXTERNAL_REF",
      updateKickoff: true,
    };
  }

  const kickoff = Date.parse(incoming.kickoffUtc);
  const candidates = context.candidates.filter(
    (candidate) => Math.abs(Date.parse(candidate.kickoffUtc) - kickoff) <= CANDIDATE_WINDOW_MS,
  );
  const candidateFixtureIds = candidates.map((candidate) => candidate.canonicalFixtureId);

  if (context.suspectedPostponement) {
    return { disposition: "review", reason: "POSTPONEMENT_WITHOUT_LINEAGE", candidateFixtureIds };
  }

  const conservative = candidates.filter(
    (candidate) => candidate.teamPairExact && candidate.identityConfidence === "strong",
  );
  if (conservative.length === 1 && candidates.length === 1) {
    const candidate = conservative[0];
    if (!candidate) {
      throw new Error("Conservative candidate invariant violated");
    }
    return {
      disposition: "resolved",
      canonicalFixtureId: candidate.canonicalFixtureId,
      method: "UNIQUE_CONSERVATIVE_MATCH",
      updateKickoff: false,
    };
  }

  if (conservative.length > 1 || candidates.length > 1) {
    return { disposition: "review", reason: "AMBIGUOUS_CANDIDATES", candidateFixtureIds };
  }

  return {
    disposition: "review",
    reason: candidates.length === 0 ? "NO_CANDIDATES" : "INSUFFICIENT_IDENTITY_EVIDENCE",
    candidateFixtureIds,
  };
}

export function appendReconciliationDecision(
  history: readonly ReconciliationDecision[],
  decision: ReconciliationDecision,
): readonly ReconciliationDecision[] {
  if (decision.confidence < 0 || decision.confidence > 1) {
    throw new RangeError("Decision confidence must be between 0 and 1");
  }
  if (
    decision.supersedesDecisionId &&
    !history.some((existing) => existing.id === decision.supersedesDecisionId)
  ) {
    throw new Error("A superseded decision must already exist in this case history");
  }
  if (history.some((existing) => existing.id === decision.id)) {
    throw new Error("Decision IDs are append-only and must be unique");
  }

  return [...history, Object.freeze({ ...decision, evidence: Object.freeze({ ...decision.evidence }) })];
}

export const reconciliationPolicy = Object.freeze({
  candidateWindowHours: 36,
  timeWindowIsMergeProof: false,
  fuzzyMatchingIsSuggestionOnly: true,
});
