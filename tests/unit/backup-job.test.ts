import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { readBackupConfig } from "@bet-stats/config";

import { runBackup, backupQueue, scheduleBackupTick, type BackupExec, type BackupExecResult, type BackupFs, type BackupJobData } from "../../workers/data-sync/src/jobs/backup.js";

const NOW = new Date("2026-10-22T19:00:00.000Z");
const NEW_DUMP = "football_prediction-20261022T190000Z.dump";
const DUMP_OK: BackupExecResult = { code: 0, stdout: Buffer.alloc(0), stderr: "" };

type StoredRun = Readonly<Record<string, unknown>>;

/** In-memory BackupFs with a removal ledger so pruning is observable. */
function fakeFs(seed: Record<string, Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(seed));
  const removals: string[] = [];
  const fs: BackupFs = {
    exists: (path) => store.has(path),
    size: async (path) => {
      const data = store.get(path);
      if (!data) throw new Error(`ENOENT: ${path}`);
      return data.byteLength;
    },
    remove: async (path) => {
      removals.push(path);
      store.delete(path);
    },
    rename: async (from, to) => {
      const data = store.get(from);
      if (!data) throw new Error(`ENOENT: ${from}`);
      store.set(to, data);
      store.delete(from);
    },
    write: async (path, data) => {
      store.set(path, Buffer.from(data));
    },
    sha256: async (path) => createHash("sha256").update(store.get(path) ?? Buffer.alloc(0)).digest("hex"),
    list: async (dir) => {
      const wanted = dir.replaceAll("\\", "/");
      return [...store.keys()].filter((key) => dirname(key).replaceAll("\\", "/") === wanted).map((key) => basename(key));
    },
  };
  return { fs, store, removals };
}

type ExecCall = Readonly<{ command: string; args: readonly string[]; options?: { env?: NodeJS.ProcessEnv | undefined } | undefined }>;

function fakeExec(handler: (command: string, args: readonly string[]) => BackupExecResult): { exec: BackupExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  return {
    calls,
    exec: {
      async run(command, args, options) {
        calls.push({ command, args, ...(options?.env ? { options } : {}) });
        return handler(command, args);
      },
    },
  };
}

function fakeDatabase(rows: StoredRun[]) {
  return {
    backupRun: {
      create: async ({ data }: { data: StoredRun }) => {
        rows.push(data);
        return data;
      },
    },
  } as never;
}

/** Successful local pg_dump flow: version probe, then --file written through the fake fs. */
function dumpOk(fake: ReturnType<typeof fakeFs>) {
  return (command: string, args: readonly string[]): BackupExecResult => {
    if (command === "pg_dump" && args.includes("--version")) return { code: 0, stdout: Buffer.from("pg_dump (PostgreSQL) 18.6"), stderr: "" };
    if (command === "pg_dump" && args.some((arg) => arg.startsWith("--file="))) {
      const target = args.find((arg) => arg.startsWith("--file="))!.slice("--file=".length);
      fake.store.set(target, Buffer.from("PGDMP fake archive"));
      return DUMP_OK;
    }
    return DUMP_OK;
  };
}

function dumpFilesIn(fake: ReturnType<typeof fakeFs>): string[] {
  return [...fake.store.keys()].filter((key) => key.endsWith(".dump"));
}

