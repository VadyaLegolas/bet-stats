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
    expect(Object.keys(first).sort()).toEqual(["asOf", "calibrationConfigVersion", "identity", "markets", "retiredIdentities", "skippedMalformedProbabilities", "skippedUnusableResults", "version"]);
    expect(first.calibrationConfigVersion).toBe("calibration-config-v1");
    expect(first.retiredIdentities).toEqual([]);
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

// ---------------------------------------------------------------------------------------------------------------------
// Evaluation windows, hysteresis, rollback, supersession and concurrent runs. Each scenario group works in its own database
// (same container): the pair (modelVersion, configHash) is fixed by the forecast stack, so state cannot be isolated by identity.
// ---------------------------------------------------------------------------------------------------------------------

/** Seeds of blocks that were fixed up front by an experiment on this generator (numbers are in the plan summary). */
const BAD_SEEDS = [207, 214, 225, 230, 220] as const;
const GOOD_SEEDS = [1201, 1202, 1203] as const;
const BASE_GAMMA = 2.5;
const BLOCK_SIZE = 90;
const HOUR_MS = 3_600_000;

interface World {
  readonly name: string;
  readonly client: PrismaClient;
  readonly base: Awaited<ReturnType<typeof seedBase>>;
  readonly repository: ReturnType<typeof createPrismaCalibrationRepository>;
  nextIndex: number;
  lastAsOfMs: number;
}

const worlds: World[] = [];

/**
 * A client whose ROLLED_BACK insert fails inside the transaction: the process "dies" at the moment the rollback is written
 * (WR-03). Everything else is the real client over the real database.
 */
function crashingOnRollback(real: PrismaClient): PrismaClient {
  const crash = (): never => { throw Object.assign(new Error("simulated process kill"), { code: "PROCESS_KILLED" }); };
  return new Proxy(real, {
    get(target, property) {
      if (property !== "$transaction") return Reflect.get(target, property) as unknown;
      return (callback: unknown, options?: unknown) =>
        (target.$transaction as (callback: unknown, options?: unknown) => Promise<unknown>).call(
          target,
          (tx: Record<string, unknown>) =>
            (callback as (tx: unknown) => Promise<unknown>)(
              new Proxy(tx, {
                get(transaction, name) {
                  if (name !== "calibratorEvent") return Reflect.get(transaction, name) as unknown;
                  const events = transaction.calibratorEvent as { create: (args: { data: { type: string } }) => Promise<unknown> };
                  return new Proxy(events, {
                    get: (model, method) => (method === "create" ? (args: { data: { type: string } }) => (args.data.type === "ROLLED_BACK" ? crash() : model.create(args)) : Reflect.get(model, method) as unknown),
                  });
                },
              }),
            ),
          options,
        );
    },
  });
}
const numbers: string[] = [];

async function createWorld(name: string): Promise<World> {
  server.createDatabase(name);
  migrateDeploy(server.url(name));
  const worldClient = createPrismaClient(server.url(name));
  const world: World = { name, client: worldClient, base: await seedBase(worldClient, name), repository: createPrismaCalibrationRepository(worldClient), nextIndex: 0, lastAsOfMs: START };
  worlds.push(world);
  return world;
}

/** Appends a block of finished matches that all kick off after the previous run's asOf; returns the asOf of the next run. */
async function appendBlock(world: World, spec: { count: number; seed: number; gamma: number; identity?: CalibratorIdentity }): Promise<string> {
  const identity = spec.identity ?? DC;
  const startMs = world.nextIndex === 0 ? START : world.lastAsOfMs + HOUR_MS;
  const matches = await seedMatches(world.client, {
    prefix: `${world.name}-m`, count: spec.count, seed: spec.seed, gamma: spec.gamma, startMs, indexOffset: world.nextIndex,
    modelVersion: identity.modelVersion, configHash: identity.configHash,
    leagueId: world.base.leagueId, seasonId: world.base.seasonId, homeTeamId: world.base.homeId, awayTeamId: world.base.awayId,
  });
  world.nextIndex += spec.count;
  world.lastAsOfMs = matches[matches.length - 1]!.kickoff.getTime() + MS_DAY;
  return new Date(world.lastAsOfMs).toISOString();
}

const worldRun = (world: World, asOf: string, identity: CalibratorIdentity = DC): Promise<CalibrationJobReceipt> =>
  runCalibrationJob({ database: world.client, ...identity, asOf, log: silent });

