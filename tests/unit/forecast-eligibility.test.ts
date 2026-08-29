import { describe, expect, it } from "vitest";

import { forecastEligibility } from "../../packages/domain/src/forecast-eligibility.js";

describe("forecast eligibility", () => {
  it("fails closed while canonical fixture identity is unresolved", () => {
    expect(forecastEligibility("UNRESOLVED")).toEqual({
      eligible: false,
      reason: "UNRESOLVED_CANONICAL_IDENTITY",
    });
  });
});
