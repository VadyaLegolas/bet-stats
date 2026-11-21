import { DIXON_COLES_CONFIG } from "./config.js";

/**
 * Dixon-Coles low-score correction as a *versioned* model identity.
 *
 * Pure functions only: no I/O, no database, no clock, no randomness. The hybrid
 * integration keeps the existing Elo/form/venue lambdas and multiplies exactly
 * four scorelines by `tau` before the retained-mass normalization (D-05, D-06).
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

export interface DixonColesRhoBounds {
  readonly min: number;
  readonly max: number;
}

export interface DixonColesCell {
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly probability: number;
}

export interface DixonColesEstimationRow {
  readonly lambdaHome: number;
  readonly lambdaAway: number;
  readonly homeGoals: number;
  readonly awayGoals: number;
}

export interface DixonColesEstimationOptions {
  readonly windowFrom?: string;
  readonly windowTo?: string;
  readonly minSamples?: number;
}

/** Deterministic placeholder window for a caller that supplies no evidence range. */
const EMPTY_WINDOW = "1970-01-01T00:00:00.000Z";

/**
 * Pinned tau convention (D-06):
 * `tau(0,0) = 1 - λh·λa·ρ`, `tau(1,0) = 1 + λa·ρ`,
 * `tau(0,1) = 1 + λh·ρ`, `tau(1,1) = 1 - ρ`; every other cell is 1.
 */
export function dixonColesTau(homeGoals: number, awayGoals: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

/**
 * Feasible `rho` band derived from strict positivity of all four tau factors
 * (D-07 amended): `max(-1/(λh·λa), -1/λh, -1/λa) < rho < min(1/(λh·λa), 1)`.
 */
export function dixonColesRhoBounds(lambdaHome: number, lambdaAway: number): DixonColesRhoBounds {
  if (!Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway) || lambdaHome <= 0 || lambdaAway <= 0) throw new Error("INVALID_DIXON_COLES_LAMBDA");
  const product = lambdaHome * lambdaAway;
  return {
    min: Math.max(-1 / product, -1 / lambdaHome, -1 / lambdaAway),
    max: Math.min(1 / product, 1),
  };
}

/** Fail-closed band check: rejects an out-of-band or non-finite rho, never clamps it. */
export function assertDixonColesRho(
  rho: number,
  bounds: DixonColesRhoBounds,
  epsilon: number = DIXON_COLES_CONFIG.dixonColes.boundsEpsilon,
): void {
  if (!Number.isFinite(rho) || !Number.isFinite(bounds.min) || !Number.isFinite(bounds.max)) throw new Error("INVALID_DIXON_COLES_RHO");
  if (rho <= bounds.min + epsilon || rho >= bounds.max - epsilon) throw new Error("INVALID_DIXON_COLES_RHO");
}

/** Minimum tau over the four corrected cells — the provenance "worst case" guard. */
export function dixonColesTauMin(lambdaHome: number, lambdaAway: number, rho: number): number {
  return Math.min(
    dixonColesTau(0, 0, lambdaHome, lambdaAway, rho),
    dixonColesTau(1, 0, lambdaHome, lambdaAway, rho),
    dixonColesTau(0, 1, lambdaHome, lambdaAway, rho),
    dixonColesTau(1, 1, lambdaHome, lambdaAway, rho),
  );
}

/**
 * Multiplies the four low-score cells by tau and returns a new grid.
 * Never mutates the input; at `rho = 0` every probability is bit-identical.
 */
export function applyDixonColesCorrection(input: {
  readonly cells: readonly DixonColesCell[];
  readonly lambdaHome: number;
  readonly lambdaAway: number;
  readonly rho: number;
}): DixonColesCell[] {
  assertDixonColesRho(input.rho, dixonColesRhoBounds(input.lambdaHome, input.lambdaAway));
  return input.cells.map((cell) => {
    const tau = dixonColesTau(cell.homeGoals, cell.awayGoals, input.lambdaHome, input.lambdaAway, input.rho);
    return tau === 1 ? cell : { ...cell, probability: cell.probability * tau };
  });
}

