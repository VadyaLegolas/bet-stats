import { buildExtendedMarketsView, buildScoreMatrix, type AhLineToken, type ExtendedMarketsView, type ScoreMatrixCell } from "@bet-stats/domain";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ahRowModel,
  ahWindow,
  ahSummaryModel,
  exactGridModel,
  expanderLabel,
  expanderStatus,
  isStructuralZero,
  normaliseExtendedMarkets,
  tailLine,
  windowCaption,
} from "./extended-markets-model";

function gridCells(home: number, away: number): readonly ScoreMatrixCell[] {
  return buildScoreMatrix({ expectedGoals: { home, away } }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
}

const TAIL = { retainedMass: 0.99998, tailMass: 0.00002, warning: false };

function availableView(home = 1.4, away = 1.2): Extract<ExtendedMarketsView, { state: "AVAILABLE" }> {
  const view = buildExtendedMarketsView({ cells: gridCells(home, away), source: "PERSISTED", tail: TAIL });
  if (view.state !== "AVAILABLE") throw new Error("expected AVAILABLE");
  return view;
}

const view = availableView();
const lines = view.asianHandicap.lines;
const labelsOf = (rows: readonly { homeLine: string }[]) => rows.map((row) => row.homeLine);

describe("ahWindow", () => {
  it("shows exactly five consecutive rows centred on the main line", () => {
    const window = ahWindow(lines, "0", "HOME", false);
    expect(labelsOf(window)).toEqual(["-0.5", "-0.25", "0", "+0.25", "+0.5"]);
  });

  it("shifts at the edges so exactly five rows are always shown", () => {
    expect(labelsOf(ahWindow(lines, "-2.5", "HOME", false))).toEqual(["-2.5", "-2.25", "-2", "-1.75", "-1.5"]);
    expect(labelsOf(ahWindow(lines, "-2.25", "HOME", false))).toEqual(["-2.5", "-2.25", "-2", "-1.75", "-1.5"]);
    expect(labelsOf(ahWindow(lines, "+2.5", "HOME", false))).toEqual(["+1.5", "+1.75", "+2", "+2.25", "+2.5"]);
    expect(labelsOf(ahWindow(lines, "+2.25", "HOME", false))).toEqual(["+1.5", "+1.75", "+2", "+2.25", "+2.5"]);
    for (const main of ["-2.5", "0", "+2.5"] as const) expect(ahWindow(lines, main, "HOME", false)).toHaveLength(5);
  });

  it("returns all 21 rows when expanded", () => {
    expect(ahWindow(lines, "0", "HOME", true)).toHaveLength(21);
    expect(ahWindow(lines, "0", "AWAY", true)).toHaveLength(21);
  });

  it("orders the away view ascending by the away side's own line and keeps the same main-line row in the window", () => {
    const expanded = ahWindow(lines, "-0.75", "AWAY", true);
    expect(expanded.map((row) => row.awayLine)).toEqual(["-2.5", "-2.25", "-2", "-1.75", "-1.5", "-1.25", "-1", "-0.75", "-0.5", "-0.25", "0", "+0.25", "+0.5", "+0.75", "+1", "+1.25", "+1.5", "+1.75", "+2", "+2.25", "+2.5"]);
    const home = ahWindow(lines, "-0.75", "HOME", false);
    const away = ahWindow(lines, "-0.75", "AWAY", false);
    expect(home.some((row) => row.homeLine === "-0.75")).toBe(true);
    expect(away.some((row) => row.homeLine === "-0.75")).toBe(true);
    expect(away).toHaveLength(5);
  });

  it("clamps in the away view too: main home line -2.5 sits at the end of the away order", () => {
    const window = ahWindow(lines, "-2.5", "AWAY", false);
    expect(window.map((row) => row.awayLine)).toEqual(["+1.5", "+1.75", "+2", "+2.25", "+2.5"]);
    expect(window.at(-1)!.homeLine).toBe("-2.5");
  });
});

describe("window and expander captions", () => {
  it("names the current mode in the caption, the button and the status line", () => {
    expect(windowCaption(false)).toBe("Показаны 5 линий из 21 вокруг главной.");
    expect(windowCaption(true)).toBe("Показаны все 21 линия.");
    expect(expanderLabel(false)).toBe("Показать все 21 линию");
    expect(expanderLabel(true)).toBe("Показать только 5 линий вокруг главной");
    expect(expanderStatus(false)).toBe("Показаны 5 линий вокруг главной");
    expect(expanderStatus(true)).toBe("Показаны все 21 линия");
  });
});

describe("ahRowModel", () => {
  const row = (home: AhLineToken) => lines.find((candidate) => candidate.homeLine === home)!;

  it("labels the home view with the home line and no hint, and the away view with the away line plus a home hint", () => {
    const home = ahRowModel(row("-0.75"), "HOME", "-0.75");
    expect(home.key).toBe("-0.75");
    expect(home.label).toBe("Хозяева −0.75");
    expect(home.homeHint).toBeNull();
    const away = ahRowModel(row("-0.75"), "AWAY", "-0.75");
    expect(away.key).toBe("-0.75");
    expect(away.label).toBe("Гости +0.75");
    expect(away.homeHint).toBe("(Хозяева −0.75)");
  });

  it("marks exactly the main line", () => {
    const flags = lines.map((line) => ahRowModel(line, "HOME", "-0.25").isMain);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(ahRowModel(row("-0.25"), "HOME", "-0.25").isMain).toBe(true);
  });

  it("adds sub-lines for quarter and level lines only", () => {
    expect(ahRowModel(row("-0.75"), "HOME", "0").sub).toBe("ставка делится между −0.5 и −1");
    expect(ahRowModel(row("-0.75"), "AWAY", "0").sub).toBe("ставка делится между +0.5 и +1");
    expect(ahRowModel(row("0"), "HOME", "0").sub).toBe("возврат при ничьей");
    expect(ahRowModel(row("-1"), "HOME", "0").sub).toBeNull();
    expect(ahRowModel(row("-1.5"), "HOME", "0").sub).toBeNull();
  });

  it("renders structural zeros as a dash with an sr-only explanation and real zeros as 0.0%", () => {
    const whole = ahRowModel(row("-1"), "HOME", "0");
    const byResult = (model: typeof whole, result: string) => model.outcomes.find((outcome) => outcome.result === result)!;
    for (const result of ["HALF_WIN", "HALF_LOSS"]) {
      expect(byResult(whole, result)).toMatchObject({ text: "—", structural: true, srText: "такого исхода на этой линии не бывает" });
    }
    expect(byResult(whole, "PUSH").structural).toBe(false);
    const half = ahRowModel(row("-1.5"), "HOME", "0");
    for (const result of ["HALF_WIN", "PUSH", "HALF_LOSS"]) expect(byResult(half, result).structural).toBe(true);
    const quarter = ahRowModel(row("-0.75"), "HOME", "0");
    expect(byResult(quarter, "PUSH").structural).toBe(true);
    expect(byResult(quarter, "HALF_WIN").structural).toBe(false);
    expect(byResult(quarter, "WIN").text).toMatch(/^\d+\.\d%$/);
  });

  it("orders the five outcomes WIN, HALF_WIN, PUSH, HALF_LOSS, LOSS", () => {
    expect(ahRowModel(row("0"), "HOME", "0").outcomes.map((outcome) => outcome.result)).toEqual(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]);
  });

  it("reads the displayed side's figures from the DTO as is and formats the effective probability and fair odds", () => {
    const line = row("-0.75");
    const model = ahRowModel(line, "HOME", "0");
    expect(model.effective).toBe(`${(line.sides.HOME.effectiveWinProbability * 100).toFixed(1)}%`);
    expect(model.fair).toEqual({ available: true, text: Number((line.sides.HOME.fairOdds as { odds: string }).odds).toFixed(2), reason: null });
    const away = ahRowModel(line, "AWAY", "0");
    expect(away.effective).toBe(`${(line.sides.AWAY.effectiveWinProbability * 100).toFixed(1)}%`);
  });

  it("shows unavailable fair odds as the word plus the typed reason, never as a number", () => {
    const base = row("-2.5");
    const hopeless = { ...base, sides: { ...base.sides, HOME: { ...base.sides.HOME, fairOdds: { status: "UNAVAILABLE", reason: "NO_WIN_PROBABILITY" } as const } } };
    expect(ahRowModel(hopeless, "HOME", "0").fair).toEqual({ available: false, text: "Недоступно", reason: "вероятность выигрыша равна нулю" });
  });
});

