import { Decimal } from "decimal.js";

import { FORECAST_CONFIG } from "../forecast/config.js";
import {
  AH_LINES_VERSION,
  AH_RESULTS,
  AH_SETTLEMENT_VERSION,
  ahBreakdown,
  ahFairOdds,
  type AhBreakdown,
  type AhResult,
  type AhSide,
} from "../markets/asian-handicap.js";
import { EXACT_SCORE_BUCKETS_VERSION, exactScoreView, parseExactScoreSelection } from "../markets/exact-score.js";
import { parseMarketId, selectionsFor, type MarketId } from "../markets/registry.js";
import { SCORE_MATRIX_VERSION, type ScoreMatrixCell } from "../markets/score-matrix.js";
import type { NormalizedOddsBook } from "../odds/normalize.js";
import { VALUE_POLICY, type ValueInput } from "./decision.js";

/**
 * Push-aware value decision for Asian handicap and exact score (D-13, D-14). The gates, their order and the thresholds
 * are those of `decideValue` (the same `VALUE_POLICY`); only the probability, edge and expected value of the market differ.
 * The module lives under `value/`, so the CLV import graph guard covers it as a root: it imports nothing from the
 * closing-odds, comparable-CLV or no-vig-CLV modules (D-14). Pure functions only.
 *
 * Assumption A1: for a handicap, `modelProbability` is the effective win probability `WIN + HALF_WIN/2` and the edge is the
 * conditional win probability `effectiveWin / (effectiveWin + effectiveLose)` minus the no-vig probability. The plain
 * difference `effectiveWin - noVig` would be about -0.10 on a fair level line because it ignores the refunded stake.
 */

export const PUSH_AWARE_EV_POLICY_VERSION = "push-aware-ev-v1" as const;
export const EXTENDED_EDGE_DEFINITION = "conditional-win-probability-minus-no-vig" as const;

const ExtDecimal = Decimal.clone({ precision: FORECAST_CONFIG.decimalPrecision, rounding: Decimal.ROUND_HALF_EVEN });

type ValueForecast = ValueInput["forecast"];

export interface ExtendedValueMatrix {
  readonly cells: readonly ScoreMatrixCell[];
  readonly source: "PERSISTED" | "REDERIVED";
  readonly cellsHash: string | null;
}

export interface ExtendedValueInput {
  readonly market: MarketId;
  readonly selection: string;
  readonly forecast: ValueForecast;
  readonly matrix: ExtendedValueMatrix;
  readonly odds: NormalizedOddsBook;
}

interface ReceiptMatrix {
  readonly version: typeof SCORE_MATRIX_VERSION;
  readonly source: ExtendedValueMatrix["source"];
  readonly cellsHash: string | null;
}

export interface AhEvOutcome {
  readonly result: AhResult;
  readonly probability: string;
  readonly returnPerUnit: string;
  readonly contribution: string;
}

export type ExtendedValueReceiptBlock =
  | Readonly<{
      kind: "ASIAN_HANDICAP";
      evPolicyVersion: typeof PUSH_AWARE_EV_POLICY_VERSION;
      ahLinesVersion: typeof AH_LINES_VERSION;
      ahSettlementVersion: typeof AH_SETTLEMENT_VERSION;
      line: string;
      side: AhSide | null;
      breakdown: Readonly<Record<AhResult, string>>;
      evOutcomes: readonly AhEvOutcome[];
      effectiveWinProbability: string;
      effectiveLoseProbability: string;
      conditionalWinProbability: string;
      edgeDefinition: typeof EXTENDED_EDGE_DEFINITION;
      fairOddsUnavailableReason: "NO_WIN_PROBABILITY" | null;
      matrix: ReceiptMatrix;
    }>
  | Readonly<{
      kind: "EXACT_SCORE";
      exactScoreBucketsVersion: typeof EXACT_SCORE_BUCKETS_VERSION;
      fairOddsUnavailableReason: "ZERO_PROBABILITY" | null;
      matrix: ReceiptMatrix;
    }>;

interface Priced {
  readonly modelProbability: Decimal;
  readonly edge: Decimal;
  readonly expectedValue: Decimal;
  readonly fairOdds: string | null;
  readonly formulas: readonly string[];
  readonly block: ExtendedValueReceiptBlock;
}

