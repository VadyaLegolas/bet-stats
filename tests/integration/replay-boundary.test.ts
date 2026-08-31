// The application owns this runtime dependency; importing its resolved workspace
// copy lets this root-level boundary test bootstrap Nest before decorators load.
import "../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import type { INestApplication } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { AppModule } from "../../apps/api/src/app.module.js";
import { GET as proxyGet, POST as proxyPost } from "../../apps/web/app/internal-api/pipeline/replay/[[...path]]/route.js";
import { startReplayWorker } from "../../workers/data-sync/src/main.js";
import { createReplayWorker } from "../../workers/data-sync/src/queues/index.js";

const credential = "boundary-operator-secret";
const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const postgresName = `bet-stats-boundary-pg-${process.pid}`;
const redisName = `bet-stats-boundary-redis-${process.pid}`;
const queuePrefix = `boundary-${process.pid}`;
let databaseUrl = "";
let redisUrl = "";
let prisma: PrismaClient;
let app: INestApplication;
const workers: Array<{ close(): Promise<void> }> = [];

function docker(...args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function applyCheckedInMigrations() {
  const migrationsRoot = resolve(databaseRoot, "prisma/migrations");
  for (const migration of readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const sql = readFileSync(resolve(migrationsRoot, migration, "migration.sql"));
    execFileSync("docker", ["exec", "-i", postgresName, "psql", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "bet_stats"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
  }
}

async function startApi() {
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.QUEUE_PREFIX = queuePrefix;
  process.env.OPERATOR_CREDENTIAL = credential;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as { port: number };
  process.env.API_ORIGIN = `http://127.0.0.1:${address.port}`;
}

async function proxy(path: string[], method: "GET" | "POST", body?: Record<string, unknown>) {
  const url = `http://web.test/internal-api/pipeline/replay/${path.join("/")}`;
  const request = new NextRequest(url, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const response = await (method === "POST" ? proxyPost : proxyGet)(request, { params: Promise.resolve({ path }) });
  return { response, json: await response.json() as Record<string, unknown> };
}

async function waitForPlan(planId: string, state: "SUCCEEDED" | "FAILED") {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const result = await proxy([planId], "GET");
    if (result.json.state === state) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Replay plan did not reach ${state} within 16 seconds`);
}

async function seedReplayReferences() {
  const league = await prisma.league.create({ data: { name: "Premier League", countryCode: "GB" } });
  const season = await prisma.season.create({ data: {
    leagueId: league.id,
    label: "2026",
    startsOn: new Date("2026-08-01T00:00:00.000Z"),
    endsOn: new Date("2027-05-31T00:00:00.000Z"),
  } });
  const home = await prisma.team.create({ data: { name: "Replay Home", normalizedName: "replay home", countryCode: "GB" } });
  const away = await prisma.team.create({ data: { name: "Replay Away", normalizedName: "replay away", countryCode: "GB" } });
  await prisma.leagueExternalRef.create({ data: { leagueId: league.id, provider: "football-data.org", externalId: "PL" } });
  await prisma.seasonExternalRef.create({ data: { seasonId: season.id, provider: "football-data.org", externalId: "2026" } });
  await prisma.teamExternalRef.createMany({ data: [
    { teamId: home.id, provider: "football-data.org", externalId: "home-1" },
    { teamId: away.id, provider: "football-data.org", externalId: "away-1" },
  ] });
  await prisma.providerCapability.create({ data: {
    provider: "football-data.org",
    leagueId: league.id,
    seasonId: season.id,
    endpoint: "FIXTURES",
    supported: true,
    verifiedAt: new Date(),
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  } });
  await prisma.providerCircuitState.createMany({ data: ["FIXTURES", "RESULTS", "STANDINGS"].map((endpointFamily) => ({
    provider: "football-data.org",
    endpointFamily,
    state: "CLOSED" as const,
  })) });
  const fixture = await prisma.fixture.create({ data: {
    leagueId: league.id,
    seasonId: season.id,
    homeTeamId: home.id,
    awayTeamId: away.id,
    kickoffUtc: new Date("2026-09-02T18:00:00.000Z"),
    status: "SCHEDULED",
  } });
  await prisma.fixtureExternalRef.create({ data: { fixtureId: fixture.id, provider: "football-data.org", externalId: "result-fixture" } });
}

function replayProvider(calls: string[]) {
  const capturedAt = "2026-09-02T12:00:00.000Z";
  return {
    async fetchPremierLeagueFixtures() {
      calls.push("FIXTURES");
      return [{
        provider: "football-data.org" as const,
        externalId: "fixture-replay",
        competitionExternalId: "PL",
        seasonExternalId: "2026",
        homeTeamExternalId: "home-1",
        homeTeamName: "Replay Home",
        awayTeamExternalId: "away-1",
        awayTeamName: "Replay Away",
        kickoffUtc: "2026-09-02T20:00:00.000Z",
        status: "SCHEDULED" as const,
        capturedAt,
        sourceUpdatedAt: capturedAt,
        raw: { id: "fixture-replay" },
      }];
    },
    async fetchCompetitionResults(window: { competitionCode: "PL"; dateFrom: string; dateTo: string }) {
      calls.push("RESULTS");
      return [{
        provider: "football-data.org" as const,
        externalId: "result-fixture",
        competitionExternalId: "PL",
        seasonExternalId: "2026",
        homeTeamExternalId: "home-1",
        awayTeamExternalId: "away-1",
        kickoffUtc: "2026-09-02T18:00:00.000Z",
        homeScore: 2,
        awayScore: 1,
        capturedAt,
        sourceUpdatedAt: capturedAt,
        requestedWindow: window,
        returnedCoverage: { matchCount: 1, earliestKickoffUtc: "2026-09-02T18:00:00.000Z", latestKickoffUtc: "2026-09-02T18:00:00.000Z" },
        raw: { id: "result-fixture", score: "2-1" },
      }];
    },
    async fetchCompletedResults(window: { competitionCode: "PL"; dateFrom: string; dateTo: string }) {
      return this.fetchCompetitionResults(window);
    },
    async fetchCompetitionStandings(coverage: { competitionCode: "PL" }) {
      calls.push("STANDINGS");
      return {
        provider: "football-data.org" as const,
        competitionExternalId: "PL",
        seasonExternalId: "2026",
        capturedAt,
        sourceUpdatedAt: capturedAt,
        requestedCoverage: coverage,
        returnedCoverage: { stage: "REGULAR_SEASON", type: "TOTAL" as const, rowCount: 2 },
        rows: [
          { position: 1, teamExternalId: "home-1", teamName: "Replay Home", playedGames: 4, won: 3, draw: 1, lost: 0, points: 10, goalsFor: 8, goalsAgainst: 2, goalDifference: 6 },
          { position: 2, teamExternalId: "away-1", teamName: "Replay Away", playedGames: 4, won: 2, draw: 1, lost: 1, points: 7, goalsFor: 6, goalsAgainst: 4, goalDifference: 2 },
        ],
        raw: { competition: "PL", rows: 2 },
      };
    },
    async fetchStandings(coverage: { competitionCode: "PL" }) {
      return this.fetchCompetitionStandings(coverage);
    },
  };
}

describe("production replay proxy boundary", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", postgresName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); break; } catch (error) { if (attempt === 59) throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 500)); } }
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1);
    if (!postgresPort) throw new Error("PostgreSQL port missing");
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    applyCheckedInMigrations();
    prisma = createPrismaClient(databaseUrl);

    docker("run", "--detach", "--name", redisName, "--publish", "127.0.0.1::6379", "redis:8-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", redisName, "redis-cli", "ping"); break; } catch (error) { if (attempt === 59) throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 250)); } }
    const redisPort = docker("port", redisName, "6379/tcp").split(":").at(-1);
    if (!redisPort) throw new Error("Redis port missing");
    redisUrl = `redis://127.0.0.1:${redisPort}`;
    await seedReplayReferences();
    await startApi();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    for (const name of [postgresName, redisName]) try { docker("rm", "--force", name); } catch { /* best effort */ }
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
  });

  it("crosses Next proxy, guarded Nest, BullMQ Worker and durable PostgreSQL terminal state", async () => {
    const executions = new Map<string, number>();
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix: queuePrefix, execute: async (data) => { executions.set(data.logicalId, (executions.get(data.logicalId) ?? 0) + 1); } });
    workers.push(worker);
    const input = { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-30T10:15:00.000Z", to: "2026-08-30T10:15:00.000Z" };
    const preview = await proxy(["preview"], "POST", input);
    expect(preview.response.headers.get("cache-control")).toContain("private, no-store");
    expect(preview.json).toMatchObject({ dryRun: true, input });
    expect(JSON.stringify(preview.json)).not.toContain(credential);

    const queued = await proxy(["queue"], "POST", { previewId: preview.json.previewId, previewVersion: preview.json.previewVersion });
    expect(queued.json).toMatchObject({ queued: true, duplicate: false });
    const replayPlanId = String(queued.json.replayPlanId);
    const terminal = await waitForPlan(replayPlanId, "SUCCEEDED");
    expect(terminal.json).toMatchObject({
      state: "SUCCEEDED",
      outcome: "COMPLETED",
      delivery: { state: "DELIVERED", delivered: 1, pending: 0, retrying: 0 },
      execution: { state: "SUCCEEDED", outcome: "COMPLETED" },
      attempts: [{ attemptNumber: 1, state: "SUCCEEDED" }],
    });
    expect(await prisma.replayPlan.count({ where: { id: replayPlanId } })).toBe(1);
    expect(await prisma.syncRun.count({ where: { replayPlanId, state: "SUCCEEDED" } })).toBe(1);
    expect([...executions.values()]).toEqual([1]);

    const duplicate = await proxy(["queue"], "POST", { previewId: preview.json.previewId, previewVersion: preview.json.previewVersion });
    expect(duplicate.json).toMatchObject({ replayPlanId, queued: false, duplicate: true });
    expect(await prisma.syncRun.count({ where: { replayPlanId } })).toBe(1);

    await app.close();
    await startApi();
    expect((await proxy([replayPlanId], "GET")).json).toMatchObject({ state: "SUCCEEDED", outcome: "COMPLETED" });
  }, 30_000);

  it("projects exhausted retries as a classified durable dead letter", async () => {
    const worker = createReplayWorker({ redisUrl, database: prisma, prefix: queuePrefix, execute: async () => { throw Object.assign(new Error("raw provider secret"), { code: "PROVIDER_TIMEOUT" }); } });
    workers.push(worker);
    const input = { provider: "football-data.org", competitionId: "PL", seasonId: "dead-letter", endpointFamily: "RESULTS", from: "2026-08-31T10:15:00.000Z", to: "2026-08-31T10:15:00.000Z" };
    const preview = await proxy(["preview"], "POST", input);
    const queued = await proxy(["queue"], "POST", { previewId: preview.json.previewId, previewVersion: preview.json.previewVersion });
    const terminal = await waitForPlan(String(queued.json.replayPlanId), "FAILED");
    expect(terminal.json).toMatchObject({ state: "FAILED", outcome: "DEAD_LETTER", attempts: [
      { attemptNumber: 1, classifiedReason: "PROVIDER_TIMEOUT" },
      { attemptNumber: 2, classifiedReason: "PROVIDER_TIMEOUT" },
      { attemptNumber: 3, classifiedReason: "PROVIDER_TIMEOUT" },
    ] });
    expect(JSON.stringify(terminal.json)).not.toMatch(/raw provider secret|credential|postgresql:|redis:/i);
  }, 30_000);

  it.each(["FIXTURES", "RESULTS", "STANDINGS"] as const)("routes accepted %s work through the production replay worker", async (endpointFamily) => {
    const calls: string[] = [];
    const runtime = startReplayWorker({
      databaseUrl,
      redisUrl,
      apiToken: "test-token",
      prefix: queuePrefix,
      providerFactory: () => replayProvider(calls),
    });
    workers.push(runtime);
    const input = {
      provider: "football-data.org",
      competitionId: "PL",
      seasonId: "2026",
      endpointFamily,
      from: "2026-09-02T00:00:00.000Z",
      to: "2026-09-02T23:59:59.999Z",
    };
    const preview = await proxy(["preview"], "POST", input);
    const previewFingerprint = (preview.json.providerPolicy as { fingerprint?: string }).fingerprint;
    expect(previewFingerprint).toEqual(expect.any(String));
    const queued = await proxy(["queue"], "POST", { previewId: preview.json.previewId, previewVersion: preview.json.previewVersion });
    const terminal = await waitForPlan(String(queued.json.replayPlanId), "SUCCEEDED");

    expect(terminal.json).toMatchObject({ state: "SUCCEEDED", outcome: "COMPLETED", attempts: [{ state: "SUCCEEDED" }] });
    expect((terminal.json.providerPolicy as { approved?: { fingerprint?: string } }).approved?.fingerprint).toBe(previewFingerprint);
    expect(terminal.json.runs).toEqual([expect.objectContaining({ lane: endpointFamily === "STANDINGS" ? "standard" : "critical" })]);
    expect(calls).toEqual([endpointFamily]);
    if (endpointFamily === "FIXTURES") {
      expect(await prisma.fixtureExternalRef.findUnique({
        where: { provider_externalId: { provider: "football-data.org", externalId: "fixture-replay" } },
        include: { fixture: { include: { provenance: true } } },
      })).toMatchObject({ fixture: { status: "SCHEDULED", provenance: [{ provider: "football-data.org" }] } });
    }
  }, 30_000);

  it.each([
    ["OPEN", "RESULTS"],
    ["HALF_OPEN", "RESULTS"],
    ["MISSING", "RESULTS"],
    ["EXHAUSTED", "RESULTS"],
    ["HEADROOM", "STANDINGS"],
  ] as const)("stops %s durable policy before %s provider construction", async (scenario, endpointFamily) => {
    const calls: string[] = [];
    const input = {
      provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily,
      from: `2026-09-${scenario === "OPEN" ? "03" : scenario === "HALF_OPEN" ? "04" : scenario === "MISSING" ? "05" : scenario === "EXHAUSTED" ? "06" : "07"}T00:00:00.000Z`,
      to: `2026-09-${scenario === "OPEN" ? "03" : scenario === "HALF_OPEN" ? "04" : scenario === "MISSING" ? "05" : scenario === "EXHAUSTED" ? "06" : "07"}T23:59:59.999Z`,
    };
    const preview = await proxy(["preview"], "POST", input);
    const queued = await proxy(["queue"], "POST", { previewId: preview.json.previewId, previewVersion: preview.json.previewVersion });
    const jobPrefix = `boundary-policy-${scenario.toLowerCase()}-${process.pid}`;
    try {
      if (scenario === "MISSING") {
        await prisma.providerCircuitState.delete({ where: { provider_endpointFamily: { provider: input.provider, endpointFamily } } });
      } else if (scenario === "EXHAUSTED" || scenario === "HEADROOM") {
        await prisma.providerRequestReservation.createMany({ data: Array.from({ length: scenario === "EXHAUSTED" ? 10 : 7 }, (_, index) => ({
          provider: input.provider,
          requestDate: new Date(),
          endpoint: endpointFamily,
          jobKey: `${jobPrefix}-${index}`,
        })) });
      } else {
        await prisma.providerCircuitState.update({
          where: { provider_endpointFamily: { provider: input.provider, endpointFamily } },
          data: { state: scenario, updatedAt: new Date() },
        });
      }
      const runtime = startReplayWorker({ databaseUrl, redisUrl, apiToken: "test-token", prefix: queuePrefix, providerFactory: () => replayProvider(calls) });
      workers.push(runtime);
      const terminal = await waitForPlan(String(queued.json.replayPlanId), "FAILED");
      expect(calls).toEqual([]);
      expect(terminal.json).toMatchObject({ state: "FAILED", outcome: "DEAD_LETTER" });
      expect(JSON.stringify(terminal.json)).not.toMatch(/test-token|postgresql:|redis:/i);
    } finally {
      await prisma.providerRequestReservation.deleteMany({ where: { provider: input.provider, jobKey: { startsWith: jobPrefix } } });
      await prisma.providerCircuitState.upsert({
        where: { provider_endpointFamily: { provider: input.provider, endpointFamily } },
        create: { provider: input.provider, endpointFamily, state: "CLOSED" },
        update: { state: "CLOSED", probeLeaseToken: null, probeLeaseExpiresAt: null, updatedAt: new Date() },
      });
    }
  }, 45_000);
});
