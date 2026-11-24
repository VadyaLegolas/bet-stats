import { describe, expect, it } from "vitest";

import { applyCalibrator, fitMarketCalibrator, type CalibratorIdentity, type FittedCalibrator } from "../../packages/domain/src/calibration/calibrator.js";
import { CALIBRATION_CONFIG } from "../../packages/domain/src/calibration/config.js";
import {
  CALIBRATION_REASON_CODES,
  CALIBRATION_STATES,
  parseMarketCalibrationMap,
  resolveForecastCalibration,
  resolveMarketCalibration,
  unavailableMarketCalibration,
  type ActiveCalibrator,
  type CalibratedForecastResponseDto,
  type MarketCalibrationView,
} from "../../packages/domain/src/calibration/view.js";
import type { ScoreMarket } from "../../packages/domain/src/evaluation/scoring.js";
import { forecastConfigHashFor } from "../../packages/domain/src/forecast/config.js";
import { parseForecastResponse, type ForecastResponseDto } from "../../packages/domain/src/forecast/contract.js";
import { makeCalibrationSamples } from "../helpers/calibration-samples.js";

const config = CALIBRATION_CONFIG;
const MODEL_VERSION = "dixon-coles-ensemble-v1" as const;
const configHash = forecastConfigHashFor(MODEL_VERSION);
const identity: CalibratorIdentity = { modelVersion: MODEL_VERSION, configHash };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const;

function fitted(market: ScoreMarket, seed: number): FittedCalibrator {
  const result = fitMarketCalibrator({
    identity,
    market,
    samples: makeCalibrationSamples({ market, count: 400, seed, trueSlope: 0.5, trueIntercept: 0.3 }),
    asOf: "2026-12-31T00:00:00.000Z",
    config,
  });
  if (result.state !== "FITTED") throw new Error(`fixture must fit, got ${result.state}`);
  return result.calibrator;
}

const calibrators = {
  ONE_X_TWO: fitted("ONE_X_TWO", 11),
  OVER_UNDER_2_5: fitted("OVER_UNDER_2_5", 12),
  BTTS: fitted("BTTS", 13),
} as const;

function activeOf(market: ScoreMarket, version = 3): ActiveCalibrator {
  return { calibratorId: `cal-${market}`, version, calibrator: calibrators[market] };
}

// Minimal valid forecast receipt in the shape of ForecastResponseDto (poisson variant: no dixonColes block).
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
    adjustments: { home: { multiplier: 1, components: {} }, away: { multiplier: 1, components: {} } },
  },
  issuedAt: "2026-09-06T12:00:01.000Z",
};

function forecastOf(overrides: Record<string, unknown> = {}): ForecastResponseDto {
  return { ...validResponse, modelVersion: MODEL_VERSION, configHash, ...overrides } as unknown as ForecastResponseDto;
}

const rawOf = (forecast: ForecastResponseDto, market: ScoreMarket): number[] => forecast.probabilities[market].map((event) => event.probability);
const sumOf = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe("closed vocabularies (D-11)", () => {
  it("exposes the three states and the closed reason codes", () => {
    expect([...CALIBRATION_STATES]).toEqual(["CALIBRATED", "INSUFFICIENT_DATA", "UNAVAILABLE"]);
    expect([...CALIBRATION_REASON_CODES]).toEqual([
      "INSUFFICIENT_SETTLED_OUTCOMES",
      "NO_PROMOTED_CALIBRATOR",
      "KIND_NOT_COVERED",
      "CALIBRATOR_MODEL_MISMATCH",
      "CALIBRATOR_MARKET_MISMATCH",
      "CALIBRATOR_INVALID",
      "CALIBRATION_READ_FAILED",
    ]);
  });
});

