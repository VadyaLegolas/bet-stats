import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-settlement-${process.pid}`;
let prisma: PrismaClient;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function waitForPostgres(): void {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); return; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
  throw new Error("PostgreSQL did not become ready");
}

async function persist(id: string, resultVersionId: string, supersedes: string | null = null, revision?: number) {
  return prisma.$queryRawUnsafe<Array<{ id: string; revision: number; supersedesSettlementReceiptId: string | null }>>(
    `SELECT * FROM persist_settlement_receipt($1,$2,$3,$4,'settlement-policy-v1','policy-hash','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$5::jsonb,'2026-09-10T20:05:00Z',$6,$7)` ,
    id, "settlement-fixture", resultVersionId, "settlement-forecast", JSON.stringify({ fixtureId: "settlement-fixture", resultVersionId, forecastSnapshotId: "settlement-forecast", policyVersion: "settlement-policy-v1", policyHash: "policy-hash", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" }), supersedes ?? null, revision ?? null,
  );
}

describe("append-only settlement revisions", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('settlement-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('settlement-season','settlement-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('settlement-home','Home','home','GB',now()),('settlement-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('settlement-fixture','settlement-league','settlement-season','settlement-home','settlement-away','2026-09-10T18:00:00Z','FINISHED',now());
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('settlement-obs-1','test','RESULTS','fixture','2026-09-10T20:00:00Z','settlement-hash-1','{}',2),('settlement-obs-2','test','RESULTS','fixture','2026-09-10T20:01:00Z','settlement-hash-2','{}',2),('settlement-obs-3','test','RESULTS','fixture','2026-09-10T20:02:00Z','settlement-hash-3','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('settlement-result-1','settlement-fixture','settlement-obs-1','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('settlement-result-2','settlement-fixture','settlement-obs-2','2026-09-10T18:00:00Z','2026-09-10T20:01:00Z',1,1,'FINISHED',2,'settlement-result-1');
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('settlement-result-3','settlement-fixture','settlement-obs-3','2026-09-10T18:00:00Z','2026-09-10T20:02:00Z',1,0,'FINISHED',3,'settlement-result-2');
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('settlement-forecast','settlement-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{"officialLineupObservationId":null}','2026-09-10T17:00:01Z');
    `);
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* owned cleanup */ } });

  it("converges retries and appends a linked correction", async () => {
    const first = (await persist("settlement-receipt-1", "settlement-result-1"))[0]!;
    const retry = (await persist("different-retry-id", "settlement-result-1"))[0]!;
    expect(retry).toEqual(first);
    const correction = (await persist("settlement-receipt-2", "settlement-result-2", first.id))[0]!;
    expect(correction).toMatchObject({ revision: 2, supersedesSettlementReceiptId: first.id });

    const current = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT s.id FROM "SettlementReceipt" s WHERE s."fixtureId"='settlement-fixture' AND NOT EXISTS (SELECT 1 FROM "SettlementReceipt" n WHERE n."supersedesSettlementReceiptId"=s.id)`);
    const history = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "SettlementReceipt" WHERE "fixtureId"='settlement-fixture' ORDER BY revision`);
    expect(current.map((row) => row.id)).toEqual([correction.id]);
    expect(history.map((row) => row.id)).toEqual([first.id, correction.id]);
  });

  it("rejects mutation and broken source/revision lineage", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "SettlementReceipt" SET reason='tampered' WHERE id='settlement-receipt-1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "SettlementReceipt" WHERE id='settlement-receipt-1'`)).rejects.toThrow(/immutable/i);
    await expect(persist("gap", "settlement-result-3", "settlement-receipt-2", 4)).rejects.toThrow(/revision|predecessor/i);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "SettlementReceipt" (id,"fixtureId","resultVersionId","forecastSnapshotId",revision,"policyVersion","policyHash",lifecycle,scoreability,"financialEligibility","classOutcome",reason,receipt,"resultObservedAt","forecastCutoff","settledAt") VALUES ('bad-fixture','settlement-home','settlement-result-1','settlement-forecast',1,'settlement-policy-v1','other-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED','{}','2026-09-10T20:00:00Z','2026-09-10T17:00:00Z',now())`)).rejects.toThrow(/lineage|fixture/i);
  });
});
