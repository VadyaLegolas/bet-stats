import { describe, expect, it } from "vitest";

import { ConfigValidationError, dependencyReadiness, readServerConfig, redactSecrets } from "./index.js";

describe("server configuration", () => {
  it("fails closed in production without echoing supplied secret values", () => {
    const secret = "TEST_VALUE_D";

    expect(() => readServerConfig({ NODE_ENV: "production", DATA_PROVIDER_MODE: "live", FOOTBALL_DATA_API_TOKEN: secret }))
      .toThrowError(ConfigValidationError);

    try {
      readServerConfig({ NODE_ENV: "production", DATA_PROVIDER_MODE: "live", FOOTBALL_DATA_API_TOKEN: secret });
    } catch (error) {
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).toContain("REDIS_URL");
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each(["deterministic", "stub", "fake"])("rejects the %s adapter in production", (mode) => {
    expect(() => readServerConfig({
      NODE_ENV: "production",
      DATA_PROVIDER_MODE: mode,
      DATABASE_URL: "postgresql://localhost/database",
      REDIS_URL: "redis://localhost:6379",
      FOOTBALL_DATA_API_TOKEN: "TEST_VALUE_E",
    })).toThrowError(/DATA_PROVIDER_MODE/);
  });

  it("redacts nested secrets before serialization", () => {
    const redacted = redactSecrets({
      token: "alpha",
      nested: { password: "beta", safe: "visible" },
      values: [{ apiKey: "gamma" }],
    });

    expect(JSON.stringify(redacted)).toBe('{"token":"[REDACTED]","nested":{"password":"[REDACTED]","safe":"visible"},"values":[{"apiKey":"[REDACTED]"}]}');
  });

  it("reports PostgreSQL and Redis readiness independently", () => {
    expect(dependencyReadiness({ postgres: true, redis: false })).toEqual({
      ready: false,
      dependencies: { postgres: "ready", redis: "unavailable" },
    });
  });
});