describe("resolveMarketCalibration: CALIBRATED (D-06, D-11)", () => {
  it.each(["PRE_MATCH", "LINEUP_CONFIRMED"] as const)("serves a matching calibrator for a %s forecast", (kind) => {
    const forecast = forecastOf({ kind });
    const view = resolveMarketCalibration({ forecast, market: "BTTS", active: activeOf("BTTS", 3), eligibleSampleSize: 500, config });
    const calibrator = calibrators.BTTS;
    expect(view.rawProbabilities).toEqual(rawOf(forecast, "BTTS"));
    expect(view.calibration.state).toBe("CALIBRATED");
    expect(view.calibration.calibratedProbabilities).toEqual(applyCalibrator(calibrator, identity, "BTTS", rawOf(forecast, "BTTS")));
    expect(Math.abs(sumOf(view.calibration.calibratedProbabilities!) - 1)).toBeLessThan(1e-12);
    expect(view.calibration.calibratorVersion).toBe(3);
    expect(view.calibration.method).toBe(calibrator.method);
    expect(view.calibration.sampleSize).toBe(calibrator.holdoutSampleSize);
    expect(view.calibration.holdoutBrierRaw).toBe(calibrator.holdoutBrierRaw);
    expect(view.calibration.holdoutBrierCalibrated).toBe(calibrator.holdoutBrierCalibrated);
    expect("reasonCode" in view.calibration).toBe(false);
    expect("requiredSample" in view.calibration).toBe(false);
  });

  it("returns three calibrated classes for ONE_X_TWO in class order", () => {
    const forecast = forecastOf();
    const view = resolveMarketCalibration({ forecast, market: "ONE_X_TWO", active: activeOf("ONE_X_TWO"), eligibleSampleSize: 500, config });
    expect(view.calibration.state).toBe("CALIBRATED");
    expect(view.calibration.calibratedProbabilities).toHaveLength(3);
    expect(Math.abs(sumOf(view.calibration.calibratedProbabilities!) - 1)).toBeLessThan(1e-12);
    expect(view.rawProbabilities).toEqual([0.5, 0.25, 0.25]);
  });
});

describe("resolveMarketCalibration: UNAVAILABLE", () => {
  it("does not cover an INITIAL forecast and keeps the raw probabilities", () => {
    const forecast = forecastOf({ kind: "INITIAL" });
    const withActive = resolveMarketCalibration({ forecast, market: "BTTS", active: activeOf("BTTS"), eligibleSampleSize: 500, config });
    const withoutActive = resolveMarketCalibration({ forecast, market: "BTTS", active: null, eligibleSampleSize: 10, config });
    for (const view of [withActive, withoutActive]) {
      expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "KIND_NOT_COVERED" });
      expect(view.rawProbabilities).toEqual([0.45, 0.55]);
    }
  });

  it("never reports CALIBRATED for a calibrator of another model version", () => {
    const forecast = forecastOf({ modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") });
    const view = resolveMarketCalibration({ forecast, market: "BTTS", active: activeOf("BTTS"), eligibleSampleSize: 500, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MODEL_MISMATCH" });
    expect(view.rawProbabilities).toEqual([0.45, 0.55]);
  });

  it("never reports CALIBRATED for a calibrator of another config hash", () => {
    const forecast = forecastOf({ configHash: "sha256:another-config" });
    const view = resolveMarketCalibration({ forecast, market: "BTTS", active: activeOf("BTTS"), eligibleSampleSize: 500, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MODEL_MISMATCH" });
  });

  it("never reports CALIBRATED for a calibrator of another market", () => {
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "OVER_UNDER_2_5", active: activeOf("BTTS"), eligibleSampleSize: 500, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MARKET_MISMATCH" });
    expect(view.rawProbabilities).toEqual([0.4, 0.6]);
  });

  it.each([
    ["no scalers", (calibrator: FittedCalibrator) => ({ ...calibrator, parameters: { ...calibrator.parameters, scalers: [] } })],
    ["a non-finite slope", (calibrator: FittedCalibrator) => ({ ...calibrator, parameters: { ...calibrator.parameters, scalers: [{ slope: Number.NaN, intercept: 0, iterations: 1, converged: true }] } })],
    ["an unknown method", (calibrator: FittedCalibrator) => ({ ...calibrator, method: "MAGIC" })],
    ["no parameters", (calibrator: FittedCalibrator) => ({ ...calibrator, parameters: undefined })],
  ])("reports CALIBRATOR_INVALID for a calibrator with %s", (_name, corrupt) => {
    const broken = { calibratorId: "cal-broken", version: 1, calibrator: corrupt(calibrators.BTTS) as unknown as FittedCalibrator };
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: broken, eligibleSampleSize: 500, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_INVALID" });
  });

  it("does not throw on a nonsense active calibrator and never returns CALIBRATED for it", () => {
    for (const calibrator of [null, undefined, {}, [], "x", 5]) {
      const active = { calibratorId: "cal-x", version: 1, calibrator } as unknown as ActiveCalibrator;
      const view = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active, eligibleSampleSize: 500, config });
      expect(view.calibration.state).toBe("UNAVAILABLE");
    }
  });

  it("refuses a non-positive version instead of presenting it as a calibrated version", () => {
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: activeOf("BTTS", 0), eligibleSampleSize: 500, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_INVALID" });
  });

  it.each([300, 301, 5000])("reports NO_PROMOTED_CALIBRATOR when %s outcomes exist but nothing was promoted", (eligibleSampleSize) => {
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: null, eligibleSampleSize, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "NO_PROMOTED_CALIBRATOR" });
  });

  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])("treats an unreadable outcome count (%s) as a read failure", (eligibleSampleSize) => {
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: null, eligibleSampleSize, config });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATION_READ_FAILED" });
  });
});

