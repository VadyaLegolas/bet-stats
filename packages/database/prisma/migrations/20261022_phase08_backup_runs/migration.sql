-- Phase 8 (BAK-01): backup receipts are durable operational evidence. Like
-- SettlementReceipt they are append-only — corrections never rewrite history,
-- so UPDATE/DELETE are frozen at the database level.
CREATE TABLE "BackupRun" (
  "id" TEXT PRIMARY KEY,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "durationMs" INTEGER NOT NULL CHECK ("durationMs" >= 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('SUCCEEDED','FAILED')),
  "offsiteStatus" TEXT NOT NULL CHECK ("offsiteStatus" IN ('NOT_CONFIGURED','COPIED','DEGRADED')),
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('SCHEDULED','MANUAL')),
  "reason" VARCHAR(128),
  "fileName" VARCHAR(256),
  "byteSize" INTEGER CHECK ("byteSize" IS NULL OR "byteSize" >= 0),
  "sha256" VARCHAR(128),
  "offsiteError" VARCHAR(256),
  "dbVersion" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BackupRun_completedAt_idx" ON "BackupRun"("completedAt");

CREATE OR REPLACE FUNCTION guard_backup_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'BackupRun is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "BackupRun_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "BackupRun" FOR EACH ROW EXECUTE FUNCTION guard_backup_run();
