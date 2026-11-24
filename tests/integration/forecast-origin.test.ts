import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPrismaBacktestReceiptRepository,
  createPrismaClient,
  createPrismaForecastRepository,
  createSettlementPipelineService,
  type PrismaClient,
} from "@bet-stats/database";
import { ForecastOrchestrator, forecastConfigHashFor } from "@bet-stats/domain";
import { createPrismaEvaluationRepository } from "../../apps/api/src/modules/evaluation/evaluation.service.js";
import { createProductionRepository } from "../../apps/api/src/modules/forecasts/forecast-comparison.service.js";
import { createPrismaValueRepository } from "../../apps/api/src/modules/value/value.service.js";
import { admitBacktestPlan, runBacktestPlan } from "../../workers/data-sync/src/jobs/backtests.js";
import { ensureTeamEvidence } from "../../workers/data-sync/src/jobs/forecast-sweep.js";

/**
 * WR-13 on real PostgreSQL (no Redis): backtest publications carry origin BACKTEST and stay out of every public reader,
 * while an identity collision with a production snapshot never re-labels it. Everything between the test and the
 * database is the production code path: real ForecastOrchestrator, forecast repository, backtest runner, settlement
 * pipeline, evidence builder and the public evaluation/comparison/value repositories.
 */

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-origin-pg-${process.pid}`;

const HOUR_MS = 3_600_000;
const LEAD_HOURS = 6;
const LEAGUE = "og-league";
const MODEL = "poisson-ensemble-v1" as const;
const teamIds = Array.from({ length: 8 }, (_, index) => `og-team-${index + 1}`);
const BOUNDS = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" } as const;
const iso = (value: Date) => value.toISOString();

interface Target { readonly id: string; readonly home: string; readonly away: string; readonly kickoff: Date; readonly goals: readonly [number, number] }
const F1: Target = { id: "og-fx-1", home: teamIds[0]!, away: teamIds[1]!, kickoff: new Date(Date.UTC(2026, 8, 2, 10)), goals: [2, 1] };
const F2: Target = { id: "og-fx-2", home: teamIds[2]!, away: teamIds[3]!, kickoff: new Date(Date.UTC(2026, 8, 4, 10)), goals: [0, 0] };
const cutoffOf = (target: Target) => iso(new Date(target.kickoff.getTime() - LEAD_HOURS * HOUR_MS));

let database: PrismaClient;
let receipts: ReturnType<typeof createPrismaBacktestReceiptRepository>;
let repository: ReturnType<typeof createPrismaForecastRepository>;

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

interface SeedFixture { readonly id: string; readonly home: string; readonly away: string; readonly kickoff: Date; readonly goals: readonly [number, number] }

async function seedDatabase(fixtures: readonly SeedFixture[]): Promise<void> {
  const lines = (rows: string[]) => rows.join(",\n");
  const observedAt = (fixture: SeedFixture) => iso(new Date(fixture.kickoff.getTime() + 2 * HOUR_MS));
  await database.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('${LEAGUE}','Origin League','GB',now());
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('og-season','${LEAGUE}','2026','2026-01-01','2026-12-31',now());
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES
      ${lines(teamIds.map((id, index) => `('${id}','Team ${index + 1}','team ${index + 1}','GB',now())`))};
  `);
  await database.$executeRawUnsafe(`
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
      ${lines(fixtures.map((fixture) => `('${fixture.id}','${LEAGUE}','og-season','${fixture.home}','${fixture.away}','${iso(fixture.kickoff)}','FINISHED',now())`))};
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('og-obs-sync','test','RESULTS','og-sync','2026-10-20T00:00:00Z','og-sync-capture','{}',2),
      ${lines(fixtures.map((fixture) => `('og-obs-${fixture.id}','test','RESULTS','${fixture.id}','${observedAt(fixture)}','og-hash-${fixture.id}','{}',2)`))};
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ${lines(fixtures.map((fixture) => `('og-result-${fixture.id}','${fixture.id}','og-obs-${fixture.id}','${observedAt(fixture)}','${observedAt(fixture)}',${fixture.goals[0]},${fixture.goals[1]},'FINISHED',1)`))};
    INSERT INTO "SyncRun" (id,"logicalKey",revision,provider,"endpointFamily",lane,"windowFrom","windowTo",state,"correlationId","expectedUnits","completedUnits","expectedCaptures","completedCaptures","completionManifest") VALUES
      ('og-sync','og-sync',1,'football-data.org','RESULTS','critical','2026-06-01T00:00:00Z','2026-10-20T00:00:00Z','SUCCEEDED','og-sync-correlation',1,1,1,1,
        '{"expectedUnits":["results"],"completedUnits":["results"],"expectedCaptures":["og-sync-capture"],"completedCaptures":["og-sync-capture"]}'::jsonb);
    INSERT INTO "SyncAttempt" (id,"syncRunId","attemptNumber","observationId",state,"finishedAt") VALUES ('og-sync-attempt','og-sync',1,'og-obs-sync','SUCCEEDED','2026-10-20T00:00:00Z');
  `);
}

