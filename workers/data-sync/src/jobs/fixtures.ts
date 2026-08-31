import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { evaluateCapability, reserveProviderRequest, type CapabilityDecision } from "@bet-stats/domain";
import type { FixtureProvider, NormalizedFixture } from "@bet-stats/football-data";

import type { ReplayJobData } from "../queues/index.js";

const PROVIDER = "football-data.org";
const ENDPOINT = "FIXTURES";

export interface FixtureSyncJobInput {
  database: PrismaClient;
  leagueId: string;
  seasonId: string;
  jobKey: string;
  allowance: number;
  providerFactory: () => FixtureProvider;
  scope?: {
    competitionExternalId: string;
    seasonExternalId: string;
    from: string;
    to: string;
  };
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
  const fetched = await input.providerFactory().fetchPremierLeagueFixtures();
  const fixtures = input.scope ? fetched.filter((fixture) => {
    const kickoff = Date.parse(fixture.kickoffUtc);
    return fixture.competitionExternalId === input.scope!.competitionExternalId
      && fixture.seasonExternalId === input.scope!.seasonExternalId
      && kickoff >= Date.parse(input.scope!.from)
      && kickoff <= Date.parse(input.scope!.to);
  }) : fetched;
  for (const fixture of fixtures) await persistCanonicalFixture(input.database, input.leagueId, input.seasonId, fixture);
  return { status: "completed", fixturesProcessed: fixtures.length, reservationReused: reservation.reused };
}

export async function runReplayFixtureJob(
  input: ReplayJobData,
  dependencies: { database: PrismaClient; providerFactory: () => FixtureProvider; allowance?: number },
): Promise<void> {
  const from = Date.parse(input.unit.from);
  const to = Date.parse(input.unit.to);
  const requestedFrom = Date.parse(input.input.from);
  const requestedTo = Date.parse(input.input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || from < requestedFrom || to > requestedTo) {
    throw Object.assign(new Error("INVALID_REPLAY_WINDOW"), { code: "INVALID_REPLAY_WINDOW" });
  }
  const refs = await dependencies.database.$queryRawUnsafe<Array<{ leagueId: string; seasonId: string }>>(
    `SELECT l."leagueId", s."seasonId"
     FROM "LeagueExternalRef" l
     JOIN "SeasonExternalRef" s ON s.provider=l.provider
     JOIN "Season" season ON season.id=s."seasonId" AND season."leagueId"=l."leagueId"
     WHERE l.provider=$1 AND l."externalId"=$2 AND s."externalId"=$3
     LIMIT 1`,
    input.input.provider,
    input.input.competitionId,
    input.input.seasonId,
  );
  const ref = refs[0];
  if (!ref) throw Object.assign(new Error("IDENTITY_UNRESOLVED"), { code: "IDENTITY_UNRESOLVED" });

  const result = await runFixtureSyncJob({
    database: dependencies.database,
    leagueId: ref.leagueId,
    seasonId: ref.seasonId,
    jobKey: input.logicalId,
    allowance: dependencies.allowance ?? 10,
    providerFactory: dependencies.providerFactory,
    scope: {
      competitionExternalId: input.input.competitionId,
      seasonExternalId: input.input.seasonId,
      from: input.unit.from,
      to: input.unit.to,
    },
  });
  if (result.status !== "completed") {
    throw Object.assign(new Error(result.reason), { code: result.reason });
  }
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
