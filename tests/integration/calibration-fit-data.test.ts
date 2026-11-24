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

// One container for the whole file: the identity path and the leakage matrix below share it.
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

describe("calibration fit data: path of one identity from the database to the active calibrator", () => {
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
    // WR-06: the count is not computed for a market that has a calibrator.
    expect(after.OVER_UNDER_2_5.eligibleSampleSize).toBeNull();
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

/** One scenario = one configHash: scenarios never see each other's fixtures, whatever the order of the tests. */
const scenarioHash = (scenario: string): string => `sha256:${scenario.repeat(64)}`;
const SCENARIO_ASOF = new Date("2026-11-01T00:00:00.000Z");
const dayBefore = (days: number): Date => new Date(SCENARIO_ASOF.getTime() - days * DAY_MS);
const settledAt = (kickoff: Date): Date => new Date(kickoff.getTime() + 2 * HOUR_MS);
const read = (hash: string, asOf: Date = SCENARIO_ASOF, modelVersion: string = DC_VERSION) =>
  readCalibrationFitData(client, { modelVersion: modelVersion as typeof DC_VERSION, configHash: hash, asOf: asOf.toISOString() });
const ids = (data: Awaited<ReturnType<typeof read>>, market: (typeof MARKETS)[number] = "ONE_X_TWO"): string[] => data.samples[market].map((sample) => sample.sampleId);

type SnapshotSpecs = NonNullable<Parameters<typeof seedFixture>[2]["snapshots"]>;

/** A fixture that finished two hours after kickoff with `score`; snapshots default to the scenario's configHash. */
async function finished(id: string, kickoff: Date, hash: string, index: number, snapshots: SnapshotSpecs = [{}], score: readonly [number, number] = [2, 1]): Promise<void> {
  await seedFixture(client, base, {
    id,
    kickoff,
    index,
    snapshots: snapshots.map((entry) => ({ configHash: hash, ...entry })),
    results: [{ id: `${id}-r1`, observedAt: settledAt(kickoff), homeGoals: score[0], awayGoals: score[1] }],
  });
}

describe("calibration fit data: leakage and identity isolation matrix (D-04, D-06)", () => {
  it("origin: a BACKTEST snapshot is excluded while the same shape as PRODUCTION on another fixture is included", async () => {
    const hash = scenarioHash("1");
    await finished("o-backtest", dayBefore(10), hash, 1, [{ origin: "BACKTEST" }]);
    await finished("o-production", dayBefore(9), hash, 2, [{ origin: "PRODUCTION" }]);
    const data = await read(hash);
    expect(ids(data)).toEqual(["o-production-snap-1"]);
    expect(data.samples.OVER_UNDER_2_5).toHaveLength(1);
  });

  it("issuedAt: a forecast issued after asOf is excluded, and included when read at a later asOf", async () => {
    const hash = scenarioHash("2");
    await finished("i-late", dayBefore(10), hash, 3, [{ issuedAt: new Date(SCENARIO_ASOF.getTime() + DAY_MS) }]);
    await finished("i-early", dayBefore(9), hash, 4, [{}]);
    expect(ids(await read(hash))).toEqual(["i-early-snap-1"]);
    const later = await read(hash, new Date(SCENARIO_ASOF.getTime() + 2 * DAY_MS));
    expect(ids(later)).toEqual(["i-late-snap-1", "i-early-snap-1"]);
  });

  it("cutoff: a forecast cut off at or after kickoff is excluded; an invalid newest revision falls back to the previous valid one", async () => {
    const hash = scenarioHash("3");
    await finished("c-at-kickoff", dayBefore(10), hash, 5, [{ cutoffOffsetMs: 0 }]);
    await finished("c-after-kickoff", dayBefore(9), hash, 5, [{ cutoffOffsetMs: 30 * 60_000 }]);
    // Revision 1 is valid; revision 2 (the newest) was cut off after kickoff: the match is not dropped, revision 1 is used.
    await finished("c-fallback", dayBefore(8), hash, 6, [{ variant: 0 }, { cutoffOffsetMs: 30 * 60_000, variant: 3 }]);
    const data = await read(hash);
    expect(ids(data)).toEqual(["c-fallback-snap-1"]);
    expect(data.samples.ONE_X_TWO[0]!.probabilities).toEqual(probabilitiesFor(6, 0).ONE_X_TWO);
  });

  it("result and kickoff after asOf: such matches are excluded", async () => {
    const hash = scenarioHash("4");
    // Kicked off before asOf, but the result was observed after asOf.
    await seedFixture(client, base, {
      id: "r-late-result", kickoff: dayBefore(2), index: 7, snapshots: [{ configHash: hash }],
      results: [{ id: "r-late-result-r1", observedAt: new Date(SCENARIO_ASOF.getTime() + HOUR_MS), homeGoals: 1, awayGoals: 0 }],
    });
    // Kicks off after asOf although its forecast was cut off long before asOf.
    await seedFixture(client, base, {
      id: "r-future-match", kickoff: new Date(SCENARIO_ASOF.getTime() + DAY_MS), index: 8, snapshots: [{ configHash: hash, cutoffOffsetMs: -3 * DAY_MS }],
      results: [{ id: "r-future-match-r1", observedAt: new Date(SCENARIO_ASOF.getTime() + 2 * DAY_MS), homeGoals: 1, awayGoals: 0 }],
    });
    await finished("r-ok", dayBefore(5), hash, 9, [{}]);
    expect(ids(await read(hash))).toEqual(["r-ok-snap-1"]);
  });

  it("result correction: reads the lineage leaf at asOf (before, between, after) and keeps the first knownAt", async () => {
    const hash = scenarioHash("5");
    const kickoff = dayBefore(3);
    const first = settledAt(kickoff); // r1: home win 2-0
    const second = new Date(kickoff.getTime() + 5 * HOUR_MS); // r2: away win 0-2, supersedes r1
    await seedFixture(client, base, {
      id: "k-fixture", kickoff, index: 10, snapshots: [{ configHash: hash }],
      results: [
        { id: "k-fixture-r1", observedAt: first, homeGoals: 2, awayGoals: 0 },
        { id: "k-fixture-r2", observedAt: second, homeGoals: 0, awayGoals: 2, supersedes: "k-fixture-r1" },
      ],
    });
    const before = await read(hash, new Date(kickoff.getTime() + HOUR_MS));
    expect(ids(before)).toEqual([]);
    const between = await read(hash, new Date(kickoff.getTime() + 3 * HOUR_MS));
    expect(between.samples.ONE_X_TWO.map((sample) => [sample.outcomeIndex, sample.knownAt])).toEqual([[0, first.toISOString()]]);
    const after = await read(hash, new Date(kickoff.getTime() + 6 * HOUR_MS));
    expect(after.samples.ONE_X_TWO.map((sample) => [sample.outcomeIndex, sample.knownAt])).toEqual([[2, first.toISOString()]]);
    // 2-0 and 0-2 agree on over/under (2 goals) and BTTS (no): the leaf still decides every market.
    expect(after.samples.OVER_UNDER_2_5[0]!.outcomeIndex).toBe(1);
    expect(after.samples.BTTS[0]!.outcomeIndex).toBe(1);
  });

  it("result status and score: a non-FINISHED result and a missing score are excluded and counted", async () => {
    const hash = scenarioHash("6");
    await seedFixture(client, base, { id: "s-postponed", kickoff: dayBefore(10), index: 11, snapshots: [{ configHash: hash }], results: [{ id: "s-postponed-r1", observedAt: settledAt(dayBefore(10)), homeGoals: 0, awayGoals: 0, status: "POSTPONED" }] });
    await seedFixture(client, base, { id: "s-no-score", kickoff: dayBefore(9), index: 12, snapshots: [{ configHash: hash }], results: [{ id: "s-no-score-r1", observedAt: settledAt(dayBefore(9)), homeGoals: null, awayGoals: 1 }] });
    await finished("s-ok", dayBefore(8), hash, 13, [{}]);
    const data = await read(hash);
    expect(ids(data)).toEqual(["s-ok-snap-1"]);
    expect(data.skippedUnusableResults).toBe(2);
  });

  it("kind: INITIAL and LINEUP_CONFIRMED forecasts of the same identity do not enter the fit sample", async () => {
    const hash = scenarioHash("7");
    await finished("n-only-other-kinds", dayBefore(10), hash, 14, [{ kind: "INITIAL" }, { kind: "LINEUP_CONFIRMED" }]);
    await finished("n-with-pre-match", dayBefore(9), hash, 15, [{ kind: "INITIAL", variant: 1 }, { kind: "PRE_MATCH", variant: 0 }, { kind: "LINEUP_CONFIRMED", variant: 2 }]);
    const data = await read(hash);
    expect(ids(data)).toEqual(["n-with-pre-match-snap-2"]);
    expect(data.samples.ONE_X_TWO[0]!.probabilities).toEqual(probabilitiesFor(15, 0).ONE_X_TWO);
  });

  it("identity: V1 and DC forecasts of one match give independent samples; another configHash is excluded", async () => {
    const dcHash = scenarioHash("8");
    const v1Hash = scenarioHash("9");
    const otherHash = scenarioHash("a");
    // One fixture, one shared PRE_MATCH revision chain: revision 1 is V1, revision 2 is DC.
    await finished("m-both", dayBefore(10), dcHash, 16, [{ modelVersion: V1_VERSION, configHash: v1Hash, variant: 0 }, { modelVersion: DC_VERSION, configHash: dcHash, variant: 1 }]);
    // The same model version with another config hash, on another fixture.
    await finished("m-other-config", dayBefore(9), otherHash, 17, [{ modelVersion: DC_VERSION, configHash: otherHash }]);

    const dc = await read(dcHash);
    expect(ids(dc)).toEqual(["m-both-snap-2"]);
    expect(dc.samples.ONE_X_TWO[0]!.probabilities).toEqual(probabilitiesFor(16, 1).ONE_X_TWO);

    const v1 = await read(v1Hash, SCENARIO_ASOF, V1_VERSION);
    expect(ids(v1)).toEqual(["m-both-snap-1"]);
    expect(v1.samples.ONE_X_TWO[0]!.probabilities).toEqual(probabilitiesFor(16, 0).ONE_X_TWO);

    // Both halves of the pair must match: DC with the V1 hash, or V1 with the DC hash, finds nothing.
    expect(ids(await read(v1Hash))).toEqual([]);
    expect(ids(await read(dcHash, SCENARIO_ASOF, V1_VERSION))).toEqual([]);
    expect(ids(await read(otherHash))).toEqual(["m-other-config-snap-1"]);
  });

  it("one sample per match and market: two valid revisions give one object with the newest probabilities", async () => {
    const hash = scenarioHash("b");
    await finished("q-two-revisions", dayBefore(10), hash, 18, [{ variant: 0 }, { variant: 2 }]);
    const data = await read(hash);
    for (const market of MARKETS) expect(data.samples[market]).toHaveLength(1);
    expect(ids(data)).toEqual(["q-two-revisions-snap-2"]);
    expect(data.samples.ONE_X_TWO[0]!.probabilities).toEqual(probabilitiesFor(18, 2).ONE_X_TWO);
  });

  it("unreadable probabilities (class order or sum) are skipped and counted, other matches are read", async () => {
    const hash = scenarioHash("c");
    await finished("u-wrong-order", dayBefore(10), hash, 19, [{ rawMarkets: { ONE_X_TWO: [{ selection: "AWAY", probability: 0.2 }, { selection: "DRAW", probability: 0.25 }, { selection: "HOME", probability: 0.55 }] } }]);
    await finished("u-bad-sum", dayBefore(9), hash, 20, [{ rawMarkets: { BTTS: [{ selection: "YES", probability: 0.5 }, { selection: "NO", probability: 0.4 }] } }]);
    await finished("u-valid", dayBefore(8), hash, 21, [{}]);
    // The newest revision is unreadable in one market only: that market falls back to revision 1, the others use revision 2.
    await finished("u-fallback", dayBefore(7), hash, 22, [{ variant: 0 }, { variant: 1, rawMarkets: { OVER_UNDER_2_5: "garbage" } }]);

    const data = await read(hash);
    expect(ids(data, "ONE_X_TWO")).toEqual(["u-bad-sum-snap-1", "u-valid-snap-1", "u-fallback-snap-2"]);
    expect(ids(data, "OVER_UNDER_2_5")).toEqual(["u-wrong-order-snap-1", "u-bad-sum-snap-1", "u-valid-snap-1", "u-fallback-snap-1"]);
    expect(ids(data, "BTTS")).toEqual(["u-wrong-order-snap-1", "u-valid-snap-1", "u-fallback-snap-2"]);
    expect(data.samples.OVER_UNDER_2_5[3]!.probabilities).toEqual(probabilitiesFor(22, 0).OVER_UNDER_2_5);
    expect(data.skippedMalformedProbabilities).toBe(3);
  });
});
