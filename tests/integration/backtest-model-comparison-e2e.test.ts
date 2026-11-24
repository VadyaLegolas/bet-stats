import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPrismaBacktestReceiptRepository,
  createPrismaClient,
  createPrismaForecastRepository,
  createSettlementPipelineService,
  fitLeagueDixonColesParameters,
  type PrismaClient,
} from "@bet-stats/database";
import { ForecastOrchestrator, MODEL_COMPARISON_POLICY } from "@bet-stats/domain";
import { createPrismaEvaluationRepository } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { runBacktestPlan } from "../../workers/data-sync/src/jobs/backtests.js";
import { ensureTeamEvidence } from "../../workers/data-sync/src/jobs/forecast-sweep.js";
import { runModelComparisonCommand } from "../../workers/data-sync/src/jobs/model-comparison-cli.js";
import { createBacktestQueue, createBacktestWorker } from "../../workers/data-sync/src/queues/index.js";

/**
 * End-to-end proof for MODEL-03 (UAT test 2): an operator running `run` with default flags gets a
 * `model-comparison-v2` receipt for a V1 and a Dixon-Coles plan over the same fixtures. Everything between the CLI
 * and PostgreSQL/Redis is the production code path: real `ForecastOrchestrator`, forecast repository, settlement
 * pipeline, evidence builder, BullMQ queue and a backtest worker wired exactly like workers/data-sync/src/main.ts.
 */

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-e2e-pg-${process.pid}`;
const redisName = `bet-stats-e2e-redis-${process.pid}`;
const prefix = `e2e-${process.pid}`;

// Independent literals on purpose: the test must catch a CLI default that drifts away from the production PRE_MATCH lead.
const PRODUCTION_LEAD_HOURS = 6;
const HOUR_MS = 3_600_000;
const COHORT_SIZE = 32;
const RANGE = ["--from", "2026-09-01T00:00:00.000Z", "--to", "2026-10-15T00:00:00.000Z"] as const;
const LEAGUE = "e2e-league";

let database: PrismaClient;
let redisUrl = "";
let databaseUrl = "";
let worker: ReturnType<typeof createBacktestWorker> | undefined;
let queue: ReturnType<typeof createBacktestQueue> | undefined;
/** Full worker failure messages: the window failureCode is cut to 64 characters, the job failure keeps the real cause. */
const workerFailures: string[] = [];

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

interface SeedFixture {
  readonly id: string;
  readonly home: string;
  readonly away: string;
  readonly kickoff: Date;
  readonly status: "FINISHED" | "SCHEDULED";
  readonly goals?: readonly [number, number];
  /** Hours after kickoff at which the result is OBSERVED (default 2). The result is effective 2 h after kickoff either way. */
  readonly observedAfterHours?: number;
}

const teamIds = Array.from({ length: 8 }, (_, index) => `e2e-team-${index + 1}`);
const iso = (value: Date) => value.toISOString();

/** Circle-method schedule: every round pairs all eight teams exactly once. */
function roundRobin(size: number): Array<Array<[number, number]>> {
  const ring = [...Array(size).keys()];
  const rounds: Array<Array<[number, number]>> = [];
  for (let round = 0; round < size - 1; round += 1) {
    const pairs: Array<[number, number]> = [];
    for (let index = 0; index < size / 2; index += 1) pairs.push([ring[index]!, ring[size - 1 - index]!]);
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop()!);
  }
  return rounds;
}

function buildFixtures(): { history: SeedFixture[]; cohort: SeedFixture[]; twin: SeedFixture; noEvidence: SeedFixture; scheduled: SeedFixture; lateObserved: SeedFixture } {
  const history: SeedFixture[] = [];
  roundRobin(8).slice(0, 6).forEach((pairs, round) => {
    pairs.forEach(([home, away], index) => {
      history.push({ id: `e2e-hist-${round + 1}-${index + 1}`, home: teamIds[home]!, away: teamIds[away]!, kickoff: new Date(Date.UTC(2026, 6, 2 + round * 3, 15)), status: "FINISHED", goals: [(round + index) % 4, (round * 2 + index) % 3] });
    });
  });
  const cohort: SeedFixture[] = Array.from({ length: COHORT_SIZE }, (_, index) => ({
    id: `e2e-fx-${String(index + 1).padStart(2, "0")}`,
    home: teamIds[index % 8]!,
    away: teamIds[(index + 1 + Math.floor(index / 8)) % 8]!,
    kickoff: new Date(Date.UTC(2026, 8, 2, 10) + index * 30 * HOUR_MS),
    status: "FINISHED",
    goals: [(index * 3 + 1) % 4, (index * 5 + 2) % 3],
  }));
  const shared = cohort[9]!;
  const busy = new Set([shared.home, shared.away]);
  const [twinHome, twinAway] = teamIds.filter((team) => !busy.has(team)).slice(-2) as [string, string];
  return {
    history,
    cohort,
    // Same kickoff instant as e2e-fx-10, lexicographically larger id: it loses the tie-break.
    twin: { id: `${shared.id}-twin`, home: twinHome, away: twinAway, kickoff: shared.kickoff, status: "FINISHED", goals: [1, 1] },
    // Later than every cohort match, so its teams already own older builds: the real-run EVIDENCE_CUTOFF_MISMATCH shape.
    noEvidence: { id: "e2e-fx-no-evidence", home: teamIds[2]!, away: teamIds[5]!, kickoff: new Date(Date.UTC(2026, 9, 12, 18)), status: "FINISHED", goals: [2, 0] },
    // Effective 2 h after kickoff but only OBSERVED 72 h after it: unknown at evaluationAsOf (kickoff + 48 h). CR-03: the cohort must skip it
    // instead of letting the backtest window fail with RESULT_NOT_AVAILABLE and take the whole plan down.
    lateObserved: { id: "e2e-fx-late-observed", home: teamIds[3]!, away: teamIds[6]!, kickoff: new Date(Date.UTC(2026, 9, 3, 12)), status: "FINISHED", goals: [3, 0], observedAfterHours: 72 },
    scheduled: { id: "e2e-fx-scheduled", home: teamIds[0]!, away: teamIds[4]!, kickoff: new Date(Date.UTC(2026, 9, 5, 12)), status: "SCHEDULED" },
  };
}

async function seedDatabase(fixtures: SeedFixture[]): Promise<void> {
  const finished = fixtures.filter((fixture) => fixture.status === "FINISHED");
  const lines = (rows: string[]) => rows.join(",\n");
  await database.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('${LEAGUE}','E2E League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('e2e-season','${LEAGUE}','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES
      ${lines(teamIds.map((id, index) => `('${id}','Team ${index + 1}','team ${index + 1}','GB',now())`))};
  `);
  await database.$executeRawUnsafe(`
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
      ${lines(fixtures.map((fixture) => `('${fixture.id}','${LEAGUE}','e2e-season','${fixture.home}','${fixture.away}','${iso(fixture.kickoff)}','${fixture.status}',now())`))};
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('e2e-obs-sync','test','RESULTS','e2e-sync','2026-10-20T00:00:00Z','e2e-sync-capture','{}',2),
      ${lines(finished.map((fixture) => `('e2e-obs-${fixture.id}','test','RESULTS','${fixture.id}','${iso(new Date(fixture.kickoff.getTime() + (fixture.observedAfterHours ?? 2) * HOUR_MS))}','e2e-hash-${fixture.id}','{}',2)`))};
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ${lines(finished.map((fixture) => `('e2e-result-${fixture.id}','${fixture.id}','e2e-obs-${fixture.id}','${iso(new Date(fixture.kickoff.getTime() + 2 * HOUR_MS))}','${iso(new Date(fixture.kickoff.getTime() + (fixture.observedAfterHours ?? 2) * HOUR_MS))}',${fixture.goals![0]},${fixture.goals![1]},'FINISHED',1)`))};
    INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest") VALUES
      ('e2e-sync','e2e-sync',1,'football-data.org','RESULTS','critical','2026-06-01T00:00:00Z','2026-10-20T00:00:00Z','SUCCEEDED','e2e-sync-correlation',1,1,1,1,
        '{"expectedUnits":["results"],"completedUnits":["results"],"expectedCaptures":["e2e-sync-capture"],"completedCaptures":["e2e-sync-capture"]}'::jsonb);
    INSERT INTO "SyncAttempt" (id,"syncRunId","attemptNumber","observationId",state,"finishedAt") VALUES ('e2e-sync-attempt','e2e-sync',1,'e2e-obs-sync','SUCCEEDED','2026-10-20T00:00:00Z');
  `);
}

