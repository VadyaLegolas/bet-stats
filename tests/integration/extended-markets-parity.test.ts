import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { AH_LINES_V1, parseAhLineToken, settleAsianHandicap, settleExactScore, settleExtendedMarket, settleFlatOneUnitV2, type AhResult } from "@bet-stats/domain";

import { buildCoreValueReceipt, buildExtendedValueReceipt, exactScoreSelections, insertValueReceipt, seedExtendedMarketsFixture, seedOddsBook, type ExtendedSeed } from "../helpers/extended-markets-seed.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-p14-parity-${process.pid}`;
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

const TOKENS = [...AH_LINES_V1.lines];
const EXACT_SELECTIONS = exactScoreSelections().map(([selection]) => selection);

/** Pathological canonical odds: 20 fractional digits, and 107 integer digits. */
const FRACTIONAL_ODDS = "2.12345678901234567891";
const HUGE_ODDS = `${"9".repeat(107)}.5`;
/** The largest canonical odds (107 + 1 + 20 = 128 characters): its half-win return needs a 129th character. */
const OVERLONG_ODDS = `${"9".repeat(107)}.12345678901234567891`;
const ODDS_VARIANTS: ReadonlyArray<readonly [string, string]> = [["ordinary", "2.4"], ["fractional", FRACTIONAL_ODDS], ["huge", HUGE_ODDS]];

/** Final score 1-0: these five home-side handicap markets realise every one of the five results. */
const RESULT_MARKETS: ReadonlyArray<readonly [AhResult, string]> = [
  ["WIN", "ASIAN_HANDICAP:-0.5"], ["HALF_WIN", "ASIAN_HANDICAP:-0.75"], ["PUSH", "ASIAN_HANDICAP:-1"],
  ["HALF_LOSS", "ASIAN_HANDICAP:-1.25"], ["LOSS", "ASIAN_HANDICAP:-1.5"],
];

let seed: ExtendedSeed;
const persistedIds = new Map<string, { value: string; selection: string; market: string; odds: string; result: AhResult }>();

async function persistV2(id: string, valueId: string, selectionId: string, result: string, closingId: string | null = null, settlementId = seed.settlementReceiptId) {
  return prisma.$queryRawUnsafe<Array<{ id: string; supersedesValueSettlementId: string | null }>>(`SELECT * FROM persist_value_settlement_v2($1,$2,$3,$4,$5,NULL,$6)`, id, settlementId, valueId, selectionId, closingId, result);
}

