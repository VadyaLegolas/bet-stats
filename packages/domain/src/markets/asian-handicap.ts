import { Decimal } from "decimal.js";

import { FORECAST_CONFIG } from "../forecast/config.js";
import { AH_LINES_V1, AH_LINES_VERSION, AH_QUARTERS_BY_TOKEN, parseAhLineToken, type AhLineToken } from "./ah-lines.js";
import type { ScoreMatrixCell } from "./score-matrix.js";

export { AH_LINES_V1, AH_LINES_VERSION, parseAhLineToken, type AhLineToken };

/**
 * Asian handicap core (D-05, D-06, D-07): the versioned line list, one settlement function shared by
 * display and settlement, the five-way breakdown over the score grid and push-aware fair odds.
 * Pure functions only. The full 21-line view and the main line are added by plan 14-02.
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
