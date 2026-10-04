import { describe, expect, it } from "vitest";

import { parseRetainedViewInput } from "../../apps/api/src/modules/privacy/privacy.service.js";

describe("retained view input", () => {
  it("accepts the closed RESULT vocabulary and canonical identifier", () => {
    expect(parseRetainedViewInput({ resourceType: "RESULT", resourceId: "fixture:2026-09_24.1" })).toEqual({ resourceType: "RESULT", resourceId: "fixture:2026-09_24.1" });
  });

  it.each([
    { resourceType: "FORECAST", resourceId: "fixture-1" },
    { resourceType: "RESULT", resourceId: "contains control\n" },
    { resourceType: "RESULT", resourceId: "x".repeat(129) },
  ])("rejects unknown, control-character, and oversized values", (input) => {
    expect(parseRetainedViewInput(input)).toBeNull();
  });
});
