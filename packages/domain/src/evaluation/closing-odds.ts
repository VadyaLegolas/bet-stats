import type { OddsMarket, OddsSelection } from "../odds/contract.js";

export interface ClosingOddsBookInput {
  readonly fixtureId: string;
  readonly market: OddsMarket;
  readonly sourceConvention: string;
  readonly observedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export interface ClosingOddsContext {
  readonly kickoffUtc: string;
  readonly nowUtc: string;
  readonly fixtureSettled: boolean;
}

export type ClosingOddsRejection =
  | "INCOMPLETE_MARKET_SET"
  | "DUPLICATE_SELECTION"
  | "UNSUPPORTED_MARKET"
  | "INVALID_OBSERVED_AT"
  | "OBSERVED_AT_NOT_PRE_KICKOFF"
  | "OBSERVED_AT_IN_FUTURE"
  | "RECORDED_AFTER_KICKOFF"
  | "FIXTURE_ALREADY_SETTLED"
  | "INVALID_ODDS"
  | "INVALID_SOURCE_CONVENTION";

export interface ClosingObservationKey {
  readonly fixtureId: string;
  readonly market: string;
  readonly selection: string;
  readonly sourceConvention: string;
  readonly observedAt: string;
}

export interface ClosingObservationRow extends ClosingObservationKey {
  readonly id: string;
  readonly market: OddsMarket;
  readonly selection: OddsSelection;
  readonly oddsFormat: "DECIMAL";
  readonly observationKind: "MARKET_CLOSE";
  readonly decimalOdds: string;
}

export type ClosingOddsValidation =
  | Readonly<{ ok: true; rows: readonly ClosingObservationRow[] }>
  | Readonly<{ ok: false; code: ClosingOddsRejection }>;

// RED stub: behavior is intentionally absent until the GREEN step.
export function closingObservationId(_key: ClosingObservationKey): string {
  return "";
}

export function validateClosingOddsBook(_input: ClosingOddsBookInput, _context: ClosingOddsContext): ClosingOddsValidation {
  return { ok: false, code: "UNSUPPORTED_MARKET" };
}
