import { describe, expect, it } from "vitest";

import { readBackupConfig } from "@bet-stats/config";

import {
  DRILL_STDERR_EXCERPT_LIMIT,
  captureSourceCounts,
  runBackupDrill,
  runChainIntegrityChecks,
  type BackupDrillResult,
  type DrillQuery,
  type DrillSqlQuery,
} from "../../workers/data-sync/src/jobs/backup-drill.js";
import { nodeBackupFs, type BackupExec, type BackupExecResult } from "../../workers/data-sync/src/jobs/backup.js";

const NOW = new Date("2026-10-22T20:00:00.000Z");
const DUMP_NAME = "football_prediction-20261022T190000Z.dump";
const DRILL_DIR = "/tmp/bet-stats-drill-unit";
const PRISMA_ROOT = "/fake/packages/database";

const SOURCE_COUNTS: Record<string, number> = {
  League: 1,
  Season: 1,
  Team: 2,
  Fixture: 1,
  ForecastSnapshot: 1,
  ValueReceipt: 0,
  ResultVersion: 1,
  SettlementReceipt: 0,
  ManualOddsSnapshot: 1,
};

type ReceiptRow = Record<string, unknown>;
type ExecCall = Readonly<{ command: string; args: readonly string[] }>;

function countRows(counts: Record<string, number>): Array<{ table: string; count: number }> {
  return Object.entries(counts).map(([table, count]) => ({ table, count }));
}

/** In-memory BackupVerificationReceipt store plus the injected source query (UNION ALL capture). */
function fakeDatabase(input: { receipts?: ReceiptRow[]; sourceCounts?: Record<string, number> } = {}) {
  const receipts = input.receipts ?? [];
  const sourceCounts = input.sourceCounts ?? SOURCE_COUNTS;
  return {
    receipts,
    database: {
      backupVerificationReceipt: {
        create: async ({ data }: { data: ReceiptRow }) => {
          receipts.push(data);
          return data;
        },
      },
      $queryRawUnsafe: async (text: string) => {
        if (text.includes('FROM "League"')) return countRows(sourceCounts);
        throw new Error(`unexpected source query: ${text}`);
      },
    } as never,
  };
}

const OK: BackupExecResult = { code: 0, stdout: Buffer.alloc(0), stderr: "" };

/** Full happy-path drill exec; individual outcomes overridden per test. */
function drillExec(options: { dockerRun?: Partial<BackupExecResult>; restore?: Partial<BackupExecResult>; blockPrintenv?: boolean } = {}) {
  const calls: ExecCall[] = [];
  const exec: BackupExec = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "docker" && args[0] === "run") return { ...OK, ...options.dockerRun };
      if (command === "docker" && args.includes("printenv")) return options.blockPrintenv ? { code: 1, stdout: Buffer.alloc(0), stderr: "env: no such variable" } : { ...OK, stdout: Buffer.from("drill_user\n") };
      if (args.includes("pg_isready")) return OK;
      if (args[0] === "port") return { ...OK, stdout: Buffer.from("127.0.0.1:49152\n") };
      if (args.includes("pg_restore") && args.includes("--version")) return { ...OK, stdout: Buffer.from("pg_restore (PostgreSQL) 18.6") };
      if (args.includes("pg_restore")) return { ...OK, ...options.restore };
      if (args[0] === "cp") return OK;
      if (args[0] === "rm") return OK;
      return OK; // migrate deploy / status
    },
  };
  return { exec, calls };
}

/** Throwaway-database query fake: counts, pg_constraint catalog, per-relation orphans, curated checks. */
function fakeDrillQuery(restoredCounts: Record<string, number>, options: { orphanCounts?: Record<string, number> } = {}) {
  const queries: string[] = [];
  const query: DrillQuery = {
    queryRaw: (async (text: string) => {
      queries.push(text);
      if (text.includes("pg_constraint")) {
        return [{ child: '"Season"', parent: '"League"', join_pred: 'c."leagueId" = p."id"', not_null_pred: 'c."leagueId" IS NOT NULL' }];
      }
      if (text.includes('"orphans"')) {
        const entry = Object.entries(options.orphanCounts ?? {}).find(([child]) => text.includes(`FROM ${child}`));
        return [{ orphans: entry?.[1] ?? 0 }];
      }
      if (text.includes('FROM "League"')) return countRows(restoredCounts);
      if (text.includes("supersedesForecastId")) return [{ violations: 0 }];
      if (text.includes('"ValueReceipt" v')) return [{ violations: 0 }];
      if (text.includes("revision > 1")) return [{ violations: 0 }];
      throw new Error(`unexpected drill query: ${text}`);
    }) as DrillSqlQuery,
    disconnect: async () => undefined,
  };
  return { query, queries };
}

