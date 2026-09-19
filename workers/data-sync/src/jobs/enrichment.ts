export type EnrichmentEndpoint = "LINEUPS" | "INJURIES" | "ODDS" | "STATISTICS";

type EnrichmentObservation =
  | { state: "observed-empty"; capturedAt: string; payload: null }
  | { state: "observed"; capturedAt: string; payload: unknown };
type Capability = { supported: boolean; expiresAt: string | null };

export type EnrichmentJobResult =
  | { status: "denied"; reason: "UNKNOWN_CAPABILITY" | "UNSUPPORTED_CAPABILITY" | "STALE_CAPABILITY" | "CIRCUIT_OPEN" | "BUDGET_PROTECTED" }
  | { status: "completed"; evidenceState: "OBSERVED_EMPTY"; observationId: null; forecastId: null }
  | { status: "completed"; evidenceState: "OBSERVED"; observationId: string; receiptHash: string; forecastId: string | null };

export async function runEnrichmentJob(input: {
  fixtureId: string;
  endpoint: EnrichmentEndpoint;
  cutoff: string;
  readCapability: () => Promise<Capability | null>;
  readCircuit: () => Promise<"CLOSED" | "OPEN" | "HALF_OPEN">;
  reserve: () => Promise<{ reserved: boolean; reused?: boolean; reason?: string }>;
  providerFactory: () => { fetch: () => Promise<EnrichmentObservation> };
  persist: (observation: Extract<EnrichmentObservation, { state: "observed" }>, classification: { officialLineup: boolean }) => Promise<{ observationId: string; receiptHash: string }>;
  issueLineupForecast?: (input: { fixtureId: string; cutoff: string; officialLineupObservationId: string; receiptHash: string }) => Promise<string>;
  now?: Date;
}): Promise<EnrichmentJobResult> {
  const now = input.now ?? new Date();
  const capability = await input.readCapability();
  if (!capability) return { status: "denied", reason: "UNKNOWN_CAPABILITY" };
  if (!capability.supported) return { status: "denied", reason: "UNSUPPORTED_CAPABILITY" };
  if (capability.expiresAt && new Date(capability.expiresAt) <= now) return { status: "denied", reason: "STALE_CAPABILITY" };
  if (await input.readCircuit() !== "CLOSED") return { status: "denied", reason: "CIRCUIT_OPEN" };
  if (!(await input.reserve()).reserved) return { status: "denied", reason: "BUDGET_PROTECTED" };

  const observation = await input.providerFactory().fetch();
  if (observation.state === "observed-empty") return { status: "completed", evidenceState: "OBSERVED_EMPTY", observationId: null, forecastId: null };
  const officialLineup = input.endpoint === "LINEUPS" && officialSameFixtureBeforeCutoff(observation, input.fixtureId, input.cutoff);
  const stored = await input.persist(observation, { officialLineup });
  let forecastId: string | null = null;
  if (officialLineup && input.issueLineupForecast) {
    forecastId = await input.issueLineupForecast({ fixtureId: input.fixtureId, cutoff: input.cutoff, officialLineupObservationId: stored.observationId, receiptHash: stored.receiptHash });
  }
  return { status: "completed", evidenceState: "OBSERVED", ...stored, forecastId };
}

function officialSameFixtureBeforeCutoff(observation: Extract<EnrichmentObservation, { state: "observed" }>, fixtureId: string, cutoff: string): boolean {
  if (new Date(observation.capturedAt) > new Date(cutoff) || typeof observation.payload !== "object" || observation.payload === null) return false;
  const payload = observation.payload as { fixtureId?: unknown; status?: unknown; players?: unknown };
  return payload.fixtureId === fixtureId && payload.status === "OFFICIAL_CONFIRMED" && Array.isArray(payload.players) && payload.players.length > 0;
}

