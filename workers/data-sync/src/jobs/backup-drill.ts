import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSecrets, DEFAULT_BACKUP_DRILL_INTERVAL_HOURS, type BackupConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import {
  BACKUP_DUMP_FILE_PATTERN,
  nodeBackupFs,
  resolvePgIdentity,
  scheduledJobId,
  spawnBackupExec,
  SPAWN_DUMP_TIMEOUT_MS,
  SPAWN_PROBE_TIMEOUT_MS,
  type BackupExec,
  type BackupFs,
  type BackupJobData,
  type BackupJobEnqueueOpts,
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

/**
 * Canonical tables counted at drill start and after restore (D-09). A future
 * migration adding a canonical table extends this list in one place; the
 * FK-orphan scan needs no such list — it is driven by pg_constraint itself.
 */
export const DRILL_CANONICAL_TABLES = ["League", "Season", "Team", "Fixture", "ForecastSnapshot", "ValueReceipt", "ResultVersion", "SettlementReceipt", "ManualOddsSnapshot"] as const;

/** One UNION ALL pass over every canonical table — captured against the source DB at drill start. */
export function buildCanonicalCountQuery(): string {
  return DRILL_CANONICAL_TABLES.map((table) => `SELECT '${table}' AS "table", count(*)::int AS "count" FROM "${table}"`).join(" UNION ALL ");
}

/** Row counts keyed by table name; a table missing from the result counts as zero. */
export async function captureSourceCounts(query: DrillSqlQuery): Promise<Record<string, number>> {
  const rows = await query<{ table: string; count: number }>(buildCanonicalCountQuery());
  const counts: Record<string, number> = {};
  for (const table of DRILL_CANONICAL_TABLES) counts[table] = 0;
  for (const row of rows) if ((DRILL_CANONICAL_TABLES as readonly string[]).includes(row.table)) counts[row.table] = Number(row.count);
  return counts;
}

/**
 * Enumerates every public-schema foreign key with its equi-join predicate and
 * a per-key IS NOT NULL guard — zero hardcoding, so the scan survives future
 * migrations. The guard matters: a NULL FK column is not an orphan, so the
 * naive Q5 `WHERE p.oid IS NULL` alone would false-fail on every nullable key
 * (ForecastSnapshot.supersedesForecastId, ValueReceipt.supersedesValueReceiptId, …).
 */
const FK_ORPHAN_CATALOG_SQL = `SELECT c.conrelid::regclass::text AS "child", c.confrelid::regclass::text AS "parent",
  (SELECT string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.ord)
     FROM unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(cnum, pnum, ord)
     JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.cnum
     JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.pnum) AS "join_pred",
  (SELECT string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ' ORDER BY k.ord)
     FROM unnest(c.conkey) WITH ORDINALITY AS k(cnum, ord)
     JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.cnum) AS "not_null_pred"
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.conrelid
WHERE c.contype = 'f' AND n.nspname = 'public'
ORDER BY "child", "parent"`;

export type ChainIntegrityResult = Readonly<{ passed: boolean; checks: Record<string, DrillCheckValue> }>;

/**
 * Chain-integrity checks against the restored throwaway database (D-09):
 * (a) canonical tables non-empty keyed on the captured source counts — source
 *     zero records SKIPPED (never PASSED), source positive with restored zero
 *     fails; (b) a generic FK-orphan scan driven by pg_constraint over the
 *     public schema, recording per-relation orphan counts and failing when any
 *     exceeds zero; (c) curated supersession-chain checks (ForecastSnapshot
 *     supersession pointers, ValueReceipt fixture compatibility against its
 *     snapshot and odds rows, SettlementReceipt revisions above 1 carrying a
 *     supersedes pointer); (d) row-count parity — FAIL only when the restored
 *     count is below the captured count (truncation is the real signal);
 *     positive deltas are recorded without failing because live writes between
 *   capture and dump snapshot are legitimate (Pitfall 7).
 */
export async function runChainIntegrityChecks(input: { query: DrillSqlQuery; sourceCounts: Readonly<Record<string, number>> }): Promise<ChainIntegrityResult> {
  const { query, sourceCounts } = input;
  const checks: Record<string, DrillCheckValue> = {};
  let passed = true;

  // (a)+(d) Restored counts from one pass, then non-empty and parity per table.
  const restoredCounts = await captureSourceCounts(query);
  const nonEmpty: Record<string, DrillCheckValue> = {};
  const parity: Record<string, DrillCheckValue> = {};
  for (const table of DRILL_CANONICAL_TABLES) {
    const source = sourceCounts[table] ?? 0;
    const restored = restoredCounts[table] ?? 0;
    nonEmpty[table] = source === 0
      ? { state: "SKIPPED", source, restored }
      : restored === 0
        ? { state: "FAILED", source, restored }
        : { state: "PASSED", source, restored };
    parity[table] = restored < source
      ? { state: "FAILED", source, restored, delta: restored - source }
      : { state: "PASSED", source, restored, delta: restored - source };
  }
  checks.nonEmpty = nonEmpty;
  checks.parity = parity;
  if (Object.values(nonEmpty).some((entry) => (entry as { state: string }).state === "FAILED")) passed = false;
  if (Object.values(parity).some((entry) => (entry as { state: string }).state === "FAILED")) passed = false;

  // (b) Generic FK-orphan scan: per public-schema foreign key, count child
  // rows whose composite key matches no parent row (NULL keys are guarded out).
  const relations = await query<{ child: string; parent: string; join_pred: string; not_null_pred: string }>(FK_ORPHAN_CATALOG_SQL);
  const relationCounts: Record<string, DrillCheckValue> = {};
  let totalOrphans = 0;
  for (const relation of relations) {
    const rows = await query<{ orphans: number }>(
      `SELECT count(*)::int AS "orphans" FROM ${relation.child} c LEFT JOIN ${relation.parent} p ON ${relation.join_pred} WHERE ${relation.not_null_pred} AND p.oid IS NULL`,
    );
    const orphans = Number(rows[0]?.orphans ?? 0);
    relationCounts[`${relation.child} -> ${relation.parent}`] = orphans;
    totalOrphans += orphans;
  }
  checks.fkOrphans = { state: totalOrphans === 0 ? "PASSED" : "FAILED", total: totalOrphans, relations: relationCounts };
  if (totalOrphans > 0) passed = false;

  // (c) Curated supersession-chain checks — the semantics pg_constraint cannot express.
  const [forecast] = await query<{ violations: number }>(
    `SELECT count(*)::int AS "violations" FROM "ForecastSnapshot" f LEFT JOIN "ForecastSnapshot" p ON f."supersedesForecastId" = p.id WHERE f."supersedesForecastId" IS NOT NULL AND p.id IS NULL`,
  );
  const [value] = await query<{ violations: number }>(
    `SELECT count(*)::int AS "violations" FROM "ValueReceipt" v JOIN "ForecastSnapshot" fs ON v."forecastSnapshotId" = fs.id JOIN "ManualOddsSnapshot" m ON v."oddsSnapshotId" = m.id WHERE fs."fixtureId" <> v."fixtureId" OR m."fixtureId" <> v."fixtureId"`,
  );
  const [settlement] = await query<{ violations: number }>(
    `SELECT count(*)::int AS "violations" FROM "SettlementReceipt" s WHERE s.revision > 1 AND s."supersedesSettlementReceiptId" IS NULL`,
  );
  const violations = {
    forecastSupersession: Number(forecast?.violations ?? 0),
    valueReceiptFixtureLink: Number(value?.violations ?? 0),
    settlementSupersession: Number(settlement?.violations ?? 0),
  };
  checks.curated = { state: Object.values(violations).every((count) => count === 0) ? "PASSED" : "FAILED", violations };
  if (!checks.curated || (checks.curated as { state: string }).state === "FAILED") passed = false;

  return { passed, checks };
}

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
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_URL]")
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

