import { SCORE_CLASS_ORDER, type ScoreMarket } from "../evaluation/scoring.js";
import type { ForecastResponseDto } from "../forecast/contract.js";
import type { ForecastMarket } from "../forecast/model.js";

import { applyCalibrator, type CalibratorMethod, type FittedCalibrator } from "./calibrator.js";
import type { CalibrationConfig } from "./config.js";
import { calibrationError } from "./errors.js";

/**
 * Pure resolver of the per-market calibration state for the forecast API (D-06, D-11, CALIB-04).
 * The calibration layer is read-only: nothing here changes a forecast receipt (D-08).
 */

export const CALIBRATION_STATES = ["CALIBRATED", "INSUFFICIENT_DATA", "UNAVAILABLE"] as const;
export type CalibrationState = (typeof CALIBRATION_STATES)[number];

export const CALIBRATION_REASON_CODES = [
  "INSUFFICIENT_SETTLED_OUTCOMES",
  "NO_PROMOTED_CALIBRATOR",
  "KIND_NOT_COVERED",
  "CALIBRATOR_MODEL_MISMATCH",
  "CALIBRATOR_MARKET_MISMATCH",
  "CALIBRATOR_INVALID",
  "CALIBRATION_READ_FAILED",
] as const;
export type CalibrationReasonCode = (typeof CALIBRATION_REASON_CODES)[number];

/**
 * Calibration block of one market. Optional fields are absent (never `undefined`) when they do not apply.
 * `method`, `holdoutBrierRaw` and `holdoutBrierCalibrated` extend D-11 so the UI can name the method and
 * show the holdout numbers honestly (D-12).
 */
export interface MarketCalibrationState {
  readonly state: CalibrationState;
  readonly calibratedProbabilities?: readonly number[];
  readonly calibratorVersion?: number;
  readonly method?: CalibratorMethod;
  readonly sampleSize?: number;
  readonly requiredSample?: number;
  readonly holdoutBrierRaw?: number;
  readonly holdoutBrierCalibrated?: number;
  readonly reasonCode?: CalibrationReasonCode;
}

export interface MarketCalibrationView {
  /** Raw model probabilities in `SCORE_CLASS_ORDER[market]` order: always the source of truth. */
  readonly rawProbabilities: readonly number[];
  readonly calibration: MarketCalibrationState;
}

/** The promoted calibrator of one market as read from the store; `version` is the per-market promotion number. */
export interface ActiveCalibrator {
  readonly calibratorId: string;
  readonly version: number;
  readonly calibrator: FittedCalibrator;
}

/** The API response: the frozen receipt plus a separate `marketCalibration` key (never parsed by `parseForecastResponse`). */
export type CalibratedForecastResponseDto = ForecastResponseDto & {
  readonly marketCalibration: Readonly<Record<ForecastMarket, MarketCalibrationView>>;
};

type ForecastForCalibration = Pick<ForecastResponseDto, "kind" | "modelVersion" | "configHash" | "probabilities">;

const FORECAST_MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ForecastMarket[];
const PROBABILITY_SUM_TOLERANCE = 1e-12;

/**
 * Raw probabilities of one market in class order. A forecast whose market block does not match the class order
 * is a caller bug (the receipt is parsed upstream), so this throws INVALID_CALIBRATION_INPUT instead of guessing.
 */
function rawProbabilitiesOf(forecast: Pick<ForecastResponseDto, "probabilities">, market: ScoreMarket): number[] {
  const expected = SCORE_CLASS_ORDER[market];
  const events = forecast.probabilities?.[market];
  if (!Array.isArray(events) || events.length !== expected.length) {
    throw calibrationError("INVALID_CALIBRATION_INPUT", "forecast market block does not match the class order");
  }
  return events.map((event, index) => {
    if (!event || event.selection !== expected[index] || typeof event.probability !== "number" || !Number.isFinite(event.probability)) {
      throw calibrationError("INVALID_CALIBRATION_INPUT", "forecast probability is not valid");
    }
    return event.probability;
  });
}

function unavailable(rawProbabilities: readonly number[], reasonCode: CalibrationReasonCode): MarketCalibrationView {
  return { rawProbabilities, calibration: { state: "UNAVAILABLE", reasonCode } };
}

/** Failure path (e.g. the calibration store could not be read): UNAVAILABLE with the raw probabilities intact. */
export function unavailableMarketCalibration(input: {
  readonly forecast: Pick<ForecastResponseDto, "probabilities">;
  readonly market: ForecastMarket;
  readonly reasonCode?: CalibrationReasonCode;
}): MarketCalibrationView {
  return unavailable(rawProbabilitiesOf(input.forecast, input.market), input.reasonCode ?? "CALIBRATION_READ_FAILED");
}

