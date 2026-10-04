CREATE TABLE "EnrichmentDecisionReceipt" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "cutoff" TIMESTAMPTZ(3) NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrichmentDecisionReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnrichmentDecisionReceipt_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EnrichmentDecisionReceipt_fixtureId_provider_endpoint_policyVersion_cutoff_key"
  ON "EnrichmentDecisionReceipt"("fixtureId", "provider", "endpoint", "policyVersion", "cutoff");
CREATE INDEX "EnrichmentDecisionReceipt_fixtureId_endpoint_cutoff_idx"
  ON "EnrichmentDecisionReceipt"("fixtureId", "endpoint", "cutoff");
