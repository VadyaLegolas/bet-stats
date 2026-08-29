import { z } from "zod";

export const DEFAULT_FRESHNESS_THRESHOLDS_MS = Object.freeze({
  fixture: 30 * 60 * 1_000,
  fixtureStatus: 15 * 60 * 1_000,
  result: 6 * 60 * 60 * 1_000,
  lineup: 60 * 60 * 1_000,
});

export type FreshnessDataType = keyof typeof DEFAULT_FRESHNESS_THRESHOLDS_MS;
export type FreshnessThresholds = Readonly<Record<FreshnessDataType, number>>;

const thresholdSchema = z.number().int().positive().finite();
const freshnessThresholdsSchema = z.object({
  fixture: thresholdSchema,
  fixtureStatus: thresholdSchema,
  result: thresholdSchema,
  lineup: thresholdSchema,
});

export class FreshnessConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid freshness configuration: ${issues.join("; ")}`);
    this.name = "FreshnessConfigValidationError";
    this.issues = issues;
  }
}

export function readFreshnessThresholds(
  overrides: Partial<Record<FreshnessDataType, number>> = {},
): FreshnessThresholds {
  const result = freshnessThresholdsSchema.safeParse({
    ...DEFAULT_FRESHNESS_THRESHOLDS_MS,
    ...overrides,
  });

  if (!result.success) {
    throw new FreshnessConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return Object.freeze(result.data);
}
