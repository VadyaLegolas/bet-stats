import { buildExtendedMarketsView, buildScoreMatrix, type ExtendedMarketsView, type ScoreMatrixCell } from "@bet-stats/domain";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AH_NO_VIG_NOTE, AH_OVERROUND_LABEL, ahComparisonRows, COMPARISON_BLOCKED_NOTE, exactScoreComparisonRows } from "./extended-comparison-model";

const cells: readonly ScoreMatrixCell[] = buildScoreMatrix({ expectedGoals: { home: 1.4, away: 1.2 } }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
const built: ExtendedMarketsView = buildExtendedMarketsView({ cells, source: "PERSISTED", tail: { retainedMass: 0.99998, tailMass: 0.00002, warning: false } });
if (built.state !== "AVAILABLE") throw new Error("expected AVAILABLE");
const view = built;

const odds = (market: "AH" | "EXACT") => ({
  selections: market === "AH"
    ? [{ selection: "HOME", decimalOdds: "1.95", impliedProbability: "0.5128205128", noVigProbability: "0.5" }, { selection: "AWAY", decimalOdds: "1.95", impliedProbability: "0.5128205128", noVigProbability: "0.5" }]
    : view.exactScore.cells.map((cell) => ({ selection: cell.selection as string, decimalOdds: "12.5", impliedProbability: "0.08", noVigProbability: "0.0625" })).concat([{ selection: "OTHER", decimalOdds: "3.5", impliedProbability: "0.2857", noVigProbability: "0.25" }]),
});

describe("ahComparisonRows", () => {
  it("builds the home and away rows of the chosen line from the view without arithmetic", () => {
    const rows = ahComparisonRows(view, "-0.75", odds("AH"));
    expect(rows.map((row) => row.key)).toEqual(["HOME", "AWAY"]);
    expect(rows.map((row) => row.label)).toEqual(["Хозяева −0.75", "Гости +0.75"]);
    const line = view.asianHandicap.lines.find((candidate) => candidate.homeLine === "-0.75")!;
    expect(rows[0]!.probability).toBe(`${(line.sides.HOME.effectiveWinProbability * 100).toFixed(1)}%`);
    expect(rows[0]!.refund).toBe(`${(line.sides.HOME.breakdown.PUSH * 100).toFixed(1)}%`);
    expect(rows[0]!.book).toBe("1.95");
    expect(rows[0]!.implied).toBe("51.3%");
    expect(rows[0]!.noVig).toBe("50.0%");
    expect(rows[0]!.fair).toMatch(/^\d+\.\d{2}$/);
  });

  it("returns nothing for a line outside the view and marks missing book odds as unavailable", () => {
    expect(ahComparisonRows(view, "9", odds("AH"))).toEqual([]);
    const rows = ahComparisonRows(view, "0", { selections: [] });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([row.book, row.implied, row.noVig]).toEqual(["Недоступно", "Недоступно", "Недоступно"]);
  });

  it("shows unavailable fair odds in words, never infinity", () => {
    const rows = ahComparisonRows(view, "+2.5", odds("AH"));
    const away = rows.find((row) => row.key === "AWAY")!;
    expect(away.fair === "Недоступно" || /^\d+\.\d{2}$/.test(away.fair)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Infinity|NaN/);
  });
});

describe("exactScoreComparisonRows", () => {
  it("builds 17 rows in registry order with book odds by selection", () => {
    const rows = exactScoreComparisonRows(view, odds("EXACT"));
    expect(rows).toHaveLength(17);
    expect(rows[0]!.label).toBe("Счёт 0:0");
    expect(rows[1]!.label).toBe("Счёт 0:1");
    expect(rows[15]!.label).toBe("Счёт 3:3");
    expect(rows[16]!.label).toBe("Любой другой счёт");
    expect(rows[16]!.book).toBe("3.50");
    expect(rows[0]!.refund).toBeNull();
  });
});

describe("copy and arithmetic guard", () => {
  it("pins the contract strings", () => {
    expect(AH_OVERROUND_LABEL).toBe("Перекрытие (приближённо)");
    expect(AH_NO_VIG_NOTE).toContain("пропорциональным приближением");
    expect(COMPARISON_BLOCKED_NOTE).toBe("Сравнение недоступно: для этого прогноза расширенные рынки недоступны. Выберите другой снимок прогноза.");
  });

  it("does not multiply probabilities by odds or sum them in the module source", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "extended-comparison-model.ts"), "utf8");
    expect(source).not.toMatch(/\.reduce\(|Math\.(abs|min|max)|probability\s*\*|\*\s*(odds|decimalOdds)/);
    expect(source).not.toContain("forecast-workbench");
  });
});
