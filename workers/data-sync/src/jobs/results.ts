import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";
import { reserveProviderRequest } from "@bet-stats/domain";
import type { NormalizedResult, RequestedDateWindow, ResultProvider } from "@bet-stats/football-data";

import { runGatedIngestion, type GatedIngestionResult, type IngestionLane, type ReservationDecision } from "../ingestion/runner.js";
import type { ReplayJobData } from "../queues/index.js";

interface ResultProviderCompatibility extends Partial<ResultProvider> {
  fetchResults?: () => Promise<readonly NormalizedResult[] | { data: readonly NormalizedResult[]; quota?: unknown }>;
}

export interface ResultSyncJobInput {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  allowance: number;
  jobKey: string;
  providerFactory: () => ResultProviderCompatibility;
  lane?: IngestionLane;
  resetTimezone?: string | null;
  alreadyAuthorized?: boolean;
  runtimeAllowance?: number;
  cache?: { hit: boolean; value?: readonly NormalizedResult[] };
  reserve?: (request: Record<string, unknown>) => Promise<ReservationDecision>;
  observeQuota?: (quota: unknown) => void | Promise<void>;
  database?: PrismaClient;
  window?: RequestedDateWindow;
  now?: Date;
}

export function runResultSyncJob(input: ResultSyncJobInput): Promise<GatedIngestionResult<readonly NormalizedResult[]>> {
  const lane = input.lane ?? "critical";
  const now = input.now ?? new Date();
  const reserve = input.reserve ?? (async () => {
    if (!input.database) throw new Error("A database or reservation function is required");
    return reserveProviderRequest(input.database, {
      provider: input.provider,
      requestDate: now.toISOString().slice(0, 10),
      endpoint: input.endpoint,
      jobKey: input.jobKey,
      allowance: input.allowance,
    });
  });

  return runGatedIngestion({
    provider: input.provider,
    endpoint: input.endpoint,
    capability: input.capability,
    circuit: input.circuit,
    lane,
    allowance: input.allowance,
    resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
    alreadyAuthorized: input.alreadyAuthorized,
    jobKey: input.jobKey,
    cache: input.cache,
    reserve,
    providerFactory: input.providerFactory,
    callProvider: async (provider) => {
      if (provider.fetchResults) return provider.fetchResults();
      if (!provider.fetchCompetitionResults || !input.window) throw new Error("Result provider and requested window are required");
      return provider.fetchCompetitionResults(input.window);
    },
    observeQuota: input.observeQuota,
    persist: input.database ? async (results) => persistResults(input.database!, results) : undefined,
  });
}

export async function runReplayResultJob(input: ReplayJobData, dependencies: { database: PrismaClient; providerFactory: ResultSyncJobInput["providerFactory"]; allowance?: number }): Promise<void> {
  const result = await runResultSyncJob({ provider: input.input.provider, endpoint: "RESULTS", capability: "SUPPORTED", circuit: "CLOSED", allowance: dependencies.allowance ?? 10, jobKey: input.logicalId, providerFactory: dependencies.providerFactory, database: dependencies.database, alreadyAuthorized: true, window: { competitionCode: input.input.competitionId as RequestedDateWindow["competitionCode"], dateFrom: input.unit.from.slice(0, 10), dateTo: input.unit.to.slice(0, 10) } });
  if (result.status !== "completed") throw Object.assign(new Error(result.status), { code: result.status.toUpperCase() });
}

async function persistResults(database: PrismaClient, results: readonly NormalizedResult[]): Promise<void> {
  for (const result of results) {
    await database.$transaction(async (transaction) => {
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
      if (existing[0]?.observationId === durableObservationId) return;
      await transaction.$executeRawUnsafe(
        `INSERT INTO "ResultVersion" (id, "fixtureId", "observationId", "effectiveAt", "observedAt", "homeGoals", "awayGoals", status, revision, "supersedesResultVersionId")
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, 'FINISHED', $8, $9)`,
        randomUUID(),
        fixtureId,
        durableObservationId,
        result.kickoffUtc,
        result.capturedAt,
        result.homeScore,
        result.awayScore,
        (existing[0]?.revision ?? 0) + 1,
        existing[0]?.id ?? null,
      );
    });
  }
}
