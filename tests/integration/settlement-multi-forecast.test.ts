import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createSettlementPipelineService, SETTLEMENT_PIPELINE_POLICY_HASH, type PrismaClient } from "@bet-stats/database";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-settlement-multi-forecast-${process.pid}`;
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

/** Seeds one FINISHED fixture with a result (and optionally its correction) and two ISSUED PRE_MATCH forecasts: A (V1) then B (DC, revision 2). */
async function seedMatch(client: PrismaClient, id: string, day: number, withCorrection = false): Promise<{ fixtureId: string; forecastA: string; forecastB: string; result1: string; result2: string }> {
  const date = `2026-10-${String(day).padStart(2, "0")}`;
  const fixtureId = `${id}-fixture`;
  const forecastA = `${id}-forecast-a`;
  const forecastB = `${id}-forecast-b`;
  const result1 = `${id}-result-1`;
  const result2 = `${id}-result-2`;
  await client.$executeRawUnsafe(`
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${fixtureId}','mf-league','mf-season','mf-home','mf-away','${date}T18:00:00Z','FINISHED',now());
    INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES
      ('${id}-obs-1','test','RESULTS','${id}-one','${date}T20:00:00Z','${id}-hash-1','{}',2)${withCorrection ? `,
      ('${id}-obs-2','test','RESULTS','${id}-two','${date}T20:01:00Z','${id}-hash-2','{}',2)` : ""};
    INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES
      ('${result1}','${fixtureId}','${id}-obs-1','${date}T18:00:00Z','${date}T20:00:00Z',2,1,'FINISHED',1);
    ${withCorrection ? `INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES
      ('${result2}','${fixtureId}','${id}-obs-2','${date}T18:00:00Z','${date}T20:01:00Z',1,2,'FINISHED',2,'${result1}');` : ""}
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('${forecastA}','${fixtureId}','PRE_MATCH','ISSUED',1,'${date}T17:00:00Z','poisson-ensemble-v1','${id}-model-a','forecast-config-v1','${id}-config-a','${id}-input-a','${id}-evidence-a','[]','{}','{}','[]','{}','${date}T17:00:01Z');
    INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES
      ('${forecastB}','${fixtureId}','PRE_MATCH','ISSUED',2,'${forecastA}','${date}T17:00:00Z','dixon-coles-ensemble-v1','${id}-model-b','forecast-config-v1','${id}-config-b','${id}-input-b','${id}-evidence-b','[]','{}','{}','[]','{}','${date}T17:00:02Z');
    INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES
      ('${forecastA}-1x2','${forecastA}','ONE_X_TWO','[{"selection":"HOME","probability":0.5},{"selection":"DRAW","probability":0.3},{"selection":"AWAY","probability":0.2}]'),
      ('${forecastA}-ou','${forecastA}','OVER_UNDER_2_5','[{"selection":"OVER_2_5","probability":0.6},{"selection":"UNDER_2_5","probability":0.4}]'),
      ('${forecastA}-btts','${forecastA}','BTTS','[{"selection":"YES","probability":0.7},{"selection":"NO","probability":0.3}]'),
      ('${forecastB}-1x2','${forecastB}','ONE_X_TWO','[{"selection":"HOME","probability":0.45},{"selection":"DRAW","probability":0.3},{"selection":"AWAY","probability":0.25}]'),
      ('${forecastB}-ou','${forecastB}','OVER_UNDER_2_5','[{"selection":"OVER_2_5","probability":0.55},{"selection":"UNDER_2_5","probability":0.45}]'),
      ('${forecastB}-btts','${forecastB}','BTTS','[{"selection":"YES","probability":0.65},{"selection":"NO","probability":0.35}]');
  `);
  return { fixtureId, forecastA, forecastB, result1, result2 };
}

function command(fixtureId: string, resultVersionId: string, forecastSnapshotId: string, correlationId: string) {
  return { fixtureId, resultVersionId, forecastSnapshotId, policyVersion: "settlement-policy-v1", correlationId } as const;
}

describe("settlement of two forecasts for one fixture", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('mf-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('mf-season','mf-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('mf-home','Home','home','GB',now()),('mf-away','Away','away','GB',now());
    `);
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ } });

  it("keeps a single persist_settlement_receipt function (no overload)", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM pg_proc WHERE proname='persist_settlement_receipt'`);
    expect(rows[0]!.count).toBe(1n);
  });

  it("settles forecast A then B (and B then A) as independent revision-1 chains", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const ab = await seedMatch(prisma, "mf-ab", 10);
    const ba = await seedMatch(prisma, "mf-ba", 11);

    await service.process(command(ab.fixtureId, ab.result1, ab.forecastA, "corr-ab-a"));
    await service.process(command(ab.fixtureId, ab.result1, ab.forecastB, "corr-ab-b"));
    await service.process(command(ba.fixtureId, ba.result1, ba.forecastB, "corr-ba-b"));
    await service.process(command(ba.fixtureId, ba.result1, ba.forecastA, "corr-ba-a"));

    for (const match of [ab, ba]) {
      const receipts = await prisma.settlementReceipt.findMany({ where: { fixtureId: match.fixtureId }, orderBy: { forecastSnapshotId: "asc" } });
      expect(receipts).toHaveLength(2);
      expect(receipts.map((receipt) => receipt.revision)).toEqual([1, 1]);
      expect(receipts.map((receipt) => receipt.supersedesSettlementReceiptId)).toEqual([null, null]);
      expect(new Set(receipts.map((receipt) => receipt.forecastSnapshotId))).toEqual(new Set([match.forecastA, match.forecastB]));

      const scores = await prisma.$queryRawUnsafe<Array<{ forecastSnapshotId: string; modelVersion: string; settlementReceiptId: string }>>(
        `SELECT s."forecastSnapshotId", s.receipt->>'modelVersion' AS "modelVersion", s."settlementReceiptId" FROM "ForecastScore" s JOIN "SettlementReceipt" r ON r.id=s."settlementReceiptId" WHERE r."fixtureId"=$1`,
        match.fixtureId,
      );
      expect(scores).toHaveLength(6);
      for (const receipt of receipts) {
        const own = scores.filter((score) => score.settlementReceiptId === receipt.id);
        expect(own).toHaveLength(3);
        expect(own.every((score) => score.forecastSnapshotId === receipt.forecastSnapshotId)).toBe(true);
        expect(new Set(own.map((score) => score.modelVersion))).toEqual(new Set([receipt.forecastSnapshotId === match.forecastA ? "poisson-ensemble-v1" : "dixon-coles-ensemble-v1"]));
      }
      const current = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM current_forecast_scores c JOIN "SettlementReceipt" r ON r.id=c."settlementReceiptId" WHERE r."fixtureId"=$1`,
        match.fixtureId,
      );
      expect(current[0]!.count).toBe(6n);
    }
  });

  it("result correction yields chains [1,2] per forecast, each linked to its own predecessor", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-corr", 12, true);
    await service.process(command(match.fixtureId, match.result2, match.forecastA, "corr-corr-a"));
    await service.process(command(match.fixtureId, match.result2, match.forecastB, "corr-corr-b"));

    for (const forecastId of [match.forecastA, match.forecastB]) {
      const chain = await prisma.settlementReceipt.findMany({ where: { fixtureId: match.fixtureId, forecastSnapshotId: forecastId }, orderBy: { revision: "asc" } });
      expect(chain.map((receipt) => receipt.revision)).toEqual([1, 2]);
      expect(chain[0]!.supersedesSettlementReceiptId).toBeNull();
      expect(chain[1]!.supersedesSettlementReceiptId).toBe(chain[0]!.id);
      expect(chain.map((receipt) => receipt.resultVersionId)).toEqual([match.result1, match.result2]);
      const scores = await prisma.forecastScore.findMany({ where: { settlementReceiptId: { in: chain.map((receipt) => receipt.id) } } });
      expect(scores).toHaveLength(6);
      const first = new Map(scores.filter((score) => score.settlementReceiptId === chain[0]!.id).map((score) => [score.id, score]));
      const second = scores.filter((score) => score.settlementReceiptId === chain[1]!.id);
      expect(second).toHaveLength(3);
      for (const score of second) expect(first.get(score.supersedesForecastScoreId!)?.market).toBe(score.market);
    }
    const current = await prisma.$queryRawUnsafe<Array<{ settlementReceiptId: string }>>(
      `SELECT c."settlementReceiptId" FROM current_forecast_scores c JOIN "SettlementReceipt" r ON r.id=c."settlementReceiptId" WHERE r."fixtureId"=$1`,
      match.fixtureId,
    );
    expect(current).toHaveLength(6);
    const receipts = await prisma.settlementReceipt.findMany({ where: { fixtureId: match.fixtureId, revision: 2 } });
    expect(new Set(current.map((row) => row.settlementReceiptId))).toEqual(new Set(receipts.map((receipt) => receipt.id)));
  });

  it("two forecasts of the same fixture settle concurrently without losing or duplicating receipts", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    for (let index = 0; index < 5; index += 1) {
      const match = await seedMatch(prisma, `mf-par-${index}`, 13 + index);
      const outcomes = await Promise.all([
        service.process(command(match.fixtureId, match.result1, match.forecastA, `corr-par-${index}-a`)),
        service.process(command(match.fixtureId, match.result1, match.forecastB, `corr-par-${index}-b`)),
      ]);
      expect(outcomes.every((outcome) => outcome.forecastScoreIds.length === 3)).toBe(true);
      const receipts = await prisma.settlementReceipt.findMany({ where: { fixtureId: match.fixtureId } });
      expect(receipts).toHaveLength(2);
      for (const forecastId of [match.forecastA, match.forecastB]) {
        const own = receipts.filter((receipt) => receipt.forecastSnapshotId === forecastId);
        expect(own.map((receipt) => receipt.revision)).toEqual([1]);
        expect(own[0]!.supersedesSettlementReceiptId).toBeNull();
        expect(await prisma.forecastScore.count({ where: { settlementReceiptId: own[0]!.id } })).toBe(3);
      }
    }
  });

  it("duplicate delivery of one (fixture, result, forecast) yields one receipt", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-dup", 18);
    const outcomes = await Promise.all([
      service.process(command(match.fixtureId, match.result1, match.forecastA, "corr-dup-1")),
      service.process(command(match.fixtureId, match.result1, match.forecastA, "corr-dup-2")),
    ]);
    expect(outcomes.filter((outcome) => outcome.duplicate)).toHaveLength(1);
    expect(outcomes[0]!.settlementReceiptId).toBe(outcomes[1]!.settlementReceiptId);
    expect(await prisma.settlementReceipt.count({ where: { fixtureId: match.fixtureId } })).toBe(1);
    expect(await prisma.forecastScore.count({ where: { settlementReceipt: { fixtureId: match.fixtureId } } })).toBe(3);
  });

  it("six simultaneous deliveries of one (fixture, result, forecast) (above the intake cap) yield one receipt", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-burst", 19);
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => service.process(command(match.fixtureId, match.result1, match.forecastA, `corr-burst-${index}`))));
    expect(outcomes.filter((outcome) => outcome.duplicate)).toHaveLength(5);
    expect(new Set(outcomes.map((outcome) => outcome.settlementReceiptId)).size).toBe(1);
    expect(await prisma.settlementReceipt.count({ where: { fixtureId: match.fixtureId } })).toBe(1);
    expect(await prisma.forecastScore.count({ where: { settlementReceipt: { fixtureId: match.fixtureId } } })).toBe(3);
  }, 120_000);

  it("concurrent corrections of two forecasts keep independent chains [1,2]", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-pcorr", 19, true);
    await service.process(command(match.fixtureId, match.result1, match.forecastA, "corr-pcorr-a1"));
    await service.process(command(match.fixtureId, match.result1, match.forecastB, "corr-pcorr-b1"));
    await Promise.all([
      service.process(command(match.fixtureId, match.result2, match.forecastA, "corr-pcorr-a2")),
      service.process(command(match.fixtureId, match.result2, match.forecastB, "corr-pcorr-b2")),
    ]);
    for (const forecastId of [match.forecastA, match.forecastB]) {
      const chain = await prisma.settlementReceipt.findMany({ where: { fixtureId: match.fixtureId, forecastSnapshotId: forecastId }, orderBy: { revision: "asc" } });
      expect(chain.map((receipt) => receipt.revision)).toEqual([1, 2]);
      expect(chain[1]!.supersedesSettlementReceiptId).toBe(chain[0]!.id);
    }
    expect(await prisma.settlementReceipt.count({ where: { fixtureId: match.fixtureId } })).toBe(4);
  });

  it("SettlementReceipt stays append-only", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-append", 20);
    const outcome = await service.process(command(match.fixtureId, match.result1, match.forecastA, "corr-append"));
    await expect(prisma.$executeRawUnsafe(`UPDATE "SettlementReceipt" SET reason='tampered' WHERE id=$1`, outcome.settlementReceiptId)).rejects.toThrow(/SettlementReceipt is immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "SettlementReceipt" WHERE id=$1`, outcome.settlementReceiptId)).rejects.toThrow(/SettlementReceipt is immutable/);
    expect(await prisma.settlementReceipt.count({ where: { fixtureId: match.fixtureId } })).toBe(1);
  });

  it("guard rejects a predecessor taken from another forecast's chain", async () => {
    const service = createSettlementPipelineService({ database: prisma });
    const match = await seedMatch(prisma, "mf-cross", 21, true);
    const receiptA = await service.process(command(match.fixtureId, match.result1, match.forecastA, "corr-cross-a1"));
    await service.process(command(match.fixtureId, match.result1, match.forecastB, "corr-cross-b1"));
    const claims = {
      fixtureId: match.fixtureId, resultVersionId: match.result2, forecastSnapshotId: match.forecastB,
      policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH,
      lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED",
    };
    await expect(prisma.$queryRawUnsafe(
      `SELECT * FROM persist_settlement_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz,$14,NULL)`,
      "mf-cross-forged", match.fixtureId, match.result2, match.forecastB, claims.policyVersion, claims.policyHash,
      claims.lifecycle, claims.scoreability, claims.financialEligibility, claims.classOutcome, claims.reason,
      JSON.stringify(claims), "2026-10-21T20:01:00Z", receiptA.settlementReceiptId,
    )).rejects.toThrow(/settlement predecessor does not match result correction and revision/);
    expect(await prisma.settlementReceipt.count({ where: { fixtureId: match.fixtureId } })).toBe(2);
  });

  it("uniqueness is keyed by (fixtureId, forecastSnapshotId, revision), not by fixture and revision", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string; columns: string }>>(`
      SELECT i.relname AS name, string_agg(a.attname, ',' ORDER BY k.ord) AS columns
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = 'SettlementReceipt' AND x.indisunique
      GROUP BY i.relname`);
    const columns = indexes.map((index) => index.columns);
    expect(columns).toContain("fixtureId,forecastSnapshotId,revision");
    expect(columns).not.toContain("fixtureId,revision");
    const legacy = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM pg_constraint WHERE conname='SettlementReceipt_fixtureId_revision_key'`);
    expect(legacy[0]!.count).toBe(0n);
  });
});
