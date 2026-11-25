import { Decimal } from "decimal.js";

import { FORECAST_CONFIG } from "../forecast/config.js";
import { AH_LINES_V1, AH_LINES_VERSION, AH_QUARTERS_BY_TOKEN, parseAhLineToken, tokenOf, type AhLineToken } from "./ah-lines.js";
import type { ScoreMatrixCell } from "./score-matrix.js";

export { AH_LINES_V1, AH_LINES_VERSION, parseAhLineToken, type AhLineToken };

/**
 * Asian handicap core (D-05, D-06, D-07): the versioned line list, one settlement function shared by
 * display and settlement, the five-way breakdown over the score grid and push-aware fair odds.
 * Pure functions only. `buildAhView` assembles the full 21-line view (D-05, D-07, D-08) and `mainAhLine` picks the main line.
 */

const AhDecimal = Decimal.clone({ precision: FORECAST_CONFIG.decimalPrecision, rounding: Decimal.ROUND_HALF_EVEN });

export const AH_SETTLEMENT_VERSION = "ah-settlement-v1" as const;

export type AhSide = "HOME" | "AWAY";
export type AhResult = "WIN" | "HALF_WIN" | "PUSH" | "HALF_LOSS" | "LOSS";
export const AH_RESULTS: readonly AhResult[] = ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"];

/** Share of the odds and flat refund share per unit stake: payout = oddsShare * odds + refundShare. */
export const AH_RETURN_SHARES: Readonly<Record<AhResult, Readonly<{ oddsShare: number; refundShare: number }>>> = Object.freeze({
  WIN: Object.freeze({ oddsShare: 1, refundShare: 0 }),
  HALF_WIN: Object.freeze({ oddsShare: 0.5, refundShare: 0.5 }),
  PUSH: Object.freeze({ oddsShare: 0, refundShare: 1 }),
  HALF_LOSS: Object.freeze({ oddsShare: 0, refundShare: 0.5 }),
  LOSS: Object.freeze({ oddsShare: 0, refundShare: 0 }),
});

function legOutcome(adjustedMargin: number): "WIN" | "PUSH" | "LOSS" {
  return adjustedMargin > 0 ? "WIN" : adjustedMargin === 0 ? "PUSH" : "LOSS";
}

/**
 * Rule `ah-settlement-v1`: the side's goal margin plus the side's line; a quarter line splits the stake
 * equally over the two adjacent lines (0.25 either way). Whole and half lines produce only WIN, PUSH and LOSS.
 *
 * The rule is applied to the STORED final score. Extra time and penalty shoot-outs are not separated by
 * ingestion; that limitation is documented in plan 14-08 and ingestion is deliberately not changed here
 * (Open Question 2).
 */
export function settleAsianHandicap(
  lineToken: string,
  side: AhSide,
  homeGoals: number,
  awayGoals: number,
): Readonly<{ result: AhResult; shares: Readonly<{ oddsShare: number; refundShare: number }> }> {
  const quarters = AH_QUARTERS_BY_TOKEN.get(lineToken);
  if (quarters === undefined) throw Object.assign(new Error("INVALID_AH_LINE"), { code: "INVALID_AH_LINE" });
  const margin = side === "HOME" ? homeGoals - awayGoals : awayGoals - homeGoals;
  const sideQuarters = side === "HOME" ? quarters : -quarters;
  const legs = Math.abs(quarters) % 2 === 1 ? [sideQuarters - 1, sideQuarters + 1] : [sideQuarters];
  const outcomes = legs.map((leg) => legOutcome(margin + leg / 4));
  const wins = outcomes.filter((outcome) => outcome === "WIN").length;
  const losses = outcomes.filter((outcome) => outcome === "LOSS").length;
  let result: AhResult;
  if (wins > 0 && losses > 0) throw Object.assign(new Error("AH_WIN_LOSS_MIX"), { code: "AH_WIN_LOSS_MIX" });
  if (outcomes.length === 1) result = outcomes[0]!;
  else if (wins === 2) result = "WIN";
  else if (losses === 2) result = "LOSS";
  else result = wins === 1 ? "HALF_WIN" : "HALF_LOSS";
  return { result, shares: AH_RETURN_SHARES[result] };
}

export type AhBreakdown = Readonly<Record<AhResult, number>>;

/** Probability of each of the five outcomes, summed over the grid in grid order through the settlement function only. */
export function ahBreakdown(cells: readonly ScoreMatrixCell[], lineToken: string, side: AhSide): AhBreakdown {
  const totals: Record<AhResult, number> = { WIN: 0, HALF_WIN: 0, PUSH: 0, HALF_LOSS: 0, LOSS: 0 };
  for (const [homeGoals, awayGoals, probability] of cells) totals[settleAsianHandicap(lineToken, side, homeGoals, awayGoals).result] += probability;
  return totals;
}

/** WIN + HALF_WIN / 2: the probability the stake is effectively won. */
export function ahEffectiveWinProbability(breakdown: AhBreakdown): number {
  return breakdown.WIN + breakdown.HALF_WIN / 2;
}

export type AhFairOdds =
  | Readonly<{ status: "AVAILABLE"; odds: string }>
  | Readonly<{ status: "UNAVAILABLE"; reason: "NO_WIN_PROBABILITY" }>;