describe("resolveMarketCalibration: INSUFFICIENT_DATA (CALIB-04)", () => {
  it.each([0, 1, 299])("below 300 outcomes (%s) the state carries the current and required counts", (eligibleSampleSize) => {
    const view = resolveMarketCalibration({ forecast: forecastOf(), market: "ONE_X_TWO", active: null, eligibleSampleSize, config });
    expect(view.calibration).toEqual({
      state: "INSUFFICIENT_DATA",
      sampleSize: eligibleSampleSize,
      requiredSample: 300,
      reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES",
    });
    expect(view.rawProbabilities).toEqual([0.5, 0.25, 0.25]);
    expect("calibratedProbabilities" in view.calibration).toBe(false);
    expect("calibratorVersion" in view.calibration).toBe(false);
  });

  it("takes the threshold from the config", () => {
    const small = { ...config, minimumSamples: { ...config.minimumSamples, platt: 50 } };
    expect(resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: null, eligibleSampleSize: 49, config: small }).calibration).toMatchObject({
      state: "INSUFFICIENT_DATA",
      requiredSample: 50,
    });
    expect(resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: null, eligibleSampleSize: 50, config: small }).calibration).toMatchObject({
      state: "UNAVAILABLE",
      reasonCode: "NO_PROMOTED_CALIBRATOR",
    });
  });

  it("takes the served kinds from the config", () => {
    const preMatchOnly = { ...config, fit: { ...config.fit, servedKinds: ["PRE_MATCH"] as const } };
    const view = resolveMarketCalibration({ forecast: forecastOf({ kind: "LINEUP_CONFIRMED" }), market: "BTTS", active: activeOf("BTTS"), eligibleSampleSize: 500, config: preMatchOnly });
    expect(view.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "KIND_NOT_COVERED" });
  });
});

describe("resolveForecastCalibration and unavailableMarketCalibration", () => {
  it("returns exactly the three markets, each resolved on its own", () => {
    const map = resolveForecastCalibration({
      forecast: forecastOf(),
      active: { ONE_X_TWO: activeOf("ONE_X_TWO"), OVER_UNDER_2_5: null, BTTS: null },
      eligibleSampleSize: { ONE_X_TWO: 500, OVER_UNDER_2_5: 120, BTTS: 450 },
      config,
    });
    expect(Object.keys(map)).toEqual([...MARKETS]);
    expect(map.ONE_X_TWO.calibration.state).toBe("CALIBRATED");
    expect(map.OVER_UNDER_2_5.calibration).toMatchObject({ state: "INSUFFICIENT_DATA", sampleSize: 120, requiredSample: 300 });
    expect(map.BTTS.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "NO_PROMOTED_CALIBRATOR" });
    expect(parseMarketCalibrationMap(map)).toEqual(map);
  });

  it("builds the read-failure state and keeps the raw probabilities", () => {
    const forecast = forecastOf();
    expect(unavailableMarketCalibration({ forecast, market: "BTTS" })).toEqual({
      rawProbabilities: [0.45, 0.55],
      calibration: { state: "UNAVAILABLE", reasonCode: "CALIBRATION_READ_FAILED" },
    });
    expect(unavailableMarketCalibration({ forecast, market: "ONE_X_TWO", reasonCode: "CALIBRATOR_INVALID" }).calibration).toEqual({
      state: "UNAVAILABLE",
      reasonCode: "CALIBRATOR_INVALID",
    });
  });
});

