import { describe, expect, it } from "vitest";

import { readPrivacyRetentionConfig } from "@bet-stats/config";
import {
  RETAINED_HISTORY_CATEGORIES,
  resolveApprovedRetentionSubject,
  resolveRetentionPolicy,
} from "@bet-stats/domain";

describe("privacy retention policy", () => {
  it("is default deny when no approved inputs are configured", () => {
    const configuration = readPrivacyRetentionConfig({});

    expect(resolveRetentionPolicy(configuration)).toEqual({
      available: false,
      reason: "RETENTION_POLICY_UNAVAILABLE",
      missing: ["subjectProviderMode", "durationDays", "version", "effectiveAt"],
    });
  });

  it.each([
    ["subject provider", { PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["duration", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["version", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["effective date", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1" }],
  ])("keeps durable opt-in unavailable when policy incomplete: %s", (_label, environment) => {
    expect(resolveRetentionPolicy(readPrivacyRetentionConfig(environment))).toMatchObject({ available: false });
  });

  it("returns an approved policy only when every explicit value is present", () => {
    const policy = resolveRetentionPolicy(readPrivacyRetentionConfig({
      PRIVACY_SUBJECT_PROVIDER_MODE: "signed",
      PRIVACY_RETENTION_DURATION_DAYS: "30",
      PRIVACY_RETENTION_POLICY_VERSION: "policy-v1",
      PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z",
    }));

    expect(policy).toEqual({
      available: true,
      subjectProviderMode: "signed",
      durationDays: 30,
      version: "policy-v1",
      effectiveAt: "2026-10-01T00:00:00.000Z",
      coveredCategories: RETAINED_HISTORY_CATEGORIES,
    });
  });

  it.each(["ip", "cookie", "userAgent", "sessionId", "correlationId", "source", "log"])(
    "enforces identity rejection for ambient %s metadata",
    (field) => {
      expect(resolveApprovedRetentionSubject({
        mechanism: "ambient",
        [field]: "ambient-value",
      })).toEqual({ available: false, reason: "SUBJECT_IDENTITY_UNAVAILABLE" });
    },
  );

  it("accepts only a verified signed subject-provider assertion", () => {
    expect(resolveApprovedRetentionSubject({
      mechanism: "signed-subject-provider",
      subjectId: "opaque-subject",
      signatureVerified: true,
    })).toEqual({ available: true, subjectId: "opaque-subject" });
    expect(resolveApprovedRetentionSubject({
      mechanism: "signed-subject-provider",
      subjectId: "opaque-subject",
      signatureVerified: false,
    })).toEqual({ available: false, reason: "SUBJECT_IDENTITY_UNAVAILABLE" });
  });
});
