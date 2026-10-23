import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { rename, rm, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Queue, Worker } from "bullmq";

import { DEFAULT_BACKUP_RETENTION_COUNT, type BackupConfig } from "@bet-stats/config";
import type { PrismaClient } from "@bet-stats/database";

import { redisConnection } from "../queues/index.js";

export type BackupTrigger = "SCHEDULED" | "MANUAL";
export type BackupOffsiteStatus = "NOT_CONFIGURED" | "COPIED" | "DEGRADED";

export const SPAWN_PROBE_TIMEOUT_MS = 60_000;
export const SPAWN_DUMP_TIMEOUT_MS = 1_800_000;

export type BackupExecOptions = Readonly<{ env?: NodeJS.ProcessEnv | undefined; cwd?: string | undefined; timeoutMs?: number | undefined }>;
export type BackupExecResult = Readonly<{ code: number | undefined; stdout: Buffer; stderr: string; spawnError?: string | undefined }>;

/** Child processes run with argv arrays only — never shell string interpolation. */
export type BackupExec = Readonly<{ run(command: string, args: readonly string[], options?: BackupExecOptions): Promise<BackupExecResult> }>;

export const spawnBackupExec: BackupExec = {
  run(command, args, options) {
    return new Promise((resolveResult) => {
      const child = spawn(command, [...args], {
        env: options?.env ?? process.env,
        ...(options?.cwd ? { cwd: options.cwd } : {}),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let spawnError: string | undefined;
      let settled = false;
      const killTimer = setTimeout(() => {
        spawnError = "EXEC_TIMEOUT";
        child.kill();
      }, options?.timeoutMs ?? SPAWN_PROBE_TIMEOUT_MS);
      const settle = (code: number | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolveResult({
          code: spawnError ? undefined : code,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          ...(spawnError ? { spawnError } : {}),
        });
      };
      child.once("error", (error) => {
        spawnError = (error as NodeJS.ErrnoException).code ?? error.name;
        settle(undefined);
      });
      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));
      child.once("close", (code) => settle(code ?? undefined));
    });
  },
};

export type BackupFs = Readonly<{
  exists(path: string): boolean;
  size(path: string): Promise<number>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  write(path: string, data: Buffer): Promise<void>;
  sha256(path: string): Promise<string>;
  list(dir: string): Promise<string[]>;
}>;

export const nodeBackupFs: BackupFs = {
  exists: (path) => existsSync(path),
  size: async (path) => (await stat(path)).size,
  remove: async (path) => {
    await rm(path, { force: true });
  },
  rename: async (from, to) => {
    await rename(from, to);
  },
  write: async (path, data) => {
    await writeFile(path, data);
  },
  sha256: (path) =>
    new Promise((resolveHash, rejectHash) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("error", rejectHash);
      stream.once("end", () => resolveHash(hash.digest("hex")));
    }),
  list: async (dir) => await readdir(dir),
};

/** System-generated dump names only — callers never supply a filename. */
export const BACKUP_DUMP_FILE_PATTERN = /^football_prediction-\d{8}T\d{6}Z\.dump$/;

export function backupDumpFileName(timestamp: Date): string {
  const iso = timestamp.toISOString();
  return `football_prediction-${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z.dump`;
}

export const OFFSITE_ROBOCOPY_LOG_FILE = "football-prediction-offsite.log";

export type OffsiteCopyResult = Readonly<{ status: BackupOffsiteStatus; error?: string | undefined }>;

/**
 * Copies one dump to the off-host destination with Windows robocopy. The exit
 * code is a bitmask, not a boolean: 0-7 are success classes (0 = the file is
 * already present at the destination, 1 = copied), 8+ are failure classes.
 * Bounded retries (/R:2 /W:5) are mandatory because robocopy's defaults would
 * otherwise wait essentially forever on an unreachable share; never a
 * destructive mirror or purge flag. A spawn failure degrades honestly rather
 * than failing the backup (D-06).
 */
export async function copyOffsite(input: { exec: BackupExec; sourceDir: string; destinationDir: string; fileName: string; timeoutMs?: number | undefined }): Promise<OffsiteCopyResult> {
  const args = [
    input.sourceDir,
    input.destinationDir,
    input.fileName,
    "/R:2",
    "/W:5",
    "/Z",
    "/XJ",
    "/COPY:DAT",
    "/NP",
    `/LOG+:${join(input.sourceDir, OFFSITE_ROBOCOPY_LOG_FILE)}`,
  ];
  const result = await input.exec.run("robocopy", args, { timeoutMs: input.timeoutMs ?? SPAWN_DUMP_TIMEOUT_MS });
  if (result.spawnError) return { status: "DEGRADED", error: result.spawnError };
  if (result.code === undefined) return { status: "DEGRADED", error: "ROBOCOPY_NO_EXIT_CODE" };
  if (result.code >= 8) return { status: "DEGRADED", error: String(result.code) };
  return { status: "COPIED" };
}

