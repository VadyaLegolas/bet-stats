import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@bet-stats/database";
import type { ReplayEnqueuer, ReplayInput, ReplayUnit } from "./replay.service.js";

type ClaimedDelivery = {
  id: string;
  syncRunId: string;
  jobId: string;
  leaseToken: string;
  revision: number;
  logicalKey: string;
  windowFrom: Date;
  windowTo: Date;
  replayPlanId: string;
  normalizedInput: ReplayInput;
};

export type ReplayDeliveryDispatchResult = {
  claimed: number;
  delivered: number;
};

function deliveryError(code: string, cause?: unknown): Error & { code: string } {
  return Object.assign(new Error(code), { code, ...(cause === undefined ? {} : { cause }) });
}

export function createReplayDeliveryDispatcher(options: {
  database: PrismaClient;
  enqueuer: ReplayEnqueuer;
  leaseMs?: number;
  now?: () => Date;
}) {
  const leaseMs = options.leaseMs ?? 30_000;
  const now = options.now ?? (() => new Date());

  async function claim(replayPlanId?: string): Promise<ClaimedDelivery | null> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now().getTime() + leaseMs);
    return options.database.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `WITH candidate AS (
           SELECT d.id
           FROM "ReplayDelivery" d
           JOIN "SyncRun" r ON r.id=d."syncRunId"
           WHERE ($1::text IS NULL OR r."replayPlanId"=$1)
             AND (
               d.state IN ('PENDING','RETRYABLE')
               OR (d.state='CLAIMED' AND d."leaseExpiresAt" <= CURRENT_TIMESTAMP)
             )
           ORDER BY d."createdAt",d.id
           FOR UPDATE OF d SKIP LOCKED
           LIMIT 1
         )
         UPDATE "ReplayDelivery" d
         SET state='CLAIMED',
             "attemptCount"=d."attemptCount"+1,
             "classifiedReason"=NULL,
             "leaseToken"=$2,
             "leaseExpiresAt"=$3,
             "updatedAt"=CURRENT_TIMESTAMP
         FROM candidate
         WHERE d.id=candidate.id
         RETURNING d.id`,
        replayPlanId ?? null,
        leaseToken,
        leaseExpiresAt,
      );
      if (!claimed[0]) return null;
      const rows = await transaction.$queryRawUnsafe<ClaimedDelivery[]>(
        `SELECT d.id,d."syncRunId",d."jobId",d."leaseToken",r.revision,r."logicalKey",r."windowFrom",r."windowTo",r."replayPlanId",pv."normalizedInput"
         FROM "ReplayDelivery" d
         JOIN "SyncRun" r ON r.id=d."syncRunId"
         JOIN "ReplayPlan" p ON p.id=r."replayPlanId"
         JOIN "ReplayPreview" pv ON pv.id=p."previewId"
         WHERE d.id=$1 AND d.state='CLAIMED' AND d."leaseToken"=$2`,
        claimed[0].id,
        leaseToken,
      );
      return rows[0] ?? null;
    });
  }

  async function acknowledge(delivery: ClaimedDelivery): Promise<void> {
    const changed = await options.database.$executeRawUnsafe(
      `UPDATE "ReplayDelivery"
       SET state='DELIVERED',"classifiedReason"=NULL,"leaseToken"=NULL,"leaseExpiresAt"=NULL,"deliveredAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1 AND state='CLAIMED' AND "leaseToken"=$2`,
      delivery.id,
      delivery.leaseToken,
    );
    if (changed !== 1) throw deliveryError("DELIVERY_LEASE_LOST");
  }

  async function releaseForRetry(delivery: ClaimedDelivery): Promise<void> {
    await options.database.$executeRawUnsafe(
      `UPDATE "ReplayDelivery"
       SET state='RETRYABLE',"classifiedReason"='QUEUE_DELIVERY_FAILED',"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
       WHERE id=$1 AND state='CLAIMED' AND "leaseToken"=$2`,
      delivery.id,
      delivery.leaseToken,
    );
  }

  return {
    async dispatch(replayPlanId?: string): Promise<ReplayDeliveryDispatchResult> {
      const result: ReplayDeliveryDispatchResult = { claimed: 0, delivered: 0 };
      for (;;) {
        const delivery = await claim(replayPlanId);
        if (!delivery) return result;
        result.claimed += 1;
        const logicalId = delivery.logicalKey.endsWith(":replay")
          ? delivery.logicalKey.slice(0, -":replay".length)
          : delivery.logicalKey;
        const unit: ReplayUnit = {
          logicalId,
          from: delivery.windowFrom.toISOString(),
          to: delivery.windowTo.toISOString(),
        };
        try {
          await options.enqueuer.enqueue({
            syncRunId: delivery.syncRunId,
            replayPlanId: delivery.replayPlanId,
            logicalId,
            revision: delivery.revision,
            input: delivery.normalizedInput,
            unit,
          });
          await acknowledge(delivery);
          result.delivered += 1;
        } catch (error) {
          await releaseForRetry(delivery);
          throw deliveryError("QUEUE_DELIVERY_FAILED", error);
        }
      }
    },
  };
}
