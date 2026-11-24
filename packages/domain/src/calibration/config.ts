import { canonicalSha256 } from "../forecast/canonical-json.js";

/**
 * Frozen `calibration-config-v1` policy (D-07).
 *
 * DO NOT CHANGE ANY VALUE IN THIS OBJECT. Every fitted calibrator and every
 * promotion/rollback event records `CALIBRATION_CONFIG_VERSION` and
 * `CALIBRATION_CONFIG_HASH`; changing a value in place would silently re-interpret
 * history. A different policy is a new object (`calibration-config-v2`) and old
 * fits stay valid under their own version.
 *
 * `materiality` is the same Brier unit and the same threshold as
 * `MODEL_COMPARISON_POLICY.deltaMateriality` (unscaled categorical sum, range 0-2).
 */
export const CALIBRATION_CONFIG = Object.freeze({
  version: "calibration-config-v1" as const,
  /** The three score markets already scored by `ForecastScore` (D-03). */
  markets: Object.freeze(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const),
  minimumSamples: Object.freeze({ platt: 300, isotonic: 1500, holdout: 60 }),
  holdoutFraction: 0.2,
  materiality: 0.002,
  rollback: Object.freeze({ consecutiveWorse: 3, minimumEvaluationSample: 30 }),
  probabilityClipEpsilon: 1e-6,
  cadence: Object.freeze({ interval: "daily" as const, intervalHours: 24 }),
  /**
   * `kinds`: forecast kinds used for fitting (one pre-match forecast per match, as in
   * the rho fit; INITIAL is not covered). `servedKinds`: kinds the promoted calibrator
   * may be shown for.
   */
  fit: Object.freeze({
    kinds: Object.freeze(["PRE_MATCH"] as const),
    servedKinds: Object.freeze(["PRE_MATCH", "LINEUP_CONFIRMED"] as const),
  }),
  /**
   * Newton fit of the Platt scaler. The L2 prior pulls the slope to 1 and the intercept
   * to 0 (the identity map), which keeps the Hessian positive definite and the solution
   * finite on separable or single-label data.
   */
  platt: Object.freeze({
    maxIterations: 50,
    gradientTolerance: 1e-9,
    stepTolerance: 1e-12,
    priorStrength: 1,
    maxBacktracks: 40,
  }),
});

export type CalibrationConfig = typeof CALIBRATION_CONFIG;

export const CALIBRATION_CONFIG_VERSION = CALIBRATION_CONFIG.version;
export const CALIBRATION_CONFIG_HASH: string = canonicalSha256(CALIBRATION_CONFIG);
