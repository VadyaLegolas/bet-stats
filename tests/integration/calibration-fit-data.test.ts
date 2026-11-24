import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, readCalibrationFitData, readCalibrationState, type PrismaClient } from "@bet-stats/database";
import { calibrationOutcomeIndex, SCORE_CLASS_ORDER } from "@bet-stats/domain";

import { makeFitted, migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { DAY_MS, DC_CONFIG_HASH, DC_VERSION, HOUR_MS, MARKETS, probabilitiesFor, seedBase, seedFixture, V1_CONFIG_HASH, V1_VERSION } from "../helpers/calibration-fit-seed.js";

/** Home win, draw, away win, totals of exactly 2 and 3 goals, BTTS yes and no. */
const SCORES: ReadonlyArray<readonly [number, number]> = [[2, 1], [1, 1], [0, 2], [3, 0], [0, 0], [1, 2], [2, 0], [2, 2], [0, 1], [4, 1], [1, 0], [0, 3]];
const BASE_KICKOFF = Date.parse("2026-09-01T18:00:00.000Z");
const ASOF = "2026-12-01T00:00:00.000Z";

let server: TestPostgres;
let client: PrismaClient;
let base: Awaited<ReturnType<typeof seedBase>>;

const kickoffOf = (index: number): Date => new Date(BASE_KICKOFF + index * DAY_MS);

describe("calibration fit data: path of one identity from the database to the active calibrator", () => {
  beforeAll(async () => {
    server = startPostgres(`bet-stats-calibration-fitdata-${process.pid}`);
    migrateDeploy(server.url());
    client = createPrismaClient(server.url());
    base = await seedBase(client, "fd");
    // Inserted newest first so that no ordering of the result can come from insertion order.
    for (let index = SCORES.length - 1; index >= 0; index -= 1) {
      const [homeGoals, awayGoals] = SCORES[index]!;
      await seedFixture(client, base, {
        id: `fd-${String(index).padStart(2, "0")}`,
        kickoff: kickoffOf(index),
        index,
        snapshots: [{}],
        results: [{ id: `fd-${String(index).padStart(2, "0")}-r1`, observedAt: new Date(kickoffOf(index).getTime() + 2 * HOUR_MS), homeGoals, awayGoals }],
      });
    }
  }, 300_000);

  afterAll(async () => {
    await client?.$disconnect();
    server?.remove();
  });

  it("reads 12 samples per market in (kickoffUtc, sampleId) order with real probabilities and ISO UTC times", async () => {
    const data = await readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF });
    expect(data.identity).toEqual({ modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH });
    expect(data.asOf).toBe(ASOF);
    expect(data.skippedMalformedProbabilities).toBe(0);
    expect(data.skippedUnusableResults).toBe(0);
    for (const market of MARKETS) {
      const samples = data.samples[market];
      expect(samples).toHaveLength(12);
      samples.forEach((sample, index) => {
        expect(sample.kickoffUtc).toBe(kickoffOf(index).toISOString());
        expect(sample.knownAt).toBe(new Date(kickoffOf(index).getTime() + 2 * HOUR_MS).toISOString());
        expect(sample.sampleId).toBe(`fd-${String(index).padStart(2, "0")}-snap-1`);
        expect(sample.probabilities).toEqual(probabilitiesFor(index)[market]);
        expect(sample.probabilities).toHaveLength(SCORE_CLASS_ORDER[market].length);
      });
    }
  });

  it("outcome indices follow the market rules on every score of the table", async () => {
    const data = await readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF });
    SCORES.forEach(([home, away], index) => {
      expect(data.samples.ONE_X_TWO[index]!.outcomeIndex).toBe(home > away ? 0 : home === away ? 1 : 2);
      expect(data.samples.OVER_UNDER_2_5[index]!.outcomeIndex).toBe(home + away >= 3 ? 0 : 1);
      expect(data.samples.BTTS[index]!.outcomeIndex).toBe(home > 0 && away > 0 ? 0 : 1);
      for (const market of MARKETS) expect(data.samples[market][index]!.outcomeIndex).toBe(calibrationOutcomeIndex(market, home, away));
    });
    // The table really covers the cases the plan names.
    expect(new Set(data.samples.ONE_X_TWO.map((sample) => sample.outcomeIndex))).toEqual(new Set([0, 1, 2]));
    expect(SCORES.some(([home, away]) => home + away === 2)).toBe(true);
    expect(SCORES.some(([home, away]) => home + away === 3)).toBe(true);
  });

  it("is repeatable: two reads in a row are equal", async () => {
    const first = await readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF });
    const second = await readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF });
    expect(second).toEqual(first);
  });

  it("rejects an unreadable asOf instead of reading everything", async () => {
    await expect(readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: "not a date" })).rejects.toMatchObject({ code: "INVALID_CALIBRATION_AS_OF" });
  });

  it("reports the census without a calibrator, then with the promoted one, and nothing for another identity", async () => {
    const identity = { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH } as const;
    const before = await readCalibrationState(client, { ...identity, asOf: ASOF });
    for (const market of MARKETS) expect(before[market]).toEqual({ active: null, eligibleSampleSize: 12 });

    const repository = createPrismaCalibrationRepository(client);
    const fitted = makeFitted({ identity, market: "OVER_UNDER_2_5", seed: 811 });
    const { calibratorId } = await repository.persistCalibrator(fitted);
    await repository.promoteCalibrator({ identity, market: "OVER_UNDER_2_5", calibratorId, predecessorCalibratorId: null, asOf: "2027-03-02T00:00:00.000Z", reasonCode: "FIRST_PROMOTION", evaluation: {} });

    const after = await readCalibrationState(client, { ...identity, asOf: ASOF });
    expect(after.OVER_UNDER_2_5.active).toMatchObject({ calibratorId, version: 1, calibrator: fitted });
    expect(after.OVER_UNDER_2_5.eligibleSampleSize).toBe(12);
    expect(after.ONE_X_TWO).toEqual({ active: null, eligibleSampleSize: 12 });
    expect(after.BTTS).toEqual({ active: null, eligibleSampleSize: 12 });

    // The other model version has neither forecasts nor a calibrator here; the promoted one is not visible to it.
    const other = await readCalibrationState(client, { modelVersion: V1_VERSION, configHash: V1_CONFIG_HASH, asOf: ASOF });
    for (const market of MARKETS) expect(other[market]).toEqual({ active: null, eligibleSampleSize: 0 });
    // The same model version with another config hash is another identity as well.
    const otherHash = await readCalibrationState(client, { modelVersion: DC_VERSION, configHash: V1_CONFIG_HASH, asOf: ASOF });
    for (const market of MARKETS) expect(otherHash[market]).toEqual({ active: null, eligibleSampleSize: 0 });
  });
});
