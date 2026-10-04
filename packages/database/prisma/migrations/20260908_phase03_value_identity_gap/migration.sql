UPDATE "ValueReceipt"
SET selection = receipt->>'selection'
WHERE selection IS NULL AND receipt ? 'selection';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ValueReceipt" WHERE selection IS NULL) THEN
    RAISE EXCEPTION 'cannot migrate value receipts without selection provenance';
  END IF;
END;
$$;

ALTER TABLE "ValueReceipt" ALTER COLUMN selection SET NOT NULL;
ALTER TABLE "ValueReceipt" DROP CONSTRAINT "ValueReceipt_forecastSnapshotId_oddsSnapshotId_key";
ALTER TABLE "ValueReceipt"
  ADD CONSTRAINT "ValueReceipt_forecastSnapshotId_oddsSnapshotId_market_selection_key"
  UNIQUE ("forecastSnapshotId", "oddsSnapshotId", market, selection);

CREATE OR REPLACE FUNCTION guard_value_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE forecast_fixture TEXT;
DECLARE forecast_state "ForecastSnapshotState";
DECLARE odds_fixture TEXT;
DECLARE odds_market TEXT;
DECLARE forecast_selection JSONB;
DECLARE odds_selection JSONB;
DECLARE source_model_probability NUMERIC;
DECLARE source_decimal_odds NUMERIC;
DECLARE source_no_vig_probability NUMERIC;
DECLARE expected_edge NUMERIC;
DECLARE expected_value NUMERIC;
DECLARE expected_fair_odds NUMERIC;
DECLARE tolerance CONSTANT NUMERIC := 0.000000000001;
BEGIN
  SELECT "fixtureId", state INTO forecast_fixture, forecast_state
  FROM "ForecastSnapshot" WHERE id=NEW."forecastSnapshotId";
  SELECT "fixtureId", market INTO odds_fixture, odds_market
  FROM "ManualOddsSnapshot" WHERE id=NEW."oddsSnapshotId";

  IF forecast_fixture IS NULL OR odds_fixture IS NULL
     OR forecast_fixture <> NEW."fixtureId" OR odds_fixture <> NEW."fixtureId"
     OR odds_market <> NEW.market OR forecast_state <> 'ISSUED' THEN
    RAISE EXCEPTION 'value receipt requires exact issued forecast and odds pair for fixture and market';
  END IF;

  SELECT probability.value INTO forecast_selection
  FROM "ForecastMarket" fm
  CROSS JOIN LATERAL jsonb_array_elements(fm.probabilities) AS probability(value)
  WHERE fm."forecastSnapshotId"=NEW."forecastSnapshotId"
    AND fm.market=NEW.market
    AND probability.value->>'selection'=NEW.selection;

  SELECT candidate.value INTO odds_selection
  FROM "ManualOddsSnapshot" snapshot
  CROSS JOIN LATERAL jsonb_array_elements(snapshot.receipt->'selections') AS candidate(value)
  WHERE snapshot.id=NEW."oddsSnapshotId"
    AND candidate.value->>'selection'=NEW.selection;

  IF forecast_selection IS NULL OR odds_selection IS NULL THEN
    RAISE EXCEPTION 'value receipt selection must exist in both immutable source snapshots';
  END IF;

  source_model_probability := (forecast_selection->>'probability')::NUMERIC;
  source_decimal_odds := (odds_selection->>'decimalOdds')::NUMERIC;
  source_no_vig_probability := (odds_selection->>'noVigProbability')::NUMERIC;
  expected_edge := source_model_probability - source_no_vig_probability;
  expected_value := source_model_probability * source_decimal_odds - 1;
  expected_fair_odds := 1 / source_model_probability;

  IF NEW."modelProbability" IS NULL OR NEW."noVigProbability" IS NULL
     OR NEW."fairOdds" IS NULL OR NEW.edge IS NULL OR NEW."expectedValue" IS NULL
     OR NEW.receipt->>'decimalOdds' IS NULL
     OR NEW.receipt->>'modelProbability' IS NULL
     OR NEW.receipt->>'noVigProbability' IS NULL
     OR abs(NEW."modelProbability"::NUMERIC - source_model_probability) > tolerance
     OR abs(NEW."noVigProbability"::NUMERIC - source_no_vig_probability) > tolerance
     OR abs(NEW."fairOdds"::NUMERIC - expected_fair_odds) > tolerance
     OR abs(NEW.edge::NUMERIC - expected_edge) > tolerance
     OR abs(NEW."expectedValue"::NUMERIC - expected_value) > tolerance
     OR NEW.receipt->>'market' IS DISTINCT FROM NEW.market
     OR NEW.receipt->>'selection' IS DISTINCT FROM NEW.selection
     OR abs((NEW.receipt->>'decimalOdds')::NUMERIC - source_decimal_odds) > tolerance
     OR abs((NEW.receipt->>'modelProbability')::NUMERIC - source_model_probability) > tolerance
     OR abs((NEW.receipt->>'noVigProbability')::NUMERIC - source_no_vig_probability) > tolerance THEN
    RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
  END IF;
  RETURN NEW;
END;
$$;
