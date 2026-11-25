-- Phase 14: Asian handicap and exact score markets (D-13, D-15, D-16, D-17, D-18; MKT-03, MKT-04).
--
-- One forward migration widens, TOGETHER, the three objects that pin the market set of a value receipt and of its
-- settlement, so that the settlement can never be widened later than the value guard (a value receipt of an extended
-- market that the settlement cannot handle would roll back the whole Serializable settlement of the fixture):
--   * guard_value_pair()                   (trigger "ValueReceipt_validate_pair", NOT recreated)
--   * guard_value_settlement()             (trigger "ValueSettlement_guarded_append_only", NOT recreated)
--   * "ValueSettlement_result_check"       (dropped and re-added with the five-way result set)
--   * persist_value_settlement_v2(...)     (new; the six-argument persist_value_settlement stays as is)
-- Only CREATE OR REPLACE of functions is used: the append-only triggers are untouched, UPDATE and DELETE on
-- "ValueSettlement" keep being rejected, and no published migration is edited.
--
-- Objects that pin markets and are deliberately NOT touched (D-17: the forecast-scoring and calibration domain stays on
-- the three core markets): ForecastScore_market_check, guard_forecast_score, persist_forecast_score,
-- Calibrator_market_check, CalibratorEvent_market_check, guard_forecast_snapshot, persist_value_settlement (6 args).
--
-- Departures from the previous definitions that a reader should know about:
--   * The TS function settleExtendedMarket is the only PRODUCER of an extended result; the SQL here is an independent
--     VERIFIER (phase14_ah_result, phase14_exact_score_result). A parity test over 21 lines x 2 sides x 0..10 x 0..10
--     and over every exact-score selection keeps the two implementations identical.
--   * The probability of a receipt is recomputed in SQL from the stored score matrix only for PERSISTED receipts
--     (the matrix cellsHash of the forecast snapshot). For REDERIVED receipts (legacy snapshots without a persisted
--     matrix) the guard accepts the recorded numbers on self-consistency only: range [0,1], the five handicap
--     outcomes summing to 1 within 1e-9, and exact arithmetic of EV, fair odds and edge from them.
--   * The money arithmetic of flat-one-unit-v2 uses multiplication only (odds * 0.5 + 0.5 for a half win): numeric
--     division would round the 21st fractional digit of canonical odds, multiplication is exact.
--   * The views current_value_settlements and current_value_settlement_aggregate sum over ALL policies. The application
--     does not read them (verified by search); aggregation in the application keeps the policies apart. They are left
--     unchanged.
--
-- Operator note: this migration is applied to existing databases by `prisma migrate deploy` at rollout.

-- ---------------------------------------------------------------------------------------------------------------
-- Pure helper functions (no table access).
-- ---------------------------------------------------------------------------------------------------------------

