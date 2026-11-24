import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor, type CalibratorIdentity, type ScoreMarket } from "@bet-stats/domain";

import { runCalibrationJob, type CalibrationJobReceipt } from "../../workers/data-sync/src/jobs/calibration.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { MS_DAY, seedMatches, type GeneratedMatch } from "../helpers/calibration-job-seed.js";
import { seedBase } from "../helpers/calibration-fit-seed.js";

const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };
const V1: CalibratorIdentity = { modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const FROZEN_TABLES = ["ForecastSnapshot", "ForecastMarket", "ResultVersion", "SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement"] as const;
const START = Date.parse("2026-01-01T12:00:00.000Z");

let server: TestPostgres;
let client: PrismaClient;
let base: Awaited<ReturnType<typeof seedBase>>;
const silent = (): void => undefined;

/** Seed parameters shared with the rollback and supersession scenarios of the next task. */
interface BlockSeed {
  readonly identity: CalibratorIdentity;
  readonly prefix: string;
  readonly count: number;
  readonly seed: number;
  readonly gamma: number;
  readonly startMs: number;
  readonly indexOffset?: number;
}

async function seedBlock(block: BlockSeed): Promise<{ matches: GeneratedMatch[]; lastKickoffMs: number }> {
  const matches = await seedMatches(client, {
    prefix: block.prefix, count: block.count, seed: block.seed, gamma: block.gamma, startMs: block.startMs, indexOffset: block.indexOffset ?? 0,
    modelVersion: block.identity.modelVersion, configHash: block.identity.configHash, leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId,
  });
  return { matches, lastKickoffMs: matches[matches.length - 1]!.kickoff.getTime() };
}

const dayAfter = (ms: number): string => new Date(ms + MS_DAY).toISOString();
const run = (identity: CalibratorIdentity, asOf: string): Promise<CalibrationJobReceipt> => runCalibrationJob({ database: client, ...identity, asOf, log: silent });
const count = (table: string): number => Number(server.lines(`SELECT count(*) FROM "${table}";`)[0]);

function frozenDigests(): Record<string, string> {
  return Object.fromEntries(FROZEN_TABLES.map((table) => [table, server.psql(`SELECT count(*) || ':' || md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "${table}" t;`)]));
}

beforeAll(async () => {
  server = startPostgres(`bet-stats-calibration-job-${process.pid}`);
  migrateDeploy(server.url());
  client = createPrismaClient(server.url());
  base = await seedBase(client, "cj");
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  server?.remove();
});

describe("calibration job: one run over three markets on a real database", () => {
  let asOf1 = "";
  let first: CalibrationJobReceipt;

  it("fits, stores and promotes one calibrator per market on 600 over-confident matches", async () => {
    // 600 matches of a process whose raw forecast is over-confident (gamma 2.5): a softening calibrator beats raw.
    const { lastKickoffMs } = await seedBlock({ identity: DC, prefix: "dc", count: 600, seed: 7, gamma: 2.5, startMs: START });
    asOf1 = dayAfter(lastKickoffMs);

    first = await run(DC, asOf1);

    expect(first.version).toBe("calibration-job-receipt-v1");
    expect(first.identity).toEqual(DC);
    expect(first.asOf).toBe(asOf1);
    const repository = createPrismaCalibrationRepository(client);
    for (const market of MARKETS) {
      const receipt = first.markets[market];
      expect(receipt.eligibleSampleSize).toBe(600);
      expect(receipt.requiredSample).toBe(300);
      expect(receipt.data).toEqual({ state: "READY", sampleSize: 600 });
      expect(receipt.evaluation).toBeNull();
      expect(receipt.actions.map((action) => [action.type, action.reasonCode, action.result])).toEqual([["PROMOTE", "FIRST_PROMOTION", "WRITTEN"]]);
      const active = await repository.findActiveCalibrator(DC, market);
      expect(active?.version).toBe(1);
      expect(active?.calibratorId).toBe(receipt.candidateId);
      expect(receipt.active).toEqual({ calibratorId: active!.calibratorId, version: 1 });
      expect(active!.calibrator.fittedAsOf).toBe(asOf1);
    }
    expect(count("Calibrator")).toBe(3);
    expect(count("CalibratorEvent")).toBe(3);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE type='PROMOTED' AND "predecessorCalibratorId" IS NULL;`)).toEqual(["3"]);
  }, 300_000);

  it("returns a closed JSON receipt without secrets or connection strings", () => {
    const text = JSON.stringify(first);
    expect(JSON.parse(text)).toEqual(first);
    expect(text).not.toMatch(/postgres(ql)?:\/\/|password|secret|token|apikey/i);
    expect(Object.keys(first).sort()).toEqual(["asOf", "calibrationConfigVersion", "identity", "markets", "skippedMalformedProbabilities", "skippedUnusableResults", "version"]);
    expect(first.calibrationConfigVersion).toBe("calibration-config-v1");
  });

  it("a repeat of the same run adds neither calibrators nor events", async () => {
    const again = await run(DC, asOf1);
    expect(count("Calibrator")).toBe(3);
    expect(count("CalibratorEvent")).toBe(3);
    for (const market of MARKETS) {
      expect(again.markets[market].active).toEqual(first.markets[market].active);
      expect(again.markets[market].actions.map((action) => action.type)).toEqual(["NO_CHANGE"]);
      expect(again.markets[market].actions[0]!.reasonCode).toBe("CANDIDATE_IS_ACTIVE");
    }
  }, 120_000);

  it("the next day without new data writes nothing: same content id, no evaluation event, no rollback", async () => {
    const nextDay = new Date(Date.parse(asOf1) + MS_DAY).toISOString();
    const receipt = await run(DC, nextDay);
    expect(count("Calibrator")).toBe(3);
    expect(count("CalibratorEvent")).toBe(3);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE type IN ('EVALUATED','ROLLED_BACK');`)).toEqual(["0"]);
    for (const market of MARKETS) {
      expect(receipt.markets[market].evaluation).toBeNull();
      expect(receipt.markets[market].candidateId).toBe(first.markets[market].candidateId);
      expect(receipt.markets[market].active).toEqual(first.markets[market].active);
    }
  }, 120_000);

  it("a pair with another model version on this database holds no data: INSUFFICIENT_DATA with current 0 and no rows", async () => {
    const calibrators = count("Calibrator");
    const events = count("CalibratorEvent");
    const receipt = await run(V1, asOf1);
    for (const market of MARKETS) {
      expect(receipt.markets[market].data).toEqual({ state: "INSUFFICIENT_DATA", required: 300, current: 0 });
      expect(receipt.markets[market].actions.map((action) => action.reasonCode)).toEqual(["NO_CANDIDATE"]);
      expect(receipt.markets[market].active).toBeNull();
    }
    expect(count("Calibrator")).toBe(calibrators);
    expect(count("CalibratorEvent")).toBe(events);
  }, 120_000);

  it("299 outcomes are not enough: INSUFFICIENT_DATA with required 300 and current 299, and no rows", async () => {
    const calibrators = count("Calibrator");
    const events = count("CalibratorEvent");
    const { lastKickoffMs } = await seedBlock({ identity: V1, prefix: "v1", count: 299, seed: 21, gamma: 2.5, startMs: START });
    const receipt = await run(V1, dayAfter(lastKickoffMs));
    for (const market of MARKETS) {
      expect(receipt.markets[market].eligibleSampleSize).toBe(299);
      expect(receipt.markets[market].data).toEqual({ state: "INSUFFICIENT_DATA", required: 300, current: 299 });
      expect(receipt.markets[market].candidateId).toBeNull();
      expect(receipt.markets[market].active).toBeNull();
    }
    expect(count("Calibrator")).toBe(calibrators);
    expect(count("CalibratorEvent")).toBe(events);
    // One more outcome reaches the threshold: the identities stay independent and V1 becomes fittable on its own data.
    await seedBlock({ identity: V1, prefix: "v1", count: 1, seed: 22, gamma: 2.5, startMs: lastKickoffMs + 4 * 3_600_000, indexOffset: 299 });
    const enough = await run(V1, dayAfter(lastKickoffMs + 4 * 3_600_000));
    expect(enough.markets.ONE_X_TWO.data).toEqual({ state: "READY", sampleSize: 300 });
  }, 300_000);

  it("refuses an invalid identity before any database access", async () => {
    let touched = 0;
    const database = new Proxy({} as PrismaClient, { get: () => { touched += 1; return undefined; } });
    const invalid: Array<[string, string]> = [
      ["unknown-model-v9", DC.configHash],
      [DC.modelVersion, `sha256:${"0".repeat(64)}`],
      [DC.modelVersion, V1.configHash],
      [V1.modelVersion, DC.configHash],
    ];
    for (const [modelVersion, configHash] of invalid) {
      await expect(runCalibrationJob({ database, modelVersion, configHash, asOf: asOf1, log: silent }), `${modelVersion} ${configHash}`).rejects.toMatchObject({ code: "CALIBRATION_IDENTITY_INVALID" });
    }
    await expect(runCalibrationJob({ database, ...DC, asOf: "not a date", log: silent })).rejects.toMatchObject({ code: "INVALID_CALIBRATION_JOB" });
    expect(touched).toBe(0);
  });

  it("a run never writes to the frozen forecast, settlement, score and value tables", async () => {
    const before = frozenDigests();
    await run(DC, new Date(Date.parse(asOf1) + 3 * MS_DAY).toISOString());
    expect(frozenDigests()).toEqual(before);
    for (const table of ["SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement"]) expect(before[table]).toMatch(/^0:/);
    expect(Number(before.ForecastSnapshot!.split(":")[0])).toBeGreaterThan(0);
  }, 120_000);
});
