-- Repair Phase 2 temporal columns. Historical TIMESTAMP values were written as
-- UTC; AT TIME ZONE makes that assumption explicit during the forward upgrade.
ALTER TABLE "SourceObservation"
  ALTER COLUMN "requestedFrom" TYPE TIMESTAMPTZ(3) USING "requestedFrom" AT TIME ZONE 'UTC',
  ALTER COLUMN "requestedTo" TYPE TIMESTAMPTZ(3) USING "requestedTo" AT TIME ZONE 'UTC',
  ALTER COLUMN "returnedFrom" TYPE TIMESTAMPTZ(3) USING "returnedFrom" AT TIME ZONE 'UTC',
  ALTER COLUMN "returnedTo" TYPE TIMESTAMPTZ(3) USING "returnedTo" AT TIME ZONE 'UTC',
  ALTER COLUMN "observedAt" TYPE TIMESTAMPTZ(3) USING "observedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "sourceUpdatedAt" TYPE TIMESTAMPTZ(3) USING "sourceUpdatedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

ALTER TABLE "StandingSnapshot"
  ALTER COLUMN "effectiveAt" TYPE TIMESTAMPTZ(3) USING "effectiveAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "observedAt" TYPE TIMESTAMPTZ(3) USING "observedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ResultVersion"
  ALTER COLUMN "effectiveAt" TYPE TIMESTAMPTZ(3) USING "effectiveAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "observedAt" TYPE TIMESTAMPTZ(3) USING "observedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ReplayPlan"
  ALTER COLUMN "windowFrom" TYPE TIMESTAMPTZ(3) USING "windowFrom" AT TIME ZONE 'UTC',
  ALTER COLUMN "windowTo" TYPE TIMESTAMPTZ(3) USING "windowTo" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "SyncRun"
  ALTER COLUMN "windowFrom" TYPE TIMESTAMPTZ(3) USING "windowFrom" AT TIME ZONE 'UTC',
  ALTER COLUMN "windowTo" TYPE TIMESTAMPTZ(3) USING "windowTo" AT TIME ZONE 'UTC',
  ALTER COLUMN "terminalAt" TYPE TIMESTAMPTZ(3) USING "terminalAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC',
  ADD COLUMN "expectedUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedUnits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expectedCaptures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedCaptures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completionManifest" JSONB NOT NULL DEFAULT '{"expectedUnits":[],"completedUnits":[],"expectedCaptures":[],"completedCaptures":[]}'::jsonb,
  ADD CONSTRAINT "SyncRun_completion_nonnegative" CHECK ("expectedUnits" >= 0 AND "completedUnits" >= 0 AND "expectedCaptures" >= 0 AND "completedCaptures" >= 0),
  ADD CONSTRAINT "SyncRun_completion_bounded" CHECK ("completedUnits" <= "expectedUnits" AND "completedCaptures" <= "expectedCaptures");
ALTER TABLE "SyncAttempt"
  ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(3) USING "startedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "finishedAt" TYPE TIMESTAMPTZ(3) USING "finishedAt" AT TIME ZONE 'UTC';
ALTER TABLE "ProviderCircuitState"
  ALTER COLUMN "openedAt" TYPE TIMESTAMPTZ(3) USING "openedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "nextProbeAt" TYPE TIMESTAMPTZ(3) USING "nextProbeAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "EvidenceBuild"
  ALTER COLUMN "cutoff" TYPE TIMESTAMPTZ(3) USING "cutoff" AT TIME ZONE 'UTC',
  ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3) USING "publishedAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

DROP TRIGGER "EvidenceBuild_append_only" ON "EvidenceBuild";
CREATE OR REPLACE FUNCTION "guard_evidence_build_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EvidenceBuild is immutable'; END IF;
  IF OLD."state" <> 'BUILDING' OR NEW."state" NOT IN ('PUBLISHED','FAILED') THEN
    RAISE EXCEPTION 'invalid EvidenceBuild transition % -> %', OLD."state", NEW."state";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."teamId" IS DISTINCT FROM OLD."teamId"
     OR NEW."cutoff" IS DISTINCT FROM OLD."cutoff" OR NEW."configVersion" IS DISTINCT FROM OLD."configVersion"
     OR NEW."configHash" IS DISTINCT FROM OLD."configHash" OR NEW."syncRunId" IS DISTINCT FROM OLD."syncRunId"
     OR NEW."replayPlanId" IS DISTINCT FROM OLD."replayPlanId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'EvidenceBuild identity and inputs are immutable';
  END IF;
  IF NEW."state" = 'PUBLISHED' AND NEW."publishedAt" IS NULL THEN
    RAISE EXCEPTION 'published EvidenceBuild requires publishedAt';
  END IF;
  IF NEW."state" = 'FAILED' AND NEW."publishedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'failed EvidenceBuild cannot have publishedAt';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EvidenceBuild_guarded_transition" BEFORE UPDATE OR DELETE ON "EvidenceBuild"
FOR EACH ROW EXECUTE FUNCTION "guard_evidence_build_transition"();
