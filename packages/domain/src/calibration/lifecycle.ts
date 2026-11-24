import type { ScoreMarket } from "../evaluation/scoring.js";

import { applyCalibrator, type CalibrationSample, type FittedCalibrator } from "./calibrator.js";
import type { CalibrationConfig } from "./config.js";
import { calibrationError } from "./errors.js";
import { categoricalBrier } from "./metrics.js";

/**
 * Pure calibrator lifecycle policy (D-05, D-07, D-09). No database, clock or queue: the worker
 * reads the facts from the event log, calls these functions and appends the resulting events.
 */

export type CalibrationVerdict = "BETTER" | "NEUTRAL" | "WORSE";

export type PromotionReasonCode = "OK" | "HOLDOUT_TOO_SMALL" | "HOLDOUT_WORSE_THAN_RAW";

export interface PromotionAssessment {
  readonly promotable: boolean;
  readonly reasonCode: PromotionReasonCode;
}

function assertFinite(value: number, detail: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw calibrationError("INVALID_CALIBRATION_EVALUATION", detail);
}

/**
 * Verdict of an evaluation delta (calibrated Brier minus raw Brier). The boundary is inclusive in both
 * directions: a delta of exactly `+materiality` is WORSE and `-materiality` is BETTER.
 */
export function calibrationVerdict(delta: number, config: CalibrationConfig): CalibrationVerdict {
  assertFinite(delta, "delta is not finite");
  if (delta >= config.materiality) return "WORSE";
  if (delta <= -config.materiality) return "BETTER";
  return "NEUTRAL";
}

/**
 * Promotion gate (D-05). The holdout must reach `minimumSamples.holdout` and the holdout Brier delta
 * (calibrated minus raw) must be STRICTLY below `materiality`. The strict bound is aligned with the
 * WORSE boundary of `calibrationVerdict`: a calibrator that would be judged WORSE is never promoted.
 */