interface JournalRow {
  readonly seq: number;
  readonly type: string;
  readonly calibratorId: string;
  readonly predecessor: string | null;
  readonly restored: string | null;
  readonly successor: string | null;
  readonly reasonCode: string;
  /** xmin: the id of the writing transaction. */
  readonly transaction: string;
}

function journal(world: World, market: ScoreMarket): JournalRow[] {
  return server
    .lines(
      `SELECT seq || '|' || type || '|' || "calibratorId" || '|' || COALESCE("predecessorCalibratorId",'-') || '|' || COALESCE("restoredCalibratorId",'-') || '|' || COALESCE("successorCalibratorId",'-') || '|' || "reasonCode" || '|' || xmin::text FROM "CalibratorEvent" WHERE market='${market}' ORDER BY seq;`,
      world.name,
    )
    .map((line) => {
      const [seq, type, calibratorId, predecessor, restored, successor, reasonCode, transaction] = line.split("|");
      const link = (value: string | undefined): string | null => (value === "-" ? null : value!);
      return { seq: Number(seq), type: type!, calibratorId: calibratorId!, predecessor: link(predecessor), restored: link(restored), successor: link(successor), reasonCode: reasonCode!, transaction: transaction! };
    });
}

const types = (rows: readonly JournalRow[]): string[] => rows.map((row) => row.type);
const eventCount = (world: World): number => Number(server.lines(`SELECT count(*) FROM "CalibratorEvent";`, world.name)[0]);

function evaluationSizes(world: World, calibratorId: string): number[] {
  return server
    .lines(`SELECT (evaluation->>'sampleSize') FROM "CalibratorEvent" WHERE type='EVALUATED' AND "calibratorId"='${calibratorId}' AND market='ONE_X_TWO' ORDER BY seq;`, world.name)
    .map(Number);
}

function note(label: string, receipt: CalibrationJobReceipt, market: ScoreMarket = "ONE_X_TWO"): void {
  const entry = receipt.markets[market];
  const delta = entry.evaluation?.delta;
  numbers.push(
    `${label}: window ${entry.evaluation?.windowSize ?? "-"} delta ${delta === null || delta === undefined ? "-" : delta.toFixed(4)} verdict ${entry.evaluation?.verdict ?? "-"} actions ${entry.actions.map((action) => action.type + (action.reasonCode ? `/${action.reasonCode}` : "")).join(",")}`,
  );
}

afterAll(async () => {
  for (const world of worlds) await world.client.$disconnect();
  if (numbers.length > 0) console.info(`calibration-job seed numbers (ONE_X_TWO)\n${numbers.join("\n")}`);
});

