import { describe, expect, it } from "vitest";

import {
  SCORE_FORMULA_HASH,
  SCORE_FORMULA_VERSION,
  scoreCategoricalForecast,
} from "../../packages/domain/src/index.js";

const source = {
  settlementReceiptId: "settlement-1",
  forecastSnapshotId: "forecast-1",
  market: "ONE_X_TWO" as const,
  outcome: "HOME",
};

describe("categorical scoring", () => {
  it.each([
    ["perfect", [1, 0, 0], 0, 0],
    ["uniform", [1 / 3, 1 / 3, 1 / 3], 2 / 3, Math.log(3)],
    ["confidently wrong", [0, 0, 1], 2, -Math.log(1e-15)],
  ] as const)("scores the %s 1X2 golden vector", (_name, vector, brier, logLoss) => {
    const fact = scoreCategoricalForecast({
      ...source,
      probabilities: vector.map((probability, index) => ({
        selection: ["HOME", "DRAW", "AWAY"][index]!,
        probability,
      })),
    });

    expect(fact.brierScore).toBeCloseTo(brier, 14);
    expect(fact.logLoss).toBeCloseTo(logLoss, 14);
    expect(fact.rawChosenProbability).toBe(vector[0]);
    expect(fact.clippedChosenProbability).toBe(Math.max(vector[0], 1e-15));
    expect(fact).toMatchObject({
      classOrder: ["HOME", "DRAW", "AWAY"],
      formulaVersion: SCORE_FORMULA_VERSION,
      formulaHash: SCORE_FORMULA_HASH,
      settlementReceiptId: source.settlementReceiptId,
      forecastSnapshotId: source.forecastSnapshotId,
      market: source.market,
      outcome: source.outcome,
      eventCount: 1,
    });
    expect(fact.formulaHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    ["OVER_UNDER_2_5", ["OVER_2_5", "UNDER_2_5"], "UNDER_2_5"],
    ["BTTS", ["YES", "NO"], "YES"],
  ] as const)("locks class order for %s", (market, classOrder, outcome) => {
    const fact = scoreCategoricalForecast({
      ...source,
      market,
      outcome,
      probabilities: classOrder.map((selection) => ({ selection, probability: 0.5 })),
    });
    expect(fact.classOrder).toEqual(classOrder);
  });

  it.each([
    ["non-finite", [{ selection: "HOME", probability: Number.NaN }, { selection: "DRAW", probability: 0 }, { selection: "AWAY", probability: 1 }]],
    ["incomplete", [{ selection: "HOME", probability: 0.5 }, { selection: "DRAW", probability: 0.5 }]],
    ["misordered", [{ selection: "DRAW", probability: 0.3 }, { selection: "HOME", probability: 0.4 }, { selection: "AWAY", probability: 0.3 }]],
    ["non-normalized", [{ selection: "HOME", probability: 0.4 }, { selection: "DRAW", probability: 0.4 }, { selection: "AWAY", probability: 0.4 }]],
  ])("rejects a %s vector", (_name, probabilities) => {
    expect(() => scoreCategoricalForecast({ ...source, probabilities })).toThrow("INVALID_SCORE_VECTOR");
  });

  it("rejects an outcome outside the market class order", () => {
    expect(() => scoreCategoricalForecast({
      ...source,
      outcome: "YES",
      probabilities: [
        { selection: "HOME", probability: 0.4 },
        { selection: "DRAW", probability: 0.3 },
        { selection: "AWAY", probability: 0.3 },
      ],
    })).toThrow("INVALID_SCORE_OUTCOME");
  });
});
