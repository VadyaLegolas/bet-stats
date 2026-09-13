import { createHash, randomUUID } from "node:crypto";

import { resolveProviderFixture, type PrismaClient, type ReplayProviderPolicyRepository } from "@bet-stats/database";
import { evaluateCapability, reservePriorityRequest, type CapabilityDecision } from "@bet-stats/domain";
import { classifyProviderFailure, createProviderRoute, isConfiguredCompetitionCode, providerRouteJobId, type FixtureProvider, type NormalizedFixture, type RequestedDateWindow } from "@bet-stats/football-data";

import { runGatedIngestion, type CircuitProbeRegistry, type IngestionLane } from "../ingestion/runner.js";
import { createEnrichmentSchedule, type EnrichmentJobData, type ReplayJobData } from "../queues/index.js";
import type { ReplayExecutionContext } from "../queues/replay-execution.js";
import { readReplayWorkerProviderPolicy } from "../resilience/provider-policy.js";
import { callMappedFixtureProvider, createMappedProviderCandidates, executeDurableMappedRoute, resolveEndpointCandidateMappings, type LiveProviderFactories } from "../ingestion/provider-route-runtime.js";

const PROVIDER = "football-data.org";
const ENDPOINT = "FIXTURES";

export type CandidateExternalMapping = {
  provider: string;
  leagueExternalId: string;
  seasonExternalId: string;
  apiFootballLeagueId: number | null;
  apiFootballSeason: number | null;
};

export async function resolveCandidateExternalMapping(
  database: Pick<PrismaClient, "$queryRawUnsafe">,
  leagueId: string,
  seasonId: string,
  provider: string,
): Promise<CandidateExternalMapping> {
  const rows = await database.$queryRawUnsafe<Array<{ leagueExternalId: string; seasonExternalId: string }>>(
    `SELECT l."externalId" AS "leagueExternalId", s."externalId" AS "seasonExternalId"
     FROM "LeagueExternalRef" l
     JOIN "SeasonExternalRef" s ON s.provider = l.provider AND s."leagueId" = l."leagueId"
     JOIN "Season" season ON season.id = s."seasonId" AND season."leagueId" = s."leagueId"
     WHERE l."leagueId" = $1 AND s."seasonId" = $2 AND l.provider = $3 AND s.provider = $3`,
    leagueId,
    seasonId,
    provider,
  );
  if (rows.length !== 1) throw mappingError(rows.length === 0 ? "PROVIDER_MAPPING_MISSING" : "PROVIDER_MAPPING_AMBIGUOUS");
  const row = rows[0]!;
  if (provider !== "api-football") return { provider, ...row, apiFootballLeagueId: null, apiFootballSeason: null };
  if (!positiveIntegerString(row.leagueExternalId) || !positiveIntegerString(row.seasonExternalId)) throw mappingError("PROVIDER_MAPPING_INVALID_NUMERIC_ID");
  return { provider, ...row, apiFootballLeagueId: Number(row.leagueExternalId), apiFootballSeason: Number(row.seasonExternalId) };
}

