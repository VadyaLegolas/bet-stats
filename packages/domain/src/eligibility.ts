export const ELIGIBILITY_REASONS = [
  "ELIGIBLE",
  "REGION_UNKNOWN",
  "REGION_NOT_ALLOWED",
  "AGE_NOT_ACKNOWLEDGED",
  "DECISION_STALE",
  "ELIGIBILITY_CHECK_FAILED",
] as const;

export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

export type EligibilityDecision = Readonly<{
  allowed: boolean;
  reason: EligibilityReason;
  region: string | null;
  checkedAt: string;
}>;

export type EligibilityInput = Readonly<{
  explicitRegion?: string | undefined;
  advisoryRegion?: string | undefined;
  ageAcknowledged?: boolean | undefined;
  checkedAt?: string | undefined;
}>;

export type EligibilityPolicy = Readonly<{
  allowedRegions: readonly string[];
  now: Date;
  maxDecisionAgeMs: number;
}>;

const REGION_CODE = /^[A-Z]{2}$/;

export function parseRegionAllowlist(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return [];

  const regions = value.split(",").map((region) => region.trim().toUpperCase());
  if (regions.some((region) => !REGION_CODE.test(region))) {
    throw new Error("ELIGIBILITY_ALLOWED_REGIONS must contain comma-separated ISO alpha-2 region codes");
  }

  return [...new Set(regions)];
}

export function evaluateEligibility(input: EligibilityInput, policy: EligibilityPolicy): EligibilityDecision {
  const checkedAt = policy.now.toISOString();
  const region = input.explicitRegion?.trim().toUpperCase() ?? null;

  if (region === null || !REGION_CODE.test(region)) {
    return { allowed: false, reason: "REGION_UNKNOWN", region: null, checkedAt };
  }
  if (!policy.allowedRegions.includes(region)) {
    return { allowed: false, reason: "REGION_NOT_ALLOWED", region, checkedAt };
  }
  if (input.ageAcknowledged !== true) {
    return { allowed: false, reason: "AGE_NOT_ACKNOWLEDGED", region, checkedAt };
  }

  const decisionTime = input.checkedAt === undefined ? Number.NaN : Date.parse(input.checkedAt);
  const age = policy.now.getTime() - decisionTime;
  if (!Number.isFinite(decisionTime) || age < 0 || age > policy.maxDecisionAgeMs) {
    return { allowed: false, reason: "DECISION_STALE", region, checkedAt };
  }

  return { allowed: true, reason: "ELIGIBLE", region, checkedAt };
}

export function failedEligibilityDecision(now: Date): EligibilityDecision {
  return {
    allowed: false,
    reason: "ELIGIBILITY_CHECK_FAILED",
    region: null,
    checkedAt: now.toISOString(),
  };
}
