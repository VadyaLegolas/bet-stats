CREATE TABLE "ReplayPreview" (
  "id" TEXT NOT NULL,
  "logicalKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "previewVersion" TEXT NOT NULL,
  "normalizedInput" JSONB NOT NULL,
  "unitManifest" JSONB NOT NULL,
  "impact" JSONB NOT NULL,
  "providerPolicyFingerprint" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "actor" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReplayPreview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReplayPreview_version_positive" CHECK ("version" > 0),
  CONSTRAINT "ReplayPreview_consumed_after_created" CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt")
);
CREATE UNIQUE INDEX "ReplayPreview_previewVersion_key" ON "ReplayPreview"("previewVersion");
CREATE UNIQUE INDEX "ReplayPreview_logicalKey_version_key" ON "ReplayPreview"("logicalKey", "version");
CREATE INDEX "ReplayPreview_logicalKey_expiresAt_idx" ON "ReplayPreview"("logicalKey", "expiresAt");

ALTER TABLE "ReplayPlan" ADD COLUMN "previewId" TEXT;
CREATE UNIQUE INDEX "ReplayPlan_previewId_key" ON "ReplayPlan"("previewId");
ALTER TABLE "ReplayPlan" ADD CONSTRAINT "ReplayPlan_previewId_fkey" FOREIGN KEY ("previewId") REFERENCES "ReplayPreview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_replay_preview"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ReplayPreview is immutable'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."logicalKey" IS DISTINCT FROM OLD."logicalKey"
     OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."previewVersion" IS DISTINCT FROM OLD."previewVersion"
     OR NEW."normalizedInput" IS DISTINCT FROM OLD."normalizedInput" OR NEW."unitManifest" IS DISTINCT FROM OLD."unitManifest"
     OR NEW."impact" IS DISTINCT FROM OLD."impact" OR NEW."providerPolicyFingerprint" IS DISTINCT FROM OLD."providerPolicyFingerprint"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."actor" IS DISTINCT FROM OLD."actor"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'ReplayPreview frozen content is immutable';
  END IF;
  IF OLD."consumedAt" IS NOT NULL OR NEW."consumedAt" IS NULL THEN
    RAISE EXCEPTION 'ReplayPreview may be consumed exactly once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ReplayPreview_guard" BEFORE UPDATE OR DELETE ON "ReplayPreview"
FOR EACH ROW EXECUTE FUNCTION "guard_replay_preview"();
