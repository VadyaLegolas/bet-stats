import { Queue, Worker, UnrecoverableError, type Job, type JobsOptions, type Processor } from "bullmq";
import type { PrismaClient } from "@bet-stats/database";
import { claimReplayExecution, type ReplayExecutionContext, type ReplayExecutionLeaseOptions } from "./replay-execution.js";
import type { BacktestPlanReceipt } from "../jobs/backtests.js";

export type SyncLane = "critical" | "standard" | "optional";
export type CriticalJobName = "fixtures" | "results";

export const criticalQueue = (prefix = "bet-stats") => `${prefix}-sync-critical`;
export const standardQueue = (prefix = "bet-stats") => `${prefix}-sync-standard`;
export const optionalQueue = (prefix = "bet-stats") => `${prefix}-sync-optional`;

export const SYNC_MAX_ATTEMPTS = 3;
export const SETTLEMENT_MAX_ATTEMPTS = 3;
export const BACKTEST_MAX_ATTEMPTS = 3;
export const ENRICHMENT_MAX_ATTEMPTS = 2;

export type EnrichmentEndpoint = "LINEUPS" | "INJURIES" | "ODDS" | "STATISTICS";
export interface EnrichmentJobData { fixtureId: string; endpoint: EnrichmentEndpoint; cutoff: string; policyVersion: string }

export function createEnrichmentJobId(data: EnrichmentJobData): string {
  return `${data.policyVersion}:${data.fixtureId}:${data.endpoint}:${data.cutoff}`;
}

export function createEnrichmentSchedule(input: { fixtureId: string; kickoffUtc: string; policyVersion: string }): EnrichmentJobData[] {
  const kickoff = new Date(input.kickoffUtc);
  if (Number.isNaN(kickoff.getTime())) throw new Error("INVALID_ENRICHMENT_KICKOFF");
  const cutoff = new Date(kickoff.getTime() - 60 * 60_000).toISOString();
  return (["LINEUPS", "INJURIES", "ODDS", "STATISTICS"] as const).map((endpoint) => ({ fixtureId: input.fixtureId, endpoint, cutoff, policyVersion: input.policyVersion }));
}

