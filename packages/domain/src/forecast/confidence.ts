export interface ConfidenceComponents {
  readonly completeness: number;
  readonly lineupAvailability: number;
  readonly freshness: number;
  readonly sourceReliability: number;
  readonly modelStability: number;
}

export const CONFIDENCE_CONFIG = Object.freeze({
  version: "confidence-v1" as const,
  weights: Object.freeze<ConfidenceComponents>({ completeness: 0.3, lineupAvailability: 0.1, freshness: 0.25, sourceReliability: 0.2, modelStability: 0.15 }),
});

export function calculateConfidence(components: ConfidenceComponents) {
  for (const value of Object.values(components)) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("INVALID_CONFIDENCE_COMPONENT");
  const score = (Object.keys(CONFIDENCE_CONFIG.weights) as Array<keyof ConfidenceComponents>).reduce((sum, key) => sum + components[key] * CONFIDENCE_CONFIG.weights[key], 0);
  return { version: CONFIDENCE_CONFIG.version, score, components };
}
