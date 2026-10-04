DROP INDEX "ForecastSnapshot_content_key";

CREATE UNIQUE INDEX "ForecastSnapshot_content_key"
ON "ForecastSnapshot" (
  "fixtureId",
  "kind",
  "cutoff",
  "modelHash",
  "configHash",
  "inputHash",
  "evidenceFingerprint",
  "officialLineupObservationId"
) NULLS NOT DISTINCT;

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
  IF NEW.receipt->>'officialLineupObservationId' IS DISTINCT FROM NEW."officialLineupObservationId" THEN
    RAISE EXCEPTION 'forecast receipt lineup provenance does not match immutable identity';
  END IF;
  RETURN NEW;
END;
$$;
