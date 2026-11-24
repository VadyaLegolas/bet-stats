-- Forward-only: calibrator storage and its event log (Phase 12, CALIB-02, CALIB-03, D-09).
--
-- Why: a fitted probability calibrator is an auditable artefact. "Calibrator" is an immutable record of one
-- fit (pinned model identity, market, method, parameters, fit and holdout windows, holdout metrics, calibration
-- config version and hash). "CalibratorEvent" is an append-only log (PROMOTED, ROLLED_BACK, SUPERSEDED, and the
-- state-neutral EVALUATED). The calibrator that is active for one (modelVersion, configHash, market) is DERIVED
-- from the log by the current_calibrators view, so a rollback is an appended event, never an UPDATE or DELETE.
-- Calibration is a post-hoc read layer: nothing here references or alters the frozen forecast, settlement,
-- score or value tables (D-08).
--
-- Identity is protected structurally (D-06): every event carries (modelVersion, configHash, market) and each
-- calibrator link is a COMPOSITE foreign key onto "Calibrator"(id, modelVersion, configHash, market), so an
-- event cannot point at a calibrator fitted for another model version, config hash or market. A NULL optional
-- link switches off the check for that link only (MATCH SIMPLE), which is the intended behaviour.
--
-- Policy (minimum samples, thresholds, hysteresis) is NOT encoded here: the database stores the calibration
-- config version and hash and guards only structure. Permitted transitions are added by the next migration
-- (20261125_phase12_calibrator_transitions).
--
-- Rollback: only through a new forward migration, and only while both tables are empty; afterwards recovery is a
-- restore from backup. Existing rows of every table are never read, updated, deleted or backfilled.

