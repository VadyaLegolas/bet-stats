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
