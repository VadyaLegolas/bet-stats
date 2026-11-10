-- Phase 9 (ALRT-02): durable operator alert storage. OpsAlert is guarded
-- mutable state (dedup occurrences bump count/lastSeen, operator actions set
-- acknowledgedAt/resolvedAt), while OpsAlertTransition and OpsAlertDelivery
-- are append-only audit trails — UPDATE/DELETE are frozen at the database
-- level (T-09-01/T-09-02/T-09-03).
CREATE TABLE "OpsAlert" (
  "id" TEXT PRIMARY KEY,
  "dedupFingerprint" TEXT NOT NULL,
  "signal" TEXT NOT NULL CHECK ("signal" ~ '^[A-Z0-9_]{1,64}$'),
  "scope" TEXT NOT NULL,
  "severity" TEXT NOT NULL CHECK ("severity" IN ('CRITICAL','WARNING')),
  "status" TEXT NOT NULL CHECK ("status" IN ('OPEN','RESOLVED','ACKNOWLEDGED')),
  "count" INTEGER NOT NULL CHECK ("count" >= 1),
  "firstSeen" TIMESTAMPTZ(3) NOT NULL,
  "lastSeen" TIMESTAMPTZ(3) NOT NULL,
  "acknowledgedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "correlationIds" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OpsAlert_dedupFingerprint_key" ON "OpsAlert"("dedupFingerprint");
CREATE INDEX "OpsAlert_lastSeen_idx" ON "OpsAlert"("lastSeen");

CREATE TABLE "OpsAlertTransition" (
  "id" TEXT PRIMARY KEY,
  "alertId" TEXT NOT NULL REFERENCES "OpsAlert"("id") ON DELETE RESTRICT,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "severityFrom" TEXT,
  "severityTo" TEXT,
  "at" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OpsAlertTransition_alertId_idx" ON "OpsAlertTransition"("alertId");

CREATE TABLE "OpsAlertDelivery" (
  "id" TEXT PRIMARY KEY,
  "alertId" TEXT NOT NULL REFERENCES "OpsAlert"("id") ON DELETE RESTRICT,
  "at" TIMESTAMPTZ(3) NOT NULL,
  "httpStatus" INTEGER,
  "errorCode" TEXT,
  "attempt" INTEGER NOT NULL CHECK ("attempt" >= 1),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OpsAlertDelivery_at_idx" ON "OpsAlertDelivery"("at");

-- Append-only audit trails: every mutation is rejected (T-09-01).
CREATE OR REPLACE FUNCTION guard_ops_alert_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'OpsAlertTransition is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OpsAlertTransition_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "OpsAlertTransition" FOR EACH ROW EXECUTE FUNCTION guard_ops_alert_transition();

CREATE OR REPLACE FUNCTION guard_ops_alert_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'OpsAlertDelivery is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OpsAlertDelivery_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "OpsAlertDelivery" FOR EACH ROW EXECUTE FUNCTION guard_ops_alert_delivery();

-- Guarded mutable state (T-09-02): DELETE is rejected entirely; identity and
-- creation facts are frozen; severity/status/count/lastSeen and the operator
-- timestamps acknowledgedAt/resolvedAt are the only allowed changes. Deliberately
-- NOT a blanket append-only trigger — dedup occurrence bumps must keep working.
CREATE OR REPLACE FUNCTION guard_ops_alert_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OpsAlert is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."dedupFingerprint" IS DISTINCT FROM OLD."dedupFingerprint"
     OR NEW."firstSeen" IS DISTINCT FROM OLD."firstSeen"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'OpsAlert identity, dedupFingerprint, firstSeen, and createdAt are immutable';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER "OpsAlert_guarded_transition" BEFORE UPDATE OR DELETE ON "OpsAlert" FOR EACH ROW EXECUTE FUNCTION guard_ops_alert_state();
