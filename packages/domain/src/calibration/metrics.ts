import { calibrationError } from "./errors.js";

/**
 * Brier score of one categorical forecast: the unscaled sum of squared deviations over
 * all classes (range 0-2). Same unit as `scoreCategoricalForecast` and
 * `MODEL_COMPARISON_POLICY`, so the materiality threshold is comparable.
 */
export function categoricalBrier(probabilities: readonly number[], outcomeIndex: number): number {
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= probabilities.length) {
    throw calibrationError("INVALID_CALIBRATION_SAMPLE", "outcomeIndex out of range");
  }
  let score = 0;
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = probabilities[index]!;
    const target = index === outcomeIndex ? 1 : 0;
    score += (probability - target) ** 2;
  }
  return score;
}

export interface BrierSample {
  readonly probabilities: readonly number[];
  readonly outcomeIndex: number;
}

/** Mean Brier over a sample, summed in input order (deterministic). */
export function meanCategoricalBrier(samples: readonly BrierSample[]): number {
  if (samples.length === 0) throw calibrationError("CALIBRATION_FIT_FAILED", "empty sample");
  let total = 0;
  for (const sample of samples) total += categoricalBrier(sample.probabilities, sample.outcomeIndex);
  return total / samples.length;
}
