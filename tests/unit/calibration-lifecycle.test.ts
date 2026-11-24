import { describe, expect, it } from "vitest";

import { CALIBRATION_CONFIG } from "../../packages/domain/src/calibration/config.js";
import { fitMarketCalibrator, type CalibratorIdentity, type FittedCalibrator } from "../../packages/domain/src/calibration/calibrator.js";
import {
  calibrationVerdict,
  decideCalibrationLifecycle,
  evaluateCalibrator,
  isPromotable,
  type CalibratorEvaluation,
  type LifecycleInput,
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
