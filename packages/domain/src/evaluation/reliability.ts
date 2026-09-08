import { createHash } from "node:crypto";

export const RELIABILITY_POLICY_VERSION = "reliability-policy-v1" as const;

export interface ReliabilityPolicyInput {
  readonly bucketCount: number;
  readonly minimumBucketCount: number;
  readonly alignmentTolerance: number;
}

export interface ReliabilityPolicy extends ReliabilityPolicyInput {
  readonly version: typeof RELIABILITY_POLICY_VERSION;
  readonly identity: `sha256:${string}`;
}

export type ReliabilityDirection = "UNDER_CONFIDENT" | "OVER_CONFIDENT" | "ALIGNED";
export type BucketEvidenceState = "SUFFICIENT" | "INSUFFICIENT";

export interface BinaryForecastEvent {
  readonly probability: number;
  readonly observed: 0 | 1;
}

export interface PersistedBinaryForecastEvent extends BinaryForecastEvent {
  readonly settlementReceiptId: string;
  readonly forecastSnapshotId: string;
  readonly fixtureId: string;
  readonly leagueId: string;
  readonly market: string;
  readonly selection: string;
  readonly modelVersion: string;
  readonly kickoffUtc: string;
}

export interface CategoricalReliabilitySource {
  readonly settlementReceiptId: string;
  readonly forecastSnapshotId: string;
  readonly fixtureId: string;
  readonly leagueId: string;
  readonly market: string;
  readonly modelVersion: string;
  readonly kickoffUtc: string;
  readonly outcome: string;
  readonly probabilities: readonly Readonly<{ selection: string; probability: number }>[];
}

export interface ReliabilityBucket {
  readonly index: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly upperBoundInclusive: boolean;
  readonly meanForecast: number;
  readonly observedFrequency: number;
  readonly count: number;
  readonly gap: number;
  readonly direction: ReliabilityDirection;
  readonly evidenceState: BucketEvidenceState;
}

export interface ReliabilityResult {
  readonly policy: ReliabilityPolicy;
  readonly eventCount: number;
  readonly buckets: readonly ReliabilityBucket[];
}

function requirePositiveInteger(value: number, code: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
}

export function createReliabilityPolicy(input: ReliabilityPolicyInput): ReliabilityPolicy {
  requirePositiveInteger(input.bucketCount, "INVALID_RELIABILITY_BUCKET_COUNT");
  requirePositiveInteger(input.minimumBucketCount, "INVALID_RELIABILITY_MINIMUM_BUCKET_COUNT");
  if (!Number.isFinite(input.alignmentTolerance) || input.alignmentTolerance < 0 || input.alignmentTolerance > 1) {
    throw new Error("INVALID_RELIABILITY_ALIGNMENT_TOLERANCE");
  }
  const receipt = { version: RELIABILITY_POLICY_VERSION, ...input };
  return {
    ...receipt,
    identity: `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}`,
  };
}

export const RELIABILITY_POLICY = createReliabilityPolicy({
  bucketCount: 10,
  minimumBucketCount: 20,
  alignmentTolerance: 0.02,
});

export function assignReliabilityBucket(probability: number, bucketCount: number): number {
  requirePositiveInteger(bucketCount, "INVALID_RELIABILITY_BUCKET_COUNT");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("INVALID_RELIABILITY_PROBABILITY");
  }
  return probability === 1 ? bucketCount - 1 : Math.floor(probability * bucketCount);
}

export function expandCategoricalScore(source: CategoricalReliabilitySource): readonly PersistedBinaryForecastEvent[] {
  if (!Array.isArray(source.probabilities) || source.probabilities.length < 2) throw new Error("INVALID_RELIABILITY_SCORE_VECTOR");
  return source.probabilities.map(({ selection, probability }) => {
    assignReliabilityBucket(probability, RELIABILITY_POLICY.bucketCount);
    return {
      settlementReceiptId: source.settlementReceiptId,
      forecastSnapshotId: source.forecastSnapshotId,
      fixtureId: source.fixtureId,
      leagueId: source.leagueId,
      market: source.market,
      selection,
      modelVersion: source.modelVersion,
      kickoffUtc: source.kickoffUtc,
      probability,
      observed: selection === source.outcome ? 1 : 0,
    };
  });
}

export function aggregateReliability(
  events: readonly BinaryForecastEvent[],
  inputPolicy: ReliabilityPolicy | ReliabilityPolicyInput = RELIABILITY_POLICY,
): ReliabilityResult {
  const policy = createReliabilityPolicy(inputPolicy);
  const accumulators = Array.from({ length: policy.bucketCount }, () => ({ probability: 0, observed: 0, count: 0 }));
  for (const event of events) {
    if (event.observed !== 0 && event.observed !== 1) throw new Error("INVALID_RELIABILITY_OBSERVATION");
    const accumulator = accumulators[assignReliabilityBucket(event.probability, policy.bucketCount)]!;
    accumulator.probability += event.probability;
    accumulator.observed += event.observed;
    accumulator.count += 1;
  }
  const buckets = accumulators.map((accumulator, index): ReliabilityBucket => {
    const meanForecast = accumulator.count === 0 ? 0 : accumulator.probability / accumulator.count;
    const observedFrequency = accumulator.count === 0 ? 0 : accumulator.observed / accumulator.count;
    const gap = observedFrequency - meanForecast;
    const direction: ReliabilityDirection = Math.abs(gap) <= policy.alignmentTolerance
      ? "ALIGNED"
      : gap > 0 ? "UNDER_CONFIDENT" : "OVER_CONFIDENT";
    return {
      index,
      lowerBound: index / policy.bucketCount,
      upperBound: (index + 1) / policy.bucketCount,
      upperBoundInclusive: index === policy.bucketCount - 1,
      meanForecast,
      observedFrequency,
      count: accumulator.count,
      gap,
      direction,
      evidenceState: accumulator.count >= policy.minimumBucketCount ? "SUFFICIENT" : "INSUFFICIENT",
    };
  });
  return { policy, eventCount: events.length, buckets };
}
