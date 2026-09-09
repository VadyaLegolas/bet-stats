import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaForecastRepository, type ForecastPublicationRepository, type PrismaClient } from "@bet-stats/database";
import {
  currentForecastConfigHash,
  ForecastOrchestrator,
  parseForecastRequest,
  type ForecastResponseDto,
} from "@bet-stats/domain";


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
