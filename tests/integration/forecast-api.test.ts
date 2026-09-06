import { describe, expect, it } from "vitest";

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
