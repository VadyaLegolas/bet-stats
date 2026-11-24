import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor, type CalibratedForecastResponseDto, type CalibratorIdentity, type ForecastResponseDto, type ScoreMarket } from "@bet-stats/domain";

import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";
import { runCalibrationJob } from "../../workers/data-sync/src/jobs/calibration.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { seedBase } from "../helpers/calibration-fit-seed.js";
import { MS_DAY, MS_HOUR, seedMatches } from "../helpers/calibration-job-seed.js";
import { makeForecastDto } from "../helpers/forecast-dto.js";

/**
 * The whole loop on real services: data -> daily job -> calibrator -> API response -> three bad windows -> rollback ->
 * API back to raw probabilities. Seed numbers (gamma 2.5 base of 1200 matches, gamma 1 blocks of 90 with seeds 207, 214,
 * 225) are the ones recorded in 12-05-SUMMARY.md, where they give ONE_X_TWO deltas of +0.0305, +0.0354 and +0.0312
 * without any supersession.
 */
const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };
const V1: CalibratorIdentity = { modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const FROZEN_TABLES = ["ForecastSnapshot", "ForecastMarket", "SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement"] as const;
const BAD_SEEDS = [207, 214, 225] as const;
const START = Date.parse("2026-01-01T12:00:00.000Z");
const FUTURE_KICKOFF = Date.now() + 10 * MS_DAY;
const PRE_MATCH_CUTOFF = new Date(FUTURE_KICKOFF - MS_HOUR).toISOString();

let server: TestPostgres;
let client: PrismaClient;
let service: ForecastsService;
let base: Awaited<ReturnType<typeof seedBase>>;
let nextIndex = 0;
let lastAsOfMs = START;
const savedDatabaseUrl = process.env.DATABASE_URL;

async function storeForecast(fixtureId: string, dto: ForecastResponseDto): Promise<void> {
  await client.forecastSnapshot.create({
    data: {
      id: dto.id, fixtureId, kind: dto.kind, state: "ISSUED", origin: "PRODUCTION", revision: dto.revision, cutoff: new Date(dto.cutoff),
      modelVersion: dto.modelVersion, modelHash: dto.modelHash, configVersion: dto.configVersion, configHash: dto.configHash, inputHash: dto.inputHash,
      evidenceFingerprint: dto.evidenceFingerprint, sourceRefs: [] as never, probabilities: dto.probabilities as never, confidence: dto.confidence as never,
      assumptions: dto.assumptions as never, receipt: dto as never, issuedAt: new Date(dto.issuedAt),
    },
  });
}

/** Appends finished matches after the previous run's asOf and returns the asOf of the next run. */
async function appendBlock(spec: { count: number; seed: number; gamma: number }): Promise<string> {
  const startMs = nextIndex === 0 ? START : lastAsOfMs + MS_HOUR;
  const matches = await seedMatches(client, {
    prefix: "loop", count: spec.count, seed: spec.seed, gamma: spec.gamma, startMs, indexOffset: nextIndex,
    modelVersion: DC.modelVersion, configHash: DC.configHash, leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId,
  });
  nextIndex += spec.count;
  lastAsOfMs = matches[matches.length - 1]!.kickoff.getTime() + MS_DAY;
  return new Date(lastAsOfMs).toISOString();
}

function digests(): Record<string, string> {
  return Object.fromEntries(FROZEN_TABLES.map((table) => [table, server.psql(`SELECT count(*) || ':' || md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "${table}" t;`)]));
}

const forecastsOf = async (fixtureId: string): Promise<readonly CalibratedForecastResponseDto[]> => service.list(fixtureId);
const preMatch = async (fixtureId: string): Promise<CalibratedForecastResponseDto> => (await forecastsOf(fixtureId)).find((entry) => entry.kind === "PRE_MATCH")!;
const stateOf = (forecast: CalibratedForecastResponseDto, market: ScoreMarket) => forecast.marketCalibration[market].calibration;

/** One day of the loop: the seeded block is data; the job run and the API calls after it must not touch the frozen tables. */
async function runDay(asOf: string): Promise<void> {
  const before = digests();
  await runCalibrationJob({ database: client, ...DC, asOf, log: () => undefined });
  await preMatch("lp-a");
  await preMatch("lp-b");
  expect(digests()).toEqual(before);
}

beforeAll(async () => {
  server = startPostgres(`bet-stats-calibration-loop-${process.pid}`);
  migrateDeploy(server.url());
  client = createPrismaClient(server.url());
  base = await seedBase(client, "lp");
  for (const id of ["lp-a", "lp-b"]) {
    await client.fixture.create({ data: { id, leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId, kickoffUtc: new Date(FUTURE_KICKOFF), status: "SCHEDULED" } });
  }
  const issuedAt = new Date(Date.now() - MS_HOUR).toISOString();
  await storeForecast("lp-a", makeForecastDto(DC, { id: "lp-a-pre", fixtureId: "lp-a", cutoff: PRE_MATCH_CUTOFF, issuedAt }));
  await storeForecast("lp-b", makeForecastDto(V1, { id: "lp-b-pre", fixtureId: "lp-b", cutoff: PRE_MATCH_CUTOFF, issuedAt }));
  process.env.DATABASE_URL = server.url();
  // These tests assert that a promotion or rollback is visible at once: the read cache (WR-06) is off for them.
  process.env.CALIBRATION_STATE_CACHE_TTL_MS = "0";
  service = new ForecastsService();
  delete process.env.CALIBRATION_STATE_CACHE_TTL_MS;
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
}, 300_000);

afterAll(async () => {
  await service?.onModuleDestroy();
  await client?.$disconnect();
  server?.remove();
});

describe("full calibration loop: data, daily job, API, rollback", () => {
  it("before any run the API says there is not enough data (no outcomes yet) for both identities", async () => {
    for (const fixture of ["lp-a", "lp-b"]) {
      const forecast = await preMatch(fixture);
      for (const market of MARKETS) expect(stateOf(forecast, market)).toEqual({ state: "INSUFFICIENT_DATA", sampleSize: 0, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" });
    }
  });

  it("the first run fits and promotes: the API serves CALIBRATED version 1 on all three markets; V1 is never calibrated", async () => {
    const asOf = await appendBlock({ count: 1200, seed: 7, gamma: 2.5 });
    await runDay(asOf);
    const forecast = await preMatch("lp-a");
    for (const market of MARKETS) {
      const state = stateOf(forecast, market);
      expect(state.state, market).toBe("CALIBRATED");
      expect(state.calibratorVersion).toBe(1);
      expect(state.sampleSize).toBeGreaterThanOrEqual(60);
      expect(forecast.marketCalibration[market].rawProbabilities).toEqual(forecast.probabilities[market].map((event) => event.probability));
    }
    const other = await preMatch("lp-b");
    for (const market of MARKETS) expect(stateOf(other, market).state).not.toBe("CALIBRATED");
    expect(stateOf(other, "ONE_X_TWO")).toMatchObject({ state: "INSUFFICIENT_DATA", sampleSize: 0 });
  }, 300_000);

  it("one and two bad windows leave the calibrator in place; the third rolls it back and the API returns to raw probabilities", async () => {
    const seen: string[] = [];
    for (const [index, seed] of BAD_SEEDS.entries()) {
      const asOf = await appendBlock({ count: 90, seed, gamma: 1 });
      await runDay(asOf);
      const state = stateOf(await preMatch("lp-a"), "ONE_X_TWO");
      seen.push(state.state === "CALIBRATED" ? `CALIBRATED v${state.calibratorVersion}` : `${state.state}/${state.reasonCode}`);
      if (index < 2) expect(state.state, `after bad window ${index + 1}`).toBe("CALIBRATED");
    }
    expect(seen).toEqual(["CALIBRATED v1", "CALIBRATED v1", "UNAVAILABLE/NO_PROMOTED_CALIBRATOR"]);

    const events = server.lines(`SELECT type FROM "CalibratorEvent" WHERE market='ONE_X_TWO' ORDER BY seq;`);
    expect(events).toEqual(["PROMOTED", "EVALUATED", "EVALUATED", "EVALUATED", "ROLLED_BACK"]);
    const raw = (await preMatch("lp-a")).marketCalibration.ONE_X_TWO.rawProbabilities;
    expect(raw).toEqual((await preMatch("lp-a")).probabilities.ONE_X_TWO.map((event) => event.probability));
  }, 600_000);

  it("the V1 forecast stayed uncalibrated through every step and no frozen table changed during the whole loop", async () => {
    const forecast = await preMatch("lp-b");
    for (const market of MARKETS) expect(stateOf(forecast, market).state).not.toBe("CALIBRATED");
    // The V1 identity never has a calibrator or an event of its own.
    expect(server.lines(`SELECT count(*) FROM "Calibrator" WHERE "modelVersion"='${V1.modelVersion}';`)).toEqual(["0"]);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent" WHERE "modelVersion"='${V1.modelVersion}';`)).toEqual(["0"]);
    // No settlement, score or value row was ever written by the loop.
    for (const table of ["SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement"]) expect(digests()[table]).toMatch(/^0:/);
  });
});
