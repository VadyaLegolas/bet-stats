import { describe, expect, it, vi } from "vitest";

import { readCalibrationState, type PrismaClient } from "@bet-stats/database";
import { calibratorContentId, forecastConfigHashFor, type CalibratorIdentity, type FittedCalibrator, type ScoreMarket } from "@bet-stats/domain";

import { makeFitted } from "../helpers/calibration-db.js";

/** WR-06: the expensive census of settled outcomes is read only when some market needs its count. */

const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };

/** The row `current_calibrators JOIN Calibrator JOIN calibrator_versions` yields for an active calibrator. */
function activeRow(calibrator: FittedCalibrator) {
  return {
    id: calibratorContentId(calibrator), modelVersion: calibrator.identity.modelVersion, configHash: calibrator.identity.configHash, market: calibrator.market,
    method: calibrator.method, parameters: calibrator.parameters, calibrationConfigVersion: calibrator.calibrationConfigVersion, calibrationConfigHash: calibrator.calibrationConfigHash,
    samplesDigest: calibrator.samplesDigest, fitSampleSize: calibrator.fitSampleSize, holdoutSampleSize: calibrator.holdoutSampleSize,
    fitWindowFrom: new Date(calibrator.fitFrom), fitWindowTo: new Date(calibrator.fitTo), holdoutFrom: new Date(calibrator.holdoutFrom), holdoutTo: new Date(calibrator.holdoutTo),
    fitAsOf: new Date(calibrator.fittedAsOf), holdoutBrierRaw: calibrator.holdoutBrierRaw, holdoutBrierCalibrated: calibrator.holdoutBrierCalibrated,
    plattHoldoutBrier: calibrator.plattHoldoutBrier ?? null, isotonicHoldoutBrier: calibrator.isotonicHoldoutBrier ?? null,
    activationSeq: 5n, activatedBy: "PROMOTED", activatedAt: new Date("2027-03-02T00:00:00.000Z"), version: 1n, restoreTargetId: null,
  };
}

function fakeClient(activeMarkets: readonly ScoreMarket[]) {
  const findMany = vi.fn(async () => []);
  const resultFindMany = vi.fn(async () => []);
  const rows = activeMarkets.map((market) => activeRow(makeFitted({ market, identity: DC, seed: 700 })));
  const client = { $queryRaw: vi.fn(async () => rows), forecastSnapshot: { findMany }, resultVersion: { findMany: resultFindMany } } as unknown as PrismaClient;
  return { client, findMany };
}

describe("readCalibrationState reads the census only when it is needed", () => {
  it("with a calibrator on every market no snapshot is read and no count is claimed", async () => {
    const { client, findMany } = fakeClient(["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"]);
    const state = await readCalibrationState(client, { ...DC, asOf: "2027-03-10T00:00:00.000Z" });
    expect(findMany).not.toHaveBeenCalled();
    for (const market of ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const) {
      expect(state[market].active).not.toBeNull();
      expect(state[market].eligibleSampleSize).toBeNull();
    }
  });

  it("one market without a calibrator triggers the census; only that market reports a count", async () => {
    const { client, findMany } = fakeClient(["OVER_UNDER_2_5", "BTTS"]);
    const state = await readCalibrationState(client, { ...DC, asOf: "2027-03-10T00:00:00.000Z" });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(state.ONE_X_TWO).toEqual({ active: null, eligibleSampleSize: 0 });
    expect(state.OVER_UNDER_2_5.eligibleSampleSize).toBeNull();
    expect(state.BTTS.eligibleSampleSize).toBeNull();
  });

  it("with no calibrator at all every market reports its count", async () => {
    const { client, findMany } = fakeClient([]);
    const state = await readCalibrationState(client, { ...DC, asOf: "2027-03-10T00:00:00.000Z" });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ ONE_X_TWO: { active: null, eligibleSampleSize: 0 }, OVER_UNDER_2_5: { active: null, eligibleSampleSize: 0 }, BTTS: { active: null, eligibleSampleSize: 0 } });
  });
});
