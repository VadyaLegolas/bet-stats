CREATE TABLE "SourceObservation" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpointFamily" TEXT NOT NULL,
  "externalIdentity" TEXT NOT NULL,
  "requestedFrom" TIMESTAMP(3), "requestedTo" TIMESTAMP(3),
  "returnedFrom" TIMESTAMP(3), "returnedTo" TIMESTAMP(3),
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "payloadHash" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "payloadBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceObservation_payloadBytes_check" CHECK ("payloadBytes" >= 0)
);
CREATE UNIQUE INDEX "SourceObservation_provider_endpointFamily_payloadHash_key" ON "SourceObservation"("provider","endpointFamily","payloadHash");
CREATE INDEX "SourceObservation_provider_endpointFamily_observedAt_idx" ON "SourceObservation"("provider","endpointFamily","observedAt");
CREATE INDEX "SourceObservation_externalIdentity_observedAt_idx" ON "SourceObservation"("externalIdentity","observedAt");

CREATE TABLE "ResultVersion" (
  "id" TEXT NOT NULL, "fixtureId" TEXT NOT NULL, "observationId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL,
  "homeGoals" INTEGER, "awayGoals" INTEGER, "status" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "supersedesResultVersionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResultVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResultVersion_supersedesResultVersionId_key" ON "ResultVersion"("supersedesResultVersionId");
CREATE UNIQUE INDEX "ResultVersion_fixtureId_revision_key" ON "ResultVersion"("fixtureId","revision");
CREATE UNIQUE INDEX "ResultVersion_fixtureId_observationId_key" ON "ResultVersion"("fixtureId","observationId");
CREATE INDEX "ResultVersion_fixtureId_effectiveAt_observedAt_idx" ON "ResultVersion"("fixtureId","effectiveAt","observedAt");
CREATE INDEX "ResultVersion_effectiveAt_observedAt_idx" ON "ResultVersion"("effectiveAt","observedAt");
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "SourceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultVersion" ADD CONSTRAINT "ResultVersion_supersedesResultVersionId_fkey" FOREIGN KEY ("supersedesResultVersionId") REFERENCES "ResultVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_historical_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER "SourceObservation_append_only" BEFORE UPDATE OR DELETE ON "SourceObservation" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"();
CREATE TRIGGER "ResultVersion_append_only" BEFORE UPDATE OR DELETE ON "ResultVersion" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"();

CREATE TYPE "LedgerState" AS ENUM ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED');
CREATE TYPE "CircuitState" AS ENUM ('CLOSED','OPEN','HALF_OPEN');
CREATE TYPE "EvidenceBuildState" AS ENUM ('BUILDING','PUBLISHED','FAILED');
CREATE TABLE "StandingSnapshot" ("id" TEXT PRIMARY KEY,"leagueId" TEXT NOT NULL,"seasonId" TEXT NOT NULL,"observationId" TEXT NOT NULL,"effectiveAt" TIMESTAMP(3) NOT NULL,"observedAt" TIMESTAMP(3) NOT NULL,"isComplete" BOOLEAN NOT NULL,"rowCount" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "StandingSnapshot_leagueId_seasonId_observationId_key" ON "StandingSnapshot"("leagueId","seasonId","observationId");
CREATE INDEX "StandingSnapshot_leagueId_seasonId_effectiveAt_observedAt_idx" ON "StandingSnapshot"("leagueId","seasonId","effectiveAt","observedAt");
ALTER TABLE "StandingSnapshot" ADD CONSTRAINT "StandingSnapshot_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "SourceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "StandingSnapshotRow" ("id" TEXT PRIMARY KEY,"snapshotId" TEXT NOT NULL,"teamId" TEXT NOT NULL,"position" INTEGER NOT NULL,"played" INTEGER NOT NULL,"points" INTEGER NOT NULL,"goalsFor" INTEGER NOT NULL,"goalsAgainst" INTEGER NOT NULL);
CREATE UNIQUE INDEX "StandingSnapshotRow_snapshotId_teamId_key" ON "StandingSnapshotRow"("snapshotId","teamId");
ALTER TABLE "StandingSnapshotRow" ADD CONSTRAINT "StandingSnapshotRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "StandingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ReplayPlan" ("id" TEXT PRIMARY KEY,"logicalKey" TEXT NOT NULL,"revision" INTEGER NOT NULL,"provider" TEXT NOT NULL,"competitionId" TEXT NOT NULL,"endpointFamily" TEXT NOT NULL,"windowFrom" TIMESTAMP(3) NOT NULL,"windowTo" TIMESTAMP(3) NOT NULL,"previewVersion" TEXT NOT NULL,"reason" TEXT,"actor" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "ReplayPlan_logicalKey_revision_key" ON "ReplayPlan"("logicalKey","revision");
CREATE TABLE "SyncRun" ("id" TEXT PRIMARY KEY,"logicalKey" TEXT NOT NULL,"revision" INTEGER NOT NULL,"provider" TEXT NOT NULL,"endpointFamily" TEXT NOT NULL,"lane" TEXT NOT NULL,"windowFrom" TIMESTAMP(3) NOT NULL,"windowTo" TIMESTAMP(3) NOT NULL,"state" "LedgerState" NOT NULL DEFAULT 'PENDING',"correlationId" TEXT NOT NULL,"replayPlanId" TEXT,"terminalAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "SyncRun_logicalKey_revision_key" ON "SyncRun"("logicalKey","revision"); CREATE INDEX "SyncRun_provider_endpointFamily_state_idx" ON "SyncRun"("provider","endpointFamily","state");
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_replayPlanId_fkey" FOREIGN KEY ("replayPlanId") REFERENCES "ReplayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "SyncAttempt" ("id" TEXT PRIMARY KEY,"syncRunId" TEXT NOT NULL,"attemptNumber" INTEGER NOT NULL,"observationId" TEXT,"state" "LedgerState" NOT NULL,"classifiedReason" TEXT,"startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"finishedAt" TIMESTAMP(3));
CREATE UNIQUE INDEX "SyncAttempt_syncRunId_attemptNumber_key" ON "SyncAttempt"("syncRunId","attemptNumber");
ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE; ALTER TABLE "SyncAttempt" ADD CONSTRAINT "SyncAttempt_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "SourceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ProviderCircuitState" ("id" TEXT PRIMARY KEY,"provider" TEXT NOT NULL,"endpointFamily" TEXT NOT NULL,"state" "CircuitState" NOT NULL DEFAULT 'CLOSED',"failureCount" INTEGER NOT NULL DEFAULT 0,"openedAt" TIMESTAMP(3),"nextProbeAt" TIMESTAMP(3),"lastError" TEXT,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "ProviderCircuitState_provider_endpointFamily_key" ON "ProviderCircuitState"("provider","endpointFamily");
CREATE TABLE "EvidenceBuild" ("id" TEXT PRIMARY KEY,"teamId" TEXT NOT NULL,"cutoff" TIMESTAMP(3) NOT NULL,"configVersion" TEXT NOT NULL,"configHash" TEXT NOT NULL,"syncRunId" TEXT NOT NULL,"replayPlanId" TEXT,"state" "EvidenceBuildState" NOT NULL DEFAULT 'BUILDING',"publishedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "EvidenceBuild_teamId_cutoff_configHash_syncRunId_key" ON "EvidenceBuild"("teamId","cutoff","configHash","syncRunId"); CREATE INDEX "EvidenceBuild_teamId_cutoff_state_idx" ON "EvidenceBuild"("teamId","cutoff","state");
ALTER TABLE "EvidenceBuild" ADD CONSTRAINT "EvidenceBuild_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE; ALTER TABLE "EvidenceBuild" ADD CONSTRAINT "EvidenceBuild_replayPlanId_fkey" FOREIGN KEY ("replayPlanId") REFERENCES "ReplayPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "EvidenceComponent" ("id" TEXT PRIMARY KEY,"buildId" TEXT NOT NULL,"component" TEXT NOT NULL,"value" JSONB,"sampleSize" INTEGER NOT NULL,"limitation" TEXT,"sourceTimes" JSONB NOT NULL);
CREATE UNIQUE INDEX "EvidenceComponent_buildId_component_key" ON "EvidenceComponent"("buildId","component"); ALTER TABLE "EvidenceComponent" ADD CONSTRAINT "EvidenceComponent_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "EvidenceBuild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "StandingSnapshot_append_only" BEFORE UPDATE OR DELETE ON "StandingSnapshot" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"(); CREATE TRIGGER "StandingSnapshotRow_append_only" BEFORE UPDATE OR DELETE ON "StandingSnapshotRow" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"(); CREATE TRIGGER "SyncAttempt_append_only" BEFORE UPDATE OR DELETE ON "SyncAttempt" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"(); CREATE TRIGGER "ReplayPlan_append_only" BEFORE UPDATE OR DELETE ON "ReplayPlan" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"(); CREATE TRIGGER "EvidenceBuild_append_only" BEFORE UPDATE OR DELETE ON "EvidenceBuild" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"(); CREATE TRIGGER "EvidenceComponent_append_only" BEFORE UPDATE OR DELETE ON "EvidenceComponent" FOR EACH ROW EXECUTE FUNCTION "prevent_historical_evidence_mutation"();
