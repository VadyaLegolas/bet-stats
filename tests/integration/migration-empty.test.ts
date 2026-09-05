import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(workspaceRoot, "packages/database");
const containerName = `bet-stats-migration-${process.pid}`;
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

function sql(statement: string): string[] {
  const output = docker(
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    "bet_stats",
    "-At",
    "-c",
    statement,
  );
  return output.length === 0 ? [] : output.split(/\r?\n/);
}

describe("Prisma migration from an empty PostgreSQL 18 database", () => {
  beforeAll(() => {
    docker(
      "run",
      "--detach",
      "--name",
      containerName,
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=bet_stats",
      "--publish",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    );
    waitForPostgres();

    const publishedPort = docker("port", containerName, "5432/tcp").split(":").at(-1);
    if (!publishedPort) {
      throw new Error("Docker did not publish the PostgreSQL port");
    }
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: databaseRoot,
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${publishedPort}/bet_stats`,
      },
      stdio: "pipe",
    });
  }, 120_000);

  afterAll(() => {
    try {
      docker("rm", "--force", containerName);
    } catch {
      // Cleanup is best effort for a container created exclusively by this test.
    }
  });

  it("creates canonical tables and immutable reconciliation audit relations", () => {
    const tables = sql(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        "League",
        "Season",
        "Team",
        "Player",
        "Fixture",
        "FixtureExternalRef",
        "FixtureProvenance",
        "ReconciliationCase",
        "ReconciliationCandidate",
        "ReconciliationDecision",
        "SourceObservation",
        "ResultVersion",
        "StandingSnapshot",
        "StandingSnapshotRow",
        "SyncRun",
        "SyncAttempt",
        "ProviderCircuitState",
        "ReplayPlan",
        "ReplayDelivery",
        "EvidenceBuild",
        "EvidenceComponent",
      ]),
    );

    const uniqueExternalReference = sql(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'FixtureExternalRef' AND indexdef LIKE 'CREATE UNIQUE INDEX%';`,
    ).join("\n");
    expect(uniqueExternalReference).toContain('(provider, "externalId")');

    const candidateIndex = sql(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Fixture' AND indexname LIKE '%homeTeamId_awayTeamId_kickoffUtc%';`,
    ).join("\n");
    expect(candidateIndex).toContain("CREATE INDEX");
    expect(candidateIndex).not.toContain("CREATE UNIQUE INDEX");

    const decisionColumns = sql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ReconciliationDecision';`,
    );
    expect(decisionColumns).toEqual(
      expect.arrayContaining(["evidence", "confidence", "actor", "decidedAt", "supersedesDecisionId"]),
    );

    const foreignKeys = sql(
      `SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY';`,
    );
    expect(Number(foreignKeys[0])).toBeGreaterThanOrEqual(15);

    const appendOnlyTrigger = sql(
      `SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table = 'ReconciliationDecision';`,
    );
    expect(appendOnlyTrigger).toContain("ReconciliationDecision_append_only");

    const evidenceTriggers = sql(
      `SELECT event_object_table || ':' || trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table IN ('SourceObservation','ResultVersion','StandingSnapshot','StandingSnapshotRow','SyncAttempt','ReplayPlan','EvidenceBuild','EvidenceComponent') ORDER BY 1;`,
    );
    expect(evidenceTriggers).toEqual(expect.arrayContaining([
      "SourceObservation:SourceObservation_append_only",
      "ResultVersion:ResultVersion_append_only",
      "SyncAttempt:SyncAttempt_guarded_transition",
      "EvidenceComponent:EvidenceComponent_append_only",
    ]));

    const cutoffIndexes = sql(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='ResultVersion' ORDER BY indexname;`,
    ).join("\n");
    expect(cutoffIndexes).toContain("ResultVersion_effectiveAt_observedAt_idx");

    const temporalTypes = sql(
      `SELECT table_name || '.' || column_name || ':' || data_type
       FROM information_schema.columns
       WHERE table_schema='public'
         AND (table_name, column_name) IN (
           ('SourceObservation','observedAt'),
           ('ResultVersion','effectiveAt'),
           ('StandingSnapshot','observedAt'),
           ('ReplayPlan','windowFrom'),
           ('SyncRun','windowTo'),
           ('EvidenceBuild','cutoff')
         )
       ORDER BY 1;`,
    );
    expect(temporalTypes).toHaveLength(6);
    expect(temporalTypes.every((column) => column.endsWith(":timestamp with time zone"))).toBe(true);

    const syncRunCompleteness = sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='SyncRun'
         AND column_name IN ('expectedUnits','completedUnits','expectedCaptures','completedCaptures','completionManifest')
       ORDER BY column_name;`,
    );
    expect(syncRunCompleteness).toHaveLength(5);

    const replayDeliveryColumns = sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ReplayDelivery'
         AND column_name IN ('syncRunId','jobId','state','attemptCount','classifiedReason','leaseToken','leaseExpiresAt','deliveredAt')
       ORDER BY column_name;`,
    );
    expect(replayDeliveryColumns).toHaveLength(8);

    const circuitProbeLeaseColumns = sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='ProviderCircuitState'
         AND column_name IN ('probeLeaseToken','probeLeaseExpiresAt')
       ORDER BY column_name;`,
    );
    expect(circuitProbeLeaseColumns).toEqual(["probeLeaseExpiresAt", "probeLeaseToken"]);

    const executionLeaseColumns = sql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='SyncRun'
       AND column_name IN ('executionLeaseToken','executionLeaseExpiresAt','executionDeadlineAt') ORDER BY column_name;`,
    );
    expect(executionLeaseColumns).toEqual(["executionDeadlineAt", "executionLeaseExpiresAt", "executionLeaseToken"]);
  });
});
