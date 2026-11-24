import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../apps/api/node_modules/@nestjs/common/index.js";

import type { ActiveCalibratorState, CalibrationState } from "@bet-stats/database";
import { forecastConfigHashFor, parseMarketCalibrationMap, type CalibratedForecastResponseDto, type CalibratorIdentity, type ForecastResponseDto, type ScoreMarket } from "@bet-stats/domain";

import { attachMarketCalibration, calibrationFailureLogRecord, describeCalibrationError, resolveCalibrationStateCacheTtlMs, withCalibrationStateCache, type CalibrationEnrichmentDeps } from "../../apps/api/src/modules/forecasts/forecast-calibration.js";
import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";
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

describe("WR-06: parallel identity reads and a bounded TTL cache for the calibration state", () => {
  it("starts the reads of all distinct identities before the first one finishes", async () => {
    let inFlight = 0;
    let peak = 0;
    const readState = async (): Promise<CalibrationState> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return emptyState(20);
    };
    await attachMarketCalibration([forecast(DC, { id: "a" }), forecast(V1, { id: "b" })], deps(readState));
    expect(peak).toBe(2);
  });

  it("serves a state from the cache for the TTL and not a millisecond longer", async () => {
    let clock = 1_000;
    const readState = vi.fn(async () => emptyState(20));
    const cached = withCalibrationStateCache(readState, { ttlMs: 60_000, now: () => clock });
    await cached(DC, "t0");
    clock += 59_999;
    await cached(DC, "t1");
    expect(readState).toHaveBeenCalledTimes(1);
    clock += 1;
    await cached(DC, "t2");
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by the exact identity: another model version or config hash is a separate entry", async () => {
    const readState = vi.fn(async () => emptyState(20));
    const cached = withCalibrationStateCache(readState, { ttlMs: 60_000, now: () => 0 });
    await cached(DC, "t");
    await cached(V1, "t");
    await cached({ ...DC, configHash: `sha256:${"c".repeat(64)}` }, "t");
    expect(readState).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight read between concurrent requests and does not cache a failure", async () => {
    let calls = 0;
    const readState = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection lost");
      return emptyState(20);
    });
    const cached = withCalibrationStateCache(readState, { ttlMs: 60_000, now: () => 0 });
    const [first, second] = await Promise.allSettled([cached(DC, "t"), cached(DC, "t")]);
    expect(readState).toHaveBeenCalledTimes(1);
    expect([first.status, second.status]).toEqual(["rejected", "rejected"]);
    await expect(cached(DC, "t")).resolves.toEqual(emptyState(20));
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it("is bounded: the oldest entry is evicted when the limit is reached", async () => {
    const readState = vi.fn(async () => emptyState(20));
    const cached = withCalibrationStateCache(readState, { ttlMs: 60_000, now: () => 0, maxEntries: 2 });
    const identities = ["a", "b", "c"].map((letter) => ({ ...DC, configHash: `sha256:${letter.repeat(64)}` }));
    for (const identity of identities) await cached(identity, "t");
    expect(readState).toHaveBeenCalledTimes(3);
    await cached(identities[2]!, "t");
    expect(readState).toHaveBeenCalledTimes(3);
    await cached(identities[0]!, "t");
    expect(readState).toHaveBeenCalledTimes(4);
  });

  it("a promotion or rollback becomes visible once the TTL has passed; with TTL 0 the cache is off", async () => {
    let clock = 0;
    let current = emptyState(20);
    const readState = async (): Promise<CalibrationState> => current;
    const cached = withCalibrationStateCache(readState, { ttlMs: 1_000, now: () => clock });
    const promoted: CalibrationState = { ...emptyState(400), BTTS: { active: active("BTTS", DC), eligibleSampleSize: null } };
    expect((await cached(DC, "t")).BTTS.active).toBeNull();
    current = promoted;
    expect((await cached(DC, "t")).BTTS.active).toBeNull();
    clock = 1_000;
    expect((await cached(DC, "t")).BTTS.active).not.toBeNull();

    const direct = vi.fn(readState);
    const off = withCalibrationStateCache(direct, { ttlMs: 0 });
    await off(DC, "t");
    await off(DC, "t");
    expect(direct).toHaveBeenCalledTimes(2);
  });

  it("the TTL comes from configuration: default 60 s, 0 disables, capped at 300 s, garbage falls back", () => {
    expect(resolveCalibrationStateCacheTtlMs({})).toBe(60_000);
    expect(resolveCalibrationStateCacheTtlMs({ CALIBRATION_STATE_CACHE_TTL_MS: "0" })).toBe(0);
    expect(resolveCalibrationStateCacheTtlMs({ CALIBRATION_STATE_CACHE_TTL_MS: "15000" })).toBe(15_000);
    expect(resolveCalibrationStateCacheTtlMs({ CALIBRATION_STATE_CACHE_TTL_MS: "99999999" })).toBe(300_000);
    for (const bad of ["abc", "-5", "1.5", ""]) expect(resolveCalibrationStateCacheTtlMs({ CALIBRATION_STATE_CACHE_TTL_MS: bad })).toBe(60_000);
  });

  it("a market whose count was not computed (active calibrator) is still served CALIBRATED", async () => {
    const state: CalibrationState = { ...emptyState(400), BTTS: { active: active("BTTS", DC), eligibleSampleSize: null } };
    const [result] = await attachMarketCalibration([forecast(DC)], deps(async () => state));
    expect(result!.marketCalibration.BTTS.calibration.state).toBe("CALIBRATED");
  });
});

