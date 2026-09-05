import { describe, expect, it } from "vitest";

import {
  evaluateEligibility,
  parseRegionAllowlist,
  type EligibilityDecision,
} from "@bet-stats/domain";
import { EligibilityController } from "../../apps/api/src/modules/eligibility/eligibility.controller.js";
import { EligibilityGuard } from "../../apps/api/src/modules/eligibility/eligibility.guard.js";
import { AnalyticsShell } from "../../apps/web/components/analytics-shell.js";

const now = new Date("2026-08-28T12:00:00.000Z");

describe("server-authoritative eligibility", () => {
  it.each([
    [{ explicitRegion: undefined, ageAcknowledged: true }, "REGION_UNKNOWN"],
    [{ explicitRegion: "DE", ageAcknowledged: true }, "REGION_NOT_ALLOWED"],
    [{ explicitRegion: "PL", ageAcknowledged: false }, "AGE_NOT_ACKNOWLEDGED"],
    [{ explicitRegion: "PL", ageAcknowledged: undefined }, "AGE_NOT_ACKNOWLEDGED"],
    [{ explicitRegion: "PL", ageAcknowledged: true, checkedAt: "2026-08-28T10:59:59.000Z" }, "DECISION_STALE"],
  ] as const)("denies every non-affirmative input %#", (input, reason) => {
    expect(evaluateEligibility(input, { allowedRegions: ["PL"], now, maxDecisionAgeMs: 3_600_000 })).toMatchObject({
      allowed: false,
      reason,
    });
  });

  it("allows only an explicit enabled region with affirmative age acknowledgement", () => {
    expect(evaluateEligibility(
      { explicitRegion: "pl", ageAcknowledged: true, checkedAt: now.toISOString() },
      { allowedRegions: ["PL"], now, maxDecisionAgeMs: 3_600_000 },
    )).toEqual({ allowed: true, reason: "ELIGIBLE", region: "PL", checkedAt: now.toISOString() });
  });

  it("ships an empty allowlist and rejects malformed deployment configuration", () => {
    expect(parseRegionAllowlist(undefined)).toEqual([]);
    expect(() => parseRegionAllowlist("PL,not-a-region")).toThrow("ELIGIBILITY_ALLOWED_REGIONS");
  });

  it("does not treat advisory locale or IP hints as authoritative", () => {
    expect(evaluateEligibility(
      { explicitRegion: undefined, advisoryRegion: "PL", ageAcknowledged: true },
      { allowedRegions: ["PL"], now, maxDecisionAgeMs: 3_600_000 },
    )).toMatchObject({ allowed: false, reason: "REGION_UNKNOWN" });
  });

  it("controller responses are private, non-cacheable, and fail closed", () => {
    const responseHeaders = new Map<string, string>();
    const response = { header: (name: string, value: string) => responseHeaders.set(name, value) };
    const controller = new EligibilityController(["PL"], () => now);
    const decision = controller.check({ explicitRegion: "PL", ageAcknowledged: true }, response);

    expect(decision.allowed).toBe(true);
    expect(responseHeaders.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(controller.check(undefined, response)).toMatchObject({ allowed: false, reason: "ELIGIBILITY_CHECK_FAILED" });
  });

  it("guard denies missing claims and marks the request response as non-cacheable", () => {
    const headers = new Map<string, string>();
    const guard = new EligibilityGuard(["PL"], () => now);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { "accept-language": "pl-PL" } }),
        getResponse: () => ({ header: (name: string, value: string) => headers.set(name, value) }),
      }),
    };

    expect(() => guard.canActivate(context as never)).toThrow("REGION_UNKNOWN");
    expect(headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("withholds protected descendants for every denied decision", () => {
    const decision: EligibilityDecision = { allowed: false, reason: "REGION_UNKNOWN", region: null, checkedAt: now.toISOString() };
    const rendered = JSON.stringify(AnalyticsShell({ decision, children: "SECRET ANALYTICS" }));

    expect(rendered).not.toContain("SECRET ANALYTICS");
    expect(rendered).toContain("Betting-related analytics are unavailable until your region can be verified.");
  });
});
