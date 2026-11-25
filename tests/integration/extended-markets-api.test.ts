import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, createPrismaForecastRepository, type PrismaClient, type StoredForecastView } from "@bet-stats/database";
import {
  ForecastOrchestrator,
  forecastConfigHashFor,
  parseScoreMatrixV1,
  type EvidenceProjectionDto,
  type ForecastOrchestratorRepository,
  type ForecastResponseDto,
} from "@bet-stats/domain";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { OddsModule } from "../../apps/api/src/modules/odds/odds.module.js";
import { ValueModule } from "../../apps/api/src/modules/value/value.module.js";
import { ValueService, compareValue, createPrismaValueRepository } from "../../apps/api/src/modules/value/value.service.js";
import { exactScoreSelections } from "../helpers/extended-markets-seed.js";

/**
 * Phase 14 API layer (D-11, D-13, MKT-03) on real PostgreSQL: full Asian handicap and exact-score books through the real
 * odds route, push-aware value receipts through the real value route (accepted by the SQL guard), a fail-closed 409 when
 * the score matrix cannot be proven, and the inherited POLICY gate (assumption A7) pinned for dixon-coles forecasts.
 * Forecasts are issued by the real orchestrator and repository with fixed in-memory evidence.
 */

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-p14-api-pg-${process.pid}`;

const LEAGUE = "xa-league";
const HOME = "xa-home";
const AWAY = "xa-away";
const KICKOFF = "2026-09-13T18:00:00.000Z";
const CUTOFF = "2026-09-13T12:00:00.000Z";
const HEADERS = { "x-eligibility-region": "PL", "x-age-acknowledged": "true", "content-type": "application/json" } as const;
const FIXTURES = ["xa-fx-main", "xa-fx-legacy", "xa-fx-dc", "xa-fx-tamper"] as const;

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
let oddsUrl = "";
let valueUrl = "";
let valueService: ValueService;
let closeApps: () => Promise<void> = async () => undefined;
const issued: Record<string, ForecastResponseDto> = {};

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
function issue(fixtureId: string, model: Model, options: { rho?: number; legacy?: boolean } = {}): Promise<ForecastResponseDto> {
  // A legacy publish goes through the real insert without a sealed matrix: the context hands over only the origin.
  const publish = options.legacy ? ((draft: ForecastResponseDto, context?: { origin: "PRODUCTION" | "BACKTEST" }) => real.publish(draft, context ? { origin: context.origin } : undefined)) : undefined;
  return new ForecastOrchestrator().run({
    fixtureId, asOf: CUTOFF, kind: "PRE_MATCH", modelVersion: model, configHash: forecastConfigHashFor(model),
    initiator: { type: "production", correlationId: `xa-${fixtureId}` },
    ...(options.rho === undefined ? {} : { dixonColes: dixonColes(options.rho) }),
  }, orchestratorRepository(publish));
}

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { ...HEADERS, "x-eligibility-checked-at": new Date().toISOString() }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const book = (fixtureId: string, oddsSnapshotId: string, market: string, selections: ReadonlyArray<readonly [string, string]>, extra: Record<string, unknown> = {}) => ({
  oddsSnapshotId, market, sourceLabel: "Local bookmaker", capturedAt: CUTOFF,
  selections: selections.map(([selection, decimalOdds]) => ({ selection, decimalOdds })), ...extra, fixtureId,
});
const submitOdds = (fixtureId: string, body: ReturnType<typeof book>) => post(oddsUrl, `/fixtures/${fixtureId}/odds`, body);
const compare = (fixtureId: string, forecastSnapshotId: string, oddsSnapshotId: string, market: string, selection: string) => post(valueUrl, "/value-receipts", { fixtureId, forecastSnapshotId, oddsSnapshotId, market, selection });
const receiptCount = () => database.valueReceipt.count();

const AH_BOOK = [["HOME", "1.90"], ["AWAY", "1.95"]] as const;
const CORE_BOOK = [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]] as const;

async function storedCells(forecastId: string): Promise<ReadonlyArray<readonly [number, number, number]>> {
  const stored = (await real.findStoredForecast!(forecastId))!;
  return parseScoreMatrixV1(stored.scoreMatrix).cells;
}

describe("extended markets on the odds and value API (real PostgreSQL)", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    const postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    real = createPrismaForecastRepository(database);
    await database.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('${LEAGUE}','Extended League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('xa-season','${LEAGUE}','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('${HOME}','Home','home','GB',now()),('${AWAY}','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES
        ${FIXTURES.map((id) => `('${id}','${LEAGUE}','xa-season','${HOME}','${AWAY}','${KICKOFF}','SCHEDULED',now())`).join(",\n")};
    `);
    process.env.DATABASE_URL = databaseUrl;
    process.env.ELIGIBILITY_ALLOWED_REGIONS = "PL";
    const oddsApp = await NestFactory.create(OddsModule, { logger: false });
    await oddsApp.listen(0, "127.0.0.1");
    oddsUrl = `http://127.0.0.1:${(oddsApp.getHttpServer().address() as { port: number }).port}`;
    const valueApp = await NestFactory.create(ValueModule, { logger: false });
    await valueApp.listen(0, "127.0.0.1");
    valueUrl = `http://127.0.0.1:${(valueApp.getHttpServer().address() as { port: number }).port}`;
    valueService = valueApp.get(ValueService);
    closeApps = async () => { await oddsApp.close(); await valueApp.close(); };

    issued.main = await issue("xa-fx-main", "poisson-ensemble-v1");
    issued.legacy = await issue("xa-fx-legacy", "poisson-ensemble-v1", { legacy: true });
    issued.dc = await issue("xa-fx-dc", "dixon-coles-ensemble-v1", { rho: -0.08 });
    issued.tamper = await issue("xa-fx-tamper", "poisson-ensemble-v1");
  }, 240_000);

  afterAll(async () => {
    await closeApps();
    await database?.$disconnect();
    try { docker("rm", "--force", "--volumes", postgresName); } catch { /* exact owned cleanup */ }
  }, 60_000);

  it("1. odds route: full Asian handicap and exact-score books are accepted, bad lines and books are refused", async () => {
    const handicap = await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-ah-075", "ASIAN_HANDICAP:-0.75", AH_BOOK));
    expect(handicap.status).toBe(201);
    expect(handicap.body).toMatchObject({ market: "ASIAN_HANDICAP:-0.75", schemaVersion: "manual-odds-v1", normalizationVersion: "multiplicative-v1" });
    expect(handicap.body.selections.map((row: { selection: string }) => row.selection)).toEqual(["HOME", "AWAY"]);

    const exact = await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-exact", "EXACT_SCORE", exactScoreSelections("18")));
    expect(exact.status).toBe(201);
    expect(exact.body.selections).toHaveLength(17);
    expect(exact.body.selections.reduce((sum: number, row: { noVigProbability: string }) => sum + Number(row.noVigProbability), 0)).toBeCloseTo(1, 12);

    const before = await database.manualOddsSnapshot.count();
    expect(await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-bad-line", "ASIAN_HANDICAP:-0.80", AH_BOOK))).toMatchObject({ status: 400, body: { code: "UNSUPPORTED_ODDS_MARKET" } });
    expect(await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-incomplete", "ASIAN_HANDICAP:-0.75", [["HOME", "1.90"]]))).toMatchObject({ status: 400, body: { code: "INCOMPLETE_ODDS_BOOK" } });
    expect(await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-dup", "ASIAN_HANDICAP:-0.75", [["HOME", "1.90"], ["HOME", "1.95"]]))).toMatchObject({ status: 400, body: { code: "DUPLICATE_ODDS_SELECTION" } });
    expect(await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-short-exact", "EXACT_SCORE", exactScoreSelections("18").slice(0, 16)))).toMatchObject({ status: 400, body: { code: "INCOMPLETE_ODDS_BOOK" } });
    expect(await database.manualOddsSnapshot.count()).toBe(before);

    // Replacement of the same line works; a book of another line cannot replace it.
    const replacement = await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-ah-075-v2", "ASIAN_HANDICAP:-0.75", [["HOME", "1.92"], ["AWAY", "1.93"]], { replacementOfOddsSnapshotId: "xa-odds-ah-075" }));
    expect(replacement.status).toBe(201);
    expect(replacement.body.replacementOfOddsSnapshotId).toBe("xa-odds-ah-075");
    const crossLine = await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-ah-100", "ASIAN_HANDICAP:-1", AH_BOOK, { replacementOfOddsSnapshotId: "xa-odds-ah-075" }));
    expect(crossLine).toMatchObject({ status: 409, body: { code: "ODDS_REPLACEMENT_MISMATCH" } });
  }, 60_000);

  it("2. an Asian handicap comparison on a persisted matrix returns a push-aware receipt, accepted by the SQL guard, and is idempotent", async () => {
    const first = await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "ASIAN_HANDICAP:-0.75", "HOME");
    expect(first.status).toBe(201);
    const extended = first.body.receipt.extended;
    expect(extended).toMatchObject({ kind: "ASIAN_HANDICAP", evPolicyVersion: "push-aware-ev-v1", line: "-0.75", side: "HOME", matrix: { version: "score-matrix-v1", source: "PERSISTED" } });
    expect(extended.evOutcomes.map((row: { result: string }) => row.result)).toEqual(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]);
    expect(Object.keys(extended.breakdown).sort()).toEqual(["HALF_LOSS", "HALF_WIN", "LOSS", "PUSH", "WIN"]);
    const stored = parseScoreMatrixV1(((await real.findStoredForecast!(issued.main!.id))!).scoreMatrix);
    expect(extended.matrix.cellsHash).toBe(stored.cellsHash);
    expect(first.body).toMatchObject({ market: "ASIAN_HANDICAP:-0.75", selection: "HOME", forecastSnapshotId: issued.main!.id, oddsSnapshotId: "xa-odds-ah-075" });
    expect(Number(first.body.modelProbability)).toBeGreaterThan(0);

    const row = await database.valueReceipt.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(row.market).toBe("ASIAN_HANDICAP:-0.75");
    expect(row.expectedValue.toString()).toBe(first.body.expectedValue);

    const count = await receiptCount();
    const second = await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "ASIAN_HANDICAP:-0.75", "HOME");
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await receiptCount()).toBe(count);

    const away = await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "ASIAN_HANDICAP:-0.75", "AWAY");
    expect(away.status).toBe(201);
    expect(away.body.id).not.toBe(first.body.id);
    // The two sides of one line cover the same outcomes from opposite directions.
    expect(Number(away.body.receipt.extended.breakdown.WIN)).toBeCloseTo(Number(extended.breakdown.LOSS), 9);
  }, 60_000);

  it("3. an exact-score comparison works on a persisted matrix and on a re-derived legacy matrix", async () => {
    const persisted = await compare("xa-fx-main", issued.main!.id, "xa-odds-exact", "EXACT_SCORE", "1-0");
    expect(persisted.status).toBe(201);
    expect(persisted.body.receipt.extended).toMatchObject({ kind: "EXACT_SCORE", matrix: { source: "PERSISTED" } });
    const cell = (await storedCells(issued.main!.id)).find(([home, away]) => home === 1 && away === 0)!;
    expect(Number(persisted.body.modelProbability)).toBe(cell[2]);
    const other = await compare("xa-fx-main", issued.main!.id, "xa-odds-exact", "EXACT_SCORE", "OTHER");
    expect(other.status).toBe(201);

    expect((await submitOdds("xa-fx-legacy", book("xa-fx-legacy", "xa-odds-legacy-ah", "ASIAN_HANDICAP:0", AH_BOOK))).status).toBe(201);
    const rederived = await compare("xa-fx-legacy", issued.legacy!.id, "xa-odds-legacy-ah", "ASIAN_HANDICAP:0", "HOME");
    expect(rederived.status).toBe(201);
    expect(rederived.body.receipt.extended).toMatchObject({ kind: "ASIAN_HANDICAP", matrix: { source: "REDERIVED", cellsHash: null } });
  }, 60_000);

  it("4. an unavailable matrix is a 409 SCORE_MATRIX_UNAVAILABLE with no ValueReceipt row, and the core markets are unaffected", async () => {
    expect((await submitOdds("xa-fx-tamper", book("xa-fx-tamper", "xa-odds-tamper-ah", "ASIAN_HANDICAP:0", AH_BOOK))).status).toBe(201);
    expect((await submitOdds("xa-fx-tamper", book("xa-fx-tamper", "xa-odds-tamper-core", "ONE_X_TWO", CORE_BOOK))).status).toBe(201);
    expect((await submitOdds("xa-fx-legacy", book("xa-fx-legacy", "xa-odds-legacy-exact", "EXACT_SCORE", exactScoreSelections("18")))).status).toBe(201);

    const original = real.findStoredForecast!;
    const patch = (change: (row: StoredForecastView) => StoredForecastView) => ({
      ...createPrismaValueRepository(database),
      findStoredForecast: async (id: string): Promise<StoredForecastView | null> => { const row = await original(id); return row ? change(row) : null; },
    });
    const restore = (valueService as unknown as { repository: unknown }).repository;
    try {
      const cases: Array<[string, string, string, string, string, (row: StoredForecastView) => StoredForecastView]> = [
        ["tampered seal", "xa-fx-tamper", issued.tamper!.id, "xa-odds-tamper-ah", "ASIAN_HANDICAP:0", (row) => ({ ...row, scoreMatrix: { ...(row.scoreMatrix as Record<string, unknown>), cellsHash: "sha256:tampered" } })],
        ["shifted legacy market", "xa-fx-legacy", issued.legacy!.id, "xa-odds-legacy-exact", "EXACT_SCORE", (row) => ({ ...row, markets: { ...row.markets, BTTS: (row.markets.BTTS as Array<{ probability: number }>).map((event) => ({ ...event, probability: event.probability + 1e-6 })) } })],
      ];
      for (const [, fixtureId, forecastId, oddsId, market, change] of cases) {
        (valueService as unknown as { repository: unknown }).repository = patch(change);
        const before = await receiptCount();
        const response = await compare(fixtureId, forecastId, oddsId, market, market === "EXACT_SCORE" ? "1-0" : "HOME");
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: "SCORE_MATRIX_UNAVAILABLE" });
        expect(JSON.stringify(response.body)).not.toMatch(/INVALID_SCORE_MATRIX|MISMATCH|REDERIVE/);
        expect(await receiptCount()).toBe(before);
      }
      // The core market is read from stored probabilities and never touches the matrix, so the same patched repository serves it.
      const core = await compare("xa-fx-tamper", issued.tamper!.id, "xa-odds-tamper-core", "ONE_X_TWO", "HOME");
      expect(core.status).toBe(201);
      expect(core.body.receipt.extended).toBeUndefined();
    } finally {
      (valueService as unknown as { repository: unknown }).repository = restore;
    }

    // A repository that cannot read the stored forecast at all fails closed as well, and compareValue writes nothing.
    let inserts = 0;
    const base = createPrismaValueRepository(database);
    const { findStoredForecast: _unused, ...withoutReader } = base;
    void _unused;
    await expect(compareValue({ fixtureId: "xa-fx-tamper", forecastSnapshotId: issued.tamper!.id, oddsSnapshotId: "xa-odds-tamper-ah", market: "ASIAN_HANDICAP:0", selection: "HOME" }, { ...withoutReader, insertReceipt: async (receipt) => { inserts += 1; return base.insertReceipt(receipt); } }))
      .rejects.toMatchObject({ code: "SCORE_MATRIX_UNAVAILABLE" });
    expect(inserts).toBe(0);
  }, 60_000);

  it("5. the inherited POLICY gate: poisson (forecast-config-v1) can reach VALUE_CANDIDATE, dixon-coles (forecast-config-v2) is INSUFFICIENT_EVIDENCE", async () => {
    expect(issued.main!.configVersion).toBe("forecast-config-v1");
    expect(issued.dc!.configVersion).toBe("forecast-config-v2");
    // Price the most likely scoreline at 100 and the rest at 30: a large edge and EV on a stored cell.
    const top = (await storedCells(issued.main!.id)).filter(([home, away]) => home <= 3 && away <= 3).reduce((best, cell) => (cell[2] > best[2] ? cell : best));
    const topSelection = `${top[0]}-${top[1]}`;
    expect((await submitOdds("xa-fx-main", book("xa-fx-main", "xa-odds-exact-value", "EXACT_SCORE", exactScoreSelections("30", { [topSelection]: "100" })))).status).toBe(201);
    const candidate = await compare("xa-fx-main", issued.main!.id, "xa-odds-exact-value", "EXACT_SCORE", topSelection);
    expect(candidate.status).toBe(201);
    expect(issued.main!.confidence.score).toBeGreaterThanOrEqual(0.65);
    expect(candidate.body).toMatchObject({ outcome: "VALUE_CANDIDATE", reasons: [] });
    expect(Number(candidate.body.expectedValue)).toBeGreaterThan(0.05);

    expect((await submitOdds("xa-fx-dc", book("xa-fx-dc", "xa-odds-dc-exact", "EXACT_SCORE", exactScoreSelections("30", { [topSelection]: "100" })))).status).toBe(201);
    const dixon = await compare("xa-fx-dc", issued.dc!.id, "xa-odds-dc-exact", "EXACT_SCORE", topSelection);
    expect(dixon.status).toBe(201);
    expect(dixon.body.outcome).toBe("INSUFFICIENT_EVIDENCE");
    expect(dixon.body.reasons).toContain("POLICY_CONFIG_MISMATCH");
  }, 60_000);

  it("6. a market outside the registry is UNSUPPORTED_VALUE_MARKET, a command market that differs from the book is SNAPSHOT_PAIR_MISMATCH", async () => {
    const before = await receiptCount();
    for (const market of ["ASIAN_HANDICAP:-0.80", "ASIAN_HANDICAP", "CORRECT_SCORE", "ASIAN_HANDICAP:+0.50", "ASIAN_HANDICAP:0.5"]) {
      expect(await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", market, "HOME")).toMatchObject({ status: 400, body: { code: "UNSUPPORTED_VALUE_MARKET" } });
    }
    // Same family, other line; other family; core market against an extended book.
    expect(await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "ASIAN_HANDICAP:-1", "HOME")).toMatchObject({ status: 409, body: { code: "SNAPSHOT_PAIR_MISMATCH" } });
    expect(await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "EXACT_SCORE", "1-0")).toMatchObject({ status: 409, body: { code: "SNAPSHOT_PAIR_MISMATCH" } });
    expect(await compare("xa-fx-main", issued.main!.id, "xa-odds-exact", "ONE_X_TWO", "HOME")).toMatchObject({ status: 409, body: { code: "SNAPSHOT_PAIR_MISMATCH" } });
    // A selection that does not belong to the market.
    expect((await compare("xa-fx-main", issued.main!.id, "xa-odds-ah-075", "ASIAN_HANDICAP:-0.75", "DRAW")).status).toBe(400);
    expect(await receiptCount()).toBe(before);
  }, 60_000);
});
