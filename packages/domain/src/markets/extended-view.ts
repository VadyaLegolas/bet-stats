import { AH_LINES_V1, AH_LINES_VERSION, parseAhLineToken, type AhLineToken } from "./ah-lines.js";
import {
  AH_RESULTS,
  AH_SETTLEMENT_VERSION,
  buildAhView,
  lineClassOf,
  mainAhLine,
  splitLinesOf,
  type AhMarketLine,
  type AhSide,
} from "./asian-handicap.js";
import { EXACT_SCORE_BUCKETS_V1, EXACT_SCORE_BUCKETS_VERSION, exactScoreView, type ExactScoreCellView, type ExactScoreOtherView } from "./exact-score.js";
import { SCORE_MATRIX_VERSION, type ScoreMatrixCell } from "./score-matrix.js";

/**
 * The read-time view of the extended markets (D-04): Asian handicap on 21 lines and exact score, all derived from the
 * sealed score matrix and nothing else, never written to ForecastMarket and never calibrated. The DTO is strictly typed
 * with two states; `parseExtendedMarketsView` is the closed, fail-closed parser a consumer applies to the wire value so
 * that a malformed response is never shown as AVAILABLE. Pure functions only.
 */

export const EXTENDED_MARKETS_VIEW_VERSION = "extended-markets-view-v1" as const;

/** The only reason the client ever sees; internal reason codes stay in the operator log. */
export type ExtendedMarketsUnavailableReason = "SCORE_MATRIX_UNAVAILABLE";

export interface ExtendedMarketsTail {
  readonly retainedMass: number;
  readonly tailMass: number;
  readonly warning: boolean;
}

export interface ExtendedMarketsRules {
  readonly ahLines: typeof AH_LINES_VERSION;
  readonly ahSettlement: typeof AH_SETTLEMENT_VERSION;
  readonly exactScoreBuckets: typeof EXACT_SCORE_BUCKETS_VERSION;
  readonly scoreMatrix: typeof SCORE_MATRIX_VERSION;
}

export type ExtendedMarketsSource = "PERSISTED" | "REDERIVED";

export type ExtendedMarketsView =
  | Readonly<{
      version: typeof EXTENDED_MARKETS_VIEW_VERSION;
      state: "AVAILABLE";
      source: ExtendedMarketsSource;
      rules: ExtendedMarketsRules;
      calibration: "NONE";
      tail: ExtendedMarketsTail;
      asianHandicap: Readonly<{ mainLine: AhLineToken; lines: readonly AhMarketLine[] }>;
      exactScore: Readonly<{ cells: readonly ExactScoreCellView[]; other: ExactScoreOtherView }>;
    }>
  | Readonly<{ version: typeof EXTENDED_MARKETS_VIEW_VERSION; state: "UNAVAILABLE"; reason: ExtendedMarketsUnavailableReason }>;

const RULES: ExtendedMarketsRules = Object.freeze({
  ahLines: AH_LINES_VERSION,
  ahSettlement: AH_SETTLEMENT_VERSION,
  exactScoreBuckets: EXACT_SCORE_BUCKETS_VERSION,
  scoreMatrix: SCORE_MATRIX_VERSION,
});

export interface BuildExtendedMarketsViewInput {
  readonly cells: readonly ScoreMatrixCell[];
  readonly source: ExtendedMarketsSource;
  readonly tail: ExtendedMarketsTail;
}

export function buildExtendedMarketsView(input: BuildExtendedMarketsViewInput): ExtendedMarketsView {
  const lines = buildAhView(input.cells);
  return {
    version: EXTENDED_MARKETS_VIEW_VERSION,
    state: "AVAILABLE",
    source: input.source,
    rules: RULES,
    calibration: "NONE",
    tail: { retainedMass: input.tail.retainedMass, tailMass: input.tail.tailMass, warning: input.tail.warning },
    asianHandicap: { mainLine: mainAhLine(lines), lines },
    exactScore: exactScoreView(input.cells),
  };
}

export function unavailableExtendedMarketsView(): ExtendedMarketsView {
  return { version: EXTENDED_MARKETS_VIEW_VERSION, state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" };
}

const SUM_TOLERANCE = 1e-9;
const ODDS_PATTERN = /^[0-9]+(?:\.[0-9]+)?(?:e\+[0-9]+)?$/;

function invalid(): never {
  throw Object.assign(new Error("INVALID_EXTENDED_MARKETS_VIEW"), { code: "INVALID_EXTENDED_MARKETS_VIEW" });
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) invalid();
}

function unit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return invalid();
  return value;
}

/** A fair-odds block must agree with the probability it belongs to: unavailable exactly when the stake cannot win. */
function checkFairOdds(value: unknown, reason: "NO_WIN_PROBABILITY" | "ZERO_PROBABILITY", canWin: boolean): void {
  const odds = record(value);
  if (odds.status === "AVAILABLE") {
    exactKeys(odds, ["status", "odds"]);
    if (!canWin || typeof odds.odds !== "string" || !ODDS_PATTERN.test(odds.odds) || !Number.isFinite(Number(odds.odds)) || Number(odds.odds) < 1) invalid();
  } else if (odds.status === "UNAVAILABLE") {
    exactKeys(odds, ["status", "reason"]);
    if (canWin || odds.reason !== reason) invalid();
  } else invalid();
}

