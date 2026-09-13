import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient, resolveProviderFixture, type PrismaClient } from "@bet-stats/database";
import { classifyProviderFailure, createProviderRoute } from "@bet-stats/football-data";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-provider-fallback-${process.pid}`;
let database: PrismaClient;

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

describe("provider fallback canonical identity", () => {
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
    await database.$executeRawUnsafe(`TRUNCATE TABLE "ReconciliationCandidate", "ReconciliationCase", "FixtureProvenance", "FixtureExternalRef", "TeamExternalRef", "SeasonExternalRef", "LeagueExternalRef", "Fixture", "Team", "Season", "League" CASCADE`);
    await database.league.create({ data: { id: "league-pl", name: "Premier League", countryCode: "GB", externalRefs: { create: [{ provider: "football-data.org", externalId: "PL" }, { provider: "api-football", externalId: "39" }] } } });
    await database.season.create({ data: { id: "season-2026", leagueId: "league-pl", label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-06-01") } });
    await database.seasonExternalRef.createMany({ data: [
      { seasonId: "season-2026", leagueId: "league-pl", provider: "football-data.org", externalId: "2026" },
      { seasonId: "season-2026", leagueId: "league-pl", provider: "api-football", externalId: "2026" },
    ] });
    for (const [id, name, fd, api] of [["team-home", "Arsenal", "57", "42"], ["team-away", "Chelsea", "61", "49"]]) {
      await database.team.create({ data: { id, name, normalizedName: name.toLowerCase(), countryCode: "GB", externalRefs: { create: [{ provider: "football-data.org", externalId: fd }, { provider: "api-football", externalId: api }] } } });
    }
  });

  it("routes one eligible failure and attaches fallback identity to the existing fixture", async () => {
    await database.fixture.create({ data: { id: "fixture-canonical", leagueId: "league-pl", seasonId: "season-2026", homeTeamId: "team-home", awayTeamId: "team-away", kickoffUtc: new Date("2026-09-20T14:00:00Z"), status: "SCHEDULED", externalRefs: { create: { provider: "football-data.org", externalId: "fd-1" } } } });
    expect(classifyProviderFailure({ code: "UPSTREAM_5XX" })).toEqual({ eligible: true, trigger: "UPSTREAM_UNAVAILABLE" });
    expect(createProviderRoute({ competition: "PL", season: "2026", endpoint: "FIXTURES" }).candidates).toEqual(["football-data.org", "api-football"]);
    const result = await resolveProviderFixture(database, fixture("api-1", "2026-09-20T14:10:00Z"));
    expect(result).toEqual({ status: "resolved", fixtureId: "fixture-canonical", method: "UNIQUE_CONSERVATIVE_MATCH" });
    expect(await database.fixture.count()).toBe(1);
    expect(await database.fixtureExternalRef.findUnique({ where: { provider_externalId: { provider: "api-football", externalId: "api-1" } } })).toMatchObject({ fixtureId: "fixture-canonical" });
  });

  it("quarantines zero or multiple candidates and reuses its review case", async () => {
    await database.fixture.createMany({ data: [
      { id: "fixture-a", leagueId: "league-pl", seasonId: "season-2026", homeTeamId: "team-home", awayTeamId: "team-away", kickoffUtc: new Date("2026-09-20T14:00:00Z"), status: "SCHEDULED" },
      { id: "fixture-b", leagueId: "league-pl", seasonId: "season-2026", homeTeamId: "team-home", awayTeamId: "team-away", kickoffUtc: new Date("2026-09-20T14:05:00Z"), status: "SCHEDULED" },
    ] });
    expect(await resolveProviderFixture(database, fixture("api-ambiguous", "2026-09-20T14:02:00Z"))).toMatchObject({ status: "quarantined", candidateCount: 2 });
    expect(await resolveProviderFixture(database, fixture("api-ambiguous", "2026-09-20T14:02:00Z"))).toMatchObject({ status: "quarantined", candidateCount: 2 });
    expect(await database.reconciliationCase.count({ where: { provider: "api-football", externalId: "api-ambiguous" } })).toBe(1);
    expect(await database.fixture.count()).toBe(2);
  });

  it("keeps API-Football year 2026 independent for PL, UEL and UECL", async () => {
    for (const [leagueId, seasonId, name, externalId] of [
      ["league-uel", "season-uel-2026", "Europa League", "78"],
      ["league-uecl", "season-uecl-2026", "Conference League", "848"],
    ] as const) {
      await database.league.create({ data: { id: leagueId, name, countryCode: "EU" } });
      await database.season.create({ data: { id: seasonId, leagueId, label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-06-01") } });
      await database.leagueExternalRef.create({ data: { leagueId, provider: "api-football", externalId } });
      await database.seasonExternalRef.create({ data: { seasonId, leagueId, provider: "api-football", externalId: "2026" } });
    }

    const sharedYear = await database.seasonExternalRef.findMany({
      where: { provider: "api-football", externalId: "2026" },
      orderBy: { leagueId: "asc" },
      select: { leagueId: true, seasonId: true },
    });
    expect(sharedYear).toEqual([
      { leagueId: "league-pl", seasonId: "season-2026" },
      { leagueId: "league-uecl", seasonId: "season-uecl-2026" },
      { leagueId: "league-uel", seasonId: "season-uel-2026" },
    ]);
    await expect(database.seasonExternalRef.create({ data: {
      seasonId: "season-uel-2026", leagueId: "league-pl", provider: "poison-provider", externalId: "2026",
    } })).rejects.toThrow();
  });
});

function fixture(externalId: string, kickoffUtc: string) {
  return { provider: "api-football" as const, externalId, competitionExternalId: "39", seasonExternalId: "2026", homeTeamExternalId: "42", homeTeamName: "Arsenal", awayTeamExternalId: "49", awayTeamName: "Chelsea", kickoffUtc, status: "SCHEDULED" as const, capturedAt: "2026-09-12T12:00:00Z", sourceUpdatedAt: null, raw: { fixture: externalId } };
}
