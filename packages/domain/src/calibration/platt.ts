import { CALIBRATION_CONFIG } from "./config.js";
import { calibrationError } from "./errors.js";

export interface PlattPoint {
  /** Raw probability of the positive class. */
  readonly probability: number;
  readonly label: 0 | 1;
}

/** Scaler `sigma(slope * logit(p) + intercept)`; `iterations`/`converged` describe the fit. */
export interface PlattParameters {
  readonly slope: number;
  readonly intercept: number;
  readonly iterations: number;
  readonly converged: boolean;
}

export interface PlattFitOptions {
  readonly epsilon: number;
  readonly maxIterations: number;
  readonly gradientTolerance: number;
  readonly stepTolerance: number;
  readonly priorStrength: number;
  readonly maxBacktracks: number;
}

export const DEFAULT_PLATT_FIT_OPTIONS: PlattFitOptions = Object.freeze({
  epsilon: CALIBRATION_CONFIG.probabilityClipEpsilon,
  maxIterations: CALIBRATION_CONFIG.platt.maxIterations,
  gradientTolerance: CALIBRATION_CONFIG.platt.gradientTolerance,
  stepTolerance: CALIBRATION_CONFIG.platt.stepTolerance,
  priorStrength: CALIBRATION_CONFIG.platt.priorStrength,
  maxBacktracks: CALIBRATION_CONFIG.platt.maxBacktracks,
});

export function clipProbability(probability: number, epsilon: number): number {
  return Math.min(1 - epsilon, Math.max(epsilon, probability));
}

export function logitOf(probability: number, epsilon: number): number {
  const clipped = clipProbability(probability, epsilon);
  return Math.log(clipped / (1 - clipped));
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** log(1 + exp(z)) without overflow. */
function softplus(z: number): number {
  return z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

/**
 * Fit a Platt scaler by Newton steps with backtracking.
 *
 * Objective: negative log-likelihood + (priorStrength / 2) * ((slope - 1)^2 + intercept^2).
 * The prior keeps the Hessian positive definite, so separable or single-label data still
 * yield a finite solution; iterations are capped. Pure and deterministic.
 */
export function fitPlatt(points: readonly PlattPoint[], options: PlattFitOptions = DEFAULT_PLATT_FIT_OPTIONS): PlattParameters {
  if (points.length === 0) throw calibrationError("CALIBRATION_FIT_FAILED", "empty sample");
  const logits = new Array<number>(points.length);
  const labels = new Array<number>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    if (
      typeof point.probability !== "number" || !Number.isFinite(point.probability) ||
      point.probability < 0 || point.probability > 1 || (point.label !== 0 && point.label !== 1)
    ) throw calibrationError("CALIBRATION_FIT_FAILED", "invalid Platt point");
    logits[index] = logitOf(point.probability, options.epsilon);
    labels[index] = point.label;
  }

  const lambda = options.priorStrength;
  const loss = (slope: number, intercept: number): number => {
    let total = 0;
    for (let index = 0; index < logits.length; index += 1) {
      const z = slope * logits[index]! + intercept;
      total += softplus(z) - labels[index]! * z;
    }
    return total + 0.5 * lambda * ((slope - 1) ** 2 + intercept ** 2);
  };

  let slope = 1;
  let intercept = 0;
  let current = loss(slope, intercept);
  let iterations = 0;
  let converged = false;

  while (iterations < options.maxIterations) {
    let gradSlope = lambda * (slope - 1);
    let gradIntercept = lambda * intercept;
    let hessSlopeSlope = lambda;
    let hessSlopeIntercept = 0;
    let hessInterceptIntercept = lambda;
    for (let index = 0; index < logits.length; index += 1) {
      const x = logits[index]!;
      const p = sigmoid(slope * x + intercept);
      const residual = p - labels[index]!;
      const weight = p * (1 - p);
      gradSlope += residual * x;
      gradIntercept += residual;
      hessSlopeSlope += weight * x * x;
      hessSlopeIntercept += weight * x;
      hessInterceptIntercept += weight;
    }
    if (![gradSlope, gradIntercept, hessSlopeSlope, hessSlopeIntercept, hessInterceptIntercept].every(Number.isFinite)) {
      throw calibrationError("CALIBRATION_FIT_FAILED", "non-finite gradient");
    }
    if (Math.max(Math.abs(gradSlope), Math.abs(gradIntercept)) <= options.gradientTolerance) {
      converged = true;
      break;
    }

    const determinant = hessSlopeSlope * hessInterceptIntercept - hessSlopeIntercept ** 2;
    let stepSlope: number;
    let stepIntercept: number;
    if (determinant > 0 && Number.isFinite(determinant)) {
      stepSlope = -(hessInterceptIntercept * gradSlope - hessSlopeIntercept * gradIntercept) / determinant;
      stepIntercept = -(-hessSlopeIntercept * gradSlope + hessSlopeSlope * gradIntercept) / determinant;
    } else {
      const scale = 1 / (hessSlopeSlope + hessInterceptIntercept);
      stepSlope = -gradSlope * scale;
      stepIntercept = -gradIntercept * scale;
    }
    const directional = gradSlope * stepSlope + gradIntercept * stepIntercept;

    let factor = 1;
    let accepted = false;
    let nextSlope = slope;
    let nextIntercept = intercept;
    let nextLoss = current;
    for (let attempt = 0; attempt <= options.maxBacktracks; attempt += 1) {
      nextSlope = slope + factor * stepSlope;
      nextIntercept = intercept + factor * stepIntercept;
      nextLoss = loss(nextSlope, nextIntercept);
      // Armijo condition with a rounding allowance: near the optimum the loss difference is below float noise.
      if (Number.isFinite(nextLoss) && nextLoss <= current + 1e-4 * factor * directional + 1e-12 * (1 + Math.abs(current))) {
        accepted = true;
        break;
      }
      factor /= 2;
    }
    iterations += 1;
    if (!accepted) break;

    const movement = Math.max(Math.abs(nextSlope - slope), Math.abs(nextIntercept - intercept));
    slope = nextSlope;
    intercept = nextIntercept;
    current = nextLoss;
    if (movement <= options.stepTolerance) {
      converged = true;
      break;
    }
  }

  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
    throw calibrationError("CALIBRATION_FIT_FAILED", "non-finite parameters");
  }
  return { slope, intercept, iterations, converged };
}

/** Apply a scaler; input and output are clipped to [epsilon, 1 - epsilon]. */
export function applyPlatt(
  parameters: Pick<PlattParameters, "slope" | "intercept">,
  probability: number,
  epsilon: number = CALIBRATION_CONFIG.probabilityClipEpsilon,
): number {
  const z = parameters.slope * logitOf(probability, epsilon) + parameters.intercept;
  if (!Number.isFinite(z)) throw calibrationError("INVALID_CALIBRATION_INPUT", "non-finite Platt input");
  return clipProbability(sigmoid(z), epsilon);
}
