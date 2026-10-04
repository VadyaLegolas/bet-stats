-- D-15: provider season identifiers are scoped by canonical competition.
-- Add the scope as nullable first so existing rows can be backfilled losslessly.
ALTER TABLE "SeasonExternalRef" ADD COLUMN "leagueId" TEXT;

UPDATE "SeasonExternalRef" AS ref
SET "leagueId" = season."leagueId"
FROM "Season" AS season
WHERE season."id" = ref."seasonId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SeasonExternalRef" WHERE "leagueId" IS NULL) THEN
    RAISE EXCEPTION 'SeasonExternalRef league scope backfill left null rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SeasonExternalRef" ref
    JOIN "Season" season ON season."id" = ref."seasonId"
    WHERE ref."leagueId" <> season."leagueId"
  ) THEN
    RAISE EXCEPTION 'SeasonExternalRef league scope does not match its canonical season';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SeasonExternalRef"
    GROUP BY "provider", "leagueId", "externalId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate provider season identity inside canonical league scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SeasonExternalRef"
    GROUP BY "provider", "seasonId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple provider mappings for one canonical season';
  END IF;
END $$;

ALTER TABLE "SeasonExternalRef" ALTER COLUMN "leagueId" SET NOT NULL;

DROP INDEX "SeasonExternalRef_provider_externalId_key";
DROP INDEX "SeasonExternalRef_seasonId_idx";
ALTER TABLE "SeasonExternalRef" DROP CONSTRAINT "SeasonExternalRef_seasonId_fkey";

CREATE UNIQUE INDEX "Season_id_leagueId_key" ON "Season"("id", "leagueId");
CREATE UNIQUE INDEX "SeasonExternalRef_provider_leagueId_externalId_key"
  ON "SeasonExternalRef"("provider", "leagueId", "externalId");
CREATE UNIQUE INDEX "SeasonExternalRef_provider_seasonId_key"
  ON "SeasonExternalRef"("provider", "seasonId");
CREATE INDEX "SeasonExternalRef_seasonId_leagueId_idx"
  ON "SeasonExternalRef"("seasonId", "leagueId");

ALTER TABLE "SeasonExternalRef"
  ADD CONSTRAINT "SeasonExternalRef_seasonId_leagueId_fkey"
  FOREIGN KEY ("seasonId", "leagueId") REFERENCES "Season"("id", "leagueId")
  ON DELETE CASCADE ON UPDATE CASCADE;
