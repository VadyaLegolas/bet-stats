import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, createSettlementPipelineService, type PrismaClient } from "@bet-stats/database";

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

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* owned cleanup */ } });

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
});
