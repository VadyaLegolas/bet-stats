import { Decimal } from "decimal.js";

export type OddsMarket = "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS";
export type OddsSelection = "HOME" | "DRAW" | "AWAY" | "OVER_2_5" | "UNDER_2_5" | "YES" | "NO";

export interface OddsBookInput {
  readonly fixtureId: string;
  readonly oddsSnapshotId: string;
  readonly market: OddsMarket;
  readonly sourceLabel: string;
  readonly capturedAt: string;
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string }>[];
}

export const MARKET_SELECTIONS: Readonly<Record<OddsMarket, readonly OddsSelection[]>> = { ONE_X_TWO: ["HOME", "DRAW", "AWAY"], OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"], BTTS: ["YES", "NO"] };

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function parseOddsBook(value: unknown): OddsBookInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, ["fixtureId", "oddsSnapshotId", "market", "sourceLabel", "capturedAt", "selections"])) throw new Error("INVALID_ODDS_BOOK_KEYS");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.fixtureId !== "string" || !candidate.fixtureId || typeof candidate.oddsSnapshotId !== "string" || !candidate.oddsSnapshotId) throw new Error("INVALID_ODDS_BOOK_ID");
  if (typeof candidate.market !== "string" || !Object.hasOwn(MARKET_SELECTIONS, candidate.market)) throw new Error("UNSUPPORTED_ODDS_MARKET");
  if (typeof candidate.sourceLabel !== "string" || !candidate.sourceLabel.trim()) throw new Error("INVALID_ODDS_SOURCE_LABEL");
  if (typeof candidate.capturedAt !== "string" || !Number.isFinite(Date.parse(candidate.capturedAt))) throw new Error("INVALID_ODDS_CAPTURED_AT");
  if (!Array.isArray(candidate.selections)) throw new Error("INVALID_ODDS_SELECTIONS");
  const selections = candidate.selections.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, ["selection", "decimalOdds"])) throw new Error("INVALID_ODDS_SELECTION_KEYS");
    const record = item as Record<string, unknown>;
    if (typeof record.selection !== "string" || typeof record.decimalOdds !== "string") throw new Error("INVALID_ODDS_SELECTION");
    try {
      const odds = new Decimal(record.decimalOdds);
      if (!odds.isFinite() || odds.lte(1)) throw new Error("INVALID_DECIMAL_ODDS");
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_DECIMAL_ODDS") throw error;
      throw new Error("INVALID_DECIMAL_ODDS");
    }
    return record as unknown as { selection: OddsSelection; decimalOdds: string };
  });
  const expected = MARKET_SELECTIONS[candidate.market as OddsMarket];
  const actual = selections.map(({ selection }) => selection);
  if (new Set(actual).size !== actual.length) throw new Error("DUPLICATE_ODDS_SELECTION");
  if (actual.length !== expected.length || expected.some((selection) => !actual.includes(selection))) throw new Error("INCOMPLETE_ODDS_BOOK");
  return value as OddsBookInput;
}
