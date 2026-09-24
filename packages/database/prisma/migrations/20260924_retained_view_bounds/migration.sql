CREATE TYPE "RetainedViewResourceType" AS ENUM ('RESULT');

ALTER TABLE "RetainedViewHistory"
  DROP CONSTRAINT "RetainedViewHistory_resource_nonempty",
  ALTER COLUMN "resourceType" TYPE "RetainedViewResourceType" USING ("resourceType"::"RetainedViewResourceType"),
  ALTER COLUMN "resourceId" TYPE VARCHAR(128),
  ADD CONSTRAINT "RetainedViewHistory_resource_id_canonical"
    CHECK ("resourceId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
