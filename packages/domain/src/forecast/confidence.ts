export interface ConfidenceComponents {
  readonly completeness: number;
  readonly lineupAvailability: number;
  readonly freshness: number;
  readonly sourceReliability: number;
  readonly modelStability: number;
}

const WEIGHTS: Readonly<ConfidenceComponents> = { completeness: 0.3, lineupAvailability: 0.1, freshness: 0.25, sourceReliability: 0.2, modelStability: 0.15 };

export function calculateConfidence(components: ConfidenceComponents) {
  for (const value of Object.values(components)) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("INVALID_CONFIDENCE_COMPONENT");
  const score = (Object.keys(WEIGHTS) as Array<keyof ConfidenceComponents>).reduce((sum, key) => sum + components[key] * WEIGHTS[key], 0);
  return { version: "confidence-v1" as const, score, components };
}
