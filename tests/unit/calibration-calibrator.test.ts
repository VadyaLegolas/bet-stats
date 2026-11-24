import { describe, expect, it } from "vitest";

import { SCORE_CLASS_ORDER, scoreCategoricalForecast } from "../../packages/domain/src/evaluation/scoring.js";
import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { CALIBRATION_CONFIG, CALIBRATION_CONFIG_HASH } from "../../packages/domain/src/calibration/config.js";
import { applyIsotonic, fitIsotonic, type IsotonicPoint } from "../../packages/domain/src/calibration/isotonic.js";
import { meanCategoricalBrier } from "../../packages/domain/src/calibration/metrics.js";
import {
  applyCalibrator,
  assessCalibrationData,
  calibrationSamplesDigest,
  calibratorContentId,
  fitMarketCalibrator,
  type CalibrationSample,
  type CalibratorIdentity,
  type FittedCalibrator,
} from "../../packages/domain/src/calibration/calibrator.js";

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

const MODEL_VERSION = "dixon-coles-ensemble-v1" as const;
const identity: CalibratorIdentity = { modelVersion: MODEL_VERSION, configHash: forecastConfigHashFor(MODEL_VERSION) };
const asOf = "2026-12-01T00:00:00.000Z";
const START = Date.parse("2026-01-01T12:00:00.000Z");

function stamp(index: number): Pick<CalibrationSample, "sampleId" | "kickoffUtc" | "knownAt"> {
  const kickoff = START + index * 3_600_000;
  return {
    sampleId: `sample-${String(index).padStart(5, "0")}`,
    kickoffUtc: new Date(kickoff).toISOString(),
    knownAt: new Date(kickoff + 3 * 3_600_000).toISOString(),
  };
}

/** Binary samples whose true positive probability is `truth(p)`; raw p uniform in [0.05, 0.95]. */
function binarySamples(count: number, seed: number, truth: (probability: number) => number): CalibrationSample[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => {
    const probability = 0.05 + 0.9 * random();
    return {
      ...stamp(index),
      probabilities: [probability, 1 - probability],
      outcomeIndex: random() < truth(probability) ? 0 : 1,
    };
  });
}

// Smooth (sigmoid) over-confidence and a steep monotone step: only the second is poorly described by Platt.
const smoothTruth = (probability: number): number => sigmoid(0.6 * logit(probability) + 0.25);
const stepTruth = (probability: number): number => (probability < 0.3 ? 0.08 : probability < 0.5 ? 0.2 : probability < 0.7 ? 0.8 : 0.92);

/** 1X2 samples: the truth is `t`; the raw forecast is the over-confident `t^1.6` renormalised. */
function oneXTwoSamples(count: number, seed: number): CalibrationSample[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => {
    const weights = [0.3 + 1.2 * random(), 0.2 + 0.5 * random(), 0.2 + 1.0 * random()];
    const total = weights.reduce((sum, value) => sum + value, 0);
    const truth = weights.map((value) => value / total);
    const sharpened = truth.map((value) => value ** 1.6);
    const sharpenedTotal = sharpened.reduce((sum, value) => sum + value, 0);
    const draw = random();
    const outcomeIndex = draw < truth[0]! ? 0 : draw < truth[0]! + truth[1]! ? 1 : 2;
    return { ...stamp(index), probabilities: sharpened.map((value) => value / sharpenedTotal), outcomeIndex };
  });
}

function fitted(market: "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS", samples: readonly CalibrationSample[], config = CALIBRATION_CONFIG): FittedCalibrator {
  const result = fitMarketCalibrator({ identity, market, samples, asOf, config });
  if (result.state !== "FITTED") throw new Error(`fixture must fit, got ${result.state}`);
  return result.calibrator;
}

function brierOnIndependent(calibrator: FittedCalibrator, samples: readonly CalibrationSample[]): { raw: number; calibrated: number } {
  return {
    raw: meanCategoricalBrier(samples),
    calibrated: meanCategoricalBrier(
      samples.map((sample) => ({
        probabilities: applyCalibrator(calibrator, identity, calibrator.market, sample.probabilities),
        outcomeIndex: sample.outcomeIndex,
      })),
    ),
  };
}

