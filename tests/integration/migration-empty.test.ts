import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(workspaceRoot, "packages/database");
const containerName = `bet-stats-migration-${process.pid}`;
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function dockerInput(args: string[], input: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker("exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats");
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
  }, 180_000);

  afterAll(() => {
    try {
      docker("rm", "--force", "--volumes", containerName);
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
        "LineupObservation",
        "ForecastSnapshot",
        "ForecastMarket",
        "ManualOddsSnapshot",
        "ManualOddsSelection",
        "ValueReceipt",
        "ProviderRouteReceipt",
        "ProviderRouteAttempt",
        "ProviderQuotaObservation",
        "ProviderThrottleReservation",
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

    const snapshotTriggers = sql(
      `SELECT event_object_table || ':' || trigger_name FROM information_schema.triggers
       WHERE event_object_schema='public' AND event_object_table IN ('ForecastSnapshot','ForecastMarket','ManualOddsSnapshot','ManualOddsSelection','ValueReceipt') ORDER BY 1;`,
    );
    expect(snapshotTriggers).toEqual(expect.arrayContaining([
      "ForecastSnapshot:ForecastSnapshot_guarded_immutable",
      "ForecastMarket:ForecastMarket_append_only",
      "ManualOddsSnapshot:ManualOddsSnapshot_append_only",
      "ManualOddsSelection:ManualOddsSelection_append_only",
      "ValueReceipt:ValueReceipt_append_only",
    ]));
  }, 30_000);

  it("Phase 14: installs the extended-market SQL layer without recreating or weakening the append-only triggers", () => {
    const functions = sql(`SELECT proname || '/' || pronargs FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'phase14\\_%' OR proname LIKE 'persist\\_value\\_settlement%' OR proname IN ('guard_value_pair','guard_value_settlement')) ORDER BY 1;`);
    expect(functions).toEqual([
      "guard_value_pair/0", "guard_value_settlement/0", "persist_value_settlement/6", "persist_value_settlement_v2/7",
      "phase14_ah_breakdown/3", "phase14_ah_result/4", "phase14_exact_score_probability/2", "phase14_exact_score_result/3",
      "phase14_market_line/1", "phase14_numeric/1",
    ]);
    const resultCheck = sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '"ValueSettlement"'::regclass AND conname = 'ValueSettlement_result_check';`).join("");
    for (const result of ["WIN", "LOSS", "VOID", "HALF_WIN", "HALF_LOSS", "PUSH"]) expect(resultCheck).toContain(`'${result}'`);
    const triggers = sql(`SELECT event_object_table || ':' || trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' AND event_object_table IN ('ValueSettlement','ValueReceipt') ORDER BY 1;`);
    expect(triggers).toEqual(expect.arrayContaining(["ValueSettlement:ValueSettlement_guarded_append_only", "ValueReceipt:ValueReceipt_validate_pair"]));
    // D-17: the scoring and calibration constraints stay on the three core markets.
    const scoreCheck = sql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ForecastScore_market_check';`).join("");
    expect(scoreCheck).toContain("BTTS");
    expect(scoreCheck).not.toContain("ASIAN_HANDICAP");
    const migrations = readdirSync(resolve(databaseRoot, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(migrations.at(-1)).toBe("20261126_phase14_extended_markets");
    expect(sql(`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`)).toEqual([String(migrations.length)]);
  });

  it("installs append-only guards for provider route evidence", () => {
    const triggers = sql(
      `SELECT event_object_table || ':' || trigger_name FROM information_schema.triggers
       WHERE event_object_schema='public' AND event_object_table IN ('ProviderRouteReceipt','ProviderRouteAttempt','ProviderQuotaObservation') ORDER BY 1;`,
    );
    expect(triggers).toEqual(expect.arrayContaining([
      "ProviderRouteReceipt:ProviderRouteReceipt_append_only",
      "ProviderRouteAttempt:ProviderRouteAttempt_guarded_immutable",
      "ProviderQuotaObservation:ProviderQuotaObservation_append_only",
    ]));
  });

  it("scopes provider season identity to the canonical league", () => {
    const columns = sql(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='SeasonExternalRef'
       ORDER BY column_name;`,
    );
    expect(columns).toContain("leagueId");

    sql(`INSERT INTO "League" (id, name, "countryCode", "createdAt", "updatedAt") VALUES
      ('d15-pl', 'Premier League', 'England', now(), now()),
      ('d15-uel', 'Europa League', 'Europe', now(), now()),
      ('d15-uecl', 'Conference League', 'Europe', now(), now());`);
    sql(`INSERT INTO "Season" (id, "leagueId", label, "startsOn", "endsOn", "createdAt", "updatedAt") VALUES
      ('d15-pl-2026', 'd15-pl', '2026', '2026-01-01', '2026-12-31', now(), now()),
      ('d15-uel-2026', 'd15-uel', '2026', '2026-01-01', '2026-12-31', now(), now()),
      ('d15-uecl-2026', 'd15-uecl', '2026', '2026-01-01', '2026-12-31', now(), now());`);
    sql(`INSERT INTO "SeasonExternalRef" (id, "seasonId", "leagueId", provider, "externalId", "createdAt") VALUES
      ('d15-ref-pl', 'd15-pl-2026', 'd15-pl', 'api-football', '2026', now()),
      ('d15-ref-uel', 'd15-uel-2026', 'd15-uel', 'api-football', '2026', now()),
      ('d15-ref-uecl', 'd15-uecl-2026', 'd15-uecl', 'api-football', '2026', now());`);

    const sharedYears = sql(
      `SELECT "leagueId" || ':' || "externalId" FROM "SeasonExternalRef"
       WHERE provider='api-football' AND "externalId"='2026' ORDER BY "leagueId";`,
    );
    expect(sharedYears).toEqual(["d15-pl:2026", "d15-uecl:2026", "d15-uel:2026"]);

    expect(() => sql(`INSERT INTO "SeasonExternalRef" (id, "seasonId", "leagueId", provider, "externalId", "createdAt")
      VALUES ('d15-duplicate', 'd15-pl-2026', 'd15-pl', 'api-football', '2026', now());`)).toThrow();
    expect(() => sql(`INSERT INTO "SeasonExternalRef" (id, "seasonId", "leagueId", provider, "externalId", "createdAt")
      VALUES ('d15-poison', 'd15-pl-2026', 'd15-uel', 'other-provider', '2027', now());`)).toThrow();
  });

  it("upgrades a populated pre-D-15 schema without losing provider season references", () => {
    docker("exec", containerName, "createdb", "-U", "postgres", "phase4_upgrade");
    const migrationsRoot = resolve(databaseRoot, "prisma/migrations");
    const scopedSeasonMigration = "20260913_phase05_season_external_ref_scope";
    for (const directory of readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      if (directory === scopedSeasonMigration) continue;
      const migration = readFileSync(join(migrationsRoot, directory, "migration.sql"), "utf8");
      dockerInput(["exec", "-i", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "phase4_upgrade"], `BEGIN;\n${migration}\nCOMMIT;`);
    }
    docker("exec", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "phase4_upgrade", "-c",
      `INSERT INTO "League" (id, name, "countryCode", "createdAt", "updatedAt") VALUES ('upgrade-pl', 'Premier League', 'GB-ENG', now(), now());
       INSERT INTO "Season" (id, "leagueId", label, "startsOn", "endsOn", "createdAt", "updatedAt") VALUES ('upgrade-2026', 'upgrade-pl', '2026', '2026-01-01', '2026-12-31', now(), now());
       INSERT INTO "SeasonExternalRef" (id, "seasonId", provider, "externalId", "createdAt") VALUES ('upgrade-ref', 'upgrade-2026', 'api-football', '2026', now());`,
    );
    const forward = readFileSync(join(migrationsRoot, scopedSeasonMigration, "migration.sql"), "utf8");
    dockerInput(["exec", "-i", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "phase4_upgrade"], `BEGIN;\n${forward}\nCOMMIT;`);
    const preserved = docker("exec", containerName, "psql", "-U", "postgres", "-d", "phase4_upgrade", "-At", "-c",
      `SELECT "seasonId" || ':' || "leagueId" || ':' || "externalId" FROM "SeasonExternalRef" WHERE id='upgrade-ref';`,
    );
    expect(preserved).toBe("upgrade-2026:upgrade-pl:2026");
  }, 120_000);

  it("WR-13: ForecastSnapshot.origin is NOT NULL with default PRODUCTION and a two-value enum", () => {
    expect(sql(`SELECT is_nullable || '|' || column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='ForecastSnapshot' AND column_name='origin';`))
      .toEqual(["NO|'PRODUCTION'::\"ForecastOrigin\""]);
    expect(sql(`SELECT udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ForecastSnapshot' AND column_name='origin';`)).toEqual(["ForecastOrigin"]);
    expect(sql(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='ForecastOrigin' ORDER BY e.enumsortorder;`)).toEqual(["PRODUCTION", "BACKTEST"]);
  }, 30_000);

  it("WR-13: upgrading a populated schema labels legacy snapshots PRODUCTION, changes nothing else and guards origin", () => {
    const database = "origin_upgrade";
    const originMigration = "20261124_phase11_forecast_snapshot_origin";
    const migrationsRoot = resolve(databaseRoot, "prisma/migrations");
    const psql = (statement: string): string => dockerInput(["exec", "-i", containerName, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"], statement);
    docker("exec", containerName, "createdb", "-U", "postgres", database);
    const earlier = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().filter((name) => name < originMigration);
    expect(earlier.length).toBeGreaterThan(0);
    // Prisma applies every migration in its own transaction; some of them require one.
    for (const directory of earlier) psql(`BEGIN;\n${readFileSync(join(migrationsRoot, directory, "migration.sql"), "utf8")}\nCOMMIT;`);

    const columns = `id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt"`;
    psql(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('or-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('or-season','or-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('or-home','Home','home','GB',now()),('or-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('or-fixture','or-league','or-season','or-home','or-away','2026-10-10T18:00:00Z','SCHEDULED',now());
      INSERT INTO "ForecastSnapshot" (${columns}) VALUES
        ('or-legacy-1','or-fixture','PRE_MATCH','ISSUED',1,NULL,'2026-10-10T12:00:00Z','poisson-ensemble-v1','m1','forecast-config-v1','c1','i1','e1','[]','{}','{}','[]','{}','2026-10-10T12:00:01Z');
      INSERT INTO "ForecastSnapshot" (${columns}) VALUES
        ('or-legacy-2','or-fixture','PRE_MATCH','ISSUED',2,'or-legacy-1','2026-10-10T13:00:00Z','poisson-ensemble-v1','m1','forecast-config-v1','c1','i2','e2','[]','{}','{}','[]','{}','2026-10-10T13:00:01Z');
    `);
    const digest = (): string => psql(`SELECT md5(string_agg((to_jsonb(f) - 'origin')::text, E'\\n' ORDER BY f.id)) FROM "ForecastSnapshot" f;`);
    const digestBefore = digest();
    expect(digestBefore).toMatch(/^[0-9a-f]{32}$/);

    psql(`BEGIN;\n${readFileSync(join(migrationsRoot, originMigration, "migration.sql"), "utf8")}\nCOMMIT;`);

    expect(psql(`SELECT id || ':' || origin FROM "ForecastSnapshot" ORDER BY id;`).split(/\r?\n/)).toEqual(["or-legacy-1:PRODUCTION", "or-legacy-2:PRODUCTION"]);
    expect(digest()).toBe(digestBefore);
    // origin is immutable once issued.
    expect(() => psql(`UPDATE "ForecastSnapshot" SET origin='BACKTEST' WHERE id='or-legacy-2';`)).toThrow(/ForecastSnapshot is immutable/);
    expect(psql(`SELECT origin FROM "ForecastSnapshot" WHERE id='or-legacy-2';`)).toBe("PRODUCTION");

    psql(`INSERT INTO "ForecastSnapshot" (${columns}) VALUES
      ('or-building','or-fixture','PRE_MATCH','BUILDING',3,'or-legacy-2','2026-10-10T14:00:00Z','poisson-ensemble-v1','m1','forecast-config-v1','c1','i3','e3','[]','{}','{}','[]','{}',NULL);`);
    // A snapshot inserted without origin reads as PRODUCTION through the column default.
    expect(psql(`SELECT origin FROM "ForecastSnapshot" WHERE id='or-building';`)).toBe("PRODUCTION");
    // A BUILDING to ISSUED transition cannot relabel the snapshot ...
    expect(() => psql(`UPDATE "ForecastSnapshot" SET state='ISSUED', origin='BACKTEST', "issuedAt"=now() WHERE id='or-building';`)).toThrow(/identity and inputs are immutable/);
    expect(psql(`SELECT state || ':' || origin FROM "ForecastSnapshot" WHERE id='or-building';`)).toBe("BUILDING:PRODUCTION");
    // ... while the same transition without an origin change still works.
    psql(`UPDATE "ForecastSnapshot" SET state='ISSUED', "issuedAt"=now() WHERE id='or-building';`);
    expect(psql(`SELECT state || ':' || origin FROM "ForecastSnapshot" WHERE id='or-building';`)).toBe("ISSUED:PRODUCTION");
  }, 180_000);
});
