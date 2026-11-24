-- Forward-only: permitted lifecycle transitions of the calibrator event log (Phase 12, CALIB-03, D-09).
--
-- Why: the active calibrator is derived from the log (view current_calibrators from 20261125_phase12_calibrator_tables),
-- so a wrong event would silently change what users are served. The database therefore refuses events that do not
-- follow the lifecycle, independently of the application that wrote them. This is structure, not policy: thresholds,
-- sample sizes and hysteresis stay in the versioned calibration config (D-07) and are decided by application code.
--
-- Rules, evaluated against the committed log of the same (modelVersion, configHash, market), after taking a
-- transaction-level advisory lock on that key so concurrent writers are serialised:
--   PROMOTED    the calibrator has no earlier PROMOTED or ROLLED_BACK event; its predecessor equals the active
--               calibrator (both NULL on a first promotion); a non-NULL predecessor needs a SUPERSEDED event
--               (predecessor -> this calibrator) first, written in the same transaction by the repository.
--   ROLLED_BACK the calibrator is the active one; the restored calibrator equals (NULL-safe) the predecessor recorded
--               by that calibrator's PROMOTED event ("no calibrator" when it had none).
--   SUPERSEDED  the calibrator is the active one; the successor differs and has no PROMOTED or ROLLED_BACK event.
--   EVALUATED   the calibrator is the active one; the event never changes the active calibrator.
--
-- "seq" is drawn from the identity sequence BEFORE this trigger can wait for the lock, so for concurrent raw-SQL
-- writers the drawn order could differ from the lock (commit) order. The trigger therefore re-draws "seq" from the
-- same sequence after the lock is held: order by "seq" always equals the order in which valid transitions were
-- admitted. Gaps in "seq" are expected and meaningless.
--
-- Rollback: only through a new forward migration (CREATE OR REPLACE FUNCTION with changed rules, or DROP TRIGGER).
-- No data is modified; the append-only triggers of the previous migration are not recreated.

CREATE OR REPLACE FUNCTION guard_calibrator_event_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  active_id TEXT;
  promoted_predecessor TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."modelVersion" || ':' || NEW."configHash" || ':' || NEW."market", 0));
  NEW."seq" := nextval(pg_get_serial_sequence('"CalibratorEvent"', 'seq'));

  -- The active calibrator: latest PROMOTED or ROLLED_BACK event (the rule of the current_calibrators view).
  SELECT CASE WHEN e."type" = 'PROMOTED' THEN e."calibratorId" ELSE e."restoredCalibratorId" END
    INTO active_id
    FROM "CalibratorEvent" e
   WHERE e."modelVersion" = NEW."modelVersion" AND e."configHash" = NEW."configHash" AND e."market" = NEW."market"
     AND e."type" IN ('PROMOTED', 'ROLLED_BACK')
   ORDER BY e."seq" DESC
   LIMIT 1;

  IF NEW."type" = 'PROMOTED' THEN
    IF EXISTS (SELECT 1 FROM "CalibratorEvent" e WHERE e."calibratorId" = NEW."calibratorId" AND e."type" IN ('PROMOTED', 'ROLLED_BACK')) THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: calibrator % was already promoted or rolled back', NEW."calibratorId";
    END IF;
    IF NEW."predecessorCalibratorId" IS DISTINCT FROM active_id THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: predecessor % does not match the active calibrator %',
        COALESCE(NEW."predecessorCalibratorId", 'NULL'), COALESCE(active_id, 'NULL');
    END IF;
    IF NEW."predecessorCalibratorId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "CalibratorEvent" e
       WHERE e."type" = 'SUPERSEDED' AND e."calibratorId" = NEW."predecessorCalibratorId" AND e."successorCalibratorId" = NEW."calibratorId"
    ) THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: promotion over an active calibrator requires a SUPERSEDED event first';
    END IF;

  ELSIF NEW."type" = 'ROLLED_BACK' THEN
    IF NEW."calibratorId" IS DISTINCT FROM active_id THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: calibrator % is not the active calibrator', NEW."calibratorId";
    END IF;
    SELECT e."predecessorCalibratorId" INTO promoted_predecessor
      FROM "CalibratorEvent" e WHERE e."type" = 'PROMOTED' AND e."calibratorId" = NEW."calibratorId"
      LIMIT 1;
    IF NEW."restoredCalibratorId" IS DISTINCT FROM promoted_predecessor THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: restored calibrator % does not match the restore target % recorded by the PROMOTED event',
        COALESCE(NEW."restoredCalibratorId", 'NULL'), COALESCE(promoted_predecessor, 'NULL');
    END IF;

  ELSIF NEW."type" = 'SUPERSEDED' THEN
    IF NEW."calibratorId" IS DISTINCT FROM active_id THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: calibrator % is not the active calibrator', NEW."calibratorId";
    END IF;
    IF NEW."successorCalibratorId" = NEW."calibratorId" THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: successor must differ from the superseded calibrator';
    END IF;
    IF EXISTS (SELECT 1 FROM "CalibratorEvent" e WHERE e."calibratorId" = NEW."successorCalibratorId" AND e."type" IN ('PROMOTED', 'ROLLED_BACK')) THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: successor % was already promoted or rolled back', NEW."successorCalibratorId";
    END IF;

  ELSIF NEW."type" = 'EVALUATED' THEN
    IF NEW."calibratorId" IS DISTINCT FROM active_id THEN
      RAISE EXCEPTION 'CalibratorEvent transition rejected: calibrator % is not the active calibrator', NEW."calibratorId";
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CalibratorEvent_guarded_transition" BEFORE INSERT ON "CalibratorEvent" FOR EACH ROW EXECUTE FUNCTION guard_calibrator_event_transition();