describe("ONE_X_TWO one-vs-rest Platt", () => {
  const training = oneXTwoSamples(3000, 11);
  const calibrator = fitted("ONE_X_TWO", training);

  it("fits three scalers and picks PLATT below the isotonic threshold", () => {
    expect(calibrator.method).toBe("PLATT");
    expect(calibrator.parameters.scalers).toHaveLength(3);
    expect(calibrator.market).toBe("ONE_X_TWO");
  });

  it("renormalises to sum 1 and is accepted by scoreCategoricalForecast", () => {
    for (const sample of oneXTwoSamples(200, 12)) {
      const calibrated = applyCalibrator(calibrator, identity, "ONE_X_TWO", sample.probabilities);
      expect(calibrated).toHaveLength(3);
      expect(Math.abs(calibrated.reduce((sum, value) => sum + value, 0) - 1)).toBeLessThan(1e-12);
      for (const value of calibrated) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      const outcome = SCORE_CLASS_ORDER.ONE_X_TWO[sample.outcomeIndex]!;
      expect(() =>
        scoreCategoricalForecast({
          settlementReceiptId: "receipt-1",
          forecastSnapshotId: "snapshot-1",
          market: "ONE_X_TWO",
          outcome,
          probabilities: calibrated.map((probability, index) => ({ selection: SCORE_CLASS_ORDER.ONE_X_TWO[index]!, probability })),
        }),
      ).not.toThrow();
    }
  });

  it("lowers Brier on an independent sample by more than the materiality threshold", () => {
    const { raw, calibrated } = brierOnIndependent(calibrator, oneXTwoSamples(3000, 13));
    expect(raw - calibrated).toBeGreaterThan(CALIBRATION_CONFIG.materiality);
  });
});

describe("isotonic regression (PAVA)", () => {
  it("pools the sequence [1,0,1,0,1] into the known blocks", () => {
    const points: IsotonicPoint[] = [0.1, 0.3, 0.5, 0.7, 0.9].map((probability, index) => ({ probability, label: index % 2 === 0 ? 1 : 0 }));
    const model = fitIsotonic(points);
    expect(model.nodes.map((node) => node.value)).toEqual([0.5, 0.5, 1 - 1e-6]);
    expect(model.nodes.map((node) => node.x)).toEqual([0.2, 0.6, 0.9]);
  });

  it("is non-decreasing on several synthetic samples", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = mulberry32(seed);
      const points: IsotonicPoint[] = Array.from({ length: 300 }, () => {
        const probability = random();
        return { probability, label: random() < 0.2 + 0.5 * probability ? 1 : 0 };
      });
      const model = fitIsotonic(points);
      for (let index = 1; index < model.nodes.length; index += 1) {
        expect(model.nodes[index]!.x).toBeGreaterThan(model.nodes[index - 1]!.x);
        expect(model.nodes[index]!.value).toBeGreaterThanOrEqual(model.nodes[index - 1]!.value);
      }
      let previous = -Infinity;
      for (let step = 0; step <= 200; step += 1) {
        const value = applyIsotonic(model, step / 200);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeGreaterThanOrEqual(1e-6);
        expect(value).toBeLessThanOrEqual(1 - 1e-6);
        previous = value;
      }
    }
  });

  it("returns the edge block value outside the training range", () => {
    const model = fitIsotonic([
      { probability: 0.3, label: 0 },
      { probability: 0.4, label: 0 },
      { probability: 0.6, label: 1 },
      { probability: 0.7, label: 1 },
    ]);
    const first = model.nodes[0]!.value;
    const last = model.nodes[model.nodes.length - 1]!.value;
    expect(applyIsotonic(model, 0.01)).toBe(first);
    expect(applyIsotonic(model, 0)).toBe(first);
    expect(applyIsotonic(model, 0.99)).toBe(last);
    expect(applyIsotonic(model, 1)).toBe(last);
  });

  it("handles data without spread in x without dividing by zero", () => {
    const model = fitIsotonic(Array.from({ length: 10 }, (_, index) => ({ probability: 0.5, label: (index % 2) as 0 | 1 })));
    expect(model.nodes).toHaveLength(1);
    for (const input of [0, 0.2, 0.5, 0.9, 1]) expect(applyIsotonic(model, input)).toBeCloseTo(0.5, 12);
  });
});