/** One single-window V1 backtest plan over `target`, run through the real runner (no queue). */
async function runBacktest(planId: string, target: Target): Promise<{ windowId: string; snapshotId: string }> {
  const windowId = `${planId}-window`;
  const cutoff = cutoffOf(target);
  const plan = admitBacktestPlan({
    id: planId,
    version: "rolling-origin-v1",
    modelVersion: MODEL,
    configHash: forecastConfigHashFor(MODEL),
    rangeFrom: "2026-08-01T00:00:00.000Z",
    rangeTo: cutoff,
    concurrency: 1,
    windows: [{ id: windowId, fixtureId: target.id, trainingEndsAt: iso(new Date(Date.parse(cutoff) - 24 * HOUR_MS)), forecastCutoff: cutoff, evaluationAsOf: iso(new Date(target.kickoff.getTime() + 48 * HOUR_MS)) }],
  });
  await runBacktestPlan({ plan, receipts, orchestrator: new ForecastOrchestrator(), repository, correlationId: planId });
  const window = await database.backtestWindow.findUniqueOrThrow({ where: { id: windowId } });
  expect(window.state).toBe("SUCCEEDED");
  return { windowId, snapshotId: window.forecastSnapshotId! };
}

/** A production publication of the same identity a backtest of `target` produces. */
function publishProduction(target: Target, correlationId: string) {
  return new ForecastOrchestrator().run({
    fixtureId: target.id,
    asOf: cutoffOf(target),
    kind: "PRE_MATCH",
    modelVersion: MODEL,
    configHash: forecastConfigHashFor(MODEL),
    initiator: { type: "production", correlationId },
  }, repository);
}

const state: { publicCohorts: unknown } = { publicCohorts: null };

