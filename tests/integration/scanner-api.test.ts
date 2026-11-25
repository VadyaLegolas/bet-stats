import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { EXTENDED_EDGE_DEFINITION, normalizeOddsBook } from "@bet-stats/domain";
import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import ScannerPage from "../../apps/web/app/scanner/page.js";
import { ValueModule } from "../../apps/api/src/modules/value/value.module.js";
import { createPrismaScannerRepository, loadScanner } from "../../apps/api/src/modules/value/scanner.service.js";
import {
  buildCoreValueReceipt,
  buildExtendedValueReceipt,
  exactScoreSelections,
  insertScannerReceipt,
  insertScannerReceiptUnguarded,
  padDecimal,
  seedScannerFixture,
  seedScannerForecast,
  seedScannerOdds,
  type ScannerSeed,
  type SeededOdds,
} from "../helpers/scanner-seed.js";

/**
 * Phase 15 scanner read model on real PostgreSQL (SCAN-01, SCAN-02, SCAN-03): the single-statement 7-day window read, its
 * HTTP endpoint and the server-rendered page. The container is disposable and owned by this file; the development database
 * is never touched. Tests after the tracer use their own far-future 30-day band and an explicit window, so they never see
 * each other's rows nor the tracer's real-clock fixture.
 */

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const postgresName = `bet-stats-p15-scanner-pg-${process.pid}`;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ELIGIBILITY = { "x-eligibility-region": "PL", "x-age-acknowledged": "true" } as const;
const CORE_BOOK = [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]] as const;
const TOTAL_BOOK = [["OVER_2_5", "1.95"], ["UNDER_2_5", "1.9"]] as const;
const BTTS_BOOK = [["YES", "1.85"], ["NO", "2"]] as const;
const AH_BOOK = [["HOME", "1.9"], ["AWAY", "1.95"]] as const;

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

let database: PrismaClient;
let databaseUrl = "";
let postgresPort = "";
let baseUrl = "";
let closeApp: () => Promise<void> = async () => undefined;
let sequence = 0;

/** A 30-day band start, at least 90 days ahead, one band per call. */
function band(): Date {
  sequence += 1;
  const start = new Date(Date.now() + (60 + 30 * sequence) * DAY);
  return new Date(Math.floor(start.getTime() / DAY) * DAY);
}
const at = (from: Date, hours: number): Date => new Date(from.getTime() + hours * HOUR);
const window = (from: Date) => ({ from, to: new Date(from.getTime() + 7 * DAY), limit: 200 });

interface Candidate { readonly seed: ScannerSeed; readonly odds: SeededOdds; readonly id: string }

/** One fixture with one core candidate (HOME of a 1X2 book) unless told otherwise. */
async function seedCandidate(prefix: string, kickoff: Date, options: { status?: string; origin?: "PRODUCTION" | "BACKTEST"; outcome?: string; reasons?: readonly string[]; submittedAt?: Date; createdAt?: Date; leagueName?: string; source?: string; edge?: string; expectedValue?: string; pad?: boolean } = {}): Promise<Candidate> {
  const seed = await seedScannerFixture(database, { prefix, kickoff, ...(options.status ? { status: options.status } : {}), ...(options.leagueName ? { leagueName: options.leagueName } : {}), ...(options.origin ? { forecast: { origin: options.origin } } : {}) });
  const odds = await seedScannerOdds(database, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "main", submittedAt: options.submittedAt ?? new Date(), ...(options.source ? { source: options.source } : {}) });
  const row = buildCoreValueReceipt(seed, odds, "ONE_X_TWO", "HOME");
  const id = await insertScannerReceipt(database, seed, row, {
    ...(options.outcome ? { outcome: options.outcome } : {}), ...(options.reasons ? { reasons: options.reasons } : {}),
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.edge ? { edge: options.edge } : options.pad ? { edge: padDecimal(row.edge) } : {}),
    ...(options.expectedValue ? { expectedValue: options.expectedValue } : options.pad ? { expectedValue: padDecimal(row.expectedValue) } : {}),
  });
  return { seed, odds, id };
}

async function get(path: string, headers: Record<string, string> = { ...ELIGIBILITY, "x-eligibility-checked-at": new Date().toISOString() }): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const isCore = (market: string): boolean => market === "ONE_X_TWO" || market === "OVER_UNDER_2_5" || market === "BTTS";
let counter = 0;
const uid = (label: string): string => { counter += 1; return `${label}${counter}`; };

