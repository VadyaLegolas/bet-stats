import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { decideValue, parseForecastResponse, parseValueCommand, type ForecastResponseDto, type ValueCommand } from "@bet-stats/domain";

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
  findReceipt(forecastSnapshotId: string, oddsSnapshotId: string): Promise<ValueReceiptDto | null>;
  insertReceipt(receipt: ValueReceiptDto): Promise<ValueReceiptDto>;
  findReceiptById?(id: string): Promise<ValueReceiptDto | null>;
}

function failure(code: string): Error & { code: string } {
  const exception = code === "SNAPSHOT_PAIR_MISMATCH" || code === "SNAPSHOT_LIFECYCLE_MISMATCH"
    ? new ConflictException({ code })
    : new BadRequestException({ code });
  return Object.assign(exception, { code });
}

export async function compareValue(raw: unknown, repository: ValueRepository): Promise<ValueReceiptDto> {
  let command: ValueCommand;
  try { command = parseValueCommand(raw); }
  catch (error) { throw failure(error instanceof Error ? error.message : "INVALID_VALUE_COMMAND"); }
  const [forecast, odds] = await Promise.all([repository.findForecast(command.forecastSnapshotId), repository.findOdds(command.oddsSnapshotId)]);
  if (!forecast || !odds) throw failure("SNAPSHOT_NOT_FOUND");
  if (forecast.fixtureId !== command.fixtureId || odds.fixtureId !== command.fixtureId || odds.market !== command.market || !forecast.probabilities[command.market]) throw failure("SNAPSHOT_PAIR_MISMATCH");
  const existing = await repository.findReceipt(command.forecastSnapshotId, command.oddsSnapshotId);
  if (existing) return existing;
  const decision = decideValue({
    selection: command.selection,
    forecast: {
      fixtureId: forecast.fixtureId, forecastSnapshotId: forecast.id, cutoff: forecast.cutoff,
      modelVersion: forecast.modelVersion, configVersion: forecast.configVersion, configHash: forecast.configHash, inputHash: forecast.inputHash,
      evidenceBuildIds: forecast.evidenceBuildIds, markets: forecast.probabilities, confidence: forecast.confidence,
      limitations: forecast.limitations, sources: forecast.receipt.sourceRefs, assumptions: forecast.assumptions,
    },
    odds,
  });
  const event = forecast.probabilities[command.market].find(({ selection }) => selection === command.selection)!;
  const odd = odds.selections.find(({ selection }) => selection === command.selection)!;
  const createdAt = new Date().toISOString();
  const id = createHash("sha256").update(`${command.forecastSnapshotId}:${command.oddsSnapshotId}`).digest("hex").slice(0, 32);
  const value: ValueReceiptDto = {
    id, ...command, outcome: decision.outcome, reasons: decision.reasons,
    modelProbability: String(event.probability), noVigProbability: odd.noVigProbability, fairOdds: event.fairOdds,
    edge: decision.edge, expectedValue: decision.expectedValue,
    receipt: { ...decision.receipt, market: command.market, selection: command.selection, modelProbability: String(event.probability), noVigProbability: odd.noVigProbability, decimalOdds: odd.decimalOdds, outcome: decision.outcome, reasons: decision.reasons },
    createdAt,
  };
  try { return await repository.insertReceipt(value); }
  catch (error) {
    const collision = await repository.findReceipt(command.forecastSnapshotId, command.oddsSnapshotId);
    if (collision) return collision;
    throw error;
  }
}

export async function receiptDownload(id: string, repository: Pick<ValueRepository, "findReceiptById">): Promise<{ filename: string; contentType: string; body: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw failure("INVALID_VALUE_RECEIPT_ID");
  const receipt = await repository.findReceiptById?.(id) ?? null;
  if (!receipt) throw new NotFoundException({ code: "VALUE_RECEIPT_NOT_FOUND" });
  return { filename: `value-receipt-${receipt.id}.json`, contentType: "application/json; charset=utf-8", body: JSON.stringify(receipt, null, 2) };
}

function rowToDto(row: any): ValueReceiptDto { return { ...row.receipt, id: row.id, createdAt: row.createdAt.toISOString() }; }

export function createPrismaValueRepository(client: PrismaClient): ValueRepository {
  return {
    findForecast: async (id) => { const row = await client.forecastSnapshot.findUnique({ where: { id } }); return row?.state === "ISSUED" ? parseForecastResponse(row.receipt) : null; },
    findOdds: async (id) => { const row = await client.manualOddsSnapshot.findUnique({ where: { id } }); return row ? { ...(row.receipt as unknown as ManualOddsSnapshotDto), oddsSnapshotId: row.id, fixtureId: row.fixtureId, market: row.market as ManualOddsSnapshotDto["market"], sourceLabel: row.source, replacementOfOddsSnapshotId: row.replacesOddsId, submittedAt: row.submittedAt.toISOString() } : null; },
    findReceipt: async (forecastSnapshotId, oddsSnapshotId) => { const row = await client.valueReceipt.findUnique({ where: { forecastSnapshotId_oddsSnapshotId: { forecastSnapshotId, oddsSnapshotId } } }); return row ? rowToDto(row) : null; },
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
  private readonly client = createPrismaClient();
  private readonly repository = createPrismaValueRepository(this.client);
  compare(input: unknown): Promise<ValueReceiptDto> { return compareValue(input, this.repository); }
  async get(id: string): Promise<ValueReceiptDto> { const value = await this.repository.findReceiptById?.(id); if (!value) throw new NotFoundException({ code: "VALUE_RECEIPT_NOT_FOUND" }); return value; }
  download(id: string): Promise<{ filename: string; contentType: string; body: string }> { return receiptDownload(id, this.repository); }
  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}