const ZERO_BREAKDOWN: AhBreakdown = Object.freeze({ WIN: 0, HALF_WIN: 0, PUSH: 0, HALF_LOSS: 0, LOSS: 0 });

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function priceAsianHandicap(line: string, side: AhSide | null, input: ExtendedValueInput, noVig: Decimal, decimalOdds: Decimal): Priced {
  // A selection outside the market gets an all-zero breakdown, so the receipt still shows five outcomes and the gate fails.
  const breakdown = side === null ? ZERO_BREAKDOWN : ahBreakdown(input.matrix.cells, line, side);
  const probability = (result: AhResult) => new ExtDecimal(breakdown[result]);
  const effectiveWin = probability("WIN").plus(probability("HALF_WIN").div(2));
  const effectiveLose = probability("LOSS").plus(probability("HALF_LOSS").div(2));
  const total = effectiveWin.plus(effectiveLose);
  const conditionalWin = total.isZero() ? new ExtDecimal(0) : effectiveWin.div(total);
  const winReturn = decimalOdds.minus(1);
  const returnPerUnit: Readonly<Record<AhResult, Decimal>> = {
    WIN: winReturn,
    HALF_WIN: winReturn.div(2),
    PUSH: new ExtDecimal(0),
    HALF_LOSS: new ExtDecimal(-0.5),
    LOSS: new ExtDecimal(-1),
  };
  const evOutcomes = AH_RESULTS.map((result): AhEvOutcome => {
    const contribution = probability(result).times(returnPerUnit[result]);
    return { result, probability: probability(result).toString(), returnPerUnit: returnPerUnit[result].toString(), contribution: contribution.toString() };
  });
  // The expected value is the sum of the five contributions in this fixed order, so the displayed parts add up to it exactly.
  const expectedValue = AH_RESULTS.reduce((sum, result) => sum.plus(probability(result).times(returnPerUnit[result])), new ExtDecimal(0));
  const fair = ahFairOdds(breakdown);
  return {
    modelProbability: effectiveWin,
    edge: conditionalWin.minus(noVig),
    expectedValue,
    fairOdds: fair.status === "AVAILABLE" ? fair.odds : null,
    formulas: [
      "effectiveWin=WIN+HALF_WIN/2",
      "effectiveLose=LOSS+HALF_LOSS/2",
      "conditionalWinProbability=effectiveWin/(effectiveWin+effectiveLose)",
      "edge=conditionalWinProbability-noVigProbability",
      "expectedValue=WIN*(decimalOdds-1)+HALF_WIN*(decimalOdds-1)/2-HALF_LOSS/2-LOSS",
    ],
    block: {
      kind: "ASIAN_HANDICAP",
      evPolicyVersion: PUSH_AWARE_EV_POLICY_VERSION,
      ahLinesVersion: AH_LINES_VERSION,
      ahSettlementVersion: AH_SETTLEMENT_VERSION,
      line,
      side,
      breakdown: {
        WIN: probability("WIN").toString(),
        HALF_WIN: probability("HALF_WIN").toString(),
        PUSH: probability("PUSH").toString(),
        HALF_LOSS: probability("HALF_LOSS").toString(),
        LOSS: probability("LOSS").toString(),
      },
      evOutcomes,
      effectiveWinProbability: effectiveWin.toString(),
      effectiveLoseProbability: effectiveLose.toString(),
      conditionalWinProbability: conditionalWin.toString(),
      edgeDefinition: EXTENDED_EDGE_DEFINITION,
      fairOddsUnavailableReason: fair.status === "AVAILABLE" ? null : fair.reason,
      matrix: receiptMatrix(input.matrix),
    },
  };
}

function priceExactScore(selection: string, input: ExtendedValueInput, noVig: Decimal, decimalOdds: Decimal): Priced {
  const view = exactScoreView(input.matrix.cells);
  const entry = parseExactScoreSelection(selection) === null ? null : selection === "OTHER" ? view.other : view.cells.find((cell) => cell.selection === selection) ?? null;
  const probability = new ExtDecimal(entry?.probability ?? 0);
  const fair = entry?.fairOdds ?? null;
  return {
    modelProbability: probability,
    edge: probability.minus(noVig),
    expectedValue: probability.times(decimalOdds).minus(1),
    fairOdds: fair !== null && fair.status === "AVAILABLE" ? fair.odds : null,
    formulas: ["edge=modelProbability-noVigProbability", "expectedValue=modelProbability*decimalOdds-1"],
    block: {
      kind: "EXACT_SCORE",
      exactScoreBucketsVersion: EXACT_SCORE_BUCKETS_VERSION,
      fairOddsUnavailableReason: fair !== null && fair.status === "AVAILABLE" ? null : "ZERO_PROBABILITY",
      matrix: receiptMatrix(input.matrix),
    },
  };
}

function receiptMatrix(matrix: ExtendedValueMatrix): ReceiptMatrix {
  return { version: SCORE_MATRIX_VERSION, source: matrix.source, cellsHash: matrix.cellsHash };
}

