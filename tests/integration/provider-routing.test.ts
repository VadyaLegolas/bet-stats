import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient, createProviderRoutingRepository, type PrismaClient } from "@bet-stats/database";
import { PROVIDER_ROUTE_POLICY_VERSION, routeReceiptContentHash } from "@bet-stats/domain";
import { classifyProviderFailure } from "@bet-stats/football-data";
import { createFixtureJobRoute } from "../../workers/data-sync/src/jobs/fixtures.js";
import { createResultJobRoute } from "../../workers/data-sync/src/jobs/results.js";
import { createStandingsJobRoute } from "../../workers/data-sync/src/jobs/standings.js";
import { runProviderRoute } from "../../workers/data-sync/src/ingestion/runner.js";

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
    await database.$executeRawUnsafe(`TRUNCATE TABLE "ProviderThrottleReservation", "ProviderQuotaObservation", "ProviderRouteAttempt", "ProviderRouteReceipt", "ProviderCapability", "ProviderCircuitState", "SourceObservation", "Season", "League" CASCADE`);
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

  it("uses the newest coherent active-window quota sample and keeps attempts idempotent", async () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    await database.providerCapability.create({ data: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true, verifiedAt: now, expiresAt: null } });
    await database.providerCircuitState.create({ data: { provider: "football-data.org", endpointFamily: "FIXTURES", state: "CLOSED" } });
    const repository = createProviderRoutingRepository({ database, now: () => now });
    const first = await repository.admitAttempt({ route: route("route-first", "corr-first"), attempt: { id: "attempt-first", attemptKey: "job-first" }, provider: "football-data.org", lane: "critical", configuredAllowance: 5, criticalHeadroom: 1, requestDate: new Date("2026-09-12"), throttle: { windowStart: now, windowEnd: new Date(now.getTime() + 60_000), limit: 10 } });
    expect(first.admitted).toBe(true);
    await repository.appendQuotaObservation({ id: "quota-low", routeAttemptId: "attempt-first", provider: "football-data.org", endpointFamily: "FIXTURES", observedLimit: 1, observedRemaining: 0, resetAt: null, observedAt: new Date(now.getTime() - 1_000) });
    await repository.appendQuotaObservation({ id: "quota-wide", routeAttemptId: "attempt-first", provider: "football-data.org", endpointFamily: "FIXTURES", observedLimit: 100, observedRemaining: 100, resetAt: null, observedAt: now });
    const secondInput = { route: route("route-second", "corr-second"), attempt: { id: "attempt-second", attemptKey: "job-second" }, provider: "football-data.org", lane: "critical" as const, configuredAllowance: 5, criticalHeadroom: 1, requestDate: new Date("2026-09-12"), throttle: { windowStart: now, windowEnd: new Date(now.getTime() + 60_000), limit: 10 } };
    expect(await repository.admitAttempt(secondInput)).toMatchObject({ admitted: true, reason: null });
    expect(await repository.admitAttempt(secondInput)).toMatchObject({ admitted: true, reused: true, reason: null });
    expect(await database.providerRouteAttempt.count({ where: { attemptKey: "job-second" } })).toBe(1);
  });

  it("ignores an exhausted quota sample after its reset window", async () => {
    const yesterday = new Date("2026-09-12T23:00:00.000Z");
    const today = new Date("2026-09-13T00:05:00.000Z");
    await database.providerCapability.create({ data: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true, verifiedAt: yesterday, expiresAt: null } });
    await database.providerCircuitState.create({ data: { provider: "football-data.org", endpointFamily: "FIXTURES", state: "CLOSED" } });
    const repository = createProviderRoutingRepository({ database, now: () => today });
    await repository.appendRoute(route("quota-route", "quota-corr"));
    await repository.appendAttempt({ id: "quota-attempt", routeReceiptId: "quota-route", attemptKey: "quota-attempt-key", provider: "football-data.org", state: "ADMITTED", reason: null, observationId: null, admitted: true });
    await repository.appendQuotaObservation({ id: "quota-expired", routeAttemptId: "quota-attempt", provider: "football-data.org", endpointFamily: "FIXTURES", observedLimit: 5, observedRemaining: 0, resetAt: new Date("2026-09-13T00:00:00.000Z"), observedAt: yesterday });

    const admitted = await repository.admitAttempt({ route: route("route-after-reset", "corr-after-reset"), attempt: { id: "attempt-after-reset", attemptKey: "job-after-reset" }, provider: "football-data.org", lane: "critical", configuredAllowance: 5, criticalHeadroom: 1, requestDate: today, throttle: { windowStart: today, windowEnd: new Date(today.getTime() + 60_000), limit: 10 } });

    expect(admitted).toMatchObject({ admitted: true, reason: null });
  });

  it("links successful attempts to the exact immutable source receipt", async () => {
    const repository = createProviderRoutingRepository({ database });
    await repository.appendRoute(route("route-success", "corr-success"));
    await database.sourceObservation.create({ data: { id: "observation-success", provider: "football-data.org", endpointFamily: "FIXTURES", externalIdentity: "fixture:123", observedAt: new Date("2026-09-12T12:00:00.000Z"), payloadHash: "sha256:payload", rawPayload: { response: [] }, payloadBytes: 15 } });
    const attempt = { id: "attempt-success", routeReceiptId: "route-success", attemptKey: "job-success:result", provider: "football-data.org", state: "SUCCEEDED" as const, reason: null, observationId: "observation-success", admitted: true };
    expect(await repository.appendAttempt(attempt)).toMatchObject(attempt);
    expect(await repository.appendAttempt(attempt)).toMatchObject(attempt);
    await expect(repository.appendAttempt({ ...attempt, id: "attempt-substitution", attemptKey: "job-substitution", provider: "api-football" })).rejects.toThrow("ATTEMPT_OBSERVATION_MISMATCH");
  });

  it("terminal transition is idempotent and rejects conflicting replay", async () => {
    const repository = createProviderRoutingRepository({ database });
    await repository.appendRoute(route("route-terminal", "corr-terminal"));
    await repository.appendAttempt({ id: "attempt-terminal", routeReceiptId: "route-terminal", attemptKey: "terminal-key", provider: "football-data.org", state: "ADMITTED", reason: null, observationId: null, admitted: true });
    await database.sourceObservation.create({ data: { id: "observation-terminal", provider: "football-data.org", endpointFamily: "FIXTURES", externalIdentity: "league-pl:2026", observedAt: new Date("2026-09-13T10:00:00Z"), payloadHash: "sha256:terminal", rawPayload: { fixtures: [1] }, payloadBytes: 16 } });
    const terminal = { attemptKey: "terminal-key", state: "SUCCEEDED" as const, reason: null, observationId: "observation-terminal" };
    expect(await repository.completeAttempt(terminal)).toMatchObject({ state: "SUCCEEDED", observationId: "observation-terminal" });
    expect(await repository.completeAttempt(terminal)).toMatchObject({ state: "SUCCEEDED", observationId: "observation-terminal" });
    await expect(repository.completeAttempt({ ...terminal, state: "FAILED", reason: "UPSTREAM_5XX", observationId: null })).rejects.toThrow("ATTEMPT_TERMINAL_CONFLICT");
  });

  it("recovery appends primary facts without rewriting fallback history", async () => {
    const repository = createProviderRoutingRepository({ database });
    for (const [suffix, provider, observedAt] of [["fallback", "api-football", "2026-09-13T09:00:00Z"], ["primary", "football-data.org", "2026-09-13T10:00:00Z"]] as const) {
      await repository.appendRoute(route(`route-${suffix}`, `corr-${suffix}`));
      await repository.appendAttempt({ id: `attempt-${suffix}`, routeReceiptId: `route-${suffix}`, attemptKey: `key-${suffix}`, provider, state: "ADMITTED", reason: null, observationId: null, admitted: true });
      await database.sourceObservation.create({ data: { id: `observation-${suffix}`, provider, endpointFamily: "FIXTURES", externalIdentity: "league-pl:2026", observedAt: new Date(observedAt), payloadHash: `sha256:${suffix}`, rawPayload: { source: suffix }, payloadBytes: 20 } });
      await repository.completeAttempt({ attemptKey: `key-${suffix}`, state: "SUCCEEDED", reason: null, observationId: `observation-${suffix}` });
    }
    expect(await database.providerRouteReceipt.count()).toBe(2); expect(await database.providerRouteAttempt.count()).toBe(2); expect(await database.sourceObservation.count()).toBe(2);
    expect(await database.sourceObservation.findUnique({ where: { id: "observation-fallback" } })).toMatchObject({ provider: "api-football", payloadHash: "sha256:fallback" });
    expect(await database.sourceObservation.findFirst({ where: { externalIdentity: "league-pl:2026" }, orderBy: [{ observedAt: "desc" }, { id: "desc" }] })).toMatchObject({ id: "observation-primary" });
  });

  it("exposes an exact-scope transactional capability approval seam", async () => {
    const repository = createProviderRoutingRepository({ database });
    const approved = await repository.approveCapability({ provider: "api-football", leagueId: "league-pl", seasonId: "season-2026", endpoint: "STANDINGS", supported: true, verifiedAt: new Date("2026-09-12T12:00:00.000Z"), expiresAt: new Date("2026-09-13T12:00:00.000Z") });
    expect(approved).toMatchObject({ provider: "api-football", leagueId: "league-pl", seasonId: "season-2026", endpoint: "STANDINGS", supported: true });
    expect(await database.providerCapability.count()).toBe(1);
  });

  it("builds deterministic routes for every job and configured competition family", () => {
    const scope = { competition: "PL", season: "2026" };
    expect(createFixtureJobRoute(scope)).toMatchObject({ jobId: "provider-route-v1:PL:2026:FIXTURES", route: { candidates: ["football-data.org", "api-football"] } });
    expect(createResultJobRoute(scope)).toMatchObject({ jobId: "provider-route-v1:PL:2026:RESULTS", route: { candidates: ["football-data.org", "api-football"] } });
    expect(createStandingsJobRoute(scope)).toMatchObject({ jobId: "provider-route-v1:PL:2026:STANDINGS", route: { candidates: ["football-data.org", "api-football"] } });
    expect(createFixtureJobRoute({ competition: "UECL", season: "2026" }).route).toMatchObject({ candidates: ["api-football"], soleSource: true });
  });

  it("falls back once for eligible failures and returns timestamped last-valid state for sole source", async () => {
    const attempts: string[] = [];
    const fallback = await runProviderRoute({
      candidates: [{ provider: "football-data.org", factory: () => "primary" }, { provider: "api-football", factory: () => "fallback" }],
      persistRoute: async () => { attempts.push("route"); },
      persistAttempt: async ({ provider }) => { attempts.push(provider); },
      call: async (provider) => { if (provider === "primary") throw Object.assign(new Error(), { code: "UPSTREAM_5XX" }); return "facts"; },
      classifyFailure: classifyProviderFailure,
    });
    expect(fallback).toEqual({ status: "completed", provider: "api-football", value: "facts" });
    expect(attempts).toEqual(["route", "football-data.org", "api-football"]);
    const limited = await runProviderRoute({ candidates: [{ provider: "api-football", factory: () => "sole" }], persistRoute: async () => {}, persistAttempt: async () => {}, call: async () => { throw Object.assign(new Error(), { code: "UPSTREAM_5XX" }); }, classifyFailure: classifyProviderFailure, lastValid: { at: "2026-09-12T10:00:00Z", value: "old-facts" } });
    expect(limited).toEqual({ status: "limited", reason: "NO_FALLBACK", lastValidAt: "2026-09-12T10:00:00Z", lastValidValue: "old-facts" });
  });
});

function route(id: string, correlationId: string) {
  const content = { policyVersion: PROVIDER_ROUTE_POLICY_VERSION, policyHash: "sha256:route-policy", competitionId: "league-pl", seasonId: "season-2026", endpointFamily: "FIXTURES", candidates: ["football-data.org"] as const, selectedProvider: "football-data.org", trigger: "PRIMARY" as const, outcome: "ADMITTED" as const, capabilitySnapshot: { status: "SUPPORTED" }, budgetSnapshot: { configuredAllowance: 5 }, circuitSnapshot: { state: "CLOSED" }, correlationId };
  return { id, contentHash: routeReceiptContentHash(content), ...content };
}