-- Numeric parse that never raises: a malformed text becomes NULL, so a forged receipt is rejected by the guard's own
-- message instead of an input-syntax error.
CREATE OR REPLACE FUNCTION phase14_numeric(p_text TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_text IS NOT NULL AND p_text ~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN RETURN p_text::NUMERIC; END IF;
  RETURN NULL;
END;
$$;

-- Home-perspective line of an ASIAN_HANDICAP:<token> market id, or NULL. The cast happens only AFTER the whitelist
-- pattern matched (21 canonical tokens), so ASIAN_HANDICAP:abc and ASIAN_HANDICAP:+1.00 are never cast.
CREATE OR REPLACE FUNCTION phase14_market_line(p_market TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_market ~ '^ASIAN_HANDICAP:(0|[+-](0\.25|0\.5|0\.75|1|1\.25|1\.5|1\.75|2|2\.25|2\.5))$' THEN
    RETURN substring(p_market from 16)::NUMERIC;
  END IF;
  RETURN NULL;
END;
$$;

-- Rule ah-settlement-v1: side margin plus side line, a quarter line splits the stake over the two adjacent lines.
CREATE OR REPLACE FUNCTION phase14_ah_result(p_line NUMERIC, p_side TEXT, p_home INTEGER, p_away INTEGER) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE margin NUMERIC; side_line NUMERIC; legs NUMERIC[]; leg NUMERIC; adj NUMERIC; w INTEGER := 0; p INTEGER := 0; l INTEGER := 0; n INTEGER;
BEGIN
  margin := CASE p_side WHEN 'HOME' THEN p_home - p_away WHEN 'AWAY' THEN p_away - p_home END;
  side_line := CASE p_side WHEN 'HOME' THEN p_line WHEN 'AWAY' THEN -p_line END;
  IF margin IS NULL OR side_line IS NULL THEN RETURN NULL; END IF;
  IF (side_line * 2) = trunc(side_line * 2) THEN legs := ARRAY[side_line]; ELSE legs := ARRAY[side_line - 0.25, side_line + 0.25]; END IF;
  FOREACH leg IN ARRAY legs LOOP
    adj := margin + leg;
    IF adj > 0 THEN w := w + 1; ELSIF adj = 0 THEN p := p + 1; ELSE l := l + 1; END IF;
  END LOOP;
  n := w + p + l;
  RETURN CASE WHEN w = n THEN 'WIN' WHEN l = n THEN 'LOSS' WHEN p = n THEN 'PUSH' WHEN l = 0 THEN 'HALF_WIN' WHEN w = 0 THEN 'HALF_LOSS' END;
END;
$$;

-- Rule exact-score-settlement-v1: a listed score wins on exactly that final score, OTHER wins when either side scored above three.
CREATE OR REPLACE FUNCTION phase14_exact_score_result(p_selection TEXT, p_home INTEGER, p_away INTEGER) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_selection = 'OTHER' THEN RETURN CASE WHEN p_home > 3 OR p_away > 3 THEN 'WIN' ELSE 'LOSS' END; END IF;
  IF p_selection ~ '^[0-3]-[0-3]$' THEN
    RETURN CASE WHEN split_part(p_selection, '-', 1)::INTEGER = p_home AND split_part(p_selection, '-', 2)::INTEGER = p_away THEN 'WIN' ELSE 'LOSS' END;
  END IF;
  RETURN NULL;
END;
$$;

-- Probability of every handicap outcome over the stored score grid ([home, away, probability] triples).
CREATE OR REPLACE FUNCTION phase14_ah_breakdown(p_cells JSONB, p_line NUMERIC, p_side TEXT)
RETURNS TABLE(win NUMERIC, half_win NUMERIC, push NUMERIC, half_loss NUMERIC, loss NUMERIC) LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(SUM(t.p) FILTER (WHERE t.r = 'WIN'), 0), COALESCE(SUM(t.p) FILTER (WHERE t.r = 'HALF_WIN'), 0),
         COALESCE(SUM(t.p) FILTER (WHERE t.r = 'PUSH'), 0), COALESCE(SUM(t.p) FILTER (WHERE t.r = 'HALF_LOSS'), 0),
         COALESCE(SUM(t.p) FILTER (WHERE t.r = 'LOSS'), 0)
  FROM (
    SELECT phase14_ah_result(p_line, p_side, (c.value->>0)::INTEGER, (c.value->>1)::INTEGER) AS r, (c.value->>2)::NUMERIC AS p
    FROM jsonb_array_elements(p_cells) AS c(value)
  ) t
$$;

-- Probability of an exact-score selection over the stored grid; OTHER is max(0, 1 - sum of the sixteen listed scores).
CREATE OR REPLACE FUNCTION phase14_exact_score_probability(p_cells JSONB, p_selection TEXT) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE listed NUMERIC;
BEGIN
  IF p_selection = 'OTHER' THEN
    SELECT COALESCE(SUM((c.value->>2)::NUMERIC), 0) INTO listed FROM jsonb_array_elements(p_cells) AS c(value) WHERE (c.value->>0)::INTEGER <= 3 AND (c.value->>1)::INTEGER <= 3;
    RETURN GREATEST(0, 1 - listed);
  END IF;
  IF p_selection ~ '^[0-3]-[0-3]$' THEN
    SELECT COALESCE(SUM((c.value->>2)::NUMERIC), 0) INTO listed FROM jsonb_array_elements(p_cells) AS c(value)
      WHERE (c.value->>0)::INTEGER = split_part(p_selection, '-', 1)::INTEGER AND (c.value->>1)::INTEGER = split_part(p_selection, '-', 2)::INTEGER;
    RETURN listed;
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- guard_value_pair(): the branch of the three core markets is the previous definition, logically unchanged.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_value_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE forecast_fixture TEXT;
DECLARE forecast_state "ForecastSnapshotState";
DECLARE forecast_receipt JSONB;
DECLARE odds_fixture TEXT;
DECLARE odds_market TEXT;
DECLARE forecast_selection JSONB;
DECLARE odds_selection JSONB;
DECLARE audit_receipt JSONB;
DECLARE source_model_probability NUMERIC;
DECLARE source_decimal_odds NUMERIC;
DECLARE source_no_vig_probability NUMERIC;
DECLARE expected_edge NUMERIC;
DECLARE expected_value NUMERIC;
DECLARE expected_fair_odds NUMERIC;
DECLARE tolerance CONSTANT NUMERIC := 0.000000000001;
DECLARE sum_tolerance CONSTANT NUMERIC := 0.000000001;
DECLARE ext JSONB;
DECLARE ext_line NUMERIC;
DECLARE matrix_cells JSONB;
DECLARE matrix_hash TEXT;
DECLARE persisted BOOLEAN;
DECLARE recorded_reason TEXT;
DECLARE b_win NUMERIC; DECLARE b_half_win NUMERIC; DECLARE b_push NUMERIC; DECLARE b_half_loss NUMERIC; DECLARE b_loss NUMERIC;
DECLARE s_win NUMERIC; DECLARE s_half_win NUMERIC; DECLARE s_push NUMERIC; DECLARE s_half_loss NUMERIC; DECLARE s_loss NUMERIC;
DECLARE eff_win NUMERIC; DECLARE eff_lose NUMERIC; DECLARE conditional_win NUMERIC; DECLARE recorded_probability NUMERIC;
BEGIN
  SELECT "fixtureId", state, receipt INTO forecast_fixture, forecast_state, forecast_receipt
  FROM "ForecastSnapshot" WHERE id=NEW."forecastSnapshotId";
  SELECT "fixtureId", market INTO odds_fixture, odds_market
  FROM "ManualOddsSnapshot" WHERE id=NEW."oddsSnapshotId";

  IF forecast_fixture IS NULL OR odds_fixture IS NULL
     OR forecast_fixture <> NEW."fixtureId" OR odds_fixture <> NEW."fixtureId"
     OR odds_market <> NEW.market OR forecast_state <> 'ISSUED' THEN
    RAISE EXCEPTION 'value receipt requires exact issued forecast and odds pair for fixture and market';
  END IF;

  ext_line := phase14_market_line(NEW.market);
  IF NEW.market = 'EXACT_SCORE' OR left(NEW.market, 15) = 'ASIAN_HANDICAP:' THEN
    -- Extended branch (D-13): no ForecastMarket row exists for these markets; the numbers are recomputed from the
    -- immutable odds snapshot and, for a persisted matrix, from the stored score grid of the forecast snapshot.
    IF NEW.market <> 'EXACT_SCORE' AND ext_line IS NULL THEN
      RAISE EXCEPTION 'value receipt market is not a supported extended market';
    END IF;

    SELECT candidate.value INTO odds_selection
    FROM "ManualOddsSnapshot" snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.receipt->'selections') AS candidate(value)
    WHERE snapshot.id=NEW."oddsSnapshotId"
      AND candidate.value->>'selection'=NEW.selection;
    IF odds_selection IS NULL THEN
      RAISE EXCEPTION 'value receipt selection must exist in both immutable source snapshots';
    END IF;
    IF NEW.market = 'EXACT_SCORE' THEN
      IF NEW.selection !~ '^([0-3]-[0-3]|OTHER)$' THEN RAISE EXCEPTION 'value receipt selection must exist in both immutable source snapshots'; END IF;
    ELSIF NEW.selection NOT IN ('HOME', 'AWAY') THEN
      RAISE EXCEPTION 'value receipt selection must exist in both immutable source snapshots';
    END IF;

    audit_receipt := COALESCE(NEW.receipt->'receipt', NEW.receipt);
    ext := audit_receipt->'extended';
    IF ext IS NULL OR jsonb_typeof(ext) <> 'object' THEN
      RAISE EXCEPTION 'extended value receipt requires an extended block';
    END IF;
    source_decimal_odds := phase14_numeric(odds_selection->>'decimalOdds');
    source_no_vig_probability := phase14_numeric(odds_selection->>'noVigProbability');
    IF source_decimal_odds IS NULL OR source_no_vig_probability IS NULL THEN
      RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
    END IF;

    -- Matrix binding: a forecast with a persisted score matrix pins the receipt to its cellsHash and the probabilities
    -- are recomputed from the stored cells; a legacy forecast is accepted on self-consistency only.
    matrix_hash := forecast_receipt->'scoreMatrix'->>'cellsHash';
    persisted := matrix_hash IS NOT NULL;
    IF persisted THEN
      matrix_cells := forecast_receipt->'scoreMatrix'->'cells';
      IF matrix_cells IS NULL OR jsonb_typeof(matrix_cells) <> 'array' OR jsonb_array_length(matrix_cells) <> 64
         OR ext->'matrix'->>'source' IS DISTINCT FROM 'PERSISTED' OR ext->'matrix'->>'cellsHash' IS DISTINCT FROM matrix_hash THEN
        RAISE EXCEPTION 'extended value receipt matrix binding is inconsistent';
      END IF;
    ELSIF ext->'matrix'->>'source' IS DISTINCT FROM 'REDERIVED' THEN
      RAISE EXCEPTION 'extended value receipt matrix binding is inconsistent';
    END IF;

    IF NEW."modelProbability" IS NULL OR NEW."noVigProbability" IS NULL OR NEW.edge IS NULL OR NEW."expectedValue" IS NULL
       OR audit_receipt->>'decimalOdds' IS NULL OR audit_receipt->>'modelProbability' IS NULL OR audit_receipt->>'noVigProbability' IS NULL
       OR phase14_numeric(NEW."modelProbability") IS NULL OR phase14_numeric(NEW."noVigProbability") IS NULL
       OR phase14_numeric(NEW.edge) IS NULL OR phase14_numeric(NEW."expectedValue") IS NULL
       OR phase14_numeric(audit_receipt->>'decimalOdds') IS NULL OR phase14_numeric(audit_receipt->>'modelProbability') IS NULL
       OR phase14_numeric(audit_receipt->>'noVigProbability') IS NULL
       OR (NEW."fairOdds" IS NOT NULL AND phase14_numeric(NEW."fairOdds") IS NULL) THEN
      RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
    END IF;
    recorded_reason := ext->>'fairOddsUnavailableReason';

    IF NEW.market = 'EXACT_SCORE' THEN
      IF ext->>'kind' IS DISTINCT FROM 'EXACT_SCORE' OR ext->>'exactScoreBucketsVersion' IS DISTINCT FROM 'exact-score-buckets-v1' THEN
        RAISE EXCEPTION 'extended value receipt kind does not match the market';
      END IF;
      recorded_probability := phase14_numeric(NEW."modelProbability");
      IF persisted THEN
        source_model_probability := phase14_exact_score_probability(matrix_cells, NEW.selection);
        IF source_model_probability IS NULL OR abs(recorded_probability - source_model_probability) > tolerance THEN
          RAISE EXCEPTION 'extended value receipt probability disagrees with the stored score matrix';
        END IF;
      ELSE
        IF recorded_probability < 0 OR recorded_probability > 1 THEN RAISE EXCEPTION 'extended value receipt probability is out of range'; END IF;
        source_model_probability := recorded_probability;
      END IF;
      expected_edge := source_model_probability - source_no_vig_probability;
      expected_value := source_model_probability * source_decimal_odds - 1;
      IF source_model_probability > 0 THEN expected_fair_odds := 1 / source_model_probability; ELSE expected_fair_odds := NULL; END IF;
      IF expected_fair_odds IS NULL THEN
        IF NEW."fairOdds" IS NOT NULL OR recorded_reason IS DISTINCT FROM 'ZERO_PROBABILITY' THEN
          RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
        END IF;
      ELSIF NEW."fairOdds" IS NULL OR recorded_reason IS NOT NULL
            OR abs(phase14_numeric(NEW."fairOdds") - expected_fair_odds) > tolerance * GREATEST(1, abs(expected_fair_odds)) THEN
        RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
      END IF;
    ELSE
      IF ext->>'kind' IS DISTINCT FROM 'ASIAN_HANDICAP' OR ext->>'evPolicyVersion' IS DISTINCT FROM 'push-aware-ev-v1'
         OR ext->>'edgeDefinition' IS DISTINCT FROM 'conditional-win-probability-minus-no-vig'
         OR ext->>'line' IS DISTINCT FROM substring(NEW.market from 16) OR ext->>'side' IS DISTINCT FROM NEW.selection THEN
        RAISE EXCEPTION 'extended value receipt kind does not match the market';
      END IF;
      -- A half win returns odds * 0.5 + 0.5, one digit longer than the odds; a return that no longer fits the VARCHAR(128)
      -- money columns would abort the whole Serializable settlement of the fixture, so such a receipt is refused here.
      IF char_length(trim_scale(source_decimal_odds * 0.5 + 0.5)::TEXT) > 128 THEN
        RAISE EXCEPTION 'decimal odds are too precise for flat-one-unit-v2 settlement';
      END IF;
      b_win := phase14_numeric(ext->'breakdown'->>'WIN'); b_half_win := phase14_numeric(ext->'breakdown'->>'HALF_WIN');
      b_push := phase14_numeric(ext->'breakdown'->>'PUSH'); b_half_loss := phase14_numeric(ext->'breakdown'->>'HALF_LOSS');
      b_loss := phase14_numeric(ext->'breakdown'->>'LOSS');
      IF b_win IS NULL OR b_half_win IS NULL OR b_push IS NULL OR b_half_loss IS NULL OR b_loss IS NULL
         OR LEAST(b_win, b_half_win, b_push, b_half_loss, b_loss) < 0 OR GREATEST(b_win, b_half_win, b_push, b_half_loss, b_loss) > 1
         OR abs(b_win + b_half_win + b_push + b_half_loss + b_loss - 1) > sum_tolerance THEN
        RAISE EXCEPTION 'extended value receipt breakdown is inconsistent';
      END IF;
      IF persisted THEN
        SELECT win, half_win, push, half_loss, loss INTO s_win, s_half_win, s_push, s_half_loss, s_loss
        FROM phase14_ah_breakdown(matrix_cells, ext_line, NEW.selection);
        IF abs(b_win - s_win) > tolerance OR abs(b_half_win - s_half_win) > tolerance OR abs(b_push - s_push) > tolerance
           OR abs(b_half_loss - s_half_loss) > tolerance OR abs(b_loss - s_loss) > tolerance THEN
          RAISE EXCEPTION 'extended value receipt breakdown disagrees with the stored score matrix';
        END IF;
      END IF;
      eff_win := b_win + b_half_win / 2;
      eff_lose := b_loss + b_half_loss / 2;
      IF eff_win + eff_lose > 0 THEN conditional_win := eff_win / (eff_win + eff_lose); ELSE conditional_win := 0; END IF;
      source_model_probability := eff_win;
      expected_edge := conditional_win - source_no_vig_probability;
      expected_value := b_win * (source_decimal_odds - 1) + b_half_win * (source_decimal_odds - 1) / 2 - b_half_loss / 2 - b_loss;
      IF eff_win > 0 THEN expected_fair_odds := 1 + eff_lose / eff_win; ELSE expected_fair_odds := NULL; END IF;
      IF expected_fair_odds IS NULL THEN
        IF NEW."fairOdds" IS NOT NULL OR recorded_reason IS DISTINCT FROM 'NO_WIN_PROBABILITY' THEN
          RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
        END IF;
      ELSIF NEW."fairOdds" IS NULL OR recorded_reason IS NOT NULL
            OR abs(phase14_numeric(NEW."fairOdds") - expected_fair_odds) > tolerance * GREATEST(1, abs(expected_fair_odds)) THEN
        RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
      END IF;
    END IF;

    IF abs(phase14_numeric(NEW."modelProbability") - source_model_probability) > tolerance
       OR abs(phase14_numeric(NEW."noVigProbability") - source_no_vig_probability) > tolerance
       OR abs(phase14_numeric(NEW.edge) - expected_edge) > tolerance
       OR abs(phase14_numeric(NEW."expectedValue") - expected_value) > tolerance * GREATEST(1, abs(expected_value))
       OR audit_receipt->>'market' IS DISTINCT FROM NEW.market
       OR audit_receipt->>'selection' IS DISTINCT FROM NEW.selection
       OR abs(phase14_numeric(audit_receipt->>'decimalOdds') - source_decimal_odds) > tolerance
       OR abs(phase14_numeric(audit_receipt->>'modelProbability') - source_model_probability) > tolerance
       OR abs(phase14_numeric(audit_receipt->>'noVigProbability') - source_no_vig_probability) > tolerance THEN
      RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
    END IF;
    RETURN NEW;
  END IF;

  -- Core-market branch: the previous definition, logically unchanged.
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

  audit_receipt := COALESCE(NEW.receipt->'receipt', NEW.receipt);
  source_model_probability := (forecast_selection->>'probability')::NUMERIC;
  source_decimal_odds := (odds_selection->>'decimalOdds')::NUMERIC;
  source_no_vig_probability := (odds_selection->>'noVigProbability')::NUMERIC;
  expected_edge := source_model_probability - source_no_vig_probability;
  expected_value := source_model_probability * source_decimal_odds - 1;
  expected_fair_odds := 1 / source_model_probability;

  IF NEW."modelProbability" IS NULL OR NEW."noVigProbability" IS NULL
     OR NEW."fairOdds" IS NULL OR NEW.edge IS NULL OR NEW."expectedValue" IS NULL
     OR audit_receipt->>'decimalOdds' IS NULL
     OR audit_receipt->>'modelProbability' IS NULL
     OR audit_receipt->>'noVigProbability' IS NULL
     OR abs(NEW."modelProbability"::NUMERIC - source_model_probability) > tolerance
     OR abs(NEW."noVigProbability"::NUMERIC - source_no_vig_probability) > tolerance
     OR abs(NEW."fairOdds"::NUMERIC - expected_fair_odds) > tolerance
     OR abs(NEW.edge::NUMERIC - expected_edge) > tolerance
     OR abs(NEW."expectedValue"::NUMERIC - expected_value) > tolerance
     OR audit_receipt->>'market' IS DISTINCT FROM NEW.market
     OR audit_receipt->>'selection' IS DISTINCT FROM NEW.selection
     OR abs((audit_receipt->>'decimalOdds')::NUMERIC - source_decimal_odds) > tolerance
     OR abs((audit_receipt->>'modelProbability')::NUMERIC - source_model_probability) > tolerance
     OR abs((audit_receipt->>'noVigProbability')::NUMERIC - source_no_vig_probability) > tolerance THEN
    RAISE EXCEPTION 'value receipt derived fields disagree with immutable source snapshots';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- guard_value_settlement(): v1 (three core markets) is the previous logic; v2 (extended markets) is new (D-15, D-16).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_value_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "SettlementReceipt"%ROWTYPE; DECLARE v "ValueReceipt"%ROWTYPE; DECLARE o "ManualOddsSelection"%ROWTYPE;
DECLARE os "ManualOddsSnapshot"%ROWTYPE; DECLARE r "ResultVersion"%ROWTYPE; DECLARE fx "Fixture"%ROWTYPE;
DECLARE c "ClosingOddsObservation"%ROWTYPE; DECLARE prior "ValueSettlement"%ROWTYPE;
DECLARE expected_result TEXT; DECLARE expected_return NUMERIC; DECLARE expected_profit NUMERIC;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ValueSettlement is immutable'; END IF;
  SELECT * INTO s FROM "SettlementReceipt" WHERE id=NEW."settlementReceiptId";
  SELECT * INTO v FROM "ValueReceipt" WHERE id=NEW."valueReceiptId";
  SELECT * INTO o FROM "ManualOddsSelection" WHERE id=NEW."oddsSelectionId";
  SELECT * INTO os FROM "ManualOddsSnapshot" WHERE id=o."oddsSnapshotId";
  SELECT * INTO r FROM "ResultVersion" WHERE id=s."resultVersionId";
  SELECT * INTO fx FROM "Fixture" WHERE id=s."fixtureId";
  IF s.id IS NULL OR v.id IS NULL OR o.id IS NULL OR r.id IS NULL OR fx.id IS NULL OR s."financialEligibility"<>'ELIGIBLE' OR s.lifecycle<>'FINISHED' OR v.outcome<>'VALUE_CANDIDATE' THEN RAISE EXCEPTION 'value settlement requires an eligible VALUE_CANDIDATE'; END IF;
  IF NEW."fixtureId"<>s."fixtureId" OR v."fixtureId"<>s."fixtureId" OR v."forecastSnapshotId"<>s."forecastSnapshotId" OR os."fixtureId"<>s."fixtureId" OR v."oddsSnapshotId"<>os.id OR NEW.market<>v.market OR os.market<>v.market OR NEW.selection<>v.selection OR o.selection<>v.selection THEN RAISE EXCEPTION 'value/odds/selection identity mismatch'; END IF;
  IF NEW."policyVersion"='flat-one-unit-v2' THEN
    -- The policy is bound to the market family: v2 settles only the extended markets.
    expected_result:=CASE
      WHEN v.market='EXACT_SCORE' THEN phase14_exact_score_result(v.selection, r."homeGoals", r."awayGoals")
      WHEN phase14_market_line(v.market) IS NOT NULL THEN phase14_ah_result(phase14_market_line(v.market), v.selection, r."homeGoals", r."awayGoals")
    END;
    IF expected_result IS NULL OR NEW.result<>expected_result THEN RAISE EXCEPTION 'value result identity is inconsistent'; END IF;
    expected_return:=CASE expected_result WHEN 'WIN' THEN o."decimalOdds"::numeric WHEN 'HALF_WIN' THEN o."decimalOdds"::numeric*0.5+0.5 WHEN 'PUSH' THEN 1 WHEN 'HALF_LOSS' THEN 0.5 ELSE 0 END; expected_profit:=expected_return-1;
  ELSE
    expected_result:=CASE v.market
      WHEN 'ONE_X_TWO' THEN CASE v.selection WHEN 'HOME' THEN CASE WHEN r."homeGoals">r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'DRAW' THEN CASE WHEN r."homeGoals"=r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'AWAY' THEN CASE WHEN r."awayGoals">r."homeGoals" THEN 'WIN' ELSE 'LOSS' END END
      WHEN 'OVER_UNDER_2_5' THEN CASE v.selection WHEN 'OVER_2_5' THEN CASE WHEN r."homeGoals"+r."awayGoals">2 THEN 'WIN' ELSE 'LOSS' END WHEN 'UNDER_2_5' THEN CASE WHEN r."homeGoals"+r."awayGoals"<3 THEN 'WIN' ELSE 'LOSS' END END
      WHEN 'BTTS' THEN CASE v.selection WHEN 'YES' THEN CASE WHEN r."homeGoals">0 AND r."awayGoals">0 THEN 'WIN' ELSE 'LOSS' END WHEN 'NO' THEN CASE WHEN r."homeGoals"=0 OR r."awayGoals"=0 THEN 'WIN' ELSE 'LOSS' END END END;
    IF expected_result IS NULL OR NEW.result<>expected_result THEN RAISE EXCEPTION 'value result identity is inconsistent'; END IF;
    expected_return:=CASE expected_result WHEN 'WIN' THEN o."decimalOdds"::numeric WHEN 'VOID' THEN 1 ELSE 0 END; expected_profit:=expected_return-1;
  END IF;
  IF NEW."policyVersion" NOT IN ('flat-one-unit-v1','flat-one-unit-v2') OR NEW."stakeUnits"::numeric<>1 OR NEW."returnUnits"::numeric<>expected_return OR NEW."profitUnits"::numeric<>expected_profit THEN RAISE EXCEPTION 'flat-unit profit arithmetic is inconsistent'; END IF;
  IF os."submittedAt">=fx."kickoffUtc" THEN RAISE EXCEPTION 'candidate timestamp must be pre-kickoff'; END IF;
  IF NEW."closingOddsObservationId" IS NULL THEN
    IF NEW."clvStatus"<>'UNAVAILABLE' OR NEW."clvReason"<>'CLOSING_OBSERVATION_MISSING' OR NEW."closingOdds" IS NOT NULL OR NEW.clv IS NOT NULL THEN RAISE EXCEPTION 'unavailable CLV receipt is inconsistent'; END IF;
  ELSE
    SELECT * INTO c FROM "ClosingOddsObservation" WHERE id=NEW."closingOddsObservationId";
    IF c.id IS NULL OR c."fixtureId"<>v."fixtureId" OR c.market<>v.market OR c.selection<>v.selection OR c."oddsFormat"<>'DECIMAL' OR c."sourceConvention"<>os.source OR c."observationKind"<>'MARKET_CLOSE' THEN RAISE EXCEPTION 'closing source is not an exact comparable tuple'; END IF;
    IF c."observedAt"<os."submittedAt" OR c."observedAt">=fx."kickoffUtc" THEN RAISE EXCEPTION 'closing timestamp is not comparable'; END IF;
    IF NEW."clvStatus"<>'AVAILABLE' OR NEW."clvReason" IS NOT NULL OR NEW."candidateOdds"::numeric<>o."decimalOdds"::numeric OR NEW."candidateObservedAt"<>os."submittedAt" OR NEW."closingOdds"::numeric<>c."decimalOdds"::numeric OR NEW."closingObservedAt"<>c."observedAt" OR NEW.clv::numeric<>(o."decimalOdds"::numeric/c."decimalOdds"::numeric-1) THEN RAISE EXCEPTION 'CLV arithmetic or tuple is inconsistent'; END IF;
  END IF;
  IF NEW."clvPolicyVersion"<>'odds-ratio-clv-v1' THEN RAISE EXCEPTION 'CLV policy identity is inconsistent'; END IF;
  IF NEW.receipt->>'valueReceiptId' IS DISTINCT FROM NEW."valueReceiptId" OR NEW.receipt->>'settlementReceiptId' IS DISTINCT FROM NEW."settlementReceiptId" OR NEW.receipt->>'policyVersion' IS DISTINCT FROM NEW."policyVersion" THEN RAISE EXCEPTION 'value settlement receipt identity disagrees'; END IF;
  IF NEW."supersedesValueSettlementId" IS NOT NULL THEN SELECT * INTO prior FROM "ValueSettlement" WHERE id=NEW."supersedesValueSettlementId"; IF prior.id IS NULL OR prior."valueReceiptId"<>NEW."valueReceiptId" OR prior."policyVersion"<>NEW."policyVersion" OR s."supersedesSettlementReceiptId" IS DISTINCT FROM prior."settlementReceiptId" THEN RAISE EXCEPTION 'value settlement correction predecessor mismatch'; END IF; ELSIF s."supersedesSettlementReceiptId" IS NOT NULL THEN RAISE EXCEPTION 'value settlement correction requires predecessor'; END IF;
  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Result set of a settlement: the three-way values plus the five-way handicap values.
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE "ValueSettlement" DROP CONSTRAINT "ValueSettlement_result_check";
ALTER TABLE "ValueSettlement" ADD CONSTRAINT "ValueSettlement_result_check" CHECK (result IN ('WIN','LOSS','VOID','HALF_WIN','HALF_LOSS','PUSH'));

-- ---------------------------------------------------------------------------------------------------------------
-- persist_value_settlement_v2: the flat-one-unit-v2 twin of persist_value_settlement. The RESULT is produced by the
-- application (settleExtendedMarket) and passed in; the guard above recomputes it independently from ResultVersion.
-- The money arithmetic is computed here from (result, odds) and never supplied by the caller.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION persist_value_settlement_v2(p_id TEXT,p_settlement_id TEXT,p_value_id TEXT,p_odds_selection_id TEXT,p_closing_id TEXT,p_supersedes TEXT,p_result TEXT)
RETURNS TABLE(id TEXT,"supersedesValueSettlementId" TEXT) LANGUAGE plpgsql AS $$
DECLARE v "ValueReceipt"%ROWTYPE; DECLARE o "ManualOddsSelection"%ROWTYPE; DECLARE os "ManualOddsSnapshot"%ROWTYPE; DECLARE c "ClosingOddsObservation"%ROWTYPE; DECLARE returned NUMERIC; DECLARE receipt_value JSONB;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('WIN','HALF_WIN','PUSH','HALF_LOSS','LOSS') THEN RAISE EXCEPTION 'value settlement v2 result is not an extended result'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_settlement_id||':'||p_value_id||':flat-one-unit-v2',0));
  RETURN QUERY SELECT q.id,q."supersedesValueSettlementId" FROM "ValueSettlement" q WHERE q."settlementReceiptId"=p_settlement_id AND q."valueReceiptId"=p_value_id AND q."policyVersion"='flat-one-unit-v2'; IF FOUND THEN RETURN; END IF;
  SELECT * INTO v FROM "ValueReceipt" WHERE "ValueReceipt".id=p_value_id; SELECT * INTO o FROM "ManualOddsSelection" WHERE "ManualOddsSelection".id=p_odds_selection_id; SELECT * INTO os FROM "ManualOddsSnapshot" WHERE "ManualOddsSnapshot".id=o."oddsSnapshotId";
  returned:=CASE p_result WHEN 'WIN' THEN o."decimalOdds"::numeric WHEN 'HALF_WIN' THEN o."decimalOdds"::numeric*0.5+0.5 WHEN 'PUSH' THEN 1 WHEN 'HALF_LOSS' THEN 0.5 ELSE 0 END;
  receipt_value:=jsonb_build_object('settlementReceiptId',p_settlement_id,'valueReceiptId',p_value_id,'policyVersion','flat-one-unit-v2','clvPolicyVersion','odds-ratio-clv-v1');
  IF p_closing_id IS NULL THEN INSERT INTO "ValueSettlement"(id,"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","clvReason","candidateOdds","candidateObservedAt","clvPolicyVersion","supersedesValueSettlementId",receipt) VALUES(p_id,p_settlement_id,p_value_id,p_odds_selection_id,v."fixtureId",v.market,v.selection,p_result,'1',trim_scale(returned)::text,trim_scale(returned-1)::text,'flat-one-unit-v2','UNAVAILABLE','CLOSING_OBSERVATION_MISSING',o."decimalOdds",os."submittedAt",'odds-ratio-clv-v1',p_supersedes,receipt_value);
  ELSE SELECT * INTO c FROM "ClosingOddsObservation" WHERE "ClosingOddsObservation".id=p_closing_id; INSERT INTO "ValueSettlement"(id,"settlementReceiptId","valueReceiptId","oddsSelectionId","closingOddsObservationId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","candidateOdds","candidateObservedAt","closingOdds","closingObservedAt",clv,"clvPolicyVersion","supersedesValueSettlementId",receipt) VALUES(p_id,p_settlement_id,p_value_id,p_odds_selection_id,p_closing_id,v."fixtureId",v.market,v.selection,p_result,'1',trim_scale(returned)::text,trim_scale(returned-1)::text,'flat-one-unit-v2','AVAILABLE',o."decimalOdds",os."submittedAt",c."decimalOdds",c."observedAt",trim_scale(o."decimalOdds"::numeric/c."decimalOdds"::numeric-1)::text,'odds-ratio-clv-v1',p_supersedes,receipt_value); END IF;
  RETURN QUERY SELECT q.id,q."supersedesValueSettlementId" FROM "ValueSettlement" q WHERE q.id=p_id;
END; $$;
