import { createHash } from "node:crypto";

export const SCORE_FORMULA_VERSION = "proper-score-v1" as const;
export const SCORE_LOG_EPSILON = 1e-15 as const;

export const SCORE_CLASS_ORDER = {
  ONE_X_TWO: ["HOME", "DRAW", "AWAY"],
  OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"],
  BTTS: ["YES", "NO"],
} as const;

export type ScoreMarket = keyof typeof SCORE_CLASS_ORDER;
export type ScoreSelection = (typeof SCORE_CLASS_ORDER)[ScoreMarket][number];

const FORMULA_RECEIPT = {
  version: SCORE_FORMULA_VERSION,
  brier: { convention: "sum", range: [0, 2], targetEncoding: "one-hot" },
  logLoss: { logarithm: "natural", epsilon: SCORE_LOG_EPSILON },
  classOrder: SCORE_CLASS_ORDER,
} as const;

export const SCORE_FORMULA_HASH = `sha256:${createHash("sha256")
  .update(JSON.stringify(FORMULA_RECEIPT))
  .digest("hex")}` as const;

export interface CategoricalScoreInput {
  readonly settlementReceiptId: string;
  readonly forecastSnapshotId: string;
  readonly market: ScoreMarket;
  readonly outcome: string;
  readonly probabilities: readonly Readonly<{ selection: string; probability: number }>[];
}

export interface CategoricalScoreFact {
  readonly settlementReceiptId: string;
  readonly forecastSnapshotId: string;
  readonly market: ScoreMarket;
  readonly outcome: ScoreSelection;
  readonly classOrder: readonly string[];
  readonly probabilities: readonly Readonly<{ selection: string; probability: number }>[];
  readonly rawChosenProbability: number;
  readonly clippedChosenProbability: number;
  readonly brierScore: number;
  readonly logLoss: number;
  readonly eventCount: 1;
  readonly formulaVersion: typeof SCORE_FORMULA_VERSION;
  readonly formulaHash: typeof SCORE_FORMULA_HASH;
  readonly formulaReceipt: typeof FORMULA_RECEIPT;
}

function requireIdentity(value: string, code: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
}

export function scoreCategoricalForecast(input: CategoricalScoreInput): CategoricalScoreFact {
  requireIdentity(input.settlementReceiptId, "INVALID_SETTLEMENT_RECEIPT_ID");
  requireIdentity(input.forecastSnapshotId, "INVALID_FORECAST_SNAPSHOT_ID");
  const classOrder = SCORE_CLASS_ORDER[input.market];
  if (!classOrder) throw new Error("INVALID_SCORE_MARKET");
  if (!classOrder.includes(input.outcome as never)) throw new Error("INVALID_SCORE_OUTCOME");
  if (!Array.isArray(input.probabilities) || input.probabilities.length !== classOrder.length) {
    throw new Error("INVALID_SCORE_VECTOR");
  }

  let sum = 0;
  for (const [index, expectedSelection] of classOrder.entries()) {
    const event = input.probabilities[index];
    if (
      !event || event.selection !== expectedSelection ||
      typeof event.probability !== "number" || !Number.isFinite(event.probability) ||
      event.probability < 0 || event.probability > 1
    ) throw new Error("INVALID_SCORE_VECTOR");
    sum += event.probability;
  }
  if (Math.abs(sum - 1) > 1e-12) throw new Error("INVALID_SCORE_VECTOR");

  const rawChosenProbability = input.probabilities[classOrder.indexOf(input.outcome as never)]!.probability;
  const clippedChosenProbability = Math.max(SCORE_LOG_EPSILON, rawChosenProbability);
  const brierScore = input.probabilities.reduce((score, event) => {
    const target = event.selection === input.outcome ? 1 : 0;
    return score + (event.probability - target) ** 2;
  }, 0);

  return {
    settlementReceiptId: input.settlementReceiptId,
    forecastSnapshotId: input.forecastSnapshotId,
    market: input.market,
    outcome: input.outcome as ScoreSelection,
    classOrder: [...classOrder],
    probabilities: input.probabilities.map((event) => ({ ...event })),
    rawChosenProbability,
    clippedChosenProbability,
    brierScore,
    logLoss: -Math.log(clippedChosenProbability),
    eventCount: 1,
    formulaVersion: SCORE_FORMULA_VERSION,
    formulaHash: SCORE_FORMULA_HASH,
    formulaReceipt: FORMULA_RECEIPT,
  };
}
