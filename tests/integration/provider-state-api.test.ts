import { describe, expect, it } from "vitest";

import { projectProviderState } from "../../apps/api/src/modules/fixtures/fixtures.service.js";

describe("safe fixture provider state API projection", () => {
  it("projects fallback with safe provider trigger time and sanitized receipt", () => {
    const state = projectProviderState({ id: "route-1", policyVersion: "provider-route-v1", selectedProvider: "football-data.org", candidates: ["football-data.org", "api-football"], trigger: "PRIMARY", outcome: "ADMITTED", createdAt: new Date("2026-09-12T12:00:00Z"), attempts: [{ state: "FAILED", provider: "football-data.org", reason: "UPSTREAM_UNAVAILABLE", createdAt: new Date("2026-09-12T12:00:01Z"), observation: null }, { state: "SUCCEEDED", provider: "api-football", reason: null, createdAt: new Date("2026-09-12T12:00:02Z"), observation: { observedAt: new Date("2026-09-12T12:00:03Z") } }] });
    expect(state).toEqual({ state: "FALLBACK", provider: "api-football", reason: "UPSTREAM_UNAVAILABLE", capturedAt: "2026-09-12T12:00:03.000Z", lastValidAt: null, retryAllowed: false, receipt: { id: "route-1", policyVersion: "provider-route-v1", outcome: "SUCCEEDED", trigger: "UPSTREAM_UNAVAILABLE" } });
    expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("projects sole-source failure as explicit no-fallback without numeric substitution", () => {
    expect(projectProviderState({ id: "route-2", policyVersion: "provider-route-v1", selectedProvider: "api-football", candidates: ["api-football"], trigger: "PRIMARY", outcome: "ADMITTED", createdAt: new Date("2026-09-12T12:00:00Z"), attempts: [{ state: "NO_FALLBACK", provider: "api-football", reason: "PROVIDER_UNAVAILABLE", createdAt: new Date("2026-09-12T12:00:01Z"), observation: null }] }, "2026-09-12T10:00:00.000Z")).toMatchObject({ state: "LIMITED", provider: "api-football", reason: "NO_PRODUCTION_FALLBACK", capturedAt: null, lastValidAt: "2026-09-12T10:00:00.000Z", retryAllowed: true });
  });
});