function drillConfig(env: Record<string, string | undefined> = {}) {
  return readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: DRILL_DIR, BACKUP_PG_USER: "drill_user", BACKUP_PG_DB: "drill_db", ...env });
}

async function runDrill(input: {
  sourceCounts?: Record<string, number>;
  restoredCounts?: Record<string, number>;
  orphanCounts?: Record<string, number>;
  execOptions?: Parameters<typeof drillExec>[0];
  configEnv?: Record<string, string | undefined>;
}): Promise<{ result: BackupDrillResult; receipts: ReceiptRow[]; calls: ExecCall[]; queries: string[] }> {
  const fake = fakeDatabase({ ...(input.sourceCounts ? { sourceCounts: input.sourceCounts } : {}) });
  const { exec, calls } = drillExec(input.execOptions ?? {});
  const drillQuery = fakeDrillQuery(input.restoredCounts ?? input.sourceCounts ?? SOURCE_COUNTS, input.orphanCounts ? { orphanCounts: input.orphanCounts } : {});
  const result = await runBackupDrill({
    config: drillConfig(input.configEnv ?? {}),
    database: fake.database,
    exec,
    fs: { ...nodeBackupFs, list: async () => [DUMP_NAME] },
    now: () => NOW,
    prismaProjectRoot: PRISMA_ROOT,
    containerSuffix: "unit-test",
    createDrillQuery: () => drillQuery.query,
  });
  return { result, receipts: fake.receipts, calls, queries: drillQuery.queries };
}

