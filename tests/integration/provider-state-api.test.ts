import { describe, expect, it } from "vitest";

import { projectProviderState } from "../../apps/api/src/modules/fixtures/fixtures.service.js";

describe("safe fixture provider state API projection", () => {
  it("projects fallback with safe provider trigger time and sanitized receipt", () => {
    const state = projectProviderState({ id: "route-1", policyVersion: "provider-route-v1", selectedProvider: "api-football", candidates: ["football-data.org", "api-football"], trigger: "UPSTREAM_UNAVAILABLE", outcome: "SUCCEEDED", createdAt: new Date("2026-09-12T12:00:00Z"), attempts: [{ provider: "api-football", reason: null, createdAt: new Date("2026-09-12T12:00:01Z"), observation: { observedAt: new Date("2026-09-12T12:00:02Z") } }] });
    expect(state).toEqual({ state: "FALLBACK", provider: "api-football", reason: "UPSTREAM_UNAVAILABLE", capturedAt: "2026-09-12T12:00:02.000Z", lastValidAt: null, retryAllowed: false, receipt: { id: "route-1", policyVersion: "provider-route-v1", outcome: "SUCCEEDED", trigger: "UPSTREAM_UNAVAILABLE" } });
    expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("projects sole-source failure as explicit no-fallback without numeric substitution", () => {
    expect(projectProviderState({ id: "route-2", policyVersion: "provider-route-v1", selectedProvider: null, candidates: ["api-football"], trigger: "PROVIDER_UNAVAILABLE", outcome: "NO_FALLBACK", createdAt: new Date("2026-09-12T12:00:00Z"), attempts: [] }, "2026-09-12T10:00:00.000Z")).toMatchObject({ state: "LIMITED", provider: "api-football", reason: "NO_PRODUCTION_FALLBACK", capturedAt: null, lastValidAt: "2026-09-12T10:00:00.000Z", retryAllowed: true });
  });
});
