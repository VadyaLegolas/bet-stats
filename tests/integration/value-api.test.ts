import { describe, expect, it } from "vitest";

const forecast = {
  id: "forecast-1", fixtureId: "fixture-1", kind: "PRE_MATCH", revision: 1,
  cutoff: "2026-09-06T12:00:00.000Z", modelVersion: "poisson-ensemble-v1", modelHash: "model",
  configVersion: "forecast-config-v1", configHash: "config", inputHash: "input", evidenceFingerprint: "evidence", evidenceBuildIds: ["away", "home"],
  probabilities: {
    ONE_X_TWO: [{ selection: "HOME", probability: 0.6, fairOdds: "1.6666666666666667" }, { selection: "DRAW", probability: 0.2, fairOdds: "5" }, { selection: "AWAY", probability: 0.2, fairOdds: "5" }],
    OVER_UNDER_2_5: [{ selection: "OVER_2_5", probability: 0.5, fairOdds: "2" }, { selection: "UNDER_2_5", probability: 0.5, fairOdds: "2" }],
    BTTS: [{ selection: "YES", probability: 0.5, fairOdds: "2" }, { selection: "NO", probability: 0.5, fairOdds: "2" }],
  },
  confidence: { version: "confidence-v1", score: 0.8, components: { completeness: 1, lineupAvailability: 0, freshness: 1, sourceReliability: 1, modelStability: 1 } },
  limitations: [], tail: { retainedMass: 0.999, tailMass: 0.001, warning: false, normalizationVersion: "retained-mass-v1" }, assumptions: ["independent Poisson"],
  receipt: { forecastSnapshotId: "forecast-1", evidenceBuildIds: ["away", "home"], sourceRefs: [], expectedGoals: { home: 1.5, away: 1 }, adjustments: { home: { multiplier: 1, components: {} }, away: { multiplier: 1, components: {} } } },
  issuedAt: "2026-09-06T12:00:01.000Z",
};
const odds = {
  fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "Book", capturedAt: forecast.cutoff,
  schemaVersion: "manual-odds-v1", normalizationVersion: "multiplicative-v1", replacementOfOddsSnapshotId: null, submittedAt: forecast.cutoff, overround: "0.01",
  selections: [{ selection: "HOME", decimalOdds: "2", impliedProbability: "0.5", noVigProbability: "0.49" }, { selection: "DRAW", decimalOdds: "3", impliedProbability: "0.333333", noVigProbability: "0.33" }, { selection: "AWAY", decimalOdds: "5.5", impliedProbability: "0.181818", noVigProbability: "0.18" }],
};
const command = { fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", selection: "HOME" };

describe("value API", () => {
  it("rejects client analytics and incompatible explicit pairs before calculation", async () => {
    const { compareValue } = await import("../../apps/api/src/modules/value/value.service.js");
    let inserts = 0;
    const base = { findForecast: async () => forecast, findOdds: async () => odds, findReceipt: async () => null, insertReceipt: async () => { inserts += 1; throw new Error("unexpected"); } };
    await expect(compareValue({ ...command, edge: "1" }, base)).rejects.toMatchObject({ code: "INVALID_VALUE_COMMAND_KEYS" });
    await expect(compareValue(command, { ...base, findOdds: async () => ({ ...odds, fixtureId: "fixture-2" }) })).rejects.toMatchObject({ code: "SNAPSHOT_PAIR_MISMATCH" });
    await expect(compareValue(command, { ...base, findOdds: async () => ({ ...odds, market: "BTTS" }) })).rejects.toMatchObject({ code: "SNAPSHOT_PAIR_MISMATCH" });
    expect(inserts).toBe(0);
  });

  it("persists a server-authoritative tagged receipt and converges repeated pairs", async () => {
    const { compareValue } = await import("../../apps/api/src/modules/value/value.service.js");
    let stored: any = null;
    const repository = { findForecast: async () => forecast, findOdds: async () => odds, findReceipt: async () => stored, insertReceipt: async (receipt: unknown) => { stored = receipt; return receipt; } };
    const first = await compareValue(command, repository);
    const second = await compareValue(command, repository);
    expect(first).toMatchObject({ outcome: "VALUE_CANDIDATE", fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", selection: "HOME", edge: "0.11", expectedValue: "0.2" });
    expect(first.receipt).toMatchObject({ formulas: expect.any(Array), thresholds: expect.any(Object), gates: expect.any(Array), sources: [], assumptions: ["independent Poisson"] });
    expect(second).toBe(first);
  });

  it("exports exact immutable JSON with a fixed receipt-id filename", async () => {
    const { receiptDownload } = await import("../../apps/api/src/modules/value/value.service.js");
    const stored = { id: "receipt-123", ...command, outcome: "NO_VALUE", receipt: { safe: true } };
    const download = await receiptDownload("receipt-123", { findReceiptById: async () => stored });
    expect(download.filename).toBe("value-receipt-receipt-123.json");
    expect(download.contentType).toBe("application/json; charset=utf-8");
    expect(JSON.parse(download.body)).toEqual(stored);
  });
});
