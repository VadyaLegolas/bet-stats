import { SCORE_CLASS_ORDER, type ScoreMarket } from "../evaluation/scoring.js";
import { canonicalSha256 } from "../forecast/canonical-json.js";
import { isForecastModelVersion, type ForecastModelVersion } from "../forecast/model-version.js";

import type { CalibrationConfig } from "./config.js";
import { calibrationError } from "./errors.js";
import { applyIsotonic, fitIsotonic, type IsotonicModel } from "./isotonic.js";
import { meanCategoricalBrier } from "./metrics.js";
import { applyPlatt, fitPlatt, type PlattFitOptions, type PlattParameters } from "./platt.js";

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

export type CalibratorMethod = "PLATT" | "ISOTONIC";

/** Method plus parameters. `scalers` holds one map per modelled class: three for 1X2, one (positive class) for binary markets. */
export type CalibratorModel =
  | Readonly<{ method: "PLATT"; parameters: Readonly<{ epsilon: number; scalers: readonly PlattParameters[] }> }>
  | Readonly<{ method: "ISOTONIC"; parameters: Readonly<{ epsilon: number; scalers: readonly IsotonicModel[] }> }>;

export interface FittedCalibratorBase {
  readonly identity: CalibratorIdentity;
  readonly market: ScoreMarket;
  readonly fitSampleSize: number;
  readonly holdoutSampleSize: number;
  readonly fitFrom: string;
  readonly fitTo: string;
  readonly holdoutFrom: string;
  readonly holdoutTo: string;
  /** Mean Brier of the raw vectors on the holdout (unscaled categorical sum, 0-2). */
  readonly holdoutBrierRaw: number;
  /** Mean Brier of the chosen method on the holdout. */
  readonly holdoutBrierCalibrated: number;
  /** Present only when isotonic was considered (S >= minimumSamples.isotonic). */
  readonly plattHoldoutBrier?: number;
  readonly isotonicHoldoutBrier?: number;
  readonly samplesDigest: string;
  readonly calibrationConfigVersion: string;
  readonly calibrationConfigHash: string;
  readonly fittedAsOf: string;
}

export type FittedCalibrator = FittedCalibratorBase & CalibratorModel;

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

export type CalibrationDataAssessment =
  | Readonly<{ state: "INSUFFICIENT_DATA"; required: number; current: number }>
  | Readonly<{
      state: "READY";
      sampleSize: number;
      /** Oldest samples: the calibrator trains on these only. */
      fit: readonly CalibrationSample[];
      /** Newest `max(holdout, ceil(holdoutFraction * S))` samples: never used for training. */
      holdout: readonly CalibrationSample[];
      fitFrom: string;
      fitTo: string;
      holdoutFrom: string;
      holdoutTo: string;
    }>;

const SAMPLE_PROBABILITY_SUM_TOLERANCE = 1e-9;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Deterministic chronological order: (kickoffUtc, sampleId). */
function chronological(samples: readonly CalibrationSample[]): CalibrationSample[] {
  return samples
    .map((sample) => {
      const kickoff = Date.parse(sample.kickoffUtc);
      if (!Number.isFinite(kickoff)) throw calibrationError("INVALID_CALIBRATION_SAMPLE", "kickoffUtc is not a date");
      return { sample, kickoff };
    })
    .sort((left, right) => left.kickoff - right.kickoff || compareText(left.sample.sampleId, right.sample.sampleId))
    .map((entry) => entry.sample);
}

function assertIdentity(identity: CalibratorIdentity): void {
  if (!identity || !isForecastModelVersion(identity.modelVersion) || typeof identity.configHash !== "string" || identity.configHash === "") {
    throw calibrationError("CALIBRATION_FIT_FAILED", "invalid calibrator identity");
  }
}

