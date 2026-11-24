import { SCORE_CLASS_ORDER, type ScoreMarket } from "../evaluation/scoring.js";
import { isForecastModelVersion, type ForecastModelVersion } from "../forecast/model-version.js";

import { canonicalSha256 } from "../forecast/canonical-json.js";

import type { CalibrationConfig } from "./config.js";
import { calibrationError } from "./errors.js";
import { meanCategoricalBrier } from "./metrics.js";
import { applyPlatt, fitPlatt, type PlattParameters, type PlattPoint } from "./platt.js";

/**
 * Pinned identity of a calibrator (D-06): the exact model version and forecast config
 * hash of the forecasts it was fitted on. It is never inferred, defaulted or widened.
 */
export interface CalibratorIdentity {
  readonly modelVersion: ForecastModelVersion;
  readonly configHash: string;
}

/** One settled production forecast as seen by the fit; times are ISO-8601 UTC instants. */
export interface CalibrationSample {
  readonly sampleId: string;
  readonly kickoffUtc: string;
  readonly knownAt: string;
  /** Raw probabilities in `SCORE_CLASS_ORDER[market]` order. */
  readonly probabilities: readonly number[];
  readonly outcomeIndex: number;
}

export type CalibratorMethod = "PLATT";

export interface FittedCalibratorBase {
  readonly identity: CalibratorIdentity;
  readonly market: ScoreMarket;
  readonly fitSampleSize: number;
  readonly holdoutSampleSize: number;
  readonly fitFrom: string;
  readonly fitTo: string;
  readonly holdoutFrom: string;
  readonly holdoutTo: string;
  readonly holdoutBrierRaw: number;
  readonly holdoutBrierCalibrated: number;
  readonly calibrationConfigVersion: string;
  readonly calibrationConfigHash: string;
  readonly fittedAsOf: string;
}

export type FittedCalibrator = FittedCalibratorBase & {
  readonly method: "PLATT";
  /** One scaler per modelled class: the positive class for binary markets. */
  readonly parameters: { readonly epsilon: number; readonly scalers: readonly PlattParameters[] };
};

export type FitMarketCalibratorResult =
  | Readonly<{ state: "INSUFFICIENT_DATA"; required: number; current: number }>
  | Readonly<{ state: "FITTED"; calibrator: FittedCalibrator }>;

export interface FitMarketCalibratorInput {
  readonly identity: CalibratorIdentity;
  readonly market: ScoreMarket;
  readonly samples: readonly CalibrationSample[];
  readonly asOf: string;
  readonly config: CalibrationConfig;
}

function chronological(samples: readonly CalibrationSample[]): CalibrationSample[] {
  return samples
    .map((sample) => {
      const kickoff = Date.parse(sample.kickoffUtc);
      if (!Number.isFinite(kickoff)) throw calibrationError("INVALID_CALIBRATION_SAMPLE", "kickoffUtc is not a date");
      return { sample, kickoff };
    })
    .sort((left, right) =>
      left.kickoff - right.kickoff || (left.sample.sampleId < right.sample.sampleId ? -1 : left.sample.sampleId > right.sample.sampleId ? 1 : 0))
    .map((entry) => entry.sample);
}

function assertIdentity(identity: CalibratorIdentity): void {
  if (!identity || !isForecastModelVersion(identity.modelVersion) || typeof identity.configHash !== "string" || identity.configHash === "") {
    throw calibrationError("CALIBRATION_FIT_FAILED", "invalid calibrator identity");
  }
}

function calibrateWithScalers(parameters: { readonly epsilon: number; readonly scalers: readonly PlattParameters[] }, probabilities: readonly number[]): number[] {
  const positive = applyPlatt(parameters.scalers[0]!, probabilities[0]!, parameters.epsilon);
  return [positive, 1 - positive];
}

/**
 * Fit a calibrator for one market (D-01, D-05). Below the Platt minimum no fit is attempted and the
 * explicit INSUFFICIENT_DATA state is returned. The holdout is the newest `max(holdout, ceil(fraction * S))`
 * samples; the calibrator is trained on the earlier samples only.
 */
