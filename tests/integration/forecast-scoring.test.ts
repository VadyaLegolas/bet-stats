import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { SCORE_FORMULA_HASH, SCORE_FORMULA_VERSION, scoreCategoricalForecast } from "@bet-stats/domain";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-forecast-score-${process.pid}`;
let prisma: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

const probabilities = [
  { selection: "HOME", probability: 0.5 },
  { selection: "DRAW", probability: 0.3 },
  { selection: "AWAY", probability: 0.2 },
];

async function settle(id: string, resultVersionId: string, supersedes: string | null = null) {
  const receipt = { fixtureId: "score-fixture", resultVersionId, forecastSnapshotId: "score-forecast", policyVersion: "settlement-policy-v1", policyHash: "score-policy-hash", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT * FROM persist_settlement_receipt($1,'score-fixture',$2,'score-forecast','settlement-policy-v1','score-policy-hash','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$3::jsonb,'2026-09-10T20:05:00Z',$4,NULL)`,
    id, resultVersionId, JSON.stringify(receipt), supersedes,
  );
  return rows[0]!;
}

async function persistScore(id: string, settlementReceiptId: string, outcome: string, supersedes: string | null = null) {
  const score = scoreCategoricalForecast({ settlementReceiptId, forecastSnapshotId: "score-forecast", market: "ONE_X_TWO", outcome, probabilities });
  const receipt = { ...score, leagueId: "score-league", modelVersion: "poisson-v1", kickoffUtc: "2026-09-10T18:00:00.000Z" };
  return prisma.$queryRawUnsafe<Array<{ id: string; supersedesForecastScoreId: string | null }>>(
    `SELECT * FROM persist_forecast_score($1,$2,'ONE_X_TWO',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
    id, settlementReceiptId, outcome, score.rawChosenProbability, score.clippedChosenProbability,
    score.brierScore, score.logLoss, JSON.stringify(score.classOrder), JSON.stringify(receipt), supersedes,
  );
}

describe("immutable forecast scoring facts", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('score-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('score-season','score-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('score-home','Home','home','GB',now()),('score-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('score-fixture','score-league','score-season','score-home','score-away','2026-09-10T18:00:00Z','FINISHED',now());
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('score-obs-1','test','RESULTS','fixture','2026-09-10T20:00:00Z','score-hash-1','{}',2),('score-obs-2','test','RESULTS','fixture','2026-09-10T20:01:00Z','score-hash-2','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('score-result-1','score-fixture','score-obs-1','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('score-result-2','score-fixture','score-obs-2','2026-09-10T18:00:00Z','2026-09-10T20:01:00Z',1,1,'FINISHED',2,'score-result-1');
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('score-forecast','score-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{"officialLineupObservationId":null}','2026-09-10T17:00:01Z');
      INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('score-market','score-forecast','ONE_X_TWO','${JSON.stringify(probabilities)}'::jsonb);
    `);
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* owned cleanup */ } });

  it("converges replays and aggregates only current correction leaves", async () => {
    const settlement1 = await settle("score-settlement-1", "score-result-1");
    const first = (await persistScore("score-fact-1", settlement1.id, "HOME"))[0]!;
    expect((await persistScore("score-fact-retry", settlement1.id, "HOME"))[0]).toEqual(first);

    const settlement2 = await settle("score-settlement-2", "score-result-2", settlement1.id);
    const second = (await persistScore("score-fact-2", settlement2.id, "DRAW", first.id))[0]!;
    expect(second.supersedesForecastScoreId).toBe(first.id);

    const cohorts = await prisma.$queryRawUnsafe<Array<{ modelVersion: string; leagueId: string; market: string; fixtureCount: bigint; scoreCount: bigint; eventCount: bigint; meanBrier: number; meanLogLoss: number }>>(`
      SELECT "modelVersion", "leagueId", market, COUNT(DISTINCT "fixtureId") AS "fixtureCount", COUNT(*) AS "scoreCount", SUM("eventCount") AS "eventCount", AVG("brierScore") AS "meanBrier", AVG("logLoss") AS "meanLogLoss"
      FROM current_forecast_scores
      WHERE "kickoffUtc" >= '2026-09-01T00:00:00Z' AND "kickoffUtc" < '2026-10-01T00:00:00Z'
      GROUP BY "modelVersion", "leagueId", market
    `);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]).toMatchObject({ modelVersion: "poisson-v1", leagueId: "score-league", market: "ONE_X_TWO", fixtureCount: 1n, scoreCount: 1n, eventCount: 1n });
    expect(cohorts[0]!.meanBrier).toBeCloseTo(0.98);
    expect(cohorts[0]!.meanLogLoss).toBeCloseTo(-Math.log(0.3));
  });

  it("rejects mutation and inconsistent copied metrics", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastScore" SET "brierScore"=0 WHERE id='score-fact-1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastScore" WHERE id='score-fact-1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ForecastScore" (id,"settlementReceiptId","forecastSnapshotId","fixtureId","leagueId",market,"modelVersion","kickoffUtc",outcome,probabilities,"classOrder","rawChosenProbability","clippedChosenProbability","brierScore","logLoss","eventCount","formulaVersion","formulaHash",receipt) SELECT 'forged',"settlementReceiptId","forecastSnapshotId","fixtureId","leagueId",market,"modelVersion","kickoffUtc",outcome,probabilities,"classOrder","rawChosenProbability","clippedChosenProbability",0,"logLoss","eventCount","formulaVersion","formulaHash",receipt FROM "ForecastScore" WHERE id='score-fact-2'`)).rejects.toThrow(/metric|receipt|formula/i);
  });

  it("persists the exact versioned formula identity", async () => {
    const row = await prisma.$queryRawUnsafe<Array<{ formulaVersion: string; formulaHash: string }>>(`SELECT "formulaVersion", "formulaHash" FROM "ForecastScore" WHERE id='score-fact-2'`);
    expect(row[0]).toEqual({ formulaVersion: SCORE_FORMULA_VERSION, formulaHash: SCORE_FORMULA_HASH });
  });
});
