import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-value-settlement-${process.pid}`;
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

async function persist(id: string, settlementId: string, supersedes: string | null = null, closingId: string | null = "value-closing") {
  return prisma.$queryRawUnsafe<Array<{ id: string; supersedesValueSettlementId: string | null }>>(
    `SELECT * FROM persist_value_settlement($1,$2,'value-receipt','value-odds-selection',$3,$4)`, id, settlementId, closingId, supersedes,
  );
}

describe("immutable flat-unit value settlements", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", container, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    waitForPostgres();
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = createPrismaClient(url);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('value-settle-league','League','GB',now());
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('value-settle-season','value-settle-league','2026','2026-01-01','2026-12-31',now());
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('value-settle-home','Home','home','GB',now()),('value-settle-away','Away','away','GB',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('value-settle-fixture','value-settle-league','value-settle-season','value-settle-home','value-settle-away','2026-09-10T18:00:00Z','FINISHED',now());
      INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('value-result-obs-1','test','RESULTS','fixture','2026-09-10T20:00:00Z','value-result-hash-1','{}',2),('value-result-obs-2','test','RESULTS','fixture','2026-09-10T20:01:00Z','value-result-hash-2','{}',2);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ('value-result-1','value-settle-fixture','value-result-obs-1','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1);
      INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision,"supersedesResultVersionId") VALUES ('value-result-2','value-settle-fixture','value-result-obs-2','2026-09-10T18:00:00Z','2026-09-10T20:01:00Z',1,2,'FINISHED',2,'value-result-1');
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ('value-settle-forecast','value-settle-fixture','PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','input-hash','evidence-hash','[]','{}','{}','[]','{}','2026-09-10T17:00:01Z');
      INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('value-settle-market','value-settle-forecast','ONE_X_TWO','[{"selection":"HOME","probability":0.6},{"selection":"DRAW","probability":0.2},{"selection":"AWAY","probability":0.2}]');
      INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ('value-odds','value-settle-fixture','ONE_X_TWO','odds-hash','BOOKMAKER_BACK','{"selections":[{"selection":"HOME","decimalOdds":"2.4","noVigProbability":"0.45"},{"selection":"DRAW","decimalOdds":"3","noVigProbability":"0.3"},{"selection":"AWAY","decimalOdds":"4","noVigProbability":"0.25"}]}','2026-09-10T16:00:00Z');
      INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('value-odds-selection','value-odds','HOME','2.4');
      INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ('value-receipt','value-settle-fixture','ONE_X_TWO','value-settle-forecast','value-odds','VALUE_CANDIDATE','HOME','0.6','0.45','1.66666666666666666667','0.15','0.44','{"market":"ONE_X_TWO","selection":"HOME","modelProbability":"0.6","noVigProbability":"0.45","decimalOdds":"2.4","fairOdds":"1.66666666666666666667","edge":"0.15","expectedValue":"0.44"}');
      INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ('value-closing','value-settle-fixture','ONE_X_TWO','HOME','2','DECIMAL','BOOKMAKER_BACK','MARKET_CLOSE','2026-09-10T17:59:00Z');
    `);
    const receipt1 = { fixtureId: "value-settle-fixture", resultVersionId: "value-result-1", forecastSnapshotId: "value-settle-forecast", policyVersion: "settlement-policy-v1", policyHash: "value-policy", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
    const receipt2 = { ...receipt1, resultVersionId: "value-result-2" };
    await prisma.$queryRawUnsafe(`SELECT * FROM persist_settlement_receipt('value-settlement-1','value-settle-fixture','value-result-1','value-settle-forecast','settlement-policy-v1','value-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$1::jsonb,'2026-09-10T20:05:00Z',NULL,NULL)`, JSON.stringify(receipt1));
    await prisma.$queryRawUnsafe(`SELECT * FROM persist_settlement_receipt('value-settlement-2','value-settle-fixture','value-result-2','value-settle-forecast','settlement-policy-v1','value-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$1::jsonb,'2026-09-10T20:06:00Z','value-settlement-1',NULL)`, JSON.stringify(receipt2));
  }, 120_000);

  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", container); } catch { /* owned cleanup */ } });

  it("converges retries, appends corrections, and aggregates only current leaves", async () => {
    const first = (await persist("value-fact-1", "value-settlement-1"))[0]!;
    expect((await persist("value-fact-retry", "value-settlement-1"))[0]).toEqual(first);
    const correction = (await persist("value-fact-2", "value-settlement-2", first.id))[0]!;
    expect(correction.supersedesValueSettlementId).toBe(first.id);

    const rows = await prisma.$queryRawUnsafe<Array<{ totalProfitUnits: string; totalStakedUnits: string; observationCount: bigint; roi: string; yield: string }>>(`SELECT * FROM current_value_settlement_aggregate`);
    expect(rows).toEqual([{ totalProfitUnits: "-1", totalStakedUnits: "1", observationCount: 1n, roi: "-1", yield: "-1" }]);
  });

  it("persists exact P/L and comparable CLV facts", async () => {
    const row = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM current_value_settlements`))[0]!;
    expect(row).toMatchObject({ result: "LOSS", stakeUnits: "1", returnUnits: "0", profitUnits: "-1", policyVersion: "flat-one-unit-v1", clvStatus: "AVAILABLE", candidateOdds: "2.4", closingOdds: "2", clv: "0.2", clvPolicyVersion: "odds-ratio-clv-v1" });
  });

  it("stores a precise unavailable CLV reason when no closing price exists", async () => {
    const rows = await persist("value-fact-no-close", "value-settlement-1", null, null);
    const row = await prisma.$queryRawUnsafe<Array<{ clvStatus: string; clvReason: string }>>(`SELECT "clvStatus","clvReason" FROM "ValueSettlement" WHERE id=$1`, rows[0]!.id);
    expect(row[0]).toEqual({ clvStatus: "UNAVAILABLE", clvReason: "CLOSING_OBSERVATION_MISSING" });
  });

  it("rejects ineligible identity, source/timestamp mismatch, mutation, and forged P/L", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueSettlement" SET "profitUnits"='99' WHERE id='value-fact-1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ('bad-closing','value-settle-fixture','ONE_X_TWO','HOME','2','DECIMAL','EXCHANGE','MARKET_CLOSE','2026-09-10T18:00:00Z')`)).resolves.toBe(1);
    await expect(persist("bad-source", "value-settlement-1", null, "bad-closing")).rejects.toThrow(/source|timestamp|comparable/i);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueSettlement" (id,"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits","profitUnits","policyVersion","clvStatus","clvReason","clvPolicyVersion",receipt) SELECT 'forged',"settlementReceiptId","valueReceiptId","oddsSelectionId","fixtureId",market,selection,result,"stakeUnits","returnUnits",'99',"policyVersion","clvStatus","clvReason","clvPolicyVersion",receipt FROM "ValueSettlement" WHERE id='value-fact-1'`)).rejects.toThrow(/profit|arithmetic|identity/i);
  });
});