export function fitMarketCalibrator(input: FitMarketCalibratorInput): FitMarketCalibratorResult {
  const { identity, market, samples, asOf, config } = input;
  assertIdentity(identity);
  if (!(config.markets as readonly string[]).includes(market)) throw calibrationError("CALIBRATION_FIT_FAILED", "market not in calibration scope");
  if (market === "ONE_X_TWO") throw calibrationError("CALIBRATION_FIT_FAILED", "ONE_X_TWO is not implemented in this slice");

  if (samples.length < config.minimumSamples.platt) {
    return { state: "INSUFFICIENT_DATA", required: config.minimumSamples.platt, current: samples.length };
  }

  const ordered = chronological(samples);
  const holdoutSize = Math.max(config.minimumSamples.holdout, Math.ceil(config.holdoutFraction * ordered.length));
  const fit = ordered.slice(0, ordered.length - holdoutSize);
  const holdout = ordered.slice(ordered.length - holdoutSize);
  const epsilon = config.probabilityClipEpsilon;

  const points: PlattPoint[] = fit.map((sample) => ({ probability: sample.probabilities[0]!, label: sample.outcomeIndex === 0 ? 1 : 0 }));
  const scaler = fitPlatt(points, {
    epsilon,
    maxIterations: config.platt.maxIterations,
    gradientTolerance: config.platt.gradientTolerance,
    stepTolerance: config.platt.stepTolerance,
    priorStrength: config.platt.priorStrength,
    maxBacktracks: config.platt.maxBacktracks,
  });
  const parameters = { epsilon, scalers: [scaler] };

  const holdoutBrierRaw = meanCategoricalBrier(holdout.map((sample) => ({ probabilities: sample.probabilities, outcomeIndex: sample.outcomeIndex })));
  const holdoutBrierCalibrated = meanCategoricalBrier(
    holdout.map((sample) => ({ probabilities: calibrateWithScalers(parameters, sample.probabilities), outcomeIndex: sample.outcomeIndex })),
  );

  return {
    state: "FITTED",
    calibrator: {
      identity: { modelVersion: identity.modelVersion, configHash: identity.configHash },
      market,
      method: "PLATT",
      parameters,
      fitSampleSize: fit.length,
      holdoutSampleSize: holdout.length,
      fitFrom: fit[0]!.kickoffUtc,
      fitTo: fit[fit.length - 1]!.kickoffUtc,
      holdoutFrom: holdout[0]!.kickoffUtc,
      holdoutTo: holdout[holdout.length - 1]!.kickoffUtc,
      holdoutBrierRaw,
      holdoutBrierCalibrated,
      calibrationConfigVersion: config.version,
      calibrationConfigHash: canonicalSha256(config),
      fittedAsOf: asOf,
    },
  };
}

/**
 * Apply a calibrator to a raw probability vector (D-06, CALIB-02). Identity and market are verified
 * before any computation; a mismatch throws and never returns a vector.
 */
export function applyCalibrator(
  calibrator: FittedCalibrator,
  forecastIdentity: CalibratorIdentity,
  market: ScoreMarket,
  probabilities: readonly number[],
): number[] {
  if (
    !forecastIdentity || !isForecastModelVersion(forecastIdentity.modelVersion) ||
    forecastIdentity.modelVersion !== calibrator.identity.modelVersion ||
    forecastIdentity.configHash !== calibrator.identity.configHash
  ) throw calibrationError("CALIBRATOR_MODEL_MISMATCH");
  if (market !== calibrator.market) throw calibrationError("CALIBRATOR_MARKET_MISMATCH");

  const classCount = SCORE_CLASS_ORDER[market].length;
  if (
    !Array.isArray(probabilities) || probabilities.length !== classCount ||
    !probabilities.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
  ) throw calibrationError("INVALID_CALIBRATION_INPUT", "probability vector does not match the market");

  return calibrateWithScalers(calibrator.parameters, probabilities);
}
