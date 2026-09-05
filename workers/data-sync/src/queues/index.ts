import { Queue, Worker, UnrecoverableError, type Job, type JobsOptions, type Processor } from "bullmq";
import type { PrismaClient } from "@bet-stats/database";
import { claimReplayExecution, type ReplayExecutionContext, type ReplayExecutionLeaseOptions } from "./replay-execution.js";

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
  execute: (data: ReplayJobData, context: ReplayExecutionContext) => Promise<void>;
  concurrency?: number;
  executionLease?: Partial<ReplayExecutionLeaseOptions>;
}) {
  const worker = new Worker<ReplayJobData>(standardQueue(input.prefix), async (job: Job<ReplayJobData>) => {
    let claim = await claimReplayExecution(input.database, job.data, input.executionLease);
    while (claim.status === "wait") {
      const delay = Math.max(100, Math.min(1_000, claim.retryAt.getTime() - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, delay));
      claim = await claimReplayExecution(input.database, job.data, input.executionLease);
    }
    if (claim.status === "terminal") return { duplicate: true, terminal: claim.state };
    if (claim.status === "exhausted") throw new UnrecoverableError("EXECUTION_ATTEMPTS_EXHAUSTED");
    const context = claim.context;
    let published = false;
    const executionContext: ReplayExecutionContext = { ...context, publish: async (writer, manifest) => { await context.publish(writer, manifest); published = true; } };
    const heartbeat = setInterval(() => { void context.heartbeat(); }, input.executionLease?.heartbeatMs ?? 5_000);

    try {
      await input.execute(job.data, executionContext);
      if (!published) throw Object.assign(new Error("REPLAY_PUBLICATION_INCOMPLETE"), { code: "REPLAY_PUBLICATION_INCOMPLETE" });
    } catch (error) {
      const reason = classifyFailure(error);
      const nonRetryable = reason === "FIXTURE_SCOPE_MISMATCH" || reason === "INVALID_FIXTURE_SCOPE";
      await context.fail(reason, !nonRetryable);
      if (nonRetryable) throw new UnrecoverableError(reason);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
    return { duplicate: false };
  }, { connection: redisConnection(input.redisUrl), concurrency: input.concurrency ?? 2, maxStalledCount: 3 });
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
