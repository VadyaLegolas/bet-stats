/**
 * Dixon-Coles low-score correction as a *versioned* model identity.
 *
 * This module holds the pinned τ convention and the closed-field provenance that
 * an issued `dixon-coles-ensemble-v1` receipt must carry (D-06 / D-11).
 */
export const DIXON_COLES_CONVENTION = "tau-1x2-v1" as const;

export type DixonColesEstimationMethod = "mle-low-score-v1" | "pooled-fallback-v1" | "insufficient-sample-zero";

export interface DixonColesProvenance {
  readonly rho: number;
  readonly convention: typeof DIXON_COLES_CONVENTION;
  readonly method: DixonColesEstimationMethod;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly sampleSize: number;
  readonly tauMin: number;
}