/**
 * Keeps the newest retentionCount dumps in BACKUP_DIR and deletes the rest.
 * System-generated names only (BACKUP_DUMP_FILE_PATTERN), so an operator file
 * or the robocopy log can never be deleted; names embed UTC timestamps, so a
 * lexicographic sort is chronological. Runs strictly after the new dump is
 * renamed into place, so a failed dump can never shrink the retention window.
 */
export async function pruneBackupRetention(input: { fs: BackupFs; dir: string; retentionCount: number; logger?: ((event: Readonly<Record<string, unknown>>) => void) | undefined }): Promise<{ deleted: string[] }> {
  const entries = await input.fs.list(input.dir);
  const dumps = entries.filter((name) => BACKUP_DUMP_FILE_PATTERN.test(name)).sort().reverse();
  const excess = dumps.slice(input.retentionCount);
  const deleted: string[] = [];
  for (const name of excess) {
    await input.fs.remove(join(input.dir, name));
    deleted.push(name);
  }
  if (deleted.length > 0) input.logger?.({ event: "backup.retention_pruned", dir: input.dir, deleted });
  return { deleted };
}

export type ResolvedPgTools =
  Readonly<{ kind: "local"; pgDump: string; version: string | undefined }>
  | Readonly<{ kind: "docker"; container: string; version: string | undefined }>;

function pgDumpBinaryName(): string {
  return process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
}

async function readToolVersion(exec: BackupExec, command: string, args: readonly string[]): Promise<string | undefined> {
  const probe = await exec.run(command, args, { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
  if (probe.spawnError || probe.code !== 0) return undefined;
  const version = probe.stdout.toString("utf8").trim();
  return version ? version.slice(0, 128) : undefined;
}

/** Resolves pg tooling fail-closed: PG_BIN directory, then PATH, then docker exec; never guesses. */
export async function resolvePgTools(input: { config: BackupConfig; exec: BackupExec; fs: BackupFs }): Promise<ResolvedPgTools | null> {
  const { config, exec, fs } = input;
  if (config.pgBinDir) {
    const candidate = join(config.pgBinDir, pgDumpBinaryName());
    if (fs.exists(candidate)) {
      return { kind: "local", pgDump: candidate, version: await readToolVersion(exec, candidate, ["--version"]) };
    }
  }
  const pathProbe = await exec.run("pg_dump", ["--version"], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS });
  if (!pathProbe.spawnError && pathProbe.code === 0) {
    const version = pathProbe.stdout.toString("utf8").trim().slice(0, 128);
    return { kind: "local", pgDump: "pg_dump", version: version ? version : undefined };
  }
  if (config.pgContainer) {
    return { kind: "docker", container: config.pgContainer, version: await readToolVersion(exec, "docker", ["exec", config.pgContainer, "pg_dump", "--version"]) };
  }
  return null;
}

export type PgIdentity = Readonly<{ user: string; db: string; source: "CONFIG" | "CONTAINER_ENV" }>;

function readPrintenv(result: BackupExecResult): string | undefined {
  if (result.spawnError || result.code !== 0) return undefined;
  const value = result.stdout.toString("utf8").trim();
  return value ? value : undefined;
}

/**
 * Resolves the docker-exec dump identity: config keys first, then the container
 * env via `docker exec printenv`. The identity is never hardcoded — docker exec
 * defaults to a login role the server rejects. Both values must resolve or the
 * run fails closed with PG_IDENTITY_UNRESOLVED.
 */
export async function resolvePgIdentity(input: { config: BackupConfig; container: string; exec: BackupExec }): Promise<PgIdentity | null> {
  const { config, container, exec } = input;
  let fromContainerEnv = false;
  let user = config.pgUser;
  let db = config.pgDb;
  if (!user) {
    user = readPrintenv(await exec.run("docker", ["exec", container, "printenv", "POSTGRES_USER"], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS }));
    fromContainerEnv ||= user !== undefined;
  }
  if (!db) {
    db = readPrintenv(await exec.run("docker", ["exec", container, "printenv", "POSTGRES_DB"], { timeoutMs: SPAWN_PROBE_TIMEOUT_MS }));
    fromContainerEnv ||= db !== undefined;
  }
  if (!user || !db) return null;
  return { user, db, source: fromContainerEnv ? "CONTAINER_ENV" : "CONFIG" };
}

export type RunBackupInput = Readonly<{
  config: BackupConfig;
  database: Pick<PrismaClient, "backupRun">;
  databaseUrl?: string | undefined;
  trigger: BackupTrigger;
  exec?: BackupExec | undefined;
  fs?: BackupFs | undefined;
  now?: (() => Date) | undefined;
  logger?: ((event: Readonly<Record<string, unknown>>) => void) | undefined;
}>;

