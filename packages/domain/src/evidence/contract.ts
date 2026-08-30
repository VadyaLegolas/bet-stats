export type EvidenceLimitation = "NO_ELIGIBLE_HISTORY" | "LIMITED_HISTORY" | "MISSING_TIMESTAMP";

export interface EvidenceMatch {
  readonly fixtureId: string;
  readonly kickoffUtc: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly points?: 0 | 1 | 3;
  readonly teamId?: string;
  readonly opponentId?: string;
  readonly venue?: "HOME" | "AWAY";
  readonly goalsFor?: number;
  readonly goalsAgainst?: number;
}

export interface EvidenceSourceRef {
  readonly fixtureId: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceUpdatedAt: string | null;
  readonly payloadHash: string;
  readonly payloadBytes: number;
}

export interface EvidenceWindow {
  readonly requestedFrom: string | null;
  readonly requestedTo: string;
  readonly returnedFrom: string | null;
  readonly returnedTo: string | null;
}

export interface EvidenceComponent<T> {
  readonly value: T | null;
  readonly sampleSize: number;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly sourceRefs: readonly EvidenceSourceRef[];
  readonly limitation: EvidenceLimitation | null;
}

export interface EvidenceReceipt {
  readonly requestedAsOf: string;
  readonly resolvedAsOf: string;
  readonly configVersion: string;
  readonly sourceWindow: EvidenceWindow;
  readonly inputs: readonly EvidenceSourceRef[];
}

export function toSourceRef(match: EvidenceMatch): EvidenceSourceRef {
  return { fixtureId: match.fixtureId, effectiveAt: match.effectiveAt, observedAt: match.observedAt, sourceUpdatedAt: match.sourceUpdatedAt, payloadHash: match.payloadHash, payloadBytes: match.payloadBytes };
}
