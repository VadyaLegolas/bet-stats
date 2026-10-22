import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSecrets, type BackupConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import {
  BACKUP_DUMP_FILE_PATTERN,
  nodeBackupFs,
  resolvePgIdentity,
  spawnBackupExec,
  SPAWN_DUMP_TIMEOUT_MS,
  SPAWN_PROBE_TIMEOUT_MS,
  type BackupExec,
  type BackupFs,
  type PgIdentity,
} from "./backup.js";

/** Owned-unique throwaway container prefix — only this drill ever creates and removes them (T-08-10). */
export const DRILL_CONTAINER_PREFIX = "bet-stats-drill-pg-";
export const DRILL_DUMP_CONTAINER_PATH = "/tmp/football-prediction-drill.dump";
export const DRILL_STDERR_EXCERPT_LIMIT = 500;
const DRILL_READY_ATTEMPTS = 60;
const DRILL_READY_POLL_MS = 250;

export type DrillCleanupState = "REMOVED" | "FAILED" | "NOT_STARTED";
export type DrillOverall = "VERIFIED" | "FAILED" | "UNVERIFIED";

/** JSON-safe value for the receipt checks audit trail. */
export type DrillCheckValue = string | number | boolean | null | DrillCheckValue[] | { [key: string]: DrillCheckValue };

export type DrillSqlQuery = <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => Promise<T[]>;

export type DrillQuery = Readonly<{ queryRaw: DrillSqlQuery; disconnect(): Promise<void> }>;

/** Throwaway-database access through the existing Prisma client — no second DB driver. */
export function defaultDrillQuery(url: string): DrillQuery {
  const client = createPrismaClient(url);
  return {
    queryRaw: <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => client.$queryRawUnsafe<T>(text, ...(params ?? [])),
    disconnect: () => client.$disconnect(),
  };
}

export type BackupDrillResult = Readonly<{
  drillId: string;
  overall: DrillOverall;
  containerCleanup: DrillCleanupState;
  backupFileName?: string | undefined;
  failureReason?: string | undefined;
  restoreDurationMs: number;
  durationMs: number;
}>;

export type RunBackupDrillInput = Readonly<{
  config: BackupConfig;
  database: Pick<PrismaClient, "backupVerificationReceipt" | "$queryRawUnsafe">;
  exec?: BackupExec | undefined;
  fs?: BackupFs | undefined;
  now?: (() => Date) | undefined;
  logger?: ((event: Readonly<Record<string, unknown>>) => void) | undefined;
  createDrillQuery?: ((url: string) => DrillQuery) | undefined;
  prismaProjectRoot?: string | undefined;
  containerSuffix?: string | undefined;
}>;

/**
 * Length-bounded, credential-scrubbed excerpt for the receipt checks JSON
 * (T-08-12): connection strings, embedded URL passwords and password= tokens
 * never reach the durable audit trail.
 */
export function redactDrillExcerpt(text: string, limit = DRILL_STDERR_EXCERPT_LIMIT): string {
  const scrubbed = text
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/:[^:@/\s]+@/g, ":***@")
    .replace(/(password[=:]\s*)\S+/gi, "$1[REDACTED]");
  return String(redactSecrets(scrubbed)).slice(0, limit);
}

/**
 * Resolves the Prisma project root fail-closed: BACKUP_PRISMA_DIR override
 * first, then the checkout relative to this worker module; schema.prisma,
 * migrations/ and the Prisma CLI must all be present or the drill reports
 * PRISMA_PROJECT_UNRESOLVED instead of guessing (A1).
 */
export function resolvePrismaProjectRoot(input?: { env?: NodeJS.ProcessEnv | undefined; exists?: ((path: string) => boolean) | undefined }): { root: string; cli: string } | null {
  const exists = input?.exists ?? existsSync;
  const env = input?.env ?? process.env;
  const override = env.BACKUP_PRISMA_DIR?.trim();
  const candidates = override ? [override] : [fileURLToPath(new URL("../../../../packages/database", import.meta.url))];
  for (const candidate of candidates) {
    const cli = join(candidate, "node_modules", "prisma", "build", "index.js");
    if (exists(join(candidate, "prisma", "schema.prisma")) && exists(join(candidate, "prisma", "migrations")) && exists(cli)) return { root: candidate, cli };
  }
  return null;
}

async function waitDrillReady(exec: BackupExec, containerName: string, identity: PgIdentity): Promise<boolean> {
  for (let attempt = 0; attempt < DRILL_READY_ATTEMPTS; attempt += 1) {
    const probe = await exec.run("docker", ["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", identity.user, "-d", identity.db], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    if (!probe.spawnError && probe.code === 0) return true;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, DRILL_READY_POLL_MS));
  }
  return false;
}

