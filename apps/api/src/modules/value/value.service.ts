import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, createPrismaForecastRepository, type PrismaClient, type StoredForecastView } from "@bet-stats/database";
import {
  decideExtendedValue, decideValue, isCoreMarket, parseForecastResponse, parseScoreMatrixV1, parseValueCommand, resolveScoreMatrix, splitStoredForecast,
  type ExtendedValueMatrix, type ForecastResponseDto, type ValueCommand,
} from "@bet-stats/domain";

import type { ManualOddsSnapshotDto } from "../odds/odds.service.js";

export interface ValueReceiptDto {
  readonly id: string;
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly oddsSnapshotId: string;
  readonly market: string;
  readonly selection: string;
  readonly outcome: "VALUE_CANDIDATE" | "NO_VALUE" | "INSUFFICIENT_EVIDENCE";
  readonly reasons: readonly string[];
  readonly modelProbability: string;
  readonly noVigProbability: string;
  readonly fairOdds: string | null;
  readonly edge: string;
  readonly expectedValue: string;
  readonly receipt: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ValueRepository {
  findForecast(id: string): Promise<ForecastResponseDto | null>;
  findOdds(id: string): Promise<ManualOddsSnapshotDto | null>;
  findReceipt(forecastSnapshotId: string, oddsSnapshotId: string, market: string, selection: string): Promise<ValueReceiptDto | null>;
  insertReceipt(receipt: ValueReceiptDto): Promise<ValueReceiptDto>;
  findReceiptById?(id: string): Promise<ValueReceiptDto | null>;
  /** Raw material of the score matrix of an ISSUED PRODUCTION snapshot (WR-13); absent in repositories that cannot serve the extended markets. */
  findStoredForecast?(id: string): Promise<StoredForecastView | null>;
}

function failure(code: string): Error & { code: string } {
  const exception = code === "SNAPSHOT_PAIR_MISMATCH" || code === "SNAPSHOT_LIFECYCLE_MISMATCH" || code === "SCORE_MATRIX_UNAVAILABLE"
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

function unavailable(reason: string, forecastSnapshotId: string): never {
  // The client sees only the typed code; the internal reason goes to the operator log (same convention as the extended-markets read).
  new Logger("ValueService").warn(JSON.stringify({ code: "SCORE_MATRIX_UNAVAILABLE", reason, forecastSnapshotId }));
  throw failure("SCORE_MATRIX_UNAVAILABLE");
}

/** Fail-closed read of the matrix behind a forecast (D-03): the persisted grid, or the re-derived one when it reproduces the stored markets exactly. */
async function loadVerifiedMatrix(forecastSnapshotId: string, fixtureId: string, repository: ValueRepository): Promise<ExtendedValueMatrix> {
  const stored = await repository.findStoredForecast?.(forecastSnapshotId);
  if (!stored) return unavailable(repository.findStoredForecast ? "FORECAST_NOT_READABLE" : "NO_STORED_FORECAST_READER", forecastSnapshotId);
  if (stored.dto.id !== forecastSnapshotId || stored.dto.fixtureId !== fixtureId) return unavailable("FORECAST_IDENTITY_MISMATCH", forecastSnapshotId);
  const resolved = resolveScoreMatrix({ scoreMatrix: stored.scoreMatrix, modelVersion: stored.modelVersion, receipt: stored.dto.receipt, markets: stored.markets });
  if (resolved.state === "UNAVAILABLE") return unavailable(resolved.reason, forecastSnapshotId);
  // resolveScoreMatrix already proved the sealed block; reading its hash again cannot fail for a PERSISTED result.
  const cellsHash = resolved.source === "PERSISTED" ? parseScoreMatrixV1(stored.scoreMatrix).cellsHash : null;
  return { cells: resolved.cells, source: resolved.source, cellsHash };
}

export async function compareValue(raw: unknown, repository: ValueRepository): Promise<ValueReceiptDto> {
  let command: ValueCommand;
  try { command = parseValueCommand(raw); }
  catch (error) { throw failure(error instanceof Error ? error.message : "INVALID_VALUE_COMMAND"); }
  const [forecast, odds] = await Promise.all([repository.findForecast(command.forecastSnapshotId), repository.findOdds(command.oddsSnapshotId)]);
  if (!forecast || !odds) throw failure("SNAPSHOT_NOT_FOUND");
  // Only the three core markets have stored forecast probabilities; every other registry market reads the score matrix (D-13).
  if (forecast.fixtureId !== command.fixtureId || odds.fixtureId !== command.fixtureId || odds.market !== command.market || (isCoreMarket(command.market) && !forecast.probabilities[command.market])) throw failure("SNAPSHOT_PAIR_MISMATCH");
  const existing = await repository.findReceipt(command.forecastSnapshotId, command.oddsSnapshotId, command.market, command.selection);
  if (existing) return existing;
  const decisionForecast = {
    fixtureId: forecast.fixtureId, forecastSnapshotId: forecast.id, cutoff: forecast.cutoff,
    modelVersion: forecast.modelVersion, configVersion: forecast.configVersion, configHash: forecast.configHash, inputHash: forecast.inputHash,
    evidenceBuildIds: forecast.evidenceBuildIds, markets: forecast.probabilities, confidence: forecast.confidence,
    limitations: forecast.limitations, sources: forecast.receipt.sourceRefs, assumptions: forecast.assumptions,
  };
  const odd = odds.selections.find(({ selection }) => selection === command.selection)!;
  const createdAt = new Date().toISOString();
  const id = createHash("sha256")
    .update(JSON.stringify([command.forecastSnapshotId, command.oddsSnapshotId, command.market, command.selection]))
    .digest("hex")
    .slice(0, 32);
  let value: ValueReceiptDto;
  if (isCoreMarket(command.market)) {
    const decision = decideValue({ selection: command.selection, forecast: decisionForecast, odds });
    const event = forecast.probabilities[command.market].find(({ selection }) => selection === command.selection)!;
    value = {
      id, ...command, outcome: decision.outcome, reasons: decision.reasons,
      modelProbability: String(event.probability), noVigProbability: odd.noVigProbability, fairOdds: event.fairOdds,
      edge: decision.edge, expectedValue: decision.expectedValue,
      receipt: { ...decision.receipt, market: command.market, selection: command.selection, modelProbability: String(event.probability), noVigProbability: odd.noVigProbability, decimalOdds: odd.decimalOdds, outcome: decision.outcome, reasons: decision.reasons },
      createdAt,
    };
  } else {
    // No row is written before the matrix is proven authentic: an unavailable matrix is a 409 with nothing stored (T-14-20).
    const matrix = await loadVerifiedMatrix(command.forecastSnapshotId, command.fixtureId, repository);
    const decision = decideExtendedValue({ market: command.market as never, selection: command.selection, forecast: decisionForecast, matrix, odds });
    value = {
      id, ...command, outcome: decision.outcome, reasons: decision.reasons,
      modelProbability: decision.modelProbability, noVigProbability: odd.noVigProbability, fairOdds: decision.fairOdds,
      edge: decision.edge, expectedValue: decision.expectedValue,
      receipt: { ...decision.receipt, market: command.market, selection: command.selection, modelProbability: decision.modelProbability, noVigProbability: odd.noVigProbability, decimalOdds: odd.decimalOdds, outcome: decision.outcome, reasons: decision.reasons },
      createdAt,
    };
  }
  try { return await repository.insertReceipt(value); }
  catch (error) {
    const collision = await repository.findReceipt(command.forecastSnapshotId, command.oddsSnapshotId, command.market, command.selection);
    if (collision?.id === value.id) return collision;
    throw error;
  }
}

export async function receiptDownload(id: string, repository: Pick<ValueRepository, "findReceiptById">): Promise<{ filename: string; contentType: string; body: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw failure("INVALID_VALUE_RECEIPT_ID");
  const receipt = await repository.findReceiptById?.(id) ?? null;
  if (!receipt) throw new NotFoundException({ code: "VALUE_RECEIPT_NOT_FOUND" });
  return { filename: `value-receipt-${receipt.id}.json`, contentType: "application/json; charset=utf-8", body: JSON.stringify(receipt, null, 2) };
}

function rowToDto(row: { id: string; createdAt: Date; receipt: unknown }): ValueReceiptDto { return { ...(row.receipt as ValueReceiptDto), id: row.id, createdAt: row.createdAt.toISOString() }; }

export function createPrismaValueRepository(client: PrismaClient): ValueRepository {
  const forecasts = createPrismaForecastRepository(client);
  return {
    // The same WR-13 rule as findForecast: a BACKTEST or non-ISSUED snapshot never feeds a value receipt.
    findStoredForecast: async (id) => { const stored = await forecasts.findStoredForecast?.(id); return stored && stored.state === "ISSUED" && stored.origin === "PRODUCTION" ? stored : null; },
    // WR-13: no value receipt can be created against a retrospective BACKTEST snapshot.
    findForecast: async (id) => { const row = await client.forecastSnapshot.findFirst({ where: { id, origin: "PRODUCTION" } }); return row?.state === "ISSUED" ? parseForecastResponse(splitStoredForecast(row.receipt).dto) : null; },
    findOdds: async (id) => { const row = await client.manualOddsSnapshot.findUnique({ where: { id } }); return row ? { ...(row.receipt as unknown as ManualOddsSnapshotDto), oddsSnapshotId: row.id, fixtureId: row.fixtureId, market: row.market as ManualOddsSnapshotDto["market"], sourceLabel: row.source, replacementOfOddsSnapshotId: row.replacesOddsId, submittedAt: row.submittedAt.toISOString() } : null; },
    findReceipt: async (forecastSnapshotId, oddsSnapshotId, market, selection) => { const row = await client.valueReceipt.findUnique({ where: { forecastSnapshotId_oddsSnapshotId_market_selection: { forecastSnapshotId, oddsSnapshotId, market, selection } } }); return row ? rowToDto(row) : null; },
    findReceiptById: async (id) => { const row = await client.valueReceipt.findUnique({ where: { id } }); return row ? rowToDto(row) : null; },
    insertReceipt: async (value) => {
      const row = await client.valueReceipt.create({ data: {
        id: value.id, fixtureId: value.fixtureId, market: value.market, forecastSnapshotId: value.forecastSnapshotId, oddsSnapshotId: value.oddsSnapshotId,
        outcome: value.outcome, selection: value.selection, modelProbability: value.modelProbability, noVigProbability: value.noVigProbability,
        fairOdds: value.fairOdds, edge: value.edge, expectedValue: value.expectedValue, receipt: value as never, createdAt: new Date(value.createdAt),
      } });
      return rowToDto(row);
    },
  };
}

@Injectable()
export class ValueService implements OnModuleDestroy {
  private readonly client: PrismaClient | null = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
  private readonly repository = this.client ? createPrismaValueRepository(this.client) : null;
  private db(): ValueRepository { if (!this.repository) throw Object.assign(new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" }), { code: "DATABASE_UNAVAILABLE" }); return this.repository; }
  compare(input: unknown): Promise<ValueReceiptDto> { return compareValue(input, this.db()); }
  async get(id: string): Promise<ValueReceiptDto> { const value = await this.db().findReceiptById?.(id); if (!value) throw new NotFoundException({ code: "VALUE_RECEIPT_NOT_FOUND" }); return value; }
  download(id: string): Promise<{ filename: string; contentType: string; body: string }> { return receiptDownload(id, this.db()); }
  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}