const fixtureData = buildFixtures();

describe("operator model comparison end to end through the real backtest worker", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    docker("run", "--detach", "--name", redisName, "--publish", "127.0.0.1::6379", "redis:8-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    waitFor(redisName, ["redis-cli", "ping"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const redisPort = docker("port", redisName, "6379/tcp").split(":").at(-1)!;
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    redisUrl = `redis://127.0.0.1:${redisPort}`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);

    const { history, cohort, twin, noEvidence, scheduled, lateObserved } = fixtureData;
    await seedDatabase([...history, ...cohort, twin, noEvidence, scheduled, lateObserved]);

    // Real evidence builds at exactly kickoff - 6h, sequentially (parallel work on different fixtures is a known unrelated defect).
    for (const fixture of [...cohort, twin].sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || (a.id < b.id ? -1 : 1))) {
      const cutoff = iso(new Date(fixture.kickoff.getTime() - PRODUCTION_LEAD_HOURS * HOUR_MS));
      for (const teamId of [fixture.home, fixture.away]) {
        const buildId = await ensureTeamEvidence({ database, teamId, cutoff });
        expect(buildId, `evidence build for ${teamId} at ${cutoff}`).not.toBeNull();
      }
    }

    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const repository = createPrismaForecastRepository(database);
    queue = createBacktestQueue({ redisUrl, prefix });
    worker = createBacktestWorker({
      redisUrl,
      prefix,
      loadPlan: receipts.findPlan,
      // Mirrors the production wiring in workers/data-sync/src/main.ts.
      execute: (plan, data) => runBacktestPlan({
        plan,
        receipts,
        orchestrator: new ForecastOrchestrator(),
        repository,
        correlationId: data.correlationId,
        resolveDixonColes: async (window) => {
          const fixture = await repository.findFixture(window.fixtureId);
          if (!fixture) return null;
          return fitLeagueDixonColesParameters(database, { leagueId: fixture.leagueId, asOf: window.trainingEndsAt });
        },
      }),
    });
    worker.on("failed", (_job, error) => { workerFailures.push(error.message); });
    await worker.waitUntilReady();
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await database?.$disconnect();
    for (const name of [postgresName, redisName]) try { docker("rm", "--force", "--volumes", name); } catch { /* exact owned cleanup */ }
  }, 60_000);

  it("takes a V1 and a Dixon-Coles plan over the same matches to a model-comparison-v2 receipt", async () => {
    const receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    const fastSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, Math.min(ms, 200)));
    const runArgs = ["run", ...RANGE, "--league", LEAGUE, "--timeout-minutes", "3", "--json"];
    const documents: string[] = [];
    const deps = { database, receipts, queue: queue!, out: (line: string) => documents.push(line), sleep: fastSleep };

    const code = await runModelComparisonCommand(runArgs, deps);
    if (code !== 0) await new Promise<void>((done) => setTimeout(done, 1_500)); // let the worker report its failure event

    // 1. Exit code first, with the window failure diagnosis so a red run shows its cause.
    const failedWindows = await database.backtestWindow.findMany({ where: { state: "FAILED" }, select: { planId: true, fixtureId: true, failureCode: true, receipt: true }, take: 3 });
    const failedCount = await database.backtestWindow.count({ where: { state: "FAILED" } });
    expect({ code, failedCount, workerFailures: workerFailures.slice(0, 2).map((message) => message.slice(-240)), failedWindows: failedWindows.map((window) => ({ plan: window.planId, fixtureId: window.fixtureId, failureCode: window.failureCode, receipt: JSON.stringify(window.receipt).slice(0, 400) })) }).toEqual({ code: 0, failedCount: 0, workerFailures: [], failedWindows: [] });

    // 2. Cohort report from the submission summary.
    type Summary = { leftPlanId: string; rightPlanId: string; windows: number; cohort: { considered: number; usable: number; leadHours: number; minimumRequired: number; skipped: { noResultByEvaluationAsOf: number; noPublishedEvidenceAtCutoff: number; sharedCutoffInstant: number } } };
    const summary = JSON.parse(documents[0]!) as Summary;
    expect(summary.windows).toBe(COHORT_SIZE);
    expect(summary.cohort.leadHours).toBe(PRODUCTION_LEAD_HOURS);
    expect(summary.cohort.usable).toBe(COHORT_SIZE);
    expect(summary.cohort.considered).toBe(COHORT_SIZE + 3);
    expect(summary.cohort.skipped).toEqual({ noResultByEvaluationAsOf: 1, noPublishedEvidenceAtCutoff: 1, sharedCutoffInstant: 1 });
    expect(summary.cohort.minimumRequired).toBe(MODEL_COMPARISON_POLICY.minimumSampleSize);
    expect(summary.cohort.usable).toBeGreaterThanOrEqual(MODEL_COMPARISON_POLICY.minimumSampleSize);

    // 3. The model-comparison-v2 receipt.
    type Outcome = { available: boolean; reason?: string; receipt?: { version: string; windowsDigest: string; verdict: string; left: { modelVersion: string; sampleSize: number }; right: { modelVersion: string; sampleSize: number }; deltas: { brierScore: number; logLoss: number } } };
    const outcome = JSON.parse(documents.at(-1)!) as Outcome;
    expect(outcome.available, outcome.reason).toBe(true);
    const receipt = outcome.receipt!;
    expect(receipt.version).toBe(MODEL_COMPARISON_POLICY.version);
    expect(receipt.left.modelVersion).toBe("poisson-ensemble-v1");
    expect(receipt.right.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(receipt.left.sampleSize).toBe(COHORT_SIZE);
    expect(receipt.right.sampleSize).toBe(COHORT_SIZE);
    // rho = 0 for lack of history: DC equals V1, so the honest verdict is "no evidence", not "DC is no worse".
    expect(receipt.verdict).toBe("INCONCLUSIVE");
    expect(Math.abs(receipt.deltas.brierScore)).toBeLessThan(1e-9);
    expect(Math.abs(receipt.deltas.logLoss)).toBeLessThan(1e-9);

    // 4. Database facts: both plans, identical windows, two independent settlements per match.
    const plans = await database.backtestPlan.findMany({ where: { id: { in: [summary.leftPlanId, summary.rightPlanId] } }, include: { windows: { orderBy: { ordinal: "asc" } } } });
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.state).toBe("SUCCEEDED");
      expect(plan.windows).toHaveLength(COHORT_SIZE);
      expect(plan.windows.every((window) => window.state === "SUCCEEDED")).toBe(true);
    }
    const fixtureSets = plans.map((plan) => plan.windows.map((window) => window.fixtureId).sort());
    expect(fixtureSets[0]).toEqual(fixtureSets[1]);
    expect(fixtureSets[0]).toEqual(fixtureData.cohort.map((fixture) => fixture.id).sort());
    expect(fixtureSets[0]).not.toContain(fixtureData.twin.id);
    expect(fixtureSets[0]).not.toContain(fixtureData.noEvidence.id);
    expect(fixtureSets[0]).not.toContain(fixtureData.scheduled.id);
    expect(fixtureSets[0]).not.toContain(fixtureData.lateObserved.id);

    const settlements = await database.settlementReceipt.findMany({ where: { fixtureId: { in: fixtureData.cohort.map((fixture) => fixture.id) } }, include: { _count: { select: { forecastScores: true } } } });
    const byFixture = new Map<string, typeof settlements>();
    for (const row of settlements) byFixture.set(row.fixtureId, [...(byFixture.get(row.fixtureId) ?? []), row]);
    expect([...byFixture.keys()].sort()).toEqual(fixtureData.cohort.map((fixture) => fixture.id).sort());
    for (const [fixtureId, rows] of byFixture) {
      expect(rows, fixtureId).toHaveLength(2);
      expect(new Set(rows.map((row) => row.forecastSnapshotId)).size, fixtureId).toBe(2);
      expect(rows.every((row) => row.revision === 1 && row.supersedesSettlementReceiptId === null), fixtureId).toBe(true);
      expect(rows.map((row) => row._count.forecastScores), fixtureId).toEqual([3, 3]);
    }
    expect(await database.settlementReceipt.count({ where: { fixtureId: { in: [fixtureData.twin.id, fixtureData.noEvidence.id, fixtureData.scheduled.id, fixtureData.lateObserved.id] } } })).toBe(0);

    // 5. Documented limitation: every DC snapshot was produced with rho = 0 on an empty history.
    const dcPlan = plans.find((plan) => plan.modelVersion === "dixon-coles-ensemble-v1")!;
    const dcSnapshots = await database.forecastSnapshot.findMany({ where: { id: { in: dcPlan.windows.map((window) => window.forecastSnapshotId!) } }, select: { modelVersion: true, receipt: true } });
    expect(dcSnapshots).toHaveLength(COHORT_SIZE);
    for (const snapshot of dcSnapshots) {
      expect(snapshot.modelVersion).toBe("dixon-coles-ensemble-v1");
      const dixonColes = ((snapshot.receipt as { receipt?: { dixonColes?: { method?: string; rho?: number } } }).receipt ?? {}).dixonColes;
      expect(dixonColes).toMatchObject({ method: "insufficient-sample-zero", rho: 0 });
    }

    // 6. Replays: compare is deterministic, run is idempotent and creates no new plans.
    const planCount = await database.backtestPlan.count();
    const compareDocuments: string[] = [];
    expect(await runModelComparisonCommand(["compare", "--left", summary.leftPlanId, "--right", summary.rightPlanId, ...RANGE, "--market", "ONE_X_TWO", "--json"], { ...deps, out: (line) => compareDocuments.push(line) })).toBe(0);
    expect((JSON.parse(compareDocuments.at(-1)!) as Outcome).receipt!.windowsDigest).toBe(receipt.windowsDigest);

    const rerunDocuments: string[] = [];
    expect(await runModelComparisonCommand(runArgs, { ...deps, out: (line) => rerunDocuments.push(line) })).toBe(0);
    expect((JSON.parse(rerunDocuments.at(-1)!) as Outcome).available).toBe(true);
    expect(await database.backtestPlan.count()).toBe(planCount);

    // 7. WR-13: the public pool never contains backtest forecasts. This database has no production forecast at all, so
    // every public read must be empty even though the comparison run above produced 64 snapshots and 192 scores.
    const evaluation = createPrismaEvaluationRepository(database);
    const empty = { fixtureCount: 0, forecastCount: 0, eventCount: 0, valueCount: 0 };
    const bounds = { from: RANGE[1], to: RANGE[3] };
    for (const modelVersion of ["all", "poisson-ensemble-v1", "dixon-coles-ensemble-v1"] as const) {
      for (const market of ["ONE_X_TWO", "all"] as const) {
        const cohort = await evaluation.loadCohort({ modelVersion, competitionId: "all", market, ...bounds });
        expect(cohort.denominators, `public cohort ${modelVersion}/${market}`).toEqual(empty);
      }
    }
    expect(await evaluation.enumerateAvailableCohorts(bounds)).toEqual([]);
    const candidates = await evaluation.listValueCandidates({ modelVersion: "all", competitionId: "all", market: "all", ...bounds }, null, 10);
    expect(candidates.items).toEqual([]);
    expect(await database.forecastSnapshot.count({ where: { origin: "BACKTEST" } })).toBe(2 * COHORT_SIZE);
    expect(await database.forecastSnapshot.count({ where: { origin: "PRODUCTION" } })).toBe(0);
    // Backtest-internal readers still see the backtest scores (the receipt assertions above already prove the comparison works).
    expect(await database.forecastScore.count({ where: { forecastSnapshot: { origin: "BACKTEST" } } })).toBe(2 * COHORT_SIZE * 3);
  }, 240_000);
});
