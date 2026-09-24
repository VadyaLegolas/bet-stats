import "../../apps/api/node_modules/reflect-metadata/Reflect.js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPrismaClient,
  createReplayProviderPolicyRepository,
  DEFAULT_REPLAY_PROVIDER_POLICIES,
  type PrismaClient,
} from "@bet-stats/database";
import {
  evaluateReplayProviderPolicy,
  fingerprintReplayProviderPolicy,
} from "@bet-stats/domain";
import { createBullReplayEnqueuer, createReplayService } from "../../apps/api/src/modules/replay/replay.service.js";
import { ReplayController } from "../../apps/api/src/modules/replay/replay.controller.js";
import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { createReplayQueue, createReplayWorker } from "../../workers/data-sync/src/queues/index.js";
import { claimReplayExecution } from "../../workers/data-sync/src/queues/replay-execution.js";
import { createDurableProviderCircuitRegistry } from "../../workers/data-sync/src/resilience/circuits.js";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { AppModule } from "../../apps/api/src/app.module.js";

const request = { recoveryType: "INGESTION" as const, reason: "Recover the exact bounded result window after an audited provider interruption.", provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" };
const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-replay-${process.pid}`;
const redisName = `bet-stats-replay-redis-${process.pid}`;
let databaseUrl = ""; let redisUrl = ""; let prisma: PrismaClient;
function docker(...args: string[]) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

const resultsPolicy = {
  provider: "football-data.org",
  endpointFamily: "RESULTS",
  lane: "standard" as const,
  configuredAllowance: 10,
  criticalHeadroom: 3,
  resetTimezone: "UTC",
};

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
  afterAll(async () => { await prisma?.$disconnect(); for (const name of [containerName, redisName]) try { docker("rm", "--force", name); } catch { /* best effort */ } }, 30_000);

  it("reads one durable provider-policy snapshot with a stable complete fingerprint", async () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const updatedAt = new Date("2026-09-30T11:59:00.000Z");
    await prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      create: { id: randomUUID(), provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily, state: "CLOSED", updatedAt },
      update: { state: "CLOSED", openedAt: null, nextProbeAt: null, probeLeaseToken: null, probeLeaseExpiresAt: null, updatedAt },
    });
    await prisma.providerRequestReservation.deleteMany({ where: { provider: resultsPolicy.provider, requestDate: now, endpoint: resultsPolicy.endpointFamily } });
    await prisma.providerRequestReservation.createMany({ data: [
      { provider: resultsPolicy.provider, requestDate: now, endpoint: resultsPolicy.endpointFamily, jobKey: `snapshot-a-${randomUUID()}` },
      { provider: resultsPolicy.provider, requestDate: now, endpoint: "FIXTURES", jobKey: `snapshot-b-${randomUUID()}` },
    ] });

    const repository = createReplayProviderPolicyRepository({
      database: prisma,
      policies: [resultsPolicy],
      now: () => now,
      circuitFreshnessMs: 5 * 60_000,
    });
    const first = await repository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);
    const second = await repository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);

    expect(first).toEqual({
      version: "replay-provider-policy/v1",
      provider: resultsPolicy.provider,
      endpointFamily: resultsPolicy.endpointFamily,
      lane: "standard",
      resetDate: "2026-09-30",
      resetTimezone: "UTC",
      configuredAllowance: 10,
      criticalHeadroom: 3,
      reserved: 2,
      remaining: 8,
      availableForLane: 5,
      circuit: {
        state: "CLOSED",
        updatedAt: updatedAt.toISOString(),
        nextProbeAt: null,
        probeLeaseExpiresAt: null,
      },
      observedAt: now.toISOString(),
      validUntil: "2026-09-30T12:04:00.000Z",
      blockedReason: null,
    });
    expect(second).toEqual(first);
    expect(fingerprintReplayProviderPolicy(first)).toMatch(/^identity-v2:[a-f0-9]{64}$/);
    expect(fingerprintReplayProviderPolicy(second)).toBe(fingerprintReplayProviderPolicy(first));
    expect(evaluateReplayProviderPolicy(first, 5, now)).toEqual({ allowed: true, remainingAfter: 0 });
  });

  it("uses one compare-and-set HALF_OPEN lease across independently constructed Workers", async () => {
    await prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      create: { id: randomUUID(), provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily, state: "HALF_OPEN" },
      update: { state: "HALF_OPEN", probeLeaseToken: null, probeLeaseExpiresAt: null },
    });
    const first = createDurableProviderCircuitRegistry({ database: prisma });
    const secondDatabase = createPrismaClient(databaseUrl);
    const second = createDurableProviderCircuitRegistry({ database: secondDatabase });
    try {
      expect((await Promise.all([
        first.acquireProbe(resultsPolicy.provider, resultsPolicy.endpointFamily),
        second.acquireProbe(resultsPolicy.provider, resultsPolicy.endpointFamily),
      ])).filter(Boolean)).toHaveLength(1);
      const leased = await prisma.providerCircuitState.findUniqueOrThrow({ where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } } });
      expect(leased.probeLeaseToken).toEqual(expect.any(String));
      expect(leased.probeLeaseExpiresAt).toEqual(expect.any(Date));

      await first.releaseProbe(resultsPolicy.provider, resultsPolicy.endpointFamily);
      await second.releaseProbe(resultsPolicy.provider, resultsPolicy.endpointFamily);
      expect(await first.acquireProbe(resultsPolicy.provider, resultsPolicy.endpointFamily)).toBe(true);
    } finally {
      await first.releaseProbe(resultsPolicy.provider, resultsPolicy.endpointFamily);
      await second.releaseProbe(resultsPolicy.provider, resultsPolicy.endpointFamily);
      await secondDatabase.$disconnect();
    }
  });

  it("returns fail-closed snapshots for absent, stale, and malformed policy metadata", async () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const missingPolicy = createReplayProviderPolicyRepository({ database: prisma, policies: [], now: () => now });
    const absent = await missingPolicy.read(resultsPolicy.provider, "STANDINGS");
    expect(absent.blockedReason).toBe("MISSING_POLICY");
    expect(evaluateReplayProviderPolicy(absent, 1, now)).toEqual({ allowed: false, reason: "MISSING_POLICY" });

    await prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      create: { id: randomUUID(), provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily, state: "CLOSED", updatedAt: new Date("2026-09-01T11:00:00.000Z") },
      update: { state: "CLOSED", updatedAt: new Date("2026-09-01T11:00:00.000Z") },
    });
    const staleRepository = createReplayProviderPolicyRepository({ database: prisma, policies: [resultsPolicy], now: () => now, circuitFreshnessMs: 5 * 60_000 });
    const stale = await staleRepository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);
    expect(stale.blockedReason).toBe("STALE_CIRCUIT_STATE");
    expect(evaluateReplayProviderPolicy(stale, 1, now)).toEqual({ allowed: false, reason: "STALE_CIRCUIT_STATE" });

    const malformedRepository = createReplayProviderPolicyRepository({
      database: prisma,
      policies: [{ ...resultsPolicy, configuredAllowance: -1 }],
      now: () => now,
    });
    const malformed = await malformedRepository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);
    expect(malformed.blockedReason).toBe("MALFORMED_POLICY");
    expect(evaluateReplayProviderPolicy(malformed, 1, now)).toEqual({ allowed: false, reason: "MALFORMED_POLICY" });
  });

  it("persists the exact approved policy and classifies durable policy changes in status", async () => {
    const policyNow = new Date("2026-09-30T14:00:00.000Z");
    const updatedAt = new Date("2026-09-30T13:59:00.000Z");
    await prisma.providerRequestReservation.deleteMany({ where: { provider: resultsPolicy.provider, requestDate: policyNow } });
    await prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      create: { id: randomUUID(), provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily, state: "CLOSED", updatedAt },
      update: { state: "CLOSED", openedAt: null, nextProbeAt: null, probeLeaseToken: null, probeLeaseExpiresAt: null, updatedAt },
    });
    const repository = createReplayProviderPolicyRepository({ database: prisma, policies: [resultsPolicy], now: () => policyNow });
    const expectedApproved = await repository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);
    const service = createReplayService({ database: prisma, providerPolicyRepository: repository, now: () => policyNow });
    const preview = await service.preview({ ...request, from: "2026-08-25T00:00:00.000Z", to: "2026-08-25T00:00:00.000Z" }, "integration-operator");

    expect(preview.providerPolicy).toEqual({
      fingerprint: fingerprintReplayProviderPolicy(expectedApproved),
      snapshot: expectedApproved,
    });
    expect(preview.headroom).toEqual({ available: true, remainingCalls: expectedApproved.availableForLane! - 1 });
    const persisted = await prisma.replayPreview.findUniqueOrThrow({ where: { id: preview.previewId } });
    expect(persisted.providerPolicyFingerprint).toBe(fingerprintReplayProviderPolicy(expectedApproved));
    expect(persisted.impact).toMatchObject({ providerPolicy: expectedApproved });

    const queued = await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    await prisma.providerCircuitState.update({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      data: { state: "OPEN", openedAt: policyNow, updatedAt: policyNow },
    });
    const expectedCurrent = await repository.read(resultsPolicy.provider, resultsPolicy.endpointFamily);
    expect(await service.status(queued.replayPlanId)).toMatchObject({
      providerPolicy: {
        classification: "UNCHANGED",
        approved: { fingerprint: fingerprintReplayProviderPolicy(expectedApproved), snapshot: expectedApproved },
        current: { fingerprint: fingerprintReplayProviderPolicy(expectedCurrent), snapshot: expectedCurrent },
      },
    });

    await prisma.providerCircuitState.update({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      data: { state: "CLOSED", openedAt: null, updatedAt },
    });
    const stalePreview = await service.preview({ ...request, from: "2026-08-26T00:00:00.000Z", to: "2026-08-26T00:00:00.000Z" }, "integration-operator");
    await prisma.providerCircuitState.update({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      data: { state: "OPEN", openedAt: policyNow, updatedAt: policyNow },
    });
    await expect(service.queue({ previewId: stalePreview.previewId, previewVersion: stalePreview.previewVersion }))
      .rejects.toMatchObject({ code: "CIRCUIT_OPEN", status: 409 });
  });

  it("rejects every fail-closed provider policy before queue delivery", async () => {
    const policyNow = new Date("2026-09-30T16:00:00.000Z");
    const enqueuer = { enqueue: vi.fn(async () => undefined) };
    const setCircuit = async (state: "CLOSED" | "OPEN") => prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      create: { id: randomUUID(), provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily, state, updatedAt: policyNow },
      update: { state, openedAt: state === "OPEN" ? policyNow : null, updatedAt: policyNow },
    });
    const expectDenied = async (policy: typeof resultsPolicy, reason: string, offset: number) => {
      const repository = createReplayProviderPolicyRepository({ database: prisma, policies: [policy], now: () => policyNow });
      const service = createReplayService({ database: prisma, enqueuer, providerPolicyRepository: repository, now: () => policyNow });
      await expect(service.preview({ ...request, from: `2026-08-${27 + offset}T00:00:00.000Z`, to: `2026-08-${27 + offset}T00:00:00.000Z` }, "integration-operator"))
        .rejects.toMatchObject({ code: reason, status: 409 });
    };

    await prisma.providerRequestReservation.deleteMany({ where: { provider: resultsPolicy.provider, requestDate: policyNow } });
    await setCircuit("OPEN");
    await expectDenied(resultsPolicy, "CIRCUIT_OPEN", 0);

    await setCircuit("CLOSED");
    await expectDenied({ ...resultsPolicy, resetTimezone: "Missing/Timezone" }, "UNKNOWN_RESET_SEMANTICS", 1);

    await prisma.providerRequestReservation.create({ data: { provider: resultsPolicy.provider, requestDate: policyNow, endpoint: "RESULTS", jobKey: randomUUID() } });
    await expectDenied({ ...resultsPolicy, configuredAllowance: 1, criticalHeadroom: 0 }, "ALLOWANCE_EXHAUSTED", 2);
    await expectDenied({ ...resultsPolicy, configuredAllowance: 3, criticalHeadroom: 2 }, "CRITICAL_HEADROOM", 3);
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it("freezes preview/version and loads them after service reconstruction", async () => {
    const first = createReplayService({ database: prisma, actor: "operator-a" });
    const preview = await first.preview(request, "operator-a");
    expect(preview).toMatchObject({ dryRun: true, bounded: true, calls: 3, builds: 3 });
    const restartedDatabase = createPrismaClient(databaseUrl);
    const restarted = createReplayService({ database: restartedDatabase, actor: "operator-a" });
    expect(await restarted.preview(request, "operator-a")).toEqual(preview);
    await expect(restarted.queue({ previewId: preview.previewId, previewVersion: "stale" })).rejects.toMatchObject({ code: "STALE_PREVIEW", status: 409 });
    await restartedDatabase.$disconnect();
  });

  it("atomically creates versioned runs, consumes once, and reconstructs status", async () => {
    const service = createReplayService({ database: prisma, actor: "operator-b" });
    const preview = await service.preview({ ...request, from: "2026-08-05T00:00:00.000Z", to: "2026-08-06T00:00:00.000Z" }, "operator-b");
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

  it("treats a fresh preview with the same logical key as duplicate work", async () => {
    const input = { ...request, seasonId: `logical-${randomUUID()}`, from: "2026-08-26T00:00:00.000Z", to: "2026-08-26T00:00:00.000Z" };
    await prisma.providerCircuitState.upsert({
      where: { provider_endpointFamily: { provider: input.provider, endpointFamily: input.endpointFamily } },
      create: { id: randomUUID(), provider: input.provider, endpointFamily: input.endpointFamily, state: "CLOSED", updatedAt: new Date() },
      update: { state: "CLOSED", openedAt: null, nextProbeAt: null, probeLeaseToken: null, probeLeaseExpiresAt: null, updatedAt: new Date() },
    });
    const approvedPolicy = await createReplayProviderPolicyRepository({ database: prisma, policies: DEFAULT_REPLAY_PROVIDER_POLICIES }).read(input.provider, input.endpointFamily);
    const enqueuer = { enqueue: vi.fn(async () => undefined) };
    const service = createReplayService({ database: prisma, enqueuer, providerPolicyRepository: { read: async () => approvedPolicy } });
    const firstPreview = await service.preview(input, "operator-logical-key");
    const first = await service.queue({ previewId: firstPreview.previewId, previewVersion: firstPreview.previewVersion });
    const secondPreview = await service.preview(input, "operator-logical-key");

    expect(secondPreview.previewId).not.toBe(firstPreview.previewId);
    const [left, right] = await Promise.all([
      service.queue({ previewId: secondPreview.previewId, previewVersion: secondPreview.previewVersion }),
      service.queue({ previewId: secondPreview.previewId, previewVersion: secondPreview.previewVersion }),
    ]);

    expect(left).toMatchObject({ replayPlanId: first.replayPlanId, queued: false, duplicate: true, revision: 1 });
    expect(right).toEqual(left);
    expect(await prisma.replayPlan.count({ where: { logicalKey: (await prisma.replayPlan.findUniqueOrThrow({ where: { id: first.replayPlanId } })).logicalKey } })).toBe(1);
    expect(await prisma.syncRun.count({ where: { replayPlanId: first.replayPlanId } })).toBe(1);
    expect(await prisma.replayDelivery.count({ where: { syncRun: { replayPlanId: first.replayPlanId } } })).toBe(1);
    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
  });

  it("recovers only the undelivered BullMQ unit after partial enqueue and service restart", async () => {
    const prefix = `delivery-restart-${process.pid}`;
    const bull = createBullReplayEnqueuer(redisUrl, prisma, prefix);
    const attemptedJobIds: string[] = [];
    let failSecond = true;
    const faultingEnqueuer = {
      async enqueue(run: Parameters<typeof bull.enqueue>[0]) {
        attemptedJobIds.push(`${run.logicalId}-${run.revision}`);
        if (failSecond && attemptedJobIds.length === 2) {
          failSecond = false;
          throw new Error("redis raw secret must not escape");
        }
        await bull.enqueue(run);
      },
    };
    const service = createReplayService({ database: prisma, enqueuer: faultingEnqueuer });
    const preview = await service.preview({ ...request, from: "2026-08-07T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z" }, "integration-operator");
    await expect(service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion })).rejects.toMatchObject({ code: "QUEUE_DELIVERY_FAILED" });
    const plan = await prisma.replayPlan.findUniqueOrThrow({ where: { previewId: preview.previewId } });
    expect(await service.status(plan.id)).toMatchObject({
      delivery: { state: "RETRYING", delivered: 1, retrying: 1 },
      execution: { state: "PENDING" },
    });
    expect(JSON.stringify(await service.status(plan.id))).not.toContain("redis raw secret");

    const recoveryEnqueuer = {
      async enqueue(run: Parameters<typeof bull.enqueue>[0]) {
        attemptedJobIds.push(`${run.logicalId}-${run.revision}`);
        await bull.enqueue(run);
      },
    };
    const restarted = createReplayService({ database: prisma, enqueuer: recoveryEnqueuer });
    await restarted.dispatchDeliveries(plan.id);
    const recoveredDeliveries = await prisma.replayDelivery.findMany({ where: { syncRun: { replayPlanId: plan.id } } });
    expect(recoveredDeliveries).toEqual(recoveredDeliveries.map(() => expect.objectContaining({
      state: "DELIVERED",
      classifiedReason: null,
    })));
    expect(recoveredDeliveries.map((delivery) => delivery.attemptCount).sort()).toEqual([1, 2]);
    expect(attemptedJobIds).toHaveLength(3);
    expect(attemptedJobIds[1]).toBe(attemptedJobIds[2]);

    const executions = new Map<string, number>();
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix, execute: async (data, context) => {
      executions.set(data.logicalId, (executions.get(data.logicalId) ?? 0) + 1);
      await context.publish(async () => undefined);
    } });
    try {
      for (let poll = 0; poll < 100 && (await restarted.status(plan.id)).state !== "SUCCEEDED"; poll += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      expect([...executions.values()].sort()).toEqual([1, 1]);
      await restarted.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
      expect(attemptedJobIds).toHaveLength(3);
      expect(await restarted.status(plan.id)).toMatchObject({
        delivery: { state: "DELIVERED", delivered: 2, retrying: 0, pending: 0 },
        execution: { state: "SUCCEEDED" },
      });
    } finally {
      await worker.close();
      await bull.close();
    }
  }, 30_000);

  it("serializes concurrent dispatchers and reclaims an expired delivery lease", async () => {
    const seed = createReplayService({ database: prisma });
    const preview = await seed.preview({ ...request, from: "2026-08-09T00:00:00.000Z", to: "2026-08-09T00:00:00.000Z" }, "integration-operator");
    const queued = await seed.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    let enqueues = 0;
    const enqueuer = { async enqueue() { enqueues += 1; await new Promise((resolveWait) => setTimeout(resolveWait, 75)); } };
    const firstDispatcher = createReplayService({ database: prisma, enqueuer });
    const secondDispatcher = createReplayService({ database: prisma, enqueuer });
    await Promise.all([
      firstDispatcher.dispatchDeliveries(queued.replayPlanId),
      secondDispatcher.dispatchDeliveries(queued.replayPlanId),
    ]);
    expect(enqueues).toBe(1);

    const expiredPreview = await seed.preview({ ...request, from: "2026-08-13T00:00:00.000Z", to: "2026-08-13T00:00:00.000Z" }, "integration-operator");
    const expired = await seed.queue({ previewId: expiredPreview.previewId, previewVersion: expiredPreview.previewVersion });
    await prisma.$executeRawUnsafe(
      `UPDATE "ReplayDelivery" d SET state='CLAIMED',"attemptCount"=1,"leaseToken"=$2,"leaseExpiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second',"updatedAt"=CURRENT_TIMESTAMP
       FROM "SyncRun" r WHERE d."syncRunId"=r.id AND r."replayPlanId"=$1`,
      expired.replayPlanId,
      "expired-process-lease",
    );
    const reconstructed = createReplayService({ database: prisma, enqueuer });
    await reconstructed.dispatchDeliveries(expired.replayPlanId);
    expect(await prisma.replayDelivery.findFirstOrThrow({ where: { syncRun: { replayPlanId: expired.replayPlanId } } })).toMatchObject({
      state: "DELIVERED",
      attemptCount: 2,
      classifiedReason: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
  });

  it("requires audited reason and rejects zero headroom", async () => {
    const policyNow = new Date("2026-09-30T17:00:00.000Z");
    await prisma.providerCircuitState.update({
      where: { provider_endpointFamily: { provider: resultsPolicy.provider, endpointFamily: resultsPolicy.endpointFamily } },
      data: { state: "CLOSED", openedAt: null, updatedAt: policyNow },
    });
    const zeroHeadroom = createReplayProviderPolicyRepository({
      database: prisma,
      policies: [{ ...resultsPolicy, configuredAllowance: 0, criticalHeadroom: 0 }],
      now: () => policyNow,
    });
    await expect(createReplayService({ database: prisma, providerPolicyRepository: zeroHeadroom, now: () => policyNow }).preview({ ...request, from: "2026-08-10T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z" }, "integration-operator")).rejects.toMatchObject({ code: "ALLOWANCE_EXHAUSTED" });
    const service = createReplayService({ database: prisma });
    const preview = await service.preview({ ...request, from: "2026-08-11T00:00:00.000Z", to: "2026-08-11T00:00:00.000Z" }, "integration-operator");
    await expect(service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion, newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });

  it("returns disclosure-safe HTTP validation codes for replay and evidence", async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.OPERATOR_CREDENTIAL = "http-boundary-credential";
    const app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const secret = "postgresql://operator:password@private.example/database";
    try {
      const replay = await fetch(`${origin}/internal/pipeline/replay/preview`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-operator-credential": "http-boundary-credential", "x-operator-actor": "integration-operator" },
        body: JSON.stringify({ ...request, provider: secret }),
      });
      expect(replay.status).toBe(400);
      const replayBody = await replay.json();
      expect(replayBody).toEqual({ code: "NOT_ALLOWED" });

      const reason = await fetch(`${origin}/internal/pipeline/replay/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-operator-credential": "http-boundary-credential", "x-operator-actor": "integration-operator" },
        body: JSON.stringify({ newRevision: true, reason: "" }),
      });
      expect(reason.status).toBe(400);
      const reasonBody = await reason.json();
      expect(reasonBody).toEqual({ code: "REVISION_REASON_REQUIRED" });

      const evidence = await fetch(`${origin}/teams/%20/evidence?asOf=${encodeURIComponent(secret)}`);
      expect(evidence.status).toBe(400);
      const evidenceBody = await evidence.json();
      expect(evidenceBody).toEqual({ code: "INVALID_AS_OF" });
      expect(JSON.stringify([replayBody, reasonBody, evidenceBody])).not.toContain(secret);
    } finally {
      await app.close();
    }
  });

  it("keeps replay endpoints guarded and exposes only classified state", async () => {
    const guard = new OperatorGuard("operator-secret");
    expect(() => guard.authorize("wrong-secret")).toThrowError("Not found");
    const service = createReplayService({ database: prisma });
    const controller = new ReplayController(service as never);
    const preview = await controller.preview({ ...request, from: "2026-08-12T00:00:00.000Z", to: "2026-08-12T00:00:00.000Z" }, { operator: { actor: "integration-operator" } });
    const queued = await controller.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    const status = await controller.status(queued.replayPlanId);
    expect(status).toMatchObject({ state: "QUEUED", outcome: "PENDING", lane: "critical" });
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
      state: "PENDING",
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
      logicalKey: `${logicalId}:replay`,
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

  it("rejects stale failure after the execution lease expires", async () => {
    const logicalId = `expired-fail-${randomUUID()}`;
    const replayPlan = await prisma.replayPlan.create({ data: {
      logicalKey: logicalId, revision: 1, provider: request.provider,
      competitionId: request.competitionId, endpointFamily: request.endpointFamily,
      windowFrom: new Date(request.from), windowTo: new Date(request.to),
      previewVersion: randomUUID(), actor: "integration-test",
    } });
    const run = await prisma.syncRun.create({ data: {
      logicalKey: `${logicalId}:replay`, revision: 1, provider: request.provider,
      endpointFamily: request.endpointFamily, lane: "standard",
      windowFrom: new Date(request.from), windowTo: new Date(request.to),
      correlationId: randomUUID(), replayPlanId: replayPlan.id,
    } });
    const claim = await claimReplayExecution(prisma, {
      syncRunId: run.id, replayPlanId: replayPlan.id, logicalId, revision: 1,
    }, { leaseMs: 100, heartbeatMs: 10, deadlineMs: 100 });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("expected claim");
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    await expect(claim.context.fail("PROVIDER_TIMEOUT", true)).resolves.toBe(false);
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ state: "RUNNING" });
    expect(await prisma.syncAttempt.findFirstOrThrow({ where: { syncRunId: run.id } })).toMatchObject({ state: "RUNNING", classifiedReason: null });
  });

  it("terminalizes an exhausted pending run inside the claim transaction", async () => {
    const logicalId = `exhausted-pending-${randomUUID()}`;
    const replayPlan = await prisma.replayPlan.create({ data: {
      logicalKey: logicalId, revision: 1, provider: request.provider,
      competitionId: request.competitionId, endpointFamily: request.endpointFamily,
      windowFrom: new Date(request.from), windowTo: new Date(request.to),
      previewVersion: randomUUID(), actor: "integration-test",
    } });
    const run = await prisma.syncRun.create({ data: {
      logicalKey: `${logicalId}:replay`, revision: 1, provider: request.provider,
      endpointFamily: request.endpointFamily, lane: "standard",
      windowFrom: new Date(request.from), windowTo: new Date(request.to),
      correlationId: randomUUID(), replayPlanId: replayPlan.id,
    } });
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      await prisma.syncAttempt.create({ data: {
        syncRunId: run.id, attemptNumber, state: "FAILED", startedAt: new Date(),
        finishedAt: new Date(), classifiedReason: "PROVIDER_TIMEOUT",
      } });
    }
    await expect(claimReplayExecution(prisma, {
      syncRunId: run.id, replayPlanId: replayPlan.id, logicalId, revision: 1,
    })).resolves.toEqual({ status: "exhausted" });
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ state: "FAILED", terminalAt: expect.any(Date) });
    expect(await prisma.syncAttempt.count({ where: { syncRunId: run.id } })).toBe(3);
  });

  it("uses a real BullMQ worker for terminal, duplicate, retry and dead-letter lifecycle", async () => {
    const prefix = `replay-${process.pid}`; const executions = new Map<string, number>();
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix, execute: async (data, context) => {
      executions.set(data.logicalId, (executions.get(data.logicalId) ?? 0) + 1);
      if (data.input.seasonId === "fail") throw Object.assign(new Error("provider"), { code: "PROVIDER_TIMEOUT" });
      await context.publish(async () => undefined);
    } });
    const queue = createReplayQueue({ redisUrl, prefix, database: prisma });
    const service = createReplayService({ database: prisma, enqueuer: queue });
    const preview = await service.preview({ ...request, seasonId: "success", from: "2026-08-20T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" }, "integration-operator");
    const queued = await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    for (let i = 0; i < 80 && (await service.status(queued.replayPlanId)).state !== "SUCCEEDED"; i += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(await service.status(queued.replayPlanId)).toMatchObject({ state: "SUCCEEDED", outcome: "COMPLETED", attempts: [{ state: "SUCCEEDED", attemptNumber: 1 }] });
    await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    expect([...executions.values()]).toEqual([1]);

    const failedPreview = await service.preview({ ...request, seasonId: "fail", from: "2026-08-21T00:00:00.000Z", to: "2026-08-21T00:00:00.000Z" }, "integration-operator");
    const failed = await service.queue({ previewId: failedPreview.previewId, previewVersion: failedPreview.previewVersion });
    for (let i = 0; i < 120 && (await service.status(failed.replayPlanId)).state !== "FAILED"; i += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(await service.status(failed.replayPlanId)).toMatchObject({ state: "FAILED", outcome: "DEAD_LETTER", attempts: [{ classifiedReason: "PROVIDER_TIMEOUT" }, { classifiedReason: "PROVIDER_TIMEOUT" }, { classifiedReason: "PROVIDER_TIMEOUT" }] });
    await worker.close(); await queue.close();
  }, 30_000);
});
