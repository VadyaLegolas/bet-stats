import type { JobsOptions, Processor } from "bullmq";

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