describe("backup job: retention rotation and robocopy off-host", () => {
  it.each([0, 1, 3, 7])("maps robocopy exit code %i below the failure bitmask to COPIED", async (code) => {
    const dir = "/tmp/bet-stats-backup-job-copied";
    const destination = "/mnt/offsite-copied";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec } = fakeExec((command, args) => (command === "robocopy" ? { code, stdout: Buffer.alloc(0), stderr: "" } : dumpOk(fake)(command, args)));

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination }),
      database: fakeDatabase(rows),
      trigger: "MANUAL",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("COPIED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SUCCEEDED", offsiteStatus: "COPIED", fileName: NEW_DUMP });
  });

  it.each([8, 16])("maps robocopy exit code %i at or above the failure bitmask to DEGRADED while the backup stays SUCCEEDED", async (code) => {
    const dir = "/tmp/bet-stats-backup-job-degraded";
    const destination = "/mnt/offsite-degraded";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec } = fakeExec((command, args) => (command === "robocopy" ? { code, stdout: Buffer.alloc(0), stderr: "" } : dumpOk(fake)(command, args)));

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("DEGRADED");
    expect(dumpFilesIn(fake)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SUCCEEDED", offsiteStatus: "DEGRADED", offsiteError: String(code), fileName: NEW_DUMP });
  });

  it("maps a robocopy spawn failure to DEGRADED with the safe error code", async () => {
    const dir = "/tmp/bet-stats-backup-job-spawn-error";
    const destination = "/mnt/offsite-spawn-error";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec } = fakeExec((command, args) =>
      command === "robocopy" ? { code: undefined, stdout: Buffer.alloc(0), stderr: "", spawnError: "ENOENT" } : dumpOk(fake)(command, args),
    );

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination }),
      database: fakeDatabase(rows),
      trigger: "MANUAL",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("DEGRADED");
    expect(rows[0]).toMatchObject({ status: "SUCCEEDED", offsiteStatus: "DEGRADED", offsiteError: "ENOENT" });
  });

  it("invokes robocopy with bounded-retry flags and never a destructive mirror or purge", async () => {
    const dir = "/tmp/bet-stats-backup-job-argv";
    const destination = "/mnt/offsite-argv";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec((command, args) => (command === "robocopy" ? { code: 1, stdout: Buffer.alloc(0), stderr: "" } : dumpOk(fake)(command, args)));

    await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination }),
      database: fakeDatabase(rows),
      trigger: "MANUAL",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    const call = calls.find((entry) => entry.command === "robocopy");
    expect(call, "robocopy must be invoked for the off-host copy").toBeDefined();
    expect(call!.args).toHaveLength(10);
    expect(call!.args[0]).toBe(dir);
    expect(call!.args[1]).toBe(destination);
    expect(call!.args[2]).toBe(NEW_DUMP);
    expect(call!.args.slice(3, 9)).toEqual(["/R:2", "/W:5", "/Z", "/XJ", "/COPY:DAT", "/NP"]);
    // IN-02: /LOG: truncates per run — /LOG+ would append forever into a file
    // inside BACKUP_DIR that retention never touches.
    expect(call!.args[9]).toMatch(/^\/LOG:/);
    expect(call!.args[9]).not.toMatch(/^\/LOG\+/);
    expect(call!.args[9]).toContain(basename(dir));
    const joined = JSON.stringify(call!.args);
    expect(joined).not.toContain("/MIR");
    expect(joined).not.toContain("/PURGE");
  });

  it("keeps the robocopy log a per-run file across two consecutive runs (IN-02)", async () => {
    const dir = "/tmp/bet-stats-backup-job-log";
    const destination = "/mnt/offsite-log";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec((command, args) => (command === "robocopy" ? { code: 1, stdout: Buffer.alloc(0), stderr: "" } : dumpOk(fake)(command, args)));

    for (let run = 0; run < 2; run += 1) {
      await runBackup({
        config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination }),
        database: fakeDatabase(rows),
        trigger: "MANUAL",
        exec,
        fs: fake.fs,
        now: () => new Date(NOW.getTime() + run * 1_000),
      });
    }

    const robocopyCalls = calls.filter((entry) => entry.command === "robocopy");
    expect(robocopyCalls).toHaveLength(2);
    for (const call of robocopyCalls) {
      const logArg = call.args.find((arg) => arg.startsWith("/LOG"));
      expect(logArg, "every robocopy run must carry an explicit log flag").toBeDefined();
      expect(logArg).toMatch(/^\/LOG:/); // overwrite, never append
      expect(logArg).not.toMatch(/^\/LOG\+/);
    }
  });

  it("records NOT_CONFIGURED and never invokes the copy when BACKUP_OFFSITE_DIR is unset", async () => {
    const dir = "/tmp/bet-stats-backup-job-unset";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec(dumpOk(fake));

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("NOT_CONFIGURED");
    expect(calls.some((entry) => entry.command === "robocopy")).toBe(false);
    expect(rows[0]).toMatchObject({ status: "SUCCEEDED", offsiteStatus: "NOT_CONFIGURED" });
  });

  it("prunes to the retention count after the new dump lands, deleting exactly the oldest dumps", async () => {
    const dir = "/tmp/bet-stats-backup-job-rotation";
    const seed: Record<string, Buffer> = {};
    for (let day = 1; day <= 15; day += 1) {
      seed[join(dir, `football_prediction-202610${String(day).padStart(2, "0")}T000000Z.dump`)] = Buffer.from(`archive-${day}`);
    }
    seed[join(dir, "restore-notes.txt")] = Buffer.from("operator notes, not a dump");
    const fake = fakeFs(seed);
    const rows: StoredRun[] = [];
    const { exec } = fakeExec(dumpOk(fake));

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_RETENTION_COUNT: "14" }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    const dumpsAfter = dumpFilesIn(fake);
    expect(dumpsAfter).toHaveLength(14);
    expect(dumpsAfter).toContain(join(dir, NEW_DUMP));
    const removedDumps = fake.removals.filter((path) => path.endsWith(".dump")).sort();
    expect(removedDumps).toEqual([join(dir, "football_prediction-20261001T000000Z.dump"), join(dir, "football_prediction-20261002T000000Z.dump")].sort());
    expect(fake.removals).not.toContain(join(dir, "restore-notes.txt"));
    expect(rows[0]).toMatchObject({ status: "SUCCEEDED", offsiteStatus: "NOT_CONFIGURED" });
  });

  it("rotates off-host copies by the same retention window after a successful robocopy, oldest first (WR-03)", async () => {
    const dir = "/tmp/bet-stats-backup-job-offsite-rotate";
    const destination = "/mnt/offsite-rotate";
    const seed: Record<string, Buffer> = {};
    for (let day = 1; day <= 3; day += 1) {
      seed[join(destination, `football_prediction-2026100${day}T000000Z.dump`)] = Buffer.from(`offsite-${day}`);
    }
    seed[join(destination, "operator-notes.txt")] = Buffer.from("not a dump, never touched");
    const fake = fakeFs(seed);
    const rows: StoredRun[] = [];
    const { exec } = fakeExec((command, args) => {
      if (command === "robocopy") {
        // simulate the copy: the new dump lands in the off-host directory
        fake.store.set(join(destination, NEW_DUMP), Buffer.from("PGDMP fake archive"));
        return { code: 1, stdout: Buffer.alloc(0), stderr: "" };
      }
      return dumpOk(fake)(command, args);
    });

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination, BACKUP_RETENTION_COUNT: "2" }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("COPIED");
    const normalized = (path: string) => path.replaceAll("\\", "/");
    const inDir = (path: string, dir: string) => normalized(path).startsWith(`${normalized(dir)}/`);
    // Exactly the newest retentionCount matching dumps remain off-host…
    const offsiteDumps = [...fake.store.keys()].filter((key) => inDir(key, destination) && key.endsWith(".dump")).sort();
    expect(offsiteDumps).toEqual([join(destination, "football_prediction-20261003T000000Z.dump"), join(destination, NEW_DUMP)].sort());
    // …the two beyond the window were removed strictly oldest-first…
    expect(fake.removals.filter((path) => inDir(path, destination))).toEqual([
      join(destination, "football_prediction-20261001T000000Z.dump"),
      join(destination, "football_prediction-20261002T000000Z.dump"),
    ]);
    // …and non-matching files are never touched (no mirror, no purge).
    expect(fake.removals).not.toContain(join(destination, "operator-notes.txt"));
    // The local dir holds only this run's dump — local retention removes nothing.
    expect(fake.removals.filter((path) => inDir(path, dir))).toHaveLength(0);
  });

  it("never prunes the off-host directory when the copy degraded (WR-03)", async () => {
    const dir = "/tmp/bet-stats-backup-job-offsite-degraded-prune";
    const destination = "/mnt/offsite-degraded-prune";
    const seed: Record<string, Buffer> = {};
    for (let day = 1; day <= 3; day += 1) {
      seed[join(destination, `football_prediction-2026100${day}T000000Z.dump`)] = Buffer.from(`offsite-${day}`);
    }
    const fake = fakeFs(seed);
    const rows: StoredRun[] = [];
    const { exec } = fakeExec((command, args) => (command === "robocopy" ? { code: 16, stdout: Buffer.alloc(0), stderr: "" } : dumpOk(fake)(command, args)));

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: destination, BACKUP_RETENTION_COUNT: "1" }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.offsiteStatus).toBe("DEGRADED");
    expect(fake.removals.filter((path) => path.replaceAll("\\", "/").startsWith(`${destination.replaceAll("\\", "/")}/`))).toHaveLength(0);
  });

  it("invokes no pruning and deletes no dumps when the dump itself fails", async () => {
    const dir = "/tmp/bet-stats-backup-job-dump-failure";
    const seed: Record<string, Buffer> = {};
    for (let day = 1; day <= 3; day += 1) {
      seed[join(dir, `football_prediction-202610${String(day).padStart(2, "0")}T000000Z.dump`)] = Buffer.from(`archive-${day}`);
    }
    const fake = fakeFs(seed);
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec((command, args) => {
      if (command === "pg_dump" && args.some((arg) => arg.startsWith("--file="))) {
        return { code: 1, stdout: Buffer.alloc(0), stderr: "pg_dump: error: connection to server failed" };
      }
      return dumpOk(fake)(command, args);
    });

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir, BACKUP_OFFSITE_DIR: "/mnt/offsite-dump-failure" }),
      database: fakeDatabase(rows),
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("FAILED");
    expect(result.reason).toBe("DUMP_FAILED");
    expect(fake.removals.filter((path) => path.endsWith(".dump"))).toHaveLength(0);
    expect(dumpFilesIn(fake)).toHaveLength(3);
    expect(calls.some((entry) => entry.command === "robocopy")).toBe(false);
    expect(rows[0]).toMatchObject({ status: "FAILED", reason: "DUMP_FAILED" });
  });
});

