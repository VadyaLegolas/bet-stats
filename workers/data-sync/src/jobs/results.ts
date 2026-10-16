import { persistResults, persistResultsInTransaction, SETTLEMENT_PIPELINE_POLICY_HASH, type PrismaClient, type ReplayProviderPolicyRepository } from "@bet-stats/database";
import { reservePriorityRequest } from "@bet-stats/domain";
import { classifyProviderFailure, createProviderRoute, providerRouteJobId, type NormalizedResult, type RequestedDateWindow, type ResultProvider } from "@bet-stats/football-data";

import { runGatedIngestion, type CircuitProbeRegistry, type GatedIngestionResult, type IngestionLane, type ReservationDecision } from "../ingestion/runner.js";
import type { ReplayJobData, SettlementJobData } from "../queues/index.js";
import type { ReplayExecutionContext } from "../queues/replay-execution.js";
import { readReplayWorkerProviderPolicy } from "../resilience/provider-policy.js";
import { callMappedResultProvider, createMappedProviderCandidates, executeDurableMappedRoute, resolveEndpointCandidateMappings, type LiveProviderFactories } from "../ingestion/provider-route-runtime.js";
import { resolveCandidateExternalMapping } from "./fixtures.js";

interface ResultProviderCompatibility extends Partial<ResultProvider> {
  fetchResults?: () => Promise<readonly NormalizedResult[] | { data: readonly NormalizedResult[]; quota?: unknown }>;
}

export function createResultJobRoute(scope: { competition: string; season: string }) {
  const route = createProviderRoute({ ...scope, endpoint: "RESULTS" });
  return { jobId: providerRouteJobId(route), route };
}

export interface ResultSyncJobInput {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  circuitRegistry?: CircuitProbeRegistry;
  allowance: number;
  jobKey: string;
  providerFactory: () => ResultProviderCompatibility;
  lane?: IngestionLane;
  resetTimezone?: string | null;
  alreadyAuthorized?: boolean;
  resetDate?: string;
  criticalHeadroom?: number;
  runtimeAllowance?: number;
  cache?: { hit: boolean; value?: readonly NormalizedResult[] };
  reserve?: (request: Record<string, unknown>) => Promise<ReservationDecision>;
  observeQuota?: (quota: unknown) => void | Promise<void>;
  database?: PrismaClient;
  window?: RequestedDateWindow;
  now?: Date;
  beforeDispatch?: () => Promise<void>;
  publish?: (results: readonly NormalizedResult[]) => Promise<void>;
}

export function runResultSyncJob(input: ResultSyncJobInput): Promise<GatedIngestionResult<readonly NormalizedResult[]>> {
  const lane = input.lane ?? "critical";
  const now = input.now ?? new Date();
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
      criticalHeadroom: input.criticalHeadroom ?? 0,
      jobKey: input.jobKey,
    });
  });

  return runGatedIngestion({
    provider: input.provider,
    endpoint: input.endpoint,
    capability: input.capability,
    circuit: input.circuit,
    circuitRegistry: input.circuitRegistry,
    lane,
    allowance: input.allowance,
    resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
    alreadyAuthorized: input.alreadyAuthorized,
    jobKey: input.jobKey,
    cache: input.cache,
    reserve,
    beforeDispatch: input.beforeDispatch,
    providerFactory: input.providerFactory,
    callProvider: async (provider) => {
      if (provider.fetchResults) return provider.fetchResults();
      if (!provider.fetchCompetitionResults || !input.window) throw new Error("Result provider and requested window are required");
      return provider.fetchCompetitionResults(input.window);
    },
    observeQuota: input.observeQuota,
    persist: input.database ? async (results) => persistResults(input.database!, results) : undefined,
    publish: input.publish,
  });
}