describe("isStructuralZero", () => {
  it("encodes which outcomes cannot occur on each line class", () => {
    expect(isStructuralZero("WHOLE", "HALF_WIN")).toBe(true);
    expect(isStructuralZero("WHOLE", "HALF_LOSS")).toBe(true);
    expect(isStructuralZero("WHOLE", "PUSH")).toBe(false);
    expect(isStructuralZero("HALF", "PUSH")).toBe(true);
    expect(isStructuralZero("HALF", "HALF_WIN")).toBe(true);
    expect(isStructuralZero("QUARTER", "PUSH")).toBe(true);
    expect(isStructuralZero("QUARTER", "HALF_LOSS")).toBe(false);
    for (const lineClass of ["WHOLE", "HALF", "QUARTER"] as const) {
      expect(isStructuralZero(lineClass, "WIN")).toBe(false);
      expect(isStructuralZero(lineClass, "LOSS")).toBe(false);
    }
  });
});

describe("ahSummaryModel", () => {
  it("states the main line and both fair odds of the main line", () => {
    const summary = ahSummaryModel(lines, "-0.75");
    expect(summary.mainLabel).toBe("Хозяева −0.75 / Гости +0.75");
    const line = lines.find((candidate) => candidate.homeLine === "-0.75")!;
    expect(summary.home.text).toBe(Number((line.sides.HOME.fairOdds as { odds: string }).odds).toFixed(2));
    expect(summary.away.text).toBe(Number((line.sides.AWAY.fairOdds as { odds: string }).odds).toFixed(2));
  });
});

