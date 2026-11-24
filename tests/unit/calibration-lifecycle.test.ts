import { describe, expect, it } from "vitest";

import { CALIBRATION_CONFIG } from "../../packages/domain/src/calibration/config.js";
import { fitMarketCalibrator, type CalibratorIdentity, type FittedCalibrator } from "../../packages/domain/src/calibration/calibrator.js";
import {
  assessRollbackLineage,
  calibrationVerdict,
  decideCalibrationLifecycle,
  evaluateCalibrator,
  isPromotable,
  rollbackLineageApplies,
  type CalibratorEvaluation,
  type LifecycleActive,
  type LifecycleCandidate,
  type LifecycleDecision,
  type LifecycleInput,
  type PriorEvaluation,
  type RollbackLineage,
} from "../../packages/domain/src/calibration/lifecycle.js";
import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { makeCalibrationSamples } from "../helpers/calibration-samples.js";

const MODEL_VERSION = "dixon-coles-ensemble-v1" as const;
const identity: CalibratorIdentity = { modelVersion: MODEL_VERSION, configHash: forecastConfigHashFor(MODEL_VERSION) };
const ASOF = "2026-12-31T00:00:00.000Z";
const config = CALIBRATION_CONFIG;

const SLOPE = 0.5;
const INTERCEPT = 0.3;

function fitFixture(count: number, seed: number): FittedCalibrator {
  const result = fitMarketCalibrator({
    identity,
    market: "OVER_UNDER_2_5",
    samples: makeCalibrationSamples({ market: "OVER_UNDER_2_5", count, seed, trueSlope: SLOPE, trueIntercept: INTERCEPT }),
    asOf: ASOF,
    config,
  });
  if (result.state !== "FITTED") throw new Error(`fixture must fit, got ${result.state}`);
  return result.calibrator;
}

function stubMetrics(holdoutSampleSize: number, holdoutBrierRaw: number, holdoutBrierCalibrated: number) {
  return { holdoutSampleSize, holdoutBrierRaw, holdoutBrierCalibrated };
}