/**
 * Classifies the Docker connection-failure family within an exec stderr (WR-01).
 * A post-rm `docker inspect` that exits non-zero because the daemon became
 * unreachable is indistinguishable by exit code from the canonical "No such
 * object" absence, so it must never count as absence evidence. Deliberately
 * narrow so the canonical absence messages — which literally contain the word
 * "daemon" ("Error response from daemon: No such container") — never match:
 * only the connection-failure phrases are treated as a daemon fault.
 */
function isDockerUnreachableError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes("cannot connect") ||
    normalized.includes("error during connect") ||
    normalized.includes("is the docker daemon running")
  );
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

  // (2b) Parity baseline (D-09): source row counts captured at drill start,
  // before the throwaway container starts. A failing capture is a missing
  // precondition — UNVERIFIED, no container started.
  let sourceCounts: Record<string, number>;
  try {
    sourceCounts = await captureSourceCounts((text, params) => input.database.$queryRawUnsafe(text, ...(params ?? [])));
    checks.sourceCounts = sourceCounts;
  } catch (error) {
    checks.sourceCounts = { error: redactDrillExcerpt(error instanceof Error ? error.message : String(error)) };
    return record({ overall: "UNVERIFIED", failureReason: "SOURCE_COUNTS_UNAVAILABLE" });
  }

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
    // Throwaway-DB access through the injected (or default Prisma) query handle;
    // disconnected in the finally block below. Password reaches it only via the
    // URL built from child-env material — never argv (T-08-07).
    drillQuery = (input.createDrillQuery ?? defaultDrillQuery)(drillUrl);

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

    // (5) Chain-integrity checks (D-09) against the restored database. Any
    // failed check flips the receipt to FAILED — the drill can never silently
    // pass (T-08-08); the four entries land in the receipt checks JSON as the
    // durable audit trail.
    try {
      const integrity = await runChainIntegrityChecks({ query: drillQuery.queryRaw, sourceCounts });
      Object.assign(checks, integrity.checks);
      if (!integrity.passed) return { overall: "FAILED", failureReason: "CHAIN_INTEGRITY_FAILED" };
    } catch (error) {
      checks.chainIntegrity = { state: "FAILED", error: redactDrillExcerpt(error instanceof Error ? error.message : String(error)) };
      return { overall: "FAILED", failureReason: "CHAIN_INTEGRITY_FAILED" };
    }
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
    // The verdict is object-verified, never exit-code-guessed (G-08-5): on
    // Docker server 29.x `rm --force` is idempotent (exit 0 for a name that no
    // longer resolves), so a rename race would otherwise be recorded as an
    // honest REMOVED while an orphan container stays alive. Sequence, all by
    // the exact recorded containerName: pre-rm inspect (identity still present
    // under the recorded name — a miss means the identity was lost before
    // cleanup, but the rm is still attempted best-effort), rm, post-rm inspect.
    // REMOVED therefore requires positive inspect evidence twice: the container
    // present at the pre-rm inspect, AND a post-rm inspect that actually ran
    // (no spawnError), reached the daemon, exited non-zero, and carries no
    // daemon-unreachable indicator — every other path fails closed to FAILED.
    // (WR-01: a post-rm spawnError or a daemon error is NOT absence evidence.)
    const preInspect = await exec.run("docker", ["inspect", containerName], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    const removal = await exec.run("docker", ["rm", "--force", containerName], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    const postInspect = await exec.run("docker", ["inspect", containerName], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
    const identityLostBeforeRm = Boolean(preInspect.spawnError) || preInspect.code !== 0;
    const rmFailed = Boolean(removal.spawnError) || removal.code !== 0;
    // Fail-closed absence proof (WR-01): only a post-rm inspect that actually
    // reached the daemon and exited non-zero proves the container is gone. A
    // spawnError (the CLI never ran) or a daemon fault (indistinguishable by
    // exit code from "No such object") is not evidence of absence.
    const absentPerInspect = !postInspect.spawnError && postInspect.code !== 0 && !isDockerUnreachableError(postInspect.stderr);
    containerCleanup = identityLostBeforeRm || rmFailed || !absentPerInspect ? "FAILED" : "REMOVED";
    // Durable audit trail in the immutable receipt checks JSON: container name
    // plus per-stage exit codes ("spawn_error" when the CLI could not spawn).
    // The name is system-generated (bet-stats-drill-pg-<pid>-<ts>) and flows
    // through redactSecrets + the closed BackupFact DTO (T-08-22).
    checks.containerCleanup = {
      containerName,
      preInspect: preInspect.code ?? "spawn_error",
      rmExitCode: removal.code ?? "spawn_error",
      postInspect: postInspect.code ?? "spawn_error",
      verdict: containerCleanup,
    };
    if (containerCleanup === "FAILED") log({ event: "backup_drill.container_cleanup_failed", drillId, containerName });
  }

  // (7) Exactly one immutable receipt — the durable fact Plan 03 projects.
  return record(outcome);
}

/** Weekly cadence default (D-10): BACKUP_DRILL_INTERVAL_HOURS, 168h when unset. */
export const DRILL_INTERVAL_MS = DEFAULT_BACKUP_DRILL_INTERVAL_HOURS * 3_600_000;
const MAX_TIMER_DELAY = 2 ** 31 - 1;

export type DrillTickScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;

/**
 * Arms each drill tick from persisted state (D-03): the newest
 * BackupVerificationReceipt completedAt + drillIntervalMs — any drill outcome
 * (VERIFIED, FAILED, UNVERIFIED) resets the cadence, so a failing deployment
 * drills again at the interval rather than looping at 1 Hz (CR-02). No receipt
 * on record ⇒ idlePollMs, so a never-verified deployment drills soon after
 * worker start without operator action; re-ticks inside that pending window
 * share a deterministic dedup jobId, so exactly one drill job lands (CR-02).
 * The callback enqueues the "drill" job with the trigger discriminator only
 * (Pitfall 8 — never a credential or URL) and re-arms from persisted state.
 * A delay beyond the 32-bit timer ceiling re-arms arm() instead of firing
 * run(), so intervals above ~596h (up to the validated 8760h max) never
 * drill early (WR-02). Structural copy of scheduleBackupTick.
 */
export function scheduleDrillTick(input: {
  database: Pick<PrismaClient, "backupVerificationReceipt">;
  enqueue: (data: BackupJobData, opts?: BackupJobEnqueueOpts) => Promise<unknown>;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  idlePollMs?: number;
  retryMs?: number;
  intervalMs?: number;
}): DrillTickScheduler {
  const now = input.now ?? (() => new Date());
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  const intervalMs = input.intervalMs ?? DRILL_INTERVAL_MS;
  const pendingPollMs = input.idlePollMs ?? 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let lastEnqueuedAtMs: number | undefined;

  const arm = async (): Promise<void> => {
    if (closed) return;
    if (timer) clearTimer(timer);
    try {
      const row = await input.database.backupVerificationReceipt.findFirst({ orderBy: { completedAt: "desc" }, select: { completedAt: true } });
      if (closed) return;
      const anchorMs = row?.completedAt?.getTime();
      let rawDelay = anchorMs === undefined ? pendingPollMs : Math.max(0, anchorMs + intervalMs - now().getTime());
      // A just-enqueued drill has no receipt yet; the stale anchor would
      // compute a 0ms re-fire loop. Poll at the bounded pending cadence — the
      // dedup jobId makes every poll a Redis no-op (CR-02).
      if (lastEnqueuedAtMs !== undefined && (anchorMs === undefined || anchorMs < lastEnqueuedAtMs)) {
        rawDelay = Math.max(rawDelay, pendingPollMs);
      }
      // WR-02: a capped delay re-arms arm() to recompute the remaining delay
      // instead of run() — an interval above ~596h must never drill early.
      const capped = rawDelay > MAX_TIMER_DELAY;
      timer = setTimer(() => { void (capped ? arm() : run().catch(input.onError)); }, Math.min(MAX_TIMER_DELAY, rawDelay));
    } catch (error) {
      input.onError?.(error);
      if (!closed) timer = setTimer(() => { void arm(); }, input.retryMs ?? 1_000);
    }
  };

  const run = async (): Promise<void> => {
    if (closed) return;
    try {
      const enqueuedAtMs = now().getTime();
      await input.enqueue({ trigger: "SCHEDULED" }, { jobId: scheduledJobId("drill", enqueuedAtMs, intervalMs) });
      lastEnqueuedAtMs = enqueuedAtMs;
      await arm();
    } catch (error) {
      input.onError?.(error);
      if (!closed) timer = setTimer(() => { void run().catch(input.onError); }, input.retryMs ?? 1_000);
    }
  };

  void arm();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimer(timer);
    },
    refresh: arm,
  };
}
