import type { CalibrationSample } from "../../packages/domain/src/calibration/calibrator.js";
import { SCORE_CLASS_ORDER, type ScoreMarket } from "../../packages/domain/src/evaluation/scoring.js";

/**
 * Deterministic synthetic calibration samples for unit and integration tests.
 * No vitest dependency: later plans import this from any test runner.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Seeded PRNG (mulberry32): the same seed always yields the same stream. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const logit = (probability: number): number => Math.log(probability / (1 - probability));
const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

export interface MakeCalibrationSamplesInput {
  readonly market: ScoreMarket;
  readonly count: number;
  readonly seed: number;
  /** True positive-class probability is `sigmoid(trueSlope * logit(raw) + trueIntercept)`; slope < 1 means over-confident raw forecasts. */
  readonly trueSlope: number;
  readonly trueIntercept: number;
  /** Kickoff of sample 0; later samples follow at one-day steps. Default 2026-01-01T12:00:00.000Z. */
  readonly startKickoffUtc?: string;
  /** Added to the sample index in `sampleId` and the kickoff step, so consecutive windows never collide. Default 0. */
  readonly indexOffset?: number;
}

const DEFAULT_START = "2026-01-01T12:00:00.000Z";

/**
 * Raw probability vectors in `SCORE_CLASS_ORDER[market]` order: [p, 1 - p] for binary markets, three classes for 1X2.
 * The outcome is drawn from the true probabilities obtained through the logit transform above
 * (renormalised across classes for 1X2). `knownAt` is three hours after `kickoffUtc`.
 */
export function makeCalibrationSamples(input: MakeCalibrationSamplesInput): CalibrationSample[] {
  const { market, count, seed, trueSlope, trueIntercept } = input;
  const offset = input.indexOffset ?? 0;
  const start = Date.parse(input.startKickoffUtc ?? DEFAULT_START);
  const classCount = SCORE_CLASS_ORDER[market].length;
  const random = mulberry32(seed);

  return Array.from({ length: count }, (_, position) => {
    const index = position + offset;
    const kickoff = start + index * DAY_MS;
    const stamp = {
      sampleId: `sample-${String(index).padStart(6, "0")}`,
      kickoffUtc: new Date(kickoff).toISOString(),
      knownAt: new Date(kickoff + 3 * HOUR_MS).toISOString(),
    };

    if (classCount === 2) {
      const probability = 0.05 + 0.9 * random();
      const truth = sigmoid(trueSlope * logit(probability) + trueIntercept);
      return { ...stamp, probabilities: [probability, 1 - probability], outcomeIndex: random() < truth ? 0 : 1 };
    }

    const weights = [0.3 + 1.2 * random(), 0.2 + 0.5 * random(), 0.2 + 1.0 * random()];
    const total = weights.reduce((sum, value) => sum + value, 0);
    const raw = weights.map((value) => value / total);
    const mapped = raw.map((value) => sigmoid(trueSlope * logit(value) + trueIntercept));
    const mappedTotal = mapped.reduce((sum, value) => sum + value, 0);
    const truth = mapped.map((value) => value / mappedTotal);
    const draw = random();
    const outcomeIndex = draw < truth[0]! ? 0 : draw < truth[0]! + truth[1]! ? 1 : 2;
    return { ...stamp, probabilities: raw, outcomeIndex };
  });
}
