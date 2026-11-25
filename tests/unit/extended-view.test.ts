import { describe, expect, it } from "vitest";

import { buildAhView } from "../../packages/domain/src/markets/asian-handicap.js";
import {
  buildExtendedMarketsView,
  EXTENDED_MARKETS_VIEW_VERSION,
  parseExtendedMarketsView,
  unavailableExtendedMarketsView,
  type ExtendedMarketsView,
} from "../../packages/domain/src/markets/extended-view.js";
import { buildScoreMatrix, type ScoreMatrixCell } from "../../packages/domain/src/markets/score-matrix.js";

function gridCells(home: number, away: number, rho?: number): readonly ScoreMatrixCell[] {
  return buildScoreMatrix({ expectedGoals: { home, away }, rho }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
}

const tail = { retainedMass: 0.99998, tailMass: 0.00002, warning: false };

function available(): ExtendedMarketsView {
  return buildExtendedMarketsView({ cells: gridCells(1.4, 1.2), source: "PERSISTED", tail });
}

/** A deep, JSON-shaped copy the tests can corrupt freely. */
function copy(): Record<string, any> {
  return JSON.parse(JSON.stringify(available()));
}

describe("ExtendedMarketsView (D-04)", () => {
  it("builds a typed AVAILABLE view with versions, rules and the derived markets", () => {
    const view = available();
    expect(view.state).toBe("AVAILABLE");
    if (view.state !== "AVAILABLE") return;
    expect(view.version).toBe(EXTENDED_MARKETS_VIEW_VERSION);
    expect(EXTENDED_MARKETS_VIEW_VERSION).toBe("extended-markets-view-v1");
    expect(view.source).toBe("PERSISTED");
    expect(view.rules).toEqual({ ahLines: "ah-lines-v1", ahSettlement: "ah-settlement-v1", exactScoreBuckets: "exact-score-buckets-v1", scoreMatrix: "score-matrix-v1" });
    expect(view.calibration).toBe("NONE");
    expect(view.tail).toEqual(tail);
    expect(view.asianHandicap.lines).toHaveLength(21);
    expect(view.asianHandicap.lines.map((line) => line.homeLine)).toContain(view.asianHandicap.mainLine);
    expect(view.exactScore.cells).toHaveLength(16);
    expect(view.exactScore.other.selection).toBe("OTHER");
    expect(view.asianHandicap.lines).toEqual(buildAhView(gridCells(1.4, 1.2)));
  });

  it("builds the unavailable view with only the typed state", () => {
    expect(unavailableExtendedMarketsView()).toEqual({ version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" });
  });

  it("parses both states and survives a JSON round trip", () => {
    for (const source of ["PERSISTED", "REDERIVED"] as const) {
      const view = buildExtendedMarketsView({ cells: gridCells(2.1, 0.7, -0.08), source, tail });
      expect(parseExtendedMarketsView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    }
    expect(parseExtendedMarketsView(unavailableExtendedMarketsView())).toEqual(unavailableExtendedMarketsView());
  });

  it.each([null, undefined, 3, "AVAILABLE", [], {}])("rejects the non-view value %j", (value) => {
    expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects extra keys anywhere", () => {
    const top = copy(); top.extra = 1;
    const rules = copy(); rules.rules.extra = "x";
    const tailKey = copy(); tailKey.tail.extra = 1;
    const ah = copy(); ah.asianHandicap.extra = 1;
    const line = copy(); line.asianHandicap.lines[3].extra = 1;
    const side = copy(); side.asianHandicap.lines[3].sides.HOME.extra = 1;
    const breakdown = copy(); breakdown.asianHandicap.lines[3].sides.HOME.breakdown.extra = 0;
    const exact = copy(); exact.exactScore.extra = 1;
    const cell = copy(); cell.exactScore.cells[0].extra = 1;
    const other = copy(); other.exactScore.other.extra = 1;
    const unavailable: Record<string, unknown> = { ...unavailableExtendedMarketsView(), extra: 1 };
    for (const value of [top, rules, tailKey, ah, line, side, breakdown, exact, cell, other, unavailable]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects 20 lines, 22 lines, 15 cells and 17 cells", () => {
    const short = copy(); short.asianHandicap.lines.pop();
    const long = copy(); long.asianHandicap.lines.push(long.asianHandicap.lines[0]);
    const fewCells = copy(); fewCells.exactScore.cells.pop();
    const manyCells = copy(); manyCells.exactScore.cells.push(manyCells.exactScore.cells[0]);
    for (const value of [short, long, fewCells, manyCells]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects tokens outside the whitelist, reordered lines and a wrong class", () => {
    const token = copy(); token.asianHandicap.lines[2].homeLine = "-2.00";
    const swapped = copy(); [swapped.asianHandicap.lines[0], swapped.asianHandicap.lines[1]] = [swapped.asianHandicap.lines[1], swapped.asianHandicap.lines[0]];
    const away = copy(); away.asianHandicap.lines[2].awayLine = "+2.5";
    const lineClass = copy(); lineClass.asianHandicap.lines[2].lineClass = "HALF";
    const mainLine = copy(); mainLine.asianHandicap.mainLine = "+0.0";
    const split = copy(); split.asianHandicap.lines[7].sides.HOME.splitLines = ["-0.5"];
    const cellId = copy(); cellId.exactScore.cells[0].selection = "4-0";
    for (const value of [token, swapped, away, lineClass, mainLine, split, cellId]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects probabilities outside [0, 1] and non-finite numbers", () => {
    const high = copy(); high.exactScore.cells[1].probability = 1.2;
    const negative = copy(); negative.exactScore.other.probability = -0.1;
    const nan = copy(); nan.asianHandicap.lines[0].sides.HOME.breakdown.WIN = null;
    const outcome = copy(); outcome.asianHandicap.lines[0].sides.AWAY.breakdown.LOSS = 2;
    const tailHigh = copy(); tailHigh.tail.retainedMass = 1.5;
    const tailType = copy(); tailType.tail.warning = "no";
    for (const value of [high, negative, nan, outcome, tailHigh, tailType]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects sums outside the tolerance", () => {
    const cells = copy(); cells.exactScore.cells[0].probability += 0.01;
    const outcomes = copy(); outcomes.asianHandicap.lines[5].sides.HOME.breakdown.PUSH += 0.01;
    for (const value of [cells, outcomes]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects inconsistent fair odds and wrong rule versions", () => {
    const missing = copy(); missing.exactScore.cells[0].fairOdds = { status: "UNAVAILABLE", reason: "ZERO_PROBABILITY" };
    const odds = copy(); odds.exactScore.cells[0].fairOdds = { status: "AVAILABLE", odds: "NaN" };
    const reason = copy(); reason.asianHandicap.lines[0].sides.HOME.fairOdds = { status: "UNAVAILABLE", reason: "SOMETHING" };
    const version = copy(); version.rules.ahSettlement = "ah-settlement-v2";
    const viewVersion = copy(); viewVersion.version = "extended-markets-view-v0";
    const source = copy(); source.source = "CACHED";
    const calibration = copy(); calibration.calibration = "ISOTONIC";
    const state = copy(); state.state = "PARTIAL";
    for (const value of [missing, odds, reason, version, viewVersion, source, calibration, state]) expect(() => parseExtendedMarketsView(value)).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });

  it("rejects an unavailable view with a foreign reason", () => {
    expect(() => parseExtendedMarketsView({ version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "INVALID_SCORE_MATRIX" })).toThrow("INVALID_EXTENDED_MARKETS_VIEW");
  });
});