/** D-07: `1 + (LOSS + HALF_LOSS/2) / (WIN + HALF_WIN/2)`; no Infinity and no NaN when the stake can never win. */
export function ahFairOdds(breakdown: AhBreakdown): AhFairOdds {
  const denominator = new AhDecimal(breakdown.WIN).plus(new AhDecimal(breakdown.HALF_WIN).div(2));
  if (!denominator.isFinite() || denominator.lte(0)) return { status: "UNAVAILABLE", reason: "NO_WIN_PROBABILITY" };
  const numerator = new AhDecimal(breakdown.LOSS).plus(new AhDecimal(breakdown.HALF_LOSS).div(2));
  return { status: "AVAILABLE", odds: new AhDecimal(1).plus(numerator.div(denominator)).toString() };
}

export interface AhSideView {
  readonly breakdown: AhBreakdown;
  readonly effectiveWinProbability: number;
  readonly fairOdds: AhFairOdds;
}

export interface AhLineView {
  readonly line: AhLineToken;
  readonly home: AhSideView;
  readonly away: AhSideView;
}

function sideView(cells: readonly ScoreMatrixCell[], lineToken: string, side: AhSide): AhSideView {
  const breakdown = ahBreakdown(cells, lineToken, side);
  return { breakdown, effectiveWinProbability: ahEffectiveWinProbability(breakdown), fairOdds: ahFairOdds(breakdown) };
}

/** Both sides of one home-perspective line. */
export function ahLineView(cells: readonly ScoreMatrixCell[], lineToken: string): AhLineView {
  const line = parseAhLineToken(lineToken);
  if (line === null) throw Object.assign(new Error("INVALID_AH_LINE"), { code: "INVALID_AH_LINE" });
  return { line, home: sideView(cells, lineToken, "HOME"), away: sideView(cells, lineToken, "AWAY") };
}

export type AhLineClass = "WHOLE" | "HALF" | "QUARTER";

function quartersOf(token: AhLineToken): number {
  return AH_QUARTERS_BY_TOKEN.get(token)!;
}

/** WHOLE for x, HALF for x.5, QUARTER for x.25 and x.75 (a quarter line splits the stake over two adjacent lines). */
export function lineClassOf(token: AhLineToken): AhLineClass {
  const quarters = Math.abs(quartersOf(token));
  return quarters % 4 === 0 ? "WHOLE" : quarters % 2 === 0 ? "HALF" : "QUARTER";
}

/**
 * The two adjacent lines a quarter line splits its stake over, in the side's own sign convention and by ascending
 * absolute value (home -0.75 gives -0.5, -1; the away side of the same line gives +0.5, +1). Empty for whole and half lines.
 */
export function splitLinesOf(token: AhLineToken, side: AhSide): readonly AhLineToken[] {
  if (lineClassOf(token) !== "QUARTER") return [];
  const own = side === "HOME" ? quartersOf(token) : -quartersOf(token);
  return [own - 1, own + 1].sort((a, b) => Math.abs(a) - Math.abs(b)).map(tokenOf);
}

export interface AhSideRow extends AhSideView {
  readonly splitLines: readonly AhLineToken[];
}

/** One home-perspective line with both sides, as displayed (D-05): the line, its mirror, its class and every figure. */
export interface AhMarketLine {
  readonly homeLine: AhLineToken;
  readonly awayLine: AhLineToken;
  readonly lineClass: AhLineClass;
  readonly sides: Readonly<{ HOME: AhSideRow; AWAY: AhSideRow }>;
}

function sideRow(cells: readonly ScoreMatrixCell[], token: AhLineToken, side: AhSide): AhSideRow {
  return { ...sideView(cells, token, side), splitLines: splitLinesOf(token, side) };
}

/**
 * All 21 lines of `ah-lines-v1` by ascending home line. Every side is summed over the grid in the same cell order and
 * through the single settlement function, so the away side is the bitwise mirror of the home side.
 */
export function buildAhView(cells: readonly ScoreMatrixCell[]): readonly AhMarketLine[] {
  return AH_LINES_V1.lines.map((token) => ({
    homeLine: token,
    awayLine: tokenOf(-quartersOf(token)),
    lineClass: lineClassOf(token),
    sides: { HOME: sideRow(cells, token, "HOME"), AWAY: sideRow(cells, token, "AWAY") },
  }));
}

function homeGap(line: AhMarketLine): number {
  const { WIN, HALF_WIN, HALF_LOSS, LOSS } = line.sides.HOME.breakdown;
  return Math.abs(WIN + HALF_WIN / 2 - (LOSS + HALF_LOSS / 2));
}

/**
 * D-08 main line: the home-side line minimising |(WIN + HALF_WIN/2) - (LOSS + HALF_LOSS/2)|. Ties go to the smaller
 * absolute line, then to the smaller (more negative) home line; the last rule is this plan's decision, D-08 leaves it
 * open. The comparison is exact, with no tolerance, so the choice is a pure function of the grid.
 */
export function mainAhLine(lines: readonly AhMarketLine[]): AhLineToken {
  let best: { readonly line: AhLineToken; readonly gap: number } | undefined;
  for (const candidate of lines) {
    const gap = homeGap(candidate);
    const quarters = quartersOf(candidate.homeLine);
    const bestQuarters = best === undefined ? 0 : quartersOf(best.line);
    const better = best === undefined
      || gap < best.gap
      || (gap === best.gap && (Math.abs(quarters) < Math.abs(bestQuarters) || (Math.abs(quarters) === Math.abs(bestQuarters) && quarters < bestQuarters)));
    if (better) best = { line: candidate.homeLine, gap };
  }
  if (best === undefined) throw Object.assign(new Error("INVALID_AH_VIEW"), { code: "INVALID_AH_VIEW" });
  return best.line;
}
