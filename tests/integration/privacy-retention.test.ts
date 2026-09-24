import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPrivacyRetentionConfig } from "@bet-stats/config";
import {
  RETAINED_HISTORY_CATEGORIES,
  resolveApprovedRetentionSubject,
  resolveRetentionPolicy,
} from "@bet-stats/domain";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  grantRetentionConsent,
  retainViewedResult,
  withdrawRetentionConsent,
} from "../../apps/api/src/modules/privacy/privacy.service.js";
import { purgeExpiredRetention } from "../../workers/data-sync/src/jobs/retention-purge.js";

describe("privacy retention policy", () => {
  it("is default deny when no approved inputs are configured", () => {
    const configuration = readPrivacyRetentionConfig({});

    expect(resolveRetentionPolicy(configuration)).toEqual({
      available: false,
      reason: "RETENTION_POLICY_UNAVAILABLE",
      missing: ["subjectProviderMode", "durationDays", "version", "effectiveAt"],
    });
  });

  it.each([
    ["subject provider", { PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["duration", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["version", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z" }],
    ["effective date", { PRIVACY_SUBJECT_PROVIDER_MODE: "signed", PRIVACY_RETENTION_DURATION_DAYS: "30", PRIVACY_RETENTION_POLICY_VERSION: "policy-v1" }],
  ])("keeps durable opt-in unavailable when policy incomplete: %s", (_label, environment) => {
    expect(resolveRetentionPolicy(readPrivacyRetentionConfig(environment))).toMatchObject({ available: false });
  });

  it("returns an approved policy only when every explicit value is present", () => {
    const policy = resolveRetentionPolicy(readPrivacyRetentionConfig({
      PRIVACY_SUBJECT_PROVIDER_MODE: "signed",
      PRIVACY_RETENTION_DURATION_DAYS: "30",
      PRIVACY_RETENTION_POLICY_VERSION: "policy-v1",
      PRIVACY_RETENTION_EFFECTIVE_AT: "2026-10-01T00:00:00.000Z",
    }));

    expect(policy).toEqual({
      available: true,
      subjectProviderMode: "signed",
      durationDays: 30,
      version: "policy-v1",
      effectiveAt: "2026-10-01T00:00:00.000Z",
      coveredCategories: RETAINED_HISTORY_CATEGORIES,
    });
  });

  it.each(["ip", "cookie", "userAgent", "sessionId", "correlationId", "source", "log"])(
    "enforces identity rejection for ambient %s metadata",
    (field) => {
      expect(resolveApprovedRetentionSubject({
        mechanism: "ambient",
        [field]: "ambient-value",
      })).toEqual({ available: false, reason: "SUBJECT_IDENTITY_UNAVAILABLE" });
    },
  );

  it("accepts only a verified signed subject-provider assertion", () => {
    expect(resolveApprovedRetentionSubject({
      mechanism: "signed-subject-provider",
      subjectId: "opaque-subject",
      signatureVerified: true,
    })).toEqual({ available: true, subjectId: "opaque-subject" });
    expect(resolveApprovedRetentionSubject({
      mechanism: "signed-subject-provider",
      subjectId: "opaque-subject",
      signatureVerified: false,
    })).toEqual({ available: false, reason: "SUBJECT_IDENTITY_UNAVAILABLE" });
  });
});

const workspaceRoot = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(workspaceRoot, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-privacy-${process.pid}`;
let databaseUrl = "";
let database: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sql(statement: string): string[] {
  const output = docker("exec", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "bet_stats", "-At", "-c", statement);
  return output.length === 0 ? [] : output.split(/\r?\n/);
}

function waitForPostgres(): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats");
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw lastError;
}

describe("privacy retention persistence", () => {
  beforeAll(() => {
    docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", containerName, "5432/tcp").split(":").at(-1);
    if (!port) throw new Error("Docker did not publish the PostgreSQL port");
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: databaseRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    database = createPrismaClient(databaseUrl);
    sql(`
      INSERT INTO "League" (id, name, "countryCode", "createdAt", "updatedAt") VALUES ('privacy-league', 'Privacy League', 'PL', now(), now());
      INSERT INTO "Season" (id, "leagueId", label, "startsOn", "endsOn", "createdAt", "updatedAt") VALUES ('privacy-season', 'privacy-league', '2026', '2026-01-01', '2026-12-31', now(), now());
      INSERT INTO "Team" (id, name, "normalizedName", "countryCode", "createdAt", "updatedAt") VALUES
        ('privacy-home', 'Home', 'home', 'PL', now(), now()), ('privacy-away', 'Away', 'away', 'PL', now(), now());
      INSERT INTO "Fixture" (id, "leagueId", "seasonId", "homeTeamId", "awayTeamId", "kickoffUtc", status, "createdAt", "updatedAt") VALUES
        ('privacy-fixture', 'privacy-league', 'privacy-season', 'privacy-home', 'privacy-away', now() + interval '1 day', 'SCHEDULED', now(), now());
      INSERT INTO "ManualOddsSnapshot" (id, "fixtureId", market, "inputHash", source, receipt, "submittedAt", "createdAt") VALUES
        ('privacy-odds', 'privacy-fixture', 'ONE_X_TWO', 'privacy-input', 'manual', '{}'::jsonb, now(), now());
    `);
  }, 180_000);

  afterAll(() => {
    void database?.$disconnect();
    try { docker("rm", "--force", containerName); } catch { /* owned-container cleanup is best effort */ }
  });

  it("default deny creates no personal history without active consent", () => {
    sql(`INSERT INTO "RetentionSubject" (id, "providerMode", "subjectKey", "approvedAt", "createdAt") VALUES ('deny-subject', 'SIGNED', 'deny-key', now(), now());`);
    expect(() => sql(`INSERT INTO "RetainedViewHistory" (id, "subjectId", "consentId", "resourceType", "resourceId", "viewedAt", "expiresAt", "createdAt") VALUES ('deny-view', 'deny-subject', 'missing-consent', 'RESULT', 'privacy-fixture', now(), now() + interval '1 day', now());`)).toThrow();
    expect(sql(`SELECT count(*) FROM "RetainedViewHistory" WHERE "subjectId"='deny-subject';`)).toEqual(["0"]);
  });

  it("keeps the association boundary separate and completely deletable", () => {
    sql(`
      INSERT INTO "RetentionSubject" (id, "providerMode", "subjectKey", "approvedAt", "createdAt") VALUES ('active-subject', 'SIGNED', 'active-key', now(), now());
      INSERT INTO "RetentionConsent" (id, "subjectId", "policyVersion", "policyEffectiveAt", "durationDays", "grantedAt", "expiresAt", "createdAt") VALUES ('active-consent', 'active-subject', 'test-policy', now() - interval '1 day', 30, now(), now() + interval '30 days', now());
      INSERT INTO "RetainedOddsHistory" (id, "subjectId", "consentId", "oddsSnapshotId", "retainedAt", "expiresAt", "createdAt") VALUES ('active-odds', 'active-subject', 'active-consent', 'privacy-odds', now(), now() + interval '29 days', now());
      INSERT INTO "RetainedViewHistory" (id, "subjectId", "consentId", "resourceType", "resourceId", "viewedAt", "expiresAt", "createdAt") VALUES ('active-view', 'active-subject', 'active-consent', 'RESULT', 'privacy-fixture', now(), now() + interval '29 days', now());
    `);
    expect(sql(`SELECT (SELECT count(*) FROM "RetainedOddsHistory") || ':' || (SELECT count(*) FROM "RetainedViewHistory");`)).toEqual(["1:1"]);

    sql(`DELETE FROM "RetentionSubject" WHERE id='active-subject';`);
    expect(sql(`SELECT (SELECT count(*) FROM "RetainedOddsHistory") || ':' || (SELECT count(*) FROM "RetainedViewHistory") || ':' || (SELECT count(*) FROM "ManualOddsSnapshot" WHERE id='privacy-odds');`)).toEqual(["0:0:1"]);
  });

  it("expiry denies new personal associations", () => {
    sql(`
      INSERT INTO "RetentionSubject" (id, "providerMode", "subjectKey", "approvedAt", "createdAt") VALUES ('expired-subject', 'SIGNED', 'expired-key', now() - interval '3 days', now());
      INSERT INTO "RetentionConsent" (id, "subjectId", "policyVersion", "policyEffectiveAt", "durationDays", "grantedAt", "expiresAt", "createdAt") VALUES ('expired-consent', 'expired-subject', 'expired-policy', now() - interval '3 days', 1, now() - interval '2 days', now() - interval '1 day', now());
    `);
    expect(() => sql(`INSERT INTO "RetainedViewHistory" (id, "subjectId", "consentId", "resourceType", "resourceId", "viewedAt", "expiresAt", "createdAt") VALUES ('expired-view', 'expired-subject', 'expired-consent', 'RESULT', 'privacy-fixture', now(), now() + interval '1 hour', now());`)).toThrow();
  });

  it("keeps immutable schema free of reverse subject links", () => {
    const forbidden = sql(`
      SELECT "table_name" || '.' || "column_name"
      FROM information_schema.columns
      WHERE table_schema='public'
        AND "table_name" IN ('ForecastSnapshot','ForecastMarket','ManualOddsSnapshot','ManualOddsSelection','ValueReceipt','SettlementReceipt','ForecastScore','ValueSettlement')
        AND lower("column_name") ~ '(subject|session|correlation|consent)'
      ORDER BY 1;
    `);
    expect(forbidden).toEqual([]);
  });

  it("consent transaction creates an active versioned grant under the subject lock", async () => {
    const granted = await grantRetentionConsent(database, {
      subjectId: "transaction-subject",
      subjectKey: "transaction-key",
      policy: { version: "test-policy-v1", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(granted).toMatchObject({ status: "ON", policyVersion: "test-policy-v1" });
    expect(await database.retentionConsent.count({ where: { subjectId: "transaction-subject", revokedAt: null } })).toBe(1);
  });

  it("superseded policy consent cannot authorize new retained history", async () => {
    await grantRetentionConsent(database, {
      subjectId: "superseded-subject",
      subjectKey: "superseded-key",
      policy: { version: "policy-v1", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    await expect(retainViewedResult(database, {
      subjectId: "superseded-subject",
      resourceType: "RESULT",
      resourceId: "privacy-fixture",
      policy: { version: "policy-v2", effectiveAt: "2026-09-15T00:00:00.000Z", durationDays: 14 },
      now: new Date("2026-09-20T12:01:00.000Z"),
    })).rejects.toMatchObject({ code: "RETENTION_DENIED" });
  });

  it("withdrawal race converges with a retained write and removes every link", async () => {
    await grantRetentionConsent(database, {
      subjectId: "race-subject", subjectKey: "race-key",
      policy: { version: "race-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    });
    const before = await database.manualOddsSnapshot.findUniqueOrThrow({ where: { id: "privacy-odds" }, select: { id: true, inputHash: true } });
    const invalidated: string[] = [];
    await Promise.allSettled([
      retainViewedResult(database, { subjectId: "race-subject", resourceType: "RESULT", resourceId: "privacy-fixture", policy: { version: "race-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 }, now: new Date("2026-09-20T12:01:00.000Z") }),
      withdrawRetentionConsent(database, "race-subject", { invalidate: async (subjectId) => { invalidated.push(subjectId); } }, new Date("2026-09-20T12:01:00.000Z")),
    ]);
    expect(await database.retainedViewHistory.count({ where: { subjectId: "race-subject" } })).toBe(0);
    expect(await database.retainedOddsHistory.count({ where: { subjectId: "race-subject" } })).toBe(0);
    expect((await database.retentionSubject.findUniqueOrThrow({ where: { id: "race-subject" } })).retentionBlockedAt).not.toBeNull();
    expect(invalidated).toEqual(["race-subject"]);
    expect(await database.manualOddsSnapshot.findUniqueOrThrow({ where: { id: "privacy-odds" }, select: { id: true, inputHash: true } })).toEqual(before);
  });

  it("future deny rejects retained writes after withdrawal", async () => {
    await expect(retainViewedResult(database, { subjectId: "race-subject", resourceType: "RESULT", resourceId: "privacy-fixture", policy: { version: "race-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 }, now: new Date("2026-09-20T12:02:00.000Z") })).rejects.toMatchObject({ code: "RETENTION_DENIED" });
  });

  it("unlinkable immutable facts survive rollback-safe withdrawal", async () => {
    await grantRetentionConsent(database, {
      subjectId: "rollback-subject", subjectKey: "rollback-key",
      policy: { version: "rollback-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    });
    await retainViewedResult(database, { subjectId: "rollback-subject", resourceType: "RESULT", resourceId: "privacy-fixture", policy: { version: "rollback-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 }, now: new Date("2026-09-20T12:01:00.000Z") });
    await expect(withdrawRetentionConsent(database, "rollback-subject", { invalidate: async () => { throw new Error("cache unavailable"); } })).rejects.toMatchObject({ code: "WITHDRAWAL_FAILED" });
    expect(await database.retainedViewHistory.count({ where: { subjectId: "rollback-subject" } })).toBe(1);
    expect((await database.retentionSubject.findUniqueOrThrow({ where: { id: "rollback-subject" } })).retentionBlockedAt).toBeNull();
  });

  it("purges expiry-bound personal links and writes durable audit counts", async () => {
    await grantRetentionConsent(database, {
      subjectId: "purge-subject", subjectKey: "purge-key",
      policy: { version: "purge-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 },
      now: new Date("2026-09-20T12:00:00.000Z"),
    });
    await retainViewedResult(database, { subjectId: "purge-subject", resourceType: "RESULT", resourceId: "privacy-fixture", policy: { version: "purge-policy", effectiveAt: "2026-09-01T00:00:00.000Z", durationDays: 30 }, now: new Date("2026-09-20T12:01:00.000Z") });

    const result = await purgeExpiredRetention(database, new Date("2026-10-21T12:00:00.000Z"));

    expect(result.viewsDeleted).toBeGreaterThanOrEqual(1);
    expect(await database.retainedViewHistory.count({ where: { subjectId: "purge-subject" } })).toBe(0);
    const audit = await database.$queryRaw<Array<{ oddsDeleted: number; viewsDeleted: number }>>`SELECT "oddsDeleted", "viewsDeleted" FROM "RetentionPurgeAudit" WHERE id = ${result.auditId}`;
    expect(audit).toEqual([{ oddsDeleted: result.oddsDeleted, viewsDeleted: result.viewsDeleted }]);
  });
});
