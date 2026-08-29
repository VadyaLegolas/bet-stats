import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { evaluateCapability, reserveProviderRequest, type CapabilityDecision } from "@bet-stats/domain";
import type { FixtureProvider, NormalizedFixture } from "@bet-stats/football-data";

const PROVIDER = "football-data.org";
const ENDPOINT = "FIXTURES";

export interface FixtureSyncJobInput {
  database: PrismaClient;
  leagueId: string;
  seasonId: string;
  jobKey: string;
  allowance: number;
  providerFactory: () => FixtureProvider;
  now?: Date;
}

export type FixtureSyncJobResult =
  | { status: "denied"; reason: Exclude<CapabilityDecision, { allowed: true }>["reason"] | "ALLOWANCE_EXHAUSTED" }
  | { status: "completed"; fixturesProcessed: number; reservationReused: boolean };

export async function runFixtureSyncJob(input: FixtureSyncJobInput): Promise<FixtureSyncJobResult> {
  const now = input.now ?? new Date();
  const key = { provider: PROVIDER, leagueId: input.leagueId, seasonId: input.seasonId, endpoint: ENDPOINT };
  const stored = await input.database.providerCapability.findUnique({
    where: { provider_leagueId_seasonId_endpoint: key },
  });
  const capability = stored
    ? { ...key, supported: stored.supported, verifiedAt: stored.verifiedAt, expiresAt: stored.expiresAt }
    : undefined;
  const decision = evaluateCapability(capability, key, now);
  if (!decision.allowed) return { status: "denied", reason: decision.reason };

  const reservation = await reserveProviderRequest(input.database, {
    provider: PROVIDER,
    requestDate: now.toISOString().slice(0, 10),
    endpoint: ENDPOINT,
    jobKey: input.jobKey,
    allowance: input.allowance,
  });
  if (!reservation.reserved) return { status: "denied", reason: reservation.reason };

  // Construction is intentionally after the durable gate so even constructor-side I/O cannot bypass it.
  const fixtures = await input.providerFactory().fetchPremierLeagueFixtures();
  for (const fixture of fixtures) await persistCanonicalFixture(input.database, input.leagueId, input.seasonId, fixture);
  return { status: "completed", fixturesProcessed: fixtures.length, reservationReused: reservation.reused };
}

async function persistCanonicalFixture(database: PrismaClient, leagueId: string, seasonId: string, fixture: NormalizedFixture): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      `${fixture.provider}:fixture:${fixture.externalId}`,
    );
    const teams = await transaction.$queryRawUnsafe<Array<{ externalId: string; teamId: string }>>(
      `SELECT "externalId", "teamId" FROM "TeamExternalRef" WHERE provider = $1 AND "externalId" IN ($2, $3)`,
      fixture.provider, fixture.homeTeamExternalId, fixture.awayTeamExternalId,
    );
    const teamByExternalId = new Map(teams.map((team) => [team.externalId, team.teamId]));
    const homeTeamId = teamByExternalId.get(fixture.homeTeamExternalId);
    const awayTeamId = teamByExternalId.get(fixture.awayTeamExternalId);
    if (!homeTeamId || !awayTeamId) throw new Error("Fixture team identity is unresolved");

    const references = await transaction.$queryRawUnsafe<Array<{ fixtureId: string }>>(
      `SELECT "fixtureId" FROM "FixtureExternalRef" WHERE provider = $1 AND "externalId" = $2`,
      fixture.provider, fixture.externalId,
    );
    const fixtureId = references[0]?.fixtureId ?? randomUUID();
    if (references[0]) {
      await transaction.$executeRawUnsafe(
        `UPDATE "Fixture" SET "kickoffUtc" = $1::timestamptz, status = $2, "updatedAt" = now() WHERE id = $3`,
        fixture.kickoffUtc, fixture.status, fixtureId,
      );
    } else {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "Fixture" (id, "leagueId", "seasonId", "homeTeamId", "awayTeamId", "kickoffUtc", status, "updatedAt") VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, now())`,
        fixtureId, leagueId, seasonId, homeTeamId, awayTeamId, fixture.kickoffUtc, fixture.status,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "FixtureExternalRef" (id, "fixtureId", provider, "externalId") VALUES ($1, $2, $3, $4)`,
        randomUUID(), fixtureId, fixture.provider, fixture.externalId,
      );
    }
    const rawPayload = JSON.stringify(fixture.raw);
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    await transaction.$executeRawUnsafe(
      `INSERT INTO "FixtureProvenance" (id, "fixtureId", provider, "observedAt", "sourceUpdatedAt", "payloadHash", "rawPayload") VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb) ON CONFLICT (provider, "payloadHash") DO NOTHING`,
      randomUUID(), fixtureId, fixture.provider, fixture.capturedAt, fixture.sourceUpdatedAt, payloadHash, rawPayload,
    );
  });
}
