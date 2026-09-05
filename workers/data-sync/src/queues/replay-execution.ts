import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@bet-stats/database";

export const DEFAULT_REPLAY_EXECUTION_LEASE = Object.freeze({ leaseMs: 30_000, heartbeatMs: 5_000, deadlineMs: 120_000, maxClaims: 3 });
export interface ReplayExecutionLeaseOptions { leaseMs: number; heartbeatMs: number; deadlineMs: number; maxClaims: number }
type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type ReplayExecutionClaim =
  | { status: "claimed"; context: ReplayExecutionContext }
  | { status: "wait"; retryAt: Date }
  | { status: "terminal"; state: string }
  | { status: "exhausted" };

export interface ReplayExecutionContext {
  readonly syncRunId: string;
  readonly token: string;
  readonly attemptNumber: number;
  heartbeat(): Promise<boolean>;
  assertOwner(): Promise<void>;
  admitRequest<T>(operation: (transaction: Tx) => Promise<T>): Promise<T>;
  publish(writer: (transaction: Tx) => Promise<void>, manifest?: unknown): Promise<void>;
  fail(reason: string, retryable: boolean): Promise<boolean>;
}

interface LockedRun { id: string; logicalKey: string; revision: number; replayPlanId: string | null; state: string; executionLeaseToken: string | null; executionLeaseExpiresAt: Date | null; executionDeadlineAt: Date | null; now: Date }

function validateOptions(input?: Partial<ReplayExecutionLeaseOptions>): ReplayExecutionLeaseOptions {
  const options = { ...DEFAULT_REPLAY_EXECUTION_LEASE, ...input };
  if (![options.leaseMs, options.heartbeatMs, options.deadlineMs, options.maxClaims].every(Number.isSafeInteger)
    || options.heartbeatMs <= 0 || options.leaseMs <= options.heartbeatMs || options.deadlineMs < options.leaseMs || options.maxClaims <= 0) {
    throw new Error("INVALID_EXECUTION_LEASE_CONFIGURATION");
  }
  return options;
}

async function lockRun(tx: Tx, id: string): Promise<LockedRun | undefined> {
  return (await tx.$queryRawUnsafe<LockedRun[]>(`SELECT id, "logicalKey", revision, "replayPlanId", state, "executionLeaseToken", "executionLeaseExpiresAt", "executionDeadlineAt", clock_timestamp() AS now FROM "SyncRun" WHERE id=$1 FOR UPDATE`, id))[0];
}

export async function claimReplayExecution(database: Db, job: { syncRunId: string; replayPlanId: string; logicalId: string; revision: number }, configuration?: Partial<ReplayExecutionLeaseOptions>): Promise<ReplayExecutionClaim> {
  const options = validateOptions(configuration);
  return database.$transaction(async (tx) => {
    const run = await lockRun(tx, job.syncRunId);
    const persistedLogicalKey = `${job.logicalId}:replay`;
    if (!run || run.replayPlanId !== job.replayPlanId || run.logicalKey !== persistedLogicalKey || run.revision !== job.revision) throw Object.assign(new Error("RUN_NOT_FOUND"), { code: "RUN_NOT_FOUND" });
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.state)) return { status: "terminal", state: run.state } as const;
    if (run.state === "RUNNING" && run.executionLeaseExpiresAt && run.executionLeaseExpiresAt > run.now && run.executionDeadlineAt && run.executionDeadlineAt > run.now) return { status: "wait", retryAt: run.executionLeaseExpiresAt } as const;

    const attempts = await tx.$queryRawUnsafe<Array<{ attemptNumber: number; state: string }>>(`SELECT "attemptNumber", state FROM "SyncAttempt" WHERE "syncRunId"=$1 ORDER BY "attemptNumber" DESC FOR UPDATE`, run.id);
    if (run.state === "RUNNING") {
      await tx.$executeRawUnsafe(`UPDATE "SyncAttempt" SET state='FAILED', "classifiedReason"='WORKER_LEASE_EXPIRED', "finishedAt"=clock_timestamp() WHERE "syncRunId"=$1 AND state='RUNNING'`, run.id);
    }
    if (attempts.length >= options.maxClaims) {
      if (run.state === "PENDING") {
        const exhaustionToken = randomUUID();
        await tx.$executeRawUnsafe(`UPDATE "SyncRun" SET state='RUNNING', "executionLeaseToken"=$2, "executionLeaseExpiresAt"=clock_timestamp(), "executionDeadlineAt"=clock_timestamp() WHERE id=$1 AND state='PENDING'`, run.id, exhaustionToken);
      }
      await tx.$executeRawUnsafe(`UPDATE "SyncRun" SET state='FAILED', "terminalAt"=clock_timestamp(), "executionLeaseToken"=NULL, "executionLeaseExpiresAt"=NULL, "executionDeadlineAt"=NULL WHERE id=$1 AND state='RUNNING'`, run.id);
      return { status: "exhausted" } as const;
    }
    const attemptNumber = (attempts[0]?.attemptNumber ?? 0) + 1;
    const token = randomUUID();
    await tx.$executeRawUnsafe(`UPDATE "SyncRun" SET state='RUNNING', "executionLeaseToken"=$2, "executionLeaseExpiresAt"=clock_timestamp()+($3::int*interval '1 millisecond'), "executionDeadlineAt"=clock_timestamp()+($4::int*interval '1 millisecond') WHERE id=$1`, run.id, token, options.leaseMs, options.deadlineMs);
    await tx.$executeRawUnsafe(`INSERT INTO "SyncAttempt" (id,"syncRunId","attemptNumber",state,"startedAt") VALUES ($1,$2,$3,'RUNNING',clock_timestamp())`, randomUUID(), run.id, attemptNumber);
    return { status: "claimed", context: createReplayExecutionContext(database, run.id, token, attemptNumber, options) } as const;
  });
}