describe("calibration job: hysteresis, evaluation windows and rollback (regression of an over-fitted calibrator)", () => {
  let world: World;
  let calibratorC = "";
  let baseRunAsOf = "";
  const asOfs: string[] = [];

  it("starts from a promoted calibrator fitted on 1200 over-confident matches (Platt only, below the isotonic threshold)", async () => {
    world = await createWorld("regress");
    const baseAsOf = await appendBlock(world, { count: 1200, seed: 7, gamma: BASE_GAMMA });
    baseRunAsOf = baseAsOf;
    const receipt = await worldRun(world, baseAsOf);
    note("base", receipt);
    calibratorC = receipt.markets.ONE_X_TWO.active!.calibratorId;
    expect(receipt.markets.ONE_X_TWO.data).toEqual({ state: "READY", sampleSize: 1200 });
    expect((await world.repository.findCalibrator(calibratorC))?.method).toBe("PLATT");
    expect(types(journal(world, "ONE_X_TWO"))).toEqual(["PROMOTED"]);
  }, 300_000);

  it("one bad window records EVALUATED/WORSE and does not roll back; the evaluation window holds only the new block", async () => {
    asOfs.push(await appendBlock(world, { count: BLOCK_SIZE, seed: BAD_SEEDS[0], gamma: 1 }));
    const receipt = await worldRun(world, asOfs[0]!);
    note("bad 1", receipt);
    const evaluation = receipt.markets.ONE_X_TWO.evaluation!;
    expect(evaluation.windowSize).toBe(BLOCK_SIZE);
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.verdict).toBe("WORSE");
    expect(evaluation.delta!).toBeGreaterThanOrEqual(3 * 0.002);
    expect(types(journal(world, "ONE_X_TWO"))).toEqual(["PROMOTED", "EVALUATED"]);
    expect(receipt.markets.ONE_X_TWO.active?.calibratorId).toBe(calibratorC);
  }, 300_000);

  it("a second bad window is still no rollback (series of two)", async () => {
    asOfs.push(await appendBlock(world, { count: BLOCK_SIZE, seed: BAD_SEEDS[1], gamma: 1 }));
    const receipt = await worldRun(world, asOfs[1]!);
    note("bad 2", receipt);
    expect(receipt.markets.ONE_X_TWO.evaluation).toMatchObject({ windowSize: BLOCK_SIZE, eligible: true, verdict: "WORSE" });
    expect(types(journal(world, "ONE_X_TWO"))).toEqual(["PROMOTED", "EVALUATED", "EVALUATED"]);
    expect(receipt.markets.ONE_X_TWO.active?.calibratorId).toBe(calibratorC);
  }, 300_000);

  it("the third eligible WORSE window rolls back by an appended event; two concurrent runs of that day write it once and do not throw", async () => {
    asOfs.push(await appendBlock(world, { count: BLOCK_SIZE, seed: BAD_SEEDS[2], gamma: 1 }));

    // WR-03: the process dies while the rollback is written. The evaluation that completes the series must not survive on its own,
    // otherwise the retry would see an empty window and the rollback that is owed would be lost.
    const crashed = await runCalibrationJob({ database: crashingOnRollback(world.client), ...DC, asOf: asOfs[2]!, log: silent }).then(() => null, (error: unknown) => error as { code?: string });
    expect(crashed?.code).toBe("CALIBRATION_MARKET_FAILED");
    expect(types(journal(world, "ONE_X_TWO"))).toEqual(["PROMOTED", "EVALUATED", "EVALUATED"]);
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).not.toBeNull();

    const results = await Promise.allSettled([worldRun(world, asOfs[2]!), worldRun(world, asOfs[2]!)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    note("bad 3", (results[0] as PromiseFulfilledResult<CalibrationJobReceipt>).value);

    const rows = journal(world, "ONE_X_TWO");
    // The log in seq order: promotion, three evaluations (the third in the run that rolls back), one rollback.
    expect(types(rows)).toEqual(["PROMOTED", "EVALUATED", "EVALUATED", "EVALUATED", "ROLLED_BACK"]);
    expect(rows.every((row, index) => index === 0 || row.seq > rows[index - 1]!.seq)).toBe(true);
    expect(rows.at(-1)).toMatchObject({ calibratorId: calibratorC, restored: null, reasonCode: "HOLDOUT_REGRESSION" });
    // WR-03: the third evaluation and the rollback were written by one transaction (equal xmin); the earlier evaluations by their own.
    expect(rows.at(-2)!.transaction).toBe(rows.at(-1)!.transaction);
    expect(rows.at(-3)!.transaction).not.toBe(rows.at(-2)!.transaction);
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
    expect(await world.repository.hasBeenRolledBack(calibratorC)).toBe(true);
  }, 300_000);

  it("windows do not overlap and exclude training data: the three window sizes add up to the new objects only", () => {
    const sizes = evaluationSizes(world, calibratorC);
    expect(sizes).toEqual([BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE]);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(world.nextIndex - 1200);
  });

  it("a rerun of the same day after the rollback adds no events; the rolled-back calibrator is never promoted again", async () => {
    const before = eventCount(world);
    await worldRun(world, asOfs[2]!);
    expect(eventCount(world)).toBe(before);
    expect(journal(world, "ONE_X_TWO").filter((row) => row.type === "PROMOTED" && row.calibratorId === calibratorC)).toHaveLength(1);
  }, 300_000);

  it("a back-dated rerun rebuilds the rolled-back calibrator as candidate and refuses it without writing", async () => {
    // At the asOf of the very first run the fit data are exactly C's samples, so the candidate IS the rolled-back calibrator.
    const asOf = baseRunAsOf;
    const before = eventCount(world);
    const receipt = await worldRun(world, asOf);
    note("back-dated", receipt);
    expect(receipt.markets.ONE_X_TWO.candidateId).toBe(calibratorC);
    expect(receipt.markets.ONE_X_TWO.concurrentTransition).toBe(false);
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => [action.type, action.reasonCode])).toEqual([["NO_CHANGE", "CANDIDATE_PREVIOUSLY_ROLLED_BACK"]]);
    expect(eventCount(world)).toBe(before);
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
  }, 300_000);

  it("WR-01: a refit on broader data of the same regime is a new content id but is NOT promoted without proof after the rollback", async () => {
    const asOf = await appendBlock(world, { count: 400, seed: GOOD_SEEDS[0], gamma: BASE_GAMMA });
    const receipt = await worldRun(world, asOf);
    note("same regime refit", receipt);
    expect(receipt.markets.ONE_X_TWO.candidateId).not.toBe(calibratorC);
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => [action.type, action.reasonCode])).toEqual([["NO_CHANGE", "CANDIDATE_NOT_PROVEN_AFTER_ROLLBACK"]]);
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
    expect(journal(world, "ONE_X_TWO").filter((row) => row.type === "PROMOTED" && row.calibratorId === calibratorC)).toHaveLength(1);
  }, 300_000);

  it("a candidate that beats the rolled-back calibrator on outcomes known after the rollback may become active, but only as another calibrator", async () => {
    const asOf = await appendBlock(world, { count: 4000, seed: GOOD_SEEDS[1], gamma: 0.5 });
    const receipt = await worldRun(world, asOf);
    note("shifted regime", receipt);
    const active = await world.repository.findActiveCalibrator(DC, "ONE_X_TWO");
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => [action.type, action.reasonCode])).toEqual([["PROMOTE", "FIRST_PROMOTION"]]);
    expect(active).not.toBeNull();
    expect(active!.calibratorId).not.toBe(calibratorC);
    expect(journal(world, "ONE_X_TWO").filter((row) => row.type === "PROMOTED" && row.calibratorId === calibratorC)).toHaveLength(1);
    expect(active!.version).toBe(2);
  }, 300_000);
});

