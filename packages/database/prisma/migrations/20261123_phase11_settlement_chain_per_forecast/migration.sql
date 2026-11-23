-- Forward-only: the SettlementReceipt revision chain belongs to a forecast, not to a fixture.
--
-- Why: persist_settlement_receipt numbered revisions as MAX(revision per fixtureId)+1, while
-- guard_settlement_receipt requires every revision > 1 to link a predecessor of the SAME
-- forecastSnapshotId. A second forecast of an already settled fixture therefore got revision 2
-- without a predecessor and failed with "settlement revision must link predecessor"
-- (UAT test 2, MODEL-03). The guard is already correct and is intentionally NOT redefined here.
--
-- Rollback: only through a new forward migration that restores UNIQUE ("fixtureId","revision")
-- and the previous function body. That is possible only while no fixture has two chains (the
-- old UNIQUE would be violated by the second forecast of a fixture); beyond that point recovery
-- is a restore from backup. Rolling back the function alone is unsafe: it would break the
-- second forecast again and mis-number result corrections.
--
-- Existing rows are never updated, deleted or backfilled (D-04).

DO $$
DECLARE broken INTEGER;
BEGIN
  SELECT count(*) INTO broken FROM (
    SELECT 1 FROM "SettlementReceipt"
    GROUP BY "fixtureId", "forecastSnapshotId"
    HAVING min("revision") <> 1 OR max("revision") <> count(*)
  ) chains;
  IF broken > 0 THEN
    RAISE EXCEPTION 'SettlementReceipt chains are not contiguous per forecast (% broken chain(s))', broken;
  END IF;
END;
$$;

ALTER TABLE "SettlementReceipt" DROP CONSTRAINT "SettlementReceipt_fixtureId_revision_key";

CREATE UNIQUE INDEX "SettlementReceipt_fixtureId_forecastSnapshotId_revision_key"
  ON "SettlementReceipt" ("fixtureId", "forecastSnapshotId", "revision");

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
  SELECT COALESCE(MAX(s.revision),0)+1 INTO next_revision FROM "SettlementReceipt" s
    WHERE s."fixtureId"=p_fixture_id AND s."forecastSnapshotId"=p_forecast_snapshot_id;
  IF p_requested_revision IS NOT NULL AND p_requested_revision <> next_revision THEN RAISE EXCEPTION 'settlement revision gap'; END IF;
  SELECT r."observedAt" INTO result_observed FROM "ResultVersion" r WHERE r.id=p_result_version_id;
  SELECT f.cutoff INTO forecast_cutoff FROM "ForecastSnapshot" f WHERE f.id=p_forecast_snapshot_id;
  INSERT INTO "SettlementReceipt" (id,"fixtureId","resultVersionId","forecastSnapshotId",revision,"supersedesSettlementReceiptId","policyVersion","policyHash",lifecycle,scoreability,"financialEligibility","classOutcome",reason,receipt,"resultObservedAt","forecastCutoff","settledAt")
  VALUES (p_id,p_fixture_id,p_result_version_id,p_forecast_snapshot_id,next_revision,p_supersedes_id,p_policy_version,p_policy_hash,p_lifecycle,p_scoreability,p_financial_eligibility,p_class_outcome,p_reason,p_receipt,result_observed,forecast_cutoff,p_settled_at);
  RETURN QUERY SELECT s.id,s.revision,s."supersedesSettlementReceiptId" FROM "SettlementReceipt" s WHERE s.id=p_id;
END;
$$;
