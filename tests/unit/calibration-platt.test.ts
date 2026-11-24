import { describe, expect, it } from "vitest";

import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { canonicalSha256 } from "../../packages/domain/src/forecast/canonical-json.js";
import {
  CALIBRATION_CONFIG,
  CALIBRATION_CONFIG_HASH,
  CALIBRATION_CONFIG_VERSION,
} from "../../packages/domain/src/calibration/config.js";
import { categoricalBrier, meanCategoricalBrier } from "../../packages/domain/src/calibration/metrics.js";
import { calibrationOutcomeIndex } from "../../packages/domain/src/calibration/outcome.js";
import { applyPlatt, fitPlatt, type PlattPoint } from "../../packages/domain/src/calibration/platt.js";
import {
  applyCalibrator,
  fitMarketCalibrator,
  type CalibrationSample,
  type CalibratorIdentity,
} from "../../packages/domain/src/calibration/calibrator.js";

// Deterministic PRNG (mulberry32) so the synthetic fixtures are bit-reproducible.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Raw probabilities uniform in [0.15, 0.85]; the truth is sigma(slope * logit(p) + intercept). */
function syntheticPoints(count: number, seed: number, slope: number, intercept: number): PlattPoint[] {
  const random = mulberry32(seed);
  const points: PlattPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const probability = 0.15 + 0.7 * random();
    const truth = sigmoid(slope * logit(probability) + intercept);
    points.push({ probability, label: random() < truth ? 1 : 0 });
  }
  return points;
}

function meanBrier(points: readonly PlattPoint[], transform: (probability: number) => number): number {
  return meanCategoricalBrier(
    points.map((point) => {
      const calibrated = transform(point.probability);
      return { probabilities: [calibrated, 1 - calibrated], outcomeIndex: point.label === 1 ? 0 : 1 };
    }),
  );
}

describe("calibration config (D-07)", () => {
  it("carries the D-07 values verbatim", () => {
    expect(CALIBRATION_CONFIG.version).toBe("calibration-config-v1");
    expect(CALIBRATION_CONFIG_VERSION).toBe("calibration-config-v1");
    expect([...CALIBRATION_CONFIG.markets]).toEqual(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"]);
    expect(CALIBRATION_CONFIG.minimumSamples).toEqual({ platt: 300, isotonic: 1500, holdout: 60 });
    expect(CALIBRATION_CONFIG.holdoutFraction).toBe(0.2);
    expect(CALIBRATION_CONFIG.materiality).toBe(0.002);
    expect(CALIBRATION_CONFIG.rollback).toEqual({ consecutiveWorse: 3, minimumEvaluationSample: 30 });
    expect(CALIBRATION_CONFIG.probabilityClipEpsilon).toBe(1e-6);
    expect(CALIBRATION_CONFIG.cadence).toEqual({ interval: "daily", intervalHours: 24 });
    expect({ kinds: [...CALIBRATION_CONFIG.fit.kinds], servedKinds: [...CALIBRATION_CONFIG.fit.servedKinds] }).toEqual({
      kinds: ["PRE_MATCH"],
      servedKinds: ["PRE_MATCH", "LINEUP_CONFIRMED"],
    });
    expect(CALIBRATION_CONFIG.platt.maxIterations).toBeGreaterThan(0);
    expect(CALIBRATION_CONFIG.platt.gradientTolerance).toBeGreaterThan(0);
    expect(CALIBRATION_CONFIG.platt.priorStrength).toBeGreaterThan(0);
  });

  it("is frozen, including nested objects", () => {
    expect(Object.isFrozen(CALIBRATION_CONFIG)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_CONFIG.minimumSamples)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_CONFIG.rollback)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_CONFIG.platt)).toBe(true);
    expect(Object.isFrozen(CALIBRATION_CONFIG.markets)).toBe(true);
  });

  it("hashes to sha256:<64 hex> and changes with any value", () => {
    expect(CALIBRATION_CONFIG_HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(CALIBRATION_CONFIG_HASH).toBe(canonicalSha256(CALIBRATION_CONFIG));
    expect(canonicalSha256({ ...CALIBRATION_CONFIG, materiality: 0.003 })).not.toBe(CALIBRATION_CONFIG_HASH);
    expect(
      canonicalSha256({ ...CALIBRATION_CONFIG, minimumSamples: { ...CALIBRATION_CONFIG.minimumSamples, platt: 301 } }),
    ).not.toBe(CALIBRATION_CONFIG_HASH);
    expect(canonicalSha256({ ...CALIBRATION_CONFIG, probabilityClipEpsilon: 1e-5 })).not.toBe(CALIBRATION_CONFIG_HASH);
  });
});