CREATE TABLE "Calibrator" (
  "id" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "configHash" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "parameters" JSONB NOT NULL,
  "calibrationConfigVersion" TEXT NOT NULL,
  "calibrationConfigHash" TEXT NOT NULL,
  "samplesDigest" TEXT NOT NULL,
  "fitSampleSize" INTEGER NOT NULL,
  "holdoutSampleSize" INTEGER NOT NULL,
  "fitWindowFrom" TIMESTAMPTZ(3) NOT NULL,
  "fitWindowTo" TIMESTAMPTZ(3) NOT NULL,
  "holdoutFrom" TIMESTAMPTZ(3) NOT NULL,
  "holdoutTo" TIMESTAMPTZ(3) NOT NULL,
  "fitAsOf" TIMESTAMPTZ(3) NOT NULL,
  "holdoutBrierRaw" DOUBLE PRECISION NOT NULL,
  "holdoutBrierCalibrated" DOUBLE PRECISION NOT NULL,
  "plattHoldoutBrier" DOUBLE PRECISION,
  "isotonicHoldoutBrier" DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Calibrator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Calibrator_id_format_check" CHECK ("id" ~ '^calibrator_[0-9a-f]{64}$'),
  CONSTRAINT "Calibrator_modelVersion_check" CHECK (length("modelVersion") > 0),
  CONSTRAINT "Calibrator_configHash_check" CHECK ("configHash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "Calibrator_market_check" CHECK ("market" IN ('ONE_X_TWO', 'OVER_UNDER_2_5', 'BTTS')),
  CONSTRAINT "Calibrator_method_check" CHECK ("method" IN ('PLATT', 'ISOTONIC')),
  CONSTRAINT "Calibrator_parameters_check" CHECK (jsonb_typeof("parameters") = 'object'),
  CONSTRAINT "Calibrator_calibrationConfigVersion_check" CHECK (length("calibrationConfigVersion") > 0),
  CONSTRAINT "Calibrator_calibrationConfigHash_check" CHECK ("calibrationConfigHash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "Calibrator_samplesDigest_check" CHECK (length("samplesDigest") > 0),
  CONSTRAINT "Calibrator_fitSampleSize_check" CHECK ("fitSampleSize" > 0),
  CONSTRAINT "Calibrator_holdoutSampleSize_check" CHECK ("holdoutSampleSize" > 0),
  -- Mean categorical Brier lies in [0, 2]; BETWEEN is also false for NaN.
  CONSTRAINT "Calibrator_holdoutBrierRaw_check" CHECK ("holdoutBrierRaw" BETWEEN 0 AND 2),
  CONSTRAINT "Calibrator_holdoutBrierCalibrated_check" CHECK ("holdoutBrierCalibrated" BETWEEN 0 AND 2),
  CONSTRAINT "Calibrator_plattHoldoutBrier_check" CHECK ("plattHoldoutBrier" IS NULL OR "plattHoldoutBrier" BETWEEN 0 AND 2),
  CONSTRAINT "Calibrator_isotonicHoldoutBrier_check" CHECK ("isotonicHoldoutBrier" IS NULL OR "isotonicHoldoutBrier" BETWEEN 0 AND 2),
  -- D-05: the fit window ends no later than the holdout begins; the holdout ends no later than the fit's as-of.
  CONSTRAINT "Calibrator_window_chronology_check" CHECK (
    "fitWindowFrom" <= "fitWindowTo"
    AND "fitWindowTo" <= "holdoutFrom"
    AND "holdoutFrom" <= "holdoutTo"
    AND "holdoutTo" <= "fitAsOf"
  )
);

-- Target of the composite foreign keys of "CalibratorEvent" (D-06).
CREATE UNIQUE INDEX "Calibrator_id_modelVersion_configHash_market_key" ON "Calibrator"("id", "modelVersion", "configHash", "market");
CREATE INDEX "Calibrator_modelVersion_configHash_market_idx" ON "Calibrator"("modelVersion", "configHash", "market");

CREATE TABLE "CalibratorEvent" (
  "id" TEXT NOT NULL,
  -- Total order of events; equal createdAt values inside one transaction cannot order them.
  "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
  "type" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "configHash" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "calibratorId" TEXT NOT NULL,
  "predecessorCalibratorId" TEXT,
  "restoredCalibratorId" TEXT,
  "successorCalibratorId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "evaluation" JSONB NOT NULL,
  "calibrationConfigVersion" TEXT NOT NULL,
  "calibrationConfigHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalibratorEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalibratorEvent_id_format_check" CHECK ("id" ~ '^calibrator_event_[0-9a-f]{64}$'),
  CONSTRAINT "CalibratorEvent_type_check" CHECK ("type" IN ('PROMOTED', 'ROLLED_BACK', 'SUPERSEDED', 'EVALUATED')),
  CONSTRAINT "CalibratorEvent_modelVersion_check" CHECK (length("modelVersion") > 0),
  CONSTRAINT "CalibratorEvent_configHash_check" CHECK ("configHash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "CalibratorEvent_market_check" CHECK ("market" IN ('ONE_X_TWO', 'OVER_UNDER_2_5', 'BTTS')),
  CONSTRAINT "CalibratorEvent_reasonCode_check" CHECK ("reasonCode" ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT "CalibratorEvent_evaluation_check" CHECK (jsonb_typeof("evaluation") = 'object'),
  CONSTRAINT "CalibratorEvent_calibrationConfigVersion_check" CHECK (length("calibrationConfigVersion") > 0),
  CONSTRAINT "CalibratorEvent_calibrationConfigHash_check" CHECK ("calibrationConfigHash" ~ '^sha256:[0-9a-f]{64}$'),
  -- Event shape by type: which optional links an event of that type may or must carry.
  CONSTRAINT "CalibratorEvent_shape_check" CHECK (
    ("type" = 'PROMOTED' AND "restoredCalibratorId" IS NULL AND "successorCalibratorId" IS NULL)
    OR ("type" = 'ROLLED_BACK' AND "predecessorCalibratorId" IS NULL AND "successorCalibratorId" IS NULL)
    OR ("type" = 'SUPERSEDED' AND "successorCalibratorId" IS NOT NULL AND "successorCalibratorId" <> "calibratorId"
        AND "predecessorCalibratorId" IS NULL AND "restoredCalibratorId" IS NULL)
    OR ("type" = 'EVALUATED' AND "predecessorCalibratorId" IS NULL AND "restoredCalibratorId" IS NULL AND "successorCalibratorId" IS NULL)
  ),
  -- D-06: an event can reference only a calibrator of the same model version, config hash and market.
  CONSTRAINT "CalibratorEvent_calibrator_identity_fkey" FOREIGN KEY ("calibratorId", "modelVersion", "configHash", "market")
    REFERENCES "Calibrator"("id", "modelVersion", "configHash", "market") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CalibratorEvent_predecessor_identity_fkey" FOREIGN KEY ("predecessorCalibratorId", "modelVersion", "configHash", "market")
    REFERENCES "Calibrator"("id", "modelVersion", "configHash", "market") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CalibratorEvent_restored_identity_fkey" FOREIGN KEY ("restoredCalibratorId", "modelVersion", "configHash", "market")
    REFERENCES "Calibrator"("id", "modelVersion", "configHash", "market") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CalibratorEvent_successor_identity_fkey" FOREIGN KEY ("successorCalibratorId", "modelVersion", "configHash", "market")
    REFERENCES "Calibrator"("id", "modelVersion", "configHash", "market") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "CalibratorEvent_seq_key" ON "CalibratorEvent"("seq");
CREATE INDEX "CalibratorEvent_modelVersion_configHash_market_seq_idx" ON "CalibratorEvent"("modelVersion", "configHash", "market", "seq");
CREATE INDEX "CalibratorEvent_calibratorId_seq_idx" ON "CalibratorEvent"("calibratorId", "seq");

-- Append-only: every mutation is rejected (D-09), in the style of the settlement tables.
CREATE OR REPLACE FUNCTION guard_calibrator_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Calibrator is immutable';
END;
$$;
CREATE TRIGGER "Calibrator_append_only" BEFORE UPDATE OR DELETE ON "Calibrator" FOR EACH ROW EXECUTE FUNCTION guard_calibrator_immutable();

CREATE OR REPLACE FUNCTION guard_calibrator_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CalibratorEvent is immutable';
END;
$$;
CREATE TRIGGER "CalibratorEvent_append_only" BEFORE UPDATE OR DELETE ON "CalibratorEvent" FOR EACH ROW EXECUTE FUNCTION guard_calibrator_event_immutable();

-- Active calibrator per (modelVersion, configHash, market): the latest PROMOTED or ROLLED_BACK event.
-- PROMOTED activates its calibrator; ROLLED_BACK activates the restored calibrator, which is NULL when the
-- rollback target is "no calibrator" (raw probabilities only). SUPERSEDED and EVALUATED never change it.
CREATE VIEW current_calibrators AS
SELECT DISTINCT ON ("modelVersion", "configHash", "market")
  "modelVersion",
  "configHash",
  "market",
  CASE WHEN "type" = 'PROMOTED' THEN "calibratorId" ELSE "restoredCalibratorId" END AS "calibratorId",
  "seq" AS "activationSeq",
  "type" AS "activatedBy",
  "id" AS "activationEventId",
  "asOf" AS "activatedAt"
FROM "CalibratorEvent"
WHERE "type" IN ('PROMOTED', 'ROLLED_BACK')
ORDER BY "modelVersion", "configHash", "market", "seq" DESC;

-- Promotion number of each calibrator inside its (modelVersion, configHash, market), in event order.
-- A rollback restores a calibrator together with its original number; "restoreTargetId" is the predecessor
-- recorded by its PROMOTED event, which is where a later rollback goes.
CREATE VIEW calibrator_versions AS
SELECT
  "calibratorId",
  "modelVersion",
  "configHash",
  "market",
  ROW_NUMBER() OVER (PARTITION BY "modelVersion", "configHash", "market" ORDER BY "seq") AS "version",
  "seq" AS "promotedSeq",
  "predecessorCalibratorId" AS "restoreTargetId"
FROM "CalibratorEvent"
WHERE "type" = 'PROMOTED';
