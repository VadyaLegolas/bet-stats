import { describe, expect, it } from "vitest";

import { AH_LINES_V1 } from "../../packages/domain/src/markets/asian-handicap.js";
import { EXACT_SCORE_BUCKETS_V1, parseExactScoreSelection } from "../../packages/domain/src/markets/exact-score.js";
import { ALL_MARKET_IDS, CORE_MARKET_SELECTIONS, isCoreMarket, marketFamilyOf, parseMarketId, selectionsFor } from "../../packages/domain/src/markets/registry.js";
import { MARKET_SELECTIONS, parseOddsBook } from "../../packages/domain/src/odds/contract.js";
import { normalizeOddsBook } from "../../packages/domain/src/odds/normalize.js";

const capturedAt = "2026-09-13T12:00:00.000Z";

function book(market: string, selections: readonly string[], odds = "1.95") {
  return { fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market, sourceLabel: "book", capturedAt, selections: selections.map((selection) => ({ selection, decimalOdds: odds })) };
}

describe("market registry (D-11)", () => {
  it("lists exactly 25 distinct market ids: three core, exact score, 21 Asian handicap lines", () => {
    expect(ALL_MARKET_IDS).toHaveLength(25);
    expect(new Set(ALL_MARKET_IDS).size).toBe(25);
    expect(ALL_MARKET_IDS.slice(0, 4)).toEqual(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS", "EXACT_SCORE"]);
    expect(ALL_MARKET_IDS.slice(4)).toEqual(AH_LINES_V1.lines.map((line) => `ASIAN_HANDICAP:${line}`));
  });

  it.each(["ASIAN_HANDICAP:+1.00", "ASIAN_HANDICAP:0.0", "ASIAN_HANDICAP:-0", "ASIAN_HANDICAP:1e0", "ASIAN_HANDICAP:", "ASIAN_HANDICAP:-2.75", "asian_handicap:0", "ASIAN_HANDICAP:+0", "ASIAN_HANDICAP: 0", "", "__proto__", "toString", "EXACT_SCORE:0"])("rejects %j by construction", (id) => {
    expect(parseMarketId(id)).toBeNull();
    expect(selectionsFor(id)).toBeNull();
  });

  it("rejects non-string input", () => {
    for (const value of [null, undefined, 0, {}, [], ["ONE_X_TWO"], Symbol.iterator]) {
      expect(parseMarketId(value)).toBeNull();
      expect(selectionsFor(value)).toBeNull();
    }
  });

  it("parses each id into its family and, for Asian handicap, the line token", () => {
    expect(parseMarketId("ONE_X_TWO")).toEqual({ family: "ONE_X_TWO" });
    expect(parseMarketId("EXACT_SCORE")).toEqual({ family: "EXACT_SCORE" });
    expect(parseMarketId("ASIAN_HANDICAP:-0.75")).toEqual({ family: "ASIAN_HANDICAP", line: "-0.75" });
    expect(parseMarketId("ASIAN_HANDICAP:0")).toEqual({ family: "ASIAN_HANDICAP", line: "0" });
    expect(marketFamilyOf("ASIAN_HANDICAP:+2.5")).toBe("ASIAN_HANDICAP");
    expect(marketFamilyOf("BTTS")).toBe("BTTS");
    expect(marketFamilyOf("nope")).toBeNull();
    expect(isCoreMarket("BTTS")).toBe(true);
    expect(isCoreMarket("EXACT_SCORE")).toBe(false);
    expect(isCoreMarket("ASIAN_HANDICAP:0")).toBe(false);
  });

  it("returns the selections of each market in registry order", () => {
    expect(selectionsFor("ONE_X_TWO")).toEqual(["HOME", "DRAW", "AWAY"]);
    expect(selectionsFor("OVER_UNDER_2_5")).toEqual(["OVER_2_5", "UNDER_2_5"]);
    expect(selectionsFor("BTTS")).toEqual(["YES", "NO"]);
    for (const line of AH_LINES_V1.lines) expect(selectionsFor(`ASIAN_HANDICAP:${line}`)).toEqual(["HOME", "AWAY"]);
    const exact = selectionsFor("EXACT_SCORE")!;
    expect(exact).toHaveLength(17);
    expect(exact.slice(0, 5)).toEqual(["0-0", "0-1", "0-2", "0-3", "1-0"]);
    expect(exact.at(-2)).toBe("3-3");
    expect(exact.at(-1)).toBe("OTHER");
    expect(exact).toEqual(EXACT_SCORE_BUCKETS_V1.selections);
  });

  it("pins the frozen three-market table byte for byte and re-exports it under the old name", () => {
    expect(JSON.stringify(MARKET_SELECTIONS)).toBe('{"ONE_X_TWO":["HOME","DRAW","AWAY"],"OVER_UNDER_2_5":["OVER_2_5","UNDER_2_5"],"BTTS":["YES","NO"]}');
    expect(MARKET_SELECTIONS).toBe(CORE_MARKET_SELECTIONS);
  });

  it("accepts only members of the exact score list", () => {
    expect(parseExactScoreSelection("2-1")).toEqual({ homeGoals: 2, awayGoals: 1 });
    expect(parseExactScoreSelection("OTHER")).toBe("OTHER");
    for (const value of ["4-0", "0-4", "01-1", "1:1", "other", "", null, 3]) expect(parseExactScoreSelection(value)).toBeNull();
  });
});

describe("odds books of the new markets", () => {
  const ahLine = "ASIAN_HANDICAP:-0.75";
  const exact = [...selectionsFor("EXACT_SCORE")!];

  it("accepts complete Asian handicap and exact score books", () => {
    expect(parseOddsBook(book(ahLine, ["HOME", "AWAY"])).market).toBe(ahLine);
    expect(parseOddsBook(book("EXACT_SCORE", exact, "9.5")).selections).toHaveLength(17);
  });

  it("keeps the old error codes", () => {
    expect(() => parseOddsBook(book("ASIAN_HANDICAP:-0.80", ["HOME", "AWAY"]))).toThrow("UNSUPPORTED_ODDS_MARKET");
    expect(() => parseOddsBook(book("ASIAN_HANDICAP:+1.00", ["HOME", "AWAY"]))).toThrow("UNSUPPORTED_ODDS_MARKET");
    expect(() => parseOddsBook(book(ahLine, ["HOME"]))).toThrow("INCOMPLETE_ODDS_BOOK");
    expect(() => parseOddsBook(book(ahLine, ["HOME", "DRAW"]))).toThrow("INCOMPLETE_ODDS_BOOK");
    expect(() => parseOddsBook(book(ahLine, ["HOME", "HOME"]))).toThrow("DUPLICATE_ODDS_SELECTION");
    expect(() => parseOddsBook(book("EXACT_SCORE", exact.slice(0, 16)))).toThrow("INCOMPLETE_ODDS_BOOK");
    expect(() => parseOddsBook(book("EXACT_SCORE", [...exact.slice(0, 16), "0-0"]))).toThrow("DUPLICATE_ODDS_SELECTION");
    expect(() => parseOddsBook(book("EXACT_SCORE", [...exact.slice(0, 16), "4-4"]))).toThrow("INCOMPLETE_ODDS_BOOK");
  });

  it("normalizes proportionally in registry order", () => {
    const ah = normalizeOddsBook(parseOddsBook({ ...book(ahLine, ["AWAY", "HOME"], "1.9"), selections: [{ selection: "AWAY", decimalOdds: "2.1" }, { selection: "HOME", decimalOdds: "1.8" }] }));
    expect(ah.selections.map((row) => row.selection)).toEqual(["HOME", "AWAY"]);
    expect(Math.abs(ah.selections.reduce((sum, row) => sum + Number(row.noVigProbability), 0) - 1)).toBeLessThanOrEqual(1e-12);
    const shuffled = [...exact].reverse();
    const odds = Object.fromEntries(exact.map((selection, index) => [selection, String(5 + index)]));
    const wide = normalizeOddsBook({ ...book("EXACT_SCORE", shuffled), selections: shuffled.map((selection) => ({ selection, decimalOdds: odds[selection]! })) } as never);
    expect(wide.selections.map((row) => row.selection)).toEqual(exact);
    expect(Math.abs(wide.selections.reduce((sum, row) => sum + Number(row.noVigProbability), 0) - 1)).toBeLessThanOrEqual(1e-12);
  });
});
