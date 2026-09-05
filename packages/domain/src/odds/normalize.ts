import { Decimal } from "decimal.js";
import { MARKET_SELECTIONS, parseOddsBook, type OddsBookInput, type OddsSelection } from "./contract.js";

export interface NormalizedOddsBook extends OddsBookInput {
  readonly schemaVersion: "manual-odds-v1";
  readonly selections: readonly Readonly<{ selection: OddsSelection; decimalOdds: string; impliedProbability: string; noVigProbability: string }>[];
  readonly overround: string;
}

export function normalizeOddsBook(input: OddsBookInput): NormalizedOddsBook {
  const parsed = parseOddsBook(input);
  const expected = MARKET_SELECTIONS[parsed.market];
  const ordered = [...parsed.selections].sort((a, b) => expected.indexOf(a.selection) - expected.indexOf(b.selection));
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
