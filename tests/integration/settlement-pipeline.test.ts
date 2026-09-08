import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createSettlementPipelineService, SETTLEMENT_PIPELINE_POLICY_HASH, type PrismaClient } from "@bet-stats/database";
import { createSettlementJobHandler } from "../../workers/data-sync/src/jobs/settlement.js";
import { createSettlementJobId, type SettlementJobData } from "../../workers/data-sync/src/queues/index.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-settlement-pipeline-${process.pid}`;
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

async function seed(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('pipeline-league','League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('pipeline-season','pipeline-league','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('pipeline-home','Home','home','GB',now()),('pipeline-away','Away','away','GB',now());
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('pipeline-fixture','pipeline-league','pipeline-season','pipeline-home','pipeline-away','2026-09-10T18:00:00Z','FINISHED',now()),('terminal-fixture','pipeline-league','pipeline-season','pipeline-home','pipeline-away','2026-09-11T18:00:00Z','POSTPONED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('pipeline-obs-1','test','RESULTS','one','2026-09-10T20:00:00Z','pipeline-hash-1','{}',2),
      ('pipeline-obs-2','test','RESULTS','two','2026-09-10T20:01:00Z','pipeline-hash-2','{}',2),
      ('terminal-obs','test','RESULTS','terminal','2026-09-11T20:00:00Z','terminal-hash','{}',2);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ('pipeline-result-1','pipeline-fixture','pipeline-obs-1','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1),
      ('terminal-result','terminal-fixture','terminal-obs','2026-09-11T18:00:00Z','2026-09-11T20:00:00Z',NULL,NULL,'POSTPONED',1);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES
      ('pipeline-result-2','pipeline-fixture','pipeline-obs-2','2026-09-10T18:00:00Z','2026-09-10T20:01:00Z',1,2,'FINISHED',2,'pipeline-result-1');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('pipeline-forecast','pipeline-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{}','2026-09-10T17:00:01Z'),
      ('terminal-forecast','terminal-fixture','PRE_MATCH','ISSUED',1,'2026-09-11T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','terminal-input','terminal-evidence','[]','{}','{}','[]','{}','2026-09-11T17:00:01Z');
    INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES
      ('pipeline-market-1x2','pipeline-forecast','ONE_X_TWO','[{"selection":"HOME","probability":0.5},{"selection":"DRAW","probability":0.3},{"selection":"AWAY","probability":0.2}]'),
      ('pipeline-market-ou','pipeline-forecast','OVER_UNDER_2_5','[{"selection":"OVER_2_5","probability":0.6},{"selection":"UNDER_2_5","probability":0.4}]'),
      ('pipeline-market-btts','pipeline-forecast','BTTS','[{"selection":"YES","probability":0.7},{"selection":"NO","probability":0.3}]');
    INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('pipeline-odds','pipeline-fixture','ONE_X_TWO','odds-hash','BOOKMAKER_BACK','{"selections":[{"selection":"HOME","decimalOdds":"2.4","noVigProbability":"0.45"},{"selection":"AWAY","decimalOdds":"4","noVigProbability":"0.25"}]}','2026-09-10T16:00:00Z');
    INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('pipeline-odds-home','pipeline-odds','HOME','2.4'),('pipeline-odds-away','pipeline-odds','AWAY','4');
    INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES
      ('pipeline-value','pipeline-fixture','ONE_X_TWO','pipeline-forecast','pipeline-odds','VALUE_CANDIDATE','HOME','0.5','0.45','2','0.05','0.2','{"market":"ONE_X_TWO","selection":"HOME","decimalOdds":"2.4","modelProbability":"0.5","noVigProbability":"0.45"}'),
      ('pipeline-no-value','pipeline-fixture','ONE_X_TWO','pipeline-forecast','pipeline-odds','NO_VALUE','AWAY','0.2','0.25','5','-0.05','-0.2','{"market":"ONE_X_TWO","selection":"AWAY","decimalOdds":"4","modelProbability":"0.2","noVigProbability":"0.25"}');
  `);
}

describe("settlement pipeline", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    await seed();
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* owned cleanup */ } });

  it("completed result pipeline persists the exact full receipt chain", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const result = await service.process({ fixtureId: "pipeline-fixture", resultVersionId: "pipeline-result-1", forecastSnapshotId: "pipeline-forecast", policyVersion: "settlement-policy-v1", correlationId: "corr-completed" });
    expect(result).toMatchObject({ reason: "RESULT_FINISHED", duplicate: false });
    expect(result.forecastScoreIds).toHaveLength(3);
    expect(result.valueSettlementIds).toHaveLength(1);
    expect(await prisma.settlementReceipt.count()).toBe(1);
    expect(await prisma.forecastScore.count()).toBe(3);
    expect(await prisma.valueSettlement.count()).toBe(1);
  });

  it("completed result pipeline stops cleanly for pending states", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const result = await service.process({ fixtureId: "terminal-fixture", resultVersionId: "terminal-result", forecastSnapshotId: "terminal-forecast", policyVersion: "settlement-policy-v1", correlationId: "corr-terminal" });
    expect(result).toMatchObject({ reason: "RESULT_POSTPONED", forecastScoreIds: [], valueSettlementIds: [] });
  });

  it("delivery uses deterministic identity and rejects cross-fixture payload before mutation", async () => {
    const payload: SettlementJobData = { fixtureId: "pipeline-fixture", resultVersionId: "pipeline-result-1", forecastSnapshotId: "pipeline-forecast", policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId: "corr-delivery" };
    expect(createSettlementJobId(payload)).toBe(`settlement:pipeline-result-1:${SETTLEMENT_PIPELINE_POLICY_HASH}:pipeline-forecast`);
    const handler = createSettlementJobHandler({ service: createSettlementPipelineService({ database: prisma }) });
    await expect(handler({ ...payload, fixtureId: "terminal-fixture" })).rejects.toThrow(/FIXTURE_SCOPE_MISMATCH/);
    expect(await prisma.settlementReceipt.count({ where: { resultVersionId: "pipeline-result-1" } })).toBe(0);
  });

  it("retry after a forced delivery failure converges without duplicate facts", async () => {
    const payload: SettlementJobData = { fixtureId: "pipeline-fixture", resultVersionId: "pipeline-result-1", forecastSnapshotId: "pipeline-forecast", policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId: "corr-retry" };
    let attempts = 0;
    const handler = createSettlementJobHandler({
      service: createSettlementPipelineService({ database: prisma }),
      beforeProcess: () => { attempts += 1; if (attempts === 1) throw new Error("FORCED_DELIVERY_FAILURE"); },
    });
    await expect(handler(payload)).rejects.toThrow("FORCED_DELIVERY_FAILURE");
    const retried = await handler(payload);
    expect(retried.duplicate).toBe(false);
    expect((await handler(payload)).duplicate).toBe(true);
    expect(await prisma.forecastScore.count()).toBe(3);
    expect(await prisma.valueSettlement.count()).toBe(1);
  });

  it("corrected result pipeline rolls back partial failure and appends superseding leaf facts", async () => {
    let fail = true;
    const correctionService = createSettlementPipelineService({
      database: prisma,
      afterSettlement: () => { if (fail) { fail = false; throw new Error("FORCED_PARTIAL_FAILURE"); } },
    });
    const correction = { fixtureId: "pipeline-fixture", resultVersionId: "pipeline-result-2", forecastSnapshotId: "pipeline-forecast", policyVersion: "settlement-policy-v1", correlationId: "corr-correction" } as const;
    await expect(correctionService.process(correction)).rejects.toThrow("FORCED_PARTIAL_FAILURE");
    expect(await prisma.settlementReceipt.count()).toBe(0);

    const base = { ...correction, resultVersionId: "pipeline-result-1", correlationId: "corr-original" };
    await Promise.all([correctionService.process(correction), correctionService.process(base)]);
    await correctionService.process(correction);

    const settlements = await prisma.settlementReceipt.findMany({ orderBy: { revision: "asc" } });
    expect(settlements).toHaveLength(2);
    expect(settlements[1]!.supersedesSettlementReceiptId).toBe(settlements[0]!.id);
    const scores = await prisma.forecastScore.findMany({ orderBy: { createdAt: "asc" } });
    expect(scores).toHaveLength(6);
    expect(scores.filter((score) => score.supersedesForecastScoreId)).toHaveLength(3);
    const values = await prisma.valueSettlement.findMany({ orderBy: { createdAt: "asc" } });
    expect(values).toHaveLength(2);
    expect(values[1]!.supersedesValueSettlementId).toBe(values[0]!.id);
    expect(values.map((value) => value.profitUnits)).toEqual(["1.4", "-1"]);
    expect(await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM current_forecast_scores`)).toEqual([{ count: 3n }]);
  });
});
