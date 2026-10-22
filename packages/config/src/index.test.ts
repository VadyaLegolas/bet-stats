import { describe, expect, it } from "vitest";

import { ConfigValidationError, dependencyReadiness, readBackupConfig, readServerConfig, redactSecrets } from "./index.js";

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

  it("requires and redacts an independent API-Football key in production live mode", () => {
    const common = { NODE_ENV: "production", DATA_PROVIDER_MODE: "live", DATABASE_URL: "postgresql://localhost/db", REDIS_URL: "redis://localhost:6379", FOOTBALL_DATA_API_TOKEN: "football-secret" };
    expect(() => readServerConfig(common)).toThrowError(/API_FOOTBALL_API_KEY/);
    const config = readServerConfig({ ...common, API_FOOTBALL_API_KEY: "api-football-secret" });
    expect(config.API_FOOTBALL_API_KEY).toBe("api-football-secret");
    expect(JSON.stringify(redactSecrets(config))).not.toMatch(/football-secret|api-football-secret/);
  });

  it("reports PostgreSQL and Redis readiness independently", () => {
    expect(dependencyReadiness({ postgres: true, redis: false })).toEqual({
      ready: false,
      dependencies: { postgres: "ready", redis: "unavailable" },
    });
  });
});

describe("backup configuration", () => {
  it("keeps backups disabled unless the operator sets the exact enable literal", () => {
    expect(readBackupConfig({}).enabled).toBe(false);
    expect(readBackupConfig({ BACKUP_ENABLED: "true" }).enabled).toBe(true);
    expect(readBackupConfig({ BACKUP_ENABLED: "1" }).enabled).toBe(true);
    for (const value of ["TRUE", "True", "yes", "on", "1 ", ""]) {
      expect(readBackupConfig({ BACKUP_ENABLED: value }).enabled).toBe(false);
    }
  });

  it("keeps directories absent unless the operator supplied absolute paths", () => {
    expect(readBackupConfig({}).dir).toBeUndefined();
    expect(readBackupConfig({}).offsiteDir).toBeUndefined();
    expect(readBackupConfig({ BACKUP_DIR: "backups" }).dir).toBeUndefined();
    expect(readBackupConfig({ BACKUP_DIR: "./backups" }).dir).toBeUndefined();
    expect(readBackupConfig({ BACKUP_OFFSITE_DIR: "offsite" }).offsiteDir).toBeUndefined();
    expect(readBackupConfig({ BACKUP_DIR: " /var/backups " }).dir).toBe("/var/backups");
    expect(readBackupConfig({ BACKUP_DIR: "D:\\backups" }).dir).toBe("D:\\backups");
    expect(readBackupConfig({ BACKUP_OFFSITE_DIR: "/mnt/offsite" }).offsiteDir).toBe("/mnt/offsite");
  });

  it("defaults retention to 14 only when entirely absent and fails closed on present-but-invalid values", () => {
    expect(readBackupConfig({}).retentionCount).toBe(14);
    expect(readBackupConfig({ BACKUP_RETENTION_COUNT: "30" }).retentionCount).toBe(30);
    expect(readBackupConfig({ BACKUP_RETENTION_COUNT: "1" }).retentionCount).toBe(1);
    expect(readBackupConfig({ BACKUP_RETENTION_COUNT: "365" }).retentionCount).toBe(365);
    for (const value of ["abc", "0", "366", "-1", "14.5", ""]) {
      expect(readBackupConfig({ BACKUP_RETENTION_COUNT: value }).retentionCount).toBeUndefined();
    }
  });

  it("defaults the drill interval to 168 hours when absent", () => {
    expect(readBackupConfig({}).drillIntervalHours).toBe(168);
    expect(readBackupConfig({ BACKUP_DRILL_INTERVAL_HOURS: "24" }).drillIntervalHours).toBe(24);
    expect(readBackupConfig({ BACKUP_DRILL_INTERVAL_HOURS: "soon" }).drillIntervalHours).toBeUndefined();
  });

  it("carries trimmed pg identity overrides through and leaves them absent otherwise", () => {
    const absent = readBackupConfig({});
    expect(absent.pgUser).toBeUndefined();
    expect(absent.pgDb).toBeUndefined();
    expect(absent.pgBinDir).toBeUndefined();
    expect(absent.pgContainer).toBeUndefined();

    const present = readBackupConfig({
      PG_BIN: " /opt/pg18/bin ",
      BACKUP_PG_CONTAINER: " football-prediction-platform-postgres-1 ",
      BACKUP_PG_USER: " backup_role ",
      BACKUP_PG_DB: " bet_stats ",
    });
    expect(present.pgBinDir).toBe("/opt/pg18/bin");
    expect(present.pgContainer).toBe("football-prediction-platform-postgres-1");
    expect(present.pgUser).toBe("backup_role");
    expect(present.pgDb).toBe("bet_stats");

    expect(readBackupConfig({ BACKUP_PG_USER: "   " }).pgUser).toBeUndefined();
    expect(readBackupConfig({ BACKUP_PG_DB: "" }).pgDb).toBeUndefined();
  });

  it("does not leak backup directory values through secret redaction", () => {
    const config = readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: "/var/backups", BACKUP_PG_DB: "bet_stats" });
    expect(JSON.stringify(redactSecrets(config))).toContain("/var/backups");
  });
});