export function isPromotable(
  fitted: Pick<FittedCalibrator, "holdoutSampleSize" | "holdoutBrierRaw" | "holdoutBrierCalibrated">,
  config: CalibrationConfig,
): PromotionAssessment {
  assertFinite(fitted.holdoutBrierRaw, "holdoutBrierRaw is not finite");
  assertFinite(fitted.holdoutBrierCalibrated, "holdoutBrierCalibrated is not finite");
  if (!Number.isInteger(fitted.holdoutSampleSize) || fitted.holdoutSampleSize < config.minimumSamples.holdout) {
    return { promotable: false, reasonCode: "HOLDOUT_TOO_SMALL" };
  }
  if (fitted.holdoutBrierCalibrated - fitted.holdoutBrierRaw >= config.materiality) {
    return { promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" };
  }
  return { promotable: true, reasonCode: "OK" };
}

/**
 * Evaluation of the active calibrator on a window of settled outcomes. For an empty window the Brier
 * numbers, the delta and the verdict are `null` (nothing was measured) and `eligible` is false.
 */
export interface CalibratorEvaluation {
  readonly sampleSize: number;
  readonly brierRaw: number | null;
  readonly brierCalibrated: number | null;
  readonly delta: number | null;
  readonly verdict: CalibrationVerdict | null;
  /** True when `sampleSize >= config.rollback.minimumEvaluationSample`; only eligible evaluations count toward a rollback. */
  readonly eligible: boolean;
}

export interface EvaluateCalibratorInput {
  readonly calibrator: FittedCalibrator;
  readonly market: ScoreMarket;
  readonly samples: readonly CalibrationSample[];
  readonly config: CalibrationConfig;
}

/** Applies the calibrator with its own pinned identity to the raw vectors of the window and scores both. */
export function evaluateCalibrator(input: EvaluateCalibratorInput): CalibratorEvaluation {
  const { calibrator, market, samples, config } = input;
  const sampleSize = samples.length;
  if (sampleSize === 0) {
    return { sampleSize: 0, brierRaw: null, brierCalibrated: null, delta: null, verdict: null, eligible: false };
  }
  let rawTotal = 0;
  let calibratedTotal = 0;
  for (const sample of samples) {
    const calibrated = applyCalibrator(calibrator, calibrator.identity, market, sample.probabilities);
    rawTotal += categoricalBrier(sample.probabilities, sample.outcomeIndex);
    calibratedTotal += categoricalBrier(calibrated, sample.outcomeIndex);
  }
  const brierRaw = rawTotal / sampleSize;
  const brierCalibrated = calibratedTotal / sampleSize;
  const delta = brierCalibrated - brierRaw;
  return {
    sampleSize,
    brierRaw,
    brierCalibrated,
    delta,
    verdict: calibrationVerdict(delta, config),
    eligible: sampleSize >= config.rollback.minimumEvaluationSample,
  };
}

/** An earlier evaluation of the active calibrator, as recovered from the event log (oldest first). */
export interface PriorEvaluation {
  readonly eligible: boolean;
  readonly verdict: CalibrationVerdict | null;
}

export interface LifecycleActive {
  readonly calibratorId: string;
  /** Previously promoted calibrator to restore on rollback; null means "raw probabilities only". */
  readonly restoreTargetId: string | null;
  /** Evaluations recorded since this calibrator was activated, oldest first. */
  readonly priorEvaluations: readonly PriorEvaluation[];
}

export interface LifecycleCandidate {
  readonly calibratorId: string;
  readonly promotion: PromotionAssessment;
  /** True when this exact calibrator was ever rolled back. */
  readonly everRolledBack: boolean;
  /** Candidate's own holdout Brier (calibrated). */
  readonly holdoutBrierCandidate: number;
  /** Brier of the active calibrator on the candidate's holdout window; null when there is no active calibrator. */
  readonly holdoutBrierActive: number | null;
}

export interface LifecycleInput {
  readonly config: CalibrationConfig;
  readonly active: LifecycleActive | null;
  /** Evaluation of the active calibrator on the newest window; null when none was computed. */
  readonly evaluation: CalibratorEvaluation | null;
  readonly candidate: LifecycleCandidate | null;
}

export type NoChangeReasonCode =
  | "NO_CANDIDATE"
  | "CANDIDATE_NOT_PROMOTABLE"
  | "CANDIDATE_PREVIOUSLY_ROLLED_BACK"
  | "CANDIDATE_IS_ACTIVE"
  | "CANDIDATE_NOT_BETTER_THAN_ACTIVE";

export type LifecycleAction =
  | Readonly<{
      type: "RECORD_EVALUATION";
      calibratorId: string;
      sampleSize: number;
      eligible: boolean;
      verdict: CalibrationVerdict | null;
      brierRaw: number | null;
      brierCalibrated: number | null;
      delta: number | null;
    }>
  | Readonly<{
      type: "ROLL_BACK";
      calibratorId: string;
      restoreCalibratorId: string | null;
      reasonCode: "HOLDOUT_REGRESSION";
      consecutiveWorse: number;
    }>
  | Readonly<{
      type: "PROMOTE";
      calibratorId: string;
      predecessorCalibratorId: string | null;
      reasonCode: "FIRST_PROMOTION" | "SUPERSEDES_ACTIVE";
    }>
  | Readonly<{ type: "NO_CHANGE"; reasonCode: NoChangeReasonCode }>;

export interface LifecycleDecision {
  readonly actions: readonly LifecycleAction[];
}

interface NormalisedEvaluation {
  readonly eligible: boolean;
  readonly verdict: CalibrationVerdict | null;
}

/**
 * Eligibility and verdict of the current evaluation are derived from its numbers and the config in
 * the input, never trusted from flags: the same facts under the same config always give the same decision.
 */
function normaliseCurrent(evaluation: CalibratorEvaluation, config: CalibrationConfig): NormalisedEvaluation {
  const verdict = evaluation.delta === null ? null : calibrationVerdict(evaluation.delta, config);
  const eligible = verdict !== null && evaluation.sampleSize > 0 && evaluation.sampleSize >= config.rollback.minimumEvaluationSample;
  return { eligible, verdict };
}

/** Length of the trailing run of WORSE among the eligible evaluations (ineligible ones are skipped, a non-WORSE one ends the run). */
function trailingWorseRun(evaluations: readonly NormalisedEvaluation[]): number {
  let run = 0;
  for (let index = evaluations.length - 1; index >= 0; index -= 1) {
    const entry = evaluations[index]!;
    if (!entry.eligible || entry.verdict === null) continue;
    if (entry.verdict !== "WORSE") break;
    run += 1;
  }
  return run;
}

function decideCandidate(input: LifecycleInput, candidate: LifecycleCandidate | null, active: LifecycleActive | null): LifecycleAction {
  const { config } = input;
  if (candidate === null) return { type: "NO_CHANGE", reasonCode: "NO_CANDIDATE" };
  if (active !== null && candidate.calibratorId === active.calibratorId) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_IS_ACTIVE" };
  if (candidate.everRolledBack) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" };
  if (!candidate.promotion.promotable) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROMOTABLE" };
  if (active === null) {
    return { type: "PROMOTE", calibratorId: candidate.calibratorId, predecessorCalibratorId: null, reasonCode: "FIRST_PROMOTION" };
  }
  assertFinite(candidate.holdoutBrierCandidate, "holdoutBrierCandidate is not finite");
  const activeBrier = candidate.holdoutBrierActive;
  // Fail closed: without the active calibrator's Brier on the candidate holdout, superiority is unproven.
  if (activeBrier === null || !Number.isFinite(activeBrier) || activeBrier - candidate.holdoutBrierCandidate < config.materiality) {
    return { type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_BETTER_THAN_ACTIVE" };
  }
  return { type: "PROMOTE", calibratorId: candidate.calibratorId, predecessorCalibratorId: active.calibratorId, reasonCode: "SUPERSEDES_ACTIVE" };
}

/**
 * Decides what the worker appends to the event log (D-07, D-09, D-10). Pure and deterministic.
 *
 * Action order is fixed: RECORD_EVALUATION first, then at most one of ROLL_BACK / PROMOTE, otherwise one NO_CHANGE.
 * - Rollback: the current evaluation is eligible (sample >= `rollback.minimumEvaluationSample`) and the trailing run of
 *   eligible WORSE evaluations, current included, reaches `rollback.consecutiveWorse`. Ineligible evaluations leave the
 *   run unchanged; an eligible non-WORSE one resets it. A run that rolls back promotes nothing (anti-flapping).
 * - Promotion: only a promotable candidate that was never rolled back and is not the active calibrator. With no active
 *   calibrator it is the first promotion; otherwise the candidate must beat the active calibrator on the candidate's
 *   own holdout by at least `materiality`.
 * Every input is a fact recoverable from the CalibratorEvent log (active record, evaluations since activation, restore target).
 */
export function decideCalibrationLifecycle(input: LifecycleInput): LifecycleDecision {
  const { config, active, evaluation, candidate } = input;
  const actions: LifecycleAction[] = [];

  if (active !== null && evaluation !== null) {
    const current = normaliseCurrent(evaluation, config);
    actions.push({
      type: "RECORD_EVALUATION",
      calibratorId: active.calibratorId,
      sampleSize: evaluation.sampleSize,
      eligible: current.eligible,
      verdict: current.verdict,
      brierRaw: evaluation.brierRaw,
      brierCalibrated: evaluation.brierCalibrated,
      delta: evaluation.delta,
    });
    if (current.eligible) {
      const run = trailingWorseRun([...active.priorEvaluations, current]);
      if (run >= config.rollback.consecutiveWorse) {
        actions.push({
          type: "ROLL_BACK",
          calibratorId: active.calibratorId,
          restoreCalibratorId: active.restoreTargetId,
          reasonCode: "HOLDOUT_REGRESSION",
          consecutiveWorse: run,
        });
        return { actions };
      }
    }
  }

  actions.push(decideCandidate(input, candidate, active));
  return { actions };
}

