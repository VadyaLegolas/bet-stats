import type { ClosingOddsBookInput, ClosingOddsRejection, OddsMarket, OddsSelection } from "@bet-stats/domain";

import type { PrismaClient } from "./client.js";

export type ClosingOddsRepositoryErrorCode = ClosingOddsRejection | "FIXTURE_NOT_FOUND" | "UNKNOWN_SOURCE_CONVENTION" | "CLOSING_OBSERVATION_CONFLICT";

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
  readonly created: boolean;
  readonly observations: readonly StoredClosingObservation[];
}

export interface ClosingOddsRepository {
  recordClosingOddsBook(input: ClosingOddsBookInput): Promise<RecordClosingOddsBookResult>;
}

export function createPrismaClosingOddsRepository(options: { database: PrismaClient; clock?: () => Date }): ClosingOddsRepository {
  void options;
  return { async recordClosingOddsBook() { return { created: false, observations: [] }; } };
}
