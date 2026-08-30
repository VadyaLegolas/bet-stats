import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { reservePriorityRequest } from "@bet-stats/domain";
import type { NormalizedStandingSnapshot, StandingsProvider, StandingsRequestCoverage } from "@bet-stats/football-data";

import { runGatedIngestion, type GatedIngestionResult, type IngestionLane, type ReservationDecision } from "../ingestion/runner.js";

export interface StandingsSyncInput {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  lane?: IngestionLane;
  allowance: number;
  criticalHeadroom: number;
  resetTimezone?: string | null;
  resetDate?: string;
  jobKey: string;
  coverage: StandingsRequestCoverage;
  providerFactory: () => Pick<StandingsProvider, "fetchCompetitionStandings">;
  reserve?: (request: Record<string, unknown>) => Promise<ReservationDecision>;
  persist?: (snapshot: NormalizedStandingSnapshot) => Promise<void>;
  database?: PrismaClient;
  leagueId?: string;
  seasonId?: string;
  now?: Date;
}

export function runStandingsSync(input: StandingsSyncInput): Promise<GatedIngestionResult<NormalizedStandingSnapshot>> {
  const now = input.now ?? new Date();
  const lane = input.lane ?? "standard";
  const reserve = input.reserve ?? (async () => {
    if (!input.database) throw new Error("A database or reservation function is required");
    return reservePriorityRequest({
      database: input.database,
      provider: input.provider,
      resetDate: input.resetDate ?? now.toISOString().slice(0, 10),
      resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
      endpointFamily: input.endpoint,
      lane,
      configuredAllowance: input.allowance,
      criticalHeadroom: input.criticalHeadroom,
      jobKey: input.jobKey,
    });
  });
  const persist = input.persist ?? (input.database && input.leagueId && input.seasonId
    ? (snapshot: NormalizedStandingSnapshot) => persistStandingSnapshot(input.database!, input.leagueId!, input.seasonId!, snapshot)
    : undefined);

  return runGatedIngestion({
    provider: input.provider,
    endpoint: input.endpoint,
    capability: input.capability,
    circuit: input.circuit,
    lane,
    allowance: input.allowance,
    resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
    jobKey: input.jobKey,
    reserve,
    providerFactory: input.providerFactory,
    callProvider: (provider) => provider.fetchCompetitionStandings(input.coverage),
    persist,
  });
}

async function persistStandingSnapshot(
  database: PrismaClient,
  leagueId: string,
  seasonId: string,
  snapshot: NormalizedStandingSnapshot,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    const rawPayload = JSON.stringify(snapshot.raw);
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${snapshot.provider}:standings:${leagueId}:${seasonId}:${payloadHash}`);
    const observationRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "SourceObservation" (id, provider, "endpointFamily", "externalIdentity", "observedAt", "sourceUpdatedAt", "payloadHash", "rawPayload", "payloadBytes")
       VALUES ($1, $2, 'STANDINGS', $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb, $8)
       ON CONFLICT (provider, "endpointFamily", "payloadHash") DO NOTHING RETURNING id`,
      randomUUID(), snapshot.provider, snapshot.competitionExternalId, snapshot.capturedAt, snapshot.sourceUpdatedAt,
      payloadHash, rawPayload, Buffer.byteLength(rawPayload),
    );
    const reused = observationRows.length === 0
      ? await transaction.$queryRawUnsafe<Array<{ id: string; provider: string; endpointFamily: string; payloadHash: string }>>(
          `SELECT id, provider, "endpointFamily", "payloadHash" FROM "SourceObservation"
           WHERE provider = $1 AND "endpointFamily" = 'STANDINGS' AND "payloadHash" = $2`,
          snapshot.provider,
          payloadHash,
        )
      : [];
    const reusedObservation = reused[0];
    if (reusedObservation &&
        (reusedObservation.provider !== snapshot.provider || reusedObservation.endpointFamily !== "STANDINGS" || reusedObservation.payloadHash !== payloadHash)) {
      throw new Error("Standing observation identity mismatch");
    }
    const observationId = observationRows[0]?.id ?? reusedObservation?.id;
    if (!observationId) throw new Error("Standing observation was not persisted");
    const existing = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "StandingSnapshot" WHERE "leagueId" = $1 AND "seasonId" = $2 AND "observationId" = $3`,
      leagueId, seasonId, observationId,
    );
    if (existing[0]) return;
    const teamRefs = await transaction.$queryRawUnsafe<Array<{ externalId: string; teamId: string }>>(
      `SELECT "externalId", "teamId" FROM "TeamExternalRef" WHERE provider = $1 AND "externalId" = ANY($2::text[])`,
      snapshot.provider, snapshot.rows.map((row) => row.teamExternalId),
    );
    const teamIds = new Map(teamRefs.map((reference) => [reference.externalId, reference.teamId]));
    if (teamIds.size !== snapshot.rows.length) throw new Error("Standing team identity is unresolved");
    const snapshotId = randomUUID();
    await transaction.$executeRawUnsafe(
      `INSERT INTO "StandingSnapshot" (id, "leagueId", "seasonId", "observationId", "effectiveAt", "observedAt", "isComplete", "rowCount") VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, true, $7)`,
      snapshotId, leagueId, seasonId, observationId, snapshot.sourceUpdatedAt ?? snapshot.capturedAt, snapshot.capturedAt, snapshot.rows.length,
    );
    for (const row of snapshot.rows) {
      await transaction.$executeRawUnsafe(
        `INSERT INTO "StandingSnapshotRow" (id, "snapshotId", "teamId", position, played, points, "goalsFor", "goalsAgainst") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        randomUUID(), snapshotId, teamIds.get(row.teamExternalId), row.position, row.playedGames, row.points, row.goalsFor, row.goalsAgainst,
      );
    }
  });
}