describe("calibration job: the series is reset by a good window", () => {
  it("bad, good, bad, bad is no rollback; one more bad window completes three in a row", async () => {
    const world = await createWorld("reset");
    const calibratorC = (await worldRun(world, await appendBlock(world, { count: 1200, seed: 7, gamma: BASE_GAMMA }))).markets.ONE_X_TWO.active!.calibratorId;

    const verdicts: Array<string | null> = [];
    const step = async (label: string, seed: number, gamma: number): Promise<CalibrationJobReceipt> => {
      const receipt = await worldRun(world, await appendBlock(world, { count: BLOCK_SIZE, seed, gamma }));
      note(label, receipt);
      verdicts.push(receipt.markets.ONE_X_TWO.evaluation?.verdict ?? null);
      return receipt;
    };

    await step("reset: bad 1", BAD_SEEDS[0], 1);
    const good = await step("reset: good", GOOD_SEEDS[1], BASE_GAMMA);
    expect(good.markets.ONE_X_TWO.evaluation!.delta!).toBeLessThanOrEqual(-0.002);
    await step("reset: bad 2", BAD_SEEDS[1], 1);
    const second = await step("reset: bad 3", BAD_SEEDS[2], 1);

    expect(verdicts).toEqual(["WORSE", "BETTER", "WORSE", "WORSE"]);
    // Two bad windows after the reset are a series of two: no rollback.
    expect(second.markets.ONE_X_TWO.actions.map((action) => action.type)).not.toContain("ROLL_BACK");
    expect(types(journal(world, "ONE_X_TWO"))).toEqual(["PROMOTED", "EVALUATED", "EVALUATED", "EVALUATED", "EVALUATED"]);
    expect((await world.repository.findActiveCalibrator(DC, "ONE_X_TWO"))?.calibratorId).toBe(calibratorC);

    const third = await step("reset: bad 4", BAD_SEEDS[3], 1);
    expect(third.markets.ONE_X_TWO.actions.map((action) => action.type)).toEqual(["RECORD_EVALUATION", "ROLL_BACK"]);
    expect(types(journal(world, "ONE_X_TWO")).at(-1)).toBe("ROLLED_BACK");
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).toBeNull();
  }, 600_000);
});

