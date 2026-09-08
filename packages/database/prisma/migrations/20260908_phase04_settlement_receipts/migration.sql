-- D-01 is intentionally one-way: evaluation history is append-only, so result
-- corrections create linked receipts instead of rewriting settled evidence.
CREATE TABLE "SettlementReceipt" (
  "id" TEXT PRIMARY KEY,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  "resultVersionId" TEXT NOT NULL REFERENCES "ResultVersion"("id") ON DELETE RESTRICT,
  "forecastSnapshotId" TEXT NOT NULL REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "supersedesSettlementReceiptId" TEXT UNIQUE REFERENCES "SettlementReceipt"("id") ON DELETE RESTRICT,
  "policyVersion" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "lifecycle" TEXT NOT NULL CHECK ("lifecycle" IN ('FINISHED','POSTPONED','CANCELLED','ABANDONED','VOID')),
  "scoreability" TEXT NOT NULL CHECK ("scoreability" IN ('SCOREABLE','PENDING','NON_SCORED')),
  "financialEligibility" TEXT NOT NULL CHECK ("financialEligibility" IN ('ELIGIBLE','NOT_ELIGIBLE','NON_FINANCIAL')),
  "classOutcome" TEXT NOT NULL CHECK ("classOutcome" IN ('SCORED','PENDING','NON_SCORED')),
  "reason" TEXT NOT NULL,
  "receipt" JSONB NOT NULL,
  "resultObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "forecastCutoff" TIMESTAMPTZ(3) NOT NULL,
  "settledAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("resultVersionId", "forecastSnapshotId", "policyHash"),
  UNIQUE ("fixtureId", "revision")
);
CREATE INDEX "SettlementReceipt_fixtureId_settledAt_idx" ON "SettlementReceipt"("fixtureId", "settledAt");

CREATE OR REPLACE FUNCTION guard_settlement_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE result_source "ResultVersion"%ROWTYPE;
DECLARE forecast_source "ForecastSnapshot"%ROWTYPE;
DECLARE fixture_kickoff TIMESTAMPTZ;
DECLARE prior "SettlementReceipt"%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'SettlementReceipt is immutable'; END IF;
  SELECT * INTO result_source FROM "ResultVersion" WHERE id=NEW."resultVersionId";
  SELECT * INTO forecast_source FROM "ForecastSnapshot" WHERE id=NEW."forecastSnapshotId";
  SELECT "kickoffUtc" INTO fixture_kickoff FROM "Fixture" WHERE id=NEW."fixtureId";
  IF result_source.id IS NULL OR forecast_source.id IS NULL OR fixture_kickoff IS NULL OR
     result_source."fixtureId" <> NEW."fixtureId" OR forecast_source."fixtureId" <> NEW."fixtureId" THEN
    RAISE EXCEPTION 'settlement source lineage must match fixture';
  END IF;
  IF forecast_source.state <> 'ISSUED' OR forecast_source.kind NOT IN ('PRE_MATCH','LINEUP_CONFIRMED') OR
     forecast_source."issuedAt" IS NULL OR forecast_source.cutoff >= fixture_kickoff THEN
    RAISE EXCEPTION 'settlement requires exact immutable pre-kickoff issued forecast';
  END IF;
  IF NEW."resultObservedAt" <> result_source."observedAt" OR NEW."forecastCutoff" <> forecast_source.cutoff THEN
    RAISE EXCEPTION 'settlement timestamps disagree with immutable sources';
  END IF;
  IF NEW.receipt->>'fixtureId' IS DISTINCT FROM NEW."fixtureId" OR
     NEW.receipt->>'resultVersionId' IS DISTINCT FROM NEW."resultVersionId" OR
     NEW.receipt->>'forecastSnapshotId' IS DISTINCT FROM NEW."forecastSnapshotId" OR
     NEW.receipt->>'policyVersion' IS DISTINCT FROM NEW."policyVersion" OR
     NEW.receipt->>'policyHash' IS DISTINCT FROM NEW."policyHash" OR
     NEW.receipt->>'lifecycle' IS DISTINCT FROM NEW.lifecycle OR
     NEW.receipt->>'scoreability' IS DISTINCT FROM NEW.scoreability OR
     NEW.receipt->>'financialEligibility' IS DISTINCT FROM NEW."financialEligibility" OR
     NEW.receipt->>'classOutcome' IS DISTINCT FROM NEW."classOutcome" OR
     NEW.receipt->>'reason' IS DISTINCT FROM NEW.reason THEN
    RAISE EXCEPTION 'settlement receipt claims disagree with immutable identity';
  END IF;
  IF NEW.revision = 1 THEN
    IF NEW."supersedesSettlementReceiptId" IS NOT NULL OR result_source."supersedesResultVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'first settlement revision cannot skip result lineage';
    END IF;
  ELSE
    IF NEW."supersedesSettlementReceiptId" IS NULL THEN RAISE EXCEPTION 'settlement revision must link predecessor'; END IF;
    SELECT * INTO prior FROM "SettlementReceipt" WHERE id=NEW."supersedesSettlementReceiptId";
    IF prior.id IS NULL OR prior."fixtureId" <> NEW."fixtureId" OR prior.revision + 1 <> NEW.revision OR
       prior."forecastSnapshotId" <> NEW."forecastSnapshotId" OR result_source."supersedesResultVersionId" IS DISTINCT FROM prior."resultVersionId" THEN
      RAISE EXCEPTION 'settlement predecessor does not match result correction and revision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SettlementReceipt_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "SettlementReceipt" FOR EACH ROW EXECUTE FUNCTION guard_settlement_receipt();