describe("sample gates and chronological split (D-02, D-05, CALIB-04)", () => {
  it.each([0, 1, 299])("returns INSUFFICIENT_DATA for %i outcomes", (count) => {
    const result = fitMarketCalibrator({ identity, market: "BTTS", samples: binarySamples(count, 1, smoothTruth), asOf, config: CALIBRATION_CONFIG });
    expect(result).toEqual({ state: "INSUFFICIENT_DATA", required: 300, current: count });
  });

  it.each([
    [300, 240, 60],
    [301, 240, 61],
    [1000, 800, 200],
    [1499, 1199, 300],
    [1500, 1200, 300],
  ])("splits %i outcomes into fit %i and holdout %i", (count, fitSize, holdoutSize) => {
    const assessment = assessCalibrationData(binarySamples(count, 2, smoothTruth), CALIBRATION_CONFIG);
    expect(assessment.state).toBe("READY");
    if (assessment.state !== "READY") throw new Error("unreachable");
    expect(assessment.fit).toHaveLength(fitSize);
    expect(assessment.holdout).toHaveLength(holdoutSize);
    expect(assessment.fitTo <= assessment.holdoutFrom).toBe(true);
  });

  it("reports INSUFFICIENT_DATA from assessCalibrationData", () => {
    expect(assessCalibrationData(binarySamples(299, 2, smoothTruth), CALIBRATION_CONFIG)).toEqual({
      state: "INSUFFICIENT_DATA",
      required: 300,
      current: 299,
    });
  });

  it("splits chronologically: shuffled input gives the same result", () => {
    const samples = binarySamples(500, 3, smoothTruth);
    const shuffled = [...samples];
    const random = mulberry32(99);
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
    }
    expect(fitMarketCalibrator({ identity, market: "BTTS", samples: shuffled, asOf, config: CALIBRATION_CONFIG })).toEqual(
      fitMarketCalibrator({ identity, market: "BTTS", samples, asOf, config: CALIBRATION_CONFIG }),
    );
    const calibrator = fitted("BTTS", samples);
    expect(calibrator.fitTo <= calibrator.holdoutFrom).toBe(true);
    expect(calibrator.fitFrom).toBe(samples[0]!.kickoffUtc);
    expect(calibrator.holdoutTo).toBe(samples[499]!.kickoffUtc);
  });

  it("breaks ties on equal kickoffUtc at the boundary by sampleId", () => {
    const kickoffUtc = "2026-03-01T15:00:00.000Z";
    const base = binarySamples(400, 4, smoothTruth).map((sample, index) => ({
      ...sample,
      sampleId: `tie-${String(index).padStart(4, "0")}`,
      kickoffUtc,
    }));
    const shuffled = [...base].reverse();
    const assessment = assessCalibrationData(shuffled, CALIBRATION_CONFIG);
    if (assessment.state !== "READY") throw new Error("unreachable");
    expect(assessment.holdout.map((sample) => sample.sampleId)).toEqual(base.slice(320).map((sample) => sample.sampleId));
    expect(assessment.fit.map((sample) => sample.sampleId)).toEqual(base.slice(0, 320).map((sample) => sample.sampleId));
  });

  it("never considers isotonic below 1500 outcomes, even on step miscalibration", () => {
    const calibrator = fitted("OVER_UNDER_2_5", binarySamples(1499, 5, stepTruth));
    expect(calibrator.method).toBe("PLATT");
    expect(calibrator.plattHoldoutBrier).toBeUndefined();
    expect(calibrator.isotonicHoldoutBrier).toBeUndefined();
  });

  it("selects isotonic at 1500+ outcomes when it beats Platt by the materiality margin on step miscalibration", () => {
    const calibrator = fitted("OVER_UNDER_2_5", binarySamples(1500, 5, stepTruth));
    expect(calibrator.method).toBe("ISOTONIC");
    expect(calibrator.plattHoldoutBrier).toBeDefined();
    expect(calibrator.plattHoldoutBrier! - calibrator.holdoutBrierCalibrated).toBeGreaterThanOrEqual(CALIBRATION_CONFIG.materiality);
    expect(calibrator.holdoutBrierCalibrated).toBe(calibrator.isotonicHoldoutBrier);
  });

  it("keeps Platt on a smooth sigmoid miscalibration", () => {
    const calibrator = fitted("OVER_UNDER_2_5", binarySamples(2000, 6, smoothTruth));
    expect(calibrator.method).toBe("PLATT");
    expect(calibrator.plattHoldoutBrier).toBeDefined();
    expect(calibrator.holdoutBrierCalibrated).toBe(calibrator.plattHoldoutBrier);
  });

  it("applies the margin exactly: delta passes at the threshold and fails just above it", () => {
    const samples = binarySamples(1500, 5, stepTruth);
    const chosen = fitted("OVER_UNDER_2_5", samples);
    const delta = chosen.plattHoldoutBrier! - chosen.holdoutBrierCalibrated;
    expect(fitted("OVER_UNDER_2_5", samples, { ...CALIBRATION_CONFIG, materiality: delta }).method).toBe("ISOTONIC");
    expect(fitted("OVER_UNDER_2_5", samples, { ...CALIBRATION_CONFIG, materiality: delta + 1e-9 }).method).toBe("PLATT");
  });

  it("serves a vector for an isotonic calibrator and still refuses a foreign identity", () => {
    const calibrator = fitted("OVER_UNDER_2_5", binarySamples(1500, 5, stepTruth));
    const calibrated = applyCalibrator(calibrator, identity, "OVER_UNDER_2_5", [0.9, 0.1]);
    expect(calibrated[0]! + calibrated[1]!).toBeCloseTo(1, 12);
    expect(() => applyCalibrator(calibrator, { ...identity, modelVersion: "poisson-ensemble-v1" }, "OVER_UNDER_2_5", [0.9, 0.1])).toThrowError(
      expect.objectContaining({ code: "CALIBRATOR_MODEL_MISMATCH" }),
    );
  });
});

