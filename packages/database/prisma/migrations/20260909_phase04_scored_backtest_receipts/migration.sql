ALTER TABLE "BacktestPlan"
  ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "enqueuedAt" TIMESTAMPTZ(3);

ALTER TABLE "BacktestWindow" ADD COLUMN "evaluationAsOf" TIMESTAMPTZ(3);
UPDATE "BacktestWindow" SET "evaluationAsOf" = "forecastCutoff" + INTERVAL '7 days' WHERE "evaluationAsOf" IS NULL;
ALTER TABLE "BacktestWindow" ALTER COLUMN "evaluationAsOf" SET NOT NULL;

CREATE TABLE "BacktestEvaluation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "windowId" TEXT NOT NULL,
  "evaluationAsOf" TIMESTAMPTZ(3) NOT NULL,
  "resultVersionId" TEXT NOT NULL,
  "settlementReceiptId" TEXT NOT NULL,
  "scoreIds" JSONB NOT NULL,
  "revision" INTEGER NOT NULL,
  "supersedesEvaluationId" TEXT,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BacktestEvaluation_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "BacktestWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BacktestEvaluation_supersedesEvaluationId_fkey" FOREIGN KEY ("supersedesEvaluationId") REFERENCES "BacktestEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BacktestEvaluation_windowId_evaluationAsOf_key" ON "BacktestEvaluation"("windowId", "evaluationAsOf");
CREATE UNIQUE INDEX "BacktestEvaluation_windowId_revision_key" ON "BacktestEvaluation"("windowId", "revision");
CREATE UNIQUE INDEX "BacktestEvaluation_supersedesEvaluationId_key" ON "BacktestEvaluation"("supersedesEvaluationId");
CREATE INDEX "BacktestEvaluation_windowId_isCurrent_idx" ON "BacktestEvaluation"("windowId", "isCurrent");
CREATE INDEX "BacktestEvaluation_resultVersionId_idx" ON "BacktestEvaluation"("resultVersionId");

CREATE OR REPLACE FUNCTION reject_empty_backtest_score_ids() RETURNS trigger AS $$
BEGIN
  IF jsonb_typeof(NEW."scoreIds") <> 'array' OR jsonb_array_length(NEW."scoreIds") = 0 THEN
    RAISE EXCEPTION 'EMPTY_BACKTEST_SCORE_IDS';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BacktestEvaluation_non_empty_scores" BEFORE INSERT OR UPDATE ON "BacktestEvaluation"
FOR EACH ROW EXECUTE FUNCTION reject_empty_backtest_score_ids();
