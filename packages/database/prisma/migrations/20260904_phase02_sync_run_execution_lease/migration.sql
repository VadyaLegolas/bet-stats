LOCK TABLE "SyncRun" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "SyncRun"
  ADD COLUMN "executionLeaseToken" TEXT,
  ADD COLUMN "executionLeaseExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "executionDeadlineAt" TIMESTAMPTZ(3);

DROP TRIGGER "SyncRun_guarded_transition" ON "SyncRun";

UPDATE "SyncRun"
SET "executionLeaseToken" = gen_random_uuid()::text,
    "executionLeaseExpiresAt" = clock_timestamp() - interval '1 second',
    "executionDeadlineAt" = clock_timestamp() - interval '1 second'
WHERE state = 'RUNNING';

ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_execution_lease_shape_check" CHECK (
  (state = 'RUNNING' AND "executionLeaseToken" IS NOT NULL AND "executionLeaseExpiresAt" IS NOT NULL
    AND "executionDeadlineAt" IS NOT NULL AND "executionLeaseExpiresAt" <= "executionDeadlineAt")
  OR
  (state <> 'RUNNING' AND "executionLeaseToken" IS NULL AND "executionLeaseExpiresAt" IS NULL
    AND "executionDeadlineAt" IS NULL)
);

CREATE INDEX "SyncRun_state_executionLeaseExpiresAt_idx"
  ON "SyncRun"(state, "executionLeaseExpiresAt");

CREATE OR REPLACE FUNCTION "guard_sync_run_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SyncRun is immutable'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."logicalKey" IS DISTINCT FROM OLD."logicalKey"
     OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW."endpointFamily" IS DISTINCT FROM OLD."endpointFamily" OR NEW.lane IS DISTINCT FROM OLD.lane
     OR NEW."windowFrom" IS DISTINCT FROM OLD."windowFrom" OR NEW."windowTo" IS DISTINCT FROM OLD."windowTo"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId" OR NEW."replayPlanId" IS DISTINCT FROM OLD."replayPlanId"
     OR NEW."expectedUnits" IS DISTINCT FROM OLD."expectedUnits" OR NEW."expectedCaptures" IS DISTINCT FROM OLD."expectedCaptures"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'SyncRun identity and declared work are immutable';
  END IF;
  IF OLD.state IN ('SUCCEEDED','FAILED','CANCELLED') THEN RAISE EXCEPTION 'terminal SyncRun is immutable'; END IF;

  IF OLD.state='PENDING' AND NEW.state='PENDING' THEN
    IF NEW."executionLeaseToken" IS NOT NULL OR NEW."executionLeaseExpiresAt" IS NOT NULL OR NEW."executionDeadlineAt" IS NOT NULL
      OR NEW."completionManifest" - 'delivery' IS DISTINCT FROM OLD."completionManifest" - 'delivery'
      OR NEW."completionManifest" ->> 'delivery' IS DISTINCT FROM 'RETRYABLE'
      OR NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits" OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
      OR NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt" THEN RAISE EXCEPTION 'invalid PENDING SyncRun metadata update'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='PENDING' AND NEW.state='RUNNING' THEN
    IF NEW."executionLeaseToken" IS NULL OR NEW."executionLeaseExpiresAt" IS NULL OR NEW."executionDeadlineAt" IS NULL
      OR NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits" OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
      OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest" OR NEW."terminalAt" IS NOT NULL THEN RAISE EXCEPTION 'invalid PENDING to RUNNING SyncRun transition'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='RUNNING' AND NEW.state='RUNNING' THEN
    IF NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits" OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
      OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest" OR NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt" THEN RAISE EXCEPTION 'invalid RUNNING lease update'; END IF;
    IF NEW."executionLeaseToken" IS DISTINCT FROM OLD."executionLeaseToken" AND OLD."executionLeaseExpiresAt" > clock_timestamp() THEN RAISE EXCEPTION 'active execution lease cannot be rotated'; END IF;
    IF NEW."executionDeadlineAt" < NEW."executionLeaseExpiresAt" THEN RAISE EXCEPTION 'execution lease exceeds deadline'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='RUNNING' AND NEW.state IN ('PENDING','FAILED','SUCCEEDED') THEN
    IF NEW."executionLeaseToken" IS NOT NULL OR NEW."executionLeaseExpiresAt" IS NOT NULL OR NEW."executionDeadlineAt" IS NOT NULL THEN RAISE EXCEPTION 'non-running SyncRun must clear execution lease'; END IF;
    IF NEW.state='PENDING' AND (NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits" OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures" OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest" OR NEW."terminalAt" IS NOT NULL) THEN RAISE EXCEPTION 'invalid RUNNING to PENDING SyncRun transition'; END IF;
    IF NEW.state='FAILED' AND (NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits" OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures" OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest" OR NEW."terminalAt" IS NULL) THEN RAISE EXCEPTION 'invalid RUNNING to FAILED SyncRun transition'; END IF;
    IF NEW.state='SUCCEEDED' AND (NEW."terminalAt" IS NULL OR NEW."completedUnits" <> NEW."expectedUnits" OR NEW."completedCaptures" <> NEW."expectedCaptures") THEN RAISE EXCEPTION 'successful SyncRun requires complete declared work'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid SyncRun transition % -> %', OLD.state, NEW.state;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SyncRun_guarded_transition" BEFORE UPDATE OR DELETE ON "SyncRun"
FOR EACH ROW EXECUTE FUNCTION "guard_sync_run_transition"();