describe("fit result bookkeeping, digest and content id", () => {
  const samples = binarySamples(600, 7, smoothTruth);
  const calibrator = fitted("BTTS", samples);

  it("records sizes, windows, metrics, digest and the config identity", () => {
    expect(calibrator.fitSampleSize).toBe(480);
    expect(calibrator.holdoutSampleSize).toBe(120);
    expect(calibrator.fitFrom).toBe(samples[0]!.kickoffUtc);
    expect(calibrator.fitTo).toBe(samples[479]!.kickoffUtc);
    expect(calibrator.holdoutFrom).toBe(samples[480]!.kickoffUtc);
    expect(calibrator.holdoutTo).toBe(samples[599]!.kickoffUtc);
    expect(calibrator.samplesDigest).toBe(calibrationSamplesDigest(samples));
    expect(calibrator.samplesDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(calibrator.calibrationConfigVersion).toBe("calibration-config-v1");
    expect(calibrator.calibrationConfigHash).toBe(CALIBRATION_CONFIG_HASH);
    expect(calibrator.identity).toEqual(identity);
    expect(calibrator.fittedAsOf).toBe(asOf);
  });

  it("is deterministic: same input gives bit-identical parameters, metrics, digest and content id", () => {
    const again = fitted("BTTS", samples);
    expect(again).toEqual(calibrator);
    expect(calibratorContentId(again)).toBe(calibratorContentId(calibrator));
    expect(calibratorContentId(calibrator)).toMatch(/^calibrator_[0-9a-f]{64}$/);
  });

  it("does not include asOf in the content id (idempotent daily job)", () => {
    const later = fitMarketCalibrator({ identity, market: "BTTS", samples, asOf: "2027-01-01T00:00:00.000Z", config: CALIBRATION_CONFIG });
    if (later.state !== "FITTED") throw new Error("unreachable");
    expect(calibratorContentId(later.calibrator)).toBe(calibratorContentId(calibrator));
  });

  it("changes the content id with method, identity, market, digest and config hash", () => {
    const baseId = calibratorContentId(calibrator);
    expect(calibratorContentId({ ...calibrator, method: "ISOTONIC" } as FittedCalibrator)).not.toBe(baseId);
    expect(calibratorContentId({ ...calibrator, identity: { ...identity, modelVersion: "poisson-ensemble-v1" } })).not.toBe(baseId);
    expect(calibratorContentId({ ...calibrator, identity: { ...identity, configHash: forecastConfigHashFor("poisson-ensemble-v1") } })).not.toBe(baseId);
    expect(calibratorContentId({ ...calibrator, market: "OVER_UNDER_2_5" })).not.toBe(baseId);
    expect(calibratorContentId({ ...calibrator, samplesDigest: "sha256:" + "0".repeat(64) })).not.toBe(baseId);
    expect(calibratorContentId({ ...calibrator, calibrationConfigHash: "sha256:" + "1".repeat(64) })).not.toBe(baseId);
  });

  it("makes the digest order-independent and sensitive to every sample field", () => {
    const digest = calibrationSamplesDigest(samples);
    expect(calibrationSamplesDigest([...samples].reverse())).toBe(digest);
    const mutate = (patch: Partial<CalibrationSample>): string =>
      calibrationSamplesDigest(samples.map((sample, index) => (index === 123 ? { ...sample, ...patch } : sample)));
    expect(mutate({ outcomeIndex: samples[123]!.outcomeIndex === 0 ? 1 : 0 })).not.toBe(digest);
    expect(mutate({ sampleId: "renamed" })).not.toBe(digest);
    expect(mutate({ probabilities: [samples[123]!.probabilities[0]! + 1e-9, samples[123]!.probabilities[1]! - 1e-9] })).not.toBe(digest);
  });
});

describe("sample validation", () => {
  const good = binarySamples(400, 8, smoothTruth);
  const attempt = (samples: readonly CalibrationSample[], market: "BTTS" | "ONE_X_TWO" = "BTTS") =>
    () => fitMarketCalibrator({ identity, market, samples, asOf, config: CALIBRATION_CONFIG });
  const withFirst = (patch: Partial<CalibrationSample>) => [{ ...good[0]!, ...patch }, ...good.slice(1)];

  it("rejects bad samples with INVALID_CALIBRATION_SAMPLE before fitting", () => {
    const invalid = expect.objectContaining({ code: "INVALID_CALIBRATION_SAMPLE" });
    expect(attempt(withFirst({ probabilities: [1.2, -0.2] }))).toThrowError(invalid);
    expect(attempt(withFirst({ probabilities: [0.4, 0.4] }))).toThrowError(invalid);
    expect(attempt(withFirst({ probabilities: [Number.NaN, 0.5] }))).toThrowError(invalid);
    expect(attempt(withFirst({ probabilities: [0.5, 0.25, 0.25] }))).toThrowError(invalid);
    expect(attempt(withFirst({ outcomeIndex: 2 }))).toThrowError(invalid);
    expect(attempt(withFirst({ outcomeIndex: -1 }))).toThrowError(invalid);
    expect(attempt(withFirst({ outcomeIndex: 0.5 }))).toThrowError(invalid);
    expect(attempt(withFirst({ kickoffUtc: "not a date" }))).toThrowError(invalid);
    expect(attempt(withFirst({ sampleId: "" }))).toThrowError(invalid);
    expect(attempt(withFirst({ sampleId: good[1]!.sampleId }))).toThrowError(invalid);
    expect(attempt(good, "ONE_X_TWO")).toThrowError(invalid);
  });

  it("validates even when the sample is below the minimum", () => {
    expect(attempt([{ ...good[0]!, probabilities: [2, -1] }])).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_SAMPLE" }));
  });

  it("rejects an invalid identity with CALIBRATION_FIT_FAILED", () => {
    expect(() =>
      fitMarketCalibrator({ identity: { modelVersion: "nope" as never, configHash: "x" }, market: "BTTS", samples: good, asOf, config: CALIBRATION_CONFIG }),
    ).toThrowError(expect.objectContaining({ code: "CALIBRATION_FIT_FAILED" }));
  });
});

describe("structurally corrupt calibrators are refused (CALIBRATOR_INVALID)", () => {
  const plattBinary = fitted("BTTS", binarySamples(600, 9, smoothTruth));
  const plattOneXTwo = fitted("ONE_X_TWO", oneXTwoSamples(600, 9));
  const isotonicBinary = fitted("OVER_UNDER_2_5", binarySamples(1500, 5, stepTruth));
  const invalid = expect.objectContaining({ code: "CALIBRATOR_INVALID" });
  const run = (calibrator: unknown, market: "BTTS" | "ONE_X_TWO" | "OVER_UNDER_2_5" = "BTTS", vector: readonly number[] = [0.6, 0.4]) =>
    () => applyCalibrator(calibrator as FittedCalibrator, identity, market, vector);

  it("accepts the uncorrupted calibrators", () => {
    expect(run(plattBinary)).not.toThrow();
    expect(run(plattOneXTwo, "ONE_X_TWO", [0.5, 0.3, 0.2])).not.toThrow();
    expect(isotonicBinary.method).toBe("ISOTONIC");
    expect(run(isotonicBinary, "OVER_UNDER_2_5")).not.toThrow();
  });

  it("rejects a wrong number of scalers for the market", () => {
    expect(run({ ...plattBinary, parameters: { ...plattBinary.parameters, scalers: [] } })).toThrowError(invalid);
    expect(run({ ...plattBinary, parameters: { ...plattBinary.parameters, scalers: [...plattBinary.parameters.scalers, ...plattBinary.parameters.scalers] } })).toThrowError(invalid);
    expect(run({ ...plattOneXTwo, parameters: { ...plattOneXTwo.parameters, scalers: plattOneXTwo.parameters.scalers.slice(0, 2) } }, "ONE_X_TWO", [0.5, 0.3, 0.2])).toThrowError(invalid);
  });

  it("rejects non-numeric and non-finite scaler values", () => {
    const scaler = plattBinary.parameters.scalers[0]!;
    const withScaler = (patch: Record<string, unknown>) => ({ ...plattBinary, parameters: { ...plattBinary.parameters, scalers: [{ ...scaler, ...patch }] } });
    expect(run(withScaler({ slope: Number.NaN }))).toThrowError(invalid);
    expect(run(withScaler({ slope: Infinity }))).toThrowError(invalid);
    expect(run(withScaler({ intercept: "0.1" }))).toThrowError(invalid);
    expect(run(withScaler({ intercept: null }))).toThrowError(invalid);
  });

  it("rejects an unknown method, missing parameters and a bad epsilon", () => {
    expect(run({ ...plattBinary, method: "LOGISTIC" })).toThrowError(invalid);
    expect(run({ ...plattBinary, parameters: undefined })).toThrowError(invalid);
    expect(run({ ...plattBinary, parameters: { ...plattBinary.parameters, epsilon: 0 } })).toThrowError(invalid);
    expect(run({ ...plattBinary, parameters: { ...plattBinary.parameters, epsilon: 0.7 } })).toThrowError(invalid);
    expect(run({ ...plattBinary, parameters: { scalers: plattBinary.parameters.scalers } })).toThrowError(invalid);
  });

  it("rejects empty, non-monotone or non-finite isotonic nodes", () => {
    if (isotonicBinary.method !== "ISOTONIC") throw new Error("fixture must be isotonic");
    const model = isotonicBinary.parameters.scalers[0]!;
    const withNodes = (nodes: unknown) => ({ ...isotonicBinary, parameters: { ...isotonicBinary.parameters, scalers: [{ nodes }] } });
    expect(model.nodes.length).toBeGreaterThan(2);
    expect(run(withNodes([]), "OVER_UNDER_2_5")).toThrowError(invalid);
    expect(run(withNodes([...model.nodes].reverse()), "OVER_UNDER_2_5")).toThrowError(invalid);
    expect(run(withNodes(model.nodes.map((node, index) => (index === 1 ? { ...node, value: model.nodes[0]!.value - 0.05 } : node))), "OVER_UNDER_2_5")).toThrowError(invalid);
    expect(run(withNodes(model.nodes.map((node, index) => (index === 1 ? { ...node, x: Number.NaN } : node))), "OVER_UNDER_2_5")).toThrowError(invalid);
    expect(run(withNodes(model.nodes.map((node, index) => (index === 0 ? { ...node, value: 1.5 } : node))), "OVER_UNDER_2_5")).toThrowError(invalid);
    expect(run(withNodes("nodes"), "OVER_UNDER_2_5")).toThrowError(invalid);
  });

  it("checks identity and market before structure", () => {
    const corrupt = { ...plattBinary, parameters: undefined };
    expect(() => applyCalibrator(corrupt as never, { ...identity, modelVersion: "poisson-ensemble-v1" }, "BTTS", [0.6, 0.4])).toThrowError(
      expect.objectContaining({ code: "CALIBRATOR_MODEL_MISMATCH" }),
    );
    expect(() => applyCalibrator(corrupt as never, identity, "OVER_UNDER_2_5", [0.6, 0.4])).toThrowError(
      expect.objectContaining({ code: "CALIBRATOR_MARKET_MISMATCH" }),
    );
  });

  it("rejects an input vector that does not match the market", () => {
    expect(run(plattBinary, "BTTS", [0.6, 0.3, 0.1])).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_INPUT" }));
    expect(run(plattBinary, "BTTS", [Number.NaN, 0.4])).toThrowError(expect.objectContaining({ code: "INVALID_CALIBRATION_INPUT" }));
  });
});