const DEFAULT_BOOKS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  ONE_X_TWO: CORE_BOOK, OVER_UNDER_2_5: TOTAL_BOOK, BTTS: BTTS_BOOK, "ASIAN_HANDICAP:-0.75": AH_BOOK, EXACT_SCORE: exactScoreSelections("18"),
};
/** The default book of a market with one selection repriced. */
const bookWith = (market: string, selection: string, odds: string): Array<[string, string]> => DEFAULT_BOOKS[market]!.map(([name, price]) => [name, name === selection ? odds : price]);

/** A receipt row of any market; `forecastSnapshotId` redirects it to another snapshot of the same fixture. */
function buildRow(seed: ScannerSeed, odds: SeededOdds, market: string, selection: string, options: { id?: string; forecastSnapshotId?: string; outcome?: string } = {}) {
  const target = options.forecastSnapshotId ? { ...seed, forecastSnapshotId: options.forecastSnapshotId } : seed;
  const build = isCore(market) ? buildCoreValueReceipt : buildExtendedValueReceipt;
  return build(target, odds, market, selection, { outcome: options.outcome ?? "VALUE_CANDIDATE", ...(options.id ? { id: options.id } : {}) });
}

/** Stored edge of a selection at a given price, computed in memory by the same builders the seed uses. */
function edgeAt(seed: ScannerSeed, market: string, selection: string, price: string): number {
  const book = normalizeOddsBook({ fixtureId: seed.fixtureId, oddsSnapshotId: "probe", market: market as never, sourceLabel: "probe", capturedAt: "2026-01-01T00:00:00.000Z", selections: bookWith(market, selection, price).map(([name, decimalOdds]) => ({ selection: name as never, decimalOdds })) });
  return Number(buildRow(seed, { oddsSnapshotId: "probe", book, selectionIds: {} }, market, selection).edge);
}

/** The price (4 decimals) whose stored edge is closest to `target`: the edge grows with the price of the selection. */
function priceForEdge(seed: ScannerSeed, market: string, selection: string, target: number): string {
  let low = 1.01;
  let high = 2000;
  if (edgeAt(seed, market, selection, low.toFixed(4)) > target || edgeAt(seed, market, selection, high.toFixed(4)) < target) throw new Error(`edge ${target} is out of reach for ${market}/${selection}`);
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (edgeAt(seed, market, selection, middle.toFixed(4)) < target) low = middle; else high = middle;
  }
  return ((low + high) / 2).toFixed(4);
}

async function scan(now: Date) { return loadScanner({ now }, createPrismaScannerRepository(database)); }
const receiptIds = (scanner: { items: ReadonlyArray<{ receiptId: string }> }): string[] => scanner.items.map((item) => item.receiptId);

/** One core book plus one receipt on a fresh fixture; returns the pieces so a test can add more receipts to the same fixture. */
async function seedSingle(label: string, kickoff: Date, options: { fixture?: Partial<Parameters<typeof seedScannerFixture>[1]>; submittedAt?: Date } = {}) {
  const prefix = uid(label);
  const seed = await seedScannerFixture(database, { prefix, kickoff, ...options.fixture });
  const odds = await seedScannerOdds(database, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "a", submittedAt: options.submittedAt ?? new Date() });
  return { prefix, seed, odds };
}

