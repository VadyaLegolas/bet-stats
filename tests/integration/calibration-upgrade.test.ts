import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaCalibrationRepository, createPrismaClient, type CalibrationRepository, type PrismaClient } from "@bet-stats/database";
import { scoreCategoricalForecast } from "@bet-stats/domain";

import { makeFitted, migrationsRoot, startPostgres, TEST_IDENTITY, type TestPostgres } from "../helpers/calibration-db.js";

const FIRST_NEW = "20261125_phase12_calibrator_tables";
const NEW_MIGRATIONS = [FIRST_NEW, "20261125_phase12_calibrator_transitions"];
/** Frozen evidence tables: neither the migrations nor the repository may change a byte of them (D-08). */
const FROZEN_TABLES = ["ForecastSnapshot", "ForecastMarket", "ResultVersion", "SettlementReceipt", "ForecastScore", "ValueReceipt", "ValueSettlement"] as const;

let server: TestPostgres;
let client: PrismaClient;
let repository: CalibrationRepository;

interface TableState {
  readonly rows: string;
  readonly digest: string;
  readonly relfilenode: string;
}

/** Row count, md5 over every row's full text (ordered by id) and the physical file of each frozen table. */
function snapshot(): Record<string, TableState> {
  const state: Record<string, TableState> = {};
  for (const table of FROZEN_TABLES) {
    const [rows = "", digest = ""] = server.lines(`SELECT count(*) || E'\\n' || COALESCE(md5(string_agg(t::text, '|' ORDER BY t.id)), 'empty') FROM "${table}" t;`);
    const relfilenode = server.lines(`SELECT relfilenode::text FROM pg_class WHERE relname='${table}' AND relkind='r';`)[0] ?? "";
    state[table] = { rows, digest, relfilenode };
  }
  return state;
}

const probabilities = [
  { selection: "HOME", probability: 0.6 },
  { selection: "DRAW", probability: 0.2 },
  { selection: "AWAY", probability: 0.2 },
];

const oddsSelections = [
  { selection: "HOME", decimalOdds: "2.4", noVigProbability: "0.45" },
  { selection: "DRAW", decimalOdds: "3", noVigProbability: "0.3" },
  { selection: "AWAY", decimalOdds: "4", noVigProbability: "0.25" },
];

const valueReceipt = {
  market: "ONE_X_TWO",
  selection: "HOME",
  modelProbability: "0.6",
  noVigProbability: "0.45",
  decimalOdds: "2.4",
  fairOdds: "1.66666666666666666667",
  edge: "0.15",
  expectedValue: "0.44",
};

/** One complete evidence chain: result, forecast, odds, value receipt, settlement, score and value settlement. */
async function seedFrozenEvidence(): Promise<void> {
  await client.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('up-league','League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('up-season','up-league','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('up-home','Home','home','GB',now()),('up-away','Away','away','GB',now());
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('up-fixture','up-league','up-season','up-home','up-away','2026-09-10T18:00:00Z','FINISHED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('up-obs','test','RESULTS','up-ext','2026-09-10T20:00:00Z','up-hash','{}',2);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('up-result','up-fixture','up-obs','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('up-forecast','up-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','up-model','forecast-config-v1','up-config','up-input','up-evidence','[]','{}','{}','[]','{"officialLineupObservationId":null}','2026-09-10T17:00:01Z');
    INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('up-market','up-forecast','ONE_X_TWO','${JSON.stringify(probabilities)}'::jsonb);
    INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('up-odds','up-fixture','ONE_X_TWO','up-odds-input','BOOKMAKER_BACK','${JSON.stringify({ selections: oddsSelections })}'::jsonb,'2026-09-10T16:00:00Z');
    INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('up-odds-selection','up-odds','HOME','2.4');
    INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ('up-value-receipt','up-fixture','ONE_X_TWO','up-forecast','up-odds','VALUE_CANDIDATE','HOME','${valueReceipt.modelProbability}','${valueReceipt.noVigProbability}','${valueReceipt.fairOdds}','${valueReceipt.edge}','${valueReceipt.expectedValue}','${JSON.stringify(valueReceipt)}'::jsonb);
    INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ('up-closing','up-fixture','ONE_X_TWO','HOME','2','DECIMAL','BOOKMAKER_BACK','MARKET_CLOSE','2026-09-10T17:59:00Z');
  `);

  const settlement = { fixtureId: "up-fixture", resultVersionId: "up-result", forecastSnapshotId: "up-forecast", policyVersion: "settlement-policy-v1", policyHash: "up-policy", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
  const settled = await client.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT * FROM persist_settlement_receipt('up-settlement','up-fixture','up-result','up-forecast','settlement-policy-v1','up-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$1::jsonb,'2026-09-10T20:05:00Z',NULL,NULL)`,
    JSON.stringify(settlement),
  );
  expect(settled).toHaveLength(1);

  const score = scoreCategoricalForecast({ settlementReceiptId: "up-settlement", forecastSnapshotId: "up-forecast", market: "ONE_X_TWO", outcome: "HOME", probabilities });
  const scoreReceipt = { ...score, leagueId: "up-league", modelVersion: "poisson-v1", kickoffUtc: "2026-09-10T18:00:00.000Z" };
  const scored = await client.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT * FROM persist_forecast_score('up-score','up-settlement','ONE_X_TWO','HOME',$1,$2,$3,$4,$5::jsonb,$6::jsonb,NULL)`,
    score.rawChosenProbability, score.clippedChosenProbability, score.brierScore, score.logLoss, JSON.stringify(score.classOrder), JSON.stringify(scoreReceipt),
  );
  expect(scored).toHaveLength(1);

  const valueSettled = await client.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT * FROM persist_value_settlement($1,$2,$3,$4,$5,$6)`,
    "up-value-settlement", "up-settlement", "up-value-receipt", "up-odds-selection", "up-closing", null,
  );
  expect(valueSettled).toHaveLength(1);
}

