import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";

import type { ForecastModelVersion } from "./model-version.js";

/**
 * Frozen `poisson-ensemble-v1` configuration.
 *
 * DO NOT CHANGE THIS OBJECT. Every issued V1 receipt carries
 * `configVersion: "forecast-config-v1"` and the orchestrator recomputes its hash
 * on every request; any byte change would make historical V1 rows un-reissuable
 * and break the V1 regression pin (D-02 / D-10 amended).
 */
export const FORECAST_CONFIG = Object.freeze({
  version: "forecast-config-v1" as const,
  decimalPrecision: 40,
  decimalRounding: "ROUND_HALF_EVEN" as const,
  probabilityTolerance: 1e-12,
  tailWarningThreshold: 0.01,
  baselineGoals: Object.freeze({ home: 1.45, away: 1.15 }),
  coefficients: Object.freeze({ goalRates: 0.35, elo: 0.18, form: 0.12, venue: 0.1, rest: 0.05, h2h: 0.03 }),
  transformBounds: Object.freeze([-0.2, 0.2] as const),
  h2hBounds: Object.freeze([-0.03, 0.03] as const),
  multiplierBounds: Object.freeze([0.65, 1.35] as const),
  lambdaBounds: Object.freeze([0.2, 4] as const),
  minimumSamples: Object.freeze({ goalRates: 5, elo: 1, form5: 3, venue: 3, restDays: 1, h2h: 3 }),
});

export type ForecastConfigVersion = "forecast-config-v1" | "forecast-config-v2";

export const FORECAST_CONFIG_VERSION_BY_MODEL: Readonly<Record<ForecastModelVersion, ForecastConfigVersion>> = Object.freeze({
  "poisson-ensemble-v1": "forecast-config-v1",
  "dixon-coles-ensemble-v1": "forecast-config-v2",
});

/**
 * `dixon-coles-ensemble-v1` identity: the frozen V1 baseline parameters plus the
 * pinned low-score correction policy (convention, bounds epsilon, ρ estimation).
 * `ρ` itself is not a config constant — it enters `inputHash` with its provenance.
 */
export const DIXON_COLES_CONFIG = Object.freeze({
  ...FORECAST_CONFIG,
  version: "forecast-config-v2" as const,
  dixonColes: Object.freeze({
    convention: "tau-1x2-v1" as const,
    boundsEpsilon: 1e-9,
    estimation: Object.freeze({
      method: "mle-low-score-v1" as const,
      windowDays: 730,
      minLeagueMatches: 150,
      minPooledMatches: 300,
      bisectionIterations: 80,
      fallback: "zero" as const,
    }),
  }),
});

export const FORECAST_CONFIGS = Object.freeze({
  "poisson-ensemble-v1": FORECAST_CONFIG,
  "dixon-coles-ensemble-v1": DIXON_COLES_CONFIG,
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

/** Config hash for a model version. For V1 this is exactly the historical `currentForecastConfigHash()`. */
export function forecastConfigHashFor(version: ForecastModelVersion): string {
  return sha(FORECAST_CONFIGS[version]);
}

Decimal.set({ precision: FORECAST_CONFIG.decimalPrecision, rounding: Decimal.ROUND_HALF_EVEN });

export function fairOddsForProbability(probability: number): string | null {
  return Number.isFinite(probability) && probability > 0 && probability <= 1
    ? new Decimal(1).div(probability).toString()
    : null;
}
