-- Phase 8 (BAK-02): restore-drill verification receipts are the durable proof
-- of restorability that the operations center projects. Like BackupRun and
-- SettlementReceipt they are append-only — a failed or unverified drill is a
-- permanent fact, so UPDATE/DELETE are frozen at the database level (D-12).
CREATE TABLE "BackupVerificationReceipt" (
  "id" TEXT PRIMARY KEY,
  "backupFileName" VARCHAR(256),
  "restoreDurationMs" INTEGER NOT NULL CHECK ("restoreDurationMs" >= 0),
  "checks" JSONB NOT NULL,
  "containerCleanup" TEXT NOT NULL CHECK ("containerCleanup" IN ('REMOVED','FAILED','NOT_STARTED')),
  "overall" TEXT NOT NULL CHECK ("overall" IN ('VERIFIED','FAILED','UNVERIFIED')),
  "dbVersion" VARCHAR(128),
  "failureReason" VARCHAR(128),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BackupVerificationReceipt_completedAt_idx" ON "BackupVerificationReceipt"("completedAt");

CREATE OR REPLACE FUNCTION guard_backup_verification_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'BackupVerificationReceipt is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "BackupVerificationReceipt_guarded_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "BackupVerificationReceipt" FOR EACH ROW EXECUTE FUNCTION guard_backup_verification_receipt();