describe("synthetic calibration samples", () => {
  it("is deterministic for one seed and differs between seeds", () => {
    const first = makeCalibrationSamples({ market: "BTTS", count: 50, seed: 7, trueSlope: SLOPE, trueIntercept: INTERCEPT });
    const second = makeCalibrationSamples({ market: "BTTS", count: 50, seed: 7, trueSlope: SLOPE, trueIntercept: INTERCEPT });
    const other = makeCalibrationSamples({ market: "BTTS", count: 50, seed: 8, trueSlope: SLOPE, trueIntercept: INTERCEPT });
    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("emits one-day kickoff steps, knownAt three hours after kickoff and class-ordered vectors", () => {
    const [a, b] = makeCalibrationSamples({ market: "ONE_X_TWO", count: 2, seed: 1, trueSlope: 1, trueIntercept: 0 });
    expect(Date.parse(b!.kickoffUtc) - Date.parse(a!.kickoffUtc)).toBe(86_400_000);
    expect(Date.parse(a!.knownAt) - Date.parse(a!.kickoffUtc)).toBe(3 * 3_600_000);
    expect(a!.probabilities).toHaveLength(3);
    expect(Math.abs(a!.probabilities.reduce((sum, value) => sum + value, 0) - 1)).toBeLessThan(1e-12);
  });
});

describe("calibrationVerdict (D-07)", () => {
  it.each([
    [0.002, "WORSE"],
    [0.00200001, "WORSE"],
    [0.00199, "NEUTRAL"],
    [0, "NEUTRAL"],
    [-0.00199, "NEUTRAL"],
    [-0.002, "BETTER"],
    [-0.5, "BETTER"],
  ] as const)("delta %s gives %s", (delta, verdict) => {
    expect(calibrationVerdict(delta, config)).toBe(verdict);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects non-finite delta %s", (delta) => {
    expect(() => calibrationVerdict(delta, config)).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_EVALUATION" }));
  });
});

describe("isPromotable (D-05)", () => {
  it("refuses a holdout of 59 and accepts 60", () => {
    expect(isPromotable(stubMetrics(59, 0.5, 0.4), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_TOO_SMALL" });
    expect(isPromotable(stubMetrics(60, 0.5, 0.4), config)).toEqual({ promotable: true, reasonCode: "OK" });
  });

  it("accepts a regression just below the materiality threshold and refuses it at exactly 0.002", () => {
    expect(isPromotable(stubMetrics(60, 0, 0.00199), config)).toEqual({ promotable: true, reasonCode: "OK" });
    expect(isPromotable(stubMetrics(60, 0, 0.002), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" });
    expect(isPromotable(stubMetrics(60, 0, 0.25), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" });
  });

  it("accepts a calibrator that is better than raw", () => {
    expect(isPromotable(stubMetrics(500, 0.5, 0.3), config)).toEqual({ promotable: true, reasonCode: "OK" });
  });

  it("reports the small holdout before the Brier comparison", () => {
    expect(isPromotable(stubMetrics(10, 0, 1), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_TOO_SMALL" });
  });

  it("rejects non-finite Brier numbers", () => {
    expect(() => isPromotable(stubMetrics(60, Number.NaN, 0.4), config)).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_EVALUATION" }));
  });
});

describe("evaluateCalibrator (D-07)", () => {
  const calibrator = fitFixture(400, 101);
  const window = makeCalibrationSamples({ market: "OVER_UNDER_2_5", count: 60, seed: 202, trueSlope: SLOPE, trueIntercept: INTERCEPT, indexOffset: 1000 });

  it("reports sample size, both Briers, the delta and the verdict on a fresh window", () => {
    const evaluation = evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: window, config });
    expect(evaluation.sampleSize).toBe(60);
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.delta).toBeCloseTo(evaluation.brierCalibrated! - evaluation.brierRaw!, 12);
    expect(evaluation.verdict).toBe(calibrationVerdict(evaluation.delta!, config));
  });

  it("uses a sample size of 29 as ineligible and 30 as eligible", () => {
    expect(evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: window.slice(0, 29), config }).eligible).toBe(false);
    expect(evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: window.slice(0, 30), config }).eligible).toBe(true);
  });

  it("handles an empty window without dividing by zero", () => {
    const evaluation = evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: [], config });
    expect(evaluation).toEqual({ sampleSize: 0, brierRaw: null, brierCalibrated: null, delta: null, verdict: null, eligible: false });
  });

  it("refuses a market other than the calibrator's own", () => {
    expect(() => evaluateCalibrator({ calibrator, market: "BTTS", samples: window, config })).toThrowError(
      expect.objectContaining({ code: "CALIBRATOR_MARKET_MISMATCH" }),
    );
  });
});

describe("end to end: candidate, promotion gate, first promotion, evaluation", () => {
  it("promotes a fitted miscalibrated candidate and scores it BETTER on a fresh window of 60", () => {
    const candidate = fitFixture(400, 101);
    const promotion = isPromotable(candidate, config);
    expect(promotion).toEqual({ promotable: true, reasonCode: "OK" });

    const input: LifecycleInput = {
      config,
      active: null,
      evaluation: null,
      candidate: {
        calibratorId: "cal-first",
        promotion,
        everRolledBack: false,
        rollbackLineage: null,
        holdoutBrierCandidate: candidate.holdoutBrierCalibrated,
        holdoutBrierActive: null,
      },
    };
    expect(decideCalibrationLifecycle(input).actions).toEqual([
      { type: "PROMOTE", calibratorId: "cal-first", predecessorCalibratorId: null, reasonCode: "FIRST_PROMOTION" },
    ]);

    const fresh = makeCalibrationSamples({ market: "OVER_UNDER_2_5", count: 60, seed: 303, trueSlope: SLOPE, trueIntercept: INTERCEPT, indexOffset: 5000 });
    const evaluation: CalibratorEvaluation = evaluateCalibrator({ calibrator: candidate, market: "OVER_UNDER_2_5", samples: fresh, config });
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.verdict).toBe("BETTER");
  });
});

