import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, createPrismaForecastRepository, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor, parseMarketCalibrationMap, type CalibratorIdentity, type ForecastResponseDto, type ScoreMarket } from "@bet-stats/domain";

import { ForecastsController } from "../../apps/api/src/modules/forecasts/forecasts.controller.js";
import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";
import { compareValue } from "../../apps/api/src/modules/value/value.service.js";
import { makeFitted, migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { DAY_MS, HOUR_MS, seedBase, seedFixture } from "../helpers/calibration-fit-seed.js";
import { seedMatches } from "../helpers/calibration-job-seed.js";
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

/** Calibrated probabilities served for fixture A while the first DC calibrator (version 1) was active. */
let c1Calibrated: Record<ScoreMarket, number[]> | null = null;

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
  // These tests assert that a promotion or rollback is visible at once: the read cache (WR-06) is off for them.
  process.env.CALIBRATION_STATE_CACHE_TTL_MS = "0";
  service = new ForecastsService();
  delete process.env.CALIBRATION_STATE_CACHE_TTL_MS;
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
    c1Calibrated = Object.fromEntries(MARKETS.map((market) => [market, [...(pre.marketCalibration[market].calibration.calibratedProbabilities ?? [])]])) as Record<ScoreMarket, number[]>;
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

// ---------------------------------------------------------------------------------------------------------------------
// Task 2: identity refusal through the service, generate, rollback visibility, soft failure, read-only guarantees, raw value.
// ---------------------------------------------------------------------------------------------------------------------

const GUARDED_TABLES = ["ForecastSnapshot", "ForecastMarket", "SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement", "Calibrator", "CalibratorEvent"] as const;

function digests(): Record<string, string> {
  return Object.fromEntries(GUARDED_TABLES.map((table) => [table, server.psql(`SELECT count(*) || ':' || md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "${table}" t;`)]));
}

const valueOdds = {
  fixtureId: "fa-a", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "Book", capturedAt: PRE_MATCH_CUTOFF,
  schemaVersion: "manual-odds-v1", normalizationVersion: "multiplicative-v1", replacementOfOddsSnapshotId: null, submittedAt: PRE_MATCH_CUTOFF, overround: "0.01",
  selections: [
    { selection: "HOME", decimalOdds: "2.4", impliedProbability: "0.416667", noVigProbability: "0.41" },
    { selection: "DRAW", decimalOdds: "3.4", impliedProbability: "0.294118", noVigProbability: "0.29" },
    { selection: "AWAY", decimalOdds: "3.6", impliedProbability: "0.277778", noVigProbability: "0.27" },
  ],
};

/** The value decision for the stored forecast of fixture A; `source` chooses the raw stored DTO or the enriched API object. */
async function valueDecision(source: "raw" | "enriched"): Promise<Record<string, unknown>> {
  const raw = (await createPrismaForecastRepository(client).findIssued!("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF))!;
  const forecast = source === "raw" ? raw : await service.get("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF);
  let inserted: Record<string, unknown> | null = null;
  const repository = {
    findForecast: async () => forecast as never,
    findOdds: async () => valueOdds as never,
    findReceipt: async () => null,
    insertReceipt: async (receipt: unknown) => { inserted = receipt as Record<string, unknown>; return receipt as never; },
  };
  const receipt = (await compareValue({ fixtureId: "fa-a", forecastSnapshotId: raw.id, oddsSnapshotId: "odds-1", market: "ONE_X_TWO", selection: "HOME" }, repository)) as unknown as Record<string, unknown>;
  expect(inserted).toBe(receipt);
  const { createdAt: _createdAt, ...stable } = receipt;
  return stable;
}

/** Event ids are per day: every transition below uses its own day. */
const day = (offset: number): string => new Date(Date.UTC(2027, 2, 10 + offset)).toISOString();

describe("forecast API: identity refusal, generate, rollback visibility and soft failure", () => {
  it("through the service, a reader that hands a calibrator of another identity yields MISMATCH, never CALIBRATED", async () => {
    const original = service.calibration;
    try {
      const foreign = Object.fromEntries(MARKETS.map((market) => [market, {
        active: { calibratorId: `calibrator_${"2".repeat(64)}`, version: 4, calibrator: makeFitted({ market, identity: DC, seed: 650 }), activationSeq: 1, activatedBy: "PROMOTED" as const, activatedAt: new Date().toISOString(), restoreTargetId: null },
        eligibleSampleSize: 400,
      }])) as never;
      service.calibration = { ...original, readState: async () => foreign };
      const v1 = byId(await service.list("fa-b"), "fa-b-pre");
      for (const market of MARKETS) {
        expect(v1.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATOR_MODEL_MISMATCH" });
        expect(v1.marketCalibration[market].rawProbabilities).toEqual(rawOf(v1, market));
      }
      // The DC forecast is served by the same reader and is the only one that may be calibrated by it.
      expect(byId(await service.list("fa-a"), "fa-a-pre").marketCalibration.ONE_X_TWO.calibration.state).toBe("CALIBRATED");
    } finally {
      service.calibration = original;
    }
  });

  it("generate returns the freshly issued forecast with the same enrichment", async () => {
    const projection = (teamId: string) => {
      const source = { fixtureId: "history-1", effectiveAt: "2026-09-01T12:00:00.000Z", observedAt: "2026-09-01T12:05:00.000Z", sourceUpdatedAt: null, payloadHash: "hash", payloadBytes: 10 };
      const cutoff = "2026-09-06T12:00:00.000Z";
      const component = (kind: string, value: unknown, unit: string, sampleSize: number) => ({ kind, value, unit, sampleSize, limitation: null, sourceRefs: [source] });
      return {
        teamId, requestedAsOf: cutoff, resolvedAsOfUtc: cutoff, cutoffBoundary: { observedAt: cutoff }, state: "COMPLETE", freshness: "FRESH", buildId: `${teamId}-build`, publishedAt: cutoff,
        receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
        coverage: { eligibleFixtureCount: 5, earliestKickoff: source.effectiveAt, latestKickoff: source.effectiveAt },
        components: {
          goalRates: component("goalRates", { for: 1.6, against: 1.1 }, "goals-per-match", 5), elo: component("elo", 1510, "elo-rating", 5), form5: component("form5", 1.8, "points-per-match", 5),
          homeStrength: component("homeStrength", 1.8, "points-per-match", 5), awayStrength: component("awayStrength", 1.2, "points-per-match", 5), restDays: component("restDays", 7, "days", 1),
        },
      };
    };
    const repository = {
      assertEligible: async () => undefined,
      findFixture: async () => ({ id: "fixture-1", homeTeamId: "home", awayTeamId: "away", leagueId: "league-1", kickoffUtc: "2026-09-07T12:00:00.000Z", canonicalIdentityResolved: true }),
      findEvidence: async (teamId: string) => projection(teamId),
      findOfficialLineup: async () => null,
      findDixonColesParameters: async () => ({ rho: 0, provenance: { rho: 0, convention: "tau-1x2-v1" as const, method: "insufficient-sample-zero" as const, windowFrom: "2024-01-01T00:00:00.000Z", windowTo: "2026-09-06T12:00:00.000Z", sampleSize: 0, tauMin: 1 } }),
      publish: async (draft: unknown) => draft,
    };
    const internals = service as unknown as { repository: unknown };
    const original = internals.repository;
    internals.repository = repository;
    try {
      const issued = await service.generate({ fixtureId: "fixture-1", kind: "PRE_MATCH", cutoff: "2026-09-06T12:00:00.000Z" });
      expect(issued.modelVersion).toBe(DC.modelVersion);
      expect(issued.configHash).toBe(DC.configHash);
      expect(Object.keys(issued.marketCalibration)).toEqual([...MARKETS]);
      for (const market of MARKETS) {
        expect(issued.marketCalibration[market].rawProbabilities).toEqual(rawOf(issued, market));
        // The promoted DC calibrator (version 1) of the earlier test is the one that answers for a DC forecast.
        expect(issued.marketCalibration[market].calibration).toMatchObject({ state: "CALIBRATED", calibratorVersion: 1 });
      }
    } finally {
      internals.repository = original;
    }
  }, 60_000);

  it("shows a rollback: a successor supersedes C1, rolling it back shows C1 as version 1 again, rolling C1 back leaves raw probabilities only", async () => {
    const repository = createPrismaCalibrationRepository(client);
    const readPre = async () => byId(await service.list("fa-a"), "fa-a-pre");
    const valueWithC1 = await valueDecision("raw");
    expect(await valueDecision("enriched")).toEqual(valueWithC1);

    const c1 = new Map<ScoreMarket, string>();
    const c2 = new Map<ScoreMarket, string>();
    for (const [index, market] of MARKETS.entries()) {
      c1.set(market, (await repository.findActiveCalibrator(DC, market))!.calibratorId);
      c2.set(market, (await repository.persistCalibrator(makeFitted({ identity: DC, market, seed: 701 + index }))).calibratorId);
      await repository.promoteCalibrator({ identity: DC, market, calibratorId: c2.get(market)!, predecessorCalibratorId: c1.get(market)!, asOf: day(1), reasonCode: "SUPERSEDES_ACTIVE", evaluation: {} });
    }
    const superseded = await readPre();
    for (const market of MARKETS) expect(superseded.marketCalibration[market].calibration).toMatchObject({ state: "CALIBRATED", calibratorVersion: 2 });
    // Value does not move when the calibrator changes.
    expect(await valueDecision("raw")).toEqual(valueWithC1);

    for (const market of MARKETS) {
      await repository.rollbackCalibrator({ identity: DC, market, calibratorId: c2.get(market)!, restoredCalibratorId: c1.get(market)!, asOf: day(2), reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });
    }
    const restored = await readPre();
    for (const market of MARKETS) {
      expect(restored.marketCalibration[market].calibration).toMatchObject({ state: "CALIBRATED", calibratorVersion: 1 });
      expect(restored.marketCalibration[market].calibration.calibratedProbabilities).toEqual(c1Calibrated![market]);
    }
    expect(await valueDecision("raw")).toEqual(valueWithC1);

    for (const market of MARKETS) {
      await repository.rollbackCalibrator({ identity: DC, market, calibratorId: c1.get(market)!, restoredCalibratorId: null, asOf: day(3), reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });
    }
    // No calibrator and 20 outcomes: the honest "not enough data" state, with the counts.
    const bare = await readPre();
    for (const market of MARKETS) {
      expect(bare.marketCalibration[market].calibration).toEqual({ state: "INSUFFICIENT_DATA", sampleSize: 20, requiredSample: 300, reasonCode: "INSUFFICIENT_SETTLED_OUTCOMES" });
      expect(bare.marketCalibration[market].rawProbabilities).toEqual(rawOf(bare, market));
    }
    expect(await valueDecision("raw")).toEqual(valueWithC1);
    expect(await valueDecision("enriched")).toEqual(valueWithC1);

    // 300 or more outcomes without a promoted calibrator: UNAVAILABLE/NO_PROMOTED_CALIBRATOR, not a fitted layer.
    await seedMatches(client, {
      prefix: "fa-bulk", count: 285, seed: 91, gamma: 1, startMs: Date.now() - 300 * DAY_MS, modelVersion: DC.modelVersion, configHash: DC.configHash,
      leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId,
    });
    const plenty = await readPre();
    for (const market of MARKETS) expect(plenty.marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "NO_PROMOTED_CALIBRATOR" });
    expect(await valueDecision("raw")).toEqual(valueWithC1);
  }, 300_000);

  it("a failing reader is soft: the whole forecast is returned, every market UNAVAILABLE/CALIBRATION_READ_FAILED, nothing is thrown", async () => {
    const original = service.calibration;
    try {
      service.calibration = { ...original, readState: async () => { throw new Error("calibration store down"); } };
      const list = await service.list("fa-a");
      expect(list).toHaveLength(2);
      const stored = await client.forecastSnapshot.findUniqueOrThrow({ where: { id: "fa-a-pre" } });
      const { marketCalibration, ...rest } = byId(list, "fa-a-pre");
      expect(JSON.stringify(rest)).toBe(JSON.stringify(stored.receipt));
      for (const market of MARKETS) {
        expect(marketCalibration[market].calibration).toEqual({ state: "UNAVAILABLE", reasonCode: "CALIBRATION_READ_FAILED" });
        expect(marketCalibration[market].rawProbabilities).toEqual(rawOf(rest as unknown as ForecastResponseDto, market));
      }
      const exact = await service.get("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF);
      expect(exact.marketCalibration.BTTS.calibration.reasonCode).toBe("CALIBRATION_READ_FAILED");
      expect(JSON.stringify(list)).not.toContain("calibration store down");
    } finally {
      service.calibration = original;
    }
  });

  it("reads never write: the six frozen tables and both calibration tables are unchanged by list and get", async () => {
    const before = digests();
    for (let round = 0; round < 3; round += 1) {
      await service.list("fa-a");
      await service.list("fa-b");
      await service.get("fa-a", "PRE_MATCH", PRE_MATCH_CUTOFF);
      await controller.get("fa-b", {});
    }
    expect(digests()).toEqual(before);
    for (const table of GUARDED_TABLES) expect(before[table], table).toMatch(/^\d+:[0-9a-f]{32}$/);
    expect(GUARDED_TABLES).toHaveLength(8);
  });

  it("the strict marketCalibration parser accepts every response of this suite", async () => {
    for (const fixtureId of ["fa-a", "fa-b"]) {
      for (const entry of await service.list(fixtureId)) expect(() => parseMarketCalibrationMap(entry.marketCalibration)).not.toThrow();
    }
  });
});
