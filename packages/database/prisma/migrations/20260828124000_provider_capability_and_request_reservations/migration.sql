CREATE TABLE "ProviderCapability" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "supported" BOOLEAN NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderRequestReservation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "endpoint" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderRequestReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCapability_provider_leagueId_seasonId_endpoint_key" ON "ProviderCapability"("provider", "leagueId", "seasonId", "endpoint");
CREATE INDEX "ProviderCapability_provider_endpoint_verifiedAt_idx" ON "ProviderCapability"("provider", "endpoint", "verifiedAt");
CREATE UNIQUE INDEX "ProviderRequestReservation_provider_requestDate_endpoint_jobKey_key" ON "ProviderRequestReservation"("provider", "requestDate", "endpoint", "jobKey");
CREATE INDEX "ProviderRequestReservation_provider_requestDate_endpoint_idx" ON "ProviderRequestReservation"("provider", "requestDate", "endpoint");
ALTER TABLE "ProviderCapability" ADD CONSTRAINT "ProviderCapability_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCapability" ADD CONSTRAINT "ProviderCapability_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
