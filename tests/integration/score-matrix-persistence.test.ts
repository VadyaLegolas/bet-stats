import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, createPrismaForecastRepository, type PrismaClient, type StoredForecastView } from "@bet-stats/database";
import {
  ForecastOrchestrator,
  forecastConfigHashFor,
  parseForecastResponse,
  parseScoreMatrixV1,
  type EvidenceProjectionDto,
  type ForecastOrchestratorRepository,
  type ForecastResponseDto,
} from "@bet-stats/domain";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { ForecastsModule } from "../../apps/api/src/modules/forecasts/forecasts.module.js";
import { ForecastsService } from "../../apps/api/src/modules/forecasts/forecasts.service.js";

/**
 * Phase 14 tracer (D-01, D-02, D-03, D-04, D-06, D-07) on real PostgreSQL: the score matrix is persisted at issuance by the
 * real ForecastOrchestrator and the real repository, the public DTO keeps its pre-phase shape on every read path, and the
 * Nest route returns Asian handicap line 0 computed from the stored matrix. Evidence is a fixed in-memory projection
 * (the evidence builder is not under test); everything from `run` to the JSON response is production code.
 */

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-score-matrix-pg-${process.pid}`;

const LEAGUE = "sm-league";
const HOME = "sm-home";
const AWAY = "sm-away";
const KICKOFF = "2026-09-13T18:00:00.000Z";
const CUTOFF = "2026-09-13T12:00:00.000Z";
const HEADERS = { "x-eligibility-region": "PL", "x-age-acknowledged": "true" } as const;
const NO_STORE = "private, no-store, max-age=0";

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

function projection(side: "home" | "away"): EvidenceProjectionDto {
  const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: CUTOFF, sourceUpdatedAt: null, payloadHash: `sha256:${side}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId: side, requestedAsOf: CUTOFF, resolvedAsOfUtc: CUTOFF, cutoffBoundary: { observedAt: CUTOFF }, state: "COMPLETE", freshness: "FRESH", buildId: `build-${side}`, publishedAt: CUTOFF,
    receipt: { requestedAsOf: CUTOFF, resolvedAsOf: CUTOFF, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: CUTOFF, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: CUTOFF, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", side === "home" ? 2.1 : 1.2, 5), form10: component("form10", side === "home" ? 1.9 : 1.3), elo: component("elo", side === "home" ? 1640 : 1420),
      homeStrength: component("homeStrength", 2.3), awayStrength: component("awayStrength", 0.9),
      goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
      restDays: component("restDays", side === "home" ? 20 : 1, 1), h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
    },
  };
}

const dixonColes = (rho: number) => ({ rho, provenance: { rho, convention: "tau-1x2-v1" as const, method: "mle-low-score-v1" as const, windowFrom: "2024-01-01T00:00:00.000Z", windowTo: CUTOFF, sampleSize: 400, tauMin: 0.9 } });

let database: PrismaClient;
let real: ReturnType<typeof createPrismaForecastRepository>;
let baseUrl = "";
let closeApp: () => Promise<void> = async () => undefined;
let service: ForecastsService;

/** The real repository with fixed evidence; `publish` can be intercepted (legacy rows) without touching the real insert path. */
function orchestratorRepository(publish?: ForecastOrchestratorRepository["publish"]): ForecastOrchestratorRepository {
  return {
    assertEligible: () => real.assertEligible(),
    findFixture: (id) => real.findFixture(id),
    findEvidence: async (teamId) => projection(teamId === HOME ? "home" : "away"),
    findOfficialLineup: async () => null,
    publish: publish ?? ((draft, context) => real.publish(draft, context)),
  };
}

type Model = "poisson-ensemble-v1" | "dixon-coles-ensemble-v1";

function issue(fixtureId: string, model: Model, options: { rho?: number; initiator?: "production" | "backtest"; legacy?: boolean } = {}): Promise<ForecastResponseDto> {
  const publish = options.legacy ? ((draft: ForecastResponseDto, context?: { origin: "PRODUCTION" | "BACKTEST" }) => real.publish(draft, context ? { origin: context.origin } : undefined)) : undefined;
  return new ForecastOrchestrator().run({
    fixtureId, asOf: CUTOFF, kind: "PRE_MATCH", modelVersion: model, configHash: forecastConfigHashFor(model),
    initiator: options.initiator === "backtest" ? { type: "backtest", correlationId: `sm-${fixtureId}`, windowId: "sm-window" } : { type: "production", correlationId: `sm-${fixtureId}` },
    ...(options.rho === undefined ? {} : { dixonColes: dixonColes(options.rho) }),
  }, orchestratorRepository(publish));
}

