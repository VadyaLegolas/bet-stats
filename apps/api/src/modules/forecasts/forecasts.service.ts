import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  currentForecastConfigHash,
  ForecastOrchestrator,
  parseForecastRequest,
  parseForecastResponse,
  type EvidenceProjectionDto,
  type ForecastFixture,
  type ForecastOrchestratorRepository,
  type ForecastRequestDto,
  type ForecastResponseDto,
} from "@bet-stats/domain";

export interface ForecastPublicationRepository extends ForecastOrchestratorRepository {
  assertEligible(): Promise<void>;
  findFixture(fixtureId: string): Promise<ForecastFixture | null>;
  findEvidence(teamId: string, cutoff: string): Promise<EvidenceProjectionDto | null>;
  findOfficialLineup(fixtureId: string, cutoff: string): Promise<{ id: string } | null>;
  publish(draft: ForecastResponseDto): Promise<ForecastResponseDto>;
  findIssued?(fixtureId: string, kind: ForecastRequestDto["kind"], cutoff: string): Promise<ForecastResponseDto | null>;
  listIssued?(fixtureId: string): Promise<readonly ForecastResponseDto[]>;
}

function failure(code: string): Error & { code: string } {
  const exception = ["POST_KICKOFF_CUTOFF", "LINEUP_NOT_CONFIRMED", "REQUIRED_EVIDENCE_UNAVAILABLE", "UNRESOLVED_CANONICAL_IDENTITY"].includes(code)
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

export async function generateForecast(raw: unknown, repository: ForecastPublicationRepository): Promise<ForecastResponseDto> {
  const request = parseForecastRequest(raw);
  try {
    return await new ForecastOrchestrator().run({
      fixtureId: request.fixtureId,
      asOf: request.cutoff,
      kind: request.kind,
      modelVersion: "poisson-ensemble-v1",
      configHash: currentForecastConfigHash(),
      initiator: { type: "production", correlationId: `api:${request.fixtureId}:${request.cutoff}` },
    }, repository);
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (code) throw failure(code);
    throw error;
  }
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
    findOfficialLineup: async (fixtureId, cutoff) => client.lineupObservation.findFirst({ where: { fixtureId, status: "OFFICIAL_CONFIRMED", confirmedAt: { lte: new Date(cutoff) } }, orderBy: { confirmedAt: "desc" }, select: { id: true } }),
    findIssued: async (fixtureId, kind, cutoff) => {
      const row = await client.forecastSnapshot.findFirst({ where: { fixtureId, kind, cutoff: new Date(cutoff), state: "ISSUED" }, orderBy: { revision: "desc" } });
      return row ? toDto(row as unknown as StoredForecast) : null;
    },
    listIssued: async (fixtureId) => {
      const rows = await client.forecastSnapshot.findMany({
        where: { fixtureId, state: "ISSUED" },
        orderBy: [{ issuedAt: "desc" }, { cutoff: "desc" }, { revision: "desc" }, { id: "asc" }],
      });
      return rows.map((row) => toDto(row as unknown as StoredForecast));
    },
    publish: async (draft) => {
      const identity = { fixtureId: draft.fixtureId, kind: draft.kind, cutoff: new Date(draft.cutoff), modelHash: draft.modelHash, configHash: draft.configHash, inputHash: draft.inputHash, evidenceFingerprint: draft.evidenceFingerprint, state: "ISSUED" as const };
      const existing = await client.forecastSnapshot.findFirst({ where: identity });
      if (existing) return toDto(existing as unknown as StoredForecast);
      try {
        return await client.$transaction(async (tx) => {
          const lockKey = `${draft.fixtureId}:${draft.kind}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          const converged = await tx.forecastSnapshot.findFirst({ where: identity });
          if (converged) return toDto(converged as unknown as StoredForecast);
          const latest = await tx.forecastSnapshot.findFirst({ where: { fixtureId: draft.fixtureId, kind: draft.kind }, orderBy: { revision: "desc" } });
          const revision = (latest?.revision ?? 0) + 1;
          const transport = { ...draft, revision };
          const { officialLineupObservationId } = transport;
          const response = transport;
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
      } catch (error) {
        const collision = await client.forecastSnapshot.findFirst({ where: identity });
        if (collision) return toDto(collision as unknown as StoredForecast);
        throw error;
      }
    },
  };
}

@Injectable()
export class ForecastsService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;
  private readonly repository: ForecastPublicationRepository | null;

  constructor() {
    this.client = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
    this.repository = this.client ? createPrismaForecastRepository(this.client) : null;
  }

  private db(): ForecastPublicationRepository {
    if (!this.repository) throw Object.assign(new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" }), { code: "DATABASE_UNAVAILABLE" });
    return this.repository;
  }

  generate(input: unknown): Promise<ForecastResponseDto> { return generateForecast(input, this.db()); }
  async list(fixtureId: string): Promise<readonly ForecastResponseDto[]> {
    return this.db().listIssued?.(fixtureId) ?? [];
  }
  async get(fixtureId: string, kind: unknown, cutoff: unknown): Promise<ForecastResponseDto> {
    const request = parseForecastRequest({ fixtureId, kind, cutoff });
    const existing = await this.db().findIssued?.(request.fixtureId, request.kind, request.cutoff);
    if (!existing) throw failure("FORECAST_NOT_FOUND");
    return existing;
  }
  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}
