import { createHash, randomUUID } from "node:crypto";

import type { NormalizedResult } from "@bet-stats/football-data";

import type { PrismaClient } from "./client.js";

export async function persistResults(database: PrismaClient, results: readonly NormalizedResult[]): Promise<void> {
  await database.$transaction((transaction) => persistResultsInTransaction(transaction as unknown as PrismaClient, results));
}

export async function persistResultsInTransaction(transaction: PrismaClient, results: readonly NormalizedResult[]): Promise<Array<{ fixtureId: string; resultVersionId: string }>> {
  const published: Array<{ fixtureId: string; resultVersionId: string }> = [];
  for (const result of results) {
      await transaction.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        `${result.provider}:result:${result.externalId}`,
      );
      const fixtures = await transaction.$queryRawUnsafe<Array<{ fixtureId: string }>>(
        `SELECT "fixtureId" FROM "FixtureExternalRef" WHERE provider = $1 AND "externalId" = $2`,
        result.provider,
        result.externalId,
      );
      const fixtureId = fixtures[0]?.fixtureId;
      if (!fixtureId) throw new Error("Result fixture identity is unresolved");

      const rawPayload = JSON.stringify(result.raw);
      const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
      const observationId = randomUUID();
      const observations = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "SourceObservation" (id, provider, "endpointFamily", "externalIdentity", "requestedFrom", "requestedTo", "returnedFrom", "returnedTo", "observedAt", "sourceUpdatedAt", "payloadHash", "rawPayload", "payloadBytes")
         VALUES ($1, $2, 'RESULTS', $3, $4::date, $5::date, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10, $11::jsonb, $12)
         ON CONFLICT (provider, "endpointFamily", "payloadHash") DO NOTHING RETURNING id`,
        observationId,
        result.provider,
        result.externalId,
        result.requestedWindow.dateFrom,
        result.requestedWindow.dateTo,
        result.returnedCoverage.earliestKickoffUtc,
        result.returnedCoverage.latestKickoffUtc,
        result.capturedAt,
        result.sourceUpdatedAt,
        payloadHash,
        rawPayload,
        Buffer.byteLength(rawPayload),
      );
      const reused = observations.length === 0
        ? await transaction.$queryRawUnsafe<Array<{ id: string; provider: string; endpointFamily: string; payloadHash: string }>>(
            `SELECT id, provider, "endpointFamily", "payloadHash" FROM "SourceObservation"
             WHERE provider = $1 AND "endpointFamily" = 'RESULTS' AND "payloadHash" = $2`,
            result.provider,
            payloadHash,
          )
        : [];
      const reusedObservation = reused[0];
      if (reusedObservation &&
          (reusedObservation.provider !== result.provider || reusedObservation.endpointFamily !== "RESULTS" || reusedObservation.payloadHash !== payloadHash)) {
        throw new Error("Result observation identity mismatch");
      }
      const durableObservationId = observations[0]?.id ?? reusedObservation?.id;
      if (!durableObservationId) throw new Error("Result observation was not persisted");
      const existing = await transaction.$queryRawUnsafe<Array<{ observationId: string; revision: number; id: string }>>(
        `SELECT "observationId", revision, id FROM "ResultVersion" WHERE "fixtureId" = $1 ORDER BY revision DESC LIMIT 1`,
        fixtureId,
      );
      if (existing[0]?.observationId === durableObservationId) { published.push({ fixtureId, resultVersionId: existing[0].id }); continue; }
      const resultVersionId = randomUUID();
      await transaction.$executeRawUnsafe(
        `INSERT INTO "ResultVersion" (id, "fixtureId", "observationId", "effectiveAt", "observedAt", "homeGoals", "awayGoals", status, revision, "supersedesResultVersionId")
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'FINISHED', $8, $9)`,
        resultVersionId,
        fixtureId,
        durableObservationId,
        result.kickoffUtc,
        result.capturedAt,
        result.homeScore,
        result.awayScore,
        (existing[0]?.revision ?? 0) + 1,
        existing[0]?.id ?? null,
      );
      published.push({ fixtureId, resultVersionId });
  }
  return published;
}
