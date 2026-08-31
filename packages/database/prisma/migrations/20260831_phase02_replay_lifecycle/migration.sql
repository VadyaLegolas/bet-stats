DROP TRIGGER "SyncAttempt_append_only" ON "SyncAttempt";

CREATE OR REPLACE FUNCTION "guard_sync_attempt_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SyncAttempt is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."syncRunId" IS DISTINCT FROM OLD."syncRunId"
     OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
     OR NEW."observationId" IS DISTINCT FROM OLD."observationId"
     OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'SyncAttempt identity, links, and startedAt are immutable';
  END IF;

  IF OLD."state" <> 'RUNNING'
     OR OLD."finishedAt" IS NOT NULL
     OR OLD."classifiedReason" IS NOT NULL
     OR NEW."state" NOT IN ('SUCCEEDED', 'FAILED')
     OR NEW."finishedAt" IS NULL THEN
    RAISE EXCEPTION 'invalid SyncAttempt transition % -> %', OLD."state", NEW."state";
  END IF;

  IF NEW."state" = 'SUCCEEDED' AND NEW."classifiedReason" IS NOT NULL THEN
    RAISE EXCEPTION 'successful SyncAttempt cannot have a classified reason';
  END IF;
  IF NEW."state" = 'FAILED'
     AND (NEW."classifiedReason" IS NULL OR NEW."classifiedReason" !~ '^[A-Z0-9_]{1,64}$') THEN
    RAISE EXCEPTION 'failed SyncAttempt requires a classified reason';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SyncAttempt_guarded_transition"
BEFORE UPDATE OR DELETE ON "SyncAttempt"
FOR EACH ROW EXECUTE FUNCTION "guard_sync_attempt_transition"();

CREATE OR REPLACE FUNCTION "guard_sync_run_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SyncRun is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."logicalKey" IS DISTINCT FROM OLD."logicalKey"
     OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."endpointFamily" IS DISTINCT FROM OLD."endpointFamily"
     OR NEW."lane" IS DISTINCT FROM OLD."lane"
     OR NEW."windowFrom" IS DISTINCT FROM OLD."windowFrom"
     OR NEW."windowTo" IS DISTINCT FROM OLD."windowTo"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
     OR NEW."replayPlanId" IS DISTINCT FROM OLD."replayPlanId"
     OR NEW."expectedUnits" IS DISTINCT FROM OLD."expectedUnits"
     OR NEW."expectedCaptures" IS DISTINCT FROM OLD."expectedCaptures"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'SyncRun identity and declared work are immutable';
  END IF;

  IF OLD."state" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal SyncRun is immutable';
  END IF;

  -- Queue delivery may mark an undispatched PENDING run retryable without
  -- changing the declared work or lifecycle state.
  IF OLD."state" = 'PENDING' AND NEW."state" = 'PENDING' THEN
    IF NEW."completionManifest" - 'delivery' IS DISTINCT FROM OLD."completionManifest" - 'delivery'
       OR NEW."completionManifest" ->> 'delivery' IS DISTINCT FROM 'RETRYABLE'
       OR NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits"
       OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
       OR NEW."terminalAt" IS DISTINCT FROM OLD."terminalAt" THEN
      RAISE EXCEPTION 'invalid PENDING SyncRun metadata update';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'PENDING' AND NEW."state" = 'RUNNING' THEN
    IF NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits"
       OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
       OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest"
       OR NEW."terminalAt" IS NOT NULL THEN
      RAISE EXCEPTION 'invalid PENDING to RUNNING SyncRun transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'RUNNING' AND NEW."state" = 'PENDING' THEN
    IF NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits"
       OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
       OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest"
       OR NEW."terminalAt" IS NOT NULL THEN
      RAISE EXCEPTION 'invalid RUNNING to PENDING SyncRun transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'RUNNING' AND NEW."state" = 'FAILED' THEN
    IF NEW."completedUnits" IS DISTINCT FROM OLD."completedUnits"
       OR NEW."completedCaptures" IS DISTINCT FROM OLD."completedCaptures"
       OR NEW."completionManifest" IS DISTINCT FROM OLD."completionManifest"
       OR NEW."terminalAt" IS NULL THEN
      RAISE EXCEPTION 'invalid RUNNING to FAILED SyncRun transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'RUNNING' AND NEW."state" = 'SUCCEEDED' THEN
    IF NEW."terminalAt" IS NULL
       OR NEW."completedUnits" <> NEW."expectedUnits"
       OR NEW."completedCaptures" <> NEW."expectedCaptures" THEN
      RAISE EXCEPTION 'successful SyncRun requires complete declared work';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid SyncRun transition % -> %', OLD."state", NEW."state";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SyncRun_guarded_transition"
BEFORE UPDATE OR DELETE ON "SyncRun"
FOR EACH ROW EXECUTE FUNCTION "guard_sync_run_transition"();
