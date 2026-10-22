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

type ExecCall = Readonly<{ command: string; args: readonly string[] }>;

function fakeExec(handler: (command: string, args: readonly string[]) => BackupExecResult): { exec: BackupExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  return {
    calls,
    exec: {
      async run(command, args) {
        calls.push({ command, args });
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
    expect(call!.args[9]).toMatch(/^\/LOG\+:/);
    expect(call!.args[9]).toContain(basename(dir));
    const joined = JSON.stringify(call!.args);
    expect(joined).not.toContain("/MIR");
    expect(joined).not.toContain("/PURGE");
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

  it("arms at the idle-poll delay when no successful run is on record and enqueues only the trigger discriminator", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    const enqueued: BackupJobData[] = [];
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => null),
      enqueue: async (data) => { enqueued.push(data); },
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return 1 as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([1_000]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    // T-08-02: the payload carries only the trigger discriminator — never a credential or URL.
    expect(enqueued).toEqual([{ trigger: "SCHEDULED" }]);
    expect(delays).toEqual([1_000, 1_000]);
    scheduler.close();
  });

  it("arms at max(0, lastSuccess + 24h - now) when a success is on record", async () => {
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

  it("re-arms from persisted state after a run instead of stacking a fixed interval", async () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    let queries = 0;
    let enqueued = 0;
    const scheduler = scheduleBackupTick({
      database: fakeDatabase(async () => {
        queries += 1;
        return queries === 1 ? null : { completedAt: new Date(now.getTime() - dayMs + 500) };
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
    expect(delays).toEqual([1_000, 500]); // 24h from the persisted success minus the 500ms already elapsed
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