export type BackupRunResult = Readonly<{
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  offsiteStatus: BackupOffsiteStatus;
  offsiteError?: string | undefined;
  durationMs: number;
  reason?: string | undefined;
  fileName?: string | undefined;
  byteSize?: number | undefined;
  sha256?: string | undefined;
}>;

/**
 * One backup attempt: fail-closed config gate, pg tooling resolution, atomic
 * dump-to-partial-then-rename, and exactly one append-only BackupRun receipt.
 * Credentials reach pg tools only through the child env — never argv.
 */
export async function runBackup(input: RunBackupInput): Promise<BackupRunResult> {
  const exec = input.exec ?? spawnBackupExec;
  const fs = input.fs ?? nodeBackupFs;
  const now = input.now ?? (() => new Date());
  const log = input.logger ?? (() => undefined);
  const runId = randomUUID();
  const startedAt = now();

  const recordFailure = async (reason: string, fileName?: string): Promise<BackupRunResult> => {
    const completedAt = now();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    await input.database.backupRun.create({
      data: {
        id: runId,
        startedAt,
        completedAt,
        durationMs,
        status: "FAILED",
        offsiteStatus: "NOT_CONFIGURED",
        trigger: input.trigger,
        reason,
        ...(fileName ? { fileName } : {}),
      },
    });
    log({ event: "backup.failed", runId, reason, ...(fileName ? { fileName } : {}) });
    return { runId, status: "FAILED", offsiteStatus: "NOT_CONFIGURED", durationMs, reason, ...(fileName ? { fileName } : {}) };
  };

  const { config } = input;
  if (!config.enabled) return recordFailure("BACKUP_NOT_CONFIGURED");
  if (!config.dir) return recordFailure("BACKUP_DIR_MISSING");

  const tools = await resolvePgTools({ config, exec, fs });
  if (!tools) return recordFailure("PG_TOOLING_UNAVAILABLE");

  const fileName = backupDumpFileName(startedAt);
  const partialPath = join(config.dir, `.${fileName}.partial`);
  const finalPath = join(config.dir, fileName);

  let command: string;
  let args: string[];
  let childEnv: NodeJS.ProcessEnv | undefined;
  if (tools.kind === "docker") {
    const identity = await resolvePgIdentity({ config, container: tools.container, exec });
    if (!identity) return recordFailure("PG_IDENTITY_UNRESOLVED");
    command = "docker";
    // pg_dump 18 treats `-f -` as a literal file named `-` (writes nothing to stdout,
    // exit 0) — the archive flows through stdout only when -f is omitted entirely.
    args = ["exec", tools.container, "pg_dump", "--format=custom", "--no-password", "-U", identity.user, "-d", identity.db];
  } else {
    command = tools.pgDump;
    args = ["--format=custom", "--no-password", `--file=${partialPath}`];
    if (input.databaseUrl) childEnv = { ...process.env, DATABASE_URL: input.databaseUrl };
  }

  const dump = await exec.run(command, args, { timeoutMs: SPAWN_DUMP_TIMEOUT_MS, ...(childEnv ? { env: childEnv } : {}) });
  if (dump.spawnError || dump.code !== 0) {
    await fs.remove(partialPath);
    return recordFailure("DUMP_FAILED", fileName);
  }

  if (tools.kind === "docker") await fs.write(partialPath, dump.stdout);
  const byteSize = fs.exists(partialPath) ? await fs.size(partialPath).catch(() => 0) : 0;
  if (byteSize <= 0) {
    await fs.remove(partialPath);
    return recordFailure("DUMP_EMPTY", fileName);
  }

  const sha256 = await fs.sha256(partialPath);
  await fs.rename(partialPath, finalPath);

  // BackupRun is append-only, so the single SUCCEEDED receipt is appended after
  // the off-host copy to carry the final offsiteStatus (COPIED/DEGRADED).
  let offsiteStatus: BackupOffsiteStatus = "NOT_CONFIGURED";
  let offsiteError: string | undefined;
  if (config.offsiteDir) {
    const offsite = await copyOffsite({ exec, sourceDir: config.dir, destinationDir: config.offsiteDir, fileName });
    offsiteStatus = offsite.status;
    offsiteError = offsite.error;
  }

  const completedAt = now();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  await input.database.backupRun.create({
    data: {
      id: runId,
      startedAt,
      completedAt,
      durationMs,
      status: "SUCCEEDED",
      offsiteStatus,
      trigger: input.trigger,
      fileName,
      byteSize,
      sha256,
      ...(offsiteError ? { offsiteError } : {}),
      ...(tools.version ? { dbVersion: tools.version } : {}),
    },
  });
  log({ event: "backup.succeeded", runId, fileName, byteSize, durationMs, offsiteStatus, ...(offsiteError ? { offsiteError } : {}) });

  // Retention rotates only after this run's receipt is durable; a prune failure
  // never retroactively flips a succeeded backup.
  try {
    await pruneBackupRetention({ fs, dir: config.dir, retentionCount: config.retentionCount ?? DEFAULT_BACKUP_RETENTION_COUNT, logger: log });
  } catch (error) {
    log({ event: "backup.prune_failed", runId, message: error instanceof Error ? error.message : String(error) });
  }

  return { runId, status: "SUCCEEDED", offsiteStatus, durationMs, fileName, byteSize, sha256, ...(offsiteError ? { offsiteError } : {}) };
}

