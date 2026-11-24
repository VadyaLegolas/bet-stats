import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaBacktestReceiptRepository, createPrismaClient, createSettlementPipelineService, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor } from "@bet-stats/domain";
import { jobCanStillRun, readPlanProgress, waitForPlans } from "../../workers/data-sync/src/jobs/model-comparison.js";
import { runModelComparisonCommand } from "../../workers/data-sync/src/jobs/model-comparison-cli.js";
import { createBacktestQueue, createBacktestWorker } from "../../workers/data-sync/src/queues/index.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-cmp-pg-${process.pid}`;
const redisName = `bet-stats-cmp-redis-${process.pid}`;
const prefix = `cmp-${process.pid}`;
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

describe("operator model comparison entry point", () => {
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
    await database.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('cmp-league','Cmp League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('cmp-season','cmp-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('cmp-home','Home','home','GB',now()),('cmp-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
        ('cmp-f1','cmp-league','cmp-season','cmp-home','cmp-away','2026-09-10T18:00:00Z','FINISHED',now()),
        ('cmp-f2','cmp-league','cmp-season','cmp-away','cmp-home','2026-09-12T18:00:00Z','FINISHED',now()),
        ('cmp-f3','cmp-league','cmp-season','cmp-home','cmp-away','2026-09-14T18:00:00Z','SCHEDULED',now()),
        ('cmp-f4','cmp-league','cmp-season','cmp-home','cmp-away','2026-09-16T18:00:00Z','FINISHED',now());
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
        ('cmp-obs-1','test','RESULTS','cmp-f1','2026-09-10T20:00:00Z','cmp-h1','{}',2),
        ('cmp-obs-2','test','RESULTS','cmp-f2','2026-09-12T20:00:00Z','cmp-h2','{}',2),
        ('cmp-obs-4','test','RESULTS','cmp-f4','2026-09-16T20:00:00Z','cmp-h4','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
        ('cmp-r1','cmp-f1','cmp-obs-1','2026-09-10T20:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1),
        ('cmp-r2','cmp-f2','cmp-obs-2','2026-09-12T20:00:00Z','2026-09-12T20:00:00Z',0,0,'FINISHED',1),
        ('cmp-r4','cmp-f4','cmp-obs-4','2026-09-16T20:00:00Z','2026-09-16T20:00:00Z',1,1,'FINISHED',1);
      INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest") VALUES
        ('cmp-sync','cmp-sync',1,'football-data.org','RESULTS','critical','2026-08-01T00:00:00Z','2026-09-12T12:00:00Z','SUCCEEDED','cmp-sync-correlation',1,1,1,1,
          '{"expectedUnits":["results"],"completedUnits":["results"],"expectedCaptures":["cmp-h1"],"completedCaptures":["cmp-h1"]}'::jsonb);
      INSERT INTO "EvidenceBuild" (id,"teamId",cutoff,"configVersion","configHash","syncRunId",state,"publishedAt") VALUES
        ('cmp-eb-1h','cmp-home','2026-09-10T12:00:00Z','evidence-v1','cmp-evidence-hash','cmp-sync','PUBLISHED','2026-09-10T12:00:00Z'),
        ('cmp-eb-1a','cmp-away','2026-09-10T12:00:00Z','evidence-v1','cmp-evidence-hash','cmp-sync','PUBLISHED','2026-09-10T12:00:00Z'),
        ('cmp-eb-2h','cmp-home','2026-09-12T12:00:00Z','evidence-v1','cmp-evidence-hash','cmp-sync','PUBLISHED','2026-09-12T12:00:00Z'),
        ('cmp-eb-2a','cmp-away','2026-09-12T12:00:00Z','evidence-v1','cmp-evidence-hash','cmp-sync','PUBLISHED','2026-09-12T12:00:00Z');
    `);
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    for (const name of [postgresName, redisName]) try { docker("rm", "--force", "--volumes", name); } catch { /* exact owned cleanup */ }
  }, 30_000);

  it("submits one V1 and one DC plan over identical windows, idempotently, through the real queue", async () => {
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const queue = createBacktestQueue({ redisUrl, prefix });
    const lines: string[] = [];
    const range = ["--from", "2026-09-01T00:00:00.000Z", "--to", "2026-10-01T00:00:00.000Z", "--league", "cmp-league", "--json"];
    const args = ["submit", ...range, "--allow-small-cohort"];
    const deps = { database, receipts, queue, out: (line: string) => lines.push(line) };

    // Two usable windows are below the policy minimum: without the explicit flag nothing is written.
    expect(await runModelComparisonCommand(["submit", ...range], deps)).toBe(1);
    expect(JSON.parse(lines.splice(0).join("\n"))).toMatchObject({ submitted: false, runnable: false, reason: "COMPARISON_COHORT_BELOW_MINIMUM", cohort: { usable: 2 } });
    expect(await database.backtestPlan.count({ where: { id: { startsWith: "cmp-" } } })).toBe(0);

    expect(await runModelComparisonCommand(args, deps)).toBe(0);
    expect(await runModelComparisonCommand(args, deps)).toBe(0);
    type Submitted = { leftPlanId: string; rightPlanId: string; windows: number; cohort: { considered: number; usable: number; skipped: { noResultByEvaluationAsOf: number; noPublishedEvidenceAtCutoff: number; sharedCutoffInstant: number } } };
    const [first, second] = lines.map((line) => JSON.parse(line) as Submitted);
    expect(second).toEqual(first);
    expect(first!.windows).toBe(2);
    expect(first!.cohort.usable).toBe(2);
    expect(first!.cohort.considered).toBe(3);
    expect(first!.cohort.skipped).toEqual({ noResultByEvaluationAsOf: 0, noPublishedEvidenceAtCutoff: 1, sharedCutoffInstant: 0 });

    const plans = await database.backtestPlan.findMany({ where: { id: { in: [first!.leftPlanId, first!.rightPlanId] } }, include: { windows: { orderBy: { ordinal: "asc" } } } });
    expect(plans.map((plan) => [plan.modelVersion, plan.configHash, plan.deliveryState]).sort()).toEqual([
      ["dixon-coles-ensemble-v1", forecastConfigHashFor("dixon-coles-ensemble-v1"), "DELIVERED"],
      ["poisson-ensemble-v1", forecastConfigHashFor("poisson-ensemble-v1"), "DELIVERED"],
    ].sort());
    const identity = (plan: (typeof plans)[number]) => plan.windows.map((w) => `${w.fixtureId}|${w.trainingEndsAt.toISOString()}|${w.forecastCutoff.toISOString()}|${w.evaluationAsOf.toISOString()}`);
    expect(identity(plans[0]!)).toEqual(identity(plans[1]!));
    expect(await database.backtestPlan.count({ where: { id: { startsWith: "cmp-" } } })).toBe(2);

    // Compare before the worker ran: honest "not available", never a verdict.
    const compareLines: string[] = [];
    const code = await runModelComparisonCommand(["compare", "--left", first!.leftPlanId, "--right", first!.rightPlanId, "--from", "2026-09-01T00:00:00.000Z", "--to", "2026-10-01T00:00:00.000Z", "--json"], { ...deps, out: (line) => compareLines.push(line) });
    expect(code).toBe(1);
    expect(JSON.parse(compareLines.join("\n"))).toEqual({ available: false, reason: "PLAN_NOT_COMPLETE" });
    await queue.close();
  }, 60_000);

  /**
   * Real queue, real worker wiring, scripted `execute`: it fails the poisson plan's window for the first `failAttempts` calls
   * exactly like `runBacktestPlan` does (window FAILED, error rethrown so BullMQ retries) and then completes the plan.
   */
  async function scriptedRun(label: string, evaluationLagHours: number) {
    const queuePrefix = `${prefix}-${label}`;
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const queue = createBacktestQueue({ redisUrl, prefix: queuePrefix });
    const lines: string[] = [];
    const deps = { database, receipts, queue, out: (line: string) => lines.push(line), sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, Math.min(ms, 100))) };
    const submitArgs = ["submit", "--from", "2026-09-01T00:00:00.000Z", "--to", "2026-10-01T00:00:00.000Z", "--league", "cmp-league", "--evaluation-lag-hours", String(evaluationLagHours), "--allow-small-cohort", "--json"];
    const control = { failAttempts: 0, poissonCalls: 0 };
    const worker = createBacktestWorker({
      redisUrl, prefix: queuePrefix, loadPlan: receipts.findPlan,
      execute: async (plan) => {
        if (plan.modelVersion === "poisson-ensemble-v1") {
          control.poissonCalls += 1;
          if (control.poissonCalls <= control.failAttempts) { await receipts.failWindow(plan.windows[0]!.id, "SCRIPTED_TRANSIENT"); throw new Error("SCRIPTED_TRANSIENT"); }
        }
        await database.backtestWindow.updateMany({ where: { planId: plan.id }, data: { state: "SUCCEEDED" } });
        await database.backtestPlan.update({ where: { id: plan.id }, data: { state: "SUCCEEDED" } });
        return { ok: true };
      },
    });
    await worker.waitUntilReady();
    const submit = async () => {
      lines.length = 0;
      expect(await runModelComparisonCommand(submitArgs, deps)).toBe(0);
      return JSON.parse(lines.join("\n")) as { leftPlanId: string; rightPlanId: string };
    };
    const wait = async (ids: { leftPlanId: string; rightPlanId: string }) => {
      const hashes = new Map((await database.backtestPlan.findMany({ where: { id: { in: [ids.leftPlanId, ids.rightPlanId] } }, select: { id: true, planHash: true } })).map((row) => [row.id, row.planHash]));
      return waitForPlans({
        planIds: [ids.leftPlanId, ids.rightPlanId], read: (id) => readPlanProgress(database, id), timeoutMs: 90_000, pollMs: 100,
        canStillRun: async (planId) => jobCanStillRun(await queue.inspect({ planId, planHash: hashes.get(planId)! })),
      });
    };
    return { control, submit, wait, queue, close: async () => { await worker.close(); await queue.close(); } };
  }

  it("WR-08: a transient window failure is retried by BullMQ and the wait ends in SUCCEEDED, not FAILED", async () => {
    const run = await scriptedRun("wr08-transient", 47);
    try {
      run.control.failAttempts = 2; // attempts 1 and 2 fail, attempt 3 succeeds
      const waited = await run.wait(await run.submit());
      expect({ outcome: waited.outcome, poissonCalls: run.control.poissonCalls }).toEqual({ outcome: "SUCCEEDED", poissonCalls: 3 });
    } finally { await run.close(); }
  }, 120_000);

  it("WR-08: the wait reports FAILED only after the job used all of its attempts", async () => {
    const run = await scriptedRun("wr08-final", 46);
    try {
      run.control.failAttempts = Number.POSITIVE_INFINITY;
      const ids = await run.submit();
      const waited = await run.wait(ids);
      expect(waited.outcome).toBe("FAILED");
      expect(run.control.poissonCalls).toBe(3); // BACKTEST_MAX_ATTEMPTS, not 1
    } finally { await run.close(); }
  }, 120_000);

  it("WR-09: after the job failed for good, running the same parameters again retries the plan and completes it", async () => {
    const run = await scriptedRun("wr09-retry", 45);
    try {
      run.control.failAttempts = Number.POSITIVE_INFINITY;
      const ids = await run.submit();
      expect((await run.wait(ids)).outcome).toBe("FAILED");
      expect(run.control.poissonCalls).toBe(3);

      run.control.failAttempts = 0; // the operator fixed the cause
      const again = await run.submit();
      expect([again.leftPlanId, again.rightPlanId]).toEqual([ids.leftPlanId, ids.rightPlanId]); // same parameters, same plan ids: nothing new is created
      const waited = await run.wait(ids);
      expect({ outcome: waited.outcome, poissonCalls: run.control.poissonCalls }).toEqual({ outcome: "SUCCEEDED", poissonCalls: 4 });
    } finally { await run.close(); }
  }, 120_000);
});
