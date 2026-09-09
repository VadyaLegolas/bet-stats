import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createSettlementPipelineService, SETTLEMENT_PIPELINE_POLICY_HASH, type PrismaClient } from "@bet-stats/database";
import { currentForecastConfigHash } from "@bet-stats/domain";
import { createPrismaEvaluationRepository, parseCohortQuery } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { createSettlementJobHandler } from "../../workers/data-sync/src/jobs/settlement.js";
import { admitBacktestPlan, BACKTEST_LIMITS } from "../../workers/data-sync/src/jobs/backtests.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-phase-04-security-${process.pid}`;
const bounds = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" } as const;
let prisma: PrismaClient;

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

async function seedCanonicalSources(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('matrix-league','Matrix League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('matrix-season','matrix-league','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('matrix-home','Home','home','GB',now()),('matrix-away','Away','away','GB',now());
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('matrix-fixture','matrix-league','matrix-season','matrix-home','matrix-away','2026-09-10T18:00:00Z','FINISHED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('matrix-obs-1','test','RESULTS','matrix-fixture','2026-09-10T20:00:00Z','matrix-result-hash-1','{"score":"2-1"}',15),('matrix-obs-2','test','RESULTS','matrix-fixture','2026-09-11T08:00:00Z','matrix-result-hash-2','{"score":"1-2"}',15);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('matrix-result-1','matrix-fixture','matrix-obs-1','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('matrix-result-2','matrix-fixture','matrix-obs-2','2026-09-10T18:00:00Z','2026-09-11T08:00:00Z',1,2,'FINISHED',2,'matrix-result-1');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('matrix-forecast','matrix-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{}','2026-09-10T17:00:01Z');
    INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('matrix-market-1x2','matrix-forecast','ONE_X_TWO','[{"selection":"HOME","probability":0.5},{"selection":"DRAW","probability":0.3},{"selection":"AWAY","probability":0.2}]'),('matrix-market-ou','matrix-forecast','OVER_UNDER_2_5','[{"selection":"OVER_2_5","probability":0.6},{"selection":"UNDER_2_5","probability":0.4}]'),('matrix-market-btts','matrix-forecast','BTTS','[{"selection":"YES","probability":0.7},{"selection":"NO","probability":0.3}]');
    INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('matrix-odds','matrix-fixture','ONE_X_TWO','odds-hash','BOOKMAKER_BACK','{"selections":[{"selection":"HOME","decimalOdds":"2.4","noVigProbability":"0.45"}]}','2026-09-10T16:00:00Z');
    INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('matrix-odds-home','matrix-odds','HOME','2.4');
    INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ('matrix-value','matrix-fixture','ONE_X_TWO','matrix-forecast','matrix-odds','VALUE_CANDIDATE','HOME','0.5','0.45','2','0.05','0.2','{"market":"ONE_X_TWO","selection":"HOME","decimalOdds":"2.4","modelProbability":"0.5","noVigProbability":"0.45"}');
  `);
}

describe("Phase 04 migrated PostgreSQL security matrix", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1);
    if (!port) throw new Error("PostgreSQL port was not published");
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    prisma = createPrismaClient(databaseUrl);
    await seedCanonicalSources();
  }, 120_000);
  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* exact owned cleanup */ } }, 30_000);

  it("EVAL-01/EVAL-02/T-04-07-01 binds exact sources and converges worker retries", async () => {
    const handler = createSettlementJobHandler({ service: createSettlementPipelineService({ database: prisma }) });
    const payload = { fixtureId: "matrix-fixture", resultVersionId: "matrix-result-1", forecastSnapshotId: "matrix-forecast", policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId: "matrix" } as const;
    const first = await handler(payload); const retry = await handler(payload);
    expect(first).toMatchObject({ duplicate: false, reason: "RESULT_FINISHED" });
    expect(retry).toMatchObject({ duplicate: true, settlementReceiptId: first.settlementReceiptId });
    expect(await prisma.settlementReceipt.findUniqueOrThrow({ where: { id: first.settlementReceiptId } })).toMatchObject({ resultVersionId: "matrix-result-1", forecastSnapshotId: "matrix-forecast" });
    await expect(handler({ ...payload, fixtureId: "matrix-home" })).rejects.toThrow(/FIXTURE_SCOPE_MISMATCH/);
  });

  it("EVAL-03/EVAL-04 appends correction leaves while retaining immutable formula history", async () => {
    await createSettlementPipelineService({ database: prisma }).process({ fixtureId: "matrix-fixture", resultVersionId: "matrix-result-2", forecastSnapshotId: "matrix-forecast", policyVersion: "settlement-policy-v1", correlationId: "matrix-correction" });
    const receipts = await prisma.settlementReceipt.findMany({ orderBy: { revision: "asc" } });
    expect(receipts).toHaveLength(2); expect(receipts[1]!.supersedesSettlementReceiptId).toBe(receipts[0]!.id);
    const scores = await prisma.forecastScore.findMany({ orderBy: { createdAt: "asc" } });
    expect(scores).toHaveLength(6); expect(scores.filter((row) => row.supersedesForecastScoreId)).toHaveLength(3);
    expect(scores.every((row) => row.formulaHash.length > 0 && row.eventCount === 1)).toBe(true);
    expect(await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM current_forecast_scores`).toEqual([{ count: 3n }]);
    await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastScore" SET "brierScore"=0 WHERE id=$1`, scores[0]!.id)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "SettlementReceipt" WHERE id=$1`, receipts[0]!.id)).rejects.toThrow(/immutable/i);
  });

  it("EVAL-05/EVAL-06/EVAL-07 reconciles reliability, flat P/L and fail-closed CLV from leaves", async () => {
    const repository = createPrismaEvaluationRepository(prisma);
    const identity = { modelVersion: "poisson-v1", competitionId: "matrix-league", market: "ONE_X_TWO", ...bounds };
    const cohort = await repository.loadCohort(identity);
    expect(cohort.denominators).toEqual({ fixtureCount: 1, forecastCount: 1, eventCount: 3, valueCount: 1 });
    expect(cohort.reliability.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(cohort.financial).toMatchObject({ count: 1, totalStakedUnits: "1", totalProfitUnits: "-1", roi: "-1", yield: "-1" });
    expect(cohort.clv).toEqual({ status: "UNAVAILABLE", reason: "NO_COMPARABLE_CLOSE", comparableCount: 0 });
    const page = await repository.listValueCandidates(identity, null, 1);
    expect(page.items.map((row) => row.valueReceiptId)).toEqual(["matrix-value"]);
    expect(page.pageTotals).toEqual({ count: 1, stakeUnits: "1", profitUnits: "-1" });
  });

  it("EVAL-08/T-04-07-02 rejects rolling-origin poison and hostile bounded filters", () => {
    const base = { id: "matrix-backtest", version: "rolling-origin-v1", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), rangeFrom: bounds.from, rangeTo: bounds.to, concurrency: 1, windows: [{ id: "w1", fixtureId: "matrix-fixture", trainingEndsAt: "2026-09-09T00:00:00.000Z", forecastCutoff: "2026-09-10T17:00:00.000Z", evaluationAsOf: "2026-09-12T17:00:00.000Z" }] };
    expect(() => admitBacktestPlan({ ...base, split: "random" } as never)).toThrowError(expect.objectContaining({ code: "RANDOM_SPLIT_REJECTED" }));
    expect(() => admitBacktestPlan({ ...base, concurrency: BACKTEST_LIMITS.maxConcurrency + 1 })).toThrowError(expect.objectContaining({ code: "BACKTEST_LIMIT_EXCEEDED" }));
    expect(() => parseCohortQuery({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", from: bounds.to, to: bounds.from })).toThrow(/INVALID_COHORT_PERIOD/);
    expect(() => parseCohortQuery({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", ...bounds, forged: "yes" })).toThrow(/INVALID_COHORT_QUERY/);
  });
});