describe("exactGridModel", () => {
  const grid = exactGridModel(view.exactScore);

  it("lays out 16 cells in the order 0-0 to 3-3 plus the OTHER row", () => {
    expect(grid.rows).toHaveLength(4);
    const cells = grid.rows.flatMap((row) => row.cells);
    expect(cells).toHaveLength(16);
    expect(cells.map((cell) => cell.selection)).toEqual(Array.from({ length: 16 }, (_, index) => `${Math.floor(index / 4)}-${index % 4}`));
    expect(grid.rows.map((row) => row.homeGoals)).toEqual([0, 1, 2, 3]);
    expect(grid.other.selection).toBe("OTHER");
  });

  it("gives each cell screen-reader prefixes and a visible odds string", () => {
    const cell = grid.rows[2]!.cells[1]!;
    expect(cell.srScore).toBe("Счёт 2:1. ");
    expect(cell.srOdds).toBe("Справедливый коэффициент: ");
    expect(cell.probability).toMatch(/^\d+\.\d%$/);
    expect(cell.odds.available).toBe(true);
    expect(cell.oddsPrefix).toBe("коэф. ");
    expect(cell.odds.text).toMatch(/^\d+\.\d{2}$/);
    expect(grid.other.srScore).toBe("Любой другой счёт. ");
    expect(grid.columns).toEqual([0, 1, 2, 3]);
  });

  it("shows zero probability as the word plus the typed reason", () => {
    const zero = { ...view.exactScore, cells: view.exactScore.cells.map((cell, index) => index === 0 ? { ...cell, probability: 0, fairOdds: { status: "UNAVAILABLE", reason: "ZERO_PROBABILITY" } as const } : cell) };
    const cell = exactGridModel(zero).rows[0]!.cells[0]!;
    expect(cell.odds).toEqual({ available: false, text: "Недоступно", reason: "вероятность счёта равна нулю" });
    expect(cell.probability).toBe("0.0%");
  });
});

describe("tailLine", () => {
  it("uses the corrected Pitfall 9 wording", () => {
    expect(tailLine(0.00002)).toBe("Хвост матрицы вне 0–7 голов: 0.0% — уже учтён нормировкой на сохранённую массу и распределён по всем счетам.");
    expect(tailLine(0.0123)).toContain("1.2%");
  });
});

describe("normaliseExtendedMarkets (closed classification, T-14-12)", () => {
  const unrecognised = { state: "UNAVAILABLE", reason: "UNRECOGNISED" };

  it("passes a valid AVAILABLE view and a legacy UNAVAILABLE view through unchanged", () => {
    expect(normaliseExtendedMarkets(JSON.parse(JSON.stringify(view)))).toEqual(view);
    const legacy = { version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" };
    expect(normaliseExtendedMarkets(legacy)).toEqual(legacy);
  });

  it("keeps the transport failure and the already-closed marker as they are", () => {
    expect(normaliseExtendedMarkets({ state: "READ_FAILED" })).toEqual({ state: "READ_FAILED" });
    expect(normaliseExtendedMarkets(unrecognised)).toEqual(unrecognised);
  });

  it("fails closed on an unknown reason code, a corrupted view and non-objects", () => {
    expect(normaliseExtendedMarkets({ version: "extended-markets-view-v1", state: "UNAVAILABLE", reason: "SOMETHING_NEW" })).toEqual(unrecognised);
    const corrupted = JSON.parse(JSON.stringify(view));
    corrupted.asianHandicap.lines.pop();
    expect(normaliseExtendedMarkets(corrupted)).toEqual(unrecognised);
    for (const value of [null, undefined, 42, "AVAILABLE", [], {}, { state: "READ_FAILED", extra: true }]) expect(normaliseExtendedMarkets(value)).toEqual(unrecognised);
  });
});

describe("model purity", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "extended-markets-model.ts"), "utf8");
  it("never imports the workbench page module (T-10-06) and carries no client directive", () => {
    expect(source).not.toMatch(/forecast-workbench/);
    expect(source).not.toMatch(/["']use client["']/);
  });
  it("does no probability arithmetic: no sums, products or quotients of DTO figures", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.reduce\(/);
    expect(code).not.toMatch(/Math\.(?:abs|min|max|pow|log|exp)\(/);
    expect(code).not.toMatch(/probability\s*[*/+-]|[*/+-]\s*probability/);
  });
});
