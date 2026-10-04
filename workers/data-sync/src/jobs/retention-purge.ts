import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@bet-stats/database";

export type RetentionPurgeResult = Readonly<{ auditId: string; cutoff: string; oddsDeleted: number; viewsDeleted: number }>;

/** Deletes only expired personal links; immutable analytical facts are never touched. */
export async function purgeExpiredRetention(database: PrismaClient, cutoff = new Date()): Promise<RetentionPurgeResult> {
  const auditId = randomUUID();
  const startedAt = new Date();
  const [row] = await database.$queryRaw<Array<{ oddsDeleted: number; viewsDeleted: number }>>`
    WITH deleted_odds AS (
      DELETE FROM "RetainedOddsHistory" WHERE "expiresAt" <= ${cutoff} RETURNING 1
    ), deleted_views AS (
      DELETE FROM "RetainedViewHistory" WHERE "expiresAt" <= ${cutoff} RETURNING 1
    ), audit AS (
      INSERT INTO "RetentionPurgeAudit" (id, "startedAt", "completedAt", cutoff, "oddsDeleted", "viewsDeleted")
      SELECT ${auditId}, ${startedAt}, clock_timestamp(), ${cutoff},
        (SELECT count(*)::int FROM deleted_odds), (SELECT count(*)::int FROM deleted_views)
      RETURNING "oddsDeleted", "viewsDeleted"
    ) SELECT "oddsDeleted", "viewsDeleted" FROM audit
  `;
  if (!row) throw new Error("RETENTION_PURGE_AUDIT_MISSING");
  return { auditId, cutoff: cutoff.toISOString(), oddsDeleted: row.oddsDeleted, viewsDeleted: row.viewsDeleted };
}

const MAX_TIMER_DELAY = 2 ** 31 - 1;

export type RetentionPurgeScheduler = Readonly<{ close(): void; refresh(): Promise<void> }>;

/** Arms each purge at the earliest persisted expiry and recomputes after it. */
export function scheduleRetentionPurge(input: {
  database: PrismaClient;
  now?: () => Date;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  onError?: (error: unknown) => void;
  idlePollMs?: number;
  retryMs?: number;
}): RetentionPurgeScheduler {
  const now = input.now ?? (() => new Date());
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const arm = async (): Promise<void> => {
    if (closed) return;
    if (timer) clearTimer(timer);
    try {
      const [row] = await input.database.$queryRaw<Array<{ expiresAt: Date | null }>>`
        SELECT min("expiresAt") AS "expiresAt" FROM (
          SELECT "expiresAt" FROM "RetainedOddsHistory"
          UNION ALL SELECT "expiresAt" FROM "RetainedViewHistory"
        ) expiries
      `;
      if (closed) return;
      const rawDelay = row?.expiresAt ? Math.max(0, row.expiresAt.getTime() - now().getTime()) : (input.idlePollMs ?? 1_000);
      const delay = Math.min(MAX_TIMER_DELAY, rawDelay);
      timer = setTimer(() => { void run().catch(input.onError); }, delay);
    } catch (error) {
      input.onError?.(error);
      if (!closed) {
        timer = setTimer(() => { void arm(); }, input.retryMs ?? 1_000);
      }
    }
  };

  const run = async (): Promise<void> => {
    if (closed) return;
    try {
      await purgeExpiredRetention(input.database, now());
      await arm();
    } catch (error) {
      input.onError?.(error);
      if (!closed) timer = setTimer(() => { void run().catch(input.onError); }, input.retryMs ?? 1_000);
    }
  };

  void arm();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimer(timer);
    },
    refresh: arm,
  };
}

