-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReconciliationEntityType" AS ENUM ('LEAGUE', 'SEASON', 'TEAM', 'PLAYER', 'FIXTURE');

-- CreateEnum
CREATE TYPE "ReconciliationCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReconciliationCandidateStatus" AS ENUM ('SUGGESTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationAction" AS ENUM ('LINK', 'CREATE', 'QUARANTINE', 'REJECT');

-- CreateEnum
CREATE TYPE "ReconciliationMethod" AS ENUM ('EXACT_EXTERNAL_REF', 'UNIQUE_CONSERVATIVE_MATCH', 'MANUAL_REVIEW', 'OPERATOR_CONFIRMED');

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "currentTeamId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "countryCode" TEXT,
    "dateOfBirth" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoffUtc" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueExternalRef" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonExternalRef" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamExternalRef" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerExternalRef" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixtureExternalRef" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixtureExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixtureProvenance" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3),
    "payloadHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "FixtureProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationCase" (
    "id" TEXT NOT NULL,
    "entityType" "ReconciliationEntityType" NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "ReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "incomingSnapshot" JSONB NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationCandidate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "canonicalEntityId" TEXT NOT NULL,
    "status" "ReconciliationCandidateStatus" NOT NULL DEFAULT 'SUGGESTED',
    "method" "ReconciliationMethod" NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" "ReconciliationAction" NOT NULL,
    "method" "ReconciliationMethod" NOT NULL,
    "canonicalEntityId" TEXT,
    "evidence" JSONB NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "actor" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesDecisionId" TEXT,

    CONSTRAINT "ReconciliationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "League_countryCode_name_idx" ON "League"("countryCode", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_label_key" ON "Season"("leagueId", "label");

-- CreateIndex
CREATE INDEX "Team_countryCode_normalizedName_idx" ON "Team"("countryCode", "normalizedName");

-- CreateIndex
CREATE INDEX "Player_normalizedName_countryCode_idx" ON "Player"("normalizedName", "countryCode");

-- CreateIndex
CREATE INDEX "Fixture_homeTeamId_awayTeamId_kickoffUtc_idx" ON "Fixture"("homeTeamId", "awayTeamId", "kickoffUtc");

-- CreateIndex
CREATE INDEX "Fixture_leagueId_kickoffUtc_idx" ON "Fixture"("leagueId", "kickoffUtc");

-- CreateIndex
CREATE INDEX "LeagueExternalRef_leagueId_idx" ON "LeagueExternalRef"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueExternalRef_provider_externalId_key" ON "LeagueExternalRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "SeasonExternalRef_seasonId_idx" ON "SeasonExternalRef"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonExternalRef_provider_externalId_key" ON "SeasonExternalRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "TeamExternalRef_teamId_idx" ON "TeamExternalRef"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamExternalRef_provider_externalId_key" ON "TeamExternalRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "PlayerExternalRef_playerId_idx" ON "PlayerExternalRef"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerExternalRef_provider_externalId_key" ON "PlayerExternalRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "FixtureExternalRef_fixtureId_idx" ON "FixtureExternalRef"("fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "FixtureExternalRef_provider_externalId_key" ON "FixtureExternalRef"("provider", "externalId");

-- CreateIndex
CREATE INDEX "FixtureProvenance_fixtureId_observedAt_idx" ON "FixtureProvenance"("fixtureId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FixtureProvenance_provider_payloadHash_key" ON "FixtureProvenance"("provider", "payloadHash");

-- CreateIndex
CREATE INDEX "ReconciliationCase_status_entityType_idx" ON "ReconciliationCase"("status", "entityType");

-- CreateIndex
CREATE INDEX "ReconciliationCase_provider_externalId_idx" ON "ReconciliationCase"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ReconciliationCandidate_canonicalEntityId_idx" ON "ReconciliationCandidate"("canonicalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCandidate_caseId_canonicalEntityId_key" ON "ReconciliationCandidate"("caseId", "canonicalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationDecision_supersedesDecisionId_key" ON "ReconciliationDecision"("supersedesDecisionId");

-- CreateIndex
CREATE INDEX "ReconciliationDecision_caseId_decidedAt_idx" ON "ReconciliationDecision"("caseId", "decidedAt");

-- CreateIndex
CREATE INDEX "ReconciliationDecision_canonicalEntityId_idx" ON "ReconciliationDecision"("canonicalEntityId");

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_currentTeamId_fkey" FOREIGN KEY ("currentTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueExternalRef" ADD CONSTRAINT "LeagueExternalRef_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonExternalRef" ADD CONSTRAINT "SeasonExternalRef_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamExternalRef" ADD CONSTRAINT "TeamExternalRef_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerExternalRef" ADD CONSTRAINT "PlayerExternalRef_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureExternalRef" ADD CONSTRAINT "FixtureExternalRef_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixtureProvenance" ADD CONSTRAINT "FixtureProvenance_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationCandidate" ADD CONSTRAINT "ReconciliationCandidate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_supersedesDecisionId_fkey" FOREIGN KEY ("supersedesDecisionId") REFERENCES "ReconciliationDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-12: reconciliation evidence is append-only. Corrections create a new row
-- linked through supersedesDecisionId; existing decisions cannot be rewritten.
CREATE FUNCTION "prevent_reconciliation_decision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ReconciliationDecision is append-only';
END;
$$;

CREATE TRIGGER "ReconciliationDecision_append_only"
BEFORE UPDATE OR DELETE ON "ReconciliationDecision"
FOR EACH ROW EXECUTE FUNCTION "prevent_reconciliation_decision_mutation"();
