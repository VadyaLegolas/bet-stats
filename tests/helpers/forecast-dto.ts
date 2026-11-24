import type { CalibratorIdentity } from "../../packages/domain/src/calibration/calibrator.js";
import type { ForecastResponseDto } from "../../packages/domain/src/forecast/contract.js";
import { DIXON_COLES_CONVENTION } from "../../packages/domain/src/forecast/dixon-coles.js";

/**
 * A valid, complete `ForecastResponseDto` (strict receipt parser) for the given pinned identity. For the Dixon-Coles
 * identity the receipt carries the required `dixonColes` block and `configVersion` is `forecast-config-v2`.
 */
export function makeForecastDto(identity: CalibratorIdentity, overrides: Partial<ForecastResponseDto> = {}): ForecastResponseDto {
  const dixonColes = identity.modelVersion === "dixon-coles-ensemble-v1"
    ? { dixonColes: { rho: -0.05, convention: DIXON_COLES_CONVENTION, method: "insufficient-sample-zero", windowFrom: "2026-01-01T00:00:00.000Z", windowTo: "2026-11-01T00:00:00.000Z", sampleSize: 0, tauMin: 1 } }
    : {};
  const id = overrides.id ?? `forecast-${identity.modelVersion}`;
  const lineupId = overrides.officialLineupObservationId ?? null;
  return {
    id,
    fixtureId: "fixture-1",
    kind: "PRE_MATCH",
    officialLineupObservationId: lineupId,
    revision: 1,
    cutoff: "2026-12-01T12:00:00.000Z",
    modelVersion: identity.modelVersion,
    modelHash: `sha256:model-${id}`,
    configVersion: identity.modelVersion === "dixon-coles-ensemble-v1" ? "forecast-config-v2" : "forecast-config-v1",
    configHash: identity.configHash,
    inputHash: `sha256:input-${id}`,
    evidenceFingerprint: `sha256:evidence-${id}`,
    evidenceBuildIds: ["away-build", "home-build"],
    probabilities: {
      ONE_X_TWO: [{ selection: "HOME", probability: 0.5, fairOdds: "2" }, { selection: "DRAW", probability: 0.25, fairOdds: "4" }, { selection: "AWAY", probability: 0.25, fairOdds: "4" }],
      OVER_UNDER_2_5: [{ selection: "OVER_2_5", probability: 0.4, fairOdds: "2.5" }, { selection: "UNDER_2_5", probability: 0.6, fairOdds: "1.6666666666666667" }],
      BTTS: [{ selection: "YES", probability: 0.45, fairOdds: "2.2222222222222222" }, { selection: "NO", probability: 0.55, fairOdds: "1.8181818181818182" }],
    },
    confidence: { version: "confidence-v1", score: 0.8, components: { completeness: 1, lineupAvailability: 0, freshness: 1, sourceReliability: 1, modelStability: 1 } },
    limitations: ["LINEUP_NOT_CONFIRMED"],
    tail: { retainedMass: 0.999, tailMass: 0.001, warning: false, normalizationVersion: "retained-mass-v1" },
    assumptions: ["independent Poisson goal counts"],
    receipt: { forecastSnapshotId: id, officialLineupObservationId: lineupId, evidenceBuildIds: ["away-build", "home-build"], sourceRefs: [], expectedGoals: { home: 1.4, away: 1.1 }, adjustments: { home: { multiplier: 1, components: {} }, away: { multiplier: 1, components: {} } }, ...dixonColes },
    issuedAt: "2026-11-24T09:00:00.000Z",
    ...overrides,
  } as unknown as ForecastResponseDto;
}