function reasonOfError(error: unknown): CalibrationReasonCode {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "CALIBRATOR_MODEL_MISMATCH") return "CALIBRATOR_MODEL_MISMATCH";
  if (code === "CALIBRATOR_MARKET_MISMATCH") return "CALIBRATOR_MARKET_MISMATCH";
  return "CALIBRATOR_INVALID";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export interface ResolveMarketCalibrationInput {
  readonly forecast: ForecastForCalibration;
  readonly market: ForecastMarket;
  /** Promoted calibrator for this market and the forecast's pinned identity, or null. */
  readonly active: ActiveCalibrator | null;
  /** Count of settled, leakage-safe outcomes for this market and identity (used only when there is no calibrator). */
  readonly eligibleSampleSize: number;
  readonly config: CalibrationConfig;
}

/**
 * State of one market for one forecast (D-06, D-11). Order: kind not covered, then the active calibrator (applied
 * with the forecast's own identity: any refusal becomes UNAVAILABLE, never CALIBRATED), then the data gate.
 * It does not throw for calibrator or count problems; only a malformed forecast block throws (caller bug).
 */
export function resolveMarketCalibration(input: ResolveMarketCalibrationInput): MarketCalibrationView {
  const { forecast, market, active, eligibleSampleSize, config } = input;
  const rawProbabilities = rawProbabilitiesOf(forecast, market);

  if (!(config.fit.servedKinds as readonly string[]).includes(forecast.kind)) return unavailable(rawProbabilities, "KIND_NOT_COVERED");

  if (active !== null) {
    try {
      const calibrator = active.calibrator;
      const calibrated = applyCalibrator(calibrator, { modelVersion: forecast.modelVersion, configHash: forecast.configHash }, market, rawProbabilities);
      const total = calibrated.reduce((sum, value) => sum + value, 0);
      if (
        !Number.isInteger(active.version) || active.version < 1 ||
        !calibrated.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
        Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE ||
        !isNonNegativeInteger(calibrator.holdoutSampleSize) ||
        !Number.isFinite(calibrator.holdoutBrierRaw) ||
        !Number.isFinite(calibrator.holdoutBrierCalibrated)
      ) {
        return unavailable(rawProbabilities, "CALIBRATOR_INVALID");
      }
      return {
        rawProbabilities,
        calibration: {
          state: "CALIBRATED",
          calibratedProbabilities: calibrated,
          calibratorVersion: active.version,
          method: calibrator.method,
          sampleSize: calibrator.holdoutSampleSize,
          holdoutBrierRaw: calibrator.holdoutBrierRaw,
          holdoutBrierCalibrated: calibrator.holdoutBrierCalibrated,
        },
      };
    } catch (error) {
      return unavailable(rawProbabilities, reasonOfError(error));
    }
  }

  if (!isNonNegativeInteger(eligibleSampleSize)) return unavailable(rawProbabilities, "CALIBRATION_READ_FAILED");
  const required = config.minimumSamples.platt;
  if (eligibleSampleSize < required) {
    return {
      rawProbabilities,
      calibration: { state: "INSUFFICIENT_DATA", sampleSize: eligibleSampleSize, requiredSample: required, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" },
    };
  }
  return unavailable(rawProbabilities, "NO_PROMOTED_CALIBRATOR");
}

export interface ResolveForecastCalibrationInput {
  readonly forecast: ForecastForCalibration;
  readonly active: Readonly<Record<ForecastMarket, ActiveCalibrator | null>>;
  readonly eligibleSampleSize: Readonly<Record<ForecastMarket, number>>;
  readonly config: CalibrationConfig;
}

/** One entry per market, keys in the fixed order ONE_X_TWO, OVER_UNDER_2_5, BTTS. */
export function resolveForecastCalibration(input: ResolveForecastCalibrationInput): Readonly<Record<ForecastMarket, MarketCalibrationView>> {
  const { forecast, active, eligibleSampleSize, config } = input;
  return {
    ONE_X_TWO: resolveMarketCalibration({ forecast, market: "ONE_X_TWO", active: active.ONE_X_TWO, eligibleSampleSize: eligibleSampleSize.ONE_X_TWO, config }),
    OVER_UNDER_2_5: resolveMarketCalibration({ forecast, market: "OVER_UNDER_2_5", active: active.OVER_UNDER_2_5, eligibleSampleSize: eligibleSampleSize.OVER_UNDER_2_5, config }),
    BTTS: resolveMarketCalibration({ forecast, market: "BTTS", active: active.BTTS, eligibleSampleSize: eligibleSampleSize.BTTS, config }),
  };
}

// ---------------------------------------------------------------------------------------------
// Strict parser of the `marketCalibration` map (T-12-06). Deliberately NOT wired into `parseForecastResponse`.
// ---------------------------------------------------------------------------------------------

function invalid(detail: string): never {
  throw calibrationError("INVALID_MARKET_CALIBRATION", detail);
}

function record(value: unknown, detail: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(detail);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], detail: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.hasOwn(value, key))) invalid(detail);
}