describe("calibrator migrations on a populated database", () => {
  let before: Record<string, TableState>;

  beforeAll(async () => {
    server = startPostgres(`bet-stats-calibration-upgrade-${process.pid}`);
    const earlier = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().filter((name) => name < FIRST_NEW);
    expect(earlier.length).toBeGreaterThan(0);
    // Prisma applies every migration in its own transaction; some of them require one.
    for (const directory of earlier) server.psql(`BEGIN;\n${readFileSync(resolve(migrationsRoot, directory, "migration.sql"), "utf8")}\nCOMMIT;`);
    expect(server.lines(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('Calibrator','CalibratorEvent');`)).toEqual(["0"]);

    client = createPrismaClient(server.url());
    repository = createPrismaCalibrationRepository(client);
    await seedFrozenEvidence();
    before = snapshot();
  }, 300_000);

  afterAll(async () => {
    await client?.$disconnect();
    server?.remove();
  });

  it("seeded a populated database: every frozen table has data", () => {
    for (const table of FROZEN_TABLES) {
      expect(Number(before[table]!.rows), table).toBeGreaterThan(0);
      expect(before[table]!.digest, table).toMatch(/^[0-9a-f]{32}$/);
      expect(before[table]!.relfilenode, table).toMatch(/^\d+$/);
    }
  });

  it("applies the two new migrations to the populated copy without touching frozen rows or rewriting their files", () => {
    for (const directory of NEW_MIGRATIONS) server.psql(`BEGIN;\n${readFileSync(resolve(migrationsRoot, directory, "migration.sql"), "utf8")}\nCOMMIT;`);

    expect(server.lines(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('Calibrator','CalibratorEvent') ORDER BY 1;`)).toEqual(["Calibrator", "CalibratorEvent"]);
    expect(server.lines(`SELECT count(*) FROM "Calibrator";`)).toEqual(["0"]);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent";`)).toEqual(["0"]);
    // Row counts, row content (md5) and the physical relation files (relfilenode: no table rewrite) are unchanged.
    expect(snapshot()).toEqual(before);
  });

  it("leaves the frozen tables byte-identical after persisting, promoting, superseding, evaluating and rolling back calibrators", async () => {
    const first = makeFitted({ seed: 301 });
    const second = makeFitted({ seed: 302 });
    const { calibratorId: a } = await repository.persistCalibrator(first);
    const { calibratorId: b } = await repository.persistCalibrator(second);
    const at = (day: number): string => new Date(Date.UTC(2027, 2, day)).toISOString();
    const scope = { identity: TEST_IDENTITY, market: first.market };

    await repository.promoteCalibrator({ ...scope, calibratorId: a, predecessorCalibratorId: null, asOf: at(2), reasonCode: "FIRST_PROMOTION", evaluation: {} });
    await repository.promoteCalibrator({ ...scope, calibratorId: b, predecessorCalibratorId: a, asOf: at(3), reasonCode: "SUPERSEDES_ACTIVE", evaluation: {} });
    await repository.recordEvaluation({ ...scope, calibratorId: b, asOf: at(4), reasonCode: "EVALUATION", evaluation: { sampleSize: 40, eligible: true, verdict: "WORSE", brierRaw: 0.5, brierCalibrated: 0.52, delta: 0.02 } });
    await repository.rollbackCalibrator({ ...scope, calibratorId: b, restoredCalibratorId: a, asOf: at(5), reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });
    expect((await repository.findActiveCalibrator(TEST_IDENTITY, first.market))?.calibratorId).toBe(a);
    await repository.rollbackCalibrator({ ...scope, calibratorId: a, restoredCalibratorId: null, asOf: at(6), reasonCode: "HOLDOUT_REGRESSION", evaluation: { consecutiveWorse: 3 } });
    expect(await repository.findActiveCalibrator(TEST_IDENTITY, first.market)).toBeNull();

    // PROMOTED(a), SUPERSEDED(a), PROMOTED(b), EVALUATED(b), ROLLED_BACK(b), ROLLED_BACK(a).
    expect(server.lines(`SELECT count(*) FROM "Calibrator";`)).toEqual(["2"]);
    expect(server.lines(`SELECT count(*) FROM "CalibratorEvent";`)).toEqual(["6"]);
    expect(snapshot()).toEqual(before);
  });
});

/** The migrations only add objects: nothing from an earlier migration is dropped or altered. */
describe("migration set additivity", () => {
  it("the two new migrations contain no statement that alters or removes existing objects or rows", () => {
    for (const directory of NEW_MIGRATIONS) {
      const text = readFileSync(resolve(migrationsRoot, directory, "migration.sql"), "utf8")
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(text, directory).not.toMatch(/\b(DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TRIGGER|VIEW)|TRUNCATE|UPDATE\s+"|DELETE\s+FROM|INSERT\s+INTO|ALTER\s+TABLE\s+"(?!Calibrator))/i);
    }
  });
});
