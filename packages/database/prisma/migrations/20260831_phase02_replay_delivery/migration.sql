CREATE TYPE "ReplayDeliveryState" AS ENUM ('PENDING', 'CLAIMED', 'RETRYABLE', 'DELIVERED');

CREATE TABLE "ReplayDelivery" (
  "id" TEXT NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "state" "ReplayDeliveryState" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "classifiedReason" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "deliveredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReplayDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReplayDelivery_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReplayDelivery_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "ReplayDelivery_job_id_check" CHECK ("jobId" ~ '^[A-Za-z0-9_-]{3,160}$'),
  CONSTRAINT "ReplayDelivery_reason_check" CHECK ("classifiedReason" IS NULL OR "classifiedReason" ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT "ReplayDelivery_state_shape_check" CHECK (
    ("state" = 'PENDING' AND "attemptCount" = 0 AND "classifiedReason" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL)
    OR ("state" = 'CLAIMED' AND "attemptCount" > 0 AND "classifiedReason" IS NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "deliveredAt" IS NULL)
    OR ("state" = 'RETRYABLE' AND "attemptCount" > 0 AND "classifiedReason" IS NOT NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NULL)
    OR ("state" = 'DELIVERED' AND "attemptCount" > 0 AND "classifiedReason" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "deliveredAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ReplayDelivery_syncRunId_key" ON "ReplayDelivery"("syncRunId");
CREATE UNIQUE INDEX "ReplayDelivery_jobId_key" ON "ReplayDelivery"("jobId");
CREATE INDEX "ReplayDelivery_state_leaseExpiresAt_createdAt_idx" ON "ReplayDelivery"("state", "leaseExpiresAt", "createdAt");

CREATE OR REPLACE FUNCTION "guard_replay_delivery_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ReplayDelivery is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."syncRunId" IS DISTINCT FROM OLD."syncRunId"
     OR NEW."jobId" IS DISTINCT FROM OLD."jobId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'ReplayDelivery identity is immutable';
  END IF;

  IF OLD."state" = 'DELIVERED'
     OR (OLD."state" IN ('PENDING', 'RETRYABLE') AND NEW."state" <> 'CLAIMED')
     OR (OLD."state" = 'CLAIMED' AND NEW."state" NOT IN ('CLAIMED', 'RETRYABLE', 'DELIVERED')) THEN
    RAISE EXCEPTION 'invalid ReplayDelivery transition % -> %', OLD."state", NEW."state";
  END IF;

  IF OLD."state" = 'CLAIMED' AND NEW."state" = 'CLAIMED'
     AND (OLD."leaseExpiresAt" IS NULL OR OLD."leaseExpiresAt" > CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'active ReplayDelivery lease cannot be replaced';
  END IF;

  IF NEW."attemptCount" <> OLD."attemptCount" + (CASE WHEN NEW."state" = 'CLAIMED' THEN 1 ELSE 0 END) THEN
    RAISE EXCEPTION 'ReplayDelivery attempt count must advance exactly once per claim';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReplayDelivery_guarded_transition"
BEFORE UPDATE OR DELETE ON "ReplayDelivery"
FOR EACH ROW EXECUTE FUNCTION "guard_replay_delivery_transition"();

ALTER TABLE "ProviderCircuitState"
  ADD COLUMN "probeLeaseToken" TEXT,
  ADD COLUMN "probeLeaseExpiresAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "ProviderCircuitState_probe_lease_pair_check"
    CHECK (("probeLeaseToken" IS NULL) = ("probeLeaseExpiresAt" IS NULL));

CREATE INDEX "ProviderCircuitState_provider_endpointFamily_state_nextProbeAt_probeLeaseExpiresAt_idx"
  ON "ProviderCircuitState"("provider", "endpointFamily", "state", "nextProbeAt", "probeLeaseExpiresAt");
