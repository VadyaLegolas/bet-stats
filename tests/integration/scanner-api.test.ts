import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "../../apps/web/node_modules/react-dom/server.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
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
});

void [buildExtendedValueReceipt, exactScoreSelections, insertScannerReceiptUnguarded, padDecimal, seedScannerForecast, loadScanner, createPrismaScannerRepository, TOTAL_BOOK, BTTS_BOOK, AH_BOOK, at, window];
