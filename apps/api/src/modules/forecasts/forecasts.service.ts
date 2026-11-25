import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaForecastRepository, readCalibrationState, type ForecastPublicationRepository, type PrismaClient } from "@bet-stats/database";
import {
  ForecastOrchestrator,
  buildExtendedMarketsView,
  parseForecastRequest,
  resolveScoreMatrix,
  unavailableExtendedMarketsView,
  type CalibratedForecastResponseDto,
  type ExtendedMarketsView,
  type ForecastResponseDto,
} from "@bet-stats/domain";
import { resolveForecastModelSelection } from "@bet-stats/config";

import { attachMarketCalibration, calibrationFailureLogRecord, resolveCalibrationStateCacheTtlMs, withCalibrationStateCache, type CalibrationEnrichmentDeps } from "./forecast-calibration.js";


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

const FORECAST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The wire shape of the extended-markets route is the strictly typed domain DTO (D-04). */
export type ExtendedMarketsResponse = ExtendedMarketsView;

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
    // The cache TTL (CALIBRATION_STATE_CACHE_TTL_MS, default 60 s, max 300 s, 0 = off) bounds how long a promotion or rollback stays unseen.
    this.calibration = {
      readState: withCalibrationStateCache((identity, asOf) => {
        if (!client) throw new Error("DATABASE_UNAVAILABLE");
        return readCalibrationState(client, { ...identity, asOf });
      }, { ttlMs: resolveCalibrationStateCacheTtlMs(process.env) }),
      now: () => new Date(),
      // The client sees UNAVAILABLE; the operator sees why (code and identity only, WR-07).
      onError: (failure) => new Logger(ForecastsService.name).warn(JSON.stringify(calibrationFailureLogRecord(failure))),
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
  /**
   * Read-time view of the extended markets (D-04): derived from the sealed score matrix, never written to
   * ForecastMarket, never calibrated. The client sees only the typed state; the internal reason goes to the operator log.
   */
  async extendedMarkets(fixtureId: string, forecastId: string): Promise<ExtendedMarketsResponse> {
    if (!FORECAST_ID_PATTERN.test(forecastId)) throw Object.assign(new BadRequestException({ code: "INVALID_FORECAST_ID" }), { code: "INVALID_FORECAST_ID" });
    const stored = await this.db().findStoredForecast?.(forecastId);
    if (!stored || stored.state !== "ISSUED" || stored.origin !== "PRODUCTION" || stored.dto.fixtureId !== fixtureId) throw new NotFoundException({ code: "FORECAST_NOT_FOUND" });
    const resolved = resolveScoreMatrix({ scoreMatrix: stored.scoreMatrix, modelVersion: stored.modelVersion, receipt: stored.dto.receipt, markets: stored.markets });
    if (resolved.state === "UNAVAILABLE") {
      new Logger(ForecastsService.name).warn(JSON.stringify({ code: "SCORE_MATRIX_UNAVAILABLE", reason: resolved.reason, forecastId, modelVersion: stored.modelVersion }));
      return unavailableExtendedMarketsView();
    }
    const { retainedMass, tailMass, warning } = stored.dto.tail;
    return buildExtendedMarketsView({ cells: resolved.cells, source: resolved.source, tail: { retainedMass, tailMass, warning } });
  }
  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}
