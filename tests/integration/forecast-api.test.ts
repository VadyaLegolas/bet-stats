import { describe, expect, it, vi } from "vitest";

async function contract() {
  return import("../../packages/domain/src/forecast/contract.js");
}

const validRequest = {
  fixtureId: "fixture-1",
  kind: "PRE_MATCH",
  cutoff: "2026-09-06T12:00:00.000Z",
};

const validResponse = {
  id: "forecast-1",
  fixtureId: "fixture-1",
  kind: "PRE_MATCH",
  officialLineupObservationId: null,
  revision: 1,
  cutoff: "2026-09-06T12:00:00.000Z",
  modelVersion: "poisson-ensemble-v1",
  modelHash: "sha256:model",
  configVersion: "forecast-config-v1",
  configHash: "sha256:config",
  inputHash: "sha256:input",
  evidenceFingerprint: "sha256:evidence",
  evidenceBuildIds: ["away-build", "home-build"],
  probabilities: {
    ONE_X_TWO: [
      { selection: "HOME", probability: 0.5, fairOdds: "2" },
      { selection: "DRAW", probability: 0.25, fairOdds: "4" },
      { selection: "AWAY", probability: 0.25, fairOdds: "4" },
    ],
    OVER_UNDER_2_5: [
      { selection: "OVER_2_5", probability: 0.4, fairOdds: "2.5" },
      { selection: "UNDER_2_5", probability: 0.6, fairOdds: "1.6666666666666667" },
    ],
    BTTS: [
      { selection: "YES", probability: 0.45, fairOdds: "2.2222222222222222" },
      { selection: "NO", probability: 0.55, fairOdds: "1.8181818181818182" },
    ],
  },
  confidence: {
    version: "confidence-v1",
    score: 0.8,
    components: { completeness: 1, lineupAvailability: 0, freshness: 1, sourceReliability: 1, modelStability: 1 },
  },
  limitations: ["LINEUP_NOT_CONFIRMED"],
  tail: { retainedMass: 0.999, tailMass: 0.001, warning: false, normalizationVersion: "retained-mass-v1" },
  assumptions: ["independent Poisson goal counts"],
  receipt: {
    forecastSnapshotId: "forecast-1",
    officialLineupObservationId: null,
    evidenceBuildIds: ["away-build", "home-build"],
    sourceRefs: [],
    expectedGoals: { home: 1.4, away: 1.1 },
    adjustments: {
      home: { multiplier: 1, components: {} },
      away: { multiplier: 1, components: {} },
    },
  },
  issuedAt: "2026-09-06T12:00:01.000Z",
};

describe("forecast transport contract", () => {
  it("accepts only explicit fixture, kind, and canonical UTC cutoff requests", async () => {
    const { parseForecastRequest } = await contract();
    expect(parseForecastRequest(validRequest)).toEqual(validRequest);
    expect(() => parseForecastRequest({ ...validRequest, latest: true })).toThrowError("UNKNOWN_FORECAST_REQUEST_KEY");
    expect(() => parseForecastRequest({ ...validRequest, kind: "LATEST" })).toThrowError("INVALID_FORECAST_KIND");
    expect(() => parseForecastRequest({ ...validRequest, cutoff: "2026-09-06T14:00:00+02:00" })).toThrowError("INVALID_FORECAST_CUTOFF");
  });

  it("preserves immutable identity, probability, confidence, limitation, tail, and receipt boundaries", async () => {
    const { parseForecastResponse } = await contract();
    expect(parseForecastResponse(validResponse)).toEqual(validResponse);
    expect(() => parseForecastResponse({ ...validResponse, mutable: true })).toThrowError("UNKNOWN_FORECAST_RESPONSE_KEY");
    expect(() => parseForecastResponse({ ...validResponse, probabilities: { ...validResponse.probabilities, BTTS: [{ selection: "YES", probability: 1.2, fairOdds: "1" }] } })).toThrowError("INVALID_FORECAST_PROBABILITY");
    expect(() => parseForecastResponse({ ...validResponse, confidence: { ...validResponse.confidence, score: Number.NaN } })).toThrowError("INVALID_FORECAST_CONFIDENCE");
  });
});

const source = { fixtureId: "history-1", effectiveAt: "2026-09-01T12:00:00.000Z", observedAt: "2026-09-01T12:05:00.000Z", sourceUpdatedAt: null, payloadHash: "hash", payloadBytes: 10 };
const projection = (teamId: string, buildId: string, cutoff = validRequest.cutoff) => ({
  teamId,
  requestedAsOf: cutoff,
  resolvedAsOfUtc: cutoff,
  cutoffBoundary: { observedAt: cutoff },
  state: "COMPLETE" as const,
  freshness: "FRESH" as const,
  buildId,
  publishedAt: cutoff,
  receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
  coverage: { eligibleFixtureCount: 5, earliestKickoff: source.effectiveAt, latestKickoff: source.effectiveAt },
  components: {
    goalRates: { kind: "goalRates" as const, value: { for: 1.6, against: 1.1 }, unit: "goals-per-match", sampleSize: 5, limitation: null, sourceRefs: [source] },
    elo: { kind: "elo" as const, value: 1510, unit: "elo-rating", sampleSize: 5, limitation: null, sourceRefs: [source] },
    form5: { kind: "form5" as const, value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [source] },
    homeStrength: { kind: "homeStrength" as const, value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [source] },
    awayStrength: { kind: "awayStrength" as const, value: 1.2, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [source] },
    restDays: { kind: "restDays" as const, value: 7, unit: "days", sampleSize: 1, limitation: null, sourceRefs: [source] },
  },
});

