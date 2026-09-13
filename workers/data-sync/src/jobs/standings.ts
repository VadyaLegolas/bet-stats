import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient, ReplayProviderPolicyRepository } from "@bet-stats/database";
import { reservePriorityRequest } from "@bet-stats/domain";
import { classifyProviderFailure, createProviderRoute, providerRouteJobId, type NormalizedStandingSnapshot, type StandingsProvider, type StandingsRequestCoverage } from "@bet-stats/football-data";

import { runGatedIngestion, type CircuitProbeRegistry, type GatedIngestionResult, type IngestionLane, type ReservationDecision } from "../ingestion/runner.js";
import type { ReplayJobData } from "../queues/index.js";
import type { ReplayExecutionContext } from "../queues/replay-execution.js";
import { readReplayWorkerProviderPolicy } from "../resilience/provider-policy.js";
import { callMappedStandingsProvider, createMappedProviderCandidates, executeDurableMappedRoute, resolveEndpointCandidateMappings, type LiveProviderFactories } from "../ingestion/provider-route-runtime.js";
import { resolveCandidateExternalMapping } from "./fixtures.js";

export interface StandingsSyncInput {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  circuitRegistry?: CircuitProbeRegistry;
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
  beforeDispatch?: () => Promise<void>;
  publish?: (snapshot: NormalizedStandingSnapshot) => Promise<void>;
}

export function createStandingsJobRoute(scope: { competition: string; season: string }) {
  const route = createProviderRoute({ ...scope, endpoint: "STANDINGS" });
  return { jobId: providerRouteJobId(route), route };
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
    circuitRegistry: input.circuitRegistry,
    lane,
    allowance: input.allowance,
    resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
    jobKey: input.jobKey,
    reserve,
    beforeDispatch: input.beforeDispatch,
    providerFactory: input.providerFactory,
    callProvider: (provider) => provider.fetchCompetitionStandings(input.coverage),
    persist,
    publish: input.publish,
  });
}

export async function runReplayStandingsJob(input: ReplayJobData, dependencies: {
  database: PrismaClient;
  providerFactory: StandingsSyncInput["providerFactory"];
  providerFactories?: LiveProviderFactories;
  providerRoutingRepository?: any;
  providerPolicyRepository: ReplayProviderPolicyRepository;
  circuitRegistry: CircuitProbeRegistry;
}, context: ReplayExecutionContext): Promise<void> {
  const policy = await readReplayWorkerProviderPolicy({
    database: dependencies.database,
    providerPolicyRepository: dependencies.providerPolicyRepository,
    replayPlanId: input.replayPlanId,
    provider: input.input.provider,
    endpointFamily: "STANDINGS",
  });
  const snapshot = policy.snapshot;
  const refs = await dependencies.database.$queryRawUnsafe<Array<{ leagueId: string; seasonId: string }>>(`SELECT l."leagueId",s."seasonId" FROM "LeagueExternalRef" l JOIN "SeasonExternalRef" s ON s.provider=l.provider AND s."leagueId"=l."leagueId" JOIN "Season" season ON season.id=s."seasonId" AND season."leagueId"=s."leagueId" WHERE l.provider=$1 AND l."externalId"=$2 AND s."externalId"=$3 LIMIT 2`, input.input.provider, input.input.competitionId, input.input.seasonId);
  const ref = refs[0]; if (refs.length !== 1 || !ref) throw Object.assign(new Error(refs.length ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED"), { code: refs.length ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED" });
  const mapped = await resolveEndpointCandidateMappings({ competition: input.input.competitionId, season: input.input.seasonId, endpoint: "STANDINGS", leagueId: ref.leagueId, seasonId: ref.seasonId, resolveMapping: (leagueId, seasonId, provider) => resolveCandidateExternalMapping(dependencies.database, leagueId, seasonId, provider) });
  if (dependencies.providerFactories && dependencies.providerRoutingRepository) {
    const coverage = { competitionCode: input.input.competitionId as StandingsRequestCoverage["competitionCode"] };
    const routed = await executeDurableMappedRoute<NormalizedStandingSnapshot>({ database: dependencies.database, repository: dependencies.providerRoutingRepository, context, route: mapped.route, candidates: createMappedProviderCandidates(mapped.route, mapped.mappings, dependencies.providerFactories), leagueId: ref.leagueId, seasonId: ref.seasonId, correlationId: `${input.logicalId}:${input.revision}:${context.attemptNumber}`, attemptKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:STANDINGS`, allowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, lane: snapshot.lane!, call: (dispatch) => callMappedStandingsProvider(dispatch, coverage) as Promise<NormalizedStandingSnapshot> });
    if (routed.status !== "completed") throw Object.assign(new Error(routed.status === "limited" ? routed.reason : "ROUTE_REPLAYED"), { code: routed.status === "limited" ? routed.reason : "ROUTE_REPLAYED" });
    await context.publish((transaction) => persistStandingSnapshot(transaction as unknown as PrismaClient, ref.leagueId, ref.seasonId, routed.value, true), completionManifest(input));
    return;
  }
  const jobKey = `${input.logicalId}:${input.revision}:${context.attemptNumber}:request:1`;
  const result = await runStandingsSync({ provider: input.input.provider, endpoint: "STANDINGS", capability: "SUPPORTED", circuit: snapshot.circuit.state!, circuitRegistry: dependencies.circuitRegistry, lane: snapshot.lane!, allowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, resetTimezone: snapshot.resetTimezone, resetDate: snapshot.resetDate!, jobKey, coverage: { competitionCode: input.input.competitionId as StandingsRequestCoverage["competitionCode"] }, providerFactory: dependencies.providerFactory, database: dependencies.database, leagueId: ref.leagueId, seasonId: ref.seasonId, reserve: () => context.admitRequest((transaction) => reservePriorityRequest({ database: transaction as unknown as PrismaClient, provider: input.input.provider, resetDate: snapshot.resetDate!, resetTimezone: snapshot.resetTimezone, endpointFamily: "STANDINGS", lane: snapshot.lane!, configuredAllowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, jobKey })), beforeDispatch: context.assertOwner, publish: (standing) => context.publish((transaction) => persistStandingSnapshot(transaction as unknown as PrismaClient, ref.leagueId, ref.seasonId, standing, true), completionManifest(input)) });
  if (result.status !== "completed") {
    const code = result.status === "denied" ? result.reason : result.status.toUpperCase();
    throw Object.assign(new Error(code), { code });
  }
}

async function persistStandingSnapshot(
  database: PrismaClient,
  leagueId: string,
  seasonId: string,
  snapshot: NormalizedStandingSnapshot,
  transactionOwned = false,
): Promise<void> {
  const write = async (transaction: PrismaClient) => {
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
  };
  if (transactionOwned) await write(database);
  else await database.$transaction((transaction) => write(transaction as unknown as PrismaClient));
}

function completionManifest(input: ReplayJobData) { return { expectedUnits: [input.logicalId], completedUnits: [input.logicalId], expectedCaptures: [input.logicalId], completedCaptures: [input.logicalId], delivery: "DELIVERED" }; }