export function createEnrichmentQueue(input: { redisUrl: string; prefix?: string }) {
  const queue = new Queue<EnrichmentJobData>(optionalQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  return {
    enqueue: (data: EnrichmentJobData) => queue.add(data.endpoint.toLowerCase(), data, { attempts: ENRICHMENT_MAX_ATTEMPTS, backoff: { type: "exponential", delay: 1_000, jitter: 0.25 }, removeOnComplete: { age: 86_400, count: 1_000 }, removeOnFail: { age: 604_800, count: 5_000 }, jobId: createEnrichmentJobId(data).replaceAll(":", "-") }),
    close: () => queue.close(),
  };
}

export interface BacktestJobData { planId: string; planHash: string; correlationId: string }
export function backtestQueue(prefix = "bet-stats"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-backtest`;
}
export function createBacktestQueue(input: { redisUrl: string; prefix?: string }) {
  const queue = new Queue<BacktestJobData>(backtestQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  return {
    enqueue: (data: BacktestJobData) => queue.add("rolling-origin", data, { attempts: BACKTEST_MAX_ATTEMPTS, backoff: { type: "exponential", delay: 1_000, jitter: 0.25 }, removeOnComplete: { age: 86_400, count: 1_000 }, removeOnFail: { age: 604_800, count: 5_000 }, jobId: `backtest-${data.planId}-${data.planHash}` }),
    close: () => queue.close(),
  };
}
export function createBacktestWorker(input: { redisUrl: string; prefix?: string; loadPlan: (id: string) => Promise<BacktestPlanReceipt | null>; execute: (plan: BacktestPlanReceipt, data: BacktestJobData) => Promise<unknown> }) {
  return new Worker<BacktestJobData>(backtestQueue(input.prefix), async (job) => {
    const data = job.data;
    if (!data || typeof data.planId !== "string" || typeof data.planHash !== "string" || typeof data.correlationId !== "string") throw new UnrecoverableError("INVALID_BACKTEST_JOB");
    const plan = await input.loadPlan(data.planId);
    if (!plan) throw new UnrecoverableError("BACKTEST_PLAN_NOT_FOUND");
    if (plan.planHash !== data.planHash) throw new UnrecoverableError("BACKTEST_PLAN_HASH_MISMATCH");
    return input.execute(plan, data);
  }, { connection: redisConnection(input.redisUrl), concurrency: 1, maxStalledCount: 2, lockDuration: 60_000 });
}

export interface SettlementJobData {
  fixtureId: string;
  resultVersionId: string;
  forecastSnapshotId: string;
  policyVersion: string;
  policyHash: string;
  correlationId: string;
}

export function settlementQueue(prefix = "bet-stats"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-settlement`;
}

export function createSettlementJobId(data: SettlementJobData): string {
  return `settlement:${data.resultVersionId}:${data.policyHash}:${data.forecastSnapshotId}`;
}

export function createSettlementQueue(input: { redisUrl: string; prefix?: string }) {
  const queue = new Queue<SettlementJobData>(settlementQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  return {
    enqueue: (data: SettlementJobData) => queue.add("settlement", data, {
      attempts: SETTLEMENT_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
      jobId: createSettlementJobId(data).replaceAll(":", "-"),
    }),
    close: () => queue.close(),
  };
}

export function createSettlementWorker(input: { redisUrl: string; prefix?: string; execute: (data: SettlementJobData) => Promise<unknown> }) {
  return new Worker<SettlementJobData>(settlementQueue(input.prefix), (job) => input.execute(job.data), {
    connection: redisConnection(input.redisUrl), concurrency: 2, maxStalledCount: 2, lockDuration: 30_000,
  });
}

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

const UNRECOVERABLE_REPLAY_REASONS = new Set([
  "FIXTURE_SCOPE_MISMATCH",
  "IDENTITY_UNRESOLVED",
  "INVALID_FIXTURE_SCOPE",
  "INVALID_REPLAY_WINDOW",
  "MALFORMED_POLICY",
  "REPLAY_POLICY_CHANGED",
  "RUN_NOT_FOUND",
  "UNSUPPORTED_REPLAY_ENDPOINT",
]);

export function isUnrecoverableReplayFailure(reason: string): boolean {
  return UNRECOVERABLE_REPLAY_REASONS.has(reason);
}

async function reconcileFailedDelivery(database: PrismaClient, data: ReplayJobData, maxClaims = SYNC_MAX_ATTEMPTS): Promise<void> {
  const attempts = await database.syncAttempt.count({ where: { syncRunId: data.syncRunId } });
  if (attempts < maxClaims) return;
  await claimReplayExecution(database, data, { maxClaims });
}

export function createReplayWorker(input: {
  redisUrl: string;
  database: PrismaClient;
  prefix?: string;
  execute: (data: ReplayJobData, context: ReplayExecutionContext) => Promise<void>;
  concurrency?: number;
  executionLease?: Partial<ReplayExecutionLeaseOptions>;
  lockDuration?: number;
  stalledInterval?: number;
}) {
  const worker = new Worker<ReplayJobData>(standardQueue(input.prefix), async (job: Job<ReplayJobData>) => {
    let claim;
    try {
      claim = await claimReplayExecution(input.database, job.data, input.executionLease);
    } catch (error) {
      const reason = classifyFailure(error);
      if (isUnrecoverableReplayFailure(reason)) throw new UnrecoverableError(reason);
      throw error;
    }
    while (claim.status === "wait") {
      const delay = Math.max(100, Math.min(1_000, claim.retryAt.getTime() - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        claim = await claimReplayExecution(input.database, job.data, input.executionLease);
      } catch (error) {
        const reason = classifyFailure(error);
        if (isUnrecoverableReplayFailure(reason)) throw new UnrecoverableError(reason);
        throw error;
      }
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
      const nonRetryable = isUnrecoverableReplayFailure(reason);
      await context.fail(reason, !nonRetryable);
      if (nonRetryable) throw new UnrecoverableError(reason);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
    return { duplicate: false };
  }, { connection: redisConnection(input.redisUrl), concurrency: input.concurrency ?? 2, maxStalledCount: 3, lockDuration: input.lockDuration ?? 30_000, stalledInterval: input.stalledInterval ?? 30_000 });
  const inspector = new Queue<ReplayJobData>(standardQueue(input.prefix), { connection: redisConnection(input.redisUrl) });
  const reconcile = async () => {
    const pageSize = 100;
    for (let start = 0; ; start += pageSize) {
      const failed = await inspector.getFailed(start, start + pageSize - 1);
      await Promise.all(failed.map((job) => reconcileFailedDelivery(input.database, job.data, job.opts.attempts ?? SYNC_MAX_ATTEMPTS)));
      if (failed.length < pageSize) break;
    }
  };
  const scheduleReconcile = () => { void reconcile().catch(() => undefined); };
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void reconcileFailedDelivery(input.database, job.data, job.opts.attempts ?? SYNC_MAX_ATTEMPTS).catch(() => undefined);
  });
  scheduleReconcile();
  const reconciliationTimer = setInterval(scheduleReconcile, 5_000);
  const closeWorker = worker.close.bind(worker);
  worker.close = async (force?: boolean) => { clearInterval(reconciliationTimer); await inspector.close(); await closeWorker(force); };
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
