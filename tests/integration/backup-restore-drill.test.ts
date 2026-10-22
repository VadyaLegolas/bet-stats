import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readBackupConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { runBackup, spawnBackupExec, type BackupExec } from "../../workers/data-sync/src/jobs/backup.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-backup-pg-${process.pid}-${Date.now()}`;
let database: PrismaClient;
let databaseUrl: string;
let backupDir: string;
const temporaryDirs: string[] = [];

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitFor(container: string, command: string[]): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker("exec", container, ...command);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw new Error(`${container} did not become ready`);
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bet-stats-backup-"));
  temporaryDirs.push(dir);
  return dir;
}

type RecordedCall = Readonly<{ command: string; args: readonly string[] }>;

/**
 * Records every real invocation while keeping resolution deterministic on any
 * host: bare `pg_dump` PATH probes fail (forcing the docker-exec fallback the
 * plan verifies) and `printenv` can be blocked to prove the fail-closed path.
 */
function recordingExec(options: { record: RecordedCall[]; blockPathProbe?: boolean; blockPrintenv?: boolean }): BackupExec {
  return {
    async run(command, args, execOptions) {
      if (command === "pg_dump" && options.blockPathProbe) {
        return { code: undefined, stdout: Buffer.alloc(0), stderr: "", spawnError: "ENOENT" };
      }
      if (command === "docker" && args[2] === "printenv" && options.blockPrintenv) {
        return { code: 1, stdout: Buffer.alloc(0), stderr: "env: no such variable" };
      }
      options.record.push({ command, args });
      return spawnBackupExec.run(command, args, execOptions);
    },
  };
}

function dumpFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => /^football_prediction-\d{8}T\d{6}Z\.dump$/.test(name));
}

function partialFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith(".partial"));
}

describe("backup dump and receipt drill", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_USER=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    await database.$executeRawUnsafe(`INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('bk-league','Backup League','GB',now());`);
    backupDir = tempDir();
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    for (const dir of temporaryDirs) rmSync(dir, { recursive: true, force: true });
    try {
      docker("rm", "--force", postgresName);
    } catch {
      /* exact owned cleanup is best effort */
    }
  }, 30_000);

  it("produces one real non-empty dump and one durable SUCCEEDED receipt with the dump sha256", async () => {
    const record: RecordedCall[] = [];
    const config = readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: backupDir, BACKUP_PG_CONTAINER: postgresName });

    const result = await runBackup({ config, database, databaseUrl, trigger: "MANUAL", exec: recordingExec({ record, blockPathProbe: true }) });

    expect(result.status).toBe("SUCCEEDED");
    const dumps = dumpFilesIn(backupDir);
    expect(dumps).toHaveLength(1);
    expect(dumps[0]).toMatch(/^football_prediction-\d{8}T\d{6}Z\.dump$/);
    const dumpPath = join(backupDir, dumps[0]!);
    const size = statSync(dumpPath).size;
    expect(size).toBeGreaterThan(0);
    expect(partialFilesIn(backupDir)).toHaveLength(0);

    const rows = await database.backupRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "SUCCEEDED",
      offsiteStatus: "NOT_CONFIGURED",
      trigger: "MANUAL",
      fileName: dumps[0],
      byteSize: size,
      reason: null,
    });
    const recomputed = createHash("sha256").update(readFileSync(dumpPath)).digest("hex");
    expect(rows[0]!.sha256).toBe(recomputed);
    expect(result.sha256).toBe(recomputed);
    expect(rows[0]!.dbVersion).toContain("pg_dump (PostgreSQL)");

    const dumpCall = record.find((call) => call.args.includes("--format=custom"));
    expect(dumpCall, "pg_dump must be invoked through the docker-exec fallback").toBeDefined();
    expect(dumpCall!.args).toEqual(["exec", postgresName, "pg_dump", "--format=custom", "--no-password", "-U", "postgres", "-d", "bet_stats"]);
    const everything = JSON.stringify(record);
    expect(everything).not.toContain("postgresql://");
    expect(everything).not.toContain("postgres:postgres");
  }, 120_000);

  it("records FAILED and leaves no dump when the source database is unreachable", async () => {
    const dir = tempDir();
    const record: RecordedCall[] = [];
    const config = readBackupConfig({
      BACKUP_ENABLED: "true",
      BACKUP_DIR: dir,
      BACKUP_PG_CONTAINER: postgresName,
      BACKUP_PG_DB: "missing_database",
    });

    const result = await runBackup({ config, database, databaseUrl, trigger: "SCHEDULED", exec: recordingExec({ record }) });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toBe("DUMP_FAILED");
    expect(dumpFilesIn(dir)).toHaveLength(0);
    expect(partialFilesIn(dir)).toHaveLength(0);

    const rows = await database.backupRun.findMany({ where: { status: "FAILED", reason: "DUMP_FAILED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "FAILED", reason: "DUMP_FAILED", trigger: "SCHEDULED", byteSize: null, sha256: null });
  }, 120_000);

  it("fails closed with PG_IDENTITY_UNRESOLVED and invokes no dump when neither config nor container env supply the identity", async () => {
    const dir = tempDir();
    const record: RecordedCall[] = [];
    const config = readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_PG_CONTAINER: postgresName });

    const result = await runBackup({
      config,
      database,
      databaseUrl,
      trigger: "MANUAL",
      exec: recordingExec({ record, blockPathProbe: true, blockPrintenv: true }),
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toBe("PG_IDENTITY_UNRESOLVED");
    expect(record.some((call) => call.args.includes("--format=custom"))).toBe(false);
    expect(dumpFilesIn(dir)).toHaveLength(0);

    const rows = await database.backupRun.findMany({ where: { reason: "PG_IDENTITY_UNRESOLVED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "FAILED", byteSize: null, sha256: null });
  });
});
