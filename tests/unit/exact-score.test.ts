import { describe, expect, it } from "vitest";

import { FORECAST_CONFIG } from "../../packages/domain/src/forecast/config.js";
import { EXACT_SCORE_BUCKETS_V1, EXACT_SCORE_DECIMAL_PRECISION, exactScoreView } from "../../packages/domain/src/markets/exact-score.js";
import { buildScoreMatrix, type ScoreMatrixCell } from "../../packages/domain/src/markets/score-matrix.js";

function gridCells(home: number, away: number, rho?: number): readonly ScoreMatrixCell[] {
  return buildScoreMatrix({ expectedGoals: { home, away }, rho }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
}

const LAMBDAS = [0.2, 0.6, 1.1, 1.4, 2.3, 3, 4];

describe("exact score view (D-09)", () => {
  it("pins the bucket config and keeps its precision equal to the forecast config", () => {
    expect(EXACT_SCORE_BUCKETS_V1.version).toBe("exact-score-buckets-v1");
    expect(EXACT_SCORE_BUCKETS_V1.maxGoals).toBe(3);
    expect(EXACT_SCORE_DECIMAL_PRECISION).toBe(FORECAST_CONFIG.decimalPrecision);
  });

  it("returns 16 explicit scores in registry order and the OTHER bucket", () => {
    const view = exactScoreView(gridCells(1.4, 1.2));
    expect(view.cells).toHaveLength(16);
    expect(view.cells.map((cell) => cell.selection)).toEqual(EXACT_SCORE_BUCKETS_V1.selections.slice(0, 16));
    expect(view.cells[0]).toMatchObject({ selection: "0-0", homeGoals: 0, awayGoals: 0 });
    expect(view.cells[6]).toMatchObject({ selection: "1-2", homeGoals: 1, awayGoals: 2 });
    expect(view.other.selection).toBe("OTHER");
  });

  it("reads each cell straight from the grid", () => {
    const matrix = gridCells(1.4, 1.2);
    const view = exactScoreView(matrix);
    for (const cell of view.cells) expect(cell.probability).toBe(matrix.find(([h, a]) => h === cell.homeGoals && a === cell.awayGoals)![2]);
  });

  it("sums the 17 probabilities to one within 1e-12 for lambda in [0.2, 4], poisson and dixon-coles; OTHER is not negative", () => {
    for (const home of LAMBDAS) for (const away of LAMBDAS) for (const rho of [undefined, -0.08, 0.05]) {
      const view = exactScoreView(gridCells(home, away, rho));
      const total = view.cells.reduce((sum, cell) => sum + cell.probability, 0) + view.other.probability;
      expect(Math.abs(total - 1)).toBeLessThanOrEqual(1e-12);
      expect(view.other.probability).toBeGreaterThanOrEqual(0);
      for (const cell of view.cells) expect(cell.probability).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives the fair odds 1 / p as a decimal string", () => {
    const view = exactScoreView(gridCells(1.4, 1.2));
    for (const cell of view.cells) {
      expect(cell.fairOdds.status).toBe("AVAILABLE");
      if (cell.fairOdds.status === "AVAILABLE") expect(Number(cell.fairOdds.odds)).toBeCloseTo(1 / cell.probability, 8);
    }
    expect(view.other.fairOdds.status).toBe("AVAILABLE");
  });

  it("reports ZERO_PROBABILITY instead of Infinity or NaN", () => {
    const zero = gridCells(1.4, 1.2).map(([h, a, p]) => [h, a, h === 2 && a === 1 ? 0 : p] as const);
    const view = exactScoreView(zero);
    expect(view.cells.find((cell) => cell.selection === "2-1")!.fairOdds).toEqual({ status: "UNAVAILABLE", reason: "ZERO_PROBABILITY" });
    // a grid holding all its mass inside 0..3 leaves OTHER at exactly zero
    const forced = exactScoreView(gridCells(1.4, 1.2).map(([h, a]) => [h, a, h <= 3 && a <= 3 ? 1 / 16 : 0] as const));
    expect(forced.other.probability).toBe(0);
    expect(forced.other.fairOdds).toEqual({ status: "UNAVAILABLE", reason: "ZERO_PROBABILITY" });
    for (const cell of [...view.cells, view.other]) if (cell.fairOdds.status === "AVAILABLE") expect(Number.isFinite(Number(cell.fairOdds.odds))).toBe(true);
  });

  it("rejects an incomplete grid", () => {
    expect(() => exactScoreView(gridCells(1.4, 1.2).slice(1))).toThrow("INVALID_SCORE_MATRIX");
  });
});