describe("7-day value scanner on real PostgreSQL", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", postgresName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitFor(postgresName, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"]);
    postgresPort = docker("port", postgresName, "5432/tcp").split(":").at(-1)!;
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    database = createPrismaClient(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.ELIGIBILITY_ALLOWED_REGIONS = "PL";
    const app = await NestFactory.create(ValueModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    closeApp = async () => { await app.close(); };
  }, 240_000);

  afterAll(async () => {
    await closeApp();
    await database?.$disconnect();
    try { docker("rm", "--force", "--volumes", postgresName); } catch { /* exact owned cleanup */ }
  }, 60_000);

  it("tracer: one VALUE_CANDIDATE travels from PostgreSQL through GET /value/scanner to the rendered /scanner page with its stored strings", async () => {
    const kickoff = new Date(Date.now() + 48 * HOUR);
    const { seed, id } = await seedCandidate("tr", kickoff, { leagueName: "Tracer League", source: "Tracer Bookmaker", submittedAt: new Date(Date.now() - 2 * HOUR), pad: true });
    const response = await get("/value/scanner");
    expect(response.status).toBe(200);
    expect(response.body.state).toBe("AVAILABLE");
    expect(response.body.items).toHaveLength(1);
    const item = response.body.items[0];
    expect(item).toMatchObject({ receiptId: id, fixtureId: seed.fixtureId, market: "ONE_X_TWO", selection: "HOME", competition: "Tracer League", oddsSource: "Tracer Bookmaker" });
    const columns = await database.$queryRawUnsafe<Array<{ edge: string; expectedValue: string }>>(`SELECT edge, "expectedValue" FROM "ValueReceipt" WHERE id=$1`, id);
    expect(item.edge).toBe(columns[0]!.edge);
    expect(item.expectedValue).toBe(columns[0]!.expectedValue);

    process.env.API_ORIGIN = baseUrl;
    process.env.ELIGIBILITY_REGION = "PL";
    process.env.ELIGIBILITY_AGE_ACKNOWLEDGED = "true";
    const markup = renderToStaticMarkup(await ScannerPage());
    expect(markup).toContain(`id="receipt-${id}"`);
    expect(markup.split(`>${columns[0]!.edge}<`)).toHaveLength(2);
  }, 60_000);

  it("selection: the latest receipt of a (fixture, market, selection) triple wins, a createdAt tie resolves to the larger id", async () => {
    const from = band();
    const first = await seedSingle("la", at(from, 48));
    const second = await seedScannerOdds(database, first.seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "b" });
    await insertScannerReceipt(database, first.seed, buildRow(first.seed, first.odds, "ONE_X_TWO", "HOME"), { id: "la-old", createdAt: at(from, -3) });
    await insertScannerReceipt(database, first.seed, buildRow(first.seed, second, "ONE_X_TWO", "HOME"), { id: "la-new", createdAt: at(from, -1) });

    const tie = await seedSingle("lt", at(from, 49));
    const tieOther = await seedScannerOdds(database, tie.seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "b" });
    await insertScannerReceipt(database, tie.seed, buildRow(tie.seed, tie.odds, "ONE_X_TWO", "HOME"), { id: "lt-zzz", createdAt: at(from, -2) });
    await insertScannerReceipt(database, tie.seed, buildRow(tie.seed, tieOther, "ONE_X_TWO", "HOME"), { id: "lt-aaa", createdAt: at(from, -2) });

    expect(receiptIds(await scan(from))).toEqual(["la-new", "lt-zzz"]);
  }, 60_000);

  it("selection: the outcome filter runs after the latest receipt is chosen, and the hidden receipt is still counted", async () => {
    const from = band();
    const { seed, odds } = await seedSingle("of", at(from, 40));
    const newer = await seedScannerOdds(database, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "b" });
    await insertScannerReceipt(database, seed, buildRow(seed, odds, "ONE_X_TWO", "HOME"), { id: "of-candidate", createdAt: at(from, -3) });
    await insertScannerReceipt(database, seed, buildRow(seed, newer, "ONE_X_TWO", "HOME", { outcome: "NO_VALUE" }), { id: "of-no-value", createdAt: at(from, -1), outcome: "NO_VALUE" });

    const scanner = await scan(from);
    expect(scanner.items).toEqual([]);
    expect(scanner.state).toBe("EMPTY");
    expect(scanner.checkedCount).toBe(1);
    expect(scanner.outcomeCounts).toEqual({ NO_VALUE: 1 });
    expect(scanner.totalCandidates).toBe(0);
  }, 60_000);

  it("selection: a supersession link hides the receipt it points at even when that receipt is the later one", async () => {
    const from = band();
    const { seed, odds } = await seedSingle("sp", at(from, 36));
    const other = await seedScannerOdds(database, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "b" });
    await insertScannerReceipt(database, seed, buildRow(seed, odds, "ONE_X_TWO", "HOME"), { id: "sp-pointed-at", createdAt: at(from, -1) });
    // The superseding row is older by createdAt: only the link can hide the pointed-at one.
    await insertScannerReceipt(database, seed, buildRow(seed, other, "ONE_X_TWO", "HOME"), { id: "sp-superseding", createdAt: at(from, -5), supersedesValueReceiptId: "sp-pointed-at" });

    expect(receiptIds(await scan(from))).toEqual(["sp-superseding"]);
  }, 60_000);

  it("selection: the window includes a kickoff equal to from and excludes one equal to to, one second before from and the past", async () => {
    const from = band();
    const to = new Date(from.getTime() + 7 * DAY);
    const cases: Array<[string, Date, boolean]> = [
      ["wf", from, true], ["wi", new Date(to.getTime() - 1000), true], ["wt", to, false], ["wb", new Date(from.getTime() - 1000), false], ["wp", new Date(from.getTime() - DAY), false],
    ];
    const expected: Array<[Date, string]> = [];
    for (const [label, kickoff, included] of cases) {
      const { seed, odds } = await seedSingle(label, kickoff);
      const id = await insertScannerReceipt(database, seed, buildRow(seed, odds, "ONE_X_TWO", "HOME"), { id: `${label}-receipt` });
      if (included) expected.push([kickoff, id]);
    }
    const scanner = await scan(from);
    expect(receiptIds(scanner)).toEqual(expected.sort((a, b) => a[0].getTime() - b[0].getTime()).map(([, id]) => id));
    expect(scanner.checkedCount).toBe(2);
  }, 60_000);

  it("selection: only SCHEDULED fixtures are listed", async () => {
    const from = band();
    const ids: Record<string, string> = {};
    for (const [index, status] of ["SCHEDULED", "FINISHED", "POSTPONED", "LIVE"].entries()) {
      const { seed, odds } = await seedSingle(`st${index}`, at(from, 24 + index), { fixture: { status } });
      ids[status] = await insertScannerReceipt(database, seed, buildRow(seed, odds, "ONE_X_TWO", "HOME"), { id: `st${index}-receipt` });
    }
    expect(receiptIds(await scan(from))).toEqual([ids.SCHEDULED]);
  }, 60_000);

  it("selection: BACKTEST snapshots and snapshots that are not ISSUED never feed the list", async () => {
    const from = band();
    const control = await seedSingle("fc", at(from, 24));
    const controlId = await insertScannerReceipt(database, control.seed, buildRow(control.seed, control.odds, "ONE_X_TWO", "HOME"), { id: "fc-receipt" });
    const backtest = await seedSingle("fb", at(from, 25), { fixture: { forecast: { origin: "BACKTEST" } } });
    await insertScannerReceipt(database, backtest.seed, buildRow(backtest.seed, backtest.odds, "ONE_X_TWO", "HOME"), { id: "fb-receipt" });
    const building = await seedSingle("fs", at(from, 26), { fixture: { forecast: { state: "BUILDING" } } });
    // The guard refuses a receipt on a snapshot that is not ISSUED: a single bracketed insert in the disposable database.
    await insertScannerReceiptUnguarded(database, building.seed, buildRow(building.seed, building.odds, "ONE_X_TWO", "HOME"), { id: "fs-receipt" });
    const triggers = await database.$queryRawUnsafe<Array<{ tgenabled: string }>>(`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = 'ValueReceipt_validate_pair'`);
    expect(triggers[0]!.tgenabled).toBe("O");

    const scanner = await scan(from);
    expect(receiptIds(scanner)).toEqual([controlId]);
    expect(scanner.checkedCount).toBe(1);
  }, 60_000);

  /** Seeds the ordering fixtures (insertion in reverse of the expected order) with one repriced book per receipt so the edge of row k is `edges[k]`. */
  async function seedOrdering(edges: readonly number[]): Promise<{ expected: string[] }> {
    const from = band();
    const early = await seedScannerFixture(database, { prefix: uid("oe"), kickoff: at(from, 10) });
    const late = await seedScannerFixture(database, { prefix: uid("ol"), kickoff: at(from, 30) });
    const plan: Array<[ScannerSeed, string, string]> = [
      [early, "ONE_X_TWO", "HOME"], [early, "ONE_X_TWO", "AWAY"],
      [late, "ONE_X_TWO", "HOME"], [late, "ONE_X_TWO", "DRAW"], [late, "ONE_X_TWO", "AWAY"],
      [late, "OVER_UNDER_2_5", "OVER_2_5"], [late, "OVER_UNDER_2_5", "UNDER_2_5"],
      [late, "BTTS", "YES"], [late, "BTTS", "NO"],
      [late, "ASIAN_HANDICAP:-0.75", "HOME"], [late, "ASIAN_HANDICAP:-0.75", "AWAY"],
      [late, "EXACT_SCORE", "0-0"], [late, "EXACT_SCORE", "1-0"],
    ];
    expect(edges).toHaveLength(plan.length);
    const expected = plan.map(([seed, market, selection]) => `${seed.prefix}-${market}-${selection}`);
    for (let index = plan.length - 1; index >= 0; index -= 1) {
      const [seed, market, selection] = plan[index]!;
      const price = priceForEdge(seed, market, selection, edges[index]!);
      const odds = await seedScannerOdds(database, seed, { market, selections: bookWith(market, selection, price), tag: `${market}-${selection}` });
      await insertScannerReceipt(database, seed, buildRow(seed, odds, market, selection), { id: expected[index]! });
    }
    ORDERING_FROM.push(from);
    return { expected };
  }
  const ORDERING_FROM: Date[] = [];

  it("selection: rows come out by kickoff, market family and selection, never by edge", async () => {
    const descending = Array.from({ length: 13 }, (_, index) => 0.05 - 0.01 * index);
    const ascending = [...descending].reverse();
    const results: number[][] = [];
    for (const edges of [descending, ascending]) {
      const { expected } = await seedOrdering(edges);
      const scanner = await scan(ORDERING_FROM.at(-1)!);
      expect(receiptIds(scanner)).toEqual(expected);
      results.push(scanner.items.map((item) => Number(item.edge)));
    }
    // The fixtures really carried a descending and an ascending edge sequence along the returned order.
    for (let index = 1; index < 13; index += 1) {
      expect(results[0]![index]!).toBeLessThan(results[0]![index - 1]!);
      expect(results[1]![index]!).toBeGreaterThan(results[1]![index - 1]!);
    }
  }, 120_000);

  it("selection: Asian handicap rows carry the policy version and edge definition of their receipt, exact-score rows no EV policy", async () => {
    const from = band();
    const seed = await seedScannerFixture(database, { prefix: uid("ex"), kickoff: at(from, 30) });
    const ah = await seedScannerOdds(database, seed, { market: "ASIAN_HANDICAP:-0.75", selections: AH_BOOK, tag: "ah" });
    const exact = await seedScannerOdds(database, seed, { market: "EXACT_SCORE", selections: exactScoreSelections("18"), tag: "exact" });
    const ahId = await insertScannerReceipt(database, seed, buildRow(seed, ah, "ASIAN_HANDICAP:-0.75", "HOME"), { id: "ex-ah" });
    const exactId = await insertScannerReceipt(database, seed, buildRow(seed, exact, "EXACT_SCORE", "1-0"), { id: "ex-exact" });

    const scanner = await scan(from);
    const byId = new Map(scanner.items.map((item) => [item.receiptId, item]));
    const stored = await database.$queryRawUnsafe<Array<{ id: string; policy: string | null; definition: string | null; ev: string | null }>>(
      `SELECT id, receipt #>> '{receipt,valuePolicyVersion}' AS policy, receipt #>> '{receipt,extended,edgeDefinition}' AS definition, receipt #>> '{receipt,extended,evPolicyVersion}' AS ev FROM "ValueReceipt" WHERE id = ANY($1)`, [ahId, exactId],
    );
    const column = new Map(stored.map((row) => [row.id, row]));
    const handicap = byId.get(ahId)!;
    expect(handicap.valuePolicyVersion).not.toBeNull();
    expect(handicap.valuePolicyVersion).toBe(column.get(ahId)!.policy);
    expect(handicap.edgeDefinition).toBe(column.get(ahId)!.definition);
    expect(handicap.evPolicyVersion).toBe(column.get(ahId)!.ev);
    expect(handicap.edgeDefinition).toBe(EXTENDED_EDGE_DEFINITION);
    expect(handicap.evPolicyVersion).not.toBeNull();
    const score = byId.get(exactId)!;
    expect(score.valuePolicyVersion).not.toBeNull();
    expect(score.evPolicyVersion).toBeNull();
  }, 60_000);

  it("selection: forecastNewerAvailable counts only newer ISSUED PRODUCTION snapshots of the same fixture", async () => {
    const from = band();
    // F1: a receipt on an older INITIAL snapshot (flag on) and one on the newer PRE_MATCH snapshot (flag off).
    const one = await seedScannerFixture(database, { prefix: uid("f"), kickoff: at(from, 30), forecast: { kind: "INITIAL", issuedAt: at(from, -10) } });
    const oneOdds = await seedScannerOdds(database, one, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "a" });
    const newest = await seedScannerForecast(database, one, { tag: "newest", kind: "PRE_MATCH", issuedAt: at(from, -2) });
    const stale = await insertScannerReceipt(database, one, buildRow(one, oneOdds, "ONE_X_TWO", "HOME"), { id: "f-on-initial" });
    const current = await insertScannerReceipt(database, one, buildRow(one, oneOdds, "ONE_X_TWO", "DRAW", { forecastSnapshotId: newest }), { id: "f-on-newest" });
    // F2: a newer snapshot exists only on another fixture.
    const two = await seedSingle("fo", at(from, 31));
    const otherFixture = await seedScannerFixture(database, { prefix: uid("fx"), kickoff: at(from, 32), forecast: { issuedAt: at(from, -1) } });
    expect(otherFixture.fixtureId).not.toBe(two.seed.fixtureId);
    const differentFixture = await insertScannerReceipt(database, two.seed, buildRow(two.seed, two.odds, "ONE_X_TWO", "HOME"), { id: "f-other-fixture" });
    // F3: the newer snapshot is a BACKTEST one.
    const three = await seedSingle("fk", at(from, 33));
    await seedScannerForecast(database, three.seed, { tag: "backtest", kind: "INITIAL", origin: "BACKTEST", issuedAt: at(from, -1) });
    const backtestNewer = await insertScannerReceipt(database, three.seed, buildRow(three.seed, three.odds, "ONE_X_TWO", "HOME"), { id: "f-backtest" });
    // F4: the newer snapshot is not ISSUED.
    const four = await seedSingle("fn", at(from, 34));
    await seedScannerForecast(database, four.seed, { tag: "building", kind: "INITIAL", state: "BUILDING" });
    const buildingNewer = await insertScannerReceipt(database, four.seed, buildRow(four.seed, four.odds, "ONE_X_TWO", "HOME"), { id: "f-building" });

    const flags = new Map((await scan(from)).items.map((item) => [item.receiptId, item.forecastNewerAvailable]));
    expect(flags.get(stale)).toBe(true);
    expect(flags.get(current)).toBe(false);
    expect(flags.get(differentFixture)).toBe(false);
    expect(flags.get(backtestNewer)).toBe(false);
    expect(flags.get(buildingNewer)).toBe(false);
  }, 60_000);

  it("selection: the odds source, capture time and submission time come from the odds snapshot", async () => {
    const from = band();
    const prefix = uid("sc");
    const seed = await seedScannerFixture(database, { prefix, kickoff: at(from, 30) });
    const submittedAt = "2026-01-15T10:20:30.123Z";
    const capturedAt = new Date(at(from, 30).getTime() - 9 * HOUR).toISOString();
    const odds = await seedScannerOdds(database, seed, { market: "ONE_X_TWO", selections: CORE_BOOK, tag: "a", source: "Source Label Ltd", capturedAt, submittedAt });
    const id = await insertScannerReceipt(database, seed, buildRow(seed, odds, "ONE_X_TWO", "HOME"), { id: `${prefix}-receipt` });
    const stored = await database.$queryRawUnsafe<Array<{ source: string; captured: string }>>(`SELECT source, receipt ->> 'capturedAt' AS captured FROM "ManualOddsSnapshot" WHERE id = $1`, odds.oddsSnapshotId);

    const item = (await scan(from)).items.find((entry) => entry.receiptId === id)!;
    expect(item.oddsSource).toBe("Source Label Ltd");
    expect(item.oddsSource).toBe(stored[0]!.source);
    expect(item.oddsCapturedAt).toBe(capturedAt);
    expect(item.oddsCapturedAt).toBe(stored[0]!.captured);
    expect(item.oddsSubmittedAt).toBe(submittedAt);
  }, 60_000);
});

