import { validateClosingOddsBook, type ClosingObservationRow, type ClosingOddsBookInput, type ClosingOddsRejection, type OddsMarket, type OddsSelection } from "@bet-stats/domain";

import type { Prisma, PrismaClient } from "./client.js";

/**
 * Write path of closing-odds observations (Phase 13, CLV-01, D-01..D-03).
 *
 * Append-only: rows are only ever inserted (the table trigger refuses UPDATE and DELETE). One call records ONE complete
 * market set in one transaction. Admission is decided by the pure `validateClosingOddsBook` from facts READ HERE
 * (kickoff, presence of a settlement receipt) and the server clock; nothing the client says about time or state is trusted.
 * The repository never writes to ManualOdds*, ValueReceipt, ValueSettlement, ForecastSnapshot or any settlement table.
 */

export type ClosingOddsRepositoryErrorCode =
  | ClosingOddsRejection
  | "FIXTURE_NOT_FOUND"
  | "UNKNOWN_SOURCE_CONVENTION"
  | "CLOSING_OBSERVATION_CONFLICT";

export type ClosingOddsRepositoryError = Error & { readonly code: ClosingOddsRepositoryErrorCode };

function repositoryError(code: ClosingOddsRepositoryErrorCode): ClosingOddsRepositoryError {
  return Object.assign(new Error(code), { code, name: "ClosingOddsRepositoryError" }) as ClosingOddsRepositoryError;
}

export interface StoredClosingObservation {
  readonly id: string;
  readonly fixtureId: string;
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
  readonly decimalOdds: string;
  readonly oddsFormat: "DECIMAL";
  readonly sourceConvention: string;
  readonly observationKind: "MARKET_CLOSE";
  readonly observedAt: string;
  readonly createdAt: string;
}

export interface RecordClosingOddsBookResult {
  /** True when this call inserted at least one row; false for an identical replay. */
  readonly created: boolean;
  /** Rows of the set in market order. */
  readonly observations: readonly StoredClosingObservation[];
}

export interface ClosingOddsRepository {
  /** Throws a `ClosingOddsRepositoryError` (typed `code`) on a rejection or conflict; nothing is written in that case. */
  recordClosingOddsBook(input: ClosingOddsBookInput): Promise<RecordClosingOddsBookResult>;
}

type StoredRow = {
  id: string;
  fixtureId: string;
  market: string;
  selection: string;
  decimalOdds: string;
  oddsFormat: string;
  sourceConvention: string;
  observationKind: string;
  observedAt: Date;
  createdAt: Date;
};

function toStored(row: StoredRow): StoredClosingObservation {
  return {
    id: row.id,
    fixtureId: row.fixtureId,
    market: row.market as OddsMarket,
    selection: row.selection as OddsSelection,
    decimalOdds: row.decimalOdds,
    oddsFormat: row.oddsFormat as "DECIMAL",
    sourceConvention: row.sourceConvention,
    observationKind: row.observationKind as "MARKET_CLOSE",
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function matches(existing: StoredRow, wanted: ClosingObservationRow): boolean {
  return existing.decimalOdds === wanted.decimalOdds
    && existing.oddsFormat === wanted.oddsFormat
    && existing.observationKind === wanted.observationKind
    && existing.fixtureId === wanted.fixtureId
    && existing.market === wanted.market
    && existing.selection === wanted.selection
    && existing.sourceConvention === wanted.sourceConvention
    && existing.observedAt.toISOString() === wanted.observedAt;
}

const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 10_000;

export function createPrismaClosingOddsRepository(options: { database: PrismaClient; clock?: () => Date }): ClosingOddsRepository {
  const { database } = options;
  const clock = options.clock ?? (() => new Date());

  async function record(transaction: Prisma.TransactionClient, input: ClosingOddsBookInput): Promise<RecordClosingOddsBookResult> {
    // Serialises writers of one fixture so a concurrent identical request replays instead of racing on the primary key.
    await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `${input.fixtureId}:closing-odds`);

    const fixture = await transaction.fixture.findUnique({ where: { id: input.fixtureId }, select: { kickoffUtc: true } });
    if (!fixture) throw repositoryError("FIXTURE_NOT_FOUND");
    const settlement = await transaction.settlementReceipt.findFirst({ where: { fixtureId: input.fixtureId }, select: { id: true } });

    const validation = validateClosingOddsBook(input, {
      kickoffUtc: fixture.kickoffUtc.toISOString(),
      nowUtc: clock().toISOString(),
      fixtureSettled: settlement !== null,
    });
    if (!validation.ok) throw repositoryError(validation.code);

    // D-02: a closing price is only usable when it shares a source convention with some manual-odds snapshot.
    const knownSource = await transaction.manualOddsSnapshot.findFirst({ where: { source: input.sourceConvention }, select: { id: true } });
    if (!knownSource) throw repositoryError("UNKNOWN_SOURCE_CONVENTION");

    const existing = await transaction.closingOddsObservation.findMany({ where: { id: { in: validation.rows.map((row) => row.id) } } });
    const byId = new Map(existing.map((row) => [row.id, row as StoredRow]));
    for (const wanted of validation.rows) {
      const found = byId.get(wanted.id);
      if (found && !matches(found, wanted)) throw repositoryError("CLOSING_OBSERVATION_CONFLICT");
    }

    let created = false;
    const observations: StoredClosingObservation[] = [];
    for (const wanted of validation.rows) {
      const found = byId.get(wanted.id);
      if (found) {
        observations.push(toStored(found));
        continue;
      }
      const inserted = await transaction.closingOddsObservation.create({
        data: {
          id: wanted.id,
          fixtureId: wanted.fixtureId,
          market: wanted.market,
          selection: wanted.selection,
          decimalOdds: wanted.decimalOdds,
          oddsFormat: wanted.oddsFormat,
          sourceConvention: wanted.sourceConvention,
          observationKind: wanted.observationKind,
          observedAt: new Date(wanted.observedAt),
        },
      });
      created = true;
      observations.push(toStored(inserted as StoredRow));
    }
    return { created, observations };
  }

  return {
    async recordClosingOddsBook(input) {
      if (!input || typeof input.fixtureId !== "string" || input.fixtureId.trim() === "" || input.fixtureId.length > 256) throw repositoryError("FIXTURE_NOT_FOUND");
      return database.$transaction((transaction) => record(transaction, input), { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: TRANSACTION_TIMEOUT_MS });
    },
  };
}
