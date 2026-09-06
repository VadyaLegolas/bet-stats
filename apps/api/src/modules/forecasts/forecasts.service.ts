import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  createForecast,
  parseForecastRequest,
  parseForecastResponse,
  type EvidenceProjectionDto,
  type ForecastRequestDto,
  type ForecastResponseDto,
} from "@bet-stats/domain";

export interface ForecastFixture {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly kickoffUtc: Date | string;
  readonly canonicalIdentityResolved: boolean;
}

export interface ForecastPublicationRepository {
  assertEligible(): Promise<void>;
  findFixture(fixtureId: string): Promise<ForecastFixture | null>;
  findEvidence(teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null>;
  findOfficialLineup(fixtureId: string, cutoff: string): Promise<{ id: string } | null>;
  publish(draft: ForecastResponseDto & { readonly officialLineupObservationId: string | null }): Promise<ForecastResponseDto>;
  findIssued?(fixtureId: string, kind: ForecastRequestDto["kind"], cutoff: string): Promise<ForecastResponseDto | null>;
}

function sha(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function failure(code: string): Error & { code: string } {
  const exception = ["POST_KICKOFF_CUTOFF", "LINEUP_NOT_CONFIRMED", "REQUIRED_EVIDENCE_UNAVAILABLE", "UNRESOLVED_CANONICAL_IDENTITY"].includes(code)
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

function verifyEvidence(projection: EvidenceProjectionDto | null, cutoff: string): asserts projection is EvidenceProjectionDto {
  if (!projection?.buildId || !projection.receipt) throw failure("REQUIRED_EVIDENCE_UNAVAILABLE");
  if (projection.resolvedAsOfUtc !== cutoff || projection.cutoffBoundary.observedAt !== cutoff) throw failure("EVIDENCE_CUTOFF_MISMATCH");
  const boundary = Date.parse(cutoff);
  for (const source of projection.receipt.inputs) {
    if (Date.parse(source.effectiveAt) > boundary || Date.parse(source.observedAt) > boundary || (source.sourceUpdatedAt !== null && Date.parse(source.sourceUpdatedAt) > boundary)) throw failure("POST_CUTOFF_SOURCE_INPUT");
  }
}

export async function generateForecast(raw: unknown, repository: ForecastPublicationRepository): Promise<ForecastResponseDto> {
  const request = parseForecastRequest(raw);
  await repository.assertEligible();
  const fixture = await repository.findFixture(request.fixtureId);
  if (!fixture) throw failure("FIXTURE_NOT_FOUND");
  if (!fixture.canonicalIdentityResolved) throw failure("UNRESOLVED_CANONICAL_IDENTITY");
  if (Date.parse(request.cutoff) >= new Date(fixture.kickoffUtc).getTime()) throw failure("POST_KICKOFF_CUTOFF");
  const [home, away] = await Promise.all([
    repository.findEvidence(fixture.homeTeamId, request.cutoff),
    repository.findEvidence(fixture.awayTeamId, request.cutoff),
  ]);
  verifyEvidence(home, request.cutoff);
  verifyEvidence(away, request.cutoff);
  const lineup = request.kind === "LINEUP_CONFIRMED" ? await repository.findOfficialLineup(fixture.id, request.cutoff) : null;
  if (request.kind === "LINEUP_CONFIRMED" && !lineup) throw failure("LINEUP_NOT_CONFIRMED");
  const homeBuildId = home.buildId;
  const awayBuildId = away.buildId;
  if (!homeBuildId || !awayBuildId) throw failure("REQUIRED_EVIDENCE_UNAVAILABLE");
  const evidenceBuildIds = [homeBuildId, awayBuildId].sort();
  const preliminary = createForecast({ fixtureId: fixture.id, forecastSnapshotId: "pending", cutoff: request.cutoff, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1 });
  const snapshotId = sha({ fixtureId: fixture.id, kind: request.kind, cutoff: request.cutoff, modelVersion: preliminary.modelVersion, configHash: preliminary.configHash, evidenceBuildIds }).slice(7);
  const forecast = createForecast({ fixtureId: fixture.id, forecastSnapshotId: snapshotId, cutoff: request.cutoff, canonicalIdentityState: "RESOLVED", home, away, lineupAvailable: lineup !== null, sourceReliability: 1 });
  const issuedAt = new Date().toISOString();
  const draft: ForecastResponseDto & { officialLineupObservationId: string | null } = {
    id: snapshotId,
    fixtureId: fixture.id,
    kind: request.kind,
    revision: 1,
    cutoff: request.cutoff,
    modelVersion: forecast.modelVersion,
    modelHash: sha({ version: forecast.modelVersion }),
    configVersion: forecast.configVersion,
    configHash: forecast.configHash,
    inputHash: forecast.inputHash,
    evidenceFingerprint: sha(evidenceBuildIds),
    evidenceBuildIds,
    probabilities: forecast.markets,
    confidence: forecast.confidence,
    limitations: forecast.limitations,
    tail: { retainedMass: forecast.retainedMass, tailMass: forecast.tailMass, warning: forecast.tailWarning, normalizationVersion: forecast.normalizationVersion },
    assumptions: forecast.assumptions,
    receipt: { forecastSnapshotId: snapshotId, evidenceBuildIds, sourceRefs: forecast.sources, expectedGoals: forecast.expectedGoals, adjustments: forecast.adjustments },
    issuedAt,
    officialLineupObservationId: lineup?.id ?? null,
  };
  const { officialLineupObservationId: _lineup, ...transport } = draft;
  parseForecastResponse(transport);
  return repository.publish(draft);
}

type StoredForecast = Record<string, unknown>;

export function createPrismaForecastRepository(client: PrismaClient): ForecastPublicationRepository {
  const toDto = (row: StoredForecast): ForecastResponseDto => parseForecastResponse(row.receipt);
  return {
    assertEligible: async () => undefined,
    findFixture: async (id) => {
      const row = await client.fixture.findUnique({ where: { id }, select: { id: true, homeTeamId: true, awayTeamId: true, kickoffUtc: true } });
      return row ? { ...row, canonicalIdentityResolved: Boolean(row.homeTeamId && row.awayTeamId) } : null;
    },
    findEvidence: async (teamId, cutoff) => {
      const build = await client.evidenceBuild.findFirst({ where: { teamId, cutoff: new Date(cutoff), state: "PUBLISHED" }, include: { components: true } });
      if (!build) return null;
      const { resolveTeamEvidence } = await import("../evidence/evidence.service.js");
      return resolveTeamEvidence({ teamId, asOf: cutoff }, { findPublished: async () => build });
    },
    findOfficialLineup: async (fixtureId, cutoff) => client.lineupObservation.findFirst({ where: { fixtureId, status: "CONFIRMED", confirmedAt: { lte: new Date(cutoff) } }, orderBy: { confirmedAt: "desc" }, select: { id: true } }),
    findIssued: async (fixtureId, kind, cutoff) => {
      const row = await client.forecastSnapshot.findFirst({ where: { fixtureId, kind, cutoff: new Date(cutoff), state: "ISSUED" }, orderBy: { revision: "desc" } });
      return row ? toDto(row as unknown as StoredForecast) : null;
    },
    publish: async (draft) => {
      const existing = await client.forecastSnapshot.findFirst({ where: { fixtureId: draft.fixtureId, kind: draft.kind, cutoff: new Date(draft.cutoff), modelHash: draft.modelHash, configHash: draft.configHash, inputHash: draft.inputHash, evidenceFingerprint: draft.evidenceFingerprint, state: "ISSUED" } });
      if (existing) return toDto(existing as unknown as StoredForecast);
      return client.$transaction(async (tx) => {
        const latest = await tx.forecastSnapshot.findFirst({ where: { fixtureId: draft.fixtureId, kind: draft.kind }, orderBy: { revision: "desc" } });
        const revision = (latest?.revision ?? 0) + 1;
        const transport = { ...draft, revision };
        const { officialLineupObservationId, ...response } = transport;
        await tx.forecastSnapshot.create({ data: {
          id: response.id, fixtureId: response.fixtureId, kind: response.kind, state: "ISSUED", revision,
          supersedesForecastId: latest?.id ?? null, officialLineupObservationId, cutoff: new Date(response.cutoff),
          modelVersion: response.modelVersion, modelHash: response.modelHash, configVersion: response.configVersion, configHash: response.configHash,
          inputHash: response.inputHash, evidenceFingerprint: response.evidenceFingerprint, sourceRefs: response.receipt.sourceRefs as never,
          probabilities: response.probabilities as never, confidence: response.confidence as never, assumptions: response.assumptions as never,
          receipt: response as never, issuedAt: new Date(response.issuedAt), markets: { create: Object.entries(response.probabilities).map(([market, probabilities]) => ({ market, probabilities: probabilities as never })) },
        } });
        return parseForecastResponse(response);
      });
    },
  };
}

@Injectable()
export class ForecastsService implements OnModuleDestroy {
  private readonly client: PrismaClient;
  private readonly repository: ForecastPublicationRepository;

  constructor() {
    this.client = createPrismaClient();
    this.repository = createPrismaForecastRepository(this.client);
  }

  generate(input: unknown): Promise<ForecastResponseDto> { return generateForecast(input, this.repository); }
  async get(fixtureId: string, kind: unknown, cutoff: unknown): Promise<ForecastResponseDto> {
    const request = parseForecastRequest({ fixtureId, kind, cutoff });
    const existing = await this.repository.findIssued?.(request.fixtureId, request.kind, request.cutoff);
    if (!existing) throw failure("FORECAST_NOT_FOUND");
    return existing;
  }
  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}