describe("backup job: local pg_dump connection env (CR-01)", () => {
  it("passes the connection URL to local pg_dump as libpq PG* env vars, decoded, and never in argv", async () => {
    const dir = "/tmp/bet-stats-backup-job-libpq";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec(dumpOk(fake));
    const databaseUrl = "postgresql://backup%20user:p%40ssword@db.example.internal:5544/football%2Ddb";

    const result = await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir }),
      database: fakeDatabase(rows),
      databaseUrl,
      trigger: "MANUAL",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    expect(result.status).toBe("SUCCEEDED");
    const dumpCall = calls.find((entry) => entry.args.some((arg) => arg.startsWith("--file=")));
    expect(dumpCall, "the local pg_dump dump invocation must exist").toBeDefined();
    // libpq reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE — DATABASE_URL alone is dead (CR-01).
    expect(dumpCall!.options?.env).toMatchObject({
      PGHOST: "db.example.internal",
      PGPORT: "5544",
      PGUSER: "backup user",
      PGPASSWORD: "p@ssword",
      PGDATABASE: "football-db",
    });
    // Credentials stay out of argv entirely (T-08-01): no conninfo tokens, no URL.
    const argv = JSON.stringify(dumpCall!.args);
    expect(argv).not.toContain("postgresql://");
    expect(argv).not.toContain("p@ssword");
    expect(argv).not.toContain("backup user");
    expect(argv).not.toMatch(/host=|user=|password=|dbname=/);
  });

  it("defaults PGPORT to 5432 when the connection URL carries no port", async () => {
    const dir = "/tmp/bet-stats-backup-job-libpq-default-port";
    const fake = fakeFs();
    const rows: StoredRun[] = [];
    const { exec, calls } = fakeExec(dumpOk(fake));

    await runBackup({
      config: readBackupConfig({ BACKUP_ENABLED: "true", BACKUP_DIR: dir }),
      database: fakeDatabase(rows),
      databaseUrl: "postgresql://fix:fix@127.0.0.1/fix_db",
      trigger: "SCHEDULED",
      exec,
      fs: fake.fs,
      now: () => NOW,
    });

    const dumpCall = calls.find((entry) => entry.args.some((arg) => arg.startsWith("--file=")))!;
    expect(dumpCall.options?.env).toMatchObject({ PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: "fix", PGPASSWORD: "fix", PGDATABASE: "fix_db" });
  });
});

