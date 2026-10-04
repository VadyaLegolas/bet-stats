CREATE TABLE "BacktestPlan" (
  "id" TEXT PRIMARY KEY, "version" TEXT NOT NULL, "planHash" TEXT NOT NULL UNIQUE,
  "modelVersion" TEXT NOT NULL, "configHash" TEXT NOT NULL, "rangeFrom" TIMESTAMPTZ(3) NOT NULL,
  "rangeTo" TIMESTAMPTZ(3) NOT NULL, "concurrency" INTEGER NOT NULL, "state" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL, "receipt" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3), CHECK ("rangeFrom" < "rangeTo"), CHECK ("concurrency" BETWEEN 1 AND 4)
);
CREATE INDEX "BacktestPlan_state_createdAt_idx" ON "BacktestPlan"("state", "createdAt");

CREATE TABLE "BacktestWindow" (
  "id" TEXT PRIMARY KEY, "planId" TEXT NOT NULL, "fixtureId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  "trainingEndsAt" TIMESTAMPTZ(3) NOT NULL, "forecastCutoff" TIMESTAMPTZ(3) NOT NULL, "state" TEXT NOT NULL,
  "evidenceBuildIds" JSONB, "forecastSnapshotId" TEXT, "scoreIds" JSONB, "failureCode" TEXT,
  "correlationId" TEXT NOT NULL, "receipt" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3), CONSTRAINT "BacktestWindow_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BacktestPlan"("id") ON DELETE RESTRICT,
  CONSTRAINT "BacktestWindow_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  CHECK ("trainingEndsAt" < "forecastCutoff"), UNIQUE ("planId", "ordinal"), UNIQUE ("planId", "fixtureId", "forecastCutoff")
);
CREATE INDEX "BacktestWindow_planId_state_ordinal_idx" ON "BacktestWindow"("planId", "state", "ordinal");
CREATE INDEX "BacktestWindow_fixtureId_forecastCutoff_idx" ON "BacktestWindow"("fixtureId", "forecastCutoff");

CREATE FUNCTION reject_backtest_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'BacktestPlan' THEN
    IF OLD."id" <> NEW."id" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."planHash" IS DISTINCT FROM NEW."planHash"
      OR OLD."modelVersion" IS DISTINCT FROM NEW."modelVersion" OR OLD."configHash" IS DISTINCT FROM NEW."configHash"
      OR OLD."rangeFrom" IS DISTINCT FROM NEW."rangeFrom" OR OLD."rangeTo" IS DISTINCT FROM NEW."rangeTo"
      OR OLD."concurrency" IS DISTINCT FROM NEW."concurrency" OR OLD."receipt" IS DISTINCT FROM NEW."receipt" THEN RAISE EXCEPTION 'immutable backtest plan receipt'; END IF;
  ELSE
    IF OLD."id" <> NEW."id" OR OLD."planId" IS DISTINCT FROM NEW."planId" OR OLD."fixtureId" IS DISTINCT FROM NEW."fixtureId"
      OR OLD."forecastCutoff" IS DISTINCT FROM NEW."forecastCutoff" OR OLD."trainingEndsAt" IS DISTINCT FROM NEW."trainingEndsAt"
      OR OLD."receipt" IS DISTINCT FROM NEW."receipt" THEN RAISE EXCEPTION 'immutable backtest window receipt'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BacktestPlan_identity_immutable" BEFORE UPDATE ON "BacktestPlan" FOR EACH ROW EXECUTE FUNCTION reject_backtest_identity_mutation();
CREATE TRIGGER "BacktestWindow_identity_immutable" BEFORE UPDATE ON "BacktestWindow" FOR EACH ROW EXECUTE FUNCTION reject_backtest_identity_mutation();
