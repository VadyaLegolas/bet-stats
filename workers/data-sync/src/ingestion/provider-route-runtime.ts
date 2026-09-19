import { createHash, randomUUID } from "node:crypto";
import { PROVIDER_ROUTE_POLICY_VERSION, routeReceiptContentHash } from "@bet-stats/domain";
import type { PrismaClient } from "@bet-stats/database";
import type { RouteExecutionCandidate } from "./runner.js";
import { createProviderRoute, type ApiFootballFixtureRequest, type ProviderRoute, type RequestedDateWindow, type RoutedEndpoint, type StandingsRequestCoverage } from "@bet-stats/football-data";

type Terminal = { state: "FAILED" | "SUCCEEDED" | "NO_FALLBACK"; observationId: string | null; provider: string };
type Admission = { admitted: boolean; reused: boolean; reason?: string | null; terminal: Terminal | null };

export type DurableRouteExecutionResult<T> =
  | { status: "completed"; provider: string; value: T; observationId: string }
  | { status: "replayed"; provider: string; value: T; observationId: string }
  | { status: "limited"; reason: "NO_FALLBACK"; lastValidAt: string | null; lastValidValue: T | null };

export async function resolveEndpointCandidateMappings<T>(input: {
  competition: string;
  season: string;
  endpoint: RoutedEndpoint;
  leagueId: string;
  seasonId: string;
  resolveMapping: (leagueId: string, seasonId: string, provider: string) => Promise<T>;
}): Promise<{ route: ProviderRoute; mappings: readonly T[] }> {
  const route = createProviderRoute({ competition: input.competition, season: input.season, endpoint: input.endpoint });
  const mappings: T[] = [];
  for (const provider of route.candidates) mappings.push(await input.resolveMapping(input.leagueId, input.seasonId, provider));
  return { route, mappings };
}

export type RuntimeExternalMapping = { provider: string; leagueExternalId: string; seasonExternalId: string; apiFootballLeagueId: number | null; apiFootballSeason: number | null };
export type LiveProviderFactories = Readonly<Record<"football-data.org" | "api-football", () => unknown>>;

export function createMappedProviderCandidates(route: ProviderRoute, mappings: readonly RuntimeExternalMapping[], factories: LiveProviderFactories) {
  return route.candidates.map((provider) => {
    const mapping = mappings.find((candidate) => candidate.provider === provider);
    if (!mapping) throw Object.assign(new Error("PROVIDER_MAPPING_MISSING"), { code: "PROVIDER_MAPPING_MISSING" });
    return { provider, mapping, factory: () => ({ provider, mapping, client: factories[provider]() }) };
  });
}

export async function callMappedFixtureProvider(dispatch: { provider: string; mapping: RuntimeExternalMapping; client: unknown }, window: RequestedDateWindow) {
  if (dispatch.provider === "football-data.org") return (dispatch.client as { fetchCompetitionFixtures(value: RequestedDateWindow): Promise<unknown> }).fetchCompetitionFixtures(window);
  return (dispatch.client as { fetchFixtures(value: ApiFootballFixtureRequest): Promise<unknown> }).fetchFixtures(apiFixtureRequest(dispatch.mapping, window));
}

export async function callMappedResultProvider(dispatch: { provider: string; mapping: RuntimeExternalMapping; client: unknown }, window: RequestedDateWindow) {
  if (dispatch.provider === "football-data.org") return (dispatch.client as { fetchCompetitionResults(value: RequestedDateWindow): Promise<unknown> }).fetchCompetitionResults(window);
  return (dispatch.client as { fetchResults(value: ApiFootballFixtureRequest): Promise<unknown> }).fetchResults(apiFixtureRequest(dispatch.mapping, window));
}

export async function callMappedStandingsProvider(dispatch: { provider: string; mapping: RuntimeExternalMapping; client: unknown }, coverage: StandingsRequestCoverage) {
  if (dispatch.provider === "football-data.org") return (dispatch.client as { fetchCompetitionStandings(value: StandingsRequestCoverage): Promise<unknown> }).fetchCompetitionStandings(coverage);
  return (dispatch.client as { fetchStandings(value: { leagueId: number; season: number; competitionCode: StandingsRequestCoverage["competitionCode"] }): Promise<unknown> }).fetchStandings({ leagueId: dispatch.mapping.apiFootballLeagueId!, season: dispatch.mapping.apiFootballSeason!, competitionCode: coverage.competitionCode });
}

