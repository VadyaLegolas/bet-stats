import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaForecastRepository, readCalibrationState, type ForecastPublicationRepository, type PrismaClient } from "@bet-stats/database";
import {
  ForecastOrchestrator,
  parseForecastRequest,
  type CalibratedForecastResponseDto,
  type ForecastResponseDto,
} from "@bet-stats/domain";
import { resolveForecastModelSelection } from "@bet-stats/config";

import { attachMarketCalibration, type CalibrationEnrichmentDeps } from "./forecast-calibration.js";


/** Server-side configuration/identity failures: the caller did nothing wrong, so they are not a 400 (review IN-03). */
const SERVER_CONFIGURATION_FAILURES = ["DIXON_COLES_RHO_UNAVAILABLE", "MODEL_VERSION_MISMATCH", "CONFIG_HASH_MISMATCH", "FORECAST_RUNTIME_IDENTITY_MISMATCH"];

function failure(code: string): Error & { code: string } {
  const exception = ["POST_KICKOFF_CUTOFF", "LINEUP_NOT_CONFIRMED", "REQUIRED_EVIDENCE_UNAVAILABLE", "UNRESOLVED_CANONICAL_IDENTITY"].includes(code)
    ? new ConflictException({ code })
    : SERVER_CONFIGURATION_FAILURES.includes(code)
      ? new ServiceUnavailableException({ code })
      : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

export async function generateForecast(
  raw: unknown,
  repository: ForecastPublicationRepository,
  selection: ReturnType<typeof resolveForecastModelSelection> = resolveForecastModelSelection(process.env),
): Promise<ForecastResponseDto> {
  const request = parseForecastRequest(raw);
  try {
    return await new ForecastOrchestrator().run({
      fixtureId: request.fixtureId,
      asOf: request.cutoff,
      kind: request.kind,
      modelVersion: selection.modelVersion,
      configHash: selection.configHash,
      initiator: { type: "production", correlationId: `api:${request.fixtureId}:${request.cutoff}` },
    }, repository);
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ServiceUnavailableException) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (code) throw failure(code);
    throw error;
  }
}

@Injectable()
export class ForecastsService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;
  private readonly repository: ForecastPublicationRepository | null;
  private readonly selection: ReturnType<typeof resolveForecastModelSelection>;
  /** Read-time calibration (Phase 12). Replaceable only as a test seam; production uses the database reader. */
  calibration: CalibrationEnrichmentDeps;

  constructor() {
    this.client = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
    this.repository = this.client ? createPrismaForecastRepository(this.client) : null;
    this.selection = resolveForecastModelSelection(process.env);
    const client = this.client;
    this.calibration = {
      readState: (identity, asOf) => {
        if (!client) throw new Error("DATABASE_UNAVAILABLE");
        return readCalibrationState(client, { ...identity, asOf });
      },
      now: () => new Date(),
    };
  }

  private db(): ForecastPublicationRepository {
    if (!this.repository) throw Object.assign(new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" }), { code: "DATABASE_UNAVAILABLE" });
    return this.repository;
  }

  async generate(input: unknown): Promise<CalibratedForecastResponseDto> {
    const [forecast] = await attachMarketCalibration([await generateForecast(input, this.db(), this.selection)], this.calibration);
    return forecast!;
  }
  async list(fixtureId: string): Promise<readonly CalibratedForecastResponseDto[]> {
    return attachMarketCalibration((await this.db().listIssued?.(fixtureId)) ?? [], this.calibration);
  }
  async get(fixtureId: string, kind: unknown, cutoff: unknown): Promise<CalibratedForecastResponseDto> {
    const request = parseForecastRequest({ fixtureId, kind, cutoff });
    const existing = await this.db().findIssued?.(request.fixtureId, request.kind, request.cutoff);
    if (!existing) throw failure("FORECAST_NOT_FOUND");
    const [forecast] = await attachMarketCalibration([existing], this.calibration);
    return forecast!;
  }
  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}