/** Validate the fit input before any computation: shape, ranges, sums, outcome index and unique ids. */
function assertCalibrationSamples(market: ScoreMarket, samples: readonly CalibrationSample[]): void {
  const classCount = SCORE_CLASS_ORDER[market].length;
  const seen = new Set<string>();
  for (const sample of samples) {
    if (!sample || typeof sample.sampleId !== "string" || sample.sampleId === "") {
      throw calibrationError("INVALID_CALIBRATION_SAMPLE", "sampleId is required");
    }
    if (seen.has(sample.sampleId)) throw calibrationError("INVALID_CALIBRATION_SAMPLE", "duplicate sampleId");
    seen.add(sample.sampleId);
    if (!Number.isFinite(Date.parse(sample.kickoffUtc)) || !Number.isFinite(Date.parse(sample.knownAt))) {
      throw calibrationError("INVALID_CALIBRATION_SAMPLE", "kickoffUtc and knownAt must be dates");
    }
    if (!Number.isInteger(sample.outcomeIndex) || sample.outcomeIndex < 0 || sample.outcomeIndex >= classCount) {
      throw calibrationError("INVALID_CALIBRATION_SAMPLE", "outcomeIndex is out of range");
    }
    if (!Array.isArray(sample.probabilities) || sample.probabilities.length !== classCount) {
      throw calibrationError("INVALID_CALIBRATION_SAMPLE", "probability vector does not match the market");
    }
    let sum = 0;
    for (const value of sample.probabilities) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw calibrationError("INVALID_CALIBRATION_SAMPLE", "probability is outside [0, 1]");
      }
      sum += value;
    }
    if (Math.abs(sum - 1) > SAMPLE_PROBABILITY_SUM_TOLERANCE) throw calibrationError("INVALID_CALIBRATION_SAMPLE", "probabilities do not sum to 1");
  }
}

/**
 * Data gate and chronological split (D-02, D-05, CALIB-04). Below `minimumSamples.platt` outcomes no fit is
 * attempted. Otherwise the holdout is the newest `max(holdout, ceil(holdoutFraction * S))` samples and the fit
 * window ends no later than the holdout window begins; ties on `kickoffUtc` are ordered by `sampleId`.
 */
export function assessCalibrationData(samples: readonly CalibrationSample[], config: CalibrationConfig): CalibrationDataAssessment {
  if (samples.length < config.minimumSamples.platt) {
    return { state: "INSUFFICIENT_DATA", required: config.minimumSamples.platt, current: samples.length };
  }
  const ordered = chronological(samples);
  const holdoutSize = Math.max(config.minimumSamples.holdout, Math.ceil(config.holdoutFraction * ordered.length));
  const fit = ordered.slice(0, ordered.length - holdoutSize);
  const holdout = ordered.slice(ordered.length - holdoutSize);
  if (fit.length === 0 || holdout.length === 0) throw calibrationError("CALIBRATION_FIT_FAILED", "split leaves an empty window");
  return {
    state: "READY",
    sampleSize: ordered.length,
    fit,
    holdout,
    fitFrom: fit[0]!.kickoffUtc,
    fitTo: fit[fit.length - 1]!.kickoffUtc,
    holdoutFrom: holdout[0]!.kickoffUtc,
    holdoutTo: holdout[holdout.length - 1]!.kickoffUtc,
  };
}

/** Order-independent digest of every sample object (probabilities, outcome, ids and times). */
export function calibrationSamplesDigest(samples: readonly CalibrationSample[]): string {
  return canonicalSha256(
    chronological(samples).map((sample) => ({
      sampleId: sample.sampleId,
      kickoffUtc: sample.kickoffUtc,
      knownAt: sample.knownAt,
      probabilities: [...sample.probabilities],
      outcomeIndex: sample.outcomeIndex,
    })),
  );
}

/** Deterministic content id. It excludes `fittedAsOf`: refitting the same data yields the same calibrator. */
export function calibratorContentId(calibrator: FittedCalibrator): string {
  const digest = canonicalSha256({
    identity: { modelVersion: calibrator.identity.modelVersion, configHash: calibrator.identity.configHash },
    market: calibrator.market,
    method: calibrator.method,
    calibrationConfigHash: calibrator.calibrationConfigHash,
    samplesDigest: calibrator.samplesDigest,
  });
  return `calibrator_${digest.slice("sha256:".length)}`;
}