/** Derivative of tau with respect to rho, evaluated for one observed scoreline. */
function tauDerivative(homeGoals: number, awayGoals: number, lambdaHome: number, lambdaAway: number): number {
  if (homeGoals === 0 && awayGoals === 0) return -(lambdaHome * lambdaAway);
  if (homeGoals === 1 && awayGoals === 0) return lambdaAway;
  if (homeGoals === 0 && awayGoals === 1) return lambdaHome;
  if (homeGoals === 1 && awayGoals === 1) return -1;
  return 0;
}

function scoreTerm(row: DixonColesEstimationRow, rho: number): number {
  const derivative = tauDerivative(row.homeGoals, row.awayGoals, row.lambdaHome, row.lambdaAway);
  if (derivative === 0) return 0;
  return derivative / dixonColesTau(row.homeGoals, row.awayGoals, row.lambdaHome, row.lambdaAway, rho);
}

function usable(row: DixonColesEstimationRow): boolean {
  return Number.isFinite(row.lambdaHome) && row.lambdaHome > 0
    && Number.isFinite(row.lambdaAway) && row.lambdaAway > 0
    && Number.isInteger(row.homeGoals) && row.homeGoals >= 0
    && Number.isInteger(row.awayGoals) && row.awayGoals >= 0;
}

/**
 * Deterministic one-dimensional score-function root finder for rho.
 *
 * The low-score log-likelihood contributes only through the four tau cells, so
 * `S(rho) = Σ tau'/tau` over those cells is a strictly decreasing function of
 * rho. Fixed-iteration bisection over the intersection of every row's feasible
 * band; no randomness and no dependence on row order (rows are sorted by a
 * stable key before summing).
 *
 * Insufficient sample, empty band, or no sign change => explicit `rho = 0`
 * with method `insufficient-sample-zero` (honest and reproducible, never NaN).
 */
export function estimateDixonColesRho(
  rows: readonly DixonColesEstimationRow[],
  options: DixonColesEstimationOptions = {},
): DixonColesProvenance {
  const windowFrom = options.windowFrom ?? EMPTY_WINDOW;
  const windowTo = options.windowTo ?? EMPTY_WINDOW;
  const minSamples = options.minSamples ?? DIXON_COLES_CONFIG.dixonColes.estimation.minPooledMatches;
  const ordered = rows.filter(usable).sort((left, right) => {
    const a = `${left.lambdaHome}|${left.lambdaAway}|${left.homeGoals}|${left.awayGoals}`;
    const b = `${right.lambdaHome}|${right.lambdaAway}|${right.homeGoals}|${right.awayGoals}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const fallback: DixonColesProvenance = {
    rho: 0,
    convention: DIXON_COLES_CONVENTION,
    method: "insufficient-sample-zero",
    windowFrom,
    windowTo,
    sampleSize: ordered.length,
    tauMin: 1,
  };
  if (ordered.length < minSamples) return fallback;

  let min = Number.NEGATIVE_INFINITY;
  let max = Number.POSITIVE_INFINITY;
  for (const row of ordered) {
    const bounds = dixonColesRhoBounds(row.lambdaHome, row.lambdaAway);
    if (bounds.min > min) min = bounds.min;
    if (bounds.max < max) max = bounds.max;
  }
  if (!(min < max)) return fallback;

  const score = (rho: number): number => ordered.reduce((sum, row) => sum + scoreTerm(row, rho), 0);
  if (!(score(min) > 0) || !(score(max) < 0)) return fallback;

  let low = min;
  let high = max;
  for (let iteration = 0; iteration < DIXON_COLES_CONFIG.dixonColes.estimation.bisectionIterations; iteration += 1) {
    const middle = (low + high) / 2;
    if (!Number.isFinite(middle) || middle === low || middle === high) break;
    if (score(middle) > 0) low = middle;
    else high = middle;
  }
  const rho = (low + high) / 2;
  if (!Number.isFinite(rho)) return fallback;
  const tauMin = ordered.reduce((worst, row) => Math.min(worst, dixonColesTauMin(row.lambdaHome, row.lambdaAway, rho)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(tauMin) || tauMin <= 0) return fallback;
  return { rho, convention: DIXON_COLES_CONVENTION, method: "mle-low-score-v1", windowFrom, windowTo, sampleSize: ordered.length, tauMin };
}
