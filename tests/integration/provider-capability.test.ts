import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createPrismaClient, type PrismaClient } from "../../packages/database/src/client.js";
import { evaluateCapability } from "../../packages/domain/src/capability.js";
import { forecastEligibility } from "../../packages/domain/src/forecast-eligibility.js";
import { reserveProviderRequest } from "../../packages/domain/src/request-budget.js";
import type { FixtureProvider } from "../../packages/football-data/src/provider.interface.js";
import { runFixtureSyncJob } from "../../workers/data-sync/src/jobs/fixtures.js";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(workspaceRoot, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-capability-${process.pid}`;
let database: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats");
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw new Error("PostgreSQL 18 did not become ready");
}

beforeAll(async () => {
  docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
  waitForPostgres();
  const port = docker("port", containerName, "5432/tcp").split(":").at(-1);
  if (!port) throw new Error("Docker did not publish PostgreSQL");
  const connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: connectionString }, stdio: "pipe" });
  database = createPrismaClient(connectionString);
  await database.$executeRawUnsafe(`INSERT INTO "League" (id, name, "countryCode", "updatedAt") VALUES ('league-pl', 'Premier League', 'GB', now())`);
  await database.$executeRawUnsafe(`INSERT INTO "Season" (id, "leagueId", label, "startsOn", "endsOn", "updatedAt") VALUES ('season-2026', 'league-pl', '2026/27', '2026-08-01', '2027-05-31', now())`);
}, 120_000);

afterAll(async () => {
  await database?.$disconnect();
  try { docker("rm", "--force", containerName); } catch { /* best effort */ }
});

describe("provider capability", () => {
  it("denies unknown, expired, and canonical-key mismatched capability", () => {
    const expected = { provider: "football-data", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES" } as const;
    expect(evaluateCapability(undefined, expected, new Date("2026-08-28T10:00:00Z"))).toEqual({ allowed: false, reason: "UNKNOWN_CAPABILITY" });
    expect(evaluateCapability({ ...expected, supported: true, verifiedAt: new Date("2026-08-20T00:00:00Z"), expiresAt: new Date("2026-08-27T00:00:00Z") }, expected, new Date("2026-08-28T10:00:00Z"))).toEqual({ allowed: false, reason: "EXPIRED_CAPABILITY" });
    expect(evaluateCapability({ ...expected, seasonId: "wrong", supported: true, verifiedAt: new Date(), expiresAt: new Date("2026-09-01T00:00:00Z") }, expected, new Date("2026-08-28T10:00:00Z"))).toEqual({ allowed: false, reason: "CAPABILITY_MISMATCH" });
  });
});

describe("atomic request budget", () => {
  it("never exceeds the allowance under concurrency and is idempotent by job key", async () => {
    const attempts = Array.from({ length: 20 }, (_, index) => reserveProviderRequest(database, { provider: "football-data", requestDate: "2026-08-28", endpoint: "FIXTURES", jobKey: `sync-${index}`, allowance: 5 }));
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.reserved)).toHaveLength(5);
    const retry = await reserveProviderRequest(database, { provider: "football-data", requestDate: "2026-08-28", endpoint: "FIXTURES", jobKey: "sync-0", allowance: 5 });
    expect(retry).toEqual({ reserved: true, reused: true });
    const count = await database.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "ProviderRequestReservation" WHERE provider = 'football-data' AND "requestDate" = '2026-08-28' AND endpoint = 'FIXTURES'`);
    expect(Number(count[0]?.count)).toBe(5);
  });
});

describe("forecast eligibility", () => {
  it("fails closed with a stable reason for unresolved identity", () => {
    expect(forecastEligibility("UNRESOLVED")).toEqual({ eligible: false, reason: "UNRESOLVED_CANONICAL_IDENTITY" });
    expect(forecastEligibility("RESOLVED")).toEqual({ eligible: true });
  });
});

describe("guarded fixture ingestion", () => {
  it("performs zero provider I/O when persisted capability denies the endpoint", async () => {
    const providerFactory = vi.fn<() => FixtureProvider>();
    const result = await runFixtureSyncJob({
      database,
      leagueId: "league-pl",
      seasonId: "season-2026",
      jobKey: "fixtures-denied",
      allowance: 10,
      now: new Date("2026-08-29T10:00:00Z"),
      providerFactory,
    });
    expect(result).toEqual({ status: "denied", reason: "UNKNOWN_CAPABILITY" });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("reserves before I/O and reruns without duplicate canonical facts", async () => {
    await database.providerCapability.upsert({
      where: { provider_leagueId_seasonId_endpoint: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES" } },
      create: { provider: "football-data.org", leagueId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES", supported: true, verifiedAt: new Date("2026-08-28T00:00:00Z"), expiresAt: new Date("2026-09-30T00:00:00Z") },
      update: { supported: true, expiresAt: new Date("2026-09-30T00:00:00Z") },
    });
    for (const team of [{ id: "team-home", externalId: "57", name: "Arsenal FC" }, { id: "team-away", externalId: "61", name: "Chelsea FC" }]) {
      await database.team.upsert({ where: { id: team.id }, create: { id: team.id, name: team.name, normalizedName: team.name.toLowerCase(), countryCode: "GB" }, update: {} });
      await database.teamExternalRef.upsert({ where: { provider_externalId: { provider: "football-data.org", externalId: team.externalId } }, create: { teamId: team.id, provider: "football-data.org", externalId: team.externalId }, update: {} });
    }
    const events: string[] = [];
    const providerFactory = () => ({
      fetchPremierLeagueFixtures: async () => {
        const reservations = await database.providerRequestReservation.count({ where: { provider: "football-data.org", requestDate: new Date("2026-08-29"), endpoint: "FIXTURES", jobKey: "fixtures-2026-08-29" } });
        events.push(`fetch-after-${reservations}`);
        return [{ provider: "football-data.org", externalId: "497410", competitionExternalId: "PL", seasonExternalId: "2287", homeTeamExternalId: "57", homeTeamName: "Arsenal FC", awayTeamExternalId: "61", awayTeamName: "Chelsea FC", kickoffUtc: "2026-08-30T14:00:00Z", status: "SCHEDULED", capturedAt: "2026-08-29T10:00:00.000Z", sourceUpdatedAt: null, raw: { id: 497410, lastUpdated: null } }];
      },
    } satisfies FixtureProvider);
    const input = { database, leagueId: "league-pl", seasonId: "season-2026", jobKey: "fixtures-2026-08-29", allowance: 10, now: new Date("2026-08-29T10:00:00Z"), providerFactory };
    await runFixtureSyncJob(input);
    await runFixtureSyncJob(input);
    expect(events).toEqual(["fetch-after-1", "fetch-after-1"]);
    expect(await database.providerRequestReservation.count({ where: { jobKey: input.jobKey } })).toBe(1);
    expect(await database.fixtureExternalRef.count({ where: { provider: "football-data.org", externalId: "497410" } })).toBe(1);
    expect(await database.fixture.count({ where: { externalRefs: { some: { provider: "football-data.org", externalId: "497410" } } } })).toBe(1);
  });
});
