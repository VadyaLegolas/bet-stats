import type { EvidenceMatch } from "./contract.js";

export interface EvidenceEligibilityInput {
  readonly asOf: string;
  readonly matches: readonly EvidenceMatch[];
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`Invalid UTC instant: ${value}`);
  return parsed;
}

export function compareEvidence(left: EvidenceMatch, right: EvidenceMatch): number {
  return instant(left.kickoffUtc) - instant(right.kickoffUtc)
    || instant(left.observedAt) - instant(right.observedAt)
    || left.fixtureId.localeCompare(right.fixtureId);
}

export function selectEligibleEvidence(input: EvidenceEligibilityInput): readonly EvidenceMatch[] {
  const cutoff = instant(input.asOf);
  return input.matches
    .filter((match) => instant(match.effectiveAt) <= cutoff && instant(match.observedAt) <= cutoff)
    .sort(compareEvidence);
}
