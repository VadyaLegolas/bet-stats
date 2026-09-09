import {
  evidenceComponentUnit,
  isEvidenceComponentKind,
  isEvidenceSourceRef,
  parseEvidenceProjection,
  parseEvidenceReceipt,
  parseForecastResponse,
  type EvidenceProjectionDto,
  type EvidenceSourceRef,
  type ForecastFixture,
  type ForecastOrchestratorRepository,
  type ForecastRequestDto,
  type ForecastResponseDto,
} from "@bet-stats/domain";

import type { PrismaClient } from "./client.js";

export interface ForecastPublicationRepository extends ForecastOrchestratorRepository {
  assertEligible(): Promise<void>;
  findFixture(fixtureId: string): Promise<ForecastFixture | null>;
  findEvidence(teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null>;
  findOfficialLineup(fixtureId: string, cutoff: string): Promise<{ id: string } | null>;
  publish(draft: ForecastResponseDto): Promise<ForecastResponseDto>;
  findIssued?(fixtureId: string, kind: ForecastRequestDto["kind"], cutoff: string): Promise<ForecastResponseDto | null>;
  listIssued?(fixtureId: string): Promise<readonly ForecastResponseDto[]>;
}

type StoredForecast = Record<string, unknown>;
type Component = { component: string; value: unknown; sampleSize: number; limitation: string | null; sourceTimes: unknown };

async function resolveEvidence(client: PrismaClient, teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null> {
  const build = await client.evidenceBuild.findFirst({ where: { teamId, cutoff: { lte: new Date(cutoff) }, state: "PUBLISHED" }, include: { components: true }, orderBy: [{ cutoff: "desc" }, { publishedAt: "desc" }] });
  if (!build) return null;
  const components = build.components as Component[];
  const receipt = parseEvidenceReceipt(components.find((component) => component.component === "receipt")?.value);
  const projected: Record<string, unknown> = {};
  for (const component of components) {
    if (!isEvidenceComponentKind(component.component)) continue;
    const refs = Array.isArray(component.sourceTimes) ? component.sourceTimes.filter(isEvidenceSourceRef) as EvidenceSourceRef[] : [];
    const verified = receipt && refs.every((ref) => receipt.inputs.some((input) => isEvidenceSourceRef(input) && input.fixtureId === ref.fixtureId && input.effectiveAt === ref.effectiveAt && input.observedAt === ref.observedAt && input.payloadHash === ref.payloadHash && input.payloadBytes === ref.payloadBytes));
    projected[component.component] = { kind: component.component, value: verified ? component.value : null, unit: evidenceComponentUnit(component.component), sampleSize: component.sampleSize, limitation: verified ? component.limitation : "MISSING_TIMESTAMP", sourceRefs: verified ? refs : [] };
  }
  const utc = new Date(cutoff).toISOString();
  return parseEvidenceProjection({ teamId, requestedAsOf: cutoff, resolvedAsOfUtc: utc, cutoffBoundary: { observedAt: utc }, state: receipt ? "COMPLETE" : "LIMITED", freshness: "FRESH", buildId: build.id, publishedAt: build.publishedAt?.toISOString() ?? null, receipt, coverage: receipt?.sourceWindow ?? null, components: projected });
}

export function createPrismaForecastRepository(client: PrismaClient): ForecastPublicationRepository {
  const toDto = (row: StoredForecast): ForecastResponseDto => parseForecastResponse(row.receipt);
  return {
    assertEligible: async () => undefined,
    findFixture: async (id) => {
      const row = await client.fixture.findUnique({ where: { id }, select: { id: true, homeTeamId: true, awayTeamId: true, kickoffUtc: true } });
      return row ? { ...row, canonicalIdentityResolved: Boolean(row.homeTeamId && row.awayTeamId) } : null;
    },
    findEvidence: (teamId, cutoff) => resolveEvidence(client, teamId, cutoff),
    findOfficialLineup: async (fixtureId, cutoff) => client.lineupObservation.findFirst({ where: { fixtureId, status: "OFFICIAL_CONFIRMED", confirmedAt: { lte: new Date(cutoff) } }, orderBy: { confirmedAt: "desc" }, select: { id: true } }),
    findIssued: async (fixtureId, kind, cutoff) => {
      const row = await client.forecastSnapshot.findFirst({ where: { fixtureId, kind, cutoff: new Date(cutoff), state: "ISSUED" }, orderBy: { revision: "desc" } });
      return row ? toDto(row as unknown as StoredForecast) : null;
    },
    listIssued: async (fixtureId) => (await client.forecastSnapshot.findMany({ where: { fixtureId, state: "ISSUED" }, orderBy: [{ issuedAt: "desc" }, { cutoff: "desc" }, { revision: "desc" }, { id: "asc" }] })).map((row) => toDto(row as unknown as StoredForecast)),
    publish: async (draft) => {
      const identity = { fixtureId: draft.fixtureId, kind: draft.kind, cutoff: new Date(draft.cutoff), modelHash: draft.modelHash, configHash: draft.configHash, inputHash: draft.inputHash, evidenceFingerprint: draft.evidenceFingerprint, state: "ISSUED" as const };
      const existing = await client.forecastSnapshot.findFirst({ where: identity });
      if (existing) return toDto(existing as unknown as StoredForecast);
      try {
        return await client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${draft.fixtureId}:${draft.kind}`}, 0))`;
          const converged = await tx.forecastSnapshot.findFirst({ where: identity });
          if (converged) return toDto(converged as unknown as StoredForecast);
          const latest = await tx.forecastSnapshot.findFirst({ where: { fixtureId: draft.fixtureId, kind: draft.kind }, orderBy: { revision: "desc" } });
          const revision = (latest?.revision ?? 0) + 1;
          const response = { ...draft, revision };
          await tx.forecastSnapshot.create({ data: {
            id: response.id, fixtureId: response.fixtureId, kind: response.kind, state: "ISSUED", revision, supersedesForecastId: latest?.id ?? null,
            officialLineupObservationId: response.officialLineupObservationId, cutoff: new Date(response.cutoff), modelVersion: response.modelVersion,
            modelHash: response.modelHash, configVersion: response.configVersion, configHash: response.configHash, inputHash: response.inputHash,
            evidenceFingerprint: response.evidenceFingerprint, sourceRefs: response.receipt.sourceRefs as never, probabilities: response.probabilities as never,
            confidence: response.confidence as never, assumptions: response.assumptions as never, receipt: response as never, issuedAt: new Date(response.issuedAt),
            markets: { create: Object.entries(response.probabilities).map(([market, probabilities]) => ({ market, probabilities: probabilities as never })) },
          } });
          return parseForecastResponse(response);
        });
      } catch (error) {
        const collision = await client.forecastSnapshot.findFirst({ where: identity });
        if (collision) return toDto(collision as unknown as StoredForecast);
        throw error;
      }
    },
  };
}
