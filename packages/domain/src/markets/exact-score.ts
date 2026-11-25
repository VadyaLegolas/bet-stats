import { Decimal } from "decimal.js";

import type { ScoreMatrixCell } from "./score-matrix.js";

/**
 * Exact score market (D-09): sixteen explicit scores 0-0..3-3 and the bucket OTHER.
 * Pure functions only. This module is the configuration and the closed selection grammar (imported by the market
 * registry, hence no import of the forecast configuration, whose global decimal side effect must not leak into the
 * odds modules) and `exactScoreView`, the probability view over the stored score matrix.
 */

/** Same working precision as `FORECAST_CONFIG.decimalPrecision`; a unit test pins the two together. */
export const EXACT_SCORE_DECIMAL_PRECISION = 40 as const;
const ExactDecimal = Decimal.clone({ precision: EXACT_SCORE_DECIMAL_PRECISION, rounding: Decimal.ROUND_HALF_EVEN });

export const EXACT_SCORE_BUCKETS_VERSION = "exact-score-buckets-v1" as const;

type Goals = 0 | 1 | 2 | 3;
export type ExactScoreCell = `${Goals}-${Goals}`;
export type ExactScoreSelection = ExactScoreCell | "OTHER";

const GOALS: readonly Goals[] = [0, 1, 2, 3];

/** Row order: home goals outside, away goals inside, then OTHER (also the order of the form fields). */
const SELECTIONS: readonly ExactScoreSelection[] = Object.freeze([
  ...GOALS.flatMap((home) => GOALS.map((away) => `${home}-${away}` as ExactScoreCell)),
  "OTHER" as const,
]);

export const EXACT_SCORE_BUCKETS_V1 = Object.freeze({
  version: EXACT_SCORE_BUCKETS_VERSION,
  maxGoals: 3 as const,
  other: "OTHER" as const,
  selections: SELECTIONS,
});

type ParsedExactScore = Readonly<{ homeGoals: number; awayGoals: number }> | "OTHER";

const PARSED: ReadonlyMap<string, ParsedExactScore> = new Map<string, ParsedExactScore>(
  SELECTIONS.map((selection): [string, ParsedExactScore] => {
    if (selection === "OTHER") return [selection, "OTHER"];
    const [home, away] = selection.split("-");
    return [selection, Object.freeze({ homeGoals: Number(home), awayGoals: Number(away) })];
  }),
);

/** Membership in the closed list, never a numeric parse: `01-1`, `4-0` and `other` are rejected. */
export function parseExactScoreSelection(id: unknown): Readonly<{ homeGoals: number; awayGoals: number }> | "OTHER" | null {
  return typeof id === "string" ? PARSED.get(id) ?? null : null;
}

export type ExactScoreFairOdds =
  | Readonly<{ status: "AVAILABLE"; odds: string }>
  | Readonly<{ status: "UNAVAILABLE"; reason: "ZERO_PROBABILITY" }>;

export interface ExactScoreCellView {
  readonly selection: ExactScoreCell;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly probability: number;
  readonly fairOdds: ExactScoreFairOdds;
}

export interface ExactScoreOtherView {
  readonly selection: "OTHER";
  readonly probability: number;
  readonly fairOdds: ExactScoreFairOdds;
}

export interface ExactScoreView {
  readonly cells: readonly ExactScoreCellView[];
  readonly other: ExactScoreOtherView;
}

/** `1 / p`; a zero probability is typed UNAVAILABLE, never Infinity or NaN. */
export function exactScoreFairOdds(probability: number): ExactScoreFairOdds {
  if (!Number.isFinite(probability) || probability <= 0) return { status: "UNAVAILABLE", reason: "ZERO_PROBABILITY" };
  return { status: "AVAILABLE", odds: new ExactDecimal(1).div(new ExactDecimal(probability)).toString() };
}

function invalidMatrix(): never {
  throw Object.assign(new Error("INVALID_SCORE_MATRIX"), { code: "INVALID_SCORE_MATRIX" });
}

/**
 * D-09: the 16 explicit scores read straight from the stored grid in registry order, and OTHER as the complement
 * `max(0, 1 - sum of the sixteen)`, summed in that same order. The grid is already normalised to its retained mass, so
 * the tail beyond 0..7 is part of OTHER through the difference, not through a separate row.
 */
export function exactScoreView(cells: readonly ScoreMatrixCell[]): ExactScoreView {
  const byScore = new Map<string, number>(cells.map(([home, away, probability]) => [`${home}-${away}`, probability]));
  let sum = 0;
  const explicit = EXACT_SCORE_BUCKETS_V1.selections.slice(0, -1).map((selection): ExactScoreCellView => {
    const parsed = parseExactScoreSelection(selection);
    const probability = byScore.get(selection);
    if (parsed === null || parsed === "OTHER" || probability === undefined || !Number.isFinite(probability)) return invalidMatrix();
    sum += probability;
    return { selection: selection as ExactScoreCell, homeGoals: parsed.homeGoals, awayGoals: parsed.awayGoals, probability, fairOdds: exactScoreFairOdds(probability) };
  });
  const other = Math.max(0, 1 - sum);
  return { cells: explicit, other: { selection: "OTHER", probability: other, fairOdds: exactScoreFairOdds(other) } };
}