async function extendedMarkets(fixtureId: string, forecastId: string): Promise<{ status: number; body: Record<string, any>; cacheControl: string | null }> {
  const response = await fetch(`${baseUrl}/fixtures/${fixtureId}/forecasts/${forecastId}/extended-markets`, { headers: { ...HEADERS, "x-eligibility-checked-at": new Date().toISOString() } });
  return { status: response.status, body: await response.json() as Record<string, any>, cacheControl: response.headers.get("cache-control") };
}

async function storedEnvelope(id: string): Promise<Record<string, unknown>> {
  return (await database.forecastSnapshot.findUniqueOrThrow({ where: { id } })).receipt as Record<string, unknown>;
}

const FIXTURES = ["sm-fx-new", "sm-fx-dc", "sm-fx-backtest", "sm-fx-legacy", "sm-fx-legacy-dc", "sm-fx-tamper", "sm-fx-other"] as const;
const issued: Record<string, ForecastResponseDto> = {};

describe("score-matrix-v1 persistence and the extended-markets tracer on real PostgreSQL", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    real = createPrismaForecastRepository(database);
    await database.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('${LEAGUE}','Score Matrix League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('sm-season','${LEAGUE}','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('${HOME}','Home','home','GB',now()),('${AWAY}','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
        ${FIXTURES.map((id) => `('${id}','${LEAGUE}','sm-season','${HOME}','${AWAY}','${KICKOFF}','SCHEDULED',now())`).join(",\n")};
    `);

    process.env.DATABASE_URL = databaseUrl;
    process.env.ELIGIBILITY_ALLOWED_REGIONS = "PL";
    const app = await NestFactory.create(ForecastsModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    service = app.get(ForecastsService);
    closeApp = () => app.close();
  }, 180_000);

  afterAll(async () => {
    await closeApp();
    await database?.$disconnect();
    try { docker("rm", "--force", "--volumes", postgresName); } catch { /* exact owned cleanup */ }
  }, 60_000);

  it("1. a freshly issued snapshot stores a sealed matrix next to the DTO, and the DTO keeps its pre-phase shape on every read", async () => {
    issued.new = await issue("sm-fx-new", "poisson-ensemble-v1");
    const envelope = await storedEnvelope(issued.new.id);
    const matrix = parseScoreMatrixV1(envelope.scoreMatrix);
    expect(matrix.cells).toHaveLength(64);
    expect(matrix.cellsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(envelope)).toContain("scoreMatrix");

    expect(Object.hasOwn(issued.new, "scoreMatrix")).toBe(false);
    expect(await real.findIssued!("sm-fx-new", "PRE_MATCH", CUTOFF)).toEqual(issued.new);
    expect(await real.listIssued!("sm-fx-new")).toEqual([issued.new]);
    expect((await real.findStoredForecast!(issued.new.id))?.dto).toEqual(issued.new);
    expect(parseForecastResponse(issued.new)).toEqual(issued.new);
    expect(await database.forecastMarket.count({ where: { forecastSnapshotId: issued.new.id } })).toBe(3);
  }, 60_000);

  it("2. GET extended-markets returns line 0 for the home side from the stored matrix, with five outcomes that sum to one", async () => {
    const { status, body, cacheControl } = await extendedMarkets("sm-fx-new", issued.new!.id);
    expect(status).toBe(200);
    expect(cacheControl).toBe(NO_STORE);
    expect(body.state).toBe("AVAILABLE");
    expect(body.source).toBe("PERSISTED");
    expect(body.asianHandicap.lines).toHaveLength(1);
    const [line] = body.asianHandicap.lines;
    expect(line.line).toBe("0");
    const home = line.home.breakdown as Record<string, number>;
    expect(Object.keys(home).sort()).toEqual(["HALF_LOSS", "HALF_WIN", "LOSS", "PUSH", "WIN"]);
    expect(Math.abs(Object.values(home).reduce((sum, value) => sum + value, 0) - 1)).toBeLessThanOrEqual(1e-12);
    expect(home.HALF_WIN).toBe(0);
    expect(home.HALF_LOSS).toBe(0);
    expect(line.home.fairOdds.status).toBe("AVAILABLE");

    // The same numbers come straight from the stored cells: HOME win equals the stored ONE_X_TWO home probability.
    const stored = (await real.findStoredForecast!(issued.new!.id))!;
    const homeWin = (stored.markets.ONE_X_TWO as Array<{ selection: string; probability: number }>).find((event) => event.selection === "HOME")!.probability;
    expect(Math.abs(home.WIN! - homeWin)).toBeLessThanOrEqual(1e-12);
  }, 60_000);

  it("3. a dixon-coles snapshot persists its (corrected) matrix the same way", async () => {
    issued.dc = await issue("sm-fx-dc", "dixon-coles-ensemble-v1", { rho: -0.08 });
    expect(parseScoreMatrixV1((await storedEnvelope(issued.dc.id)).scoreMatrix).cells).toHaveLength(64);
    const { status, body } = await extendedMarkets("sm-fx-dc", issued.dc.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({ state: "AVAILABLE", source: "PERSISTED" });
  }, 60_000);

  it("4. the route hides BACKTEST snapshots, other fixtures and unknown ids (404), and rejects malformed ids (400)", async () => {
    issued.backtest = await issue("sm-fx-backtest", "poisson-ensemble-v1", { initiator: "backtest" });
    expect((await database.forecastSnapshot.findUniqueOrThrow({ where: { id: issued.backtest.id } })).origin).toBe("BACKTEST");
    expect(parseScoreMatrixV1((await storedEnvelope(issued.backtest.id)).scoreMatrix).cells).toHaveLength(64);

    expect((await extendedMarkets("sm-fx-backtest", issued.backtest.id)).status).toBe(404);
    expect((await extendedMarkets("sm-fx-other", issued.new!.id)).status).toBe(404);
    const missing = await extendedMarkets("sm-fx-new", "does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "FORECAST_NOT_FOUND" });
    const malformed = await extendedMarkets("sm-fx-new", `x${"a".repeat(128)}`);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ code: "INVALID_FORECAST_ID" });
    const guarded = await fetch(`${baseUrl}/fixtures/sm-fx-new/forecasts/${issued.new!.id}/extended-markets`);
    expect(guarded.status).toBe(403);
  }, 60_000);

  it("5. a non-ISSUED snapshot is not found", async () => {
    const original = real.findStoredForecast!;
    const patched = { ...real, findStoredForecast: async (id: string): Promise<StoredForecastView | null> => { const row = await original(id); return row ? { ...row, state: "BUILDING" } : null; } };
    const restore = (service as unknown as { repository: unknown }).repository;
    (service as unknown as { repository: unknown }).repository = patched;
    try {
      expect((await extendedMarkets("sm-fx-new", issued.new!.id)).status).toBe(404);
    } finally {
      (service as unknown as { repository: unknown }).repository = restore;
    }
  }, 60_000);

  it("6. a tampered stored matrix is UNAVAILABLE with a client-safe reason and no write", async () => {
    issued.tamper = await issue("sm-fx-tamper", "poisson-ensemble-v1");
    const before = JSON.stringify(await storedEnvelope(issued.tamper.id));
    const original = real.findStoredForecast!;
    const tampered = { ...real, findStoredForecast: async (id: string): Promise<StoredForecastView | null> => {
      const row = await original(id);
      return row ? { ...row, scoreMatrix: { ...(row.scoreMatrix as Record<string, unknown>), cellsHash: "sha256:tampered" } } : null;
    } };
    const restore = (service as unknown as { repository: unknown }).repository;
    (service as unknown as { repository: unknown }).repository = tampered;
    try {
      const { status, body } = await extendedMarkets("sm-fx-tamper", issued.tamper.id);
      expect(status).toBe(200);
      expect(body).toEqual({ state: "UNAVAILABLE", reason: "SCORE_MATRIX_UNAVAILABLE" });
    } finally {
      (service as unknown as { repository: unknown }).repository = restore;
    }
    expect(JSON.stringify(await storedEnvelope(issued.tamper.id))).toBe(before);
    expect(await database.forecastMarket.count({ where: { forecastSnapshotId: issued.tamper.id } })).toBe(3);
  }, 60_000);
});
