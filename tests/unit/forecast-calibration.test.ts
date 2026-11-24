import { describe, expect, it, vi } from "vitest";

import type { ActiveCalibratorState, CalibrationState } from "@bet-stats/database";
import { forecastConfigHashFor, parseMarketCalibrationMap, type CalibratedForecastResponseDto, type CalibratorIdentity, type ForecastResponseDto, type ScoreMarket } from "@bet-stats/domain";

import { attachMarketCalibration, type CalibrationEnrichmentDeps } from "../../apps/api/src/modules/forecasts/forecast-calibration.js";
import { makeFitted } from "../helpers/calibration-db.js";
import { makeForecastDto } from "../helpers/forecast-dto.js";

const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };
const V1: CalibratorIdentity = { modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const NOW = new Date("2026-11-24T10:00:00.000Z");

const forecast = makeForecastDto;

const emptyState = (eligible: number): CalibrationState => ({
  ONE_X_TWO: { active: null, eligibleSampleSize: eligible },
  OVER_UNDER_2_5: { active: null, eligibleSampleSize: eligible },
  BTTS: { active: null, eligibleSampleSize: eligible },
});

/** An active-calibrator record for one market, fitted by the domain on synthetic samples; `identity` is what the calibrator is pinned to. */
function active(market: ScoreMarket, identity: CalibratorIdentity, version = 1): ActiveCalibratorState {
  return { calibratorId: `calibrator_${"1".repeat(64)}`, version, calibrator: makeFitted({ market, identity, seed: 501 }), activationSeq: 10, activatedBy: "PROMOTED", activatedAt: NOW.toISOString(), restoreTargetId: null };
}

const deps = (readState: CalibrationEnrichmentDeps["readState"]): CalibrationEnrichmentDeps => ({ readState, now: () => NOW });

/** Deep freeze: any mutation of the input forecast by the enrichment would throw in strict mode. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const CALIBRATION_KEYS = ["state", "calibratedProbabilities", "calibratorVersion", "method", "sampleSize", "requiredSample", "holdoutBrierRaw", "holdoutBrierCalibrated", "reasonCode"];

describe("attachMarketCalibration", () => {
  it("adds exactly one key, marketCalibration, keeps every stored field and does not mutate the input", async () => {
    const stored = freeze(forecast(DC));
    const before = JSON.stringify(stored);
    const [result] = await attachMarketCalibration([stored], deps(async () => emptyState(20)));
    expect(JSON.stringify(stored)).toBe(before);
    expect(Object.keys(result!).sort()).toEqual([...Object.keys(stored), "marketCalibration"].sort());
    for (const key of Object.keys(stored) as Array<keyof ForecastResponseDto>) expect(result![key], key).toBe(stored[key]);
    expect(Object.keys(result!.marketCalibration)).toEqual([...MARKETS]);
  });

  it("without a calibrator below the threshold: INSUFFICIENT_DATA with the current and the required counts; raw probabilities equal the stored ones", async () => {
    const stored = forecast(DC);
    const [result] = await attachMarketCalibration([stored], deps(async () => emptyState(20)));
    for (const market of MARKETS) {
      const view = result!.marketCalibration[market];
      expect(view.calibration).toEqual({ state: "INSUFFICIENT_DATA", sampleSize: 20, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" });
      expect(view.rawProbabilities).toEqual(stored.probabilities[market].map((event) => event.probability));
    }
  });

  it("with an active calibrator pinned to the forecast's identity: CALIBRATED with normalised probabilities and a closed set of keys", async () => {
    const state: CalibrationState = { ...emptyState(400), OVER_UNDER_2_5: { active: active("OVER_UNDER_2_5", DC, 3), eligibleSampleSize: 400 } };
    const [result] = await attachMarketCalibration([forecast(DC)], deps(async () => state));
    const view = result!.marketCalibration.OVER_UNDER_2_5;
    expect(view.calibration.state).toBe("CALIBRATED");
    expect(view.calibration.calibratorVersion).toBe(3);
    expect(view.calibration.calibratedProbabilities).toHaveLength(2);
    expect(view.calibration.calibratedProbabilities!.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(view.calibration.method).toMatch(/^(PLATT|ISOTONIC)$/);
    expect(view.calibration.sampleSize).toBeGreaterThanOrEqual(60);
    for (const key of Object.keys(view.calibration)) expect(CALIBRATION_KEYS).toContain(key);
    // The other markets have no calibrator and 400 outcomes: honest absence, not a fitted layer.
    expect(result!.marketCalibration.ONE_X_TWO.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "NO_PROMOTED_CALIBRATOR" });
    // Nothing internal leaks: no parameters, calibrator ids or digests anywhere in the payload.
    const text = JSON.stringify(result!.marketCalibration);
    expect(text).not.toMatch(/calibrator_[0-9a-f]{64}|scalers|parameters|samplesDigest|sha256:|activationSeq|restoreTarget/);
  });

  it("reads the state once per distinct identity and request, with one asOf, and keeps no cache between requests", async () => {
    const readState = vi.fn(async (identity: CalibratorIdentity) => emptyState(identity.modelVersion === DC.modelVersion ? 20 : 7));
    const batch = [forecast(DC, { id: "a" }), forecast(V1, { id: "b" }), forecast(DC, { id: "c", kind: "INITIAL" })];
    const result = await attachMarketCalibration(batch, deps(readState));
    expect(readState).toHaveBeenCalledTimes(2);
    expect(readState.mock.calls.map(([identity]) => identity)).toEqual([DC, V1]);
    expect(new Set(readState.mock.calls.map(([, asOf]) => asOf))).toEqual(new Set([NOW.toISOString()]));
    expect(result.map((entry) => entry.marketCalibration.ONE_X_TWO.calibration.sampleSize)).toEqual([20, 7, undefined]);
    await attachMarketCalibration(batch, deps(readState));
    expect(readState).toHaveBeenCalledTimes(4);
  });

  it("INITIAL is not covered by calibration, PRE_MATCH and LINEUP_CONFIRMED are", async () => {
    const lineup = forecast(DC, { id: "lineup", kind: "LINEUP_CONFIRMED", officialLineupObservationId: "lineup-observation" } as Partial<ForecastResponseDto>);
    const result = await attachMarketCalibration([forecast(DC, { kind: "INITIAL" }), forecast(DC), lineup], deps(async () => emptyState(20)));
    expect(result.map((entry) => entry.marketCalibration.BTTS.calibration.state)).toEqual(["UNAVAILABLE", "INSUFFICIENT_DATA", "INSUFFICIENT_DATA"]);
    expect(result[0]!.marketCalibration.BTTS.calibration.reasonCode).toBe("KIND_NOT_COVERED");
  });

  it("a read failure is soft: UNAVAILABLE/CALIBRATION_READ_FAILED on every market, the forecast is returned whole", async () => {
    const stored = forecast(DC);
    const [result] = await attachMarketCalibration([stored], deps(async () => { throw new Error("connection lost"); }));
    for (const market of MARKETS) {
      expect(result!.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATION_READ_FAILED" });
      expect(result!.marketCalibration[market].rawProbabilities).toEqual(stored.probabilities[market].map((event) => event.probability));
    }
    expect(result!.probabilities).toBe(stored.probabilities);
    expect(JSON.stringify(result!.marketCalibration)).not.toContain("connection lost");
  });

  it("a failure for one identity does not spoil the other identity of the same request", async () => {
    const readState = vi.fn(async (identity: CalibratorIdentity) => { if (identity.modelVersion === V1.modelVersion) throw new Error("boom"); return emptyState(20); });
    const [dc, v1] = await attachMarketCalibration([forecast(DC), forecast(V1)], deps(readState));
    expect(dc!.marketCalibration.ONE_X_TWO.calibration.state).toBe("INSUFFICIENT_DATA");
    expect(v1!.marketCalibration.ONE_X_TWO.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
  });

  it("an empty batch needs no read", async () => {
    const readState = vi.fn(async () => emptyState(0));
    await expect(attachMarketCalibration([], deps(readState))).resolves.toEqual([]);
    expect(readState).not.toHaveBeenCalled();
  });

  it("the strict marketCalibration parser accepts every produced shape", async () => {
    const state: CalibrationState = { ...emptyState(400), BTTS: { active: active("BTTS", DC), eligibleSampleSize: 400 } };
    const results: CalibratedForecastResponseDto[] = [
      ...(await attachMarketCalibration([forecast(DC), forecast(DC, { kind: "INITIAL" })], deps(async () => state))),
      ...(await attachMarketCalibration([forecast(DC)], deps(async () => emptyState(20)))),
      ...(await attachMarketCalibration([forecast(DC)], deps(async () => { throw new Error("x"); }))),
    ];
    for (const entry of results) expect(() => parseMarketCalibrationMap(entry.marketCalibration)).not.toThrow();
  });
});

describe("attachMarketCalibration: a calibrator of another identity is never applied", () => {
  const OTHER_CONFIG: CalibratorIdentity = { modelVersion: DC.modelVersion, configHash: `sha256:${"b".repeat(64)}` };

  it("a V1 forecast handed a calibrator pinned to Dixon-Coles is UNAVAILABLE/CALIBRATOR_MODEL_MISMATCH on every market", async () => {
    const stored = forecast(V1);
    const state: CalibrationState = Object.fromEntries(MARKETS.map((market) => [market, { active: active(market, DC), eligibleSampleSize: 400 }])) as CalibrationState;
    const [result] = await attachMarketCalibration([stored], deps(async () => state));
    for (const market of MARKETS) {
      expect(result!.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MODEL_MISMATCH" });
      expect(result!.marketCalibration[market].rawProbabilities).toEqual(stored.probabilities[market].map((event) => event.probability));
    }
  });

  it("the same model version with another config hash is a mismatch as well", async () => {
    const state: CalibrationState = Object.fromEntries(MARKETS.map((market) => [market, { active: active(market, OTHER_CONFIG), eligibleSampleSize: 400 }])) as CalibrationState;
    const [result] = await attachMarketCalibration([forecast(DC)], deps(async () => state));
    for (const market of MARKETS) expect(result!.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MODEL_MISMATCH" });
  });

  it("a calibrator pinned to another market is a market mismatch", async () => {
    const state: CalibrationState = { ...emptyState(400), ONE_X_TWO: { active: active("BTTS", DC), eligibleSampleSize: 400 } };
    const [result] = await attachMarketCalibration([forecast(DC)], deps(async () => state));
    expect(result!.marketCalibration.ONE_X_TWO.calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MARKET_MISMATCH" });
  });

  it("a mismatch for one forecast does not touch the matching forecast of the same request", async () => {
    const state = (identity: CalibratorIdentity): CalibrationState => Object.fromEntries(MARKETS.map((market) => [market, { active: active(market, DC), eligibleSampleSize: 400 }])) as CalibrationState;
    const [dc, v1] = await attachMarketCalibration([forecast(DC), forecast(V1)], deps(async (identity) => state(identity)));
    expect(dc!.marketCalibration.ONE_X_TWO.calibration.state).toBe("CALIBRATED");
    expect(v1!.marketCalibration.ONE_X_TWO.calibration.state).toBe("UNAVAILABLE");
  });
});
