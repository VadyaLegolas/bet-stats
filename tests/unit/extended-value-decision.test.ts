import { Decimal } from "../../packages/domain/node_modules/decimal.js/decimal.mjs";
import { describe, expect, it } from "vitest";

import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";
import { createForecast, type ForecastDraft } from "../../packages/domain/src/forecast/model.js";
import { AH_RESULTS, ahBreakdown, type AhResult } from "../../packages/domain/src/markets/asian-handicap.js";
import { buildScoreMatrixV1, type ScoreMatrixCell } from "../../packages/domain/src/markets/score-matrix.js";
import { normalizeOddsBook } from "../../packages/domain/src/odds/normalize.js";
import { decideValue, VALUE_POLICY } from "../../packages/domain/src/value/decision.js";
import { decideExtendedValue, PUSH_AWARE_EV_POLICY_VERSION, type ExtendedValueMatrix } from "../../packages/domain/src/value/extended-decision.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(teamId: string): EvidenceProjectionDto {
  const source = { observationId: `${teamId}-obs`, provider: "API_FOOTBALL", providerFixtureId: `${teamId}-ext`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${teamId}`, payloadBytes: 10 };
  const c = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return { teamId, requestedAsOf: cutoff, resolvedAsOfUtc: cutoff, cutoffBoundary: { observedAt: cutoff }, state: "COMPLETE", freshness: "FRESH", buildId: `build-${teamId}`, publishedAt: cutoff, receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] }, coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, components: { form5: c("form5", 1.8, 5), form10: c("form10", 1.7), elo: c("elo", teamId === "home" ? 1560 : 1480), homeStrength: c("homeStrength", 1.7), awayStrength: c("awayStrength", 1.2), goalRates: c("goalRates", { for: 1.5, against: 1.1 }), restDays: c("restDays", 5, 1), h2h: c("h2h", { pointsPerMatch: 1.5, weight: 0.03 }, 4) } };
}

const base: ForecastDraft = createForecast({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: true, sourceReliability: 1 });
const forecast: ForecastDraft = { ...base, confidence: { ...base.confidence, score: 1 } };
const stored = buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass);
const matrix: ExtendedValueMatrix = { cells: stored.cells, source: "PERSISTED", cellsHash: stored.cellsHash };

function book(market: string, selections: readonly [string, string][], fixtureId = "fixture-1") {
  return normalizeOddsBook({ fixtureId, oddsSnapshotId: "odds-1", market: market as never, sourceLabel: "book", capturedAt: cutoff, selections: selections.map(([selection, decimalOdds]) => ({ selection: selection as never, decimalOdds })) });
}

const D = Decimal.clone({ precision: 60 });

/** Independent probabilities of the margin classes of the stored grid, without the settlement function. */
function marginMass(predicate: (margin: number) => boolean): number {
  return stored.cells.reduce((sum, [home, away, probability]) => (predicate(home - away) ? sum + probability : sum), 0);
}

describe("decideExtendedValue: Asian handicap push-aware EV (D-13, MKT-03)", () => {
  it.each([["1.8", "2.1"], ["2.4", "1.6"], ["3.05", "1.4"]])("EV on line -0.75 HOME at quote %s equals the hand-computed formula", (homeOdds, awayOdds) => {
    const odds = book("ASIAN_HANDICAP:-0.75", [["HOME", homeOdds], ["AWAY", awayOdds]]);
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.75", selection: "HOME", forecast, matrix, odds });
    // Line -0.75 for HOME: margin >= 2 wins, margin 1 is a half win, margin <= 0 loses (no push, no half loss).
    const win = new D(marginMass((margin) => margin >= 2));
    const halfWin = new D(marginMass((margin) => margin === 1));
    const loss = new D(marginMass((margin) => margin <= 0));
    const o = new D(homeOdds);
    const expected = win.times(o.minus(1)).plus(halfWin.times(o.minus(1)).div(2)).minus(loss);
    expect(new D(result.expectedValue).minus(expected).abs().lt("1e-15")).toBe(true);
    const block = result.receipt.extended;
    if (block.kind !== "ASIAN_HANDICAP") throw new Error("expected an Asian handicap block");
    expect(result.modelProbability).toBe(block.effectiveWinProbability);
  });

  it("also matches the formula with a push and a half loss on line +0.25 AWAY", () => {
    const odds = book("ASIAN_HANDICAP:+0.25", [["HOME", "1.9"], ["AWAY", "1.95"]]);
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:+0.25", selection: "AWAY", forecast, matrix, odds });
    // AWAY on a home +0.25 line has the away line -0.25: away margin >= 1 wins, a draw is a half loss, otherwise a loss.
    const win = new D(marginMass((margin) => margin <= -1));
    const halfLoss = new D(marginMass((margin) => margin === 0));
    const loss = new D(marginMass((margin) => margin >= 1));
    const o = new D("1.95");
    const expected = win.times(o.minus(1)).minus(halfLoss.div(2)).minus(loss);
    expect(new D(result.expectedValue).minus(expected).abs().lt("1e-15")).toBe(true);
  });

  it("is near zero on the level line at the model-fair price (edge is conditional, not minus 0.10)", () => {
    const breakdown = ahBreakdown(matrix.cells, "0", "HOME");
    const win = new D(breakdown.WIN);
    const loss = new D(breakdown.LOSS);
    const homeOdds = new D(1).plus(loss.div(win)).toFixed(20);
    const awayOdds = new D(1).plus(win.div(loss)).toFixed(20);
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:0", selection: "HOME", forecast, matrix, odds: book("ASIAN_HANDICAP:0", [["HOME", homeOdds], ["AWAY", awayOdds]]) });
    expect(Math.abs(Number(result.expectedValue))).toBeLessThan(1e-9);
    expect(Math.abs(Number(result.edge))).toBeLessThan(1e-9);
    // A plain probability minus no-vig would be far below zero here because the refunded stake is ignored.
    expect(new D(breakdown.WIN).minus(new D(1).div(homeOdds)).lt("-0.05")).toBe(true);
  });

  it("keeps the gates, their order and the thresholds of decideValue", () => {
    const extended = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.5", selection: "HOME", forecast, matrix, odds: book("ASIAN_HANDICAP:-0.5", [["HOME", "2"], ["AWAY", "2"]]) });
    const core = decideValue({ forecast, odds: book("BTTS", [["YES", "2"], ["NO", "2"]]), selection: "YES" });
    expect(extended.receipt.gates.map(({ gate }) => gate)).toEqual(core.receipt.gates.map(({ gate }) => gate));
    expect(extended.receipt.gates.map(({ gate }) => gate)).toEqual(["POLICY", "CANONICAL", "CUTOFF", "DATA_QUALITY", "CONFIDENCE", "EDGE", "EXPECTED_VALUE"]);
    expect(extended.receipt.thresholds).toBe(VALUE_POLICY.thresholds);
    expect(extended.receipt.valuePolicyVersion).toBe(VALUE_POLICY.version);
  });

  it("fails the POLICY gate for forecast-config-v2 forecasts (inherited behaviour, assumption A7)", () => {
    const v2 = { ...forecast, configVersion: "forecast-config-v2" } as unknown as ForecastDraft;
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.5", selection: "HOME", forecast: v2, matrix, odds: book("ASIAN_HANDICAP:-0.5", [["HOME", "2"], ["AWAY", "2"]]) });
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons[0]).toBe("POLICY_CONFIG_MISMATCH");
    expect(result.receipt.gates[0]).toEqual({ gate: "POLICY", passed: false });
    expect(VALUE_POLICY.forecastConfigVersion).toBe("forecast-config-v1");
  });

  it("records five outcomes, the policy label, the edge definition and the matrix source in the receipt", () => {
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.75", selection: "HOME", forecast, matrix, odds: book("ASIAN_HANDICAP:-0.75", [["HOME", "1.95"], ["AWAY", "1.95"]]) });
    const block = result.receipt.extended;
    if (block.kind !== "ASIAN_HANDICAP") throw new Error("expected an Asian handicap block");
    expect(block).toMatchObject({
      evPolicyVersion: "push-aware-ev-v1",
      ahLinesVersion: "ah-lines-v1",
      ahSettlementVersion: "ah-settlement-v1",
      line: "-0.75",
      side: "HOME",
      edgeDefinition: "conditional-win-probability-minus-no-vig",
      fairOddsUnavailableReason: null,
      matrix: { version: "score-matrix-v1", source: "PERSISTED", cellsHash: stored.cellsHash },
    });
    expect(PUSH_AWARE_EV_POLICY_VERSION).toBe("push-aware-ev-v1");
    expect(Object.keys(block.breakdown)).toEqual([...AH_RESULTS]);
    expect(block.evOutcomes).toHaveLength(5);
    expect(result.fairOdds).not.toBeNull();
    const { effectiveWinProbability, effectiveLoseProbability, conditionalWinProbability } = block;
    expect(new D(conditionalWinProbability).minus(new D(effectiveWinProbability).div(new D(effectiveWinProbability).plus(effectiveLoseProbability))).abs().lt("1e-30")).toBe(true);
  });

  it("has a null fair price with NO_WIN_PROBABILITY when the stake cannot win", () => {
    const cells: ScoreMatrixCell[] = [[0, 0, 1]];
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-2.5", selection: "HOME", forecast, matrix: { cells, source: "REDERIVED", cellsHash: null }, odds: book("ASIAN_HANDICAP:-2.5", [["HOME", "2"], ["AWAY", "2"]]) });
    expect(result.fairOdds).toBeNull();
    expect(result.receipt.extended).toMatchObject({ kind: "ASIAN_HANDICAP", fairOddsUnavailableReason: "NO_WIN_PROBABILITY", effectiveWinProbability: "0", matrix: { source: "REDERIVED", cellsHash: null } });
    expect(result.modelProbability).toBe("0");
  });

  it("lists evOutcomes in the fixed order with the per-unit returns and contributions that add up to the EV", () => {
    for (const odds of ["1.85", "2.4"]) {
      const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.25", selection: "HOME", forecast, matrix, odds: book("ASIAN_HANDICAP:-0.25", [["HOME", odds], ["AWAY", "2"]]) });
      const block = result.receipt.extended;
      if (block.kind !== "ASIAN_HANDICAP") throw new Error("expected an Asian handicap block");
      const order: AhResult[] = ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"];
      expect(block.evOutcomes.map(({ result: r }) => r)).toEqual(order);
      const o = new D(odds);
      expect(block.evOutcomes.map(({ returnPerUnit }) => new D(returnPerUnit).toString())).toEqual([o.minus(1), o.minus(1).div(2), new D(0), new D(-0.5), new D(-1)].map((value) => value.toString()));
      const sum = block.evOutcomes.reduce((total, { contribution }) => total.plus(contribution), new D(0));
      expect(sum.minus(result.expectedValue).abs().lt("1e-12")).toBe(true);
      for (const outcome of block.evOutcomes) expect(new D(outcome.contribution).minus(new D(outcome.probability).times(outcome.returnPerUnit)).abs().lt("1e-30")).toBe(true);
    }
  });
});

describe("decideExtendedValue: exact score", () => {
  const cell = (selection: string) => {
    const [home, away] = selection.split("-").map(Number);
    return matrix.cells.find(([h, a]) => h === home && a === away)![2];
  };
  it("uses expected value p*o-1 and edge p minus the no-vig probability", () => {
    // The book must hold every selection; build the full 17-selection book at one price.
    const selections = ["0-0", "0-1", "0-2", "0-3", "1-0", "1-1", "1-2", "1-3", "2-0", "2-1", "2-2", "2-3", "3-0", "3-1", "3-2", "3-3", "OTHER"].map((selection): [string, string] => [selection, selection === "1-1" ? "6.5" : "17"]);
    const odds = book("EXACT_SCORE", selections);
    const result = decideExtendedValue({ market: "EXACT_SCORE", selection: "1-1", forecast, matrix, odds });
    const p = new D(cell("1-1"));
    const noVig = new D(odds.selections.find(({ selection }) => selection === "1-1")!.noVigProbability);
    expect(new D(result.expectedValue).minus(p.times("6.5").minus(1)).abs().lt("1e-15")).toBe(true);
    expect(new D(result.edge).minus(p.minus(noVig)).abs().lt("1e-15")).toBe(true);
    expect(new D(result.fairOdds!).minus(new D(1).div(p)).abs().lt("1e-12")).toBe(true);
    expect(result.receipt.extended).toMatchObject({ kind: "EXACT_SCORE", exactScoreBucketsVersion: "exact-score-buckets-v1", fairOddsUnavailableReason: null, matrix: { source: "PERSISTED" } });
  });

  it("has a null fair price with ZERO_PROBABILITY when the score cannot occur", () => {
    // Sixteen explicit scores, 3-3 impossible: the other fifteen share the mass.
    const grid: ScoreMatrixCell[] = [];
    for (let home = 0; home <= 3; home += 1) for (let away = 0; away <= 3; away += 1) grid.push([home, away, home === 3 && away === 3 ? 0 : 1 / 15]);
    const selections = ["0-0", "0-1", "0-2", "0-3", "1-0", "1-1", "1-2", "1-3", "2-0", "2-1", "2-2", "2-3", "3-0", "3-1", "3-2", "3-3", "OTHER"].map((selection): [string, string] => [selection, "17"]);
    const result = decideExtendedValue({ market: "EXACT_SCORE", selection: "3-3", forecast, matrix: { cells: grid, source: "REDERIVED", cellsHash: null }, odds: book("EXACT_SCORE", selections) });
    expect(result.fairOdds).toBeNull();
    expect(result.receipt.extended).toMatchObject({ kind: "EXACT_SCORE", fairOddsUnavailableReason: "ZERO_PROBABILITY" });
    expect(result.modelProbability).toBe("0");
  });
});

describe("decideExtendedValue: mismatches and the market guard", () => {
  it("adds MARKET_SELECTION_MISMATCH for a selection outside the market", () => {
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.5", selection: "DRAW", forecast, matrix, odds: book("ASIAN_HANDICAP:-0.5", [["HOME", "2"], ["AWAY", "2"]]) });
    expect(result.reasons).toContain("MARKET_SELECTION_MISMATCH");
    expect(result.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.receipt.extended).toMatchObject({ kind: "ASIAN_HANDICAP", side: null });
  });

  it("adds MARKET_SELECTION_MISMATCH when the odds book is for another market", () => {
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.5", selection: "HOME", forecast, matrix, odds: book("ASIAN_HANDICAP:-0.75", [["HOME", "2"], ["AWAY", "2"]]) });
    expect(result.reasons).toContain("MARKET_SELECTION_MISMATCH");
    expect(result.receipt.gates[3]).toEqual({ gate: "DATA_QUALITY", passed: false });
  });

  it("adds FIXTURE_MISMATCH and orders the integrity reasons before the threshold reasons", () => {
    const result = decideExtendedValue({ market: "ASIAN_HANDICAP:-0.5", selection: "HOME", forecast: { ...forecast, confidence: { ...forecast.confidence, score: 0.1 } }, matrix, odds: book("ASIAN_HANDICAP:-0.5", [["HOME", "2"], ["AWAY", "2"]], "other") });
    expect(result.reasons.indexOf("FIXTURE_MISMATCH")).toBeLessThan(result.reasons.indexOf("CONFIDENCE_BELOW_THRESHOLD"));
  });

  it("rejects the three core markets", () => {
    expect(() => decideExtendedValue({ market: "BTTS", selection: "YES", forecast, matrix, odds: book("BTTS", [["YES", "2"], ["NO", "2"]]) })).toThrow("NOT_AN_EXTENDED_MARKET");
  });
});