function apiFixtureRequest(mapping: RuntimeExternalMapping, window: RequestedDateWindow): ApiFootballFixtureRequest {
  if (mapping.apiFootballLeagueId === null || mapping.apiFootballSeason === null) throw Object.assign(new Error("PROVIDER_MAPPING_INVALID_NUMERIC_ID"), { code: "PROVIDER_MAPPING_INVALID_NUMERIC_ID" });
  return { leagueId: mapping.apiFootballLeagueId, season: mapping.apiFootballSeason, competitionCode: window.competitionCode, dateFrom: window.dateFrom, dateTo: window.dateTo };
}

export async function executeDurableMappedRoute<T>(input: {
  database: PrismaClient;
  repository: any;
  context: { assertOwner(): Promise<void> };
  route: ProviderRoute;
  candidates: ReturnType<typeof createMappedProviderCandidates>;
  leagueId: string;
  seasonId: string;
  correlationId: string;
  attemptKey: string;
  allowance: number;
  criticalHeadroom: number;
  lane: "critical" | "standard" | "optional";
  call(dispatch: ReturnType<typeof createMappedProviderCandidates>[number]["factory"] extends () => infer D ? D : never): Promise<T>;
}): Promise<DurableRouteExecutionResult<T>> {
  const routeId = `${input.route.version}:${input.leagueId}:${input.seasonId}:${input.route.endpoint}:${input.correlationId}`;
  const content = { policyVersion: PROVIDER_ROUTE_POLICY_VERSION, policyHash: `sha256:${createHash("sha256").update(input.route.version).digest("hex")}`, competitionId: input.leagueId, seasonId: input.seasonId, endpointFamily: input.route.endpoint, candidates: [...input.route.candidates], selectedProvider: input.route.candidates[0]!, trigger: "PRIMARY" as const, outcome: "ADMITTED" as const, capabilitySnapshot: { status: "SUPPORTED" }, budgetSnapshot: { configuredAllowance: input.allowance }, circuitSnapshot: { state: "CLOSED" }, correlationId: input.correlationId };
  const receipt = { id: routeId, contentHash: routeReceiptContentHash(content), ...content };
  return executeProviderRoute({
    routeId, attemptKey: input.attemptKey, candidates: input.candidates,
    appendRoute: () => input.repository.appendRoute(receipt),
    admitAttempt: async ({ attemptId, attemptKey, provider }) => {
      await input.context.assertOwner();
      const admission = await input.repository.admitAttempt({ route: receipt, attempt: { id: attemptId, attemptKey }, provider, lane: input.lane, configuredAllowance: input.allowance, criticalHeadroom: input.criticalHeadroom, requestDate: new Date(), throttle: { windowStart: new Date(Date.now() - 1), windowEnd: new Date(Date.now() + 60_000), limit: Math.max(1, input.allowance) } });
      const stored = admission.reused ? await input.repository.readRoute(routeId) : null;
      const terminal = stored?.attempts?.find((attempt: any) => attempt.attemptKey === attemptKey && ["FAILED", "SUCCEEDED", "NO_FALLBACK"].includes(attempt.state));
      return { ...admission, terminal: terminal ? { state: terminal.state, observationId: terminal.observationId, provider: terminal.provider } : null };
    },
    completeAttempt: ({ attemptKey, state, reason, observationId }) => input.repository.completeAttempt({ attemptKey, state, reason, observationId }),
    call: input.call,
    classifyFailure: (error) => { const failure = (error && typeof error === "object" && "classification" in error && (error as any).classification === "fallback") ? { eligible: true, trigger: String((error as any).code ?? "PROVIDER_FAILURE") } : { eligible: false, trigger: String((error as any)?.code ?? "PROVIDER_FAILURE") }; return failure; },
    persistObservation: async ({ provider, value }) => {
      const raw = JSON.stringify(value), payloadHash = createHash("sha256").update(raw).digest("hex"), observedAt = new Date(); let id: string = randomUUID();
      const rows = await input.database.$queryRawUnsafe<Array<{ id: string }>>(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (provider,"endpointFamily","payloadHash") DO NOTHING RETURNING id`, id, provider, input.route.endpoint, input.correlationId, observedAt, payloadHash, raw, Buffer.byteLength(raw));
      if (!rows[0]) { const existing = await input.database.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "SourceObservation" WHERE provider=$1 AND "endpointFamily"=$2 AND "payloadHash"=$3`, provider, input.route.endpoint, payloadHash); id = existing[0]!.id; }
      return { id, observedAt: observedAt.toISOString() };
    },
    loadObservation: async (observationId) => {
      const observation = await input.database.sourceObservation.findUnique({ where: { id: observationId }, select: { provider: true, endpointFamily: true, rawPayload: true } });
      if (!observation || observation.endpointFamily !== input.route.endpoint) throw new Error("REPLAY_OBSERVATION_NOT_FOUND");
      return observation.rawPayload as T;
    },
    findLastValid: async () => null,
  });
}

