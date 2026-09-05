import { Queue, Worker, UnrecoverableError, type Job, type JobsOptions, type Processor } from "bullmq";
import type { PrismaClient } from "@bet-stats/database";

export type SyncLane = "critical" | "standard" | "optional";
export type CriticalJobName = "fixtures" | "results";

export const criticalQueue = (prefix = "bet-stats") => `${prefix}-sync-critical`;
export const standardQueue = (prefix = "bet-stats") => `${prefix}-sync-standard`;
export const optionalQueue = (prefix = "bet-stats") => `${prefix}-sync-optional`;

export const SYNC_MAX_ATTEMPTS = 3;

export function createSyncJobOptions(_name: CriticalJobName): JobsOptions {
  return {
    attempts: SYNC_MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  };
}

export interface WorkerRegistration {
  queue: string;
  name: CriticalJobName;
  handler: Processor;
  concurrency: number;
}

export interface SyncWorkerHandle { close(): Promise<void> }

export interface ReplayJobData {
  syncRunId: string;
  replayPlanId: string;
  logicalId: string;
  revision: number;
  input: { provider: string; competitionId: string; seasonId: string; endpointFamily: string; from: string; to: string };
  unit: { logicalId: string; from: string; to: string };
}

export function redisConnection(redisUrl: string) { return { url: redisUrl, maxRetriesPerRequest: null as null }; }

export function createReplayQueue(input: { redisUrl: string; prefix?: string; database?: PrismaClient }) {
  const queue = new Queue(standardQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  return {
    async enqueue(data: ReplayJobData) {
      try {
        await queue.add(data.input.endpointFamily.toLowerCase(), data, { ...createSyncJobOptions("results"), jobId: `${data.logicalId}-${data.revision}` });
      } catch (error) {
        if (input.database) await input.database.$executeRawUnsafe(`UPDATE "SyncRun" SET "completionManifest"=jsonb_set("completionManifest",'{delivery}',to_jsonb('RETRYABLE'::text),true) WHERE id=$1 AND state='PENDING'`, data.syncRunId);
        throw Object.assign(new Error("QUEUE_DELIVERY_FAILED"), { code: "QUEUE_DELIVERY_FAILED", cause: error });
      }
    },
    close: () => queue.close(),
  };
}

function classifyFailure(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : "PROVIDER_FAILURE";
}

export function createReplayWorker(input: {
  redisUrl: string;
  database: PrismaClient;
  prefix?: string;
  execute: (data: ReplayJobData) => Promise<void>;
  concurrency?: number;
}) {
  const worker = new Worker<ReplayJobData>(standardQueue(input.prefix), async (job: Job<ReplayJobData>) => {
    const attemptNumber = job.attemptsMade + 1;
    const claimed = await input.database.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; replayPlanId: string | null; state: string }>>(
        `SELECT id, "replayPlanId", state FROM "SyncRun" WHERE id=$1 FOR UPDATE`,
        job.data.syncRunId,
      );
      const current = rows[0];
      if (!current || current.replayPlanId !== job.data.replayPlanId) {
        throw Object.assign(new Error("RUN_NOT_FOUND"), { code: "RUN_NOT_FOUND" });
      }
      if (current.state !== "PENDING") return false;
      const transition = await tx.syncRun.updateMany({
        where: { id: current.id, state: "PENDING" },
        data: { state: "RUNNING" },
      });
      if (transition.count !== 1) return false;
      await tx.syncAttempt.create({ data: { syncRunId: current.id, attemptNumber, state: "RUNNING" } });
      return true;
    });
    if (!claimed) return { duplicate: true };

    try {
      await input.execute(job.data);
    } catch (error) {
      const reason = classifyFailure(error);
      const nonRetryable = reason === "FIXTURE_SCOPE_MISMATCH" || reason === "INVALID_FIXTURE_SCOPE";
      const exhausted = nonRetryable || attemptNumber >= SYNC_MAX_ATTEMPTS;
      await input.database.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe<Array<{ state: string }>>(
          `SELECT state FROM "SyncRun" WHERE id=$1 FOR UPDATE`,
          job.data.syncRunId,
        );
        if (locked[0]?.state !== "RUNNING") return;
        const finishedAt = new Date();
        const attempt = await tx.syncAttempt.updateMany({
          where: { syncRunId: job.data.syncRunId, attemptNumber, state: "RUNNING", finishedAt: null },
          data: { state: "FAILED", classifiedReason: reason, finishedAt },
        });
        if (attempt.count !== 1) throw Object.assign(new Error("ATTEMPT_NOT_RUNNING"), { code: "ATTEMPT_NOT_RUNNING" });
        const run = await tx.syncRun.updateMany({
          where: { id: job.data.syncRunId, state: "RUNNING" },
          data: { state: exhausted ? "FAILED" : "PENDING", terminalAt: exhausted ? finishedAt : null },
        });
        if (run.count !== 1) throw Object.assign(new Error("RUN_NOT_RUNNING"), { code: "RUN_NOT_RUNNING" });
      });
      if (nonRetryable) throw new UnrecoverableError(reason);
      throw error;
    }

    await input.database.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ state: string }>>(
        `SELECT state FROM "SyncRun" WHERE id=$1 FOR UPDATE`,
        job.data.syncRunId,
      );
      if (locked[0]?.state !== "RUNNING") {
        throw Object.assign(new Error("RUN_NOT_RUNNING"), { code: "RUN_NOT_RUNNING" });
      }
      const finishedAt = new Date();
      const attempt = await tx.syncAttempt.updateMany({
        where: { syncRunId: job.data.syncRunId, attemptNumber, state: "RUNNING", finishedAt: null },
        data: { state: "SUCCEEDED", finishedAt },
      });
      if (attempt.count !== 1) throw Object.assign(new Error("ATTEMPT_NOT_RUNNING"), { code: "ATTEMPT_NOT_RUNNING" });
      const run = await tx.syncRun.updateMany({
        where: { id: job.data.syncRunId, state: "RUNNING" },
        data: {
          state: "SUCCEEDED",
          completedUnits: 1,
          completedCaptures: 1,
          terminalAt: finishedAt,
          completionManifest: {
            expectedUnits: [job.data.logicalId],
            completedUnits: [job.data.logicalId],
            expectedCaptures: [job.data.logicalId],
            completedCaptures: [job.data.logicalId],
            delivery: "DELIVERED",
          },
        },
      });
      if (run.count !== 1) throw Object.assign(new Error("RUN_NOT_RUNNING"), { code: "RUN_NOT_RUNNING" });
    });
    return { duplicate: false };
  }, { connection: redisConnection(input.redisUrl), concurrency: input.concurrency ?? 2, maxStartedAttempts: SYNC_MAX_ATTEMPTS });
  return worker;
}

export function createSyncWorkers(input: {
  prefix?: string;
  handlers: Record<CriticalJobName, Processor>;
  register: (registration: WorkerRegistration) => SyncWorkerHandle;
}): SyncWorkerHandle[] {
  const queue = criticalQueue(input.prefix);
  return (["fixtures", "results"] as const).map((name) => input.register({
    queue,
    name,
    handler: input.handlers[name],
    concurrency: 2,
  }));
}
