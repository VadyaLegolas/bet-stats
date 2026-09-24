CREATE TYPE "RetainedViewResourceType" AS ENUM ('RESULT');

-- Do not let values accepted by the legacy schema silently disappear or block
-- deployment. Preserve each non-canonical association for audited review.
CREATE TABLE "RetentionMigrationQuarantine" (
  "id" TEXT NOT NULL,
  "migration" TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL,
  "quarantinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionMigrationQuarantine_pkey" PRIMARY KEY ("id", "migration")
);

WITH invalid AS (
  SELECT id, "resourceType", "resourceId", "subjectId", "consentId", "viewedAt", "expiresAt", "createdAt"
  FROM "RetainedViewHistory"
  WHERE "resourceType" <> 'RESULT'
     OR "resourceId" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
)
INSERT INTO "RetentionMigrationQuarantine" (id, "migration", reason, payload)
SELECT id, '20260924_retained_view_bounds', 'INVALID_RETAINED_VIEW_BOUND',
  jsonb_build_object('resourceType', "resourceType", 'resourceId', "resourceId", 'subjectId', "subjectId", 'consentId', "consentId", 'viewedAt', "viewedAt", 'expiresAt', "expiresAt", 'createdAt', "createdAt")
FROM invalid;

DELETE FROM "RetainedViewHistory"
WHERE "resourceType" <> 'RESULT'
   OR "resourceId" !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';

ALTER TABLE "RetainedViewHistory"
  DROP CONSTRAINT "RetainedViewHistory_resource_nonempty",
  ALTER COLUMN "resourceType" TYPE "RetainedViewResourceType" USING ("resourceType"::"RetainedViewResourceType"),
  ALTER COLUMN "resourceId" TYPE VARCHAR(128),
  ADD CONSTRAINT "RetainedViewHistory_resource_id_canonical"
    CHECK ("resourceId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
