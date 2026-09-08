CREATE TABLE "ForecastScore" (
 id TEXT PRIMARY KEY, "settlementReceiptId" TEXT NOT NULL REFERENCES "SettlementReceipt"(id) ON DELETE RESTRICT,
 "forecastSnapshotId" TEXT NOT NULL REFERENCES "ForecastSnapshot"(id) ON DELETE RESTRICT, "fixtureId" TEXT NOT NULL REFERENCES "Fixture"(id) ON DELETE RESTRICT,
 "leagueId" TEXT NOT NULL REFERENCES "League"(id) ON DELETE RESTRICT, market TEXT NOT NULL CHECK (market IN ('ONE_X_TWO','OVER_UNDER_2_5','BTTS')),
 "modelVersion" TEXT NOT NULL, "kickoffUtc" TIMESTAMPTZ(3) NOT NULL, outcome TEXT NOT NULL, probabilities JSONB NOT NULL, "classOrder" JSONB NOT NULL,
 "rawChosenProbability" DOUBLE PRECISION NOT NULL, "clippedChosenProbability" DOUBLE PRECISION NOT NULL,
 "brierScore" DOUBLE PRECISION NOT NULL CHECK ("brierScore" BETWEEN 0 AND 2), "logLoss" DOUBLE PRECISION NOT NULL CHECK ("logLoss">=0),
 "eventCount" INTEGER NOT NULL DEFAULT 1 CHECK ("eventCount"=1), "formulaVersion" TEXT NOT NULL, "formulaHash" TEXT NOT NULL,
 "supersedesForecastScoreId" TEXT UNIQUE REFERENCES "ForecastScore"(id) ON DELETE RESTRICT, receipt JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("settlementReceiptId",market,"formulaHash")
);
CREATE INDEX "ForecastScore_modelVersion_leagueId_market_kickoffUtc_idx" ON "ForecastScore"("modelVersion","leagueId",market,"kickoffUtc");
CREATE INDEX "ForecastScore_fixtureId_market_kickoffUtc_idx" ON "ForecastScore"("fixtureId",market,"kickoffUtc");

CREATE OR REPLACE FUNCTION guard_forecast_score() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "SettlementReceipt"%ROWTYPE; DECLARE f "ForecastSnapshot"%ROWTYPE; DECLARE fx "Fixture"%ROWTYPE; DECLARE fm "ForecastMarket"%ROWTYPE; DECLARE prior "ForecastScore"%ROWTYPE;
DECLARE expected_order JSONB; DECLARE expected_outcome TEXT; DECLARE chosen DOUBLE PRECISION; DECLARE expected_brier DOUBLE PRECISION; DECLARE expected_log DOUBLE PRECISION;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ForecastScore is immutable'; END IF;
 SELECT * INTO s FROM "SettlementReceipt" WHERE id=NEW."settlementReceiptId"; SELECT * INTO f FROM "ForecastSnapshot" WHERE id=s."forecastSnapshotId";
 SELECT * INTO fx FROM "Fixture" WHERE id=s."fixtureId"; SELECT * INTO fm FROM "ForecastMarket" WHERE "forecastSnapshotId"=f.id AND market=NEW.market;
 IF s.id IS NULL OR s.scoreability<>'SCOREABLE' OR s."classOutcome"<>'SCORED' OR fm.id IS NULL THEN RAISE EXCEPTION 'score source identity is not scoreable'; END IF;
 IF NEW."forecastSnapshotId"<>f.id OR NEW."fixtureId"<>fx.id OR NEW."leagueId"<>fx."leagueId" OR NEW."modelVersion"<>f."modelVersion" OR NEW."kickoffUtc"<>fx."kickoffUtc" OR NEW.probabilities<>fm.probabilities THEN RAISE EXCEPTION 'score source identity disagrees'; END IF;
 expected_order:=CASE NEW.market WHEN 'ONE_X_TWO' THEN '["HOME","DRAW","AWAY"]'::jsonb WHEN 'OVER_UNDER_2_5' THEN '["OVER_2_5","UNDER_2_5"]'::jsonb ELSE '["YES","NO"]'::jsonb END;
 expected_outcome:=CASE NEW.market WHEN 'ONE_X_TWO' THEN CASE WHEN (SELECT "homeGoals" FROM "ResultVersion" WHERE id=s."resultVersionId")>(SELECT "awayGoals" FROM "ResultVersion" WHERE id=s."resultVersionId") THEN 'HOME' WHEN (SELECT "homeGoals" FROM "ResultVersion" WHERE id=s."resultVersionId")<(SELECT "awayGoals" FROM "ResultVersion" WHERE id=s."resultVersionId") THEN 'AWAY' ELSE 'DRAW' END WHEN 'OVER_UNDER_2_5' THEN CASE WHEN (SELECT "homeGoals"+"awayGoals" FROM "ResultVersion" WHERE id=s."resultVersionId")>2 THEN 'OVER_2_5' ELSE 'UNDER_2_5' END ELSE CASE WHEN (SELECT "homeGoals">0 AND "awayGoals">0 FROM "ResultVersion" WHERE id=s."resultVersionId") THEN 'YES' ELSE 'NO' END END;
 IF NEW."classOrder"<>expected_order OR NEW.outcome<>expected_outcome OR NEW."formulaVersion"<>'proper-score-v1' OR NEW."formulaHash" !~ '^sha256:[a-f0-9]{64}$' THEN RAISE EXCEPTION 'score formula identity is invalid'; END IF;
 SELECT (e->>'probability')::double precision INTO chosen FROM jsonb_array_elements(NEW.probabilities) e WHERE e->>'selection'=NEW.outcome;
 SELECT SUM(POWER((e->>'probability')::double precision-CASE WHEN e->>'selection'=NEW.outcome THEN 1 ELSE 0 END,2)) INTO expected_brier FROM jsonb_array_elements(NEW.probabilities) e;
 expected_log:=-LN(GREATEST(chosen,1e-15));
 IF chosen IS NULL OR abs(NEW."rawChosenProbability"-chosen)>1e-12 OR abs(NEW."clippedChosenProbability"-GREATEST(chosen,1e-15))>1e-12 OR abs(NEW."brierScore"-expected_brier)>1e-12 OR abs(NEW."logLoss"-expected_log)>1e-12 THEN RAISE EXCEPTION 'score metric values are inconsistent'; END IF;
 IF NEW.receipt->>'settlementReceiptId' IS DISTINCT FROM NEW."settlementReceiptId" OR NEW.receipt->>'forecastSnapshotId' IS DISTINCT FROM NEW."forecastSnapshotId" OR NEW.receipt->>'market' IS DISTINCT FROM NEW.market OR NEW.receipt->>'outcome' IS DISTINCT FROM NEW.outcome OR NEW.receipt->>'formulaVersion' IS DISTINCT FROM NEW."formulaVersion" OR NEW.receipt->>'formulaHash' IS DISTINCT FROM NEW."formulaHash" OR NEW.receipt->>'leagueId' IS DISTINCT FROM NEW."leagueId" OR NEW.receipt->>'modelVersion' IS DISTINCT FROM NEW."modelVersion" THEN RAISE EXCEPTION 'score receipt claims disagree'; END IF;
 IF NEW."supersedesForecastScoreId" IS NOT NULL THEN SELECT * INTO prior FROM "ForecastScore" WHERE id=NEW."supersedesForecastScoreId"; IF prior.id IS NULL OR prior.market<>NEW.market OR prior."fixtureId"<>NEW."fixtureId" OR s."supersedesSettlementReceiptId" IS DISTINCT FROM prior."settlementReceiptId" THEN RAISE EXCEPTION 'score correction predecessor mismatch'; END IF; ELSIF s."supersedesSettlementReceiptId" IS NOT NULL THEN RAISE EXCEPTION 'score correction requires predecessor'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ForecastScore_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ForecastScore" FOR EACH ROW EXECUTE FUNCTION guard_forecast_score();
