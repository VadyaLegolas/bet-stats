import { describe, expect, it } from "vitest";

import { ForecastOrchestrator, currentForecastConfigHash, type ForecastOrchestratorRepository } from "../../packages/domain/src/evaluation/forecast-orchestrator.js";
import { parseForecastResponse } from "../../packages/domain/src/forecast/contract.js";
import { DIXON_COLES_CONFIG, FORECAST_CONFIG, FORECAST_CONFIGS, FORECAST_CONFIG_VERSION_BY_MODEL, forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { DIXON_COLES_CONVENTION } from "../../packages/domain/src/forecast/dixon-coles.js";
import { createForecast } from "../../packages/domain/src/forecast/model.js";
import { DEFAULT_FORECAST_MODEL_VERSION, MODEL_VERSIONS, isForecastModelVersion } from "../../packages/domain/src/forecast/model-version.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(side: "home" | "away"): EvidenceProjectionDto {
  const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, sourceUpdatedAt: null, payloadHash: `sha256:${side}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId: side,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE",
    freshness: "FRESH",
    buildId: `build-${side}`,
    publishedAt: cutoff,
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", side === "home" ? 2.1 : 1.2, 5),
      form10: component("form10", side === "home" ? 1.9 : 1.3),
      elo: component("elo", side === "home" ? 1640 : 1420),
      homeStrength: component("homeStrength", 2.3),
      awayStrength: component("awayStrength", 0.9),
      goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
      restDays: component("restDays", side === "home" ? 20 : 1, 1),
      h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
    },
  };
}

const input = {
  fixtureId: "fixture-1",
  forecastSnapshotId: "forecast-1",
  cutoff,
  canonicalIdentityState: "RESOLVED" as const,
  home: projection("home"),
  away: projection("away"),
  lineupAvailable: false,
  sourceReliability: 0.8,
};

const dcProvenance = {
  rho: -0.08,
  convention: DIXON_COLES_CONVENTION,
  method: "mle-low-score-v1" as const,
  windowFrom: "2024-01-01T00:00:00.000Z",
  windowTo: cutoff,
  sampleSize: 400,
  tauMin: 0.908,
};

type AnyForecast = ReturnType<typeof createForecast>;

function responseOf(forecast: AnyForecast, overrides: Record<string, unknown> = {}, receiptOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "snapshot-1",
    fixtureId: forecast.fixtureId,
    kind: "PRE_MATCH",
    officialLineupObservationId: null,
    revision: 1,
    cutoff: forecast.cutoff,
    modelVersion: forecast.modelVersion,
    modelHash: "sha256:model",
    configVersion: forecast.configVersion,
    configHash: forecast.configHash,
    inputHash: forecast.inputHash,
    evidenceFingerprint: "sha256:evidence",
    evidenceBuildIds: forecast.evidenceBuildIds,
    probabilities: forecast.markets,
    confidence: forecast.confidence,
    limitations: forecast.limitations,
    tail: { retainedMass: forecast.retainedMass, tailMass: forecast.tailMass, warning: forecast.tailWarning, normalizationVersion: forecast.normalizationVersion },
    assumptions: forecast.assumptions,
    receipt: { forecastSnapshotId: "snapshot-1", officialLineupObservationId: null, evidenceBuildIds: forecast.evidenceBuildIds, sourceRefs: forecast.sources, expectedGoals: forecast.expectedGoals, adjustments: forecast.adjustments, ...receiptOverrides },
    issuedAt: cutoff,
    ...overrides,
  };
}

function v1Response(overrides: Record<string, unknown> = {}, receiptOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return responseOf(createForecast(input), overrides, receiptOverrides);
}

function dcResponse(overrides: Record<string, unknown> = {}, receiptOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  const forecast = createForecast({ ...input, modelVersion: "dixon-coles-ensemble-v1", dixonColes: { rho: dcProvenance.rho, provenance: dcProvenance } });
  return responseOf(forecast, overrides, { dixonColes: dcProvenance, ...receiptOverrides });
}

describe("forecast model version union", () => {
  it("declares exactly the two accepted versions and defaults to dixon-coles", () => {
    expect(MODEL_VERSIONS).toEqual(["poisson-ensemble-v1", "dixon-coles-ensemble-v1"]);
    expect(DEFAULT_FORECAST_MODEL_VERSION).toBe("dixon-coles-ensemble-v1");
    expect(isForecastModelVersion(DEFAULT_FORECAST_MODEL_VERSION)).toBe(true);
  });

  it.each(["poisson-ensemble-v1", "dixon-coles-ensemble-v1"])("accepts %s", (version) => {
    expect(isForecastModelVersion(version)).toBe(true);
  });

  it.each(["", "poisson-ensemble-v2", "dixon-coles-ensemble-v2", "Poisson-Ensemble-V1", null, 42, undefined, {}])("rejects unknown version %s fail-closed", (value) => {
    expect(isForecastModelVersion(value)).toBe(false);
  });
});

describe("per-version config identity", () => {
  it("maps each model version to its own config version", () => {
    expect(FORECAST_CONFIG_VERSION_BY_MODEL["poisson-ensemble-v1"]).toBe("forecast-config-v1");
    expect(FORECAST_CONFIG_VERSION_BY_MODEL["dixon-coles-ensemble-v1"]).toBe("forecast-config-v2");
  });

  it("keeps the frozen v1 config object as the v1 entry and exposes dixon-coles separately", () => {
    expect(FORECAST_CONFIGS["poisson-ensemble-v1"]).toBe(FORECAST_CONFIG);
    expect(FORECAST_CONFIGS["dixon-coles-ensemble-v1"]).toBe(DIXON_COLES_CONFIG);
    expect(FORECAST_CONFIG.version).toBe("forecast-config-v1");
    expect(DIXON_COLES_CONFIG.version).toBe("forecast-config-v2");
    expect(DIXON_COLES_CONFIG.baselineGoals).toEqual(FORECAST_CONFIG.baselineGoals);
  });

  it("publishes the historical v1 hash through the per-version selector", () => {
    const v1Hash = forecastConfigHashFor("poisson-ensemble-v1");
    const dcHash = forecastConfigHashFor("dixon-coles-ensemble-v1");
    expect(v1Hash).toBe(currentForecastConfigHash());
    expect(v1Hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dcHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dcHash).not.toBe(v1Hash);
  });
});

describe("createForecast model identity", () => {
  it("defaults to poisson-ensemble-v1 with forecast-config-v1 when no version is given", () => {
    const forecast = createForecast(input);
    expect(forecast.modelVersion).toBe("poisson-ensemble-v1");
    expect(forecast.configVersion).toBe("forecast-config-v1");
    expect(forecast.configHash).toBe(forecastConfigHashFor("poisson-ensemble-v1"));
  });

  it("rejects the dixon-coles version without explicit rho parameters", () => {
    expect(() => createForecast({ ...input, modelVersion: "dixon-coles-ensemble-v1" })).toThrow("DIXON_COLES_RHO_REQUIRED");
  });
});

describe("forecast response contract across versions", () => {
  it("accepts a legacy v1 response without a dixonColes block", () => {
    expect(parseForecastResponse(v1Response()).modelVersion).toBe("poisson-ensemble-v1");
  });

  it("rejects a dixon-coles response carrying the v1 config version", () => {
    expect(() => parseForecastResponse(v1Response({ modelVersion: "dixon-coles-ensemble-v1", configVersion: "forecast-config-v1" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });

  it("rejects a v1 response carrying the dixon-coles config version", () => {
    expect(() => parseForecastResponse(v1Response({ configVersion: "forecast-config-v2" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });

  it("rejects an unknown model version", () => {
    expect(() => parseForecastResponse(v1Response({ modelVersion: "poisson-ensemble-v2" }))).toThrow("INVALID_FORECAST_RESPONSE");
  });

  it("accepts a dixon-coles response with its provenance block", () => {
    const parsed = parseForecastResponse(dcResponse());
    expect(parsed.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(parsed.configVersion).toBe("forecast-config-v2");
    expect(parsed.receipt.dixonColes).toEqual(dcProvenance);
  });

  it("rejects a dixon-coles response without the provenance block", () => {
    const receipt = dcResponse().receipt as Record<string, unknown>;
    const { dixonColes: _omitted, ...rest } = receipt;
    expect(() => parseForecastResponse({ ...dcResponse(), receipt: rest })).toThrow("INVALID_FORECAST_RECEIPT");
  });

  it("rejects a v1 response that carries the provenance block", () => {
    expect(() => parseForecastResponse(v1Response({}, { dixonColes: dcProvenance }))).toThrow("UNKNOWN_FORECAST_RECEIPT_KEY");
  });

  it.each([
    [{ ...dcProvenance, rho: 1 }],
    [{ ...dcProvenance, rho: -1 }],
    [{ ...dcProvenance, convention: "tau-other" }],
    [{ ...dcProvenance, method: "guess" }],
    [{ ...dcProvenance, windowFrom: "2024-01-01T00:00:00Z" }],
    [{ ...dcProvenance, windowTo: "2023-06-01T00:00:00.000Z" }],
    [{ ...dcProvenance, sampleSize: -1 }],
    [{ ...dcProvenance, sampleSize: 1.5 }],
    [{ ...dcProvenance, tauMin: 0 }],
    [{ ...dcProvenance, rho: Number.NaN }],
  ])("rejects an invalid provenance block %o", (block) => {
    expect(() => parseForecastResponse(dcResponse({}, { dixonColes: block }))).toThrow("INVALID_FORECAST_RECEIPT");
  });

  it("rejects an unknown key inside the provenance block", () => {
    expect(() => parseForecastResponse(dcResponse({}, { dixonColes: { ...dcProvenance, secret: "x" } }))).toThrow("INVALID_FORECAST_RECEIPT");
  });
});

function repositoryOf(options: { readonly rho?: number; readonly withHook?: boolean } = {}) {
  const calls = { rho: 0, publish: 0 };
  const repository: ForecastOrchestratorRepository = {
    assertEligible: async () => undefined,
    findFixture: async (fixtureId) => ({ id: fixtureId, homeTeamId: "home", awayTeamId: "away", leagueId: "league-1", kickoffUtc: "2026-09-14T12:00:00.000Z", canonicalIdentityResolved: true }),
    findEvidence: async (teamId) => projection(teamId === "away" ? "away" : "home"),
    findOfficialLineup: async () => null,
    publish: async (draft) => { calls.publish += 1; return parseForecastResponse(draft); },
  };
  if (options.withHook) {
    repository.findDixonColesParameters = async () => {
      calls.rho += 1;
      const rho = options.rho ?? dcProvenance.rho;
      return { rho, provenance: { ...dcProvenance, rho } };
    };
  }
  return { repository, calls };
}

const orchestratorInput = {
  fixtureId: "fixture-1",
  asOf: cutoff,
  kind: "PRE_MATCH" as const,
  initiator: { type: "production" as const, correlationId: "correlation-1" },
};

describe("forecast orchestrator across model versions", () => {
  it("runs v1 with the frozen config hash and never touches the dixon-coles resolver", async () => {
    const { repository, calls } = repositoryOf({ withHook: true });
    const published = await new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") }, repository);
    expect(published.modelVersion).toBe("poisson-ensemble-v1");
    expect(published.configVersion).toBe("forecast-config-v1");
    expect(published.receipt.dixonColes).toBeUndefined();
    expect(calls.rho).toBe(0);
  });

  it("rejects a dixon-coles run carrying the v1 config hash", async () => {
    const { repository } = repositoryOf();
    await expect(new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") }, repository)).rejects.toThrow("CONFIG_HASH_MISMATCH");
  });

  it("fails closed when dixon-coles has neither explicit rho nor a repository resolver", async () => {
    const { repository } = repositoryOf();
    await expect(new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") }, repository)).rejects.toThrow("DIXON_COLES_RHO_UNAVAILABLE");
  });

  it("publishes a dixon-coles snapshot with an independent model hash and the given provenance", async () => {
    const { repository } = repositoryOf();
    const published = await new ForecastOrchestrator().run(
      { ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1"), dixonColes: { rho: dcProvenance.rho, provenance: dcProvenance } },
      repository,
    );
    const v1 = await new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") }, repositoryOf().repository);
    expect(published.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(published.configVersion).toBe("forecast-config-v2");
    expect(published.receipt.dixonColes).toEqual(dcProvenance);
    expect(published.modelHash).not.toBe(v1.modelHash);
    expect(published.inputHash).not.toBe(v1.inputHash);
  });

  it("resolves rho from the repository when no explicit parameters are given", async () => {
    const { repository, calls } = repositoryOf({ withHook: true, rho: -0.11 });
    const published = await new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") }, repository);
    expect(calls.rho).toBe(1);
    expect(published.receipt.dixonColes?.rho).toBe(-0.11);
  });

  it("changes input hash and snapshot id when only rho changes", async () => {
    const run = (rho: number) => new ForecastOrchestrator().run(
      { ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1"), dixonColes: { rho, provenance: { ...dcProvenance, rho } } },
      repositoryOf().repository,
    );
    const first = await run(-0.05);
    const second = await run(-0.12);
    expect(first.inputHash).not.toBe(second.inputHash);
    expect(first.id).not.toBe(second.id);
  });

  it("rejects a resolver whose rho disagrees with its provenance", async () => {
    const { repository } = repositoryOf({ withHook: true });
    repository.findDixonColesParameters = async () => ({ rho: -0.2, provenance: { ...dcProvenance, rho: -0.1 } });
    await expect(new ForecastOrchestrator().run({ ...orchestratorInput, modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") }, repository)).rejects.toThrow("DIXON_COLES_RHO_UNAVAILABLE");
  });
});
