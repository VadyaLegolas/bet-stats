import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createSettlementPipelineService, type PrismaClient } from "@bet-stats/database";

import {
  buildCoreValueReceipt, buildExtendedValueReceipt, exactScoreSelections, insertValueReceipt, seedExtendedMarketsFixture, seedOddsBook,
  type ExtendedSeed, type ExtendedValueRow,
} from "../helpers/extended-markets-seed.js";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-p14-pipeline-${process.pid}`;
let prisma: PrismaClient;
let seed: ExtendedSeed;
const rows = new Map<string, ExtendedValueRow & { oddsSelectionId: string }>();

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

function stableId(kind: string, ...parts: string[]): string {
  return `${kind}_${createHash("sha256").update(parts.join("\u001f")).digest("hex")}`;
}

async function addValue(key: string, market: string, selection: string, book: ReadonlyArray<readonly [string, string]>, core = false): Promise<void> {
  const odds = await seedOddsBook(prisma, seed, { market, selections: book, tag: key });
  const row = core ? buildCoreValueReceipt(seed, odds, market, selection, { outcome: "VALUE_CANDIDATE" }) : buildExtendedValueReceipt(seed, odds, market, selection, { outcome: "VALUE_CANDIDATE" });
  await insertValueReceipt(prisma, seed, row);
  rows.set(key, { ...row, oddsSelectionId: odds.selectionIds[selection]! });
}

const service = () => createSettlementPipelineService({ database: prisma });
const command = (resultVersionId: string, correlationId: string) => ({ fixtureId: seed.fixtureId, resultVersionId, forecastSnapshotId: seed.forecastSnapshotId, policyVersion: "settlement-policy-v1", correlationId }) as const;

async function settled(key: string, settlementId: string) {
  const value = rows.get(key)!;
  return (await prisma.$queryRawUnsafe<Array<{ id: string; result: string; returnUnits: string; profitUnits: string; policyVersion: string; supersedesValueSettlementId: string | null; clvStatus: string }>>(
    `SELECT id,result,"returnUnits","profitUnits","policyVersion","supersedesValueSettlementId","clvStatus" FROM "ValueSettlement" WHERE "valueReceiptId"=$1 AND "settlementReceiptId"=$2`, value.id, settlementId,
  ))[0];
}

describe("settlement pipeline: value settlement branched by market family", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    seed = await seedExtendedMarketsFixture(prisma, { prefix: "pipe", homeGoals: 1, awayGoals: 0, settlementReceipt: false });
    // Final score 1-0.
    await addValue("core", "ONE_X_TWO", "HOME", [["HOME", "2.4"], ["DRAW", "3.3"], ["AWAY", "3.1"]], true);
    await addValue("half-win", "ASIAN_HANDICAP:-0.75", "HOME", [["HOME", "2.2"], ["AWAY", "1.7"]]);
    await addValue("push", "ASIAN_HANDICAP:-1", "HOME", [["HOME", "2.5"], ["AWAY", "1.6"]]);
    await addValue("level", "ASIAN_HANDICAP:0", "HOME", [["HOME", "1.9"], ["AWAY", "1.95"]]);
    await addValue("exact-loss", "EXACT_SCORE", "2-1", exactScoreSelections("14"));
    await addValue("exact-other", "EXACT_SCORE", "OTHER", exactScoreSelections("14"));
    // Closing price for the half-win candidate, so CLV is exercised through persist_value_settlement_v2 as well.
    await prisma.$executeRawUnsafe(`INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ('pipe-closing',$1,'ASIAN_HANDICAP:-0.75','HOME','2','DECIMAL','BOOKMAKER_BACK','MARKET_CLOSE','2026-09-10T17:59:00Z')`, seed.fixtureId);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
  });

  it("settles the core markets, a handicap quarter line, a push and exact scores in one pass without rollback", async () => {
    const result = await service().process(command(seed.resultVersionId, "corr-mixed"));
    expect(result).toMatchObject({ reason: "RESULT_FINISHED", duplicate: false });
    expect(result.forecastScoreIds).toHaveLength(3);
    expect(result.valueSettlementIds).toHaveLength(6);

    expect(await settled("core", result.settlementReceiptId)).toMatchObject({ result: "WIN", returnUnits: "2.4", profitUnits: "1.4", policyVersion: "flat-one-unit-v1" });
    expect(await settled("half-win", result.settlementReceiptId)).toMatchObject({ result: "HALF_WIN", returnUnits: "1.6", profitUnits: "0.6", policyVersion: "flat-one-unit-v2", clvStatus: "AVAILABLE" });
    expect(await settled("push", result.settlementReceiptId)).toMatchObject({ result: "PUSH", returnUnits: "1", profitUnits: "0", policyVersion: "flat-one-unit-v2", clvStatus: "UNAVAILABLE" });
    expect(await settled("level", result.settlementReceiptId)).toMatchObject({ result: "WIN", returnUnits: "1.9", profitUnits: "0.9" });
    expect(await settled("exact-loss", result.settlementReceiptId)).toMatchObject({ result: "LOSS", returnUnits: "0", profitUnits: "-1", policyVersion: "flat-one-unit-v2" });
    expect(await settled("exact-other", result.settlementReceiptId)).toMatchObject({ result: "LOSS", returnUnits: "0", profitUnits: "-1" });
  });

  it("creates ForecastScore rows only for the three core markets", async () => {
    const markets = await prisma.$queryRawUnsafe<Array<{ market: string }>>(`SELECT DISTINCT market FROM "ForecastScore" ORDER BY market`);
    expect(markets.map((row) => row.market)).toEqual(["BTTS", "ONE_X_TWO", "OVER_UNDER_2_5"]);
  });

  it("keeps the v1 id formula and puts the policy string into the v2 id", async () => {
    const settlement = (await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "SettlementReceipt" WHERE "resultVersionId"=$1`, seed.resultVersionId))[0]!;
    const core = await settled("core", settlement.id);
    expect(core!.id).toBe(stableId("value_settlement", settlement.id, rows.get("core")!.id, "flat-one-unit-v1"));
    const half = await settled("half-win", settlement.id);
    expect(half!.id).toBe(stableId("value_settlement", settlement.id, rows.get("half-win")!.id, "flat-one-unit-v2"));
    expect(half!.id).not.toBe(stableId("value_settlement", settlement.id, rows.get("half-win")!.id, "flat-one-unit-v1"));
  });

  it("is idempotent, and a corrected result appends v2 settlements that supersede a predecessor of the same policy", async () => {
    const again = await service().process(command(seed.resultVersionId, "corr-again"));
    expect(again.duplicate).toBe(true);
    expect(await prisma.valueSettlement.count()).toBe(6);
    expect(await prisma.forecastScore.count()).toBe(3);

    await prisma.$executeRawUnsafe(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('pipe-result-obs-2','test','RESULTS','pipe-fixture','2026-09-10T20:01:00Z','pipe-result-hash-2','{}',2)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('pipe-result-2',$1,'pipe-result-obs-2','2026-09-10T18:00:00Z','2026-09-10T20:01:00Z',1,1,'FINISHED',2,$2)`, seed.fixtureId, seed.resultVersionId);
    const corrected = await service().process(command("pipe-result-2", "corr-correction"));
    expect(corrected.valueSettlementIds).toHaveLength(6);
    expect(corrected.forecastScoreIds).toHaveLength(3);

    const originalSettlement = (await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "SettlementReceipt" WHERE "resultVersionId"=$1`, seed.resultVersionId))[0]!;
    const expectedAtDraw: Record<string, [string, string, string]> = {
      "core": ["LOSS", "0", "flat-one-unit-v1"], "half-win": ["LOSS", "0", "flat-one-unit-v2"], "push": ["LOSS", "0", "flat-one-unit-v2"],
      "level": ["PUSH", "1", "flat-one-unit-v2"], "exact-loss": ["LOSS", "0", "flat-one-unit-v2"], "exact-other": ["LOSS", "0", "flat-one-unit-v2"],
    };
    for (const [key, [result, returnUnits, policy]] of Object.entries(expectedAtDraw)) {
      const next = await settled(key, corrected.settlementReceiptId);
      const previous = await settled(key, originalSettlement.id);
      expect(next).toMatchObject({ result, returnUnits, policyVersion: policy, supersedesValueSettlementId: previous!.id });
    }
    expect(await prisma.valueSettlement.count()).toBe(12);
  });

  it("fails with a typed error, never silently, for a value receipt on a market without a settlement rule", async () => {
    const other = await seedExtendedMarketsFixture(prisma, { prefix: "unsettleable", homeGoals: 2, awayGoals: 0, settlementReceipt: false });
    const odds = await seedOddsBook(prisma, other, { market: "ASIAN_HANDICAP:-0.5", selections: [["HOME", "2"], ["AWAY", "1.9"]], tag: "ah" });
    const row = buildExtendedValueReceipt(other, odds, "ASIAN_HANDICAP:-0.5", "HOME", { outcome: "VALUE_CANDIDATE" });
    // Only a deliberately bypassed guard can store such a receipt; the pipeline must still refuse to skip it.
    await prisma.$executeRawUnsafe(`ALTER TABLE "ValueReceipt" DISABLE TRIGGER "ValueReceipt_validate_pair"`);
    try {
      await insertValueReceipt(prisma, other, row, { market: "ASIAN_HANDICAP:+3" });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ValueReceipt" ENABLE TRIGGER "ValueReceipt_validate_pair"`);
    }
    const before = await prisma.valueSettlement.count();
    await expect(createSettlementPipelineService({ database: prisma }).process({ fixtureId: other.fixtureId, resultVersionId: other.resultVersionId, forecastSnapshotId: other.forecastSnapshotId, policyVersion: "settlement-policy-v1", correlationId: "corr-unsettleable" }))
      .rejects.toMatchObject({ code: "UNSETTLEABLE_VALUE_MARKET" });
    expect(await prisma.valueSettlement.count()).toBe(before);
  });
});
