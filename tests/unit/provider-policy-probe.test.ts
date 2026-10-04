import { describe, expect, it, vi } from "vitest";

import { runProviderPolicyProbe } from "../../scripts/provider-policy-probe.js";

const scope = { provider: "football-data.org", competitionId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES" };

describe("provider policy probe", () => {
  it.each([
    [{ environment: "production", optIn: true, credential: "fake" }, "PROBE_REFUSES_PRODUCTION"],
    [{ environment: "development", optIn: false, credential: "fake" }, "PROBE_OPT_IN_REQUIRED"],
    [{ environment: "development", optIn: true, credential: "" }, "PROBE_CREDENTIAL_REQUIRED"],
  ])("refuses unsafe invocation before network I/O", async (partial, code) => {
    const fetcher = vi.fn();
    await expect(runProviderPolicyProbe({ ...partial, scope, fetcher } as never)).rejects.toThrow(code);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("produces only a redacted pending request-bound artifact", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ competitionId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true }), { status: 200, headers: { "x-requests-available": "10", "x-requestcounter-reset": "2026-09-13T00:00:00.000Z", authorization: "secret", "x-account-id": "account" } }));
    const artifact = await runProviderPolicyProbe({ environment: "development", optIn: true, credential: "fake-secret", scope, fetcher, now: () => new Date("2026-09-12T12:00:00.000Z"), persist: false });
    expect(artifact).toMatchObject({ schemaVersion: 1, environment: "non-production", provider: scope.provider, endpoint: scope.endpoint, scope, quota: { limit: null, remaining: 10, resetAt: "2026-09-13T00:00:00.000Z", status: "known" }, disagreements: [], redaction: { credentialsPersisted: false, rawHeadersPersisted: false, rawPayloadPersisted: false }, approval: { status: "pending", approvedBy: null, approvedAt: null, policyVersion: null } });
    expect(artifact.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(artifact)).not.toMatch(/fake-secret|authorization|x-account/i);
  });

  it("keeps unknown facts null and records exact-scope disagreements", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ competitionId: "other", seasonId: "season-2026", endpoint: "FIXTURES", supported: true }), { status: 200 }));
    const artifact = await runProviderPolicyProbe({ environment: "test", optIn: true, credential: "fake", scope, fetcher, persist: false });
    expect(artifact.quota).toEqual({ limit: null, remaining: null, resetAt: null, status: "unknown" });
    expect(artifact.coverage).toEqual([]);
    expect(artifact.disagreements).toEqual(["COMPETITION_MISMATCH"]);
  });
});
