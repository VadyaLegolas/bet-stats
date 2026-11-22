import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, createPrismaForecastRepository, fitLeagueDixonColesParameters, type PrismaClient } from "@bet-stats/database";
import { dixonColesTau } from "@bet-stats/domain";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-dixon-coles-pg-${process.pid}`;

const DAY_MS = 86_400_000;
const BASE_KICKOFF_MS = Date.parse("2025-01-01T18:00:00.000Z");
const asOf = "2026-09-20T00:00:00.000Z";
/** Before every seeded kickoff: both the league and the pooled window are empty. */
const emptyAsOf = "2024-01-01T00:00:00.000Z";
const rhoStar = -0.07;
const rhoTolerance = 0.03;
/** Two realistic expected-goal profiles, alternating so each profile keeps a large sample. */
const LAMBDA_PAIRS = [{ home: 1.25, away: 0.95 }, { home: 1.65, away: 1.35 }] as const;

let database: PrismaClient;

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

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let current = 2; current <= goals; current += 1) factorial *= current;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

/**
 * Deterministic quota allocation over the exact model grid: cells receive integer
 * counts proportional to `Poisson(λh)·Poisson(λa)·tau(ρ*)` (largest remainder).
 * This keeps the four low-score counts within one match of the model instead of
 * adding Monte-Carlo noise, so the test measures the estimator, not sampling luck.
 */
function allocateScores(lambdaHome: number, lambdaAway: number, count: number, rho: number): Array<{ homeGoals: number; awayGoals: number }> {
  const grid: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  let total = 0;
  for (let homeGoals = 0; homeGoals <= 9; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 9; awayGoals += 1) {
      const probability = poisson(homeGoals, lambdaHome) * poisson(awayGoals, lambdaAway) * dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho);
      grid.push({ homeGoals, awayGoals, probability });
      total += probability;
    }
  }
  const shares = grid.map((cell) => ({ ...cell, exact: (cell.probability / total) * count }));
  const allocated = shares.map((cell) => ({ ...cell, count: Math.floor(cell.exact) }));
  let remainder = count - allocated.reduce((sum, cell) => sum + cell.count, 0);
  const byRemainder = [...allocated].sort((left, right) => (right.exact - right.count) - (left.exact - left.count));
  for (const cell of byRemainder) {
    if (remainder <= 0) break;
    allocated.find((item) => item.homeGoals === cell.homeGoals && item.awayGoals === cell.awayGoals)!.count += 1;
    remainder -= 1;
  }
  const scores: Array<{ homeGoals: number; awayGoals: number }> = [];
  for (const cell of allocated) {
    for (let copy = 0; copy < cell.count; copy += 1) scores.push({ homeGoals: cell.homeGoals, awayGoals: cell.awayGoals });
  }
  return scores;
}

interface MatchTweak {
  readonly cutoff?: Date;
  readonly observedAt?: Date;
  readonly receipt?: Record<string, unknown>;
}

interface PlannedMatch {
  readonly id: string;
  readonly leagueId: string;
  readonly kickoff: Date;
  readonly cutoff: Date;
  readonly observedAt: Date;
  readonly lambdaHome: number;
  readonly lambdaAway: number;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly receipt: Record<string, unknown>;
}

function planLeagueMatches(prefix: string, leagueId: string, count: number, tweak?: (index: number) => MatchTweak): PlannedMatch[] {
  const groups = new Map<string, { lambdaHome: number; lambdaAway: number; members: number[] }>();
  for (let index = 0; index < count; index += 1) {
    const lambdaHome = LAMBDA_PAIRS[index % LAMBDA_PAIRS.length]!.home;
    const lambdaAway = LAMBDA_PAIRS[index % LAMBDA_PAIRS.length]!.away;
    const key = `${lambdaHome}|${lambdaAway}`;
    const group = groups.get(key) ?? { lambdaHome, lambdaAway, members: [] };
    group.members.push(index);
    groups.set(key, group);
  }

  const scores = new Map<number, { homeGoals: number; awayGoals: number }>();
  for (const group of groups.values()) {
    const allocated = allocateScores(group.lambdaHome, group.lambdaAway, group.members.length, rhoStar);
    group.members.forEach((member, position) => scores.set(member, allocated[position]!));
  }

  return Array.from({ length: count }, (_, index) => {
    const id = `${prefix}-${index}`;
    const lambdaHome = LAMBDA_PAIRS[index % LAMBDA_PAIRS.length]!.home;
    const lambdaAway = LAMBDA_PAIRS[index % LAMBDA_PAIRS.length]!.away;
    const kickoff = new Date(BASE_KICKOFF_MS + index * DAY_MS);
    const score = scores.get(index)!;
    const override = tweak ? tweak(index) : {};
    return {
      id,
      leagueId,
      kickoff,
      cutoff: override.cutoff ?? new Date(kickoff.getTime() - 3_600_000),
      observedAt: override.observedAt ?? new Date(kickoff.getTime() + 7_200_000),
      lambdaHome,
      lambdaAway,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      receipt: override.receipt ?? { forecastSnapshotId: `${id}-snap`, expectedGoals: { home: lambdaHome, away: lambdaAway } },
    };
  });
}

async function seedMatches(matches: readonly PlannedMatch[]): Promise<void> {
  if (matches.length === 0) return;
  await database.fixture.createMany({
    data: matches.map((match) => ({
      id: match.id,
      leagueId: match.leagueId,
      seasonId: `dc-season-${match.leagueId}`,
      homeTeamId: "dc-home",
      awayTeamId: "dc-away",
      kickoffUtc: match.kickoff,
      status: "FINISHED",
    })),
  });
  await database.sourceObservation.createMany({
    data: matches.map((match) => ({
      id: `${match.id}-obs`,
      provider: "test",
      endpointFamily: "RESULTS",
      externalIdentity: match.id,
      observedAt: match.observedAt,
      payloadHash: `${match.id}-hash`,
      rawPayload: {},
      payloadBytes: 2,
    })),
  });
  await database.resultVersion.createMany({
    data: matches.map((match) => ({
      id: `${match.id}-result`,
      fixtureId: match.id,
      observationId: `${match.id}-obs`,
      effectiveAt: match.observedAt,
      observedAt: match.observedAt,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      status: "FINISHED",
      revision: 1,
    })),
  });
  await database.forecastSnapshot.createMany({
    data: matches.map((match) => ({
      id: `${match.id}-snap`,
      fixtureId: match.id,
      kind: "PRE_MATCH" as const,
      state: "ISSUED" as const,
      revision: 1,
      cutoff: match.cutoff,
      modelVersion: "poisson-ensemble-v1",
      modelHash: `${match.id}-model`,
      configVersion: "forecast-config-v1",
      configHash: `${match.id}-config`,
      inputHash: `${match.id}-input`,
      evidenceFingerprint: `${match.id}-evidence`,
      sourceRefs: [] as never,
      probabilities: {} as never,
      confidence: {} as never,
      assumptions: [] as never,
      receipt: match.receipt as never,
      issuedAt: new Date(match.cutoff.getTime() + 100_000),
    })),
  });
}

async function seed(): Promise<void> {
  const leagues = ["dc-league-a", "dc-league-b", "dc-league-c", "dc-league-empty", "dc-league-lookahead", "dc-league-incomplete"];
  await database.league.createMany({ data: leagues.map((id, index) => ({ id, name: `League ${index}`, countryCode: "GB" })) });
  await database.season.createMany({
    data: leagues.map((id) => ({ id: `dc-season-${id}`, leagueId: id, label: "2026", startsOn: new Date("2025-01-01"), endsOn: new Date("2026-12-31") })),
  });
  await database.team.createMany({ data: [{ id: "dc-home", name: "Home", normalizedName: "home", countryCode: "GB" }, { id: "dc-away", name: "Away", normalizedName: "away", countryCode: "GB" }] });

  await seedMatches([
    ...planLeagueMatches("dca", "dc-league-a", 200),
    ...planLeagueMatches("dcc", "dc-league-c", 400),
    ...planLeagueMatches("dcb", "dc-league-b", 40),
  ]);

  // A snapshot issued after kickoff must never contribute.
  // A result observed after asOf must never contribute.
  await seedMatches(planLeagueMatches("dcl", "dc-league-lookahead", 2, (index) => (index === 0
    ? { cutoff: new Date(BASE_KICKOFF_MS + 3_600_000) }
    : { observedAt: new Date(Date.parse(asOf) + DAY_MS) })));

  // An incomplete historical receipt must be skipped without throwing.
  await seedMatches(planLeagueMatches("dci", "dc-league-incomplete", 1, () => ({ receipt: {} })));
}

describe("dixon-coles rho from leakage-safe league history", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    await seed();
  }, 180_000);

  afterAll(async () => {
    await database?.$disconnect();
    try { docker("rm", "--force", postgresName); } catch { /* exact owned cleanup */ }
  }, 30_000);

  it("fits per-league MLE when the league sample clears the threshold", async () => {
    const fitted = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-a", asOf });
    expect(fitted.provenance.method).toBe("mle-low-score-v1");
    expect(fitted.provenance.sampleSize).toBe(200);
    expect(fitted.provenance.convention).toBe("tau-1x2-v1");
    expect(Math.abs(fitted.rho - rhoStar)).toBeLessThan(rhoTolerance);
    expect(fitted.rho).toBe(fitted.provenance.rho);
    expect(fitted.provenance.windowTo).toBe(asOf);
    expect(fitted.provenance.tauMin).toBeGreaterThan(0);
    expect(fitted.provenance.tauMin).toBeLessThanOrEqual(1);
  });

  it("falls back to the pooled estimate for a league below the league threshold", async () => {
    const reference = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-empty", asOf });
    const fitted = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-b", asOf });
    expect(fitted.provenance.method).toBe("pooled-fallback-v1");
    expect(fitted.provenance.sampleSize).toBe(40);
    expect(Math.abs(fitted.rho - rhoStar)).toBeLessThan(rhoTolerance);
    // Same pooled rows, same deterministic estimate: no league-local leakage leaked in.
    expect(fitted.rho).toBe(reference.rho);
  });

  it("returns the explicit zero fallback when neither the league nor the pool has history", async () => {
    const fitted = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-empty", asOf: emptyAsOf });
    expect(fitted).toMatchObject({ rho: 0, provenance: { method: "insufficient-sample-zero", sampleSize: 0, tauMin: 1, convention: "tau-1x2-v1" } });
  });

  it("excludes post-kickoff cutoffs and results observed after asOf", async () => {
    const reference = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-empty", asOf });
    const fitted = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-lookahead", asOf });
    expect(fitted.provenance.sampleSize).toBe(0);
    expect(fitted.provenance.method).toBe("pooled-fallback-v1");
    // A leaked lookahead row would move rho away from the pool-only estimate.
    expect(fitted.rho).toBe(reference.rho);
  });

  it("skips incomplete receipts without throwing", async () => {
    const reference = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-empty", asOf });
    const fitted = await fitLeagueDixonColesParameters(database, { leagueId: "dc-league-incomplete", asOf });
    expect(fitted.provenance.sampleSize).toBe(0);
    expect(fitted.rho).toBe(reference.rho);
  });

  it("exposes leagueId and the rho hook through the production forecast repository", async () => {
    const repository = createPrismaForecastRepository(database);
    await expect(repository.findFixture("dca-0")).resolves.toMatchObject({ id: "dca-0", leagueId: "dc-league-a" });
    await expect(repository.findDixonColesParameters?.({ leagueId: "dc-league-a", asOf })).resolves.toMatchObject({ rho: expect.any(Number), provenance: { method: "mle-low-score-v1" } });
  });
});