export async function executeProviderRoute<TProvider, TValue>(input: {
  routeId: string;
  attemptKey: string;
  candidates: readonly RouteExecutionCandidate<TProvider>[];
  appendRoute: () => Promise<unknown>;
  admitAttempt: (attempt: { routeId: string; attemptKey: string; attemptId: string; provider: string; ordinal: number }) => Promise<Admission>;
  completeAttempt: (attempt: { attemptKey: string; provider: string; state: Terminal["state"]; reason: string | null; observationId: string | null }) => Promise<unknown>;
  call: (provider: TProvider) => Promise<TValue>;
  classifyFailure: (error: unknown) => { eligible: boolean; trigger?: string };
  persistObservation: (observation: { provider: string; value: TValue; attemptKey: string }) => Promise<{ id: string; observedAt: string }>;
  loadObservation?: (observationId: string) => Promise<TValue>;
  findLastValid: () => Promise<{ at: string; value: TValue } | null>;
}): Promise<DurableRouteExecutionResult<TValue>> {
  if (input.candidates.length === 0 || input.candidates.length > 2) throw new Error("INVALID_PROVIDER_CANDIDATE_LIST");
  await input.appendRoute();
  for (let ordinal = 0; ordinal < input.candidates.length; ordinal += 1) {
    const candidate = input.candidates[ordinal]!;
    const attemptKey = `${input.attemptKey}:${ordinal}`;
    const admission = await input.admitAttempt({ routeId: input.routeId, attemptKey, attemptId: `${input.routeId}:attempt:${ordinal}`, provider: candidate.provider, ordinal });
    if (admission.reused && admission.terminal) {
      if (admission.terminal.state === "SUCCEEDED" && admission.terminal.observationId) {
        if (!input.loadObservation) throw new Error("REPLAY_OBSERVATION_LOADER_REQUIRED");
        return { status: "replayed", provider: admission.terminal.provider, observationId: admission.terminal.observationId, value: await input.loadObservation(admission.terminal.observationId) };
      }
      if (admission.terminal.state === "NO_FALLBACK") break;
      continue;
    }
    if (!admission.admitted) continue;
    try {
      const value = await input.call(candidate.factory());
      const observation = await input.persistObservation({ provider: candidate.provider, value, attemptKey });
      await input.completeAttempt({ attemptKey, provider: candidate.provider, state: "SUCCEEDED", reason: null, observationId: observation.id });
      return { status: "completed", provider: candidate.provider, value, observationId: observation.id };
    } catch (error) {
      const failure = input.classifyFailure(error);
      const mayFallback = failure.eligible && ordinal + 1 < input.candidates.length;
      await input.completeAttempt({ attemptKey, provider: candidate.provider, state: mayFallback ? "FAILED" : "NO_FALLBACK", reason: failure.trigger ?? "PROVIDER_FAILURE", observationId: null });
      if (!failure.eligible) throw error;
      if (!mayFallback) break;
    }
  }
  const lastValid = await input.findLastValid();
  return { status: "limited", reason: "NO_FALLBACK", lastValidAt: lastValid?.at ?? null, lastValidValue: lastValid?.value ?? null };
}
