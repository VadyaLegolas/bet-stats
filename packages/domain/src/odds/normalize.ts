import Decimal from "decimal.js";

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

export interface NormalizedOddsBook extends OddsBookInput {
  readonly schemaVersion: "manual-odds-v1";
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string; impliedProbability: string; noVigProbability: string }>[];
  readonly overround: string;
}

const EXPECTED: Readonly<Record<OddsMarket, readonly OddsSelection[]>> = { ONE_X_TWO: ["HOME", "DRAW", "AWAY"], OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"], BTTS: ["YES", "NO"] };

export function normalizeOddsBook(input: OddsBookInput): NormalizedOddsBook {
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new Error("INVALID_ODDS_CAPTURED_AT");
  if (!input.sourceLabel.trim()) throw new Error("INVALID_ODDS_SOURCE_LABEL");
  const expected = EXPECTED[input.market];
  if (!expected) throw new Error("UNSUPPORTED_ODDS_MARKET");
  const actual = input.selections.map(({ selection }) => selection);
  if (new Set(actual).size !== actual.length) throw new Error("DUPLICATE_ODDS_SELECTION");
  if (actual.length !== expected.length || expected.some((selection) => !actual.includes(selection))) throw new Error("INCOMPLETE_ODDS_BOOK");
  const ordered = [...input.selections].sort((a, b) => expected.indexOf(a.selection) - expected.indexOf(b.selection));
  const implied = ordered.map(({ decimalOdds }) => {
    let odds: Decimal;
    try { odds = new Decimal(decimalOdds); } catch { throw new Error("INVALID_DECIMAL_ODDS"); }
    if (!odds.isFinite() || odds.lte(1)) throw new Error("INVALID_DECIMAL_ODDS");
    return new Decimal(1).div(odds);
  });
  const total = implied.reduce((sum, value) => sum.plus(value), new Decimal(0));
  return {
    ...input,
    schemaVersion: "manual-odds-v1",
    selections: ordered.map((selection, index) => ({ ...selection, decimalOdds: new Decimal(selection.decimalOdds).toString(), impliedProbability: implied[index]!.toString(), noVigProbability: implied[index]!.div(total).toString() })),
    overround: total.minus(1).toString(),
  };
}
