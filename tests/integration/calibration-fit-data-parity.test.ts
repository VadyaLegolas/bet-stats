import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, createSettlementPipelineService, readCalibrationFitData, readCalibrationState, type PrismaClient } from "@bet-stats/database";
import { SCORE_CLASS_ORDER } from "@bet-stats/domain";

import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { DAY_MS, DC_CONFIG_HASH, DC_VERSION, HOUR_MS, MARKETS, seedBase, seedFixture } from "../helpers/calibration-fit-seed.js";

/**
 * Home win / draw / away win; totals of exactly 2 (1-1, 0-2) and 3 (2-1, 3-0) goals; BTTS yes (2-1, 1-1, 2-2) and no (0-2, 3-0, 1-0).
 */
const SCORES: ReadonlyArray<readonly [number, number]> = [[2, 1], [1, 1], [0, 2], [3, 0], [1, 0], [2, 2]];
const BASE_KICKOFF = Date.parse("2026-10-01T18:00:00.000Z");
const ASOF = "2026-12-01T00:00:00.000Z";
const FROZEN_TABLES = ["ForecastSnapshot", "ForecastMarket", "ResultVersion", "SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement", "Calibrator", "CalibratorEvent"] as const;

let server: TestPostgres;
let client: PrismaClient;

const fixtureId = (index: number): string => `pp-${index}`;
const snapshotId = (index: number): string => `${fixtureId(index)}-snap-1`;

function digests(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const table of FROZEN_TABLES) {
    result[table] = server.psql(`SELECT count(*) || ':' || md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM "${table}" t;`);
  }
  return result;
}

beforeAll(async () => {
  server = startPostgres(`bet-stats-calibration-parity-${process.pid}`);
  migrateDeploy(server.url());
  client = createPrismaClient(server.url());
  const base = await seedBase(client, "pp");
  const service = createSettlementPipelineService({ database: client });
  // Strictly one match after the other (known unrelated SQLSTATE 40001 on parallel settlement of different fixtures).
  for (const [index, [homeGoals, awayGoals]] of SCORES.entries()) {
    const kickoff = new Date(BASE_KICKOFF + index * DAY_MS);
    await seedFixture(client, base, {
      id: fixtureId(index),
      kickoff,
      index,
      snapshots: [{ modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH }],
      results: [{ id: `${fixtureId(index)}-r1`, observedAt: new Date(kickoff.getTime() + 2 * HOUR_MS), effectiveAt: kickoff, homeGoals, awayGoals }],
    });
    await service.process({ fixtureId: fixtureId(index), resultVersionId: `${fixtureId(index)}-r1`, forecastSnapshotId: snapshotId(index), policyVersion: "settlement-policy-v1", correlationId: `parity-${index}` });
  }
}, 300_000);

afterAll(async () => {
  await client?.$disconnect();
  server?.remove();
});

describe("calibration outcomes versus the real settlement pipeline", () => {
  it("the pipeline scored every market of every match (precondition of the comparison)", () => {
    expect(server.lines(`SELECT count(*) FROM "ForecastScore";`)).toEqual([String(SCORES.length * MARKETS.length)]);
  });

  it("outcomeIndex names the same class as ForecastScore.outcome for every match and market", async () => {
    const data = await readCalibrationFitData(client, { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF });
    const stored = await client.forecastScore.findMany({ select: { forecastSnapshotId: true, market: true, outcome: true } });
    expect(stored).toHaveLength(SCORES.length * MARKETS.length);

    let compared = 0;
    for (const market of MARKETS) {
      expect(data.samples[market]).toHaveLength(SCORES.length);
      for (const sample of data.samples[market]) {
        const score = stored.find((row) => row.forecastSnapshotId === sample.sampleId && row.market === market);
        expect(score, `${sample.sampleId} ${market}`).toBeDefined();
        expect(SCORE_CLASS_ORDER[market][sample.outcomeIndex], `${sample.sampleId} ${market}`).toBe(score!.outcome);
        compared += 1;
      }
    }
    expect(compared).toBe(SCORES.length * MARKETS.length);
    // The six scores really exercise every class of the three markets.
    for (const market of MARKETS) {
      expect(new Set(data.samples[market].map((sample) => sample.outcomeIndex)).size).toBe(SCORE_CLASS_ORDER[market].length);
    }
  });

  it("reads never write: frozen tables and calibrator tables are byte-identical before and after both reads", async () => {
    const before = digests();
    const identity = { modelVersion: DC_VERSION, configHash: DC_CONFIG_HASH, asOf: ASOF } as const;
    await readCalibrationFitData(client, identity);
    await readCalibrationState(client, identity);
    await readCalibrationFitData(client, { ...identity, asOf: "2026-10-03T00:00:00.000Z" });
    expect(digests()).toEqual(before);
    for (const table of FROZEN_TABLES) expect(before[table], table).toMatch(/^\d+:[0-9a-f]{32}$/);
    expect(before.Calibrator).toMatch(/^0:/);
    expect(before.CalibratorEvent).toMatch(/^0:/);
    expect(Number(before.ForecastScore!.split(":")[0])).toBe(SCORES.length * MARKETS.length);
  });
});