describe("first-promotion decision without an active calibrator", () => {
  const base = (overrides: Partial<NonNullable<LifecycleInput["candidate"]>> = {}): LifecycleInput => ({
    config,
    active: null,
    evaluation: null,
    candidate: {
      calibratorId: "cal-1",
      promotion: { promotable: true, reasonCode: "OK" },
      everRolledBack: false,
      rollbackLineage: null,
      holdoutBrierCandidate: 0.4,
      holdoutBrierActive: null,
      ...overrides,
    },
  });

  it("returns NO_CHANGE without a candidate", () => {
    expect(decideCalibrationLifecycle({ ...base(), candidate: null }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "NO_CANDIDATE" }]);
  });

  it("returns NO_CHANGE for a candidate that failed the promotion gate", () => {
    const result = decideCalibrationLifecycle(base({ promotion: { promotable: false, reasonCode: "HOLDOUT_TOO_SMALL" } }));
    expect(result.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROMOTABLE" }]);
  });

  it("returns NO_CHANGE for a candidate that was rolled back before", () => {
    const result = decideCalibrationLifecycle(base({ everRolledBack: true }));
    expect(result.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" }]);
  });

  it("is deterministic", () => {
    expect(decideCalibrationLifecycle(base())).toEqual(decideCalibrationLifecycle(base()));
  });
});

// ---------------------------------------------------------------------------------------------
// Task 2: rollback hysteresis (D-07), rollback target and no re-promotion (D-09), supersession
// ---------------------------------------------------------------------------------------------

type Step = "W" | "N" | "B" | "x";

const DELTA_BY_STEP = { W: 0.01, N: 0, B: -0.01, x: 0.01 } as const;

/** One recorded evaluation: W = WORSE, N = NEUTRAL, B = BETTER, x = WORSE on an ineligible window. */
function priorOf(step: Step): PriorEvaluation {
  if (step === "x") return { eligible: false, verdict: "WORSE" };
  return { eligible: true, verdict: step === "W" ? "WORSE" : step === "B" ? "BETTER" : "NEUTRAL" };
}

function evaluationOf(step: Step, sampleSize = 60): CalibratorEvaluation {
  const delta = DELTA_BY_STEP[step];
  const verdict = step === "W" || step === "x" ? "WORSE" : step === "B" ? "BETTER" : "NEUTRAL";
  return { sampleSize, brierRaw: 0.5, brierCalibrated: 0.5 + delta, delta, verdict, eligible: sampleSize >= 30 };
}

function activeOf(steps: readonly Step[], restoreTargetId: string | null = "cal-previous"): LifecycleActive {
  return { calibratorId: "cal-active", restoreTargetId, priorEvaluations: steps.map(priorOf) };
}

function candidateOf(overrides: Partial<LifecycleCandidate> = {}): LifecycleCandidate {
  return {
    calibratorId: "cal-candidate",
    promotion: { promotable: true, reasonCode: "OK" },
    everRolledBack: false,
    rollbackLineage: null,
    holdoutBrierCandidate: 0.4,
    holdoutBrierActive: 0.5,
    ...overrides,
  };
}

function decide(overrides: Partial<LifecycleInput>): LifecycleDecision {
  return decideCalibrationLifecycle({ config, active: null, evaluation: null, candidate: null, ...overrides });
}

const types = (decision: LifecycleDecision): string[] => decision.actions.map((action) => action.type);

describe("rollback hysteresis (D-07, D-10)", () => {
  it("records a single WORSE evaluation without rolling back", () => {
    const decision = decide({ active: activeOf([]), evaluation: evaluationOf("W") });
    expect(types(decision)).not.toContain("ROLL_BACK");
    expect(decision.actions[0]).toMatchObject({ type: "RECORD_EVALUATION", calibratorId: "cal-active", verdict: "WORSE", eligible: true, sampleSize: 60 });
  });

  it("carries the evaluation numbers into the recorded action", () => {
    const decision = decide({ active: activeOf([]), evaluation: evaluationOf("B", 45) });
    expect(decision.actions[0]).toEqual({
      type: "RECORD_EVALUATION",
      calibratorId: "cal-active",
      sampleSize: 45,
      eligible: true,
      verdict: "BETTER",
      brierRaw: 0.5,
      brierCalibrated: 0.49,
      delta: -0.01,
    });
  });

  it.each<[string, readonly Step[], Step, number, boolean]>([
    ["WORSE, WORSE: two in a row do not roll back", ["W"], "W", 60, false],
    ["WORSE, WORSE, WORSE: the third in a row rolls back", ["W", "W"], "W", 60, true],
    ["WORSE, WORSE, NEUTRAL, WORSE: NEUTRAL resets the series", ["W", "W", "N"], "W", 60, false],
    ["WORSE, WORSE, BETTER, WORSE, WORSE: BETTER resets the series", ["W", "W", "B", "W"], "W", 60, false],
    ["WORSE, WORSE, BETTER, WORSE, WORSE, WORSE: one more rolls back", ["W", "W", "B", "W", "W"], "W", 60, true],
    ["NEUTRAL before the series does not matter", ["N", "W", "W"], "W", 60, true],
    ["WORSE, ineligible, WORSE, WORSE: the ineligible one is skipped", ["W", "x", "W"], "W", 60, true],
    ["WORSE, WORSE, ineligible (prior), WORSE: skipping does not reset", ["W", "W", "x"], "W", 60, true],
    ["WORSE, WORSE, ineligible current: no rollback", ["W", "W"], "W", 29, false],
    ["WORSE, WORSE, current of exactly 30 is eligible: rollback", ["W", "W"], "W", 30, true],
    ["ineligible current never rolls back whatever the past", ["W", "W", "W", "W"], "W", 0, false],
    ["current NEUTRAL after two WORSE: no rollback", ["W", "W"], "N", 60, false],
    ["current BETTER after two WORSE: no rollback", ["W", "W"], "B", 60, false],
  ])("%s", (_name, priors, current, sampleSize, expectRollback) => {
    const decision = decide({ active: activeOf(priors), evaluation: evaluationOf(current, sampleSize) });
    expect(types(decision).includes("ROLL_BACK")).toBe(expectRollback);
  });

  it("counts the current evaluation toward the series and reports it", () => {
    const decision = decide({ active: activeOf(["W", "W"]), evaluation: evaluationOf("W") });
    expect(decision.actions).toEqual([
      expect.objectContaining({ type: "RECORD_EVALUATION" }),
      { type: "ROLL_BACK", calibratorId: "cal-active", restoreCalibratorId: "cal-previous", reasonCode: "HOLDOUT_REGRESSION", consecutiveWorse: 3 },
    ]);
  });

  it("never rolls back without a current evaluation", () => {
    expect(types(decide({ active: activeOf(["W", "W", "W"]), evaluation: null }))).not.toContain("ROLL_BACK");
  });

  it("records an ineligible evaluation as such", () => {
    const decision = decide({ active: activeOf(["W"]), evaluation: evaluationOf("W", 29) });
    expect(decision.actions[0]).toMatchObject({ type: "RECORD_EVALUATION", eligible: false, sampleSize: 29 });
  });

  it("ignores an evaluation when there is no active calibrator", () => {
    expect(types(decide({ active: null, evaluation: evaluationOf("W") }))).toEqual(["NO_CHANGE"]);
  });
});

describe("rollback target (D-09)", () => {
  it("restores the previous promoted calibrator", () => {
    const decision = decide({ active: activeOf(["W", "W"], "cal-previous"), evaluation: evaluationOf("W") });
    expect(decision.actions.at(-1)).toMatchObject({ type: "ROLL_BACK", restoreCalibratorId: "cal-previous" });
  });

  it("falls back to raw probabilities when there is no predecessor", () => {
    const decision = decide({ active: activeOf(["W", "W"], null), evaluation: evaluationOf("W") });
    const rollback = decision.actions.at(-1);
    expect(rollback).toMatchObject({ type: "ROLL_BACK", restoreCalibratorId: null });
    expect(rollback).toHaveProperty("restoreCalibratorId", null);
  });

  it("promotes nothing in a run that rolls back, even with a promotable better candidate", () => {
    const decision = decide({
      active: activeOf(["W", "W"]),
      evaluation: evaluationOf("W"),
      candidate: candidateOf({ holdoutBrierCandidate: 0.1, holdoutBrierActive: 0.9 }),
    });
    expect(types(decision)).toEqual(["RECORD_EVALUATION", "ROLL_BACK"]);
  });
});

describe("candidate eligibility with an active calibrator (D-09)", () => {
  it("never promotes a calibrator that was rolled back before, whatever its metrics", () => {
    const rolledBack = candidateOf({ everRolledBack: true, holdoutBrierCandidate: 0.01, holdoutBrierActive: 0.9 });
    expect(decide({ active: activeOf([]), candidate: rolledBack }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" }]);
    expect(decide({ active: null, candidate: rolledBack }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" }]);
  });

  it("ignores a candidate identical to the active calibrator", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ calibratorId: "cal-active" }) });
    expect(decision.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_IS_ACTIVE" }]);
  });

  it("does not promote a candidate that failed the promotion gate", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ promotion: { promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" } }) });
    expect(decision.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROMOTABLE" }]);
  });
});

// ---------------------------------------------------------------------------------------------
// WR-01: a refit of a rolled-back calibrator family cannot come back the next day
// ---------------------------------------------------------------------------------------------

describe("rollback lineage gate (WR-01)", () => {
  const proven = (overrides: Partial<RollbackLineage> = {}): RollbackLineage => ({ windowSize: 60, brierRaw: 0.5, brierCandidate: 0.5, brierRolledBack: 0.502, ...overrides });
  const notProven = { type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK" } as const;

  it("lets a candidate in a market without a rollback through, exactly as before", () => {
    expect(decide({ active: activeOf([]), candidate: candidateOf() }).actions).toEqual([{ type: "PROMOTE", calibratorId: "cal-candidate", predecessorCalibratorId: "cal-active", reasonCode: "SUPERSEDES_ACTIVE" }]);
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: null }) }).actions[0]).toMatchObject({ type: "PROMOTE", reasonCode: "FIRST_PROMOTION" });
  });

  it("refuses a different content id of the rolled-back family: first promotion after a rollback to raw needs proof", () => {
    // A new content id (everRolledBack false), promotable, no active calibrator: this used to be promoted at once.
    const refit = candidateOf({ everRolledBack: false, rollbackLineage: proven({ brierRolledBack: 0.5005 }) });
    expect(decide({ active: null, candidate: refit }).actions).toEqual([notProven]);
  });

  it("promotes only when the candidate beats the rolled-back calibrator by at least materiality on a window of at least 60 after the rollback", () => {
    const first = (lineage: RollbackLineage) => decide({ active: null, candidate: candidateOf({ rollbackLineage: lineage }) }).actions[0];
    expect(first(proven())).toEqual({ type: "PROMOTE", calibratorId: "cal-candidate", predecessorCalibratorId: null, reasonCode: "FIRST_PROMOTION" });
    expect(first(proven({ brierRolledBack: 0.50199 }))).toEqual(notProven);
    expect(first(proven({ windowSize: 59 }))).toEqual(notProven);
    expect(first(proven({ windowSize: 0, brierRaw: null, brierCandidate: null, brierRolledBack: null }))).toEqual(notProven);
  });

  it("is not satisfied by a candidate that beats the rolled-back calibrator but is itself worse than raw by materiality", () => {
    const lineage = proven({ brierRaw: 0.4, brierCandidate: 0.402, brierRolledBack: 0.45 });
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: lineage }) }).actions).toEqual([notProven]);
  });

  it.each<[string, Partial<RollbackLineage>]>([
    ["an unknown candidate Brier", { brierCandidate: null }],
    ["an unknown rolled-back Brier", { brierRolledBack: null }],
    ["an unknown raw Brier", { brierRaw: null }],
    ["a non-finite Brier", { brierRolledBack: Number.NaN }],
  ])("fails closed on %s", (_name, overrides) => {
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: proven(overrides) }) }).actions).toEqual([notProven]);
  });

  it("also guards supersession of the restored predecessor, after the promotion gate and before the supersession margin", () => {
    const strong = { holdoutBrierCandidate: 0.1, holdoutBrierActive: 0.9 };
    expect(decide({ active: activeOf([]), candidate: candidateOf({ ...strong, rollbackLineage: proven({ windowSize: 10 }) }) }).actions).toEqual([notProven]);
    expect(decide({ active: activeOf([]), candidate: candidateOf({ ...strong, rollbackLineage: proven() }) }).actions[0]).toMatchObject({ type: "PROMOTE", reasonCode: "SUPERSEDES_ACTIVE" });
    const unpromotable = candidateOf({ ...strong, rollbackLineage: proven(), promotion: { promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" } });
    expect(decide({ active: activeOf([]), candidate: unpromotable }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROMOTABLE" }]);
  });

  it("the exact rolled-back calibrator stays refused whatever the evidence", () => {
    const exact = candidateOf({ everRolledBack: true, rollbackLineage: proven({ brierRolledBack: 0.9 }) });
    expect(decide({ active: null, candidate: exact }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_PREVIOUSLY_ROLLED_BACK" }]);
  });

  it("applies until a calibrator promoted after the latest rollback is active", () => {
    expect(rollbackLineageApplies(null, null)).toBe(false);
    expect(rollbackLineageApplies(null, 5)).toBe(false);
    expect(rollbackLineageApplies(40, null)).toBe(true);
    expect(rollbackLineageApplies(40, 40)).toBe(true);
    expect(rollbackLineageApplies(40, 12)).toBe(true);
    expect(rollbackLineageApplies(40, 41)).toBe(false);
  });
});

describe("assessRollbackLineage (WR-01)", () => {
  // R was fitted on a strongly over-confident process and softens hard; the new regime is under-confident (true slope 1.5), where a sharpener helps.
  const rolledBack = fitFixture(400, 101);
  const holdout = makeCalibrationSamples({ market: "OVER_UNDER_2_5", count: 200, seed: 77, trueSlope: 1.5, trueIntercept: 0, indexOffset: 2000 });
  const knownAtOf = (index: number): string => holdout[index]!.knownAt;
  const fitOn = (seed: number, trueSlope: number, trueIntercept: number, count = 400): FittedCalibrator => {
    const result = fitMarketCalibrator({
      identity, market: "OVER_UNDER_2_5", samples: makeCalibrationSamples({ market: "OVER_UNDER_2_5", count, seed, trueSlope, trueIntercept }), asOf: ASOF, config,
    });
    if (result.state !== "FITTED") throw new Error("fixture must fit");
    return result.calibrator;
  };
  const input = (overrides: Partial<Parameters<typeof assessRollbackLineage>[0]> = {}): Parameters<typeof assessRollbackLineage>[0] => ({
    rolledBack, rollbackAsOf: knownAtOf(99), candidate: fitOn(303, 1.5, 0), holdout, market: "OVER_UNDER_2_5", config, ...overrides,
  });

  it("counts only holdout outcomes known strictly after the rollback", () => {
    expect(assessRollbackLineage(input({ rollbackAsOf: knownAtOf(139) })).windowSize).toBe(60);
    expect(assessRollbackLineage(input({ rollbackAsOf: knownAtOf(99) })).windowSize).toBe(100);
    expect(assessRollbackLineage(input({ rollbackAsOf: knownAtOf(199) })).windowSize).toBe(0);
    expect(assessRollbackLineage(input({ rollbackAsOf: "2000-01-01T00:00:00.000Z" })).windowSize).toBe(200);
  });

  it("an empty window carries no numbers", () => {
    expect(assessRollbackLineage(input({ rollbackAsOf: knownAtOf(199) }))).toEqual({ windowSize: 0, brierRaw: null, brierCandidate: null, brierRolledBack: null });
  });

  it("scores the candidate and the rolled-back calibrator on the same window", () => {
    const request = input();
    const lineage = assessRollbackLineage(request);
    const window = holdout.slice(100);
    const own = evaluateCalibrator({ calibrator: request.candidate, market: "OVER_UNDER_2_5", samples: window, config });
    const old = evaluateCalibrator({ calibrator: rolledBack, market: "OVER_UNDER_2_5", samples: window, config });
    expect(lineage.brierCandidate).toBeCloseTo(own.brierCalibrated!, 12);
    expect(lineage.brierRaw).toBeCloseTo(own.brierRaw!, 12);
    expect(lineage.brierRolledBack).toBeCloseTo(old.brierCalibrated!, 12);
  });

  it("a candidate fitted on the new regime beats the rolled-back calibrator and is promoted; a refit of the same family is not", () => {
    const fresh = assessRollbackLineage(input());
    expect(fresh.windowSize).toBe(100);
    expect(fresh.brierRolledBack! - fresh.brierCandidate!).toBeGreaterThanOrEqual(config.materiality);
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: fresh }) }).actions[0]).toMatchObject({ type: "PROMOTE", reasonCode: "FIRST_PROMOTION" });

    // Same family as R (fitted on the same over-confident process, a few more days of data): no better than R on the new window.
    const refit = assessRollbackLineage(input({ candidate: fitOn(102, 0.5, 0.3, 420) }));
    expect(refit.brierRolledBack! - refit.brierCandidate!).toBeLessThan(config.materiality);
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: refit }) }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK" }]);
  });

  it("fails closed when the rolled-back calibrator is missing or cannot be applied", () => {
    expect(assessRollbackLineage(input({ rolledBack: null })).brierRolledBack).toBeNull();
    const broken = { ...rolledBack, parameters: { epsilon: rolledBack.parameters.epsilon, scalers: [{ slope: Number.NaN, intercept: 0 }] } } as unknown as FittedCalibrator;
    const lineage = assessRollbackLineage(input({ rolledBack: broken }));
    expect(lineage.brierRolledBack).toBeNull();
    expect(decide({ active: null, candidate: candidateOf({ rollbackLineage: lineage }) }).actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK" }]);
  });

  it("rejects a rollbackAsOf that is not a date", () => {
    expect(() => assessRollbackLineage(input({ rollbackAsOf: "soon" }))).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_EVALUATION" }));
  });
});

