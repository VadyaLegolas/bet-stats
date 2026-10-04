export const RETAINED_HISTORY_CATEGORIES = ["MANUAL_ODDS", "VIEWED_RESULT"] as const;

export type RetainedHistoryCategory = (typeof RETAINED_HISTORY_CATEGORIES)[number];

export type RetentionPolicyInput = {
  subjectProviderMode?: "signed" | undefined;
  durationDays?: number | undefined;
  version?: string | undefined;
  effectiveAt?: string | undefined;
};

type RetentionPolicyField = keyof RetentionPolicyInput;

export type RetentionPolicyResolution =
  | {
      available: false;
      reason: "RETENTION_POLICY_UNAVAILABLE";
      missing: RetentionPolicyField[];
    }
  | {
      available: true;
      subjectProviderMode: "signed";
      durationDays: number;
      version: string;
      effectiveAt: string;
      coveredCategories: typeof RETAINED_HISTORY_CATEGORIES;
    };

export function resolveRetentionPolicy(input: RetentionPolicyInput): RetentionPolicyResolution {
  const missing: RetentionPolicyField[] = [];
  if (input.subjectProviderMode !== "signed") missing.push("subjectProviderMode");
  if (!Number.isSafeInteger(input.durationDays) || (input.durationDays ?? 0) <= 0) missing.push("durationDays");
  if (!input.version) missing.push("version");
  if (!input.effectiveAt || !isCanonicalInstant(input.effectiveAt)) missing.push("effectiveAt");

  if (missing.length > 0) {
    return { available: false, reason: "RETENTION_POLICY_UNAVAILABLE", missing };
  }

  return {
    available: true,
    subjectProviderMode: "signed",
    durationDays: input.durationDays!,
    version: input.version!,
    effectiveAt: input.effectiveAt!,
    coveredCategories: RETAINED_HISTORY_CATEGORIES,
  };
}

export type ApprovedRetentionSubject =
  | { available: true; subjectId: string }
  | { available: false; reason: "SUBJECT_IDENTITY_UNAVAILABLE" };

export function resolveApprovedRetentionSubject(input: unknown): ApprovedRetentionSubject {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return unavailableSubject();
  const candidate = input as Record<string, unknown>;
  const exactKeys = Object.keys(candidate).sort().join(",");
  if (exactKeys !== "mechanism,signatureVerified,subjectId") return unavailableSubject();
  if (candidate.mechanism !== "signed-subject-provider" || candidate.signatureVerified !== true) return unavailableSubject();
  if (typeof candidate.subjectId !== "string" || candidate.subjectId.length < 1 || candidate.subjectId.length > 256) return unavailableSubject();
  return { available: true, subjectId: candidate.subjectId };
}

function unavailableSubject(): ApprovedRetentionSubject {
  return { available: false, reason: "SUBJECT_IDENTITY_UNAVAILABLE" };
}

function isCanonicalInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