function probabilityVector(value: unknown, length: number, tolerance: number, detail: string): void {
  if (!Array.isArray(value) || value.length !== length) invalid(detail);
  let total = 0;
  for (const entry of value as unknown[]) {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 1) invalid(detail);
    total += entry as number;
  }
  if (Math.abs(total - 1) > tolerance) invalid(detail);
}

interface StateShape {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

const STATE_SHAPES: Readonly<Record<CalibrationState, StateShape>> = {
  CALIBRATED: {
    required: ["state", "calibratedProbabilities", "calibratorVersion"],
    optional: ["method", "sampleSize", "holdoutBrierRaw", "holdoutBrierCalibrated"],
  },
  INSUFFICIENT_DATA: { required: ["state", "sampleSize", "requiredSample", "reasonCode"], optional: [] },
  UNAVAILABLE: { required: ["state", "reasonCode"], optional: [] },
};

function parseCalibrationBlock(value: unknown, classCount: number): void {
  const block = record(value, "calibration is not an object");
  const state = block.state;
  if (!CALIBRATION_STATES.includes(state as CalibrationState)) invalid("unknown calibration state");
  const shape = STATE_SHAPES[state as CalibrationState];
  const allowed = new Set([...shape.required, ...shape.optional]);
  if (Object.keys(block).some((key) => !allowed.has(key)) || shape.required.some((key) => !Object.hasOwn(block, key))) invalid("calibration keys do not match the state");
  if (Object.values(block).some((entry) => entry === undefined)) invalid("calibration carries an undefined value");

  if ("reasonCode" in block && !CALIBRATION_REASON_CODES.includes(block.reasonCode as CalibrationReasonCode)) invalid("reason code is not in the closed set");

  if (state === "CALIBRATED") {
    probabilityVector(block.calibratedProbabilities, classCount, PROBABILITY_SUM_TOLERANCE, "calibratedProbabilities are not a probability vector");
    if (!Number.isInteger(block.calibratorVersion) || (block.calibratorVersion as number) < 1) invalid("calibratorVersion is not a positive integer");
    if ("method" in block && block.method !== "PLATT" && block.method !== "ISOTONIC") invalid("unknown method");
    if ("sampleSize" in block && !isNonNegativeInteger(block.sampleSize)) invalid("sampleSize is not a non-negative integer");
    for (const key of ["holdoutBrierRaw", "holdoutBrierCalibrated"] as const) {
      if (key in block && (typeof block[key] !== "number" || !Number.isFinite(block[key]))) invalid(`${key} is not finite`);
    }
    return;
  }
  if (state === "INSUFFICIENT_DATA") {
    if (!isNonNegativeInteger(block.sampleSize) || !isNonNegativeInteger(block.requiredSample) || block.sampleSize >= block.requiredSample) invalid("sample counts are inconsistent");
    if (block.reasonCode !== "INSUFFICIENT_SETTLED_OUTCOMES") invalid("INSUFFICIENT_DATA requires INSUFFICIENT_SETTLED_OUTCOMES");
    return;
  }
  if (block.reasonCode === "INSUFFICIENT_SETTLED_OUTCOMES") invalid("UNAVAILABLE cannot carry the insufficient-data reason");
}

/** Strict parse of `marketCalibration`: exact markets, exact keys per state, closed reason codes. Returns the input. */
export function parseMarketCalibrationMap(value: unknown): Readonly<Record<ForecastMarket, MarketCalibrationView>> {
  const map = record(value, "marketCalibration is not an object");
  exactKeys(map, FORECAST_MARKETS, "marketCalibration markets do not match");
  for (const market of FORECAST_MARKETS) {
    const view = record(map[market], "market view is not an object");
    exactKeys(view, ["rawProbabilities", "calibration"], "market view keys do not match");
    const classCount = SCORE_CLASS_ORDER[market].length;
    probabilityVector(view.rawProbabilities, classCount, 1e-9, "rawProbabilities are not a probability vector");
    parseCalibrationBlock(view.calibration, classCount);
  }
  return value as Readonly<Record<ForecastMarket, MarketCalibrationView>>;
}
