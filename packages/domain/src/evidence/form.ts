import type { EvidenceComponent, EvidenceMatch, EvidenceWindow } from "./contract.js";
import { toSourceRef } from "./contract.js";
import { selectEligibleEvidence } from "./eligibility.js";

export interface WeightedFormInput {
  readonly asOf: string;
  readonly windowSize: 5 | 10;
  readonly matches: readonly EvidenceMatch[];
  readonly decay?: number;
  readonly requestedFrom?: string;
  readonly requestedTo?: string;
  readonly returnedFrom?: string;
  readonly returnedTo?: string;
  readonly historyTruncated?: boolean;
}

export interface WeightedFormResult extends EvidenceComponent<number> {
  readonly requestedAsOf: string;
  readonly resolvedAsOf: string;
  readonly requestedWindow: 5 | 10;
  readonly sourceWindow: EvidenceWindow;
  readonly oldestObservedAt: string | null;
  readonly newestObservedAt: string | null;
  readonly oldestSourceUpdatedAt: string | null;
  readonly newestSourceUpdatedAt: string | null;
}

export function calculateWeightedForm(input: WeightedFormInput): WeightedFormResult {
  const resolvedAsOf = new Date(input.asOf).toISOString();
  const eligible = selectEligibleEvidence({ asOf: resolvedAsOf, matches: input.matches });
  const selected = eligible.slice(-input.windowSize);
  const decay = input.decay ?? 0.85;
  const weighted = selected.reduce((total, match, index) => total + (match.points ?? 0) * decay ** (selected.length - index - 1), 0);
  const weight = selected.reduce((total, _match, index) => total + decay ** (selected.length - index - 1), 0);
  const sourceUpdates = selected.map((match) => match.sourceUpdatedAt).filter((value): value is string => value !== null).sort();
  const limitation = selected.length === 0 ? "NO_ELIGIBLE_HISTORY" : input.historyTruncated === true || selected.length < input.windowSize ? "LIMITED_HISTORY" : null;
  return {
    requestedAsOf: input.asOf,
    resolvedAsOf,
    requestedWindow: input.windowSize,
    value: weight === 0 ? null : weighted / weight,
    sampleSize: selected.length,
    windowStart: selected[0]?.effectiveAt ?? null,
    windowEnd: selected.at(-1)?.effectiveAt ?? null,
    sourceRefs: selected.map(toSourceRef),
    limitation,
    oldestObservedAt: selected[0]?.observedAt ?? null,
    newestObservedAt: selected.at(-1)?.observedAt ?? null,
    oldestSourceUpdatedAt: sourceUpdates[0] ?? null,
    newestSourceUpdatedAt: sourceUpdates.at(-1) ?? null,
    sourceWindow: {
      requestedFrom: input.requestedFrom ?? null,
      requestedTo: input.requestedTo ?? resolvedAsOf,
      returnedFrom: input.returnedFrom ?? selected[0]?.effectiveAt ?? null,
      returnedTo: input.returnedTo ?? selected.at(-1)?.effectiveAt ?? null,
    },
  };
}
