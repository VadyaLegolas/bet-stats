import { Decimal } from "decimal.js";

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

Decimal.set({ precision: FORECAST_CONFIG.decimalPrecision, rounding: Decimal.ROUND_HALF_EVEN });

export function fairOddsForProbability(probability: number): string | null {
  return Number.isFinite(probability) && probability > 0 && probability <= 1
    ? new Decimal(1).div(probability).toString()
    : null;
}