describe("outcome index and Brier metric", () => {
  it("maps goals to the class index used by SCORE_CLASS_ORDER", () => {
    expect(calibrationOutcomeIndex("ONE_X_TWO", 2, 1)).toBe(0);
    expect(calibrationOutcomeIndex("ONE_X_TWO", 1, 1)).toBe(1);
    expect(calibrationOutcomeIndex("ONE_X_TWO", 0, 3)).toBe(2);
    expect(calibrationOutcomeIndex("OVER_UNDER_2_5", 2, 1)).toBe(0);
    expect(calibrationOutcomeIndex("OVER_UNDER_2_5", 1, 1)).toBe(1);
    expect(calibrationOutcomeIndex("OVER_UNDER_2_5", 0, 0)).toBe(1);
    expect(calibrationOutcomeIndex("BTTS", 1, 1)).toBe(0);
    expect(calibrationOutcomeIndex("BTTS", 3, 0)).toBe(1);
  });

  it("uses the unscaled categorical sum (range 0 to 2)", () => {
    expect(categoricalBrier([0.7, 0.3], 0)).toBeCloseTo(0.09 + 0.09, 12);
    expect(categoricalBrier([0.5, 0.3, 0.2], 2)).toBeCloseTo(0.25 + 0.09 + 0.64, 12);
    expect(categoricalBrier([0, 1], 0)).toBe(2);
  });
});