describe("parseMarketCalibrationMap is strict (T-12-06)", () => {
  const calibratedView: MarketCalibrationView = resolveMarketCalibration({ forecast: forecastOf(), market: "BTTS", active: activeOf("BTTS"), eligibleSampleSize: 500, config });
  const insufficientView = resolveMarketCalibration({ forecast: forecastOf(), market: "OVER_UNDER_2_5", active: null, eligibleSampleSize: 12, config });
  const unavailableView = resolveMarketCalibration({ forecast: forecastOf(), market: "ONE_X_TWO", active: null, eligibleSampleSize: 900, config });
  const valid = () => structuredClone({ ONE_X_TWO: unavailableView, OVER_UNDER_2_5: insufficientView, BTTS: calibratedView });

  const withCalibration = (market: "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS", patch: (calibration: Record<string, unknown>) => void) => {
    const map = valid() as unknown as Record<string, { calibration: Record<string, unknown> }>;
    patch(map[market]!.calibration);
    return map;
  };

  it("accepts valid samples of all three states", () => {
    expect(parseMarketCalibrationMap(valid())).toEqual(valid());
  });

  it.each([
    ["not an object", null],
    ["an array", []],
    ["a missing market", (() => { const map = valid() as Record<string, unknown>; delete map.BTTS; return map; })()],
    ["an extra market", { ...valid(), CORNERS: valid().BTTS }],
    ["an extra key in a view", { ...valid(), BTTS: { ...valid().BTTS, extra: 1 } }],
    ["a missing rawProbabilities", { ...valid(), BTTS: { calibration: valid().BTTS.calibration } }],
    ["raw probabilities of the wrong length", { ...valid(), BTTS: { ...valid().BTTS, rawProbabilities: [1] } }],
    ["raw probabilities outside [0, 1]", { ...valid(), BTTS: { ...valid().BTTS, rawProbabilities: [1.5, -0.5] } }],
    ["an extra key in the calibration block", withCalibration("BTTS", (calibration) => { calibration.note = "x"; })],
    ["an unknown state", withCalibration("BTTS", (calibration) => { calibration.state = "PROMOTED"; })],
    ["an unclosed reason code", withCalibration("ONE_X_TWO", (calibration) => { calibration.reasonCode = "SOMETHING_ELSE"; })],
    ["CALIBRATED without calibratedProbabilities", withCalibration("BTTS", (calibration) => { delete calibration.calibratedProbabilities; })],
    ["CALIBRATED without calibratorVersion", withCalibration("BTTS", (calibration) => { delete calibration.calibratorVersion; })],
    ["CALIBRATED with a zero version", withCalibration("BTTS", (calibration) => { calibration.calibratorVersion = 0; })],
    ["CALIBRATED with probabilities that do not sum to 1", withCalibration("BTTS", (calibration) => { calibration.calibratedProbabilities = [0.5, 0.6]; })],
    ["CALIBRATED with the wrong class count", withCalibration("BTTS", (calibration) => { calibration.calibratedProbabilities = [1]; })],
    ["CALIBRATED carrying a reason code", withCalibration("BTTS", (calibration) => { calibration.reasonCode = "KIND_NOT_COVERED"; })],
    ["INSUFFICIENT_DATA without sampleSize", withCalibration("OVER_UNDER_2_5", (calibration) => { delete calibration.sampleSize; })],
    ["INSUFFICIENT_DATA without requiredSample", withCalibration("OVER_UNDER_2_5", (calibration) => { delete calibration.requiredSample; })],
    ["INSUFFICIENT_DATA with sampleSize at the requirement", withCalibration("OVER_UNDER_2_5", (calibration) => { calibration.sampleSize = 300; })],
    ["INSUFFICIENT_DATA with another reason code", withCalibration("OVER_UNDER_2_5", (calibration) => { calibration.reasonCode = "NO_PROMOTED_CALIBRATOR"; })],
    ["INSUFFICIENT_DATA carrying calibrated probabilities", withCalibration("OVER_UNDER_2_5", (calibration) => { calibration.calibratedProbabilities = [0.5, 0.5]; })],
    ["UNAVAILABLE without a reason code", withCalibration("ONE_X_TWO", (calibration) => { delete calibration.reasonCode; })],
    ["UNAVAILABLE with the insufficient-data reason", withCalibration("ONE_X_TWO", (calibration) => { calibration.reasonCode = "INSUFFICIENT_SETTLED_OUTCOMES"; })],
    ["UNAVAILABLE carrying calibrated probabilities", withCalibration("ONE_X_TWO", (calibration) => { calibration.calibratedProbabilities = [0.3, 0.3, 0.4]; })],
    ["an optional field present as undefined", withCalibration("BTTS", (calibration) => { calibration.method = undefined; })],
  ])("rejects %s", (_name, value) => {
    expect(() => parseMarketCalibrationMap(value)).toThrowError("INVALID_MARKET_CALIBRATION");
  });
});

describe("the frozen forecast receipt stays strict (D-08)", () => {
  it("parseForecastResponse still accepts the receipt shape and rejects an extra marketCalibration key", () => {
    expect(parseForecastResponse(validResponse)).toEqual(validResponse);
    const withCalibration = { ...validResponse, marketCalibration: {} };
    expect(() => parseForecastResponse(withCalibration)).toThrowError("UNKNOWN_FORECAST_RESPONSE_KEY");
  });

  it("CalibratedForecastResponseDto extends the receipt with a separate marketCalibration key", () => {
    const forecast = forecastOf();
    const response: CalibratedForecastResponseDto = {
      ...forecast,
      marketCalibration: resolveForecastCalibration({
        forecast,
        active: { ONE_X_TWO: null, OVER_UNDER_2_5: null, BTTS: null },
        eligibleSampleSize: { ONE_X_TWO: 0, OVER_UNDER_2_5: 0, BTTS: 0 },
        config,
      }),
    };
    expect(response.id).toBe(forecast.id);
    expect(Object.keys(response.marketCalibration)).toEqual([...MARKETS]);
  });
});