describe("forecast API orchestration", () => {
  it("discovers only issued snapshots for one fixture in deterministic newest-first order", async () => {
    const { createPrismaForecastRepository } = await import("../../apps/api/src/modules/forecasts/forecasts.service.js");
    const findMany = vi.fn().mockResolvedValue([
      { receipt: { ...validResponse, id: "lineup-2", kind: "LINEUP_CONFIRMED", officialLineupObservationId: "lineup-observation-1", revision: 2, cutoff: "2026-09-06T11:17:23.000Z", receipt: { ...validResponse.receipt, forecastSnapshotId: "lineup-2", officialLineupObservationId: "lineup-observation-1" } } },
      { receipt: { ...validResponse, id: "initial-1", kind: "INITIAL", revision: 1, cutoff: "2026-09-05T09:43:11.000Z", receipt: { ...validResponse.receipt, forecastSnapshotId: "initial-1" } } },
    ]);
    const repository = createPrismaForecastRepository({ forecastSnapshot: { findMany } } as never);

    await expect(repository.listIssued?.("fixture-1")).resolves.toMatchObject([
      { id: "lineup-2", kind: "LINEUP_CONFIRMED", revision: 2, cutoff: "2026-09-06T11:17:23.000Z" },
      { id: "initial-1", kind: "INITIAL", revision: 1, cutoff: "2026-09-05T09:43:11.000Z" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { fixtureId: "fixture-1", state: "ISSUED" },
      orderBy: [{ issuedAt: "desc" }, { cutoff: "desc" }, { revision: "desc" }, { id: "asc" }],
    });
  });

  it("keeps list and exact lookup query semantics unambiguous", async () => {
    const { ForecastsController } = await import("../../apps/api/src/modules/forecasts/forecasts.controller.js");
    const service = {
      list: vi.fn().mockResolvedValue([validResponse]),
      get: vi.fn().mockResolvedValue(validResponse),
    };
    const controller = new ForecastsController(service as never);

    await expect(controller.get("fixture-1", {})).resolves.toEqual([validResponse]);
    await expect(controller.get("fixture-1", { kind: "PRE_MATCH", cutoff: validRequest.cutoff })).resolves.toEqual(validResponse);
    expect(() => controller.get("fixture-1", { kind: "PRE_MATCH" })).toThrowError(expect.objectContaining({ response: { code: "INVALID_FORECAST_QUERY" } }));
    expect(() => controller.get("fixture-1", { secret: "drop" })).toThrowError(expect.objectContaining({ response: { code: "INVALID_FORECAST_QUERY" } }));
    expect(service.list).toHaveBeenCalledWith("fixture-1");
    expect(service.get).toHaveBeenCalledWith("fixture-1", "PRE_MATCH", validRequest.cutoff);
  });

  it("fails policy, canonical, cutoff, and evidence gates before calculation or insert", async () => {
    const { generateForecast } = await import("../../apps/api/src/modules/forecasts/forecasts.service.js");
    let inserts = 0;
    const base = {
      findFixture: async () => ({ id: "fixture-1", homeTeamId: "home", awayTeamId: "away", kickoffUtc: "2026-09-07T12:00:00.000Z", canonicalIdentityResolved: true }),
      findEvidence: async (teamId: string) => projection(teamId, `${teamId}-build`),
      findOfficialLineup: async () => null,
      publish: async () => { inserts += 1; return validResponse; },
    };
    await expect(generateForecast(validRequest, { ...base, assertEligible: async () => { throw Object.assign(new Error("POLICY_INELIGIBLE"), { code: "POLICY_INELIGIBLE" }); } })).rejects.toMatchObject({ code: "POLICY_INELIGIBLE" });
    await expect(generateForecast(validRequest, { ...base, assertEligible: async () => undefined, findFixture: async () => ({ ...(await base.findFixture()), canonicalIdentityResolved: false }) })).rejects.toMatchObject({ code: "UNRESOLVED_CANONICAL_IDENTITY" });
    await expect(generateForecast({ ...validRequest, cutoff: "2026-09-08T12:00:00.000Z" }, { ...base, assertEligible: async () => undefined })).rejects.toMatchObject({ code: "POST_KICKOFF_CUTOFF" });
    await expect(generateForecast(validRequest, { ...base, assertEligible: async () => undefined, findEvidence: async () => null })).rejects.toMatchObject({ code: "REQUIRED_EVIDENCE_UNAVAILABLE" });
    expect(inserts).toBe(0);
  });

  it("publishes one complete DTO and lets the atomic repository converge or revise", async () => {
    const { generateForecast } = await import("../../apps/api/src/modules/forecasts/forecasts.service.js");
    const published: unknown[] = [];
    const repository = {
      assertEligible: async () => undefined,
      findFixture: async () => ({ id: "fixture-1", homeTeamId: "home", awayTeamId: "away", kickoffUtc: "2026-09-07T12:00:00.000Z", canonicalIdentityResolved: true }),
      findEvidence: async (teamId: string) => projection(teamId, `${teamId}-build`),
      findOfficialLineup: async () => null,
      publish: async (draft: unknown) => { published.push(draft); return { ...validResponse, ...(draft as object) }; },
    };
    const first = await generateForecast(validRequest, repository);
    const second = await generateForecast(validRequest, repository);
    expect(first).toMatchObject({ fixtureId: "fixture-1", kind: "PRE_MATCH", cutoff: validRequest.cutoff, evidenceBuildIds: ["away-build", "home-build"] });
    expect(second.inputHash).toBe(first.inputHash);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ receipt: { evidenceBuildIds: ["away-build", "home-build"] } });
  });
});
