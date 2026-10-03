import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  compareBacktestPlans,
  createPrismaBacktestReceiptRepository,
  createPrismaClient,
  createPrismaForecastRepository,
  createSettlementPipelineService,
  resolveHistoricalResultGraph,
  type PrismaClient,
} from "@bet-stats/database";
import { currentForecastConfigHash } from "@bet-stats/domain";
import {
  admitBacktestPlan,
  admitPersistEnqueueBacktest,
  reconcileBacktestDelivery,
  runBacktestPlan,
  type BacktestPlanReceipt,
} from "../../workers/data-sync/src/jobs/backtests.js";
import { createBacktestQueue, createBacktestWorker } from "../../workers/data-sync/src/queues/index.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-backtest-pg-${process.pid}`;
const redisName = `bet-stats-backtest-redis-${process.pid}`;
const prefix = `backtest-${process.pid}`;
let database: PrismaClient;
let redisUrl: string;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitFor(container: string, command: string[]): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, ...command); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  }
  throw new Error(`${container} did not become ready`);
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for backtest worker");
}

async function seed(): Promise<void> {
  await database.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('bt-league','Backtest League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('bt-season','bt-league','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('bt-home','Home','home','GB',now()),('bt-away','Away','away','GB',now());
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('bt-fixture','bt-league','bt-season','bt-home','bt-away','2026-09-10T18:00:00Z','FINISHED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('bt-obs-v1','test','RESULTS','bt-fixture','2026-09-10T20:00:00Z','bt-v1','{}',2),
      ('bt-obs-v2','test','RESULTS','bt-fixture','2026-09-12T08:00:00Z','bt-v2','{}',2);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ('bt-result-v1','bt-fixture','bt-obs-v1','2026-09-10T20:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES
      ('bt-result-v2','bt-fixture','bt-obs-v2','2026-09-12T08:00:00Z','2026-09-12T08:00:00Z',1,2,'FINISHED',2,'bt-result-v1');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('bt-forecast','bt-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-ensemble-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{}','2026-09-10T17:00:01Z');
    INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES
      ('bt-market-1x2','bt-forecast','ONE_X_TWO','[{"selection":"HOME","probability":0.5},{"selection":"DRAW","probability":0.3},{"selection":"AWAY","probability":0.2}]');
  `);
}

function plan(id: string, configHash = currentForecastConfigHash(), evaluationAsOf = "2026-09-11T00:00:00.000Z"): BacktestPlanReceipt {
  return admitBacktestPlan({
    id,
    version: "rolling-origin-v1",
    modelVersion: "poisson-ensemble-v1",
    configHash,
    rangeFrom: "2026-09-01T00:00:00.000Z",
    rangeTo: "2026-09-10T17:00:00.000Z",
    concurrency: 1,
    windows: [{ id: `${id}-window`, fixtureId: "bt-fixture", trainingEndsAt: "2026-09-09T00:00:00.000Z", forecastCutoff: "2026-09-10T17:00:00.000Z", evaluationAsOf }],
  });
}

describe("production rolling-origin backtests", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    docker("run", "--detach", "--name", redisName, "--publish", "127.0.0.1::6379", "redis:8-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    waitFor(redisName, ["redis-cli", "ping"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const redisPort = docker("port", redisName, "6379/tcp").split(":").at(-1)!;
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    redisUrl = `redis://127.0.0.1:${redisPort}`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    await seed();
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    for (const name of [postgresName, redisName]) try { docker("rm", "--force", name); } catch { /* exact owned cleanup */ }
  }, 30_000);

  it("persists and scores one exact rolling-origin window", async () => {
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const first = plan("bt-plan-first");
    await receipts.createPlan(first, "bt-first");
    const evaluation = await receipts.evaluateWindow(first.windows[0]!.id, { fixtureId: "bt-fixture", forecastSnapshotId: "bt-forecast", evaluationAsOf: first.windows[0]!.evaluationAsOf, correlationId: "bt-first" });
    expect(evaluation).toMatchObject({ resultVersionId: "bt-result-v1", scoreIds: [expect.stringMatching(/^score_/)] });

    const revised = await receipts.evaluateWindow(first.windows[0]!.id, { fixtureId: "bt-fixture", forecastSnapshotId: "bt-forecast", evaluationAsOf: "2026-09-13T00:00:00.000Z", correlationId: "bt-correction" });
    expect(revised).toMatchObject({ resultVersionId: "bt-result-v2", scoreIds: [expect.stringMatching(/^score_/)] });
    const history = await database.backtestEvaluation.findMany({ where: { windowId: first.windows[0]!.id }, orderBy: { revision: "asc" } });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ supersedesEvaluationId: history[0]!.id, isCurrent: true });
    expect(history[0]).toMatchObject({ resultVersionId: "bt-result-v1", isCurrent: false });
    expect(resolveHistoricalResultGraph(await database.resultVersion.findMany({ where: { fixtureId: "bt-fixture" } }), "bt-fixture", new Date(first.windows[0]!.evaluationAsOf)).id).toBe("bt-result-v1");
  });

  it("shared production forecast repository", async () => {
    const repository = createPrismaForecastRepository(database);
    await expect(repository.findFixture("bt-fixture")).resolves.toMatchObject({ id: "bt-fixture", canonicalIdentityResolved: true });
    expect(typeof repository.publish).toBe("function");
    expect(typeof repository.findEvidence).toBe("function");
  });

  it("reconciles durable queue delivery and compares current corrected leaves", async () => {
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const admitted = plan("bt-plan-queue");
    const queue = createBacktestQueue({ redisUrl, prefix });
    let failOnce = true;
    const worker = createBacktestWorker({
      redisUrl,
      prefix,
      loadPlan: receipts.findPlan,
      execute: async (loaded, data) => {
        if (failOnce) { failOnce = false; throw new Error("FORCED_MID_WINDOW_FAILURE"); }
        return runBacktestPlan({
          plan: loaded,
          receipts,
          orchestrator: { run: async () => ({ id: "bt-forecast", evidenceBuildIds: ["build-before-cutoff"] }) } as never,
          repository: createPrismaForecastRepository(database),
          correlationId: data.correlationId,
        });
      },
    });
    await admitPersistEnqueueBacktest(admitted, { receipts, queue, correlationId: "bt-queue" });
    await waitUntil(async () => (await database.backtestPlan.findUnique({ where: { id: admitted.id } }))?.state === "SUCCEEDED");
    expect((await database.backtestWindow.findUniqueOrThrow({ where: { id: admitted.windows[0]!.id } })).scoreIds).toEqual([expect.stringMatching(/^score_/)]);

    await receipts.markDelivery(admitted.id, "RETRYABLE");
    expect(await reconcileBacktestDelivery({ receipts, queue })).toBeGreaterThanOrEqual(1);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    expect(await database.backtestWindow.count({ where: { planId: admitted.id } })).toBe(1);

    const peer = plan("bt-plan-peer", "peer-config");
    await receipts.createPlan(peer, "bt-peer");
    const current = await database.backtestEvaluation.findFirstOrThrow({ where: { windowId: "bt-plan-first-window", isCurrent: true } });
    await database.backtestEvaluation.create({ data: { id: "bt-peer-evaluation", windowId: peer.windows[0]!.id, evaluationAsOf: new Date(peer.windows[0]!.evaluationAsOf), resultVersionId: current.resultVersionId, settlementReceiptId: current.settlementReceiptId, scoreIds: current.scoreIds, revision: 1, isCurrent: true, receipt: { comparison: true } } });
    await database.backtestWindow.update({ where: { id: peer.windows[0]!.id }, data: { state: "SUCCEEDED", forecastSnapshotId: "bt-forecast", evidenceBuildIds: ["build-before-cutoff"], scoreIds: current.scoreIds, completedAt: new Date() } });
    await database.backtestPlan.update({ where: { id: peer.id }, data: { state: "SUCCEEDED", completedAt: new Date() } });

    const comparableLeft = plan("bt-plan-comparable-left", "left-config");
    await receipts.createPlan(comparableLeft, "bt-left");
    await database.backtestEvaluation.create({ data: { id: "bt-left-evaluation", windowId: comparableLeft.windows[0]!.id, evaluationAsOf: new Date(comparableLeft.windows[0]!.evaluationAsOf), resultVersionId: current.resultVersionId, settlementReceiptId: current.settlementReceiptId, scoreIds: current.scoreIds, revision: 1, isCurrent: true, receipt: { comparison: true } } });
    await database.backtestWindow.update({ where: { id: comparableLeft.windows[0]!.id }, data: { state: "SUCCEEDED", scoreIds: current.scoreIds, completedAt: new Date() } });
    await database.backtestPlan.update({ where: { id: comparableLeft.id }, data: { state: "SUCCEEDED", completedAt: new Date() } });
    const comparison = await compareBacktestPlans(database, { leftPlanId: comparableLeft.id, rightPlanId: peer.id, market: "ONE_X_TWO", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" });
    expect(comparison).toMatchObject({ available: true, sampleSize: 1, left: { sampleSize: 1 }, right: { sampleSize: 1 } });
    await worker.close();
    await queue.close();
  }, 30_000);
});