describe("WR-13: forecast snapshot origin on real PostgreSQL", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);

    const history: SeedFixture[] = [];
    roundRobin(8).slice(0, 6).forEach((pairs, round) => {
      pairs.forEach(([home, away], index) => {
        history.push({ id: `og-hist-${round + 1}-${index + 1}`, home: teamIds[home]!, away: teamIds[away]!, kickoff: new Date(Date.UTC(2026, 6, 2 + round * 3, 15)), goals: [(round + index) % 4, (round * 2 + index) % 3] });
      });
    });
    await seedDatabase([...history, F1, F2]);

    // Real evidence builds at exactly kickoff - 6h, sequentially (parallel work on different fixtures is a known unrelated defect).
    for (const target of [F1, F2]) {
      for (const teamId of [target.home, target.away]) {
        const buildId = await ensureTeamEvidence({ database, teamId, cutoff: cutoffOf(target) });
        expect(buildId, `evidence build for ${teamId} at ${cutoffOf(target)}`).not.toBeNull();
      }
    }
    receipts = createPrismaBacktestReceiptRepository({ database, settlementService: createSettlementPipelineService({ database }) });
    repository = createPrismaForecastRepository(database);
  }, 180_000);

  afterAll(async () => {
    await database?.$disconnect();
    try { docker("rm", "--force", "--volumes", postgresName); } catch { /* exact owned cleanup */ }
  }, 60_000);

  it("1. a V1 backtest that hits an existing production identity leaves the snapshot PRODUCTION, public and scored (D-02, D-05b)", async () => {
    const production = await publishProduction(F1, "origin-prod-f1");
    const { snapshotId } = await runBacktest("og-plan-collision", F1);

    const rows = await database.forecastSnapshot.findMany({ where: { fixtureId: F1.id } });
    expect(rows).toHaveLength(1);
    expect(snapshotId).toBe(production.id);
    expect(rows[0]).toMatchObject({ id: production.id, origin: "PRODUCTION", state: "ISSUED", revision: 1 });

    expect((await repository.findIssued!(F1.id, "PRE_MATCH", cutoffOf(F1)))?.id).toBe(production.id);
    expect((await repository.listIssued!(F1.id)).map((row) => row.id)).toEqual([production.id]);

    // The backtest scored the production snapshot: the public scorecard keeps exactly that fixture and snapshot.
    const evaluation = createPrismaEvaluationRepository(database);
    const cohort = await evaluation.loadCohort({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", ...BOUNDS });
    expect(cohort.denominators).toMatchObject({ fixtureCount: 1, forecastCount: 1, eventCount: 3 });
    state.publicCohorts = await evaluation.enumerateAvailableCohorts(BOUNDS);
    expect((state.publicCohorts as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);

  it("2. a backtest snapshot is BACKTEST and invisible to every public reader, while backtest scoring still works (D-03)", async () => {
    const { snapshotId } = await runBacktest("og-plan-isolation", F2);
    const f2Rows = await database.forecastSnapshot.findMany({ where: { fixtureId: F2.id } });
    expect(f2Rows).toHaveLength(1);
    expect(f2Rows[0]).toMatchObject({ id: snapshotId, origin: "BACKTEST", state: "ISSUED" });

    expect(await repository.findIssued!(F2.id, "PRE_MATCH", cutoffOf(F2))).toBeNull();
    expect(await repository.listIssued!(F2.id)).toEqual([]);

    const evaluation = createPrismaEvaluationRepository(database);
    const cohort = await evaluation.loadCohort({ modelVersion: "all", competitionId: "all", market: "ONE_X_TWO", ...BOUNDS });
    expect(cohort.denominators).toMatchObject({ fixtureCount: 1, forecastCount: 1, eventCount: 3 });
    expect(await evaluation.enumerateAvailableCohorts(BOUNDS)).toEqual(state.publicCohorts);

    const f1Snapshot = (await database.forecastSnapshot.findFirstOrThrow({ where: { fixtureId: F1.id } })).id;
    const comparison = createProductionRepository(database);
    expect(await comparison.findExact(snapshotId)).toBeNull();
    expect(await comparison.findExact(f1Snapshot)).not.toBeNull();
    const value = createPrismaValueRepository(database);
    expect(await value.findForecast(snapshotId)).toBeNull();
    expect(await value.findForecast(f1Snapshot)).not.toBeNull();

    // Backtest-internal scoring is untouched: the scores of the BACKTEST snapshot exist, they are just not public.
    expect(await database.forecastScore.count({ where: { fixtureId: F2.id, forecastSnapshotId: snapshotId } })).toBeGreaterThan(0);
  }, 120_000);

  it("3. a production publication that collides with a BACKTEST identity returns it and never re-labels it (D-02)", async () => {
    const existing = await database.forecastSnapshot.findFirstOrThrow({ where: { fixtureId: F2.id } });
    expect(existing.origin).toBe("BACKTEST");

    const published = await publishProduction(F2, "origin-prod-f2");

    expect(published.id).toBe(existing.id);
    expect(await database.forecastSnapshot.count({ where: { fixtureId: F2.id } })).toBe(1);
    expect((await database.forecastSnapshot.findUniqueOrThrow({ where: { id: existing.id } })).origin).toBe("BACKTEST");
    // Residual (recorded in the SUMMARY and deferred-items.md): such a production publish is invisible to public readers,
    // because the existing BACKTEST snapshot is returned unchanged instead of a new PRODUCTION one.
    expect(await repository.findIssued!(F2.id, "PRE_MATCH", cutoffOf(F2))).toBeNull();
  }, 60_000);
});
