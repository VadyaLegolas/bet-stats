-- Forward-only: ForecastSnapshot gets an immutable provenance column (WR-13).
--
-- Why: the operator model comparison publishes retrospective forecasts through the same publish
-- path as production, and the public scorecard read every ForecastScore without provenance. On a
-- database with no production forecast the public cohort all/all/ONE_X_TWO returned 32 fixtures,
-- 64 forecasts and 192 events, all of them from backtests. "origin" separates visibility (public
-- scorecard, fixture views, value candidates, rho fit) from the revision chain, which stays shared
-- per ("fixtureId","kind"). The snapshot identity (ForecastSnapshot_content_key) deliberately does
-- NOT include origin: a collision returns the existing snapshot unchanged.
--
-- Rollback: only through a new forward migration. Dropping the column erases provenance, so after
-- the first BACKTEST row exists recovery is a restore from backup. Rolling back the guard function
-- alone is unsafe only in the sense that origin would no longer be protected from change.
--
-- Existing rows are never updated, deleted or backfilled: a constant column default is
-- metadata-only on PostgreSQL 18, so every existing row reads as PRODUCTION with no table rewrite
-- and no trigger firing.

CREATE TYPE "ForecastOrigin" AS ENUM ('PRODUCTION', 'BACKTEST');

ALTER TABLE "ForecastSnapshot"
  ADD COLUMN "origin" "ForecastOrigin" NOT NULL DEFAULT 'PRODUCTION';

-- Exact copy of the body from 20260908_phase03_forecast_identity_gap, with "origin" appended to
-- both ROW(...) lists of the UPDATE branch so a BUILDING to ISSUED transition cannot change it
-- (every other UPDATE is already rejected). The existing ForecastSnapshot_guarded_immutable
-- trigger keeps calling this function and is not recreated.
CREATE OR REPLACE FUNCTION guard_forecast_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "ForecastSnapshot"%ROWTYPE;
DECLARE lineup "LineupObservation"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ForecastSnapshot is immutable'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."state" <> 'BUILDING' OR NEW."state" NOT IN ('ISSUED','FAILED') THEN
      RAISE EXCEPTION 'ForecastSnapshot is immutable';
    END IF;
    IF ROW(NEW."id",NEW."fixtureId",NEW."kind",NEW."revision",NEW."supersedesForecastId",NEW."officialLineupObservationId",NEW."cutoff",NEW."modelVersion",NEW."modelHash",NEW."configVersion",NEW."configHash",NEW."inputHash",NEW."evidenceFingerprint",NEW."sourceRefs",NEW."probabilities",NEW."confidence",NEW."assumptions",NEW."receipt",NEW."createdAt",NEW."origin")
       IS DISTINCT FROM
       ROW(OLD."id",OLD."fixtureId",OLD."kind",OLD."revision",OLD."supersedesForecastId",OLD."officialLineupObservationId",OLD."cutoff",OLD."modelVersion",OLD."modelHash",OLD."configVersion",OLD."configHash",OLD."inputHash",OLD."evidenceFingerprint",OLD."sourceRefs",OLD."probabilities",OLD."confidence",OLD."assumptions",OLD."receipt",OLD."createdAt",OLD."origin") THEN
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
