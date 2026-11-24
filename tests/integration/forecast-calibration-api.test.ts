import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor, type CalibratorIdentity, type ForecastResponseDto, type ScoreMarket } from "@bet-stats/domain";

import { ForecastsController } from "../../apps/api/src/modules/forecasts/forecasts.controller.js";
import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";
import { makeFitted, migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { DAY_MS, HOUR_MS, seedBase, seedFixture } from "../helpers/calibration-fit-seed.js";
import { makeForecastDto } from "../helpers/forecast-dto.js";

const DC: CalibratorIdentity = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") };
const V1: CalibratorIdentity = { modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") };
const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];
const CALIBRATION_KEYS = ["state", "calibratedProbabilities", "calibratorVersion", "method", "sampleSize", "requiredSample", "holdoutBrierRaw", "holdoutBrierCalibrated", "reasonCode"];

let server: TestPostgres;
let client: PrismaClient;
let service: ForecastsService;
let controller: ForecastsController;
let base: Awaited<ReturnType<typeof seedBase>>;
const savedEnvironment = { DATABASE_URL: process.env.DATABASE_URL };
const FUTURE_KICKOFF = Date.now() + 10 * DAY_MS;

const PRE_MATCH_CUTOFF = new Date(FUTURE_KICKOFF - HOUR_MS).toISOString();
const INITIAL_CUTOFF = new Date(FUTURE_KICKOFF - 2 * DAY_MS).toISOString();

/** Stores a complete forecast the way the publisher does: the DTO is the snapshot's `receipt`. */
async function storeForecast(fixtureId: string, dto: ForecastResponseDto, origin: "PRODUCTION" | "BACKTEST" = "PRODUCTION"): Promise<void> {
  await client.forecastSnapshot.create({
    data: {
      id: dto.id, fixtureId, kind: dto.kind, state: "ISSUED", origin, revision: dto.revision, cutoff: new Date(dto.cutoff),
      modelVersion: dto.modelVersion, modelHash: dto.modelHash, configVersion: dto.configVersion, configHash: dto.configHash, inputHash: dto.inputHash,
      evidenceFingerprint: dto.evidenceFingerprint, sourceRefs: [] as never, probabilities: dto.probabilities as never, confidence: dto.confidence as never,
      assumptions: dto.assumptions as never, receipt: dto as never, issuedAt: new Date(dto.issuedAt),
    },
  });
}

async function seedFutureFixture(id: string): Promise<void> {
  await client.fixture.create({ data: { id, leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId, kickoffUtc: new Date(FUTURE_KICKOFF), status: "SCHEDULED" } });
}

const rawOf = (forecast: ForecastResponseDto, market: ScoreMarket): number[] => forecast.probabilities[market].map((event) => event.probability);

beforeAll(async () => {
  server = startPostgres(`bet-stats-forecast-calibration-${process.pid}`);
  migrateDeploy(server.url());
  client = createPrismaClient(server.url());
  base = await seedBase(client, "fa");

  // 20 settled matches of the DC identity: the census of eligible outcomes (per market) is 20.
  const now = Date.now();
  for (let index = 0; index < 20; index += 1) {
    const kickoff = new Date(now - (40 - index) * DAY_MS);
    await seedFixture(client, base, {
      id: `fa-history-${index}`, kickoff, index,
      snapshots: [{ modelVersion: DC.modelVersion, configHash: DC.configHash }],
      results: [{ id: `fa-history-${index}-r1`, observedAt: new Date(kickoff.getTime() + 2 * HOUR_MS), homeGoals: index % 4, awayGoals: (index + 1) % 3 }],
    });
  }
  // Fixture A: a DC forecast of two kinds. Fixture B: a V1 forecast.
  await seedFutureFixture("fa-a");
  await storeForecast("fa-a", makeForecastDto(DC, { id: "fa-a-pre", fixtureId: "fa-a", cutoff: PRE_MATCH_CUTOFF, issuedAt: new Date(now - HOUR_MS).toISOString() }));
  await storeForecast("fa-a", makeForecastDto(DC, { id: "fa-a-initial", fixtureId: "fa-a", kind: "INITIAL", cutoff: INITIAL_CUTOFF, issuedAt: new Date(now - 2 * HOUR_MS).toISOString() }));
  await seedFutureFixture("fa-b");
  await storeForecast("fa-b", makeForecastDto(V1, { id: "fa-b-pre", fixtureId: "fa-b", cutoff: PRE_MATCH_CUTOFF, issuedAt: new Date(now - HOUR_MS).toISOString() }));

  // The service reads DATABASE_URL in its constructor: point it at this container only for the construction.
  process.env.DATABASE_URL = server.url();
  service = new ForecastsService();
  if (savedEnvironment.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedEnvironment.DATABASE_URL;
  controller = new ForecastsController(service);
}, 300_000);

afterAll(async () => {
  await service?.onModuleDestroy();
  await client?.$disconnect();
  server?.remove();
});

const byId = <T extends { id: string }>(items: readonly T[], id: string): T => {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

describe("forecast API: per-market calibration state computed at read time", () => {
  it("without a calibrator the list carries INSUFFICIENT_DATA with the current and the required count; raw probabilities equal the stored ones", async () => {
    const list = await service.list("fa-a");
    expect(list.map((entry) => entry.id).sort()).toEqual(["fa-a-initial", "fa-a-pre"]);
    const pre = byId(list, "fa-a-pre");
    expect(Object.keys(pre.marketCalibration)).toEqual([...MARKETS]);
    for (const market of MARKETS) {
      expect(pre.marketCalibration[market].calibration).toEqual({ state: "INSUFFICIENT_DATA", sampleSize: 20, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" });
      expect(pre.marketCalibration[market].rawProbabilities).toEqual(rawOf(pre, market));
    }
  });

  it("the INITIAL forecast of the same match is not covered by calibration, its raw probabilities are intact", async () => {
    const initial = byId(await service.list("fa-a"), "fa-a-initial");
    for (const market of MARKETS) {
      expect(initial.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "KIND_NOT_COVERED" });
      expect(initial.marketCalibration[market].rawProbabilities).toEqual(rawOf(initial, market));
    }
  });

  it("the exact request returns the same enrichment as the list", async () => {
    const fromList = byId(await service.list("fa-a"), "fa-a-pre");
    const exact = await service.get("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF);
    expect(exact).toEqual(fromList);
  });

  it("keeps every stored field byte-identical and adds exactly one key", async () => {
    const stored = await client.forecastSnapshot.findUniqueOrThrow({ where: { id: "fa-a-pre" } });
    const { marketCalibration, ...rest } = await service.get("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF);
    expect(Object.keys(marketCalibration)).toEqual([...MARKETS]);
    expect(JSON.stringify(rest)).toBe(JSON.stringify(stored.receipt));
    expect(JSON.stringify(rest.probabilities)).toBe(JSON.stringify((stored.receipt as unknown as ForecastResponseDto).probabilities));
    expect(Object.keys({ ...rest, marketCalibration }).sort()).toEqual([...Object.keys(stored.receipt as object), "marketCalibration"].sort());
  });

  it("with a promoted DC calibrator the DC forecast is CALIBRATED and the V1 forecast never inherits it", async () => {
    const repository = createPrismaCalibrationRepository(client);
    const fitted = new Map<ScoreMarket, ReturnType<typeof makeFitted>>();
    for (const [index, market] of MARKETS.entries()) {
      const calibrator = makeFitted({ identity: DC, market, seed: 601 + index });
      fitted.set(market, calibrator);
      const { calibratorId } = await repository.persistCalibrator(calibrator);
      await repository.promoteCalibrator({ identity: DC, market, calibratorId, predecessorCalibratorId: null, asOf: "2027-03-02T00:00:00.000Z", reasonCode: "FIRST_PROMOTION", evaluation: {} });
    }

    const pre = byId(await service.list("fa-a"), "fa-a-pre");
    for (const market of MARKETS) {
      const view = pre.marketCalibration[market];
      expect(view.calibration.state).toBe("CALIBRATED");
      expect(view.calibration.calibratorVersion).toBe(1);
      expect(view.calibration.sampleSize).toBe(fitted.get(market)!.holdoutSampleSize);
      expect(view.calibration.method).toBe(fitted.get(market)!.method);
      expect(view.calibration.calibratedProbabilities).toHaveLength(rawOf(pre, market).length);
      expect(view.calibration.calibratedProbabilities!.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(view.rawProbabilities).toEqual(rawOf(pre, market));
      for (const key of Object.keys(view.calibration)) expect(CALIBRATION_KEYS).toContain(key);
    }
    expect(JSON.stringify(pre.marketCalibration)).not.toMatch(/calibrator_[0-9a-f]{64}|scalers|parameters|samplesDigest|sha256:/);

    // The INITIAL forecast stays uncovered; the V1 forecast has no calibrator and no outcomes of its own.
    expect(byId(await service.list("fa-a"), "fa-a-initial").marketCalibration.ONE_X_TWO.calibration.reasonCode).toBe("KIND_NOT_COVERED");
    const v1 = byId(await service.list("fa-b"), "fa-b-pre");
    for (const market of MARKETS) {
      expect(v1.marketCalibration[market].calibration).toEqual({ state: "INSUFFICIENT_DATA", sampleSize: 0, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" });
      expect(v1.marketCalibration[market].rawProbabilities).toEqual(rawOf(v1, market));
    }
  }, 120_000);

  it("the controller returns the enriched shapes and keeps the no-store header on GET and POST", async () => {
    const list = (await controller.get("fa-a", {})) as readonly { id: string; marketCalibration: object }[];
    expect(list.every((entry) => "marketCalibration" in entry)).toBe(true);
    const exact = (await controller.get("fa-a", { kind: "PRE_MATCH", cutoff: PRE_MATCH_CUTOFF })) as { id: string; marketCalibration: object };
    expect(exact.id).toBe("fa-a-pre");
    expect("marketCalibration" in exact).toBe(true);
    const header = (method: unknown) => (Reflect.getMetadata("__headers__", method as object) as Array<{ name: string; value: string }>).map((entry) => `${entry.name}: ${entry.value}`);
    expect(header(ForecastsController.prototype.get)).toEqual(["Cache-Control: private, no-store, max-age=0"]);
    expect(header(ForecastsController.prototype.generate)).toEqual(["Cache-Control: private, no-store, max-age=0"]);
  });
});