describe("WR-07: a soft calibration failure is reported to the operator, without secrets", () => {
  it("reports one failure per failed identity with its code and identity, and the client still gets UNAVAILABLE", async () => {
    const onError = vi.fn();
    const readState = async (identity: CalibratorIdentity): Promise<CalibrationState> => {
      if (identity.modelVersion === V1.modelVersion) throw Object.assign(new Error("password authentication failed for user postgres at postgresql://postgres:hunter2@db:5432"), { code: "P1000" });
      return emptyState(20);
    };
    const [dc, v1a, v1b] = await attachMarketCalibration([forecast(DC), forecast(V1, { id: "x" }), forecast(V1, { id: "y", kind: "LINEUP_CONFIRMED", officialLineupObservationId: "o" } as Partial<ForecastResponseDto>)], { ...deps(readState), onError });
    expect(dc!.marketCalibration.ONE_X_TWO.calibration.state).toBe("INSUFFICIENT_DATA");
    expect(v1a!.marketCalibration.ONE_X_TWO.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
    expect(v1b!.marketCalibration.BTTS.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({ identity: V1, stage: "READ", code: "P1000" });
    const record = JSON.stringify(calibrationFailureLogRecord(onError.mock.calls[0]![0]));
    expect(record).toContain("calibration.read_failed");
    expect(record).not.toMatch(/hunter2|postgresql:\/\/|password/i);
  });

  it("falls back to the error class name, then to UNKNOWN, and never to the message", () => {
    expect(describeCalibrationError(new TypeError("relation \"current_calibrators\" does not exist"))).toBe("TypeError");
    expect(describeCalibrationError(Object.assign(new Error("x"), { code: "42P01" }))).toBe("42P01");
    expect(describeCalibrationError(Object.assign(new Error("x"), { code: "has spaces and secrets" }))).toBe("Error");
    expect(describeCalibrationError("boom")).toBe("UNKNOWN");
    expect(describeCalibrationError(null)).toBe("UNKNOWN");
  });

  it("a logger that throws does not break the response", async () => {
    const onError = vi.fn(() => { throw new Error("log sink down"); });
    const [result] = await attachMarketCalibration([forecast(DC)], { ...deps(async () => { throw new Error("db down"); }), onError });
    expect(result!.marketCalibration.ONE_X_TWO.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("WR-07: the forecasts service logs a failed calibration read at warn level", () => {
  it("wires onError to the Nest logger with the structured record", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const service = new ForecastsService();
      const [result] = await attachMarketCalibration([forecast(DC)], service.calibration);
      expect(result!.marketCalibration.ONE_X_TWO.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]![0]);
      expect(JSON.parse(message)).toEqual({ event: "calibration.read_failed", stage: "READ", modelVersion: DC.modelVersion, configHash: DC.configHash, code: "Error" });
    } finally {
      warn.mockRestore();
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
