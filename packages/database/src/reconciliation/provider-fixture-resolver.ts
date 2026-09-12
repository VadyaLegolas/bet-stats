import { createHash, randomUUID } from "node:crypto";

import type { NormalizedFixture } from "@bet-stats/football-data";

import type { PrismaClient } from "../client.js";

export const PROVIDER_FIXTURE_RESOLVER_VERSION = "fixture-resolver-v1" as const;
export const DEFAULT_KICKOFF_TOLERANCE_MS = 15 * 60_000;

export type ProviderFixtureResolution =
  | { status: "resolved"; fixtureId: string; method: "EXACT_EXTERNAL_REF" | "UNIQUE_CONSERVATIVE_MATCH" }
  | { status: "quarantined"; caseId: string; candidateCount: number };

export async function resolveProviderFixture(
  database: PrismaClient,
  fixture: NormalizedFixture,
  options: { kickoffToleranceMs?: number } = {},
): Promise<ProviderFixtureResolution> {
  const tolerance = options.kickoffToleranceMs ?? DEFAULT_KICKOFF_TOLERANCE_MS;
  const kickoff = new Date(fixture.kickoffUtc);
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || Number.isNaN(kickoff.getTime())) return quarantine(database, fixture, []);

  return database.$transaction(async (transaction) => {
    const db = transaction as unknown as PrismaClient;
    await db.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${fixture.provider}:fixture:${fixture.externalId}`);
    const exact = await db.fixtureExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.externalId } } });
    if (exact) {
      await appendProvenance(db, exact.fixtureId, fixture);
      return { status: "resolved", fixtureId: exact.fixtureId, method: "EXACT_EXTERNAL_REF" };
    }

    const [leagueRef, seasonRef, homeRef, awayRef] = await Promise.all([
      db.leagueExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.competitionExternalId } } }),
      db.seasonExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.seasonExternalId } } }),
      db.teamExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.homeTeamExternalId } } }),
      db.teamExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.awayTeamExternalId } } }),
    ]);
    if (!leagueRef || !seasonRef || !homeRef || !awayRef) return quarantine(db, fixture, []);
    const candidates = await db.fixture.findMany({
      where: { leagueId: leagueRef.leagueId, seasonId: seasonRef.seasonId, homeTeamId: homeRef.teamId, awayTeamId: awayRef.teamId, kickoffUtc: { gte: new Date(kickoff.getTime() - tolerance), lte: new Date(kickoff.getTime() + tolerance) } },
      select: { id: true }, orderBy: { id: "asc" }, take: 2,
    });
    if (candidates.length !== 1) return quarantine(db, fixture, candidates.map(({ id }) => id));
    const fixtureId = candidates[0]!.id;
    await db.fixtureExternalRef.create({ data: { fixtureId, provider: fixture.provider, externalId: fixture.externalId } });
    await appendProvenance(db, fixtureId, fixture);
    return { status: "resolved", fixtureId, method: "UNIQUE_CONSERVATIVE_MATCH" };
  });
}

async function quarantine(database: PrismaClient, fixture: NormalizedFixture, candidateIds: readonly string[]): Promise<ProviderFixtureResolution> {
  const existing = await database.reconciliationCase.findFirst({ where: { entityType: "FIXTURE", provider: fixture.provider, externalId: fixture.externalId, status: "OPEN" }, select: { id: true } });
  if (existing) return { status: "quarantined", caseId: existing.id, candidateCount: candidateIds.length };
  const caseId = `fixture_review_${createHash("sha256").update(`${fixture.provider}\0${fixture.externalId}`).digest("hex").slice(0, 24)}`;
  await database.reconciliationCase.create({ data: {
    id: caseId, entityType: "FIXTURE", provider: fixture.provider, externalId: fixture.externalId,
    incomingSnapshot: jsonValue({ resolverVersion: PROVIDER_FIXTURE_RESOLVER_VERSION, fixture }),
    candidates: { create: candidateIds.map((canonicalEntityId) => ({ id: randomUUID(), canonicalEntityId, method: "MANUAL_REVIEW", confidence: 0, evidence: { reason: "AMBIGUOUS_KICKOFF_WINDOW" } })) },
  } });
  return { status: "quarantined", caseId, candidateCount: candidateIds.length };
}

async function appendProvenance(database: PrismaClient, fixtureId: string, fixture: NormalizedFixture): Promise<void> {
  const rawPayload = JSON.stringify(fixture.raw);
  const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
  await database.fixtureProvenance.upsert({
    where: { provider_payloadHash: { provider: fixture.provider, payloadHash } },
    create: { fixtureId, provider: fixture.provider, observedAt: new Date(fixture.capturedAt), sourceUpdatedAt: fixture.sourceUpdatedAt ? new Date(fixture.sourceUpdatedAt) : null, payloadHash, rawPayload: jsonValue(fixture.raw) },
    update: {},
  });
}

function jsonValue(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}
