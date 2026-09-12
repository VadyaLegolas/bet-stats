CREATE TABLE "ProviderRouteReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contentHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "endpointFamily" TEXT NOT NULL,
  "candidates" JSONB NOT NULL,
  "selectedProvider" TEXT,
  "trigger" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "capabilitySnapshot" JSONB NOT NULL,
  "budgetSnapshot" JSONB NOT NULL,
  "circuitSnapshot" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderRouteReceipt_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRouteReceipt_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRouteReceipt_candidates_check" CHECK (jsonb_typeof("candidates") = 'array' AND jsonb_array_length("candidates") > 0),
  CONSTRAINT "ProviderRouteReceipt_selected_check" CHECK ("selectedProvider" IS NULL OR "candidates" ? "selectedProvider")
);
CREATE UNIQUE INDEX "ProviderRouteReceipt_contentHash_key" ON "ProviderRouteReceipt"("contentHash");
CREATE INDEX "ProviderRouteReceipt_competitionId_seasonId_endpointFamily_createdAt_idx" ON "ProviderRouteReceipt"("competitionId", "seasonId", "endpointFamily", "createdAt");
CREATE INDEX "ProviderRouteReceipt_correlationId_idx" ON "ProviderRouteReceipt"("correlationId");

CREATE TABLE "ProviderRouteAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "routeReceiptId" TEXT NOT NULL,
  "attemptKey" TEXT NOT NULL,
  "provider" TEXT,
  "state" TEXT NOT NULL,
  "reason" TEXT,
  "observationId" TEXT,
  "admitted" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderRouteAttempt_routeReceiptId_fkey" FOREIGN KEY ("routeReceiptId") REFERENCES "ProviderRouteReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRouteAttempt_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "SourceObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderRouteAttempt_response_check" CHECK (("observationId" IS NULL) OR ("admitted" AND "state" = 'SUCCEEDED' AND "provider" IS NOT NULL))
);
CREATE UNIQUE INDEX "ProviderRouteAttempt_attemptKey_key" ON "ProviderRouteAttempt"("attemptKey");
CREATE INDEX "ProviderRouteAttempt_routeReceiptId_createdAt_idx" ON "ProviderRouteAttempt"("routeReceiptId", "createdAt");
CREATE INDEX "ProviderRouteAttempt_provider_state_createdAt_idx" ON "ProviderRouteAttempt"("provider", "state", "createdAt");

CREATE TABLE "ProviderQuotaObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "routeAttemptId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpointFamily" TEXT NOT NULL,
  "observedLimit" INTEGER,
  "observedRemaining" INTEGER,
  "resetAt" TIMESTAMPTZ(3),
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProviderQuotaObservation_routeAttemptId_fkey" FOREIGN KEY ("routeAttemptId") REFERENCES "ProviderRouteAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderQuotaObservation_nonnegative_check" CHECK (("observedLimit" IS NULL OR "observedLimit" >= 0) AND ("observedRemaining" IS NULL OR "observedRemaining" >= 0) AND ("observedLimit" IS NULL OR "observedRemaining" IS NULL OR "observedRemaining" <= "observedLimit"))
);
CREATE INDEX "ProviderQuotaObservation_provider_endpointFamily_observedAt_idx" ON "ProviderQuotaObservation"("provider", "endpointFamily", "observedAt");

CREATE TABLE "ProviderThrottleReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "routeAttemptId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpointFamily" TEXT NOT NULL,
  "reservationKey" TEXT NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "windowEnd" TIMESTAMPTZ(3) NOT NULL,
  "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderThrottleReservation_routeAttemptId_fkey" FOREIGN KEY ("routeAttemptId") REFERENCES "ProviderRouteAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProviderThrottleReservation_window_check" CHECK ("windowEnd" > "windowStart")
);
CREATE UNIQUE INDEX "ProviderThrottleReservation_reservationKey_key" ON "ProviderThrottleReservation"("reservationKey");
CREATE INDEX "ProviderThrottleReservation_provider_endpointFamily_windowStart_windowEnd_idx" ON "ProviderThrottleReservation"("provider", "endpointFamily", "windowStart", "windowEnd");

CREATE OR REPLACE FUNCTION reject_provider_route_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'PROVIDER_ROUTE_APPEND_ONLY'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "ProviderRouteReceipt_append_only" BEFORE UPDATE OR DELETE ON "ProviderRouteReceipt" FOR EACH ROW EXECUTE FUNCTION reject_provider_route_mutation();
CREATE TRIGGER "ProviderRouteAttempt_guarded_immutable" BEFORE UPDATE OR DELETE ON "ProviderRouteAttempt" FOR EACH ROW EXECUTE FUNCTION reject_provider_route_mutation();
CREATE TRIGGER "ProviderQuotaObservation_append_only" BEFORE UPDATE OR DELETE ON "ProviderQuotaObservation" FOR EACH ROW EXECUTE FUNCTION reject_provider_route_mutation();