// --- bet-stats-backup queue + daily persisted-state scheduler ------------------

export type BackupJobData = Readonly<{ trigger: BackupTrigger }>;

export function backupQueue(prefix = "bet-stats"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-backup`;
}

export function createBackupQueue(input: { redisUrl: string; prefix?: string }) {
  const queue = new Queue<BackupJobData>(backupQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  const add = (name: string, data: BackupJobData) => queue.add(name, data, {
    attempts: 1,
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  });
  return {
    enqueue: (data: BackupJobData) => add("backup", data),
    enqueueDrill: (data: BackupJobData) => add("drill", data),
    close: () => queue.close(),
  };
}

export type BackupJobDispatcher = (job: Readonly<{ name: string; data: BackupJobData }>) => Promise<unknown>;

/**
 * Dispatches on job.name — "backup" and "drill" share the concurrency-1 worker
 * (dumps and drills are host-serialized); anything else fails closed without a
 * second Redis connection. Extracted from createBackupWorker so the routing is
 * unit-provable without Redis.
 */
export function createBackupJobDispatcher(input: { execute: (data: BackupJobData) => Promise<unknown>; executeDrill?: ((data: BackupJobData) => Promise<unknown>) | undefined }): BackupJobDispatcher {
  return async (job) => {
    if (job.name === "backup") return input.execute(job.data);
    if (job.name === "drill") {
      if (!input.executeDrill) throw Object.assign(new Error("UNSUPPORTED_BACKUP_JOB"), { code: "UNSUPPORTED_BACKUP_JOB" });
      return input.executeDrill(job.data);
    }
    throw Object.assign(new Error("UNSUPPORTED_BACKUP_JOB"), { code: "UNSUPPORTED_BACKUP_JOB" });
  };
}

/** Concurrency 1: dumps and drills are host-serialized. Dispatches on job.name. */
export function createBackupWorker(input: { redisUrl: string; prefix?: string; execute: (data: BackupJobData) => Promise<unknown>; executeDrill?: ((data: BackupJobData) => Promise<unknown>) | undefined }) {
  return new Worker<BackupJobData>(backupQueue(input.prefix), createBackupJobDispatcher(input), { connection: redisConnection(input.redisUrl), concurrency: 1 });
}

export const BACKUP_INTERVAL_MS = 86_400_000;
const MAX_TIMER_DELAY = 2 ** 31 - 1;

export type BackupTickScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;

/**
 * Arms each backup tick from persisted state (the latest SUCCEEDED BackupRun
 * completedAt + 24h), not a self-anchored interval — the pattern is
 * self-healing across restarts with no cron library and no BullMQ v5 repeat
 * option (removed in v6). No success on record ⇒ arm at idlePollMs so the
 * first backup happens soon after worker start.
 */
export function scheduleBackupTick(input: {
  database: Pick<PrismaClient, "backupRun">;
  enqueue: (data: BackupJobData) => Promise<unknown>;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  idlePollMs?: number;
  retryMs?: number;
  intervalMs?: number;
}): BackupTickScheduler {
  const now = input.now ?? (() => new Date());
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  const intervalMs = input.intervalMs ?? BACKUP_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const arm = async (): Promise<void> => {
    if (closed) return;
    if (timer) clearTimer(timer);
    try {
      const row = await input.database.backupRun.findFirst({
        where: { status: "SUCCEEDED" },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      });
      if (closed) return;
      const rawDelay = row?.completedAt ? Math.max(0, row.completedAt.getTime() + intervalMs - now().getTime()) : (input.idlePollMs ?? 1_000);
      const delay = Math.min(MAX_TIMER_DELAY, rawDelay);
      timer = setTimer(() => { void run().catch(input.onError); }, delay);
    } catch (error) {
      input.onError?.(error);
      if (!closed) timer = setTimer(() => { void arm(); }, input.retryMs ?? 1_000);
    }
  };

  const run = async (): Promise<void> => {
    if (closed) return;
    try {
      await input.enqueue({ trigger: "SCHEDULED" });
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