describe("supersession of the active calibrator (D-02, D-09)", () => {
  it("promotes when the active calibrator is worse on the candidate holdout by at least materiality", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ holdoutBrierActive: 0.002, holdoutBrierCandidate: 0 }) });
    expect(decision.actions).toEqual([{ type: "PROMOTE", calibratorId: "cal-candidate", predecessorCalibratorId: "cal-active", reasonCode: "SUPERSEDES_ACTIVE" }]);
  });

  it("does not promote at a difference of 0.00199", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ holdoutBrierActive: 0.00199, holdoutBrierCandidate: 0 }) });
    expect(decision.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_BETTER_THAN_ACTIVE" }]);
  });

  it("does not promote a worse candidate", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ holdoutBrierActive: 0.4, holdoutBrierCandidate: 0.5 }) });
    expect(decision.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_BETTER_THAN_ACTIVE" }]);
  });

  it("fails closed when the active Brier on the candidate holdout is unknown", () => {
    const decision = decide({ active: activeOf([]), candidate: candidateOf({ holdoutBrierActive: null }) });
    expect(decision.actions).toEqual([{ type: "NO_CHANGE", reasonCode: "CANDIDATE_NOT_BETTER_THAN_ACTIVE" }]);
  });

  it("records the evaluation before the promotion", () => {
    const decision = decide({ active: activeOf([]), evaluation: evaluationOf("N"), candidate: candidateOf() });
    expect(types(decision)).toEqual(["RECORD_EVALUATION", "PROMOTE"]);
  });

  it("rejects non-finite candidate numbers instead of guessing", () => {
    expect(() => decide({ active: activeOf([]), candidate: candidateOf({ holdoutBrierCandidate: Number.NaN }) })).toThrowError(
      expect.objectContaining({ code: "INVALID_CALIBRATION_EVALUATION" }),
    );
  });
});