/** Value decision for `ASIAN_HANDICAP:<token>` or `EXACT_SCORE`; any other market is rejected with `NOT_AN_EXTENDED_MARKET`. */
export function decideExtendedValue(input: ExtendedValueInput) {
  const parsed = parseMarketId(input.market);
  if (parsed === null || (parsed.family !== "ASIAN_HANDICAP" && parsed.family !== "EXACT_SCORE")) return fail("NOT_AN_EXTENDED_MARKET");

  const policyReasons: string[] = [];
  const canonicalReasons: string[] = input.forecast.limitations.filter((reason) => reason === "UNRESOLVED_CANONICAL_IDENTITY");
  const cutoffReasons: string[] = input.forecast.limitations.filter((reason) => reason.includes("CUTOFF_MISMATCH"));
  const qualityReasons: string[] = input.forecast.limitations.filter((reason) => !canonicalReasons.includes(reason) && !cutoffReasons.includes(reason));
  if (input.forecast.configVersion !== VALUE_POLICY.forecastConfigVersion || input.odds.schemaVersion !== VALUE_POLICY.oddsSchemaVersion || input.odds.normalizationVersion !== VALUE_POLICY.oddsNormalizationVersion) policyReasons.push("POLICY_CONFIG_MISMATCH");
  if (input.forecast.fixtureId !== input.odds.fixtureId) qualityReasons.push("FIXTURE_MISMATCH");
  const odd = input.odds.selections.find(({ selection }) => selection === input.selection);
  const known = (selectionsFor(input.market) ?? []).some((selection) => selection === input.selection);
  if (!known || !odd || input.odds.market !== input.market) qualityReasons.push("MARKET_SELECTION_MISMATCH");
  const reasons: string[] = [...policyReasons, ...canonicalReasons, ...cutoffReasons, ...qualityReasons];

  const noVig = new ExtDecimal(odd?.noVigProbability ?? 0);
  const decimalOdds = new ExtDecimal(odd?.decimalOdds ?? 1);
  const priced = parsed.family === "ASIAN_HANDICAP"
    ? priceAsianHandicap(parsed.line ?? fail("UNSUPPORTED_VALUE_MARKET"), known && (input.selection === "HOME" || input.selection === "AWAY") ? input.selection : null, input, noVig, decimalOdds)
    : priceExactScore(known ? input.selection : "", input, noVig, decimalOdds);

  const thresholds = VALUE_POLICY.thresholds;
  const gates = [
    { gate: "POLICY", passed: policyReasons.length === 0 },
    { gate: "CANONICAL", passed: canonicalReasons.length === 0 },
    { gate: "CUTOFF", passed: cutoffReasons.length === 0 },
    { gate: "DATA_QUALITY", passed: qualityReasons.length === 0 },
    { gate: "CONFIDENCE", passed: new ExtDecimal(input.forecast.confidence.score).gte(thresholds.minimumConfidence) },
    { gate: "EDGE", passed: priced.edge.gte(thresholds.minimumEdge) },
    { gate: "EXPECTED_VALUE", passed: priced.expectedValue.gte(thresholds.minimumExpectedValue) },
  ] as const;
  if (!gates[4].passed) reasons.push("CONFIDENCE_BELOW_THRESHOLD");
  if (!gates[5].passed) reasons.push("EDGE_BELOW_THRESHOLD");
  if (!gates[6].passed) reasons.push("EV_BELOW_THRESHOLD");
  const insufficient = gates.slice(0, 5).some(({ passed }) => !passed);
  const outcome = insufficient ? "INSUFFICIENT_EVIDENCE" : gates.every(({ passed }) => passed) ? "VALUE_CANDIDATE" : "NO_VALUE";
  return {
    outcome,
    reasons,
    edge: priced.edge.toString(),
    expectedValue: priced.expectedValue.toString(),
    modelProbability: priced.modelProbability.toString(),
    fairOdds: priced.fairOdds,
    receipt: {
      fixtureId: input.forecast.fixtureId,
      forecastSnapshotId: input.forecast.forecastSnapshotId,
      oddsSnapshotId: input.odds.oddsSnapshotId,
      cutoff: input.forecast.cutoff,
      modelVersion: input.forecast.modelVersion,
      configVersion: input.forecast.configVersion,
      configHash: input.forecast.configHash,
      inputHash: input.forecast.inputHash,
      oddsSchemaVersion: input.odds.schemaVersion,
      oddsNormalizationVersion: input.odds.normalizationVersion,
      confidenceVersion: input.forecast.confidence.version,
      valuePolicyVersion: VALUE_POLICY.version,
      evidenceBuildIds: input.forecast.evidenceBuildIds,
      sources: input.forecast.sources,
      assumptions: input.forecast.assumptions,
      formulas: priced.formulas,
      thresholds,
      gates,
      extended: priced.block,
    },
  } as const;
}