export function createProductionEnrichmentExecutor(input: { database: PrismaClient; apiFootballFactory: () => ApiFootballClient; issueLineupForecast?: (value: { fixtureId: string; cutoff: string; officialLineupObservationId: string; receiptHash: string }) => Promise<string> }) {
  return async (job: { fixtureId: string; endpoint: EnrichmentEndpoint; cutoff: string; policyVersion: string }) => {
    const fixtureRows = await input.database.$queryRawUnsafe<Array<{ leagueId: string; seasonId: string; externalId: string }>>(`SELECT f."leagueId",f."seasonId",r."externalId" FROM "Fixture" f JOIN "FixtureExternalRef" r ON r."fixtureId"=f.id AND r.provider='api-football' WHERE f.id=$1`, job.fixtureId);
    const fixture = fixtureRows[0]; if (!fixture || !/^[1-9]\d*$/.test(fixture.externalId)) return { status: "denied", reason: "UNKNOWN_CAPABILITY" } as const;
    return runEnrichmentJob({ fixtureId: job.fixtureId, endpoint: job.endpoint, cutoff: job.cutoff,
      readCapability: async () => { const row = await input.database.providerCapability.findUnique({ where: { provider_leagueId_seasonId_endpoint: { provider: "api-football", leagueId: fixture.leagueId, seasonId: fixture.seasonId, endpoint: job.endpoint } } }); return row ? { supported: row.supported, expiresAt: row.expiresAt?.toISOString() ?? null } : null; },
      readCircuit: async () => (await input.database.providerCircuitState.findUnique({ where: { provider_endpointFamily: { provider: "api-football", endpointFamily: job.endpoint } } }))?.state ?? "OPEN",
      reserve: async () => { const value = await reservePriorityRequest({ database: input.database, provider: "api-football", resetDate: new Date().toISOString().slice(0,10), resetTimezone: "UTC", endpointFamily: job.endpoint, lane: "optional", configuredAllowance: 100, criticalHeadroom: 20, jobKey: `${job.policyVersion}:${job.fixtureId}:${job.endpoint}:${job.cutoff}` }); return value.reserved ? { reserved: true, reused: value.reused } : { reserved: false, reason: value.reason }; },
      providerFactory: () => ({ fetch: async () => input.apiFootballFactory().fetchEnrichment(API_FOOTBALL_ENRICHMENT_ENDPOINT[job.endpoint], Number(fixture.externalId), job.fixtureId) }),
      persist: async (observation, classification) => input.database.$transaction(async (tx) => { const raw = JSON.stringify(observation.payload), payloadHash = createHash("sha256").update(raw).digest("hex"), observationId = randomUUID(); await tx.sourceObservation.upsert({ where: { provider_endpointFamily_payloadHash: { provider: "api-football", endpointFamily: job.endpoint, payloadHash } }, create: { id: observationId, provider: "api-football", endpointFamily: job.endpoint, externalIdentity: job.fixtureId, observedAt: new Date(observation.capturedAt), payloadHash, rawPayload: JSON.parse(raw), payloadBytes: Buffer.byteLength(raw) }, update: {} }); const stored = await tx.sourceObservation.findUniqueOrThrow({ where: { provider_endpointFamily_payloadHash: { provider: "api-football", endpointFamily: job.endpoint, payloadHash } } }); if (classification.officialLineup && !(await tx.lineupObservation.findFirst({ where: { fixtureId: job.fixtureId, observationId: stored.id } }))) await tx.lineupObservation.create({ data: { fixtureId: job.fixtureId, observationId: stored.id, status: "OFFICIAL_CONFIRMED", confirmedAt: new Date(observation.capturedAt) } }); return { observationId: stored.id, receiptHash: `sha256:${payloadHash}` }; }),
      ...(input.issueLineupForecast ? { issueLineupForecast: input.issueLineupForecast } : {}),
    });
  };
}
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@bet-stats/database";
import { reservePriorityRequest } from "@bet-stats/domain";
import type { ApiFootballClient, ApiFootballEnrichmentEndpoint } from "@bet-stats/football-data";

const API_FOOTBALL_ENRICHMENT_ENDPOINT = {
  LINEUPS: "lineups",
  INJURIES: "injuries",
  ODDS: "odds",
  STATISTICS: "fixtures/statistics",
} satisfies Record<EnrichmentEndpoint, ApiFootballEnrichmentEndpoint>;