/** Instants compare as instants: a stored timestamp always reads back in canonical `toISOString()` form. */
function instantOf(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

/**
 * Digest of EVERYTHING a stored calibrator holds except `fittedAsOf`: identity, market, method, parameters, windows, sample
 * sizes, holdout metrics, samples digest and config. `calibratorContentId` deliberately covers only the inputs of a fit, so the
 * id alone cannot show that a stored row still equals a fresh fit (WR-05); this digest can. Key order does not matter
 * (canonical JSON), which is what makes a PostgreSQL jsonb round trip comparable.
 */
export function calibratorContentDigest(calibrator: FittedCalibrator): string {
  return canonicalSha256({
    identity: { modelVersion: calibrator.identity.modelVersion, configHash: calibrator.identity.configHash },
    market: calibrator.market,
    method: calibrator.method,
    parameters: calibrator.parameters,
    fitSampleSize: calibrator.fitSampleSize,
    holdoutSampleSize: calibrator.holdoutSampleSize,
    fitFrom: instantOf(calibrator.fitFrom),
    fitTo: instantOf(calibrator.fitTo),
    holdoutFrom: instantOf(calibrator.holdoutFrom),
    holdoutTo: instantOf(calibrator.holdoutTo),
    holdoutBrierRaw: calibrator.holdoutBrierRaw,
    holdoutBrierCalibrated: calibrator.holdoutBrierCalibrated,
    plattHoldoutBrier: calibrator.plattHoldoutBrier ?? null,
    isotonicHoldoutBrier: calibrator.isotonicHoldoutBrier ?? null,
    samplesDigest: calibrator.samplesDigest,
    calibrationConfigVersion: calibrator.calibrationConfigVersion,
    calibrationConfigHash: calibrator.calibrationConfigHash,
  });
}

function modelledClassCount(market: ScoreMarket): number {
  return market === "ONE_X_TWO" ? 3 : 1;
}

/** Calibrated vector in `SCORE_CLASS_ORDER[market]` order: [q, 1 - q] for binary markets, renormalised one-vs-rest for 1X2. */
function calibrateVector(model: CalibratorModel, market: ScoreMarket, probabilities: readonly number[]): number[] {
  const { epsilon } = model.parameters;
  const mapped =
    model.method === "PLATT"
      ? model.parameters.scalers.map((scaler, index) => applyPlatt(scaler, probabilities[index]!, epsilon))
      : model.parameters.scalers.map((scaler, index) => applyIsotonic(scaler, probabilities[index]!, epsilon));
  if (market !== "ONE_X_TWO") return [mapped[0]!, 1 - mapped[0]!];
  const total = mapped[0]! + mapped[1]! + mapped[2]!;
  return mapped.map((value) => value / total);
}

function holdoutBrier(model: CalibratorModel, market: ScoreMarket, holdout: readonly CalibrationSample[]): number {
  return meanCategoricalBrier(
    holdout.map((sample) => ({ probabilities: calibrateVector(model, market, sample.probabilities), outcomeIndex: sample.outcomeIndex })),
  );
}

/**
 * Fit a calibrator for one market (D-01, D-02, D-05). Platt (one-vs-rest for 1X2) is always fitted on the fit window;
 * isotonic is considered only when S >= `minimumSamples.isotonic` and chosen only when its holdout Brier beats Platt by at
 * least `materiality`. Below `minimumSamples.platt` the explicit INSUFFICIENT_DATA state is returned.
 */
export function fitMarketCalibrator(input: FitMarketCalibratorInput): FitMarketCalibratorResult {
  const { identity, market, samples, asOf, config } = input;
  assertIdentity(identity);
  if (!(config.markets as readonly string[]).includes(market)) throw calibrationError("CALIBRATION_FIT_FAILED", "market not in calibration scope");
  assertCalibrationSamples(market, samples);

  const assessment = assessCalibrationData(samples, config);
  if (assessment.state === "INSUFFICIENT_DATA") return assessment;

  const epsilon = config.probabilityClipEpsilon;
  const classCount = modelledClassCount(market);
  const plattOptions: PlattFitOptions = {
    epsilon,
    maxIterations: config.platt.maxIterations,
    gradientTolerance: config.platt.gradientTolerance,
    stepTolerance: config.platt.stepTolerance,
    priorStrength: config.platt.priorStrength,
    maxBacktracks: config.platt.maxBacktracks,
  };
  const classPoints = (index: number) =>
    assessment.fit.map((sample) => ({ probability: sample.probabilities[index]!, label: (sample.outcomeIndex === index ? 1 : 0) as 0 | 1 }));
  const indices = Array.from({ length: classCount }, (_, index) => index);

  const plattModel: CalibratorModel = {
    method: "PLATT",
    parameters: { epsilon, scalers: indices.map((index) => fitPlatt(classPoints(index), plattOptions)) },
  };
  const holdoutBrierRaw = meanCategoricalBrier(assessment.holdout);
  const plattBrier = holdoutBrier(plattModel, market, assessment.holdout);

  let chosen: CalibratorModel = plattModel;
  let chosenBrier = plattBrier;
  let isotonicBrier: number | undefined;
  if (assessment.sampleSize >= config.minimumSamples.isotonic) {
    const isotonicModel: CalibratorModel = {
      method: "ISOTONIC",
      parameters: { epsilon, scalers: indices.map((index) => fitIsotonic(classPoints(index), epsilon)) },
    };
    isotonicBrier = holdoutBrier(isotonicModel, market, assessment.holdout);
    if (plattBrier - isotonicBrier >= config.materiality) {
      chosen = isotonicModel;
      chosenBrier = isotonicBrier;
    }
  }

  const base: FittedCalibratorBase = {
    identity: { modelVersion: identity.modelVersion, configHash: identity.configHash },
    market,
    fitSampleSize: assessment.fit.length,
    holdoutSampleSize: assessment.holdout.length,
    fitFrom: assessment.fitFrom,
    fitTo: assessment.fitTo,
    holdoutFrom: assessment.holdoutFrom,
    holdoutTo: assessment.holdoutTo,
    holdoutBrierRaw,
    holdoutBrierCalibrated: chosenBrier,
    ...(isotonicBrier === undefined ? {} : { plattHoldoutBrier: plattBrier, isotonicHoldoutBrier: isotonicBrier }),
    samplesDigest: calibrationSamplesDigest(samples),
    calibrationConfigVersion: config.version,
    calibrationConfigHash: canonicalSha256(config),
    fittedAsOf: asOf,
  };
  return { state: "FITTED", calibrator: { ...base, ...chosen } };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invalid(detail: string): never {
  throw calibrationError("CALIBRATOR_INVALID", detail);
}

/**
 * Structural check of calibrator parameters, which arrive from the database. Anything malformed throws
 * CALIBRATOR_INVALID instead of producing NaN or silently returning raw probabilities.
 */
export function assertCalibratorStructure(calibrator: unknown): asserts calibrator is FittedCalibrator {
  if (!calibrator || typeof calibrator !== "object") invalid("calibrator is not an object");
  const candidate = calibrator as Record<string, unknown>;
  const market = candidate.market;
  if (typeof market !== "string" || !Object.hasOwn(SCORE_CLASS_ORDER, market)) invalid("unknown market");
  if (candidate.method !== "PLATT" && candidate.method !== "ISOTONIC") invalid("unknown method");
  const parameters = candidate.parameters as Record<string, unknown> | undefined;
  if (!parameters || typeof parameters !== "object") invalid("parameters are missing");
  const epsilon = parameters.epsilon;
  if (!isFiniteNumber(epsilon) || epsilon <= 0 || epsilon >= 0.5) invalid("epsilon is out of range");
  const scalers = parameters.scalers;
  if (!Array.isArray(scalers) || scalers.length !== modelledClassCount(market as ScoreMarket)) invalid("scaler count does not match the market");

  for (const scaler of scalers as unknown[]) {
    if (!scaler || typeof scaler !== "object") invalid("scaler is not an object");
    if (candidate.method === "PLATT") {
      const platt = scaler as Record<string, unknown>;
      if (!isFiniteNumber(platt.slope) || !isFiniteNumber(platt.intercept)) invalid("Platt scaler is not finite");
      continue;
    }
    const nodes = (scaler as Record<string, unknown>).nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) invalid("isotonic nodes are empty");
    let previousX = -Infinity;
    let previousValue = -Infinity;
    for (const node of nodes as unknown[]) {
      const entry = node as Record<string, unknown> | null;
      if (!entry || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.value)) invalid("isotonic node is not finite");
      const { x, value } = entry as { x: number; value: number };
      if (x < 0 || x > 1 || value < 0 || value > 1) invalid("isotonic node is outside [0, 1]");
      if (x <= previousX) invalid("isotonic nodes are not strictly increasing in x");
      if (value < previousValue) invalid("isotonic values are not non-decreasing");
      previousX = x;
      previousValue = value;
    }
  }
}

/**
 * Apply a calibrator to a raw probability vector (D-06, CALIB-02). Order of checks: identity (`modelVersion` and
 * `configHash`), market, parameter structure, then computation. A failure throws and never returns a vector.
 */
export function applyCalibrator(
  calibrator: FittedCalibrator,
  forecastIdentity: CalibratorIdentity,
  market: ScoreMarket,
  probabilities: readonly number[],
): number[] {
  if (
    !forecastIdentity || !isForecastModelVersion(forecastIdentity.modelVersion) ||
    forecastIdentity.modelVersion !== calibrator?.identity?.modelVersion ||
    forecastIdentity.configHash !== calibrator.identity.configHash
  ) throw calibrationError("CALIBRATOR_MODEL_MISMATCH");
  if (market !== calibrator.market) throw calibrationError("CALIBRATOR_MARKET_MISMATCH");
  assertCalibratorStructure(calibrator);

  const classCount = SCORE_CLASS_ORDER[market].length;
  if (
    !Array.isArray(probabilities) || probabilities.length !== classCount ||
    !probabilities.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)
  ) throw calibrationError("INVALID_CALIBRATION_INPUT", "probability vector does not match the market");

  return calibrateVector(calibrator, market, probabilities);
}
