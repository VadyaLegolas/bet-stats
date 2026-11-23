import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaBacktestReceiptRepository, createPrismaClient, createSettlementPipelineService, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor } from "@bet-stats/domain";
import { runModelComparisonCommand } from "../../workers/data-sync/src/jobs/model-comparison-cli.js";
import { createBacktestQueue } from "../../workers/data-sync/src/queues/index.js";

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
        ('cmp-f3','cmp-league','cmp-season','cmp-home','cmp-away','2026-09-14T18:00:00Z','SCHEDULED',now());
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
        ('cmp-obs-1','test','RESULTS','cmp-f1','2026-09-10T20:00:00Z','cmp-h1','{}',2),
        ('cmp-obs-2','test','RESULTS','cmp-f2','2026-09-12T20:00:00Z','cmp-h2','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
        ('cmp-r1','cmp-f1','cmp-obs-1','2026-09-10T20:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1),
        ('cmp-r2','cmp-f2','cmp-obs-2','2026-09-12T20:00:00Z','2026-09-12T20:00:00Z',0,0,'FINISHED',1);
    `);
  }, 120_000);

  afterAll(async () => {
    await database?.$disconnect();
    for (const name of [postgresName, redisName]) try { docker("rm", "--force", name); } catch { /* exact owned cleanup */ }
  }, 30_000);

  it("submits one V1 and one DC plan over identical windows, idempotently, through the real queue", async () => {
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const queue = createBacktestQueue({ redisUrl, prefix });
    const lines: string[] = [];
    const args = ["submit", "--from", "2026-09-01T00:00:00.000Z", "--to", "2026-10-01T00:00:00.000Z", "--league", "cmp-league", "--json"];
    const deps = { database, receipts, queue, out: (line: string) => lines.push(line) };

    expect(await runModelComparisonCommand(args, deps)).toBe(0);
    expect(await runModelComparisonCommand(args, deps)).toBe(0);
    const [first, second] = lines.map((line) => JSON.parse(line) as { leftPlanId: string; rightPlanId: string; windows: number });
    expect(second).toEqual(first);
    expect(first!.windows).toBe(2);

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
});