export function createReplayExecutionContext(database: Db, syncRunId: string, token: string, attemptNumber: number, configuration?: Partial<ReplayExecutionLeaseOptions>): ReplayExecutionContext {
  const options = validateOptions(configuration);
  const assertOwner = async () => {
    const rows = await database.$queryRawUnsafe<Array<{ owned: boolean }>>(`SELECT EXISTS(SELECT 1 FROM "SyncRun" WHERE id=$1 AND state='RUNNING' AND "executionLeaseToken"=$2 AND "executionLeaseExpiresAt">clock_timestamp() AND "executionDeadlineAt">clock_timestamp()) AS owned`, syncRunId, token);
    if (!rows[0]?.owned) throw Object.assign(new Error("EXECUTION_LEASE_LOST"), { code: "EXECUTION_LEASE_LOST" });
  };
  return {
    syncRunId, token, attemptNumber, assertOwner,
    async admitRequest(operation) {
      return database.$transaction(async (tx) => {
        const run = await lockRun(tx, syncRunId);
        if (!run || run.state !== "RUNNING" || run.executionLeaseToken !== token || !run.executionLeaseExpiresAt || run.executionLeaseExpiresAt <= run.now || !run.executionDeadlineAt || run.executionDeadlineAt <= run.now) throw Object.assign(new Error("EXECUTION_LEASE_LOST"), { code: "EXECUTION_LEASE_LOST" });
        return operation(tx);
      });
    },
    async heartbeat() {
      const changed = await database.$executeRawUnsafe(`UPDATE "SyncRun" SET "executionLeaseExpiresAt"=LEAST(clock_timestamp()+($3::int*interval '1 millisecond'),"executionDeadlineAt") WHERE id=$1 AND state='RUNNING' AND "executionLeaseToken"=$2 AND "executionLeaseExpiresAt">clock_timestamp() AND "executionDeadlineAt">clock_timestamp()`, syncRunId, token, options.leaseMs);
      return changed === 1;
    },
    async publish(writer, manifest) {
      await database.$transaction(async (tx) => {
        const run = await lockRun(tx, syncRunId);
        if (!run || run.state !== "RUNNING" || run.executionLeaseToken !== token || !run.executionLeaseExpiresAt || run.executionLeaseExpiresAt <= run.now || !run.executionDeadlineAt || run.executionDeadlineAt <= run.now) throw Object.assign(new Error("EXECUTION_LEASE_LOST"), { code: "EXECUTION_LEASE_LOST" });
        await writer(tx);
        await tx.$executeRawUnsafe(`UPDATE "SyncAttempt" SET state='SUCCEEDED',"finishedAt"=clock_timestamp() WHERE "syncRunId"=$1 AND "attemptNumber"=$2 AND state='RUNNING'`, syncRunId, attemptNumber);
        await tx.$executeRawUnsafe(`UPDATE "SyncRun" SET state='SUCCEEDED',"completedUnits"="expectedUnits","completedCaptures"="expectedCaptures","completionManifest"=COALESCE($3::jsonb,"completionManifest"),"terminalAt"=clock_timestamp(),"executionLeaseToken"=NULL,"executionLeaseExpiresAt"=NULL,"executionDeadlineAt"=NULL WHERE id=$1 AND state='RUNNING' AND "executionLeaseToken"=$2`, syncRunId, token, manifest == null ? null : JSON.stringify(manifest));
      });
    },
    async fail(reason, retryable) {
      if (!/^[A-Z0-9_]{1,64}$/.test(reason)) reason = "PROVIDER_FAILURE";
      return database.$transaction(async (tx) => {
        const run = await lockRun(tx, syncRunId);
        if (!run || run.state !== "RUNNING" || run.executionLeaseToken !== token
          || !run.executionLeaseExpiresAt || run.executionLeaseExpiresAt <= run.now
          || !run.executionDeadlineAt || run.executionDeadlineAt <= run.now) return false;
        await tx.$executeRawUnsafe(`UPDATE "SyncAttempt" SET state='FAILED',"classifiedReason"=$3,"finishedAt"=clock_timestamp() WHERE "syncRunId"=$1 AND "attemptNumber"=$2 AND state='RUNNING'`, syncRunId, attemptNumber, reason);
        await tx.$executeRawUnsafe(`UPDATE "SyncRun" SET state=$3::"LedgerState","terminalAt"=CASE WHEN $3='FAILED' THEN clock_timestamp() ELSE NULL END,"executionLeaseToken"=NULL,"executionLeaseExpiresAt"=NULL,"executionDeadlineAt"=NULL WHERE id=$1 AND state='RUNNING' AND "executionLeaseToken"=$2`, syncRunId, token, retryable ? "PENDING" : "FAILED");
        return true;
      });
    },
  };
}