CREATE OR REPLACE FUNCTION persist_settlement_receipt(
  p_id TEXT, p_fixture_id TEXT, p_result_version_id TEXT, p_forecast_snapshot_id TEXT,
  p_policy_version TEXT, p_policy_hash TEXT, p_lifecycle TEXT, p_scoreability TEXT,
  p_financial_eligibility TEXT, p_class_outcome TEXT, p_reason TEXT, p_receipt JSONB,
  p_settled_at TIMESTAMPTZ, p_supersedes_id TEXT DEFAULT NULL, p_requested_revision INTEGER DEFAULT NULL
) RETURNS TABLE (id TEXT, revision INTEGER, "supersedesSettlementReceiptId" TEXT) LANGUAGE plpgsql AS $$
DECLARE next_revision INTEGER;
DECLARE result_observed TIMESTAMPTZ;
DECLARE forecast_cutoff TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_fixture_id || ':settlement', 0));
  RETURN QUERY SELECT s.id,s.revision,s."supersedesSettlementReceiptId" FROM "SettlementReceipt" s
    WHERE s."resultVersionId"=p_result_version_id AND s."forecastSnapshotId"=p_forecast_snapshot_id AND s."policyHash"=p_policy_hash;
  IF FOUND THEN RETURN; END IF;
  SELECT COALESCE(MAX(s.revision),0)+1 INTO next_revision FROM "SettlementReceipt" s WHERE s."fixtureId"=p_fixture_id;
  IF p_requested_revision IS NOT NULL AND p_requested_revision <> next_revision THEN RAISE EXCEPTION 'settlement revision gap'; END IF;
  SELECT r."observedAt" INTO result_observed FROM "ResultVersion" r WHERE r.id=p_result_version_id;
  SELECT f.cutoff INTO forecast_cutoff FROM "ForecastSnapshot" f WHERE f.id=p_forecast_snapshot_id;
  INSERT INTO "SettlementReceipt" (id,"fixtureId","resultVersionId","forecastSnapshotId",revision,"supersedesSettlementReceiptId","policyVersion","policyHash",lifecycle,scoreability,"financialEligibility","classOutcome",reason,receipt,"resultObservedAt","forecastCutoff","settledAt")
  VALUES (p_id,p_fixture_id,p_result_version_id,p_forecast_snapshot_id,next_revision,p_supersedes_id,p_policy_version,p_policy_hash,p_lifecycle,p_scoreability,p_financial_eligibility,p_class_outcome,p_reason,p_receipt,result_observed,forecast_cutoff,p_settled_at);
  RETURN QUERY SELECT s.id,s.revision,s."supersedesSettlementReceiptId" FROM "SettlementReceipt" s WHERE s.id=p_id;
END;
$$;
