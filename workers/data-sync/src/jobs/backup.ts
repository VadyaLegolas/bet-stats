import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BackupConfig } from "@bet-stats/config";
import type { PrismaClient } from "@bet-stats/database";

export type BackupTrigger = "SCHEDULED" | "MANUAL";
export type BackupOffsiteStatus = "NOT_CONFIGURED" | "COPIED" | "DEGRADED";

export const SPAWN_PROBE_TIMEOUT_MS = 60_000;
export const SPAWN_DUMP_TIMEOUT_MS = 1_800_000;

export type BackupExecOptions = Readonly<{ env?: NodeJS.ProcessEnv | undefined; timeoutMs?: number | undefined }>;
export type BackupExecResult = Readonly<{ code: number | undefined; stdout: Buffer; stderr: string; spawnError?: string | undefined }>;

/** Child processes run with argv arrays only — never shell string interpolation. */
export type BackupExec = Readonly<{ run(command: string, args: readonly string[], options?: BackupExecOptions): Promise<BackupExecResult> }>;

export const spawnBackupExec: BackupExec = {
  run(command, args, options) {
    return new Promise((resolveResult) => {
      const child = spawn(command, [...args], {
        env: options?.env ?? process.env,
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
};

/** System-generated dump names only — callers never supply a filename. */
export const BACKUP_DUMP_FILE_PATTERN = /^football_prediction-\d{8}T\d{6}Z\.dump$/;

export function backupDumpFileName(timestamp: Date): string {
  const iso = timestamp.toISOString();
  return `football_prediction-${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z.dump`;
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
    args = ["exec", tools.container, "pg_dump", "--format=custom", "--no-password", "-U", identity.user, "-d", identity.db, "-f", "-"];
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

  const completedAt = now();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  await input.database.backupRun.create({
    data: {
      id: runId,
      startedAt,
      completedAt,
      durationMs,
      status: "SUCCEEDED",
      offsiteStatus: "NOT_CONFIGURED",
      trigger: input.trigger,
      fileName,
      byteSize,
      sha256,
      ...(tools.version ? { dbVersion: tools.version } : {}),
    },
  });
  log({ event: "backup.succeeded", runId, fileName, byteSize, durationMs });
  return { runId, status: "SUCCEEDED", offsiteStatus: "NOT_CONFIGURED", durationMs, fileName, byteSize, sha256 };
}