describe("runBackupDrill fail-closed states", () => {
  it("records UNVERIFIED DOCKER_UNAVAILABLE and starts no container when docker cannot spawn", async () => {
    const { result, receipts, calls } = await runDrill({ execOptions: { dockerRun: { code: undefined, stdout: Buffer.alloc(0), stderr: "", spawnError: "ENOENT" } } });

    expect(result.overall).toBe("UNVERIFIED");
    expect(result.failureReason).toBe("DOCKER_UNAVAILABLE");
    expect(result.containerCleanup).toBe("NOT_STARTED");
    expect(calls.filter((call) => call.command === "docker" && call.args[0] !== "run")).toHaveLength(0);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ overall: "UNVERIFIED", failureReason: "DOCKER_UNAVAILABLE", containerCleanup: "NOT_STARTED" });
  });

  it("records UNVERIFIED PG_IDENTITY_UNRESOLVED and never invokes pg_restore when neither config nor container env supply the identity", async () => {
    const { result, receipts, calls } = await runDrill({
      configEnv: { BACKUP_PG_USER: undefined, BACKUP_PG_DB: undefined, BACKUP_PG_CONTAINER: "bet-stats-app-pg" },
      execOptions: { blockPrintenv: true },
    });

    expect(result.overall).toBe("UNVERIFIED");
    expect(result.failureReason).toBe("PG_IDENTITY_UNRESOLVED");
    expect(result.containerCleanup).toBe("NOT_STARTED");
    expect(calls.some((call) => call.command === "docker" && call.args[0] === "run")).toBe(false);
    expect(calls.some((call) => call.args.includes("pg_restore"))).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ overall: "UNVERIFIED", failureReason: "PG_IDENTITY_UNRESOLVED" });
  });

  it("records FAILED RESTORE_FAILED with a redacted, length-bounded stderr excerpt when pg_restore exits non-zero", async () => {
    const leakyStderr = `pg_restore: error: should not exist: FATAL: password authentication failed for user "drill_user"\nconnection: postgresql://drill_user:hunter2secret@127.0.0.1:49152/drill_db password=hunter2secret ${"x".repeat(600)}`;
    const { result, receipts } = await runDrill({ execOptions: { restore: { code: 1, stdout: Buffer.alloc(0), stderr: leakyStderr } } });

    expect(result.overall).toBe("FAILED");
    expect(result.failureReason).toBe("RESTORE_FAILED");
    expect(receipts).toHaveLength(1);
    const checks = receipts[0]!.checks as Record<string, { stderrExcerpt?: string }>;
    const excerpt = checks.restore?.stderrExcerpt;
    expect(excerpt, "a failing restore must record its stderr excerpt").toBeDefined();
    expect(excerpt).not.toContain("hunter2secret");
    expect(excerpt).not.toContain("postgresql://");
    expect(excerpt!.length).toBeLessThanOrEqual(DRILL_STDERR_EXCERPT_LIMIT);
    expect(checks.nonEmpty, "chain checks must not run after a failed restore").toBeUndefined();
  });

  it("records FAILED CHAIN_INTEGRITY_FAILED when a restored table count falls below the captured source count", async () => {
    const restored = { ...SOURCE_COUNTS, Team: 1 }; // captured Team: 2 => truncation signal
    const { result, receipts } = await runDrill({ restoredCounts: restored });

    expect(result.overall).toBe("FAILED");
    expect(result.failureReason).toBe("CHAIN_INTEGRITY_FAILED");
    expect(result.containerCleanup).toBe("REMOVED");
    const checks = receipts[0]!.checks as Record<string, Record<string, { state?: string; delta?: number }>>;
    expect(checks.nonEmpty?.Team).toMatchObject({ state: "FAILED", source: 2, restored: 1 });
    expect(checks.parity?.Team).toMatchObject({ state: "FAILED", delta: -1 });
  });

  it("records VERIFIED with the positive delta when live writes land between capture and dump snapshot", async () => {
    const restored = { ...SOURCE_COUNTS, Fixture: 3 }; // captured Fixture: 1 => +2, legitimate
    const { result, receipts } = await runDrill({ restoredCounts: restored });

    expect(result.overall).toBe("VERIFIED");
    expect(result.failureReason).toBeUndefined();
    const checks = receipts[0]!.checks as Record<string, Record<string, { state?: string; delta?: number }>>;
    expect(checks.parity?.Fixture).toMatchObject({ state: "PASSED", delta: 2 });
    expect(checks.nonEmpty?.Fixture?.state).toBe("PASSED");
  });

  it("records SKIPPED (never PASSED) for a canonical table with zero source rows", async () => {
    const source = { ...SOURCE_COUNTS, ValueReceipt: 0 };
    const restored = { ...SOURCE_COUNTS, ValueReceipt: 0 };
    const { result, receipts } = await runDrill({ sourceCounts: source, restoredCounts: restored });

    expect(result.overall).toBe("VERIFIED");
    const checks = receipts[0]!.checks as Record<string, Record<string, { state?: string }>>;
    expect(checks.nonEmpty?.ValueReceipt?.state).toBe("SKIPPED");
    expect(checks.nonEmpty?.SettlementReceipt?.state).toBe("SKIPPED");
    expect(checks.nonEmpty?.League?.state).toBe("PASSED");
  });

  it("fails the drill when the generic FK-orphan scan finds any orphan", async () => {
    const { result, receipts } = await runDrill({ orphanCounts: { '"Season"': 2 } });

    expect(result.overall).toBe("FAILED");
    expect(result.failureReason).toBe("CHAIN_INTEGRITY_FAILED");
    const checks = receipts[0]!.checks as Record<string, { state?: string; total?: number }>;
    expect(checks.fkOrphans).toMatchObject({ state: "FAILED", total: 2 });
  });

  it("stores the captured source counts map and the four chain-integrity entries in the receipt checks JSON", async () => {
    const { result, receipts } = await runDrill({});

    expect(result.overall).toBe("VERIFIED");
    const checks = receipts[0]!.checks as Record<string, unknown>;
    expect(checks.sourceCounts).toMatchObject(SOURCE_COUNTS);
    expect(checks.nonEmpty).toBeDefined();
    expect(checks.fkOrphans).toBeDefined();
    expect(checks.curated).toBeDefined();
    expect(checks.parity).toBeDefined();
    expect(checks.restore).toMatchObject({ exitCode: 0 });
    expect(checks.migrations).toMatchObject({ state: "AT_HEAD" });
  });
});

