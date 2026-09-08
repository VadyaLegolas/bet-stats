CREATE TABLE "ClosingOddsObservation" (
  id TEXT PRIMARY KEY, "fixtureId" TEXT NOT NULL REFERENCES "Fixture"(id) ON DELETE RESTRICT,
  market TEXT NOT NULL, selection TEXT NOT NULL, "decimalOdds" VARCHAR(128) NOT NULL,
  "oddsFormat" TEXT NOT NULL, "sourceConvention" TEXT NOT NULL, "observationKind" TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ClosingOddsObservation_fixtureId_market_selection_observedAt_idx" ON "ClosingOddsObservation"("fixtureId",market,selection,"observedAt");

CREATE TABLE "ValueSettlement" (
  id TEXT PRIMARY KEY,
  "settlementReceiptId" TEXT NOT NULL REFERENCES "SettlementReceipt"(id) ON DELETE RESTRICT,
  "valueReceiptId" TEXT NOT NULL REFERENCES "ValueReceipt"(id) ON DELETE RESTRICT,
  "oddsSelectionId" TEXT NOT NULL REFERENCES "ManualOddsSelection"(id) ON DELETE RESTRICT,
  "closingOddsObservationId" TEXT REFERENCES "ClosingOddsObservation"(id) ON DELETE RESTRICT,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"(id) ON DELETE RESTRICT,
  market TEXT NOT NULL, selection TEXT NOT NULL, result TEXT NOT NULL CHECK (result IN ('WIN','LOSS','VOID')),
  "stakeUnits" VARCHAR(128) NOT NULL, "returnUnits" VARCHAR(128) NOT NULL, "profitUnits" VARCHAR(128) NOT NULL,
  "policyVersion" TEXT NOT NULL, "clvStatus" TEXT NOT NULL CHECK ("clvStatus" IN ('AVAILABLE','UNAVAILABLE')),
  "clvReason" TEXT, "candidateOdds" VARCHAR(128), "candidateObservedAt" TIMESTAMPTZ(3),
  "closingOdds" VARCHAR(128), "closingObservedAt" TIMESTAMPTZ(3), clv VARCHAR(128),
  "clvPolicyVersion" TEXT NOT NULL, "supersedesValueSettlementId" TEXT UNIQUE REFERENCES "ValueSettlement"(id) ON DELETE RESTRICT,
  receipt JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("settlementReceiptId","valueReceiptId","policyVersion")
);
CREATE INDEX "ValueSettlement_fixtureId_market_createdAt_idx" ON "ValueSettlement"("fixtureId",market,"createdAt");
CREATE INDEX "ValueSettlement_valueReceiptId_createdAt_idx" ON "ValueSettlement"("valueReceiptId","createdAt");

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
  expected_result:=CASE v.market
    WHEN 'ONE_X_TWO' THEN CASE v.selection WHEN 'HOME' THEN CASE WHEN r."homeGoals">r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'DRAW' THEN CASE WHEN r."homeGoals"=r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'AWAY' THEN CASE WHEN r."awayGoals">r."homeGoals" THEN 'WIN' ELSE 'LOSS' END END
    WHEN 'OVER_UNDER_2_5' THEN CASE v.selection WHEN 'OVER_2_5' THEN CASE WHEN r."homeGoals"+r."awayGoals">2 THEN 'WIN' ELSE 'LOSS' END WHEN 'UNDER_2_5' THEN CASE WHEN r."homeGoals"+r."awayGoals"<3 THEN 'WIN' ELSE 'LOSS' END END
    WHEN 'BTTS' THEN CASE v.selection WHEN 'YES' THEN CASE WHEN r."homeGoals">0 AND r."awayGoals">0 THEN 'WIN' ELSE 'LOSS' END WHEN 'NO' THEN CASE WHEN r."homeGoals"=0 OR r."awayGoals"=0 THEN 'WIN' ELSE 'LOSS' END END END;
  IF expected_result IS NULL OR NEW.result<>expected_result THEN RAISE EXCEPTION 'value result identity is inconsistent'; END IF;
  expected_return:=CASE expected_result WHEN 'WIN' THEN o."decimalOdds"::numeric WHEN 'VOID' THEN 1 ELSE 0 END; expected_profit:=expected_return-1;
  IF NEW."policyVersion"<>'flat-one-unit-v1' OR NEW."stakeUnits"::numeric<>1 OR NEW."returnUnits"::numeric<>expected_return OR NEW."profitUnits"::numeric<>expected_profit THEN RAISE EXCEPTION 'flat-unit profit arithmetic is inconsistent'; END IF;
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
  IF NEW."supersedesValueSettlementId" IS NOT NULL THEN SELECT * INTO prior FROM "ValueSettlement" WHERE id=NEW."supersedesValueSettlementId"; IF prior.id IS NULL OR prior."valueReceiptId"<>NEW."valueReceiptId" OR s."supersedesSettlementReceiptId" IS DISTINCT FROM prior."settlementReceiptId" THEN RAISE EXCEPTION 'value settlement correction predecessor mismatch'; END IF; ELSIF s."supersedesSettlementReceiptId" IS NOT NULL THEN RAISE EXCEPTION 'value settlement correction requires predecessor'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ValueSettlement_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ValueSettlement" FOR EACH ROW EXECUTE FUNCTION guard_value_settlement();

CREATE OR REPLACE FUNCTION guard_closing_odds_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ClosingOddsObservation is immutable'; END IF; IF NEW."decimalOdds" !~ '^[0-9]+(\.[0-9]+)?$' OR NEW."decimalOdds"::numeric<=1 THEN RAISE EXCEPTION 'invalid closing decimal odds'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "ClosingOddsObservation_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ClosingOddsObservation" FOR EACH ROW EXECUTE FUNCTION guard_closing_odds_observation();

CREATE VIEW current_value_settlements AS SELECT v.* FROM "ValueSettlement" v WHERE NOT EXISTS (SELECT 1 FROM "ValueSettlement" n WHERE n."supersedesValueSettlementId"=v.id);
CREATE VIEW current_value_settlement_aggregate AS SELECT trim_scale(COALESCE(SUM("profitUnits"::numeric),0))::text AS "totalProfitUnits",trim_scale(COALESCE(SUM("stakeUnits"::numeric),0))::text AS "totalStakedUnits",COUNT(*) AS "observationCount",CASE WHEN COALESCE(SUM("stakeUnits"::numeric),0)=0 THEN NULL ELSE trim_scale(SUM("profitUnits"::numeric)/SUM("stakeUnits"::numeric))::text END AS roi,CASE WHEN COALESCE(SUM("stakeUnits"::numeric),0)=0 THEN NULL ELSE trim_scale(SUM("profitUnits"::numeric)/SUM("stakeUnits"::numeric))::text END AS yield FROM current_value_settlements;

CREATE OR REPLACE FUNCTION persist_value_settlement(p_id TEXT,p_settlement_id TEXT,p_value_id TEXT,p_odds_selection_id TEXT,p_closing_id TEXT DEFAULT NULL,p_supersedes TEXT DEFAULT NULL)
RETURNS TABLE(id TEXT,"supersedesValueSettlementId" TEXT) LANGUAGE plpgsql AS $$
DECLARE s "SettlementReceipt"%ROWTYPE; DECLARE v "ValueReceipt"%ROWTYPE; DECLARE o "ManualOddsSelection"%ROWTYPE; DECLARE os "ManualOddsSnapshot"%ROWTYPE; DECLARE r "ResultVersion"%ROWTYPE; DECLARE c "ClosingOddsObservation"%ROWTYPE; DECLARE result_value TEXT; DECLARE returned NUMERIC; DECLARE receipt_value JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_settlement_id||':'||p_value_id||':flat-one-unit-v1',0));
  RETURN QUERY SELECT q.id,q."supersedesValueSettlementId" FROM "ValueSettlement" q WHERE q."settlementReceiptId"=p_settlement_id AND q."valueReceiptId"=p_value_id AND q."policyVersion"='flat-one-unit-v1'; IF FOUND THEN RETURN; END IF;
  SELECT * INTO s FROM "SettlementReceipt" WHERE "SettlementReceipt".id=p_settlement_id; SELECT * INTO v FROM "ValueReceipt" WHERE "ValueReceipt".id=p_value_id; SELECT * INTO o FROM "ManualOddsSelection" WHERE "ManualOddsSelection".id=p_odds_selection_id; SELECT * INTO os FROM "ManualOddsSnapshot" WHERE "ManualOddsSnapshot".id=o."oddsSnapshotId"; SELECT * INTO r FROM "ResultVersion" WHERE "ResultVersion".id=s."resultVersionId";
  result_value:=CASE v.market WHEN 'ONE_X_TWO' THEN CASE v.selection WHEN 'HOME' THEN CASE WHEN r."homeGoals">r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'DRAW' THEN CASE WHEN r."homeGoals"=r."awayGoals" THEN 'WIN' ELSE 'LOSS' END WHEN 'AWAY' THEN CASE WHEN r."awayGoals">r."homeGoals" THEN 'WIN' ELSE 'LOSS' END END WHEN 'OVER_UNDER_2_5' THEN CASE v.selection WHEN 'OVER_2_5' THEN CASE WHEN r."homeGoals"+r."awayGoals">2 THEN 'WIN' ELSE 'LOSS' END ELSE CASE WHEN r."homeGoals"+r."awayGoals"<3 THEN 'WIN' ELSE 'LOSS' END END WHEN 'BTTS' THEN CASE v.selection WHEN 'YES' THEN CASE WHEN r."homeGoals">0 AND r."awayGoals">0 THEN 'WIN' ELSE 'LOSS' END ELSE CASE WHEN r."homeGoals"=0 OR r."awayGoals"=0 THEN 'WIN' ELSE 'LOSS' END END END;
  returned:=CASE result_value WHEN 'WIN' THEN o."decimalOdds"::numeric WHEN 'VOID' THEN 1 ELSE 0 END;
  receipt_value:=jsonb_build_object('settlementReceiptId',p_settlement_id,'valueReceiptId',p_value_id,'policyVersion','flat-one-unit-v1','clvPolicyVersion','odds-ratio-clv-v1');
  IF p_closing_id IS NULL THEN INSERT INTO "ValueSettlement"(id,"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","clvReason","candidateOdds","candidateObservedAt","clvPolicyVersion","supersedesValueSettlementId",receipt) VALUES(p_id,p_settlement_id,p_value_id,p_odds_selection_id,v."fixtureId",v.market,v.selection,result_value,'1',returned::text,(returned-1)::text,'flat-one-unit-v1','UNAVAILABLE','CLOSING_OBSERVATION_MISSING',o."decimalOdds",os."submittedAt",'odds-ratio-clv-v1',p_supersedes,receipt_value);
  ELSE SELECT * INTO c FROM "ClosingOddsObservation" WHERE "ClosingOddsObservation".id=p_closing_id; INSERT INTO "ValueSettlement"(id,"settlementReceiptId","valueReceiptId","oddsSelectionId","closingOddsObservationId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","candidateOdds","candidateObservedAt","closingOdds","closingObservedAt",clv,"clvPolicyVersion","supersedesValueSettlementId",receipt) VALUES(p_id,p_settlement_id,p_value_id,p_odds_selection_id,p_closing_id,v."fixtureId",v.market,v.selection,result_value,'1',trim_scale(returned)::text,trim_scale(returned-1)::text,'flat-one-unit-v1','AVAILABLE',o."decimalOdds",os."submittedAt",c."decimalOdds",c."observedAt",trim_scale(o."decimalOdds"::numeric/c."decimalOdds"::numeric-1)::text,'odds-ratio-clv-v1',p_supersedes,receipt_value); END IF;
  RETURN QUERY SELECT q.id,q."supersedesValueSettlementId" FROM "ValueSettlement" q WHERE q.id=p_id;
END; $$;