describe("calibration job: supersession needs a material win; a rollback of the successor restores the predecessor", () => {
  it("a candidate fitted on much stronger-signal data supersedes C1 in one transaction (version 2); three bad windows restore C1 as version 1", async () => {
    const world = await createWorld("supersede");
    // C1: a moderately over-confident process (gamma 1.5), 400 matches.
    const firstAsOf = await appendBlock(world, { count: 400, seed: 31, gamma: 1.5 });
    const c1Receipt = await worldRun(world, firstAsOf);
    note("c1 base", c1Receipt);
    const c1 = c1Receipt.markets.ONE_X_TWO.active!.calibratorId;

    // 1500 matches of a strongly over-confident process (gamma 3.5) arrive: the new candidate wins on its own holdout.
    const secondAsOf = await appendBlock(world, { count: 1500, seed: 33, gamma: 3.5 });
    const receipt = await worldRun(world, secondAsOf);
    note("supersession", receipt);
    const c2 = receipt.markets.ONE_X_TWO.active!.calibratorId;
    expect(c2).not.toBe(c1);
    // 1900 outcomes reach the isotonic threshold; the successor beats Platt materially on its holdout and is isotonic.
    expect((await world.repository.findCalibrator(c2))?.method).toBe("ISOTONIC");
    expect((await world.repository.findCalibrator(c1))?.method).toBe("PLATT");
    expect(receipt.markets.ONE_X_TWO.actions.map((action) => [action.type, action.reasonCode])).toEqual([["RECORD_EVALUATION", null], ["PROMOTE", "SUPERSEDES_ACTIVE"]]);

    const rows = journal(world, "ONE_X_TWO");
    expect(types(rows)).toEqual(["PROMOTED", "EVALUATED", "SUPERSEDED", "PROMOTED"]);
    const [superseded, promoted] = [rows[2]!, rows[3]!];
    expect(superseded).toMatchObject({ calibratorId: c1, successor: c2 });
    expect(promoted).toMatchObject({ calibratorId: c2, predecessor: c1, reasonCode: "SUPERSEDES_ACTIVE" });
    // One transaction: both events were written by the same transaction (equal xmin), the rest by others.
    expect(superseded.transaction).toBe(promoted.transaction);
    expect(rows[1]!.transaction).not.toBe(promoted.transaction);
    const events = await world.repository.listCalibratorEvents(c2);
    const details = events[0]!.evaluation as { holdoutBrierActive: number; holdoutBrierCalibrated: number };
    expect(details.holdoutBrierActive - details.holdoutBrierCalibrated).toBeGreaterThanOrEqual(0.002);
    numbers.push(`supersession: holdout Brier active C1 ${details.holdoutBrierActive.toFixed(4)} candidate C2 ${details.holdoutBrierCalibrated.toFixed(4)} gain ${(details.holdoutBrierActive - details.holdoutBrierCalibrated).toFixed(4)}`);
    expect(await world.repository.findActiveCalibrator(DC, "ONE_X_TWO")).toMatchObject({ calibratorId: c2, version: 2, restoreTargetId: c1 });

    // C2 is fitted on a strongly over-confident process; a calibrated process hurts it three windows in a row.
    for (const [index, seed] of ([BAD_SEEDS[0], BAD_SEEDS[1], BAD_SEEDS[2]] as const).entries()) {
      const bad = await worldRun(world, await appendBlock(world, { count: BLOCK_SIZE, seed, gamma: 1 }));
      note(`c2 bad ${index + 1}`, bad);
    }
    const restored = await world.repository.findActiveCalibrator(DC, "ONE_X_TWO");
    expect(restored).toMatchObject({ calibratorId: c1, version: 1, activatedBy: "ROLLED_BACK" });
    const last = journal(world, "ONE_X_TWO").at(-1)!;
    expect(last).toMatchObject({ type: "ROLLED_BACK", calibratorId: c2, restored: c1 });
    expect(await world.repository.hasBeenRolledBack(c2)).toBe(true);
    expect(journal(world, "ONE_X_TWO").filter((row) => row.type === "PROMOTED" && row.calibratorId === c2)).toHaveLength(1);
  }, 900_000);
});

describe("calibration job: concurrent runs of one pair", () => {
  it("three simultaneous runs for the same identity and asOf write each calibrator and event once and do not fail", async () => {
    const world = await createWorld("concurrent");
    const asOf = await appendBlock(world, { count: 600, seed: 7, gamma: BASE_GAMMA });
    const results = await Promise.allSettled([worldRun(world, asOf), worldRun(world, asOf), worldRun(world, asOf)]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(Number(server.lines(`SELECT count(*) FROM "Calibrator";`, world.name)[0])).toBe(3);
    expect(eventCount(world)).toBe(3);
    for (const market of MARKETS) {
      expect(types(journal(world, market))).toEqual(["PROMOTED"]);
      expect((await world.repository.findActiveCalibrator(DC, market))?.version).toBe(1);
    }
  }, 300_000);
});