/**
 * One restore drill (D-07..D-11): locate the newest LOCAL self-produced dump,
 * resolve the pg identity fail-closed, restore it into an owned throwaway
 * postgres:18-alpine container on a dynamic port, bring migrations to head and
 * prove it with `migrate status`, remove the container best-effort in a
 * finally block, and append exactly one immutable BackupVerificationReceipt.
 * Fail-closed at every step: any failure or missing precondition produces a
 * FAILED or UNVERIFIED receipt — the drill can never silently pass (T-08-08),
 * and only a system-generated dump name is ever restored (T-08-09).
 */
export async function runBackupDrill(input: RunBackupDrillInput): Promise<BackupDrillResult> {
  const exec = input.exec ?? spawnBackupExec;
  const fs = input.fs ?? nodeBackupFs;
  const now = input.now ?? (() => new Date());
  const log = input.logger ?? (() => undefined);
  const drillId = randomUUID();
  const startedAt = now();
  const containerName = `${DRILL_CONTAINER_PREFIX}${input.containerSuffix ?? `${process.pid}-${Date.now()}`}`;

  const checks: Record<string, DrillCheckValue> = {};
  let containerCleanup: DrillCleanupState = "NOT_STARTED";
  let backupFileName: string | undefined;
  let dbVersion: string | undefined;
  let restoreDurationMs = 0;

  const record = async (outcome: { overall: DrillOverall; failureReason?: string | undefined }): Promise<BackupDrillResult> => {
    const completedAt = now();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    await input.database.backupVerificationReceipt.create({
      data: {
        id: drillId,
        ...(backupFileName ? { backupFileName } : {}),
        restoreDurationMs,
        checks,
        containerCleanup,
        overall: outcome.overall,
        ...(dbVersion ? { dbVersion } : {}),
        ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
        startedAt,
        completedAt,
      },
    });
    log({
      event: outcome.overall === "VERIFIED" ? "backup_drill.verified" : "backup_drill.recorded",
      drillId,
      overall: outcome.overall,
      containerCleanup,
      ...(backupFileName ? { backupFileName } : {}),
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
    });
    return {
      drillId,
      overall: outcome.overall,
      containerCleanup,
      ...(backupFileName ? { backupFileName } : {}),
      ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
      restoreDurationMs,
      durationMs,
    };
  };

  // (1) Newest local self-produced dump by the embedded UTC timestamp. Off-host
  // copies are never drill inputs, so a poisoned share cannot become green.
  if (input.config.dir) {
    const entries = await fs.list(input.config.dir).catch(() => null);
    const dumps = (entries ?? []).filter((name) => BACKUP_DUMP_FILE_PATTERN.test(name)).sort();
    backupFileName = dumps.at(-1);
  }
  if (!backupFileName || !input.config.dir) return record({ overall: "UNVERIFIED", failureReason: "NO_BACKUP_FOUND" });
  const dumpPath = join(input.config.dir, backupFileName);

  // (2) Pg identity fail-closed BEFORE any container starts: config keys first,
  // then the source container env — never a hardcoded role (docker exec
  // defaults to a login role the server rejects).
  let identity: PgIdentity | null = null;
  if (input.config.pgContainer) {
    identity = await resolvePgIdentity({ config: input.config, container: input.config.pgContainer, exec });
  } else if (input.config.pgUser && input.config.pgDb) {
    identity = { user: input.config.pgUser, db: input.config.pgDb, source: "CONFIG" };
  }
  if (!identity) return record({ overall: "UNVERIFIED", failureReason: "PG_IDENTITY_UNRESOLVED" });

  // (3) Owned throwaway container: unique name, drill-generated password,
  // dynamic port on loopback, dump copied in (never bind-mounted). The
  // password reaches the container only through the child env — docker's
  // bare `--env NAME` form inherits it, so it never appears in argv (T-08-07).
  const drillPassword = randomBytes(18).toString("base64url");
  const containerStart = await exec.run("docker", [
    "run",
    "--detach",
    "--name",
    containerName,
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    `POSTGRES_USER=${identity.user}`,
    "--env",
    `POSTGRES_DB=${identity.db}`,
    "--publish",
    "127.0.0.1::5432",
    "postgres:18-alpine",
  ], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS, env: { ...process.env, POSTGRES_PASSWORD: drillPassword } });
  if (containerStart.spawnError || containerStart.code !== 0) {
    return record({ overall: "UNVERIFIED", failureReason: "DOCKER_UNAVAILABLE" });
  }

  // Fail-closed default: cleanup counts as FAILED until rm proves otherwise,
  // so a removal failure can never render as success (D-11).
  containerCleanup = "FAILED";
  let drillQuery: DrillQuery | undefined;

  const runInsideContainer = async (resolvedIdentity: PgIdentity): Promise<{ overall: DrillOverall; failureReason?: string | undefined }> => {
    const ready = await waitDrillReady(exec, containerName, resolvedIdentity);
    if (!ready) return { overall: "UNVERIFIED", failureReason: "DRILL_DB_NOT_READY" };

    const portResult = await exec.run("docker", ["port", containerName, "5432/tcp"], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    const port = portResult.spawnError || portResult.code !== 0 ? undefined : portResult.stdout.toString("utf8").trim().split(":").at(-1);
    if (!port) return { overall: "UNVERIFIED", failureReason: "DRILL_DB_NOT_READY" };

    const drillUrl = `postgresql://${resolvedIdentity.user}:${drillPassword}@127.0.0.1:${port}/${resolvedIdentity.db}`;

    const version = await exec.run("docker", ["exec", containerName, "pg_restore", "--version"], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    if (!version.spawnError && version.code === 0) {
      const reported = version.stdout.toString("utf8").trim().slice(0, 128);
      if (reported) dbVersion = reported;
    }

    const copy = await exec.run("docker", ["cp", dumpPath, `${containerName}:${DRILL_DUMP_CONTAINER_PATH}`], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    if (copy.spawnError || copy.code !== 0) {
      checks.restore = { stage: "COPY", exitCode: copy.code ?? null, ...(copy.spawnError ? { spawnError: copy.spawnError } : {}), ...(copy.stderr.trim() ? { stderrExcerpt: redactDrillExcerpt(copy.stderr) } : {}) };
      return { overall: "FAILED", failureReason: "RESTORE_FAILED" };
    }

    const restoreStartedAt = now();
    const restore = await exec.run("docker", ["exec", containerName, "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--no-password", "-U", resolvedIdentity.user, "-d", resolvedIdentity.db, DRILL_DUMP_CONTAINER_PATH], { timeoutMs: SPAWN_DUMP_TIMEOUT_MS });
    restoreDurationMs = Math.max(0, now().getTime() - restoreStartedAt.getTime());
    checks.restore = {
      exitCode: restore.code ?? null,
      durationMs: restoreDurationMs,
      ...(restore.spawnError ? { spawnError: restore.spawnError } : {}),
      ...(restore.spawnError || restore.code !== 0 || restore.stderr.trim() ? { stderrExcerpt: redactDrillExcerpt(restore.stderr) } : {}),
    };
    if (restore.spawnError || restore.code !== 0) return { overall: "FAILED", failureReason: "RESTORE_FAILED" };

    // (4) Migration chain proof: deploy, then status must be at head —
    // `migrate status` exits 0 only when nothing is pending.
    const project = input.prismaProjectRoot
      ? { root: input.prismaProjectRoot, cli: join(input.prismaProjectRoot, "node_modules", "prisma", "build", "index.js") }
      : resolvePrismaProjectRoot();
    if (!project) return { overall: "UNVERIFIED", failureReason: "PRISMA_PROJECT_UNRESOLVED" };
    const migrateEnv = { ...process.env, DATABASE_URL: drillUrl };

    const deploy = await exec.run(process.execPath, [project.cli, "migrate", "deploy"], { cwd: project.root, env: migrateEnv, timeoutMs: SPAWN_DUMP_TIMEOUT_MS });
    if (deploy.spawnError || deploy.code !== 0) {
      checks.migrations = { deployExitCode: deploy.code ?? null, ...(deploy.spawnError ? { spawnError: deploy.spawnError } : {}), ...(deploy.stderr.trim() ? { stderrExcerpt: redactDrillExcerpt(deploy.stderr) } : {}) };
      return { overall: "UNVERIFIED", failureReason: "MIGRATE_DEPLOY_FAILED" };
    }

    const status = await exec.run(process.execPath, [project.cli, "migrate", "status"], { cwd: project.root, env: migrateEnv, timeoutMs: SPAWN_DUMP_TIMEOUT_MS });
    if (status.spawnError || status.code !== 0) {
      const detail = status.stdout.toString("utf8").trim() || status.stderr.trim();
      checks.migrations = { deployExitCode: 0, statusExitCode: status.code ?? null, state: "PENDING", ...(detail ? { detail: redactDrillExcerpt(detail) } : {}) };
      return { overall: "UNVERIFIED", failureReason: "MIGRATIONS_NOT_AT_HEAD" };
    }
    checks.migrations = { deployExitCode: 0, statusExitCode: 0, state: "AT_HEAD" };

    // (5) Chain-integrity checks are appended here by the TDD task.
    return { overall: "VERIFIED" };
  };

  let outcome: { overall: DrillOverall; failureReason?: string | undefined };
  try {
    outcome = await runInsideContainer(identity);
  } catch (error) {
    checks.error = redactDrillExcerpt(error instanceof Error ? error.message : String(error));
    outcome = { overall: "FAILED", failureReason: "DRILL_ERROR" };
  } finally {
    if (drillQuery) await drillQuery.disconnect().catch(() => { log({ event: "backup_drill.query_disconnect_failed", drillId }); });
    // (6) Exact owned cleanup, best effort, recorded not hidden (T-08-10, D-11).
    const removal = await exec.run("docker", ["rm", "--force", containerName], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    containerCleanup = removal.spawnError || removal.code !== 0 ? "FAILED" : "REMOVED";
    if (containerCleanup === "FAILED") log({ event: "backup_drill.container_cleanup_failed", drillId, containerName });
  }

  // (7) Exactly one immutable receipt — the durable fact Plan 03 projects.
  return record(outcome);
}
