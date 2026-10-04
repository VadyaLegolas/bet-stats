import { createHash } from "node:crypto";

import {
  RELIABILITY_POLICY,
  aggregateReliability,
  type BucketEvidenceState,
  type PersistedBinaryForecastEvent,
  type ReliabilityResult,
} from "./reliability.js";

export const COHORT_HEALTH_POLICY_VERSION = "cohort-health-v1" as const;

export interface CohortHealthPolicyInput {
  readonly minimumFixtureCount: number;
  readonly minimumBucketCount: number;
}

export interface CohortHealthPolicy extends CohortHealthPolicyInput {
  readonly version: typeof COHORT_HEALTH_POLICY_VERSION;
  readonly identity: `sha256:${string}`;
}

export interface CohortDenominators {
  readonly fixtureCount: number;
  readonly forecastCount: number;
  readonly eventCount: number;
  readonly valueCount: number;
}

export type CohortHealthState = "UNAVAILABLE" | "LIMITED" | "AVAILABLE";
export type CohortHealthReason = "NO_SCOREABLE_FIXTURES" | "COHORT_BELOW_MINIMUM" | "BUCKET_BELOW_MINIMUM";

export interface CohortHealthResult {
  readonly state: CohortHealthState;
  readonly reasons: readonly CohortHealthReason[];
  readonly denominators: CohortDenominators;
  readonly policy: CohortHealthPolicy;
  readonly performanceClaim: "QUALIFIED_EVIDENCE" | null;
}

export function createCohortHealthPolicy(input: CohortHealthPolicyInput): CohortHealthPolicy {
  if (!Number.isInteger(input.minimumFixtureCount) || input.minimumFixtureCount <= 0) throw new Error("INVALID_COHORT_MINIMUM_FIXTURE_COUNT");
  if (!Number.isInteger(input.minimumBucketCount) || input.minimumBucketCount <= 0) throw new Error("INVALID_COHORT_MINIMUM_BUCKET_COUNT");
  const receipt = {
    version: COHORT_HEALTH_POLICY_VERSION,
    minimumFixtureCount: input.minimumFixtureCount,
    minimumBucketCount: input.minimumBucketCount,
  };
  return { ...receipt, identity: `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}` };
}

export const COHORT_HEALTH_POLICY = createCohortHealthPolicy({
  minimumFixtureCount: 50,
  minimumBucketCount: 20,
});

export function evaluateCohortHealth(
  evidence: Readonly<{
    denominators: CohortDenominators;
    buckets: readonly Readonly<{ count: number; evidenceState?: BucketEvidenceState }>[];
  }>,
  inputPolicy: CohortHealthPolicy | CohortHealthPolicyInput = COHORT_HEALTH_POLICY,
): CohortHealthResult {
  const policy = createCohortHealthPolicy(inputPolicy);
  for (const count of Object.values(evidence.denominators)) {
    if (!Number.isInteger(count) || count < 0) throw new Error("INVALID_COHORT_DENOMINATOR");
  }
  if (evidence.denominators.fixtureCount === 0) {
    return { state: "UNAVAILABLE", reasons: ["NO_SCOREABLE_FIXTURES"], denominators: evidence.denominators, policy, performanceClaim: null };
  }
  const reasons: CohortHealthReason[] = [];
  if (evidence.denominators.fixtureCount < policy.minimumFixtureCount) reasons.push("COHORT_BELOW_MINIMUM");
  if (evidence.buckets.some((bucket) => bucket.count > 0 && bucket.count < policy.minimumBucketCount)) reasons.push("BUCKET_BELOW_MINIMUM");
  return reasons.length > 0
    ? { state: "LIMITED", reasons, denominators: evidence.denominators, policy, performanceClaim: null }
    : { state: "AVAILABLE", reasons, denominators: evidence.denominators, policy, performanceClaim: "QUALIFIED_EVIDENCE" };
}

export interface ReliabilityCohortFilter {
  readonly leagueId: string;
  readonly modelVersion: string;
  readonly market: string;
  readonly fromUtc: string;
  readonly toUtcExclusive: string;
}

export interface ReliabilityCohortResult {
  readonly cohort: ReliabilityCohortFilter;
  readonly denominators: CohortDenominators;
  readonly reliability: ReliabilityResult;
  readonly health: CohortHealthResult;
}

export function aggregateReliabilityCohort(
  events: readonly PersistedBinaryForecastEvent[],
  cohort: ReliabilityCohortFilter,
): ReliabilityCohortResult {
  const from = Date.parse(cohort.fromUtc);
  const to = Date.parse(cohort.toUtcExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("INVALID_RELIABILITY_COHORT_PERIOD");
  const selected = events.filter((event) => {
    const kickoff = Date.parse(event.kickoffUtc);
    return event.leagueId === cohort.leagueId
      && event.modelVersion === cohort.modelVersion
      && event.market === cohort.market
      && kickoff >= from
      && kickoff < to;
  });
  const fixtureCount = new Set(selected.map((event) => event.fixtureId)).size;
  const forecastCount = new Set(selected.map((event) => event.forecastSnapshotId)).size;
  const valueCount = new Set(selected.flatMap((event) => event.valueReceiptId ? [event.valueReceiptId] : [])).size;
  const denominators = { fixtureCount, forecastCount, eventCount: selected.length, valueCount };
  const reliability = aggregateReliability(selected, RELIABILITY_POLICY);
  return {
    cohort: { ...cohort },
    denominators,
    reliability,
    health: evaluateCohortHealth({ denominators, buckets: reliability.buckets }),
  };
}
