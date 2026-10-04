import { describe, expect, it, vi } from "vitest";

import { grantRetentionConsent } from "../../apps/api/src/modules/privacy/privacy.service.js";

describe("privacy consent serialization retry", () => {
  it("retries a bounded P2034 conflict and preserves the stable result", async () => {
    const granted = { status: "ON", policyVersion: "policy-v1", effectiveAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-20T12:00:00.000Z" };
    const transaction = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }))
      .mockResolvedValueOnce(granted);

    await expect(grantRetentionConsent({ $transaction: transaction } as never, {
      subjectId: "retry-subject",
      subjectKey: "retry-key",
      policy: { version: "policy-v1", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    })).resolves.toEqual(granted);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("maps exhausted serialization conflicts to a correlation-safe failure", async () => {
    const transaction = vi.fn().mockRejectedValue(Object.assign(new Error("serialization conflict"), { code: "P2034" }));

    await expect(grantRetentionConsent({ $transaction: transaction } as never, {
      subjectId: "retry-subject",
      subjectKey: "retry-key",
      policy: { version: "policy-v1", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
    })).rejects.toMatchObject({ code: "CONSENT_CONFLICT", correlationId: expect.any(String) });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
