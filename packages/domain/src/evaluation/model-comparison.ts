import { createHash } from "node:crypto";

import { isForecastModelVersion } from "../forecast/model-version.js";

/**
 * Operator comparison policy for MODEL-03 (D-12, D-13).
 *
 * The materiality threshold is deliberately part of the policy: a receipt is only
 * called `BETTER`/`WORSE` when the Brier delta clears it, so noise-level wins are
 * never promoted. Changing this value invalidates previously published receipts.
 */
export const MODEL_COMPARISON_POLICY = Object.freeze({
  version: "model-comparison-v2" as const,
  deltaMateriality: 0.002,
  /** Below this many scored outcomes a point delta is noise: the verdict is always INCONCLUSIVE. */
  minimumSampleSize: 30,
});

export type ModelComparisonVerdict = "BETTER" | "WORSE" | "INCONCLUSIVE";

export interface ComparisonWindow {
  readonly fixtureId: string;
  readonly forecastCutoff: string;
  readonly evaluationAsOf: string;
}

export interface ComparisonSide {
  readonly planId: string;
  readonly planHash: string;
  readonly modelVersion: string;
  readonly configHash: string;
  readonly sampleSize: number;
  readonly brierScore: number;
  readonly logLoss: number;
}

export interface ModelComparisonDeltas {
  readonly brierScore: number;
  readonly logLoss: number;
}

/** Closed receipt shape: no request parameters, secrets or free-form fields. */
export interface ModelComparisonReceipt {
  readonly version: typeof MODEL_COMPARISON_POLICY.version;
  readonly market: string;
  readonly from: string;
  readonly to: string;
  readonly windowsDigest: string;
  readonly left: ComparisonSide;
  readonly right: ComparisonSide;
  readonly deltas: ModelComparisonDeltas;
  readonly verdict: ModelComparisonVerdict;
  readonly computedAt: string;
}

export type ModelComparisonResult =
  | Readonly<{ available: true; receipt: ModelComparisonReceipt }>
  | Readonly<{ available: false; reason: string }>;

export interface ModelComparisonBuildInput {
  readonly market: string;
  readonly from: string;
  readonly to: string;
  readonly computedAt: string;
  readonly left: ComparisonSide;
  readonly right: ComparisonSide;
  readonly windows: readonly ComparisonWindow[];
}

/** Raw comparison shape produced by the backtest repository before receipt assembly. */
export interface RawModelComparison {
  readonly available: boolean;
  readonly reason?: string;
  readonly market?: string;
  readonly sampleSize?: number;
  readonly windows?: readonly ComparisonWindow[];
  readonly left?: ComparisonSide;
  readonly right?: ComparisonSide;
  readonly deltas?: ModelComparisonDeltas;
}

/** Stable digest of the evaluated cohort: order is preserved, formatting is fixed. */
export function modelComparisonWindowsDigest(windows: readonly ComparisonWindow[]): string {
  const canonical = windows.map((window) => `${window.fixtureId}|${window.forecastCutoff}|${window.evaluationAsOf}`).join("\n");
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Verdict from the Brier delta only, so a log-loss win can never mask a Brier loss.
 * A cohort smaller than the policy minimum is never called better or worse.
 */
export function modelComparisonVerdict(brierDelta: number, sampleSize: number): ModelComparisonVerdict {
  if (!Number.isFinite(brierDelta)) throw new Error("INVALID_COMPARISON_DELTA");
  if (!Number.isInteger(sampleSize) || sampleSize < 0) throw new Error("INVALID_COMPARISON_SAMPLE_SIZE");
  if (sampleSize < MODEL_COMPARISON_POLICY.minimumSampleSize) return "INCONCLUSIVE";
  if (brierDelta <= -MODEL_COMPARISON_POLICY.deltaMateriality) return "BETTER";
  if (brierDelta >= MODEL_COMPARISON_POLICY.deltaMateriality) return "WORSE";
  return "INCONCLUSIVE";
}

function assertSide(side: ComparisonSide, label: string): void {
  if (typeof side.planId !== "string" || side.planId.length === 0) throw new Error(`INVALID_COMPARISON_SIDE:${label}`);
  if (typeof side.planHash !== "string" || side.planHash.length === 0) throw new Error(`INVALID_COMPARISON_SIDE:${label}`);
  if (!isForecastModelVersion(side.modelVersion)) throw new Error(`INVALID_COMPARISON_SIDE:${label}`);
  if (!Number.isInteger(side.sampleSize) || side.sampleSize <= 0) throw new Error(`INVALID_COMPARISON_SIDE:${label}`);
  if (!Number.isFinite(side.brierScore) || !Number.isFinite(side.logLoss)) throw new Error(`INVALID_COMPARISON_SIDE:${label}`);
}

/**
 * Pure receipt builder: no clock, no database, no environment.
 * `computedAt` is supplied by the caller so an archived receipt stays reproducible.
 */
export function buildModelComparisonReceipt(input: ModelComparisonBuildInput): ModelComparisonReceipt {
  assertSide(input.left, "left");
  assertSide(input.right, "right");
  if (input.left.planId === input.right.planId) throw new Error("IDENTICAL_PLANS");
  if (input.left.sampleSize !== input.right.sampleSize) throw new Error("COHORT_MISMATCH");
  if (input.windows.length === 0) throw new Error("EMPTY_COHORT");
  return Object.freeze({
    version: MODEL_COMPARISON_POLICY.version,
    market: input.market,
    from: input.from,
    to: input.to,
    windowsDigest: modelComparisonWindowsDigest(input.windows),
    left: Object.freeze({ ...input.left }),
    right: Object.freeze({ ...input.right }),
    deltas: Object.freeze({ brierScore: input.right.brierScore - input.left.brierScore, logLoss: input.right.logLoss - input.left.logLoss }),
    verdict: modelComparisonVerdict(input.right.brierScore - input.left.brierScore, input.left.sampleSize),
    computedAt: input.computedAt,
  });
}

/**
 * Adapter from the repository comparison to the API result.
 *
 * `available: false` is a valid answer with a reason, never an exception: an
 * unfinished plan or a mismatched cohort is data unavailability, not a bug.
 */
export function toModelComparisonResult(
  raw: RawModelComparison,
  input: { from: string; to: string; computedAt: string; windows: readonly ComparisonWindow[] },
): ModelComparisonResult {
  if (!raw.available) return Object.freeze({ available: false as const, reason: raw.reason ?? "COMPARISON_UNAVAILABLE" });
  if (!raw.left || !raw.right) return Object.freeze({ available: false as const, reason: "COMPARISON_UNAVAILABLE" });
  try {
    return Object.freeze({
      available: true as const,
      receipt: buildModelComparisonReceipt({
        market: raw.market ?? "UNKNOWN",
        from: input.from,
        to: input.to,
        computedAt: input.computedAt,
        left: raw.left,
        right: raw.right,
        windows: input.windows,
      }),
    });
  } catch (error) {
    return Object.freeze({ available: false as const, reason: error instanceof Error ? error.message.split(":")[0]! : "COMPARISON_UNAVAILABLE" });
  }
}
