/**
 * Single source of truth for accepted forecast model versions (MODEL-02).
 *
 * Every identity check in the stack must validate membership in this union.
 * An unknown string is rejected fail-closed instead of being interpreted as
 * "the latest model".
 */
export const MODEL_VERSIONS = ["poisson-ensemble-v1", "dixon-coles-ensemble-v1"] as const;

export type ForecastModelVersion = (typeof MODEL_VERSIONS)[number];

/** The version issued for new forecasts. `poisson-ensemble-v1` stays selectable. */
export const DEFAULT_FORECAST_MODEL_VERSION: ForecastModelVersion = "dixon-coles-ensemble-v1";

export function isForecastModelVersion(value: unknown): value is ForecastModelVersion {
  return typeof value === "string" && (MODEL_VERSIONS as readonly string[]).includes(value);
}
