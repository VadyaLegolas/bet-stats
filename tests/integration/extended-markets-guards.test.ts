import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import {
  buildCoreValueReceipt, buildExtendedValueReceipt, exactScoreSelections, insertValueReceipt, seedExtendedMarketsFixture, seedOddsBook,
  type ExtendedSeed, type SeededOdds,
} from "../helpers/extended-markets-seed.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-p14-guards-${process.pid}`;
let prisma: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

const AH_BOOK: ReadonlyArray<readonly [string, string]> = [["HOME", "2.1"], ["AWAY", "1.8"]];

/** All mass on 0-0: a handicap that cannot win and an exact score that cannot occur. */
const POINT_MASS = Array.from({ length: 64 }, (_, index) => [Math.floor(index / 8), index % 8, index === 0 ? 1 : 0] as const);

let persisted: ExtendedSeed;
let legacy: ExtendedSeed;
let degenerate: ExtendedSeed;
let ahOdds: SeededOdds;
let ahBad: SeededOdds;
let exactOdds: SeededOdds;
let exactBad: SeededOdds;

describe("Phase 14 value pair guard: Asian handicap and exact score", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    persisted = await seedExtendedMarketsFixture(prisma, { prefix: "g-persisted" });
    legacy = await seedExtendedMarketsFixture(prisma, { prefix: "g-legacy", persistedMatrix: false });
    degenerate = await seedExtendedMarketsFixture(prisma, { prefix: "g-point", cells: POINT_MASS });
    ahOdds = await seedOddsBook(prisma, persisted, { market: "ASIAN_HANDICAP:-0.75", selections: AH_BOOK, tag: "ah" });
    ahBad = await seedOddsBook(prisma, persisted, { market: "ASIAN_HANDICAP:-0.75", selections: AH_BOOK, tag: "ah-bad" });
    exactOdds = await seedOddsBook(prisma, persisted, { market: "EXACT_SCORE", selections: exactScoreSelections("18"), tag: "exact" });
    exactBad = await seedOddsBook(prisma, persisted, { market: "EXACT_SCORE", selections: exactScoreSelections("18"), tag: "exact-bad" });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
  });

  it("accepts handicap and exact-score receipts bound to a persisted matrix", async () => {
    await expect(insertValueReceipt(prisma, persisted, buildExtendedValueReceipt(persisted, ahOdds, "ASIAN_HANDICAP:-0.75", "HOME"))).resolves.toBe(1);
    await expect(insertValueReceipt(prisma, persisted, buildExtendedValueReceipt(persisted, ahOdds, "ASIAN_HANDICAP:-0.75", "AWAY"))).resolves.toBe(1);
    await expect(insertValueReceipt(prisma, persisted, buildExtendedValueReceipt(persisted, exactOdds, "EXACT_SCORE", "2-1"))).resolves.toBe(1);
    await expect(insertValueReceipt(prisma, persisted, buildExtendedValueReceipt(persisted, exactOdds, "EXACT_SCORE", "OTHER"))).resolves.toBe(1);
    const quarter = await seedOddsBook(prisma, persisted, { market: "ASIAN_HANDICAP:+0.25", selections: AH_BOOK, tag: "ah-quarter" });
    await expect(insertValueReceipt(prisma, persisted, buildExtendedValueReceipt(persisted, quarter, "ASIAN_HANDICAP:+0.25", "AWAY"))).resolves.toBe(1);
  });

  it.each([
    ["expectedValue", (row: { expectedValue: string }) => ({ expectedValue: String(Number(row.expectedValue) + 0.01) })],
    ["fairOdds", (row: { fairOdds: string | null }) => ({ fairOdds: String(Number(row.fairOdds) + 0.01) })],
    ["edge", (row: { edge: string }) => ({ edge: String(Number(row.edge) + 0.01) })],
    ["modelProbability", (row: { modelProbability: string }) => ({ modelProbability: String(Number(row.modelProbability) + 0.01) })],
    ["noVigProbability", (row: { noVigProbability: string }) => ({ noVigProbability: String(Number(row.noVigProbability) + 0.01) })],
  ])("rejects a forged %s on a handicap and on an exact score", async (field, forge) => {
    const ah = buildExtendedValueReceipt(persisted, ahBad, "ASIAN_HANDICAP:-0.75", "HOME", { id: `forged-ah-${field}` });
    await expect(insertValueReceipt(prisma, persisted, ah, forge(ah as never))).rejects.toThrow(/derived fields disagree/i);
    const exact = buildExtendedValueReceipt(persisted, exactBad, "EXACT_SCORE", "2-1", { id: `forged-exact-${field}` });
    await expect(insertValueReceipt(prisma, persisted, exact, forge(exact as never))).rejects.toThrow(/disagrees|derived fields disagree/i);
  });

  it("rejects a breakdown that the stored matrix does not produce, a foreign cellsHash and a wrong matrix source", async () => {
    const row = buildExtendedValueReceipt(persisted, ahBad, "ASIAN_HANDICAP:-0.75", "HOME", { id: "forged-breakdown" });
    const extended = row.receipt.extended as Record<string, unknown> & { breakdown: Record<string, string>; matrix: Record<string, unknown> };
    const swapped = { ...extended.breakdown, WIN: extended.breakdown.LOSS, LOSS: extended.breakdown.WIN };
    await expect(insertValueReceipt(prisma, persisted, row, {}, { extended: { ...extended, breakdown: swapped } })).rejects.toThrow(/breakdown disagrees with the stored score matrix/i);
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "forged-hash" }, {}, { extended: { ...extended, matrix: { ...extended.matrix, cellsHash: "sha256:other" } } })).rejects.toThrow(/matrix binding/i);
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "forged-source" }, {}, { extended: { ...extended, matrix: { ...extended.matrix, source: "REDERIVED" } } })).rejects.toThrow(/matrix binding/i);
  });

  it("rejects a missing or mismatched extended block and a drifted audit copy of the odds", async () => {
    const row = buildExtendedValueReceipt(persisted, ahBad, "ASIAN_HANDICAP:-0.75", "AWAY", { id: "forged-block" });
    const { extended: _dropped, ...withoutExtended } = row.receipt;
    await expect(insertValueReceipt(prisma, persisted, { ...row, receipt: withoutExtended })).rejects.toThrow(/requires an extended block/i);
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "forged-kind" }, {}, { extended: { ...(row.receipt.extended as object), kind: "EXACT_SCORE" } })).rejects.toThrow(/kind does not match/i);
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "forged-line" }, {}, { extended: { ...(row.receipt.extended as object), line: "-1" } })).rejects.toThrow(/kind does not match/i);
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "forged-odds" }, {}, { decimalOdds: "9" })).rejects.toThrow(/derived fields disagree/i);
  });

  it("rejects a receipt on a forecast that is not ISSUED", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt) VALUES ('g-persisted-building','g-persisted-fixture','PRE_MATCH','BUILDING',2,'g-persisted-forecast','2026-09-10T16:30:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','building-input','building-evidence','[]','{}','{}','[]','{}')`,
    );
    const row = buildExtendedValueReceipt(persisted, ahBad, "ASIAN_HANDICAP:-0.75", "HOME", { id: "forged-state" });
    await expect(insertValueReceipt(prisma, persisted, row, { forecastSnapshotId: "g-persisted-building" })).rejects.toThrow(/exact issued forecast/i);
  });

  it("accepts a legacy (REDERIVED) receipt on self-consistency and rejects a breakdown that does not sum to one", async () => {
    const odds = await seedOddsBook(prisma, legacy, { market: "ASIAN_HANDICAP:-0.25", selections: AH_BOOK, tag: "ah" });
    const row = buildExtendedValueReceipt(legacy, odds, "ASIAN_HANDICAP:-0.25", "HOME");
    expect((row.receipt.extended as { matrix: { source: string } }).matrix.source).toBe("REDERIVED");
    await expect(insertValueReceipt(prisma, legacy, row)).resolves.toBe(1);
    const bad = await seedOddsBook(prisma, legacy, { market: "ASIAN_HANDICAP:-0.25", selections: AH_BOOK, tag: "ah-bad" });
    const badRow = buildExtendedValueReceipt(legacy, bad, "ASIAN_HANDICAP:-0.25", "HOME", { id: "legacy-bad-sum" });
    const extended = badRow.receipt.extended as { breakdown: Record<string, string> };
    await expect(insertValueReceipt(prisma, legacy, badRow, {}, { extended: { ...extended, breakdown: { ...extended.breakdown, WIN: String(Number(extended.breakdown.WIN) + 0.1) } } })).rejects.toThrow(/breakdown is inconsistent/i);
    const exact = await seedOddsBook(prisma, legacy, { market: "EXACT_SCORE", selections: exactScoreSelections("18"), tag: "exact" });
    await expect(insertValueReceipt(prisma, legacy, buildExtendedValueReceipt(legacy, exact, "EXACT_SCORE", "1-0"))).resolves.toBe(1);
    await expect(insertValueReceipt(prisma, legacy, buildExtendedValueReceipt(legacy, exact, "EXACT_SCORE", "1-1", { id: "legacy-exact-range" }), { modelProbability: "1.5" })).rejects.toThrow(/out of range|derived fields disagree/i);
  });

  it.each(["ASIAN_HANDICAP:abc", "ASIAN_HANDICAP:+1.00", "ASIAN_HANDICAP:", "ASIAN_HANDICAP:-0"])("rejects the forged market id %s with a clear message, not a cast error", async (market) => {
    const oddsId = `forged-${market.length}-${market.charCodeAt(market.length - 1)}`;
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ($1,'g-persisted-fixture',$2,$1,'BOOKMAKER_BACK',$3::jsonb,'2026-09-10T16:00:00Z')`, oddsId, market, JSON.stringify({ selections: [{ selection: "HOME", decimalOdds: "2", noVigProbability: "0.5" }] }));
    const attempt = prisma.$executeRawUnsafe(
      `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ($1,'g-persisted-fixture',$2,'g-persisted-forecast',$1,'NO_VALUE','HOME','0.5','0.5','2','0','0',$3::jsonb)`,
      oddsId, market, JSON.stringify({ market, selection: "HOME", extended: {} }),
    );
    await expect(attempt).rejects.toThrow(/not a supported extended market/i);
  });

  it("keeps the three core markets on their previous branch", async () => {
    const odds = await seedOddsBook(prisma, persisted, { market: "ONE_X_TWO", selections: [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]], tag: "core" });
    const row = buildCoreValueReceipt(persisted, odds, "ONE_X_TWO", "HOME");
    await expect(insertValueReceipt(prisma, persisted, { ...row, id: "core-forged" }, { expectedValue: "0.99" })).rejects.toThrow(/derived fields disagree/i);
    await expect(insertValueReceipt(prisma, persisted, row)).resolves.toBe(1);
  });

  it("allows an absent fair odds only with a recorded reason and never a forged one", async () => {
    const odds = await seedOddsBook(prisma, degenerate, { market: "ASIAN_HANDICAP:-0.5", selections: [["HOME", "2"], ["AWAY", "2"]], tag: "ah" });
    const row = buildExtendedValueReceipt(degenerate, odds, "ASIAN_HANDICAP:-0.5", "HOME");
    expect(row.fairOdds).toBeNull();
    expect((row.receipt.extended as { fairOddsUnavailableReason: string }).fairOddsUnavailableReason).toBe("NO_WIN_PROBABILITY");
    await expect(insertValueReceipt(prisma, degenerate, { ...row, id: "null-fair-forged" }, { fairOdds: "5" })).rejects.toThrow(/derived fields disagree/i);
    await expect(insertValueReceipt(prisma, degenerate, { ...row, id: "null-reason-missing" }, {}, { extended: { ...(row.receipt.extended as object), fairOddsUnavailableReason: null } })).rejects.toThrow(/derived fields disagree/i);
    await expect(insertValueReceipt(prisma, degenerate, row)).resolves.toBe(1);

    const exact = await seedOddsBook(prisma, degenerate, { market: "EXACT_SCORE", selections: exactScoreSelections("18"), tag: "exact" });
    const zero = buildExtendedValueReceipt(degenerate, exact, "EXACT_SCORE", "3-3");
    expect(zero.fairOdds).toBeNull();
    await expect(insertValueReceipt(prisma, degenerate, zero)).resolves.toBe(1);
  });
});