function positiveIntegerString(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function mappingError(code: string): Error { return Object.assign(new Error(code), { code }); }

export function createFixtureJobRoute(scope: { competition: string; season: string }) {
  const route = createProviderRoute({ ...scope, endpoint: "FIXTURES" });
  return { jobId: providerRouteJobId(route), route };
}

export interface FixtureSyncJobInput {
  database: PrismaClient;
  leagueId: string;
  seasonId: string;
  jobKey: string;
  allowance: number;
  providerFactory: () => FixtureProvider;
  provider?: string;
  circuit?: "CLOSED" | "OPEN" | "HALF_OPEN";
  circuitRegistry?: CircuitProbeRegistry;
  lane?: IngestionLane;
  criticalHeadroom?: number;
  resetTimezone?: string | null;
  resetDate?: string;
  scope?: {
    competitionExternalId: string;
    requestCompetitionCode?: string;
    seasonExternalId: string;
    from: string;
    to: string;
  };
  now?: Date;
  reserve?: () => ReturnType<typeof reservePriorityRequest>;
  beforeDispatch?: () => Promise<void>;
  publish?: (fixtures: readonly NormalizedFixture[]) => Promise<void>;
}

export type FixtureSyncJobResult =
  | { status: "denied"; reason: Exclude<CapabilityDecision, { allowed: true }>["reason"] | "CAPABILITY_DENIED" | "CIRCUIT_OPEN" | "ALLOWANCE_EXHAUSTED" | "UNKNOWN_RESET_SEMANTICS" | "CRITICAL_HEADROOM" }
  | { status: "completed"; fixturesProcessed: number; reservationReused: boolean };

export async function runFixtureSyncJob(input: FixtureSyncJobInput): Promise<FixtureSyncJobResult> {
  const now = input.now ?? new Date();
  const providerName = input.provider ?? PROVIDER;
  const key = { provider: providerName, leagueId: input.leagueId, seasonId: input.seasonId, endpoint: ENDPOINT };
  const stored = await input.database.providerCapability.findUnique({
    where: { provider_leagueId_seasonId_endpoint: key },
  });
  const capability = stored
    ? { ...key, supported: stored.supported, verifiedAt: stored.verifiedAt, expiresAt: stored.expiresAt }
    : undefined;
  const decision = evaluateCapability(capability, key, now);
  if (!decision.allowed) return { status: "denied", reason: decision.reason };

  const window = fixtureRequestWindow(input.scope);

  const lane = input.lane ?? "critical";
  const result = await runGatedIngestion({
    provider: providerName,
    endpoint: ENDPOINT,
    capability: "SUPPORTED",
    circuit: input.circuit ?? "CLOSED",
    circuitRegistry: input.circuitRegistry,
    lane,
    allowance: input.allowance,
    resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
    jobKey: input.jobKey,
    reserve: input.reserve ?? (() => reservePriorityRequest({
      database: input.database,
      provider: providerName,
      resetDate: input.resetDate ?? now.toISOString().slice(0, 10),
      resetTimezone: input.resetTimezone === undefined ? "UTC" : input.resetTimezone,
      endpointFamily: ENDPOINT,
      lane,
      configuredAllowance: input.allowance,
      criticalHeadroom: input.criticalHeadroom ?? 0,
      jobKey: input.jobKey,
    })),
    beforeDispatch: input.beforeDispatch,
    providerFactory: input.providerFactory,
    callProvider: async (provider) => {
      const fetched = await provider.fetchCompetitionFixtures(window);
      const mismatch = fetched.find((fixture) => {
        const kickoff = Date.parse(fixture.kickoffUtc);
        return fixture.competitionExternalId !== input.scope!.competitionExternalId
          || fixture.seasonExternalId !== input.scope!.seasonExternalId
          || !Number.isFinite(kickoff)
          || kickoff < Date.parse(input.scope!.from)
          || kickoff > Date.parse(input.scope!.to);
      });
      if (mismatch) throw classifiedFixtureError("FIXTURE_SCOPE_MISMATCH");
      return fetched;
    },
    persist: async (fixtures) => {
      for (const fixture of fixtures) await persistCanonicalFixture(input.database, input.leagueId, input.seasonId, fixture);
    },
    publish: input.publish,
  });
  if (result.status === "completed") return { status: "completed", fixturesProcessed: result.value.length, reservationReused: result.reservationReused };
  if (result.status === "denied") return { status: "denied", reason: result.reason };
  return { status: "completed", fixturesProcessed: result.value?.length ?? 0, reservationReused: false };
}

function fixtureRequestWindow(scope: FixtureSyncJobInput["scope"]): RequestedDateWindow {
  const competitionCode = scope?.requestCompetitionCode ?? scope?.competitionExternalId;
  if (!scope || !competitionCode || !isConfiguredCompetitionCode(competitionCode)) {
    throw classifiedFixtureError("INVALID_FIXTURE_SCOPE");
  }
  const from = Date.parse(scope.from);
  const to = Date.parse(scope.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw classifiedFixtureError("INVALID_FIXTURE_SCOPE");
  }
  return {
    competitionCode,
    dateFrom: new Date(from).toISOString().slice(0, 10),
    dateTo: new Date(to).toISOString().slice(0, 10),
  };
}

function classifiedFixtureError(code: "INVALID_FIXTURE_SCOPE" | "FIXTURE_SCOPE_MISMATCH"): Error {
  return Object.assign(new Error(code), { code });
}

export async function runReplayFixtureJob(
  input: ReplayJobData,
  dependencies: {
    database: PrismaClient;
    providerFactory: () => FixtureProvider;
    providerFactories?: LiveProviderFactories;
    providerRoutingRepository?: any;
    enrichmentQueue?: { enqueue(data: EnrichmentJobData): Promise<unknown> };
    providerPolicyRepository: ReplayProviderPolicyRepository;
    circuitRegistry: CircuitProbeRegistry;
  },
  context: ReplayExecutionContext,
): Promise<void> {
  const from = Date.parse(input.unit.from);
  const to = Date.parse(input.unit.to);
  const requestedFrom = Date.parse(input.input.from);
  const requestedTo = Date.parse(input.input.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || from < requestedFrom || to > requestedTo) {
    throw Object.assign(new Error("INVALID_REPLAY_WINDOW"), { code: "INVALID_REPLAY_WINDOW" });
  }
  const policy = await readReplayWorkerProviderPolicy({
    database: dependencies.database,
    providerPolicyRepository: dependencies.providerPolicyRepository,
    replayPlanId: input.replayPlanId,
    provider: input.input.provider,
    endpointFamily: "FIXTURES",
  });
  const snapshot = policy.snapshot;
  const refs = await dependencies.database.$queryRawUnsafe<Array<{ leagueId: string; seasonId: string }>>(
    `SELECT l."leagueId", s."seasonId"
     FROM "LeagueExternalRef" l
     JOIN "SeasonExternalRef" s ON s.provider=l.provider AND s."leagueId"=l."leagueId"
     JOIN "Season" season ON season.id=s."seasonId" AND season."leagueId"=s."leagueId"
     WHERE l.provider=$1 AND l."externalId"=$2 AND s."externalId"=$3
     LIMIT 2`,
    input.input.provider,
    input.input.competitionId,
    input.input.seasonId,
  );
  const ref = refs[0];
  if (!ref) throw Object.assign(new Error("IDENTITY_UNRESOLVED"), { code: "IDENTITY_UNRESOLVED" });
  const mapped = await resolveEndpointCandidateMappings({ competition: input.input.competitionId, season: input.input.seasonId, endpoint: "FIXTURES", leagueId: ref.leagueId, seasonId: ref.seasonId, resolveMapping: (leagueId, seasonId, provider) => resolveCandidateExternalMapping(dependencies.database, leagueId, seasonId, provider) });
  if (dependencies.providerFactories && dependencies.providerRoutingRepository) {
    const window = fixtureRequestWindow({ competitionExternalId: input.input.competitionId, seasonExternalId: input.input.seasonId, from: input.unit.from, to: input.unit.to });
    const routed = await executeDurableMappedRoute<readonly NormalizedFixture[]>({ database: dependencies.database, repository: dependencies.providerRoutingRepository, context, route: mapped.route, candidates: createMappedProviderCandidates(mapped.route, mapped.mappings, dependencies.providerFactories), leagueId: ref.leagueId, seasonId: ref.seasonId, correlationId: `${input.logicalId}:${input.revision}:${context.attemptNumber}`, attemptKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:FIXTURES`, allowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, lane: snapshot.lane!, call: (dispatch) => callMappedFixtureProvider(dispatch, window) as Promise<readonly NormalizedFixture[]> });
    if (routed.status !== "completed") throw Object.assign(new Error(routed.status === "limited" ? routed.reason : "ROUTE_REPLAYED"), { code: routed.status === "limited" ? routed.reason : "ROUTE_REPLAYED" });
    const published: Array<{ fixtureId: string; kickoffUtc: string }> = [];
    await context.publish(async (transaction) => { for (const fixture of routed.value) published.push({ fixtureId: await persistCanonicalFixture(transaction as unknown as PrismaClient, ref.leagueId, ref.seasonId, fixture, true), kickoffUtc: fixture.kickoffUtc }); }, completionManifest(input));
    if (dependencies.enrichmentQueue) await schedulePublishedFixtures(published, dependencies.enrichmentQueue.enqueue);
    return;
  }

  const result = await runFixtureSyncJob({
    database: dependencies.database,
    leagueId: ref.leagueId,
    seasonId: ref.seasonId,
    jobKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:request:1`,
    allowance: snapshot.configuredAllowance!,
    providerFactory: dependencies.providerFactory,
    circuit: snapshot.circuit.state!,
    circuitRegistry: dependencies.circuitRegistry,
    lane: snapshot.lane!,
    criticalHeadroom: snapshot.criticalHeadroom!,
    resetTimezone: snapshot.resetTimezone,
    resetDate: snapshot.resetDate!,
    scope: {
      competitionExternalId: input.input.competitionId,
      seasonExternalId: input.input.seasonId,
      from: input.unit.from,
      to: input.unit.to,
    },
    reserve: () => context.admitRequest((transaction) => reservePriorityRequest({ database: transaction as unknown as PrismaClient, provider: input.input.provider, resetDate: snapshot.resetDate!, resetTimezone: snapshot.resetTimezone, endpointFamily: "FIXTURES", lane: snapshot.lane!, configuredAllowance: snapshot.configuredAllowance!, criticalHeadroom: snapshot.criticalHeadroom!, jobKey: `${input.logicalId}:${input.revision}:${context.attemptNumber}:request:1` })),
    beforeDispatch: context.assertOwner,
    publish: (fixtures) => context.publish(async (transaction) => {
      for (const fixture of fixtures) await persistCanonicalFixture(transaction as unknown as PrismaClient, ref.leagueId, ref.seasonId, fixture, true);
    }, completionManifest(input)),
  });
  if (result.status !== "completed") {
    const code = result.reason;
    throw Object.assign(new Error(code), { code });
  }
}

export async function schedulePublishedFixtures(fixtures: readonly { fixtureId: string; kickoffUtc: string }[], enqueue: (data: EnrichmentJobData) => Promise<unknown>): Promise<void> {
  const unique = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  for (const fixture of unique.values()) for (const job of createEnrichmentSchedule({ ...fixture, policyVersion: "enrichment-v1" })) await enqueue(job);
}

async function persistCanonicalFixture(database: PrismaClient, leagueId: string, seasonId: string, fixture: NormalizedFixture, transactionOwned = false): Promise<string> {
  if (transactionOwned) {
    const resolution = await resolveProviderFixture(database, fixture, { transactionOwned: true });
    if (resolution.status === "quarantined") throw Object.assign(new Error("FIXTURE_IDENTITY_QUARANTINED"), { code: "FIXTURE_IDENTITY_QUARANTINED", caseId: resolution.caseId });
    return resolution.fixtureId;
  }
  const write = async (transaction: PrismaClient) => {
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
  };
  if (transactionOwned) return write(database).then(async () => (await database.fixtureExternalRef.findUniqueOrThrow({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.externalId } } })).fixtureId);
  await database.$transaction((transaction) => write(transaction as unknown as PrismaClient));
  return (await database.fixtureExternalRef.findUniqueOrThrow({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.externalId } } })).fixtureId;
}

function completionManifest(input: ReplayJobData) { return { expectedUnits: [input.logicalId], completedUnits: [input.logicalId], expectedCaptures: [input.logicalId], completedCaptures: [input.logicalId], delivery: "DELIVERED" }; }