export async function runReplayResultJob(input: ReplayJobData, dependencies: {
  database: PrismaClient;
  providerFactory: ResultSyncJobInput["providerFactory"];
  providerFactories?: LiveProviderFactories;
  providerRoutingRepository?: any;
  providerPolicyRepository: ReplayProviderPolicyRepository;
  circuitRegistry: CircuitProbeRegistry;
  settlementQueue?: { enqueue(data: SettlementJobData): Promise<unknown> };
}, context: ReplayExecutionContext): Promise<void> {
  const policy = await readReplayWorkerProviderPolicy({
    database: dependencies.database,
    providerPolicyRepository: dependencies.providerPolicyRepository,
    replayPlanId: input.replayPlanId,
    provider: input.input.provider,
    endpointFamily: "RESULTS",
  });
  const snapshot = policy.snapshot;
  const refs = await dependencies.database.$queryRawUnsafe<Array<{ leagueId: string; seasonId: string }>>(`SELECT l."leagueId",s."seasonId" FROM "LeagueExternalRef" l JOIN "SeasonExternalRef" s ON s.provider=l.provider AND s."leagueId"=l."leagueId" JOIN "Season" season ON season.id=s."seasonId" AND season."leagueId"=s."leagueId" WHERE l.provider=$1 AND l."externalId"=$2 AND s."externalId"=$3 LIMIT 2`, input.input.provider, input.input.competitionId, input.input.seasonId);
  if (refs.length !== 1) throw Object.assign(new Error(refs.length ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED"), { code: refs.length ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED" });
  const mapped = await resolveEndpointCandidateMappings({ competition: input.input.competitionId, season: input.input.seasonId, endpoint: "RESULTS", leagueId: refs[0]!.leagueId, seasonId: refs[0]!.seasonId, resolveMapping: (leagueId, seasonId, provider) => resolveCandidateExternalMapping(dependencies.database, leagueId, seasonId, provider) });
  const published: Array<{ fixtureId: string; resultVersionId: string }> = [];
  if (dependencies.providerFactories && dependencies.providerRoutingRepository) {
    const window = { competitionCode: input.input.competitionId as RequestedDateWindow["competitionCode"], dateFrom: input.unit.from.slice(0, 10), dateTo: input.unit.to.slice(0, 10) };
    const routed = await executeDurableMappedRoute<readonly NormalizedResult[]>({ database: dependencies.database, repository: dependencies.providerRoutingRepository, context, route: mapped.route, candidates: createMappedProviderCandidates(mapped.route, mapped.mappings, dependencies.providerFactories), leagueId: refs[0]!.leagueId, seasonId: refs[0]!.seasonId, correlationId: `${input.logicalId}:${input.revision}:RESULTS`, attemptKey: `${input.logicalId}:${input.revision}:RESULTS`, allowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, lane: snapshot.lane!, call: (dispatch) => callMappedResultProvider(dispatch, window) as Promise<readonly NormalizedResult[]> });
    if (routed.status === "limited") throw Object.assign(new Error(routed.reason), { code: routed.reason });
    await context.publish(async (transaction) => { published.push(...await persistResultsInTransaction(transaction as unknown as PrismaClient, routed.value)); }, completionManifest(input));
    await enqueueSettlements(dependencies, input, published); return;
  }
  const result = await runResultSyncJob({
    provider: input.input.provider,
    endpoint: "RESULTS",
    capability: "SUPPORTED",
    circuit: snapshot.circuit.state!,
    circuitRegistry: dependencies.circuitRegistry,
    lane: snapshot.lane!,
    allowance: snapshot.configuredAllowance!,
    criticalHeadroom: snapshot.criticalHeadroom!,
    resetTimezone: snapshot.resetTimezone,
    resetDate: snapshot.resetDate!,
    jobKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:request:1`,
    providerFactory: dependencies.providerFactory,
    database: dependencies.database,
    window: { competitionCode: input.input.competitionId as RequestedDateWindow["competitionCode"], dateFrom: input.unit.from.slice(0, 10), dateTo: input.unit.to.slice(0, 10) },
    reserve: () => context.admitRequest((transaction) => reservePriorityRequest({ database: transaction as unknown as PrismaClient, provider: input.input.provider, resetDate: snapshot.resetDate!, resetTimezone: snapshot.resetTimezone, endpointFamily: "RESULTS", lane: snapshot.lane!, configuredAllowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, jobKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:request:1` })),
    beforeDispatch: context.assertOwner,
    publish: (results) => context.publish(async (transaction) => { published.push(...await persistResultsInTransaction(transaction as unknown as PrismaClient, results)); }, completionManifest(input)),
  });
  if (result.status !== "completed") {
    const code = result.status === "denied" ? result.reason : result.status.toUpperCase();
    throw Object.assign(new Error(code), { code });
  }
  await enqueueSettlements(dependencies, input, published);
}

async function enqueueSettlements(dependencies: Parameters<typeof runReplayResultJob>[1], input: ReplayJobData, published: Array<{ fixtureId: string; resultVersionId: string }>): Promise<void> {
  if (dependencies.settlementQueue) {
    for (const item of published) {
      const forecasts = await dependencies.database.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ForecastSnapshot" WHERE "fixtureId"=$1 AND state='ISSUED' AND kind IN ('PRE_MATCH','LINEUP_CONFIRMED') ORDER BY id`, item.fixtureId);
      for (const forecast of forecasts) await dependencies.settlementQueue.enqueue({ fixtureId: item.fixtureId, resultVersionId: item.resultVersionId, forecastSnapshotId: forecast.id, policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId: `${input.logicalId}:${input.revision}` });
    }
  }
}

function completionManifest(input: ReplayJobData) { return { expectedUnits: [input.logicalId], completedUnits: [input.logicalId], expectedCaptures: [input.logicalId], completedCaptures: [input.logicalId], delivery: "DELIVERED" }; }