describe("backup queue naming", () => {
  it("derives the validated backup queue name and rejects unsafe prefixes", () => {
    expect(backupQueue()).toBe("bet-stats-backup");
    expect(backupQueue("custom")).toBe("custom-backup");
    expect(() => backupQueue("bad prefix!")).toThrow();
  });
});

describe("backup tick scheduler", () => {
  const dayMs = 86_400_000;

  function fakeDatabase(findFirst: () => Promise<{ completedAt: Date } | null>) {
    return { backupRun: { findFirst } } as never;
  }

  it("arms at the idle-poll delay when no run is on record, enqueues once, and dedupes a second tick inside the pending window", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    const enqueued: BackupJobData[] = [];
    const jobIds: Array<string | undefined> = [];
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => null),
      enqueue: async (data, opts) => { enqueued.push(data); jobIds.push(opts?.jobId); },
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([1_000]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    // T-08-02: the payload carries only the trigger discriminator — never a credential or URL.
    expect(enqueued).toEqual([{ trigger: "SCHEDULED" }]);
    expect(jobIds[0]).toMatch(/^scheduled-backup-\d+$/);

    // CR-02: the pending window keeps ticking at idlePoll, but the deterministic
    // bucket jobId makes every re-tick a BullMQ no-op, never a duplicate job.
    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(enqueued).toEqual([{ trigger: "SCHEDULED" }, { trigger: "SCHEDULED" }]);
    expect(jobIds[1]).toBe(jobIds[0]);
    expect(delays).toEqual([1_000, 1_000, 1_000]);
    scheduler.close();
  });

  it("arms at max(0, newestReceipt + 24h - now) when a run is on record", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const successAt = new Date(now.getTime() - 82_800_000); // 23h ago => 1h remaining
    const delays: number[] = [];
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => ({ completedAt: successAt })),
      enqueue: async () => undefined,
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (_next, delay) => { delays.push(delay); return 1 as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([3_600_000]);
    scheduler.close();
  });

  it("re-arms at the configured interval from the newest receipt of ANY status — a persistent failure never idle-polls (CR-02)", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const failureAt = new Date(now.getTime() - 3_600_000); // FAILED an hour ago
    const delays: number[] = [];
    const queries: Array<Record<string, unknown>> = [];
    const scheduler = scheduleBackupTick({
      database: { backupRun: { findFirst: async (args: Record<string, unknown>) => { queries.push(args); return { completedAt: failureAt }; } } } as never,
      enqueue: async () => undefined,
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (_next, delay) => { delays.push(delay); return 1 as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    // No SUCCEEDED-only filter — any receipt anchors the cadence (CR-02).
    expect(queries[0]).not.toHaveProperty("where");
    expect(delays).toEqual([dayMs - 3_600_000]);
    scheduler.close();
  });

  it("polls at the bounded pending cadence with a deduped jobId while the enqueued run has not written its receipt yet (CR-02)", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    const jobIds: Array<string | undefined> = [];
    // The newest receipt is the PREVIOUS run (overdue): the freshly enqueued run
    // has no receipt yet, so the stale anchor must not compute a 0ms re-fire loop.
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => ({ completedAt: new Date(now.getTime() - dayMs - 5_000) })),
      enqueue: async (_data, opts) => { jobIds.push(opts?.jobId); },
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([0]); // overdue: fires immediately

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(jobIds).toHaveLength(1);
    expect(delays).toEqual([0, 1_000]); // stale anchor floored to the bounded pending poll

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(jobIds).toHaveLength(2);
    expect(jobIds[1]).toBe(jobIds[0]); // same bucket — BullMQ dedupes the pending-window tick
    scheduler.close();
  });

  it("re-arms from persisted state after a run instead of stacking a fixed interval", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    let queries = 0;
    let enqueued = 0;
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => {
        queries += 1;
        // The second query sees the receipt the run just wrote (same millisecond
        // as the enqueue with the frozen clock).
        return queries === 1 ? null : { completedAt: now };
      }),
      enqueue: async () => { enqueued += 1; },
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([1_000]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(enqueued).toBe(1);
    expect(queries).toBe(2);
    expect(delays).toEqual([1_000, dayMs]); // 24h anchored on the persisted receipt
    scheduler.close();
  });

  it("cancels the pending timer on close and enqueues nothing afterwards", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    const cleared: number[] = [];
    let callback: (() => void) | undefined;
    let enqueued = 0;
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => null),
      enqueue: async () => { enqueued += 1; },
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never; },
      clearTimeout: (timer) => { cleared.push(timer as unknown as number); },
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([1_000]);
    scheduler.close();
    expect(cleared).toEqual([1]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(enqueued).toBe(0);
  });

  it("reports an arm query failure, schedules a retry, and resumes from persisted state", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    const errors: unknown[] = [];
    let callback: (() => void) | undefined;
    let queries = 0;
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => {
        queries += 1;
        if (queries === 1) throw new Error("transient postgres outage");
        return null;
      }),
      enqueue: async () => undefined,
      now: () => now,
      idlePollMs: 1_000,
      retryMs: 25,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never; },
      clearTimeout: () => undefined,
      onError: (error) => errors.push(error),
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveLength(1);
    expect(delays).toEqual([25]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(queries).toBe(2);
    expect(delays).toEqual([25, 1_000]);
    scheduler.close();
  });
});
