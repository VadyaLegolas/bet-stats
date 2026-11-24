import { CALIBRATION_CONFIG } from "./config.js";
import { calibrationError } from "./errors.js";
import { clipProbability } from "./platt.js";

export interface IsotonicPoint {
  /** Raw probability of the positive class. */
  readonly probability: number;
  readonly label: 0 | 1;
}

/** One pooled block: `x` is the mean raw probability of the block, `value` its mean label. */
export interface IsotonicNode {
  readonly x: number;
  readonly value: number;
}

/** Non-decreasing piecewise-linear map through the block centers. */
export interface IsotonicModel {
  readonly nodes: readonly IsotonicNode[];
}

interface Block {
  weight: number;
  sumX: number;
  sumY: number;
}

/**
 * Isotonic regression by pool-adjacent-violators with equal weights. Points with the same
 * raw probability start in one block, so node abscissae are strictly increasing; node values
 * are non-decreasing and clipped to [epsilon, 1 - epsilon]. Pure and deterministic.
 */
export function fitIsotonic(points: readonly IsotonicPoint[], epsilon: number = CALIBRATION_CONFIG.probabilityClipEpsilon): IsotonicModel {
  if (points.length === 0) throw calibrationError("CALIBRATION_FIT_FAILED", "empty sample");
  const ordered = points.map((point) => {
    if (
      typeof point.probability !== "number" || !Number.isFinite(point.probability) ||
      point.probability < 0 || point.probability > 1 || (point.label !== 0 && point.label !== 1)
    ) throw calibrationError("CALIBRATION_FIT_FAILED", "invalid isotonic point");
    return { x: clipProbability(point.probability, epsilon), y: point.label as number };
  }).sort((left, right) => left.x - right.x || left.y - right.y);

  const blocks: Block[] = [];
  for (let index = 0; index < ordered.length; ) {
    let end = index;
    const block: Block = { weight: 0, sumX: 0, sumY: 0 };
    while (end < ordered.length && ordered[end]!.x === ordered[index]!.x) {
      block.weight += 1;
      block.sumX += ordered[end]!.x;
      block.sumY += ordered[end]!.y;
      end += 1;
    }
    index = end;
    blocks.push(block);
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const previous = blocks[blocks.length - 2]!;
      if (previous.sumY / previous.weight <= last.sumY / last.weight) break;
      blocks.splice(blocks.length - 2, 2, {
        weight: previous.weight + last.weight,
        sumX: previous.sumX + last.sumX,
        sumY: previous.sumY + last.sumY,
      });
    }
  }

  const nodes = blocks.map((block) => ({
    x: block.sumX / block.weight,
    value: clipProbability(block.sumY / block.weight, epsilon),
  }));
  for (const node of nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.value)) throw calibrationError("CALIBRATION_FIT_FAILED", "non-finite isotonic node");
  }
  return { nodes };
}

/** Piecewise-linear between block centers; outside the range the edge block value; non-decreasing. */
export function applyIsotonic(
  model: IsotonicModel,
  probability: number,
  epsilon: number = CALIBRATION_CONFIG.probabilityClipEpsilon,
): number {
  if (typeof probability !== "number" || !Number.isFinite(probability)) {
    throw calibrationError("INVALID_CALIBRATION_INPUT", "non-finite isotonic input");
  }
  const { nodes } = model;
  const x = clipProbability(probability, epsilon);
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (x <= first.x) return clipProbability(first.value, epsilon);
  if (x >= last.x) return clipProbability(last.value, epsilon);

  let low = 0;
  let high = nodes.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (nodes[middle]!.x <= x) low = middle;
    else high = middle;
  }
  const left = nodes[low]!;
  const right = nodes[high]!;
  const fraction = (x - left.x) / (right.x - left.x);
  // The clamp keeps the output inside the segment values despite float rounding, so monotonicity is exact.
  const interpolated = Math.min(right.value, Math.max(left.value, left.value + fraction * (right.value - left.value)));
  return clipProbability(interpolated, epsilon);
}