function parseSide(value: unknown, line: AhLineToken, side: AhSide): void {
  const row = record(value);
  exactKeys(row, ["breakdown", "effectiveWinProbability", "fairOdds", "splitLines"]);
  const breakdown = record(row.breakdown);
  exactKeys(breakdown, AH_RESULTS);
  let total = 0;
  for (const result of AH_RESULTS) total += unit(breakdown[result]);
  if (Math.abs(total - 1) > SUM_TOLERANCE) invalid();
  const effective = unit(row.effectiveWinProbability);
  if (Math.abs(effective - (breakdown.WIN as number + (breakdown.HALF_WIN as number) / 2)) > SUM_TOLERANCE) invalid();
  checkFairOdds(row.fairOdds, "NO_WIN_PROBABILITY", effective > 0);
  const expected = splitLinesOf(line, side);
  if (!Array.isArray(row.splitLines) || row.splitLines.length !== expected.length || row.splitLines.some((token, index) => token !== expected[index])) invalid();
}

function parseAsianHandicap(value: unknown): void {
  const block = record(value);
  exactKeys(block, ["mainLine", "lines"]);
  if (parseAhLineToken(block.mainLine) === null) invalid();
  const lines = block.lines;
  if (!Array.isArray(lines) || lines.length !== AH_LINES_V1.lines.length) invalid();
  (lines as unknown[]).forEach((raw, index) => {
    const row = record(raw);
    exactKeys(row, ["homeLine", "awayLine", "lineClass", "sides"]);
    const homeLine = AH_LINES_V1.lines[index]!;
    const awayLine = AH_LINES_V1.lines[AH_LINES_V1.lines.length - 1 - index]!;
    if (row.homeLine !== homeLine || row.awayLine !== awayLine || row.lineClass !== lineClassOf(homeLine)) invalid();
    const sides = record(row.sides);
    exactKeys(sides, ["HOME", "AWAY"]);
    parseSide(sides.HOME, homeLine, "HOME");
    parseSide(sides.AWAY, homeLine, "AWAY");
  });
}

function parseExactScore(value: unknown): void {
  const block = record(value);
  exactKeys(block, ["cells", "other"]);
  const cells = block.cells;
  const explicit = EXACT_SCORE_BUCKETS_V1.selections.slice(0, -1);
  if (!Array.isArray(cells) || cells.length !== explicit.length) invalid();
  let total = 0;
  (cells as unknown[]).forEach((raw, index) => {
    const cell = record(raw);
    exactKeys(cell, ["selection", "homeGoals", "awayGoals", "probability", "fairOdds"]);
    if (cell.selection !== explicit[index] || cell.homeGoals !== Math.floor(index / 4) || cell.awayGoals !== index % 4) invalid();
    const probability = unit(cell.probability);
    total += probability;
    checkFairOdds(cell.fairOdds, "ZERO_PROBABILITY", probability > 0);
  });
  const other = record(block.other);
  exactKeys(other, ["selection", "probability", "fairOdds"]);
  if (other.selection !== EXACT_SCORE_BUCKETS_V1.other) invalid();
  const otherProbability = unit(other.probability);
  total += otherProbability;
  checkFairOdds(other.fairOdds, "ZERO_PROBABILITY", otherProbability > 0);
  if (Math.abs(total - 1) > SUM_TOLERANCE) invalid();
}

function parseTail(value: unknown): void {
  const tail = record(value);
  exactKeys(tail, ["retainedMass", "tailMass", "warning"]);
  const retained = unit(tail.retainedMass);
  if (retained <= 0) invalid();
  unit(tail.tailMass);
  if (typeof tail.warning !== "boolean") invalid();
}

/** Closed parse of the wire value: exact key sets, the whitelisted tokens, 21 lines, 16 cells plus OTHER, strict sums. */
export function parseExtendedMarketsView(value: unknown): ExtendedMarketsView {
  const view = record(value);
  if (view.version !== EXTENDED_MARKETS_VIEW_VERSION) invalid();
  if (view.state === "UNAVAILABLE") {
    exactKeys(view, ["version", "state", "reason"]);
    if (view.reason !== "SCORE_MATRIX_UNAVAILABLE") invalid();
    return value as ExtendedMarketsView;
  }
  if (view.state !== "AVAILABLE") invalid();
  exactKeys(view, ["version", "state", "source", "rules", "calibration", "tail", "asianHandicap", "exactScore"]);
  if (view.source !== "PERSISTED" && view.source !== "REDERIVED") invalid();
  const rules = record(view.rules);
  exactKeys(rules, Object.keys(RULES));
  for (const [key, expected] of Object.entries(RULES)) if (rules[key] !== expected) invalid();
  if (view.calibration !== "NONE") invalid();
  parseTail(view.tail);
  parseAsianHandicap(view.asianHandicap);
  parseExactScore(view.exactScore);
  return value as ExtendedMarketsView;
}
