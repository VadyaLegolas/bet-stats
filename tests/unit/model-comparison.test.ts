import { describe, expect, it } from "vitest";

import {
  MODEL_COMPARISON_POLICY,
  buildModelComparisonReceipt,
  modelComparisonVerdict,
  modelComparisonWindowsDigest,
  toModelComparisonResult,
  type ComparisonSide,
  type ComparisonWindow,
} from "../../packages/domain/src/evaluation/model-comparison.js";

const windows: readonly ComparisonWindow[] = [
  { fixtureId: "fixture-1", forecastCutoff: "2026-07-02T00:00:00.000Z", evaluationAsOf: "2026-07-04T00:00:00.000Z" },
  { fixtureId: "fixture-2", forecastCutoff: "2026-07-03T00:00:00.000Z", evaluationAsOf: "2026-07-05T00:00:00.000Z" },
];
const computedAt = "2026-11-23T00:00:00.000Z";

function side(overrides: Partial<ComparisonSide> = {}): ComparisonSide {
  return { planId: "plan-v1", planHash: "hash-v1", modelVersion: "poisson-ensemble-v1", configHash: "sha256:config-v1", sampleSize: 40, brierScore: 0.2, logLoss: 0.6, ...overrides };
}

function receipt(rightBrier: number, rightLogLoss = 0.6, left = side(), right: Partial<ComparisonSide> = {}) {
  return buildModelComparisonReceipt({
    market: "ONE_X_TWO",
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-06T00:00:00.000Z",
    computedAt,
    left,
    right: side({ planId: "plan-dc", planHash: "hash-dc", modelVersion: "dixon-coles-ensemble-v1", configHash: "sha256:config-v2", brierScore: rightBrier, logLoss: rightLogLoss, ...right }),
    windows,
  });
}

describe("model comparison verdict", () => {
  it("is material only at the policy threshold", () => {
    expect(MODEL_COMPARISON_POLICY).toEqual({ version: "model-comparison-v2", deltaMateriality: 0.002, minimumSampleSize: 30 });
    expect(modelComparisonVerdict(-0.002, 40)).toBe("BETTER");
    expect(modelComparisonVerdict(-0.0019, 40)).toBe("INCONCLUSIVE");
    expect(modelComparisonVerdict(0, 40)).toBe("INCONCLUSIVE");
    expect(modelComparisonVerdict(0.0019, 40)).toBe("INCONCLUSIVE");
    expect(modelComparisonVerdict(0.002, 40)).toBe("WORSE");
  });

  it("never calls a result better or worse below the minimum sample size (review WR-05)", () => {
    const minimum = MODEL_COMPARISON_POLICY.minimumSampleSize;
    expect(modelComparisonVerdict(-0.2, minimum - 1)).toBe("INCONCLUSIVE");
    expect(modelComparisonVerdict(0.2, 1)).toBe("INCONCLUSIVE");
    expect(modelComparisonVerdict(-0.2, minimum)).toBe("BETTER");
    expect(modelComparisonVerdict(0.2, minimum)).toBe("WORSE");
    expect(receipt(0.1, 0.6, side({ sampleSize: 5 }), { sampleSize: 5 }).verdict).toBe("INCONCLUSIVE");
    expect(() => modelComparisonVerdict(0.1, 1.5)).toThrow("INVALID_COMPARISON_SAMPLE_SIZE");
  });

  it("derives the verdict from the Brier delta only, so a log-loss win cannot mask a Brier loss", () => {
    expect(receipt(0.15, 0.9).verdict).toBe("BETTER");
    expect(receipt(0.25, 0.1).verdict).toBe("WORSE");
    expect(receipt(0.199, 5).verdict).toBe("INCONCLUSIVE");
  });

  it("publishes negative results as valid outcomes with the signed deltas", () => {
    const worse = receipt(0.25, 0.7);
    expect(worse.deltas.brierScore).toBeCloseTo(0.05, 12);
    expect(worse.deltas.logLoss).toBeCloseTo(0.1, 12);
    expect(worse.verdict).toBe("WORSE");
  });
});

describe("model comparison receipt", () => {
  it("contains exactly the declared fields", () => {
    const built = receipt(0.1);
    expect(Object.keys(built).sort()).toEqual(["computedAt", "deltas", "from", "left", "market", "right", "to", "verdict", "version", "windowsDigest"]);
    expect(Object.keys(built.left).sort()).toEqual(["brierScore", "configHash", "logLoss", "modelVersion", "planHash", "planId", "sampleSize"]);
    expect(built.version).toBe("model-comparison-v2");
    expect(built.computedAt).toBe(computedAt);
    expect(built.windowsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic and takes the timestamp from the caller, never from the clock", () => {
    const first = receipt(0.1);
    const second = receipt(0.1);
    expect(second).toEqual(first);
    expect(receipt(0.1, 0.6).computedAt).toBe(computedAt);
  });

  it("changes the windows digest when the cohort order or membership changes", () => {
    const base = modelComparisonWindowsDigest(windows);
    expect(modelComparisonWindowsDigest([...windows].reverse())).not.toBe(base);
    expect(modelComparisonWindowsDigest(windows.slice(0, 1))).not.toBe(base);
    expect(modelComparisonWindowsDigest(windows)).toBe(base);
  });

  it("refuses identical plans and cohort mismatches instead of inventing a winner", () => {
    expect(() => receipt(0.1, 0.6, side(), { planId: "plan-v1", planHash: "hash-v1" })).toThrow("IDENTICAL_PLANS");
    expect(() => receipt(0.1, 0.6, side(), { sampleSize: 41 })).toThrow("COHORT_MISMATCH");
    expect(() => receipt(0.1, 0.6, side({ modelVersion: "poisson-ensemble-v9" }))).toThrow("INVALID_COMPARISON_SIDE");
    expect(() => receipt(0.1, 0.6, side(), { brierScore: Number.NaN })).toThrow("INVALID_COMPARISON_SIDE");
    expect(() => modelComparisonVerdict(Number.NaN, 40)).toThrow("INVALID_COMPARISON_DELTA");
  });
});

describe("toModelComparisonResult", () => {
  it("passes an unavailable comparison through as a reason, not an error", () => {
    expect(toModelComparisonResult({ available: false, reason: "PLAN_NOT_COMPLETE" }, { from: "a", to: "b", computedAt, windows })).toEqual({ available: false, reason: "PLAN_NOT_COMPLETE" });
    expect(toModelComparisonResult({ available: false }, { from: "a", to: "b", computedAt, windows })).toEqual({ available: false, reason: "COMPARISON_UNAVAILABLE" });
    expect(toModelComparisonResult({ available: true }, { from: "a", to: "b", computedAt, windows })).toEqual({ available: false, reason: "COMPARISON_UNAVAILABLE" });
  });

  it("assembles the receipt from repository metrics", () => {
    const result = toModelComparisonResult({
      available: true,
      market: "ONE_X_TWO",
      sampleSize: 40,
      left: side(),
      right: side({ planId: "plan-dc", planHash: "hash-dc", modelVersion: "dixon-coles-ensemble-v1", configHash: "sha256:config-v2", brierScore: 0.1 }),
      deltas: { brierScore: -0.1, logLoss: 0 },
    }, { from: "2026-07-01T00:00:00.000Z", to: "2026-07-06T00:00:00.000Z", computedAt, windows });
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected available");
    expect(result.receipt.verdict).toBe("BETTER");
    expect(result.receipt.left.modelVersion).toBe("poisson-ensemble-v1");
    expect(result.receipt.right.modelVersion).toBe("dixon-coles-ensemble-v1");
  });
});