describe("captureSourceCounts", () => {
  it("captures every canonical table in one UNION ALL pass and defaults missing tables to zero", async () => {
    const texts: string[] = [];
    const counts = await captureSourceCounts((async (text: string) => {
      texts.push(text);
      return [{ table: "League", count: 3 }];
    }) as DrillSqlQuery);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('FROM "League"');
    expect(texts[0]).toContain('FROM "ManualOddsSnapshot"');
    expect(texts[0]).toContain("UNION ALL");
    expect(counts).toMatchObject({ League: 3, Season: 0, Team: 0, Fixture: 0, ForecastSnapshot: 0, ValueReceipt: 0, ResultVersion: 0, SettlementReceipt: 0, ManualOddsSnapshot: 0 });
  });
});

describe("runChainIntegrityChecks", () => {
  const sourceCounts = { League: 1, Team: 1 };

  it("drives the FK-orphan scan from pg_constraint with per-key IS NOT NULL guards and fails on any orphan", async () => {
    const texts: string[] = [];
    const query = (async (text: string) => {
      texts.push(text);
      if (text.includes("pg_constraint")) return [{ child: '"ValueReceipt"', parent: '"Fixture"', join_pred: 'c."fixtureId" = p."id"', not_null_pred: 'c."fixtureId" IS NOT NULL' }];
      if (text.includes('"orphans"')) return [{ orphans: 2 }];
      if (text.includes('FROM "League"')) return [{ table: "League", count: 1 }, { table: "Team", count: 1 }];
      return [{ violations: 0 }];
    }) as DrillSqlQuery;

    const result = await runChainIntegrityChecks({ query, sourceCounts });

    expect(result.passed).toBe(false);
    expect(result.checks.fkOrphans).toMatchObject({ state: "FAILED", total: 2 });
    const orphanQuery = texts.find((text) => text.includes('"orphans"'))!;
    expect(orphanQuery).toContain('FROM "ValueReceipt" c LEFT JOIN "Fixture" p ON c."fixtureId" = p."id"');
    // Nullable FK columns must be guarded — a NULL key is not an orphan (unlike the naive Q5 predicate).
    expect(orphanQuery).toContain('c."fixtureId" IS NOT NULL');
    expect(orphanQuery).toContain("p.oid IS NULL");
  });

  it("fails when a curated supersession chain is broken while the generic scan stays clean", async () => {
    const query = (async (text: string) => {
      if (text.includes("pg_constraint")) return [];
      if (text.includes('FROM "League"')) return [{ table: "League", count: 1 }, { table: "Team", count: 1 }];
      if (text.includes("supersedesForecastId")) return [{ violations: 1 }];
      if (text.includes('"ValueReceipt" v')) return [{ violations: 0 }];
      if (text.includes("revision > 1")) return [{ violations: 0 }];
      throw new Error(`unexpected query: ${text}`);
    }) as DrillSqlQuery;

    const result = await runChainIntegrityChecks({ query, sourceCounts });

    expect(result.passed).toBe(false);
    expect(result.checks.curated).toMatchObject({ state: "FAILED", violations: { forecastSupersession: 1, valueReceiptFixtureLink: 0, settlementSupersession: 0 } });
  });

  it("passes with equal counts, records positive deltas without failing, and SKIPPED zero-source tables", async () => {
    const query = (async (text: string) => {
      if (text.includes("pg_constraint")) return [];
      if (text.includes('FROM "League"')) return [{ table: "League", count: 4 }, { table: "Team", count: 0 }];
      return [{ violations: 0 }];
    }) as DrillSqlQuery;

    const result = await runChainIntegrityChecks({ query, sourceCounts: { League: 2, Team: 0 } });

    expect(result.passed).toBe(true);
    expect(result.checks.nonEmpty).toMatchObject({ League: { state: "PASSED", source: 2, restored: 4 }, Team: { state: "SKIPPED", source: 0, restored: 0 } });
    expect(result.checks.parity).toMatchObject({ League: { state: "PASSED", delta: 2 }, Team: { state: "PASSED", delta: 0 } });
  });
});