describe("TS producer and SQL verifier of the extended markets", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    seed = await seedExtendedMarketsFixture(prisma, { prefix: "parity", homeGoals: 1, awayGoals: 0 });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
  });

  it("phase14_ah_result equals settleAsianHandicap on 21 lines x 2 sides x 0..10 x 0..10 (5082 combinations)", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ token: string; side: string; home: number; away: number; result: string | null }>>(
      `SELECT t.token, s.side, h AS home, a AS away,
              phase14_ah_result(phase14_market_line('ASIAN_HANDICAP:' || t.token), s.side, h, a) AS result
       FROM unnest($1::text[]) AS t(token), (VALUES ('HOME'),('AWAY')) AS s(side), generate_series(0,10) AS h, generate_series(0,10) AS a`,
      TOKENS,
    );
    expect(rows).toHaveLength(21 * 2 * 11 * 11);
    const mismatches = rows.filter((row) => row.result !== settleAsianHandicap(row.token, row.side as "HOME" | "AWAY", row.home, row.away).result);
    expect(mismatches).toEqual([]);
    expect(new Set(rows.map((row) => row.result))).toEqual(new Set(["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]));
  });

  it("phase14_market_line accepts the 21 canonical tokens and returns NULL for everything else, like the TS whitelist", async () => {
    const accepted = await prisma.$queryRawUnsafe<Array<{ token: string; line: string | null }>>(`SELECT t.token, phase14_market_line('ASIAN_HANDICAP:' || t.token)::text AS line FROM unnest($1::text[]) AS t(token)`, TOKENS);
    expect(accepted).toHaveLength(21);
    for (const row of accepted) expect(Number(row.line)).toBe(Number(row.token));
    const forged = ["+1.00", "0.0", "-0", "1e0", "abc", "", "+0", "0.25", "+2.75", "-3", " 0", "+0.250", "--1", "+1,5"];
    const rejected = await prisma.$queryRawUnsafe<Array<{ token: string; line: string | null }>>(`SELECT t.token, phase14_market_line('ASIAN_HANDICAP:' || t.token)::text AS line FROM unnest($1::text[]) AS t(token)`, forged);
    expect(rejected.filter((row) => row.line !== null)).toEqual([]);
    for (const token of forged) expect(parseAhLineToken(token)).toBeNull();
    const notAMarket = await prisma.$queryRawUnsafe<Array<{ line: string | null }>>(`SELECT phase14_market_line(m)::text AS line FROM unnest($1::text[]) AS m`, ["ASIAN_HANDICAP", "ONE_X_TWO", "asian_handicap:0", "EXACT_SCORE"]);
    expect(notAMarket.map((row) => row.line)).toEqual([null, null, null, null]);
  });

  it("phase14_exact_score_result equals settleExactScore for every selection and score 0..8 x 0..8", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ selection: string; home: number; away: number; result: string | null }>>(
      `SELECT s.selection, h AS home, a AS away, phase14_exact_score_result(s.selection, h, a) AS result FROM unnest($1::text[]) AS s(selection), generate_series(0,8) AS h, generate_series(0,8) AS a`,
      EXACT_SELECTIONS,
    );
    expect(rows).toHaveLength(17 * 81);
    expect(rows.filter((row) => row.result !== settleExactScore(row.selection, row.home, row.away).result)).toEqual([]);
    const unknown = await prisma.$queryRawUnsafe<Array<{ result: string | null }>>(`SELECT phase14_exact_score_result(s,1,1) AS result FROM unnest($1::text[]) AS s`, ["4-0", "other", "01-1", "1-1 ", ""]);
    expect(unknown.map((row) => row.result)).toEqual([null, null, null, null, null]);
  });

  it("money arithmetic of persist_value_settlement_v2 equals settleFlatOneUnitV2 on ordinary and pathological odds", async () => {
    for (const [result, market] of RESULT_MARKETS) {
      expect(settleExtendedMarket({ market: market as never, selection: "HOME", homeGoals: 1, awayGoals: 0 }).result).toBe(result);
      for (const [label, homeOdds] of ODDS_VARIANTS) {
        const odds = await seedOddsBook(prisma, seed, { market, selections: [["HOME", homeOdds], ["AWAY", "1.9"]], tag: `${result}-${label}` });
        const row = buildExtendedValueReceipt(seed, odds, market, "HOME", { outcome: "VALUE_CANDIDATE" });
        await insertValueReceipt(prisma, seed, row);
        const [persisted] = await persistV2(`parity-fact-${result}-${label}`, row.id, odds.selectionIds.HOME!, result);
        const stored = (await prisma.$queryRawUnsafe<Array<{ result: string; stakeUnits: string; returnUnits: string; profitUnits: string; policyVersion: string }>>(`SELECT result,"stakeUnits","returnUnits","profitUnits","policyVersion" FROM "ValueSettlement" WHERE id=$1`, persisted!.id))[0]!;
        const expected = settleFlatOneUnitV2({ valueOutcome: "VALUE_CANDIDATE", result, decimalOdds: homeOdds });
        if (expected.status !== "SETTLED") throw new Error("expected a settled receipt");
        expect(stored).toEqual({ result, stakeUnits: "1", returnUnits: expected.returnUnits, profitUnits: expected.profitUnits, policyVersion: "flat-one-unit-v2" });
        persistedIds.set(`${result}-${label}`, { value: row.id, selection: odds.selectionIds.HOME!, market, odds: homeOdds, result });
      }
    }
    expect(persistedIds.size).toBe(15);
  }, 120_000);

  it("settles exact-score selections as WIN or LOSS through the same SQL verifier", async () => {
    const odds = await seedOddsBook(prisma, seed, { market: "EXACT_SCORE", selections: exactScoreSelections("12.5"), tag: "exact" });
    for (const [selection, result] of [["1-0", "WIN"], ["2-1", "LOSS"], ["OTHER", "LOSS"]] as const) {
      const row = buildExtendedValueReceipt(seed, odds, "EXACT_SCORE", selection, { outcome: "VALUE_CANDIDATE" });
      await insertValueReceipt(prisma, seed, row);
      const [persisted] = await persistV2(`parity-exact-${selection}`, row.id, odds.selectionIds[selection]!, result);
      const stored = (await prisma.$queryRawUnsafe<Array<{ returnUnits: string }>>(`SELECT "returnUnits" FROM "ValueSettlement" WHERE id=$1`, persisted!.id))[0]!;
      expect(stored.returnUnits).toBe(result === "WIN" ? "12.5" : "0");
    }
  });

  it("the guard rejects a wrong result, a policy bound to the wrong market family, forged arithmetic and mutation", async () => {
    const half = { ...persistedIds.get("HALF_WIN-ordinary")! };
    // A fresh value receipt: a repeated call for an already settled receipt converges to the stored fact before any check.
    const fresh = await seedOddsBook(prisma, seed, { market: "ASIAN_HANDICAP:-0.75", selections: [["HOME", "2.2"], ["AWAY", "1.7"]], tag: "fresh" });
    const freshRow = buildExtendedValueReceipt(seed, fresh, "ASIAN_HANDICAP:-0.75", "HOME", { outcome: "VALUE_CANDIDATE" });
    await insertValueReceipt(prisma, seed, freshRow);
    half.value = freshRow.id;
    half.selection = fresh.selectionIds.HOME!;
    await expect(persistV2("parity-wrong-result", half.value, half.selection, "WIN")).rejects.toThrow(/value result identity is inconsistent/i);
    await expect(persistV2("parity-invalid-result", half.value, half.selection, "VOID")).rejects.toThrow(/not an extended result/i);

    // v2 on a core market: the policy is bound to the market family.
    const core = await seedOddsBook(prisma, seed, { market: "ONE_X_TWO", selections: [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]], tag: "core" });
    const coreRow = buildCoreValueReceipt(seed, core, "ONE_X_TWO", "HOME");
    await insertValueReceipt(prisma, seed, coreRow);
    await expect(persistV2("parity-core-v2", coreRow.id, core.selectionIds.HOME!, "WIN")).rejects.toThrow(/value result identity is inconsistent/i);

    // v1 on an extended market: the six-argument persist function cannot settle it, and neither can a hand-built v1 row.
    await expect(prisma.$queryRawUnsafe(`SELECT * FROM persist_value_settlement($1,$2,$3,$4,NULL,NULL)`, "parity-ext-v1", seed.settlementReceiptId, half.value, half.selection)).rejects.toThrow(/identity|null value/i);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ValueSettlement" (id,"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","clvReason","clvPolicyVersion",receipt) SELECT 'parity-forged-v1',"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits",'flat-one-unit-v1',"clvStatus","clvReason","clvPolicyVersion",jsonb_set(receipt,'{policyVersion}','"flat-one-unit-v1"') FROM "ValueSettlement" WHERE id='parity-fact-HALF_WIN-ordinary'`,
    )).rejects.toThrow(/identity/i);

    // Forged return of an otherwise valid row.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ValueSettlement" (id,"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","clvReason","clvPolicyVersion",receipt) SELECT 'parity-forged-return',"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits",'9','8',"policyVersion","clvStatus","clvReason","clvPolicyVersion",receipt FROM "ValueSettlement" WHERE id='parity-fact-HALF_WIN-ordinary'`,
    )).rejects.toThrow(/arithmetic/i);

    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueSettlement" SET "profitUnits"='99' WHERE id='parity-fact-HALF_WIN-ordinary'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ValueSettlement" WHERE id='parity-fact-HALF_WIN-ordinary'`)).rejects.toThrow(/immutable/i);
  });

  it("refuses at receipt time odds whose half-win return would not fit the money columns", async () => {
    const odds = await seedOddsBook(prisma, seed, { market: "ASIAN_HANDICAP:-0.75", selections: [["HOME", OVERLONG_ODDS], ["AWAY", "1.9"]], tag: "overlong" });
    const row = buildExtendedValueReceipt(seed, odds, "ASIAN_HANDICAP:-0.75", "HOME", { outcome: "VALUE_CANDIDATE" });
    await expect(insertValueReceipt(prisma, seed, row)).rejects.toThrow(/too precise for flat-one-unit-v2/i);
  });

  it("converges a repeated call to the stored fact", async () => {
    const win = persistedIds.get("WIN-ordinary")!;
    const first = await persistV2("parity-fact-WIN-ordinary", win.value, win.selection, "WIN");
    const again = await persistV2("parity-retry-new-id", win.value, win.selection, "WIN");
    expect(again).toEqual(first);
    const count = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "ValueSettlement" WHERE "valueReceiptId"=$1`, win.value);
    expect(count).toEqual([{ count: 1n }]);
  });
});