CREATE VIEW current_forecast_scores AS SELECT s.* FROM "ForecastScore" s WHERE NOT EXISTS (SELECT 1 FROM "ForecastScore" n WHERE n."supersedesForecastScoreId"=s.id);

CREATE OR REPLACE FUNCTION persist_forecast_score(p_id TEXT,p_settlement_id TEXT,p_market TEXT,p_outcome TEXT,p_raw DOUBLE PRECISION,p_clipped DOUBLE PRECISION,p_brier DOUBLE PRECISION,p_log DOUBLE PRECISION,p_order JSONB,p_receipt JSONB,p_supersedes TEXT DEFAULT NULL)
RETURNS TABLE(id TEXT,"supersedesForecastScoreId" TEXT) LANGUAGE plpgsql AS $$
DECLARE s "SettlementReceipt"%ROWTYPE; DECLARE f "ForecastSnapshot"%ROWTYPE; DECLARE fx "Fixture"%ROWTYPE; DECLARE probs JSONB; DECLARE formula_hash TEXT;
BEGIN
 formula_hash:=p_receipt->>'formulaHash'; PERFORM pg_advisory_xact_lock(hashtextextended(p_settlement_id||':'||p_market||':'||formula_hash,0));
 RETURN QUERY SELECT q.id,q."supersedesForecastScoreId" FROM "ForecastScore" q WHERE q."settlementReceiptId"=p_settlement_id AND q.market=p_market AND q."formulaHash"=formula_hash; IF FOUND THEN RETURN; END IF;
 SELECT * INTO s FROM "SettlementReceipt" WHERE "SettlementReceipt".id=p_settlement_id; SELECT * INTO f FROM "ForecastSnapshot" WHERE "ForecastSnapshot".id=s."forecastSnapshotId"; SELECT * INTO fx FROM "Fixture" WHERE "Fixture".id=s."fixtureId"; SELECT probabilities INTO probs FROM "ForecastMarket" WHERE "forecastSnapshotId"=f.id AND market=p_market;
 INSERT INTO "ForecastScore"(id,"settlementReceiptId","forecastSnapshotId","fixtureId","leagueId",market,"modelVersion","kickoffUtc",outcome,probabilities,"classOrder","rawChosenProbability","clippedChosenProbability","brierScore","logLoss","eventCount","formulaVersion","formulaHash","supersedesForecastScoreId",receipt)
 VALUES(p_id,p_settlement_id,f.id,fx.id,fx."leagueId",p_market,f."modelVersion",fx."kickoffUtc",p_outcome,probs,p_order,p_raw,p_clipped,p_brier,p_log,1,p_receipt->>'formulaVersion',formula_hash,p_supersedes,p_receipt);
 RETURN QUERY SELECT q.id,q."supersedesForecastScoreId" FROM "ForecastScore" q WHERE q.id=p_id;
END; $$;
