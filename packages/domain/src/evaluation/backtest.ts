import type { ForecastResponseDto } from "../forecast/contract.js";

export const BACKTEST_POLICY_VERSION = "rolling-origin-v1" as const;

export interface RollingOriginWindow {
  readonly id: string;
  readonly fixtureId: string;
  readonly trainingEndsAt: string;
  readonly forecastCutoff: string;
  /** Result knowledge boundary. Independent from the forecast evidence cutoff. */
  readonly evaluationAsOf: string;
}

export interface BacktestOriginResult {
  readonly window: RollingOriginWindow;
  readonly forecast: ForecastResponseDto;
}

export function validateRollingOriginWindow(window: RollingOriginWindow, previousCutoff?: string): RollingOriginWindow {
  const trainingEnd = Date.parse(window.trainingEndsAt);
  const cutoff = Date.parse(window.forecastCutoff);
  const evaluationAsOf = Date.parse(window.evaluationAsOf);
  if (!window.id || !window.fixtureId || !Number.isFinite(trainingEnd) || !Number.isFinite(cutoff) || !Number.isFinite(evaluationAsOf)) throw Object.assign(new Error("INVALID_BACKTEST_WINDOW"), { code: "INVALID_BACKTEST_WINDOW" });
  if (trainingEnd >= cutoff || (previousCutoff !== undefined && Date.parse(previousCutoff) >= cutoff)) throw Object.assign(new Error("LEAKAGE_DETECTED"), { code: "LEAKAGE_DETECTED" });
  if (evaluationAsOf <= cutoff) throw Object.assign(new Error("INVALID_EVALUATION_AS_OF"), { code: "INVALID_EVALUATION_AS_OF" });
  return window;
}