describe("Platt scaling by Newton steps", () => {
  it("recovers a known over-confident, biased miscalibration (slope 0.6, intercept 0.25)", () => {
    const fit = fitPlatt(syntheticPoints(4000, 20261124, 0.6, 0.25));
    expect(fit.converged).toBe(true);
    expect(Math.abs(fit.slope - 0.6)).toBeLessThan(0.1);
    expect(Math.abs(fit.intercept - 0.25)).toBeLessThan(0.1);
  });

  it("lowers Brier on an independent sample by more than the materiality threshold", () => {
    const fit = fitPlatt(syntheticPoints(4000, 20261124, 0.6, 0.25));
    const holdout = syntheticPoints(4000, 777, 0.6, 0.25);
    const raw = meanBrier(holdout, (probability) => probability);
    const calibrated = meanBrier(holdout, (probability) => applyPlatt(fit, probability));
    expect(raw - calibrated).toBeGreaterThan(CALIBRATION_CONFIG.materiality);
  });

  it("stays near the identity on already calibrated probabilities", () => {
    const fit = fitPlatt(syntheticPoints(4000, 99, 1, 0));
    expect(Math.abs(fit.slope - 1)).toBeLessThan(0.1);
    expect(Math.abs(fit.intercept)).toBeLessThan(0.1);
    const holdout = syntheticPoints(4000, 100, 1, 0);
    const raw = meanBrier(holdout, (probability) => probability);
    const calibrated = meanBrier(holdout, (probability) => applyPlatt(fit, probability));
    expect(Math.abs(raw - calibrated)).toBeLessThan(CALIBRATION_CONFIG.materiality);
  });

  it("keeps a perfectly separable sample finite thanks to the L2 prior to the identity", () => {
    const points: PlattPoint[] = [];
    for (let index = 0; index < 400; index += 1) {
      const probability = 0.05 + 0.9 * (index / 399);
      points.push({ probability, label: probability > 0.5 ? 1 : 0 });
    }
    const fit = fitPlatt(points);
    expect(Number.isFinite(fit.slope)).toBe(true);
    expect(Number.isFinite(fit.intercept)).toBe(true);
    expect(fit.slope).toBeGreaterThan(1);
    expect(fit.iterations).toBeLessThanOrEqual(CALIBRATION_CONFIG.platt.maxIterations);
  });

  it("keeps a degenerate sample (one probability, one label) finite", () => {
    const points: PlattPoint[] = Array.from({ length: 50 }, () => ({ probability: 0.4, label: 1 as const }));
    const fit = fitPlatt(points);
    expect(Number.isFinite(fit.slope)).toBe(true);
    expect(Number.isFinite(fit.intercept)).toBe(true);
  });

  it("clips extreme inputs 0 and 1 strictly inside [epsilon, 1 - epsilon]", () => {
    const epsilon = CALIBRATION_CONFIG.probabilityClipEpsilon;
    const fit = fitPlatt([
      { probability: 0, label: 0 },
      { probability: 1, label: 1 },
      { probability: 0.3, label: 0 },
      { probability: 0.7, label: 1 },
      { probability: 0.5, label: 1 },
      { probability: 0.5, label: 0 },
    ]);
    for (const input of [0, 1, 1e-12, 1 - 1e-12]) {
      const output = applyPlatt(fit, input);
      expect(Number.isFinite(output)).toBe(true);
      expect(output).toBeGreaterThanOrEqual(epsilon);
      expect(output).toBeLessThanOrEqual(1 - epsilon);
    }
    const extremeParameters = { slope: 50, intercept: 40, iterations: 0, converged: true };
    expect(applyPlatt(extremeParameters, 1)).toBe(1 - epsilon);
    expect(applyPlatt({ ...extremeParameters, slope: -50, intercept: -40 }, 1)).toBe(epsilon);
  });

  it("rejects non-finite input with CALIBRATION_FIT_FAILED", () => {
    expect(() => fitPlatt([{ probability: Number.NaN, label: 1 }])).toThrowError(
      expect.objectContaining({ code: "CALIBRATION_FIT_FAILED" }),
    );
  });

  it("is deterministic: identical input gives identical output", () => {
    const points = syntheticPoints(500, 5, 0.7, 0.1);
    expect(fitPlatt(points)).toEqual(fitPlatt(points));
  });
});

const MODEL_VERSION = "dixon-coles-ensemble-v1" as const;
const identity: CalibratorIdentity = { modelVersion: MODEL_VERSION, configHash: forecastConfigHashFor(MODEL_VERSION) };

function binarySamples(count: number, seed: number): CalibrationSample[] {
  const random = mulberry32(seed);
  const start = Date.parse("2026-01-01T12:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const probability = 0.15 + 0.7 * random();
    const truth = sigmoid(0.6 * logit(probability) + 0.25);
    const kickoff = start + index * 3_600_000;
    return {
      sampleId: `sample-${String(index).padStart(5, "0")}`,
      kickoffUtc: new Date(kickoff).toISOString(),
      knownAt: new Date(kickoff + 3 * 3_600_000).toISOString(),
      probabilities: [probability, 1 - probability],
      outcomeIndex: random() < truth ? 0 : 1,
    };
  });
}

const asOf = "2026-12-01T00:00:00.000Z";

