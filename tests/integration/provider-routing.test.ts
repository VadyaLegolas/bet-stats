import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient, createProviderRoutingRepository, type PrismaClient } from "@bet-stats/database";
import { PROVIDER_ROUTE_POLICY_VERSION, routeReceiptContentHash } from "@bet-stats/domain";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-provider-routing-${process.pid}`;
let database: PrismaClient;

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

describe("provider routing repository", () => {
  beforeAll(() => {
    docker("run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "-p", "127.0.0.1::5432", "postgres:18-alpine");
    for (let i = 0; i < 60; i += 1) { try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    database = createPrismaClient(url);
  }, 120_000);

  afterAll(async () => { await database?.$disconnect(); try { docker("rm", "-f", container); } catch { /* owned cleanup */ } }, 30_000);

  beforeEach(async () => {
    await database.$executeRawUnsafe(`TRUNCATE TABLE "ProviderThrottleReservation", "ProviderQuotaObservation", "ProviderRouteAttempt", "ProviderRouteReceipt", "ProviderCapability", "ProviderCircuitState", "Season", "League" CASCADE`);
    await database.league.create({ data: { id: "league-pl", name: "Premier League", countryCode: "GB" } });
    await database.season.create({ data: { id: "season-2026", leagueId: "league-pl", label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-06-01") } });
  });

  it("minimal migrated repository appends and reads a complete denial route", async () => {
    const repository = createProviderRoutingRepository({ database });
    const receipt = {
      policyVersion: PROVIDER_ROUTE_POLICY_VERSION,
      policyHash: "sha256:route-policy",
      competitionId: "league-pl",
      seasonId: "season-2026",
      endpointFamily: "FIXTURES",
      candidates: ["football-data.org", "api-football"] as const,
      selectedProvider: null,
      trigger: "ALLOWANCE_EXHAUSTED" as const,
      outcome: "NO_FALLBACK" as const,
      capabilitySnapshot: { status: "SUPPORTED" },
      budgetSnapshot: { remaining: 0 },
      circuitSnapshot: { state: "CLOSED" },
      correlationId: "corr-minimal",
    };
    const created = await repository.appendRoute({ id: "route-minimal", contentHash: routeReceiptContentHash(receipt), ...receipt });
    expect(await repository.readRoute(created.id)).toMatchObject({ ...receipt, id: "route-minimal", attempts: [] });
  });

  it("orders exact capability and circuit checks before atomic allowance/headroom reservation", async () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    await database.providerCapability.create({ data: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true, verifiedAt: now, expiresAt: new Date("2026-09-13T00:00:00.000Z") } });
    await database.providerCircuitState.create({ data: { provider: "football-data.org", endpointFamily: "FIXTURES", state: "CLOSED" } });
    const repository = createProviderRoutingRepository({ database, now: () => now });
    const decisions = await Promise.all(Array.from({ length: 3 }, (_, index) => repository.admitAttempt({
      route: route(`route-${index}`, `corr-${index}`), attempt: { id: `attempt-${index}`, attemptKey: `job-${index}` },
      provider: "football-data.org", lane: "optional", configuredAllowance: 2, criticalHeadroom: 1,
      requestDate: new Date("2026-09-12"), throttle: { windowStart: new Date("2026-09-12T12:00:00.000Z"), windowEnd: new Date("2026-09-12T12:01:00.000Z"), limit: 10 },
    })));
    expect(decisions.filter((result) => result.admitted)).toHaveLength(1);
    expect(decisions.filter((result) => !result.admitted)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "CRITICAL_HEADROOM" })]));
    expect(await database.providerThrottleReservation.count()).toBe(1);
    expect(await database.providerRouteAttempt.count()).toBe(3);
  });

  it("fails closed before reservation and persists denial without response facts", async () => {
    const repository = createProviderRoutingRepository({ database, now: () => new Date("2026-09-12T12:00:00.000Z") });
    const denied = await repository.admitAttempt({
      route: route("route-denied", "corr-denied"), attempt: { id: "attempt-denied", attemptKey: "job-denied" },
      provider: "football-data.org", lane: "critical", configuredAllowance: 10, criticalHeadroom: 2,
      requestDate: new Date("2026-09-12"), throttle: { windowStart: new Date("2026-09-12T12:00:00.000Z"), windowEnd: new Date("2026-09-12T12:01:00.000Z"), limit: 10 },
    });
    expect(denied).toMatchObject({ admitted: false, reason: "UNKNOWN_CAPABILITY" });
    expect(await database.providerThrottleReservation.count()).toBe(0);
    expect(await database.providerRouteAttempt.findUnique({ where: { id: "attempt-denied" } })).toMatchObject({ admitted: false, observationId: null, reason: "UNKNOWN_CAPABILITY" });
  });

  it("uses allowlisted quota facts only to reduce capacity and keeps attempts idempotent", async () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    await database.providerCapability.create({ data: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true, verifiedAt: now, expiresAt: null } });
    await database.providerCircuitState.create({ data: { provider: "football-data.org", endpointFamily: "FIXTURES", state: "CLOSED" } });
    const repository = createProviderRoutingRepository({ database, now: () => now });
    const first = await repository.admitAttempt({ route: route("route-first", "corr-first"), attempt: { id: "attempt-first", attemptKey: "job-first" }, provider: "football-data.org", lane: "critical", configuredAllowance: 5, criticalHeadroom: 1, requestDate: new Date("2026-09-12"), throttle: { windowStart: now, windowEnd: new Date(now.getTime() + 60_000), limit: 10 } });
    expect(first.admitted).toBe(true);
    await repository.appendQuotaObservation({ id: "quota-low", routeAttemptId: "attempt-first", provider: "football-data.org", endpointFamily: "FIXTURES", observedLimit: 1, observedRemaining: 0, resetAt: null, observedAt: now });
    await repository.appendQuotaObservation({ id: "quota-wide", routeAttemptId: "attempt-first", provider: "football-data.org", endpointFamily: "FIXTURES", observedLimit: 100, observedRemaining: 100, resetAt: null, observedAt: new Date(now.getTime() + 1_000) });
    const secondInput = { route: route("route-second", "corr-second"), attempt: { id: "attempt-second", attemptKey: "job-second" }, provider: "football-data.org", lane: "critical" as const, configuredAllowance: 5, criticalHeadroom: 1, requestDate: new Date("2026-09-12"), throttle: { windowStart: now, windowEnd: new Date(now.getTime() + 60_000), limit: 10 } };
    expect(await repository.admitAttempt(secondInput)).toMatchObject({ admitted: false, reason: "ALLOWANCE_EXHAUSTED" });
    expect(await repository.admitAttempt(secondInput)).toMatchObject({ admitted: false, reused: true, reason: "ALLOWANCE_EXHAUSTED" });
    expect(await database.providerRouteAttempt.count({ where: { attemptKey: "job-second" } })).toBe(1);
  });
});

function route(id: string, correlationId: string) {
  const content = { policyVersion: PROVIDER_ROUTE_POLICY_VERSION, policyHash: "sha256:route-policy", competitionId: "league-pl", seasonId: "season-2026", endpointFamily: "FIXTURES", candidates: ["football-data.org"] as const, selectedProvider: "football-data.org", trigger: "PRIMARY" as const, outcome: "ADMITTED" as const, capabilitySnapshot: { status: "SUPPORTED" }, budgetSnapshot: { configuredAllowance: 5 }, circuitSnapshot: { state: "CLOSED" }, correlationId };
  return { id, contentHash: routeReceiptContentHash(content), ...content };
}