describe("determinism and ordering", () => {
  it("returns equal decisions for equal inputs", () => {
    const input: LifecycleInput = { config, active: activeOf(["W", "W"]), evaluation: evaluationOf("W"), candidate: candidateOf() };
    expect(decideCalibrationLifecycle(input)).toEqual(decideCalibrationLifecycle(input));
  });

  it("does not mutate its input", () => {
    const active = activeOf(["W", "W"]);
    const before = JSON.stringify(active);
    decide({ active, evaluation: evaluationOf("W") });
    expect(JSON.stringify(active)).toBe(before);
  });
});

describe("thresholds come from the config, not from literals (D-07)", () => {
  const rollbackConfig = { ...config, rollback: { consecutiveWorse: 2, minimumEvaluationSample: 10 } };

  it("rolls back after two WORSE evaluations when the configured series is 2", () => {
    const input = { active: activeOf(["W"]), evaluation: evaluationOf("W", 60) };
    expect(types(decide(input))).not.toContain("ROLL_BACK");
    expect(types(decideCalibrationLifecycle({ config: rollbackConfig, candidate: null, ...input }))).toContain("ROLL_BACK");
  });

  it("treats a window of 10 as eligible only when the configured minimum is 10", () => {
    const input = { active: activeOf(["W", "W"]), evaluation: evaluationOf("W", 10) };
    expect(types(decide(input))).not.toContain("ROLL_BACK");
    expect(types(decideCalibrationLifecycle({ config: rollbackConfig, candidate: null, ...input }))).toContain("ROLL_BACK");
  });

  it("does not roll back when the configured minimum is raised above the window", () => {
    const strict = { ...config, rollback: { consecutiveWorse: 3, minimumEvaluationSample: 100 } };
    const decision = decideCalibrationLifecycle({ config: strict, active: activeOf(["W", "W"]), evaluation: evaluationOf("W", 60), candidate: null });
    expect(types(decision)).not.toContain("ROLL_BACK");
    expect(decision.actions[0]).toMatchObject({ type: "RECORD_EVALUATION", eligible: false });
  });

  it("evaluateCalibrator follows the configured minimum evaluation sample", () => {
    const calibrator = fitFixture(400, 101);
    const window = makeCalibrationSamples({ market: "OVER_UNDER_2_5", count: 15, seed: 404, trueSlope: SLOPE, trueIntercept: INTERCEPT, indexOffset: 9000 });
    expect(evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: window, config }).eligible).toBe(false);
    expect(evaluateCalibrator({ calibrator, market: "OVER_UNDER_2_5", samples: window, config: rollbackConfig }).eligible).toBe(true);
  });

  it("promotion gate and verdict follow the configured holdout minimum and materiality", () => {
    const loose = { ...config, minimumSamples: { ...config.minimumSamples, holdout: 10 }, materiality: 0.5 };
    expect(isPromotable(stubMetrics(10, 0, 0.4), loose)).toEqual({ promotable: true, reasonCode: "OK" });
    expect(isPromotable(stubMetrics(10, 0, 0.4), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_TOO_SMALL" });
    expect(isPromotable(stubMetrics(60, 0, 0.4), config)).toEqual({ promotable: false, reasonCode: "HOLDOUT_WORSE_THAN_RAW" });
    expect(calibrationVerdict(0.4, loose)).toBe("NEUTRAL");
    expect(calibrationVerdict(0.4, config)).toBe("WORSE");
  });
});
