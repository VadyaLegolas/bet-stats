import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { createReplayService } from "../../apps/api/src/modules/replay/replay.service.js";
import { ReplayController } from "../../apps/api/src/modules/replay/replay.controller.js";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { createReplayQueue, createReplayWorker } from "../../workers/data-sync/src/queues/index.js";

const request = { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" };
const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-replay-${process.pid}`;
const redisName = `bet-stats-replay-redis-${process.pid}`;
let databaseUrl = ""; let redisUrl = ""; let prisma: PrismaClient;
function docker(...args: string[]) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

function replayJobData(input: { syncRunId: string; replayPlanId: string; logicalId: string; state: "FAILED" | "CANCELLED" | "SUCCEEDED" }) {
  const from = "2026-08-22T00:00:00.000Z";
  const to = "2026-08-22T23:59:59.999Z";
  return {
    syncRunId: input.syncRunId,
    replayPlanId: input.replayPlanId,
    logicalId: input.logicalId,
    revision: 1,
    input: { ...request, seasonId: input.state.toLowerCase(), from, to },
    unit: { logicalId: input.logicalId, from, to },
  };
}

describe("durable bounded replay", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch (error) { if (attempt === 59) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); } }
    const port = docker("port", containerName, "5432/tcp").split(":").at(-1); if (!port) throw new Error("PostgreSQL port missing");
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    prisma = createPrismaClient(databaseUrl);
    docker("run", "--detach", "--name", redisName, "--publish", "127.0.0.1::6379", "redis:8-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", redisName, "redis-cli", "ping"); break; } catch (error) { if (attempt === 59) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
    const redisPort = docker("port", redisName, "6379/tcp").split(":").at(-1); if (!redisPort) throw new Error("Redis port missing"); redisUrl = `redis://127.0.0.1:${redisPort}`;
  }, 120_000);
  afterAll(async () => { await prisma?.$disconnect(); for (const name of [containerName, redisName]) try { docker("rm", "--force", name); } catch { /* best effort */ } });

  it("freezes preview/version and loads them after service reconstruction", async () => {
    const first = createReplayService({ database: prisma, actor: "operator-a" });
    const preview = await first.preview(request);
    expect(preview).toMatchObject({ dryRun: true, bounded: true, calls: 3, builds: 3 });
    const restartedDatabase = createPrismaClient(databaseUrl);
    const restarted = createReplayService({ database: restartedDatabase, actor: "operator-a" });
    expect(await restarted.preview(request)).toEqual(preview);
    await expect(restarted.queue({ previewId: preview.previewId, previewVersion: "stale" })).rejects.toMatchObject({ code: "STALE_PREVIEW", status: 409 });
    await restartedDatabase.$disconnect();
  });

  it("atomically creates versioned runs, consumes once, and reconstructs status", async () => {
    const service = createReplayService({ database: prisma, actor: "operator-b" });
    const preview = await service.preview({ ...request, from: "2026-08-05T00:00:00.000Z", to: "2026-08-06T00:00:00.000Z" });
    const queued = await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    expect(queued).toMatchObject({ queued: true, duplicate: false, revision: 1 });
    expect(await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion })).toMatchObject({ queued: false, duplicate: true, replayPlanId: queued.replayPlanId });
    expect(await prisma.replayPlan.count({ where: { id: queued.replayPlanId } })).toBe(1);
    expect(await prisma.syncRun.count({ where: { replayPlanId: queued.replayPlanId } })).toBe(2);
    const deliveries = await prisma.$queryRawUnsafe<Array<{
      syncRunId: string;
      jobId: string;
      state: string;
      attemptCount: number;
      classifiedReason: string | null;
      leaseToken: string | null;
      leaseExpiresAt: Date | null;
      deliveredAt: Date | null;
    }>>(
      `SELECT d."syncRunId",d."jobId",d.state,d."attemptCount",d."classifiedReason",d."leaseToken",d."leaseExpiresAt",d."deliveredAt"
       FROM "ReplayDelivery" d
       JOIN "SyncRun" r ON r.id=d."syncRunId"
       WHERE r."replayPlanId"=$1
       ORDER BY d."jobId"`,
      queued.replayPlanId,
    );
    expect(deliveries).toHaveLength(2);
    expect(new Set(deliveries.map((delivery) => delivery.syncRunId)).size).toBe(2);
    expect(new Set(deliveries.map((delivery) => delivery.jobId)).size).toBe(2);
    expect(deliveries).toEqual(deliveries.map((delivery) => expect.objectContaining({
      state: "PENDING",
      attemptCount: 0,
      classifiedReason: null,
      leaseToken: null,
      leaseExpiresAt: null,
      deliveredAt: null,
    })));
    expect(await createReplayService({ database: prisma }).status(queued.replayPlanId)).toMatchObject({ state: "QUEUED", outcome: "PENDING", runs: [{ state: "PENDING" }, { state: "PENDING" }] });
  });

  it("requires audited reason and rejects zero headroom", async () => {
    await expect(createReplayService({ database: prisma, availableCalls: 0 }).preview({ ...request, from: "2026-08-10T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z" })).rejects.toMatchObject({ code: "NO_HEADROOM" });
    const service = createReplayService({ database: prisma });
    const preview = await service.preview({ ...request, from: "2026-08-11T00:00:00.000Z", to: "2026-08-11T00:00:00.000Z" });
    await expect(service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion, newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });

  it("keeps replay endpoints guarded and exposes only classified state", async () => {
    const guard = new OperatorGuard("operator-secret");
    expect(() => guard.authorize("wrong-secret")).toThrowError("Not found");
    const service = createReplayService({ database: prisma });
    const controller = new ReplayController(service as never);
    const preview = await controller.preview({ ...request, from: "2026-08-12T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z" });
    const queued = await controller.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    const status = await controller.status(queued.replayPlanId);
    expect(status).toMatchObject({ state: "QUEUED", outcome: "PENDING", lane: "standard" });
    expect(JSON.stringify(status)).not.toMatch(/postgresql:|redis:|password|credential/i);
  });

  it("allows one complete attempt transition while preserving immutable audit fields", async () => {
    const syncRun = await prisma.syncRun.create({ data: {
      logicalKey: `attempt-guard-${randomUUID()}`,
      revision: 1,
      provider: request.provider,
      endpointFamily: request.endpointFamily,
      lane: "standard",
      windowFrom: new Date(request.from),
      windowTo: new Date(request.to),
      state: "RUNNING",
      correlationId: randomUUID(),
    } });
    const startedAt = new Date("2026-08-19T10:00:00.000Z");
    const attempt = await prisma.syncAttempt.create({ data: {
      syncRunId: syncRun.id,
      attemptNumber: 1,
      state: "RUNNING",
      startedAt,
    } });
    const finishedAt = new Date("2026-08-19T10:01:00.000Z");

    await expect(prisma.syncAttempt.update({
      where: { id: attempt.id },
      data: { state: "FAILED", classifiedReason: "PROVIDER_TIMEOUT", finishedAt },
    })).resolves.toMatchObject({
      id: attempt.id,
      syncRunId: syncRun.id,
      attemptNumber: 1,
      state: "FAILED",
      classifiedReason: "PROVIDER_TIMEOUT",
      startedAt,
      finishedAt,
    });

    await expect(prisma.syncAttempt.update({ where: { id: attempt.id }, data: { attemptNumber: 2 } })).rejects.toThrow();
    await expect(prisma.syncAttempt.update({ where: { id: attempt.id }, data: { startedAt: new Date() } })).rejects.toThrow();
    await expect(prisma.syncAttempt.update({ where: { id: attempt.id }, data: { state: "RUNNING" } })).rejects.toThrow();
    await expect(prisma.syncAttempt.update({ where: { id: attempt.id }, data: { classifiedReason: "DIFFERENT_REASON" } })).rejects.toThrow();
  });

  it.each(["FAILED", "CANCELLED", "SUCCEEDED"] as const)("treats a redelivered %s run as a terminal no-op", async (state) => {
    const replayPlan = await prisma.replayPlan.create({ data: {
      logicalKey: `terminal-plan-${state}-${randomUUID()}`,
      revision: 1,
      provider: request.provider,
      competitionId: request.competitionId,
      endpointFamily: request.endpointFamily,
      windowFrom: new Date(request.from),
      windowTo: new Date(request.to),
      previewVersion: randomUUID(),
      actor: "integration-test",
    } });
    const logicalId = `terminal-${state.toLowerCase()}-${randomUUID()}`;
    const syncRun = await prisma.syncRun.create({ data: {
      logicalKey: logicalId,
      revision: 1,
      provider: request.provider,
      endpointFamily: request.endpointFamily,
      lane: "standard",
      windowFrom: new Date(request.from),
      windowTo: new Date(request.to),
      state,
      correlationId: randomUUID(),
      replayPlanId: replayPlan.id,
      terminalAt: new Date(),
    } });
    let executions = 0;
    const prefix = `terminal-${state.toLowerCase()}-${process.pid}`;
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix, execute: async () => { executions += 1; } });
    const queue = createReplayQueue({ redisUrl, prefix, database: prisma });

    try {
      await queue.enqueue(replayJobData({ syncRunId: syncRun.id, replayPlanId: replayPlan.id, logicalId, state }));
      for (let poll = 0; poll < 40; poll += 1) {
        if ((await prisma.syncRun.findUnique({ where: { id: syncRun.id } }))?.state !== state) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      expect(executions).toBe(0);
      expect(await prisma.syncAttempt.count({ where: { syncRunId: syncRun.id } })).toBe(0);
      expect(await prisma.syncRun.findUnique({ where: { id: syncRun.id } })).toMatchObject({ state });
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it("uses a real BullMQ worker for terminal, duplicate, retry and dead-letter lifecycle", async () => {
    const prefix = `replay-${process.pid}`; const executions = new Map<string, number>();
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix, execute: async (data) => { executions.set(data.logicalId, (executions.get(data.logicalId) ?? 0) + 1); if (data.input.seasonId === "fail") throw Object.assign(new Error("provider"), { code: "PROVIDER_TIMEOUT" }); } });
    const queue = createReplayQueue({ redisUrl, prefix, database: prisma });
    const service = createReplayService({ database: prisma, enqueuer: queue });
    const preview = await service.preview({ ...request, seasonId: "success", from: "2026-08-20T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" });
    const queued = await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    for (let i = 0; i < 80 && (await service.status(queued.replayPlanId)).state !== "SUCCEEDED"; i += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(await service.status(queued.replayPlanId)).toMatchObject({ state: "SUCCEEDED", outcome: "COMPLETED", attempts: [{ state: "SUCCEEDED", attemptNumber: 1 }] });
    await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    expect([...executions.values()]).toEqual([1]);

    const failedPreview = await service.preview({ ...request, seasonId: "fail", from: "2026-08-21T00:00:00.000Z", to: "2026-08-21T00:00:00.000Z" });
    const failed = await service.queue({ previewId: failedPreview.previewId, previewVersion: failedPreview.previewVersion });
    for (let i = 0; i < 120 && (await service.status(failed.replayPlanId)).state !== "FAILED"; i += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(await service.status(failed.replayPlanId)).toMatchObject({ state: "FAILED", outcome: "DEAD_LETTER", attempts: [{ classifiedReason: "PROVIDER_TIMEOUT" }, { classifiedReason: "PROVIDER_TIMEOUT" }, { classifiedReason: "PROVIDER_TIMEOUT" }] });
    await worker.close(); await queue.close();
  }, 30_000);
});