describe("binary market calibrator with pinned identity", () => {
  it("goes from samples to a calibrated vector for OVER_UNDER_2_5 and BTTS", () => {
    for (const market of ["OVER_UNDER_2_5", "BTTS"] as const) {
      const result = fitMarketCalibrator({ identity, market, samples: binarySamples(1000, 31), asOf, config: CALIBRATION_CONFIG });
      expect(result.state).toBe("FITTED");
      if (result.state !== "FITTED") throw new Error("unreachable");
      const calibrator = result.calibrator;
      expect(calibrator.method).toBe("PLATT");
      expect(calibrator.market).toBe(market);
      expect(calibrator.identity).toEqual(identity);
      expect(calibrator.calibrationConfigVersion).toBe(CALIBRATION_CONFIG_VERSION);
      expect(calibrator.calibrationConfigHash).toBe(CALIBRATION_CONFIG_HASH);
      expect(calibrator.fitSampleSize + calibrator.holdoutSampleSize).toBe(1000);
      expect(calibrator.holdoutBrierCalibrated).toBeLessThan(calibrator.holdoutBrierRaw);

      const calibrated = applyCalibrator(calibrator, identity, market, [0.8, 0.2]);
      expect(calibrated).toHaveLength(2);
      expect(calibrated[0]! + calibrated[1]!).toBeCloseTo(1, 12);
      expect(calibrated[0]!).toBeLessThan(0.8);
    }
  });

  it("returns an explicit INSUFFICIENT_DATA state below the Platt minimum", () => {
    const result = fitMarketCalibrator({ identity, market: "BTTS", samples: binarySamples(120, 3), asOf, config: CALIBRATION_CONFIG });
    expect(result).toEqual({ state: "INSUFFICIENT_DATA", required: 300, current: 120 });
  });

  it("is deterministic across calls", () => {
    const samples = binarySamples(600, 8);
    const first = fitMarketCalibrator({ identity, market: "BTTS", samples, asOf, config: CALIBRATION_CONFIG });
    const second = fitMarketCalibrator({ identity, market: "BTTS", samples, asOf, config: CALIBRATION_CONFIG });
    expect(first).toEqual(second);
  });

  describe("refuses to serve a forecast of another identity (D-06, CALIB-02)", () => {
    const fitted = fitMarketCalibrator({ identity, market: "OVER_UNDER_2_5", samples: binarySamples(800, 12), asOf, config: CALIBRATION_CONFIG });
    if (fitted.state !== "FITTED") throw new Error("fixture must fit");
    const calibrator = fitted.calibrator;

    it("accepts the pinned identity", () => {
      expect(applyCalibrator(calibrator, identity, "OVER_UNDER_2_5", [0.6, 0.4])).toHaveLength(2);
    });

    it("rejects another modelVersion with CALIBRATOR_MODEL_MISMATCH", () => {
      const other = { modelVersion: "poisson-ensemble-v1" as const, configHash: identity.configHash };
      expect(() => applyCalibrator(calibrator, other, "OVER_UNDER_2_5", [0.6, 0.4])).toThrowError(
        expect.objectContaining({ code: "CALIBRATOR_MODEL_MISMATCH" }),
      );
    });

    it("rejects an unknown modelVersion with CALIBRATOR_MODEL_MISMATCH", () => {
      const other = { modelVersion: "unknown-model" as never, configHash: identity.configHash };
      expect(() => applyCalibrator(calibrator, other, "OVER_UNDER_2_5", [0.6, 0.4])).toThrowError(
        expect.objectContaining({ code: "CALIBRATOR_MODEL_MISMATCH" }),
      );
    });

    it("rejects another configHash with CALIBRATOR_MODEL_MISMATCH", () => {
      const other = { modelVersion: MODEL_VERSION, configHash: forecastConfigHashFor("poisson-ensemble-v1") };
      expect(() => applyCalibrator(calibrator, other, "OVER_UNDER_2_5", [0.6, 0.4])).toThrowError(
        expect.objectContaining({ code: "CALIBRATOR_MODEL_MISMATCH" }),
      );
    });

    it("rejects another market with CALIBRATOR_MARKET_MISMATCH", () => {
      expect(() => applyCalibrator(calibrator, identity, "BTTS", [0.6, 0.4])).toThrowError(
        expect.objectContaining({ code: "CALIBRATOR_MARKET_MISMATCH" }),
      );
    });
  });
});
