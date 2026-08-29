import { describe, expect, it } from "vitest";

import { projectHealth } from "../../apps/api/src/modules/health/health.controller.js";

describe("dependency readiness", () => {
  it("distinguishes PostgreSQL and Redis failure without leaking diagnostics", () => {
    const secret = "TEST_VALUE_C";
    const response = projectHealth({ postgres: false, redis: true }, "correlation-123", new Error(secret));
    const serialized = JSON.stringify(response);

    expect(response).toEqual({
      status: "not-ready",
      correlationId: "correlation-123",
      dependencies: { postgres: "unavailable", redis: "ready" },
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("stack");
  });
});
