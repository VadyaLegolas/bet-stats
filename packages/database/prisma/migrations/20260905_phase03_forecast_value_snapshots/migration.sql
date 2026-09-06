CREATE TYPE "ForecastKind" AS ENUM ('INITIAL', 'PRE_MATCH', 'LINEUP_CONFIRMED');
CREATE TYPE "ForecastSnapshotState" AS ENUM ('BUILDING', 'ISSUED', 'FAILED');

CREATE TABLE "LineupObservation" (
  "id" TEXT PRIMARY KEY,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  "observationId" TEXT NOT NULL UNIQUE REFERENCES "SourceObservation"("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LineupObservation_fixtureId_confirmedAt_idx" ON "LineupObservation"("fixtureId", "confirmedAt");

CREATE TABLE "ForecastSnapshot" (
  "id" TEXT PRIMARY KEY,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  "kind" "ForecastKind" NOT NULL,
  "state" "ForecastSnapshotState" NOT NULL DEFAULT 'BUILDING',
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "supersedesForecastId" TEXT UNIQUE REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT,
  "officialLineupObservationId" TEXT REFERENCES "LineupObservation"("id") ON DELETE RESTRICT,
  "cutoff" TIMESTAMPTZ(3) NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "modelHash" TEXT NOT NULL CHECK (length("modelHash") > 0),
  "configVersion" TEXT NOT NULL,
  "configHash" TEXT NOT NULL CHECK (length("configHash") > 0),
  "inputHash" TEXT NOT NULL CHECK (length("inputHash") > 0),
  "evidenceFingerprint" TEXT NOT NULL CHECK (length("evidenceFingerprint") > 0),
  "sourceRefs" JSONB NOT NULL,
  "probabilities" JSONB NOT NULL,
  "confidence" JSONB NOT NULL,
  "assumptions" JSONB NOT NULL,
  "receipt" JSONB NOT NULL,
  "issuedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForecastSnapshot_publication_check" CHECK (
    ("state" = 'BUILDING' AND "issuedAt" IS NULL) OR
    ("state" = 'ISSUED' AND "issuedAt" IS NOT NULL) OR
    ("state" = 'FAILED' AND "issuedAt" IS NULL)
  ),
  CONSTRAINT "ForecastSnapshot_lineup_reference_check" CHECK (
    "kind" <> 'LINEUP_CONFIRMED' OR "officialLineupObservationId" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "ForecastSnapshot_content_key" ON "ForecastSnapshot"("fixtureId", "kind", "cutoff", "modelHash", "configHash", "inputHash", "evidenceFingerprint");
CREATE UNIQUE INDEX "ForecastSnapshot_fixtureId_kind_revision_key" ON "ForecastSnapshot"("fixtureId", "kind", "revision");
CREATE INDEX "ForecastSnapshot_fixtureId_cutoff_kind_state_idx" ON "ForecastSnapshot"("fixtureId", "cutoff", "kind", "state");

CREATE TABLE "ForecastMarket" (
  "id" TEXT PRIMARY KEY,
  "forecastSnapshotId" TEXT NOT NULL REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT,
  "market" TEXT NOT NULL,
  "probabilities" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("forecastSnapshotId", "market")
);

CREATE TABLE "ManualOddsSnapshot" (
  "id" TEXT PRIMARY KEY,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  "market" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL CHECK (length("inputHash") > 0),
  "source" TEXT NOT NULL,
  "replacesOddsId" TEXT UNIQUE REFERENCES "ManualOddsSnapshot"("id") ON DELETE RESTRICT,
  "receipt" JSONB NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("fixtureId", "market", "inputHash")
);
CREATE INDEX "ManualOddsSnapshot_fixtureId_market_submittedAt_idx" ON "ManualOddsSnapshot"("fixtureId", "market", "submittedAt");

CREATE TABLE "ManualOddsSelection" (
  "id" TEXT PRIMARY KEY,
  "oddsSnapshotId" TEXT NOT NULL REFERENCES "ManualOddsSnapshot"("id") ON DELETE RESTRICT,
  "selection" TEXT NOT NULL,
  "decimalOdds" VARCHAR(128) NOT NULL CHECK ("decimalOdds" ~ '^[0-9]+(\.[0-9]+)?$'),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("oddsSnapshotId", "selection")
);

CREATE TABLE "ValueReceipt" (
  "id" TEXT PRIMARY KEY,
  "fixtureId" TEXT NOT NULL REFERENCES "Fixture"("id") ON DELETE RESTRICT,
  "market" TEXT NOT NULL,
  "forecastSnapshotId" TEXT NOT NULL REFERENCES "ForecastSnapshot"("id") ON DELETE RESTRICT,
  "oddsSnapshotId" TEXT NOT NULL REFERENCES "ManualOddsSnapshot"("id") ON DELETE RESTRICT,
  "outcome" TEXT NOT NULL,
  "selection" TEXT,
  "modelProbability" VARCHAR(128),
  "noVigProbability" VARCHAR(128),
  "fairOdds" VARCHAR(128),
  "edge" VARCHAR(128),
  "expectedValue" VARCHAR(128),
  "supersedesValueReceiptId" TEXT UNIQUE REFERENCES "ValueReceipt"("id") ON DELETE RESTRICT,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("forecastSnapshotId", "oddsSnapshotId")
);
CREATE INDEX "ValueReceipt_fixtureId_market_createdAt_idx" ON "ValueReceipt"("fixtureId", "market", "createdAt");

CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION guard_forecast_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "ForecastSnapshot"%ROWTYPE;
DECLARE lineup "LineupObservation"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ForecastSnapshot is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."state" <> 'BUILDING' OR NEW."state" NOT IN ('ISSUED','FAILED') THEN
      RAISE EXCEPTION 'ForecastSnapshot is immutable';
    END IF;
    IF ROW(NEW."id",NEW."fixtureId",NEW."kind",NEW."revision",NEW."supersedesForecastId",NEW."officialLineupObservationId",NEW."cutoff",NEW."modelVersion",NEW."modelHash",NEW."configVersion",NEW."configHash",NEW."inputHash",NEW."evidenceFingerprint",NEW."sourceRefs",NEW."probabilities",NEW."confidence",NEW."assumptions",NEW."receipt",NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."id",OLD."fixtureId",OLD."kind",OLD."revision",OLD."supersedesForecastId",OLD."officialLineupObservationId",OLD."cutoff",OLD."modelVersion",OLD."modelHash",OLD."configVersion",OLD."configHash",OLD."inputHash",OLD."evidenceFingerprint",OLD."sourceRefs",OLD."probabilities",OLD."confidence",OLD."assumptions",OLD."receipt",OLD."createdAt") THEN
      RAISE EXCEPTION 'ForecastSnapshot identity and inputs are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."revision" = 1 AND NEW."supersedesForecastId" IS NOT NULL THEN
    RAISE EXCEPTION 'first forecast revision cannot supersede another snapshot';
  ELSIF NEW."revision" > 1 THEN
    IF NEW."supersedesForecastId" IS NULL THEN RAISE EXCEPTION 'forecast revision must link its predecessor'; END IF;
    SELECT * INTO prior FROM "ForecastSnapshot" WHERE id=NEW."supersedesForecastId";
    IF prior.id IS NULL OR prior."fixtureId" <> NEW."fixtureId" OR prior.kind <> NEW.kind OR prior.revision + 1 <> NEW.revision THEN
      RAISE EXCEPTION 'forecast revision predecessor does not match fixture, kind, and revision';
    END IF;
  END IF;
  IF NEW.kind = 'LINEUP_CONFIRMED' THEN
    SELECT * INTO lineup FROM "LineupObservation" WHERE id=NEW."officialLineupObservationId";
    IF lineup.id IS NULL OR lineup."fixtureId" <> NEW."fixtureId" OR lineup.status <> 'OFFICIAL_CONFIRMED' THEN
      RAISE EXCEPTION 'LINEUP_CONFIRMED requires an official confirmed-lineup observation for the fixture';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ForecastSnapshot_guarded_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ForecastSnapshot" FOR EACH ROW EXECUTE FUNCTION guard_forecast_snapshot();

CREATE OR REPLACE FUNCTION guard_odds_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "ManualOddsSnapshot"%ROWTYPE;
BEGIN
  IF NEW."replacesOddsId" IS NOT NULL THEN
    SELECT * INTO prior FROM "ManualOddsSnapshot" WHERE id=NEW."replacesOddsId";
    IF prior.id IS NULL OR prior."fixtureId" <> NEW."fixtureId" OR prior.market <> NEW.market THEN
      RAISE EXCEPTION 'odds replacement must match fixture and market';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ManualOddsSnapshot_validate_replacement" BEFORE INSERT ON "ManualOddsSnapshot" FOR EACH ROW EXECUTE FUNCTION guard_odds_replacement();

CREATE OR REPLACE FUNCTION guard_value_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE forecast_fixture TEXT; DECLARE odds_fixture TEXT; DECLARE odds_market TEXT;
BEGIN
  SELECT "fixtureId" INTO forecast_fixture FROM "ForecastSnapshot" WHERE id=NEW."forecastSnapshotId";
  SELECT "fixtureId",market INTO odds_fixture,odds_market FROM "ManualOddsSnapshot" WHERE id=NEW."oddsSnapshotId";
  IF forecast_fixture IS NULL OR odds_fixture IS NULL OR forecast_fixture <> NEW."fixtureId" OR odds_fixture <> NEW."fixtureId" OR odds_market <> NEW.market OR
     NOT EXISTS (SELECT 1 FROM "ForecastMarket" WHERE "forecastSnapshotId"=NEW."forecastSnapshotId" AND market=NEW.market) THEN
    RAISE EXCEPTION 'value receipt requires exact forecast and odds pair for fixture and market';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ValueReceipt_validate_pair" BEFORE INSERT ON "ValueReceipt" FOR EACH ROW EXECUTE FUNCTION guard_value_pair();

CREATE TRIGGER "LineupObservation_append_only" BEFORE UPDATE OR DELETE ON "LineupObservation" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "ForecastMarket_append_only" BEFORE UPDATE OR DELETE ON "ForecastMarket" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "ManualOddsSnapshot_append_only" BEFORE UPDATE OR DELETE ON "ManualOddsSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "ManualOddsSelection_append_only" BEFORE UPDATE OR DELETE ON "ManualOddsSelection" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "ValueReceipt_append_only" BEFORE UPDATE OR DELETE ON "ValueReceipt" FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
