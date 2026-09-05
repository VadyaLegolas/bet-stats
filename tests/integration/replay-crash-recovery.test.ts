import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@bet-stats/database";
import { createReplayQueue, createReplayWorker, type ReplayJobData } from "../../workers/data-sync/src/queues/index.js";

const root = resolve(import.meta.dirname, "../..");
const pgName = `bet-stats-crash-pg-${process.pid}`;
const redisName = `bet-stats-crash-redis-${process.pid}`;
let databaseUrl = "";
let redisUrl = "";
function docker(...args: string[]) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function wait(name: string, command: string[]) { for (let i = 0; i < 60; i += 1) { try { docker("exec", name, ...command); return; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } } throw new Error(`${name} unavailable`); }

async function hardKill(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) throw new Error("crash harness has no owned PID");
  const exited = new Promise<void>((resolveExit, rejectExit) => {
    child.once("exit", () => resolveExit());
    child.once("error", rejectExit);
  });
  if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe" });
  else child.kill("SIGKILL");
  await exited;
  if (child.exitCode === null && child.signalCode === null) throw new Error(`owned crash harness PID ${pid} did not exit`);
}

describe("replay execution process crash recovery", () => {
  beforeAll(() => {
    docker("run", "-d", "--name", pgName, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "-p", "127.0.0.1::5432", "postgres:18-alpine");
    docker("run", "-d", "--name", redisName, "-p", "127.0.0.1::6379", "redis:8-alpine");
    wait(pgName, ["pg_isready", "-U", "postgres", "-d", "bet_stats"]); wait(redisName, ["redis-cli", "ping"]);
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${docker("port", pgName, "5432/tcp").split(":").at(-1)}/bet_stats`;
    redisUrl = `redis://127.0.0.1:${docker("port", redisName, "6379/tcp").split(":").at(-1)}`;
    execFileSync(process.execPath, [resolve(root, "packages/database/node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: resolve(root, "packages/database"), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
  }, 120_000);
  afterAll(() => { for (const name of [pgName, redisName]) { try { docker("rm", "-f", name); } catch {} } });

  it("kills a claimed worker and reclaims the same stalled delivery exactly once", async () => {
    const database = createPrismaClient(databaseUrl); const prefix = `vitest-crash-${process.pid}`;
    const planId = "crash-plan"; const runId = "crash-run"; const logicalId = "crash-logical";
    await database.replayPlan.create({ data: { id: planId, logicalKey: logicalId, revision: 1, provider: "football-data.org", competitionId: "PL", endpointFamily: "RESULTS", windowFrom: new Date("2026-01-01"), windowTo: new Date("2026-01-02"), previewVersion: "crash-preview", actor: "test" } });
    await database.syncRun.create({ data: { id: runId, logicalKey: `${logicalId}:replay`, revision: 1, provider: "football-data.org", endpointFamily: "RESULTS", lane: "standard", windowFrom: new Date("2026-01-01"), windowTo: new Date("2026-01-02"), correlationId: "crash", replayPlanId: planId, expectedUnits: 1, expectedCaptures: 1, completionManifest: { expectedUnits: [logicalId], completedUnits: [], expectedCaptures: [logicalId], completedCaptures: [] } } });
    const data: ReplayJobData = { syncRunId: runId, replayPlanId: planId, logicalId, revision: 1, input: { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }, unit: { logicalId, from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" } };
    const queue = createReplayQueue({ redisUrl, prefix }); await queue.enqueue(data);
    const child: ChildProcess = fork(resolve(root, "workers/data-sync/dist/replay-crash-harness.js"), [], { env: { ...process.env, REPLAY_CRASH_DATABASE_URL: databaseUrl, REPLAY_CRASH_REDIS_URL: redisUrl, REPLAY_CRASH_PREFIX: prefix, REPLAY_CRASH_MODE: "hold-after-claim" }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    await new Promise<void>((ok, fail) => { const timer = setTimeout(() => fail(new Error("claim barrier timeout")), 15_000); child.once("message", (message) => { if ((message as { event?: string }).event === "claimed-before-provider") { clearTimeout(timer); ok(); } }); child.once("error", fail); });
    await hardKill(child);
    let calls = 0;
    const replacement = createReplayWorker({ database, redisUrl, prefix, concurrency: 2, executionLease: { leaseMs: 2_000, heartbeatMs: 250, deadlineMs: 8_000 }, lockDuration: 1_000, stalledInterval: 500, execute: async (job, context) => { calls += 1; await context.publish(async () => undefined, { expectedUnits: [job.logicalId], completedUnits: [job.logicalId], expectedCaptures: [job.logicalId], completedCaptures: [job.logicalId], delivery: "DELIVERED" }); } });
    try {
      let state = ""; for (let i = 0; i < 80; i += 1) { state = (await database.syncRun.findUniqueOrThrow({ where: { id: runId }, select: { state: true } })).state; if (state === "SUCCEEDED") break; await new Promise((resolveWait) => setTimeout(resolveWait, 250)); }
      expect(state).toBe("SUCCEEDED"); expect(calls).toBe(1);
      const attempts = await database.syncAttempt.findMany({ where: { syncRunId: runId }, orderBy: { attemptNumber: "asc" } });
      expect(attempts.map((attempt) => [attempt.state, attempt.classifiedReason])).toEqual([["FAILED", "WORKER_LEASE_EXPIRED"], ["SUCCEEDED", null]]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) await hardKill(child);
      await replacement.close(); await queue.close(); await database.$disconnect();
    }
  }, 45_000);
});
