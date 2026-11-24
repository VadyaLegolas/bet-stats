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

/**
 * Evidence a candidate must bring in a market whose event log already holds a ROLLED_BACK event (WR-01). The content id of a
 * refit changes with every new outcome, so "this exact calibrator was rolled back" is not enough: the same calibrator family
 * would come back one day later. The candidate has to prove itself on outcomes that became known only after the latest
 * rollback, i.e. on a window disjoint from everything the rolled-back calibrator was fitted, held out and judged on.
 */
export interface RollbackLineage {
  /** Outcomes of the candidate's holdout whose `knownAt` is strictly after the latest rollback of this market. */
  readonly windowSize: number;
  /** Mean Brier on exactly those outcomes; null when the window is empty or a number could not be computed. */
  readonly brierRaw: number | null;
  readonly brierCandidate: number | null;
  /** Brier of the latest rolled-back calibrator on the same outcomes; null when it is missing or cannot be applied. */
  readonly brierRolledBack: number | null;
}

export interface LifecycleCandidate {
  readonly calibratorId: string;
  readonly promotion: PromotionAssessment;
  /** True when this exact calibrator was ever rolled back. */
  readonly everRolledBack: boolean;
  /**
   * Null only when the market's log holds no ROLLED_BACK event. Required (not optional) so that a caller cannot bypass the
   * rule by forgetting it.
   */
  readonly rollbackLineage: RollbackLineage | null;
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
  | "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK"
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

/**
 * A candidate in a market with a rollback in its history is accepted only when, on the outcomes known after the latest
 * rollback, there are at least `minimumSamples.holdout` of them, it beats the rolled-back calibrator by at least
 * `materiality`, and it is itself not worse than the raw forecast by `materiality` (the promotion gate, on that window).
 * Anything unknown fails closed.
 */
function provenAfterRollback(lineage: RollbackLineage, config: CalibrationConfig): boolean {
  const { windowSize, brierRaw, brierCandidate, brierRolledBack } = lineage;
  if (!Number.isInteger(windowSize) || windowSize < config.minimumSamples.holdout) return false;
  if (brierRaw === null || brierCandidate === null || brierRolledBack === null) return false;
  if (![brierRaw, brierCandidate, brierRolledBack].every(Number.isFinite)) return false;
  return brierRolledBack - brierCandidate >= config.materiality && brierCandidate - brierRaw < config.materiality;
}

/**
 * The rollback-lineage gate guards the way back from a rollback. It applies while the latest ROLLED_BACK event of the market
 * has not yet been followed by the promotion of another calibrator: no calibrator is active (raw only) or the active one is the
 * restored predecessor (activated by that very rollback). Once a calibrator promoted after the rollback is active, later
 * candidates only face the supersession rule against it.
 */
export function rollbackLineageApplies(latestRollbackSeq: number | null, activeActivationSeq: number | null): boolean {
  if (latestRollbackSeq === null) return false;
  return activeActivationSeq === null || activeActivationSeq <= latestRollbackSeq;
}

export interface RollbackLineageInput {
  /** The latest rolled-back calibrator of the market; null when it cannot be read. */
  readonly rolledBack: FittedCalibrator | null;
  /** `asOf` of the latest ROLLED_BACK event. */
  readonly rollbackAsOf: string;
  readonly candidate: FittedCalibrator;
  /** The candidate's holdout window as assessed by `assessCalibrationData`. */
  readonly holdout: readonly CalibrationSample[];
  readonly market: ScoreMarket;
  readonly config: CalibrationConfig;
}

/** Scores the candidate and the rolled-back calibrator on the part of the candidate's holdout that is newer than the rollback. */
export function assessRollbackLineage(input: RollbackLineageInput): RollbackLineage {
  const { rolledBack, rollbackAsOf, candidate, holdout, market, config } = input;
  const boundary = Date.parse(rollbackAsOf);
  if (!Number.isFinite(boundary)) throw calibrationError("INVALID_CALIBRATION_EVALUATION", "rollbackAsOf is not a date");
  const window = holdout.filter((sample) => Date.parse(sample.knownAt) > boundary);
  if (window.length === 0) return { windowSize: 0, brierRaw: null, brierCandidate: null, brierRolledBack: null };
  const own = evaluateCalibrator({ calibrator: candidate, market, samples: window, config });
  let brierRolledBack: number | null = null;
  if (rolledBack !== null) {
    try {
      brierRolledBack = evaluateCalibrator({ calibrator: rolledBack, market, samples: window, config }).brierCalibrated;
    } catch {
      // A rolled-back calibrator that cannot be applied proves nothing: the candidate stays unproven (fail closed).
      brierRolledBack = null;
    }
  }
  return { windowSize: window.length, brierRaw: own.brierRaw, brierCandidate: own.brierCalibrated, brierRolledBack };
}

function decideCandidate(input: LifecycleInput, candidate: LifecycleCandidate | null, active: LifecycleActive | null): LifecycleAction {
  const { config } = input;
  if (candidate === null) return { type: "NO_CHANGE", reasonCode: "NO_CANDIDATE" };
  if (active !== null && candidate.calibratorId === active.calibratorId) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_IS_ACTIVE" };
  if (candidate.everRolledBack) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" };
  if (!candidate.promotion.promotable) return { type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROMOTABLE" };
  if (candidate.rollbackLineage !== null && !provenAfterRollback(candidate.rollbackLineage, config)) {
    return { type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK" };
  }
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
 * - Promotion: only a promotable candidate that was never rolled back and is not the active calibrator. In a market whose
 *   log holds a ROLLED_BACK event the candidate must first be proven on the outcomes known after the latest rollback
 *   (`RollbackLineage`): a refit of the same data family cannot come back as a "new" calibrator the next day. Then, with no
 *   active calibrator it is the first promotion; otherwise the candidate must beat the active calibrator on the candidate's
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

