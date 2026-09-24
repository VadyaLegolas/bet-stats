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
