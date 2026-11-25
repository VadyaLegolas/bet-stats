/**
 * Exact score market (D-09): sixteen explicit scores 0-0..3-3 and the bucket OTHER.
 * Pure functions only. This module is the configuration and the closed selection grammar; the probability
 * view over the stored score matrix is `exactScoreView`.
 */

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
