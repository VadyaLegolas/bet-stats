import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;

const selections = [
  { selection: "HOME", decimalOdds: "2.4", noVigProbability: "0.45" },
  { selection: "DRAW", decimalOdds: "3", noVigProbability: "0.3" },
  { selection: "AWAY", decimalOdds: "4", noVigProbability: "0.25" },
];

const valueReceipt = {
  market: "ONE_X_TWO",
  selection: "HOME",
  modelProbability: "0.6",
  noVigProbability: "0.45",
  decimalOdds: "2.4",
  fairOdds: "1.66666666666666666667",
  edge: "0.15",
  expectedValue: "0.44",
};

async function expectRowExists(table: string, rowId: string): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE id = $1`,
    rowId,
  );
  expect(rows[0]?.count).toBe(1);
}

describe("raw SQL mutation rejection across guarded tables", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ($1,'League','GB',now()) ON CONFLICT (id) DO NOTHING`,
      id("mut-league"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ($1,$2,'2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING`,
      id("mut-season"), id("mut-league"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ($1,'Home','home','GB',now()) ON CONFLICT (id) DO NOTHING`,
      id("mut-home"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ($1,'Away','away','GB',now()) ON CONFLICT (id) DO NOTHING`,
      id("mut-away"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'2026-09-10T18:00:00Z','FINISHED',now()) ON CONFLICT (id) DO NOTHING`,
      id("mut-fixture"), id("mut-league"), id("mut-season"), id("mut-home"), id("mut-away"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,'test','RESULTS',$2,'2026-09-10T20:00:00Z',$3,'{}',2)`,
      id("mut-result-obs"), id("mut-external"), id("mut-result-hash"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ($1,$2,$3,'2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',2,1,'FINISHED',1)`,
      id("mut-result"), id("mut-fixture"), id("mut-result-obs"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$2,'PRE_MATCH','ISSUED',1,NULL,'2026-09-10T17:00:00Z','poisson-v1',$3,'forecast-config-v1',$4,$5,$6,'[]','{}','{}','[]','{}','2026-09-10T17:00:01Z')`,
      id("mut-forecast"), id("mut-fixture"), id("mut-model"), id("mut-config"), id("mut-input"), id("mut-evidence"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,'ONE_X_TWO',$3::jsonb)`,
      id("mut-market"), id("mut-forecast"),
      JSON.stringify([{ selection: "HOME", probability: 0.6 }, { selection: "DRAW", probability: 0.2 }, { selection: "AWAY", probability: 0.2 }]),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ($1,$2,'ONE_X_TWO',$3,'BOOKMAKER_BACK',$4::jsonb,'2026-09-10T16:00:00Z')`,
      id("mut-odds"), id("mut-fixture"), id("mut-odds-input"), JSON.stringify({ selections }),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ($1,$2,'HOME','2.4')`,
      id("mut-odds-selection"), id("mut-odds"),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ($1,$2,'ONE_X_TWO',$3,$4,'VALUE_CANDIDATE','HOME',$5,$6,$7,$8,$9,$10::jsonb)`,
      id("mut-value-receipt"), id("mut-fixture"), id("mut-forecast"), id("mut-odds"),
      valueReceipt.modelProbability, valueReceipt.noVigProbability, valueReceipt.fairOdds, valueReceipt.edge, valueReceipt.expectedValue,
      JSON.stringify(valueReceipt),
    )).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ClosingOddsObservation" (id,"fixtureId",market,selection,"decimalOdds","oddsFormat","sourceConvention","observationKind","observedAt") VALUES ($1,$2,'ONE_X_TWO','HOME','2','DECIMAL','BOOKMAKER_BACK','MARKET_CLOSE','2026-09-10T17:59:00Z')`,
      id("mut-closing"), id("mut-fixture"),
    )).resolves.toBe(1);
    const settlementReceipt = {
      fixtureId: id("mut-fixture"),
      resultVersionId: id("mut-result"),
      forecastSnapshotId: id("mut-forecast"),
      policyVersion: "settlement-policy-v1",
      policyHash: "mut-policy",
      lifecycle: "FINISHED",
      scoreability: "SCOREABLE",
      financialEligibility: "ELIGIBLE",
      classOutcome: "SCORED",
      reason: "RESULT_FINISHED",
    };
    const settlementReceipts = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT * FROM persist_settlement_receipt('${id("mut-settlement-receipt")}','${id("mut-fixture")}','${id("mut-result")}','${id("mut-forecast")}','settlement-policy-v1','mut-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$1::jsonb,'2026-09-10T20:05:00Z',NULL,NULL)`,
      JSON.stringify(settlementReceipt),
    );
    expect(settlementReceipts).toHaveLength(1);
    const valueSettlements = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT * FROM persist_value_settlement($1,$2,$3,$4,$5,$6)`,
      id("mut-value-settlement"), id("mut-settlement-receipt"), id("mut-value-receipt"), id("mut-odds-selection"), id("mut-closing"), null,
    );
    expect(valueSettlements).toHaveLength(1);
  });

  afterAll(async () => prisma?.$disconnect());

  it("rejects ValueReceipt mutation and removal as immutable", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueReceipt" SET outcome='NO_VALUE' WHERE id=$1`, id("mut-value-receipt"))).rejects.toThrow(/immutable/i);
    await expectRowExists("ValueReceipt", id("mut-value-receipt"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ValueReceipt" WHERE id=$1`, id("mut-value-receipt"))).rejects.toThrow(/immutable/i);
  });

  it("rejects ValueSettlement mutation and removal as immutable", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueSettlement" SET "profitUnits"='99' WHERE id=$1`, id("mut-value-settlement"))).rejects.toThrow(/immutable/i);
    await expectRowExists("ValueSettlement", id("mut-value-settlement"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ValueSettlement" WHERE id=$1`, id("mut-value-settlement"))).rejects.toThrow(/immutable/i);
  });

  it("rejects ClosingOddsObservation mutation and removal as immutable", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ClosingOddsObservation" SET "decimalOdds"='9' WHERE id=$1`, id("mut-closing"))).rejects.toThrow(/immutable/i);
    await expectRowExists("ClosingOddsObservation", id("mut-closing"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ClosingOddsObservation" WHERE id=$1`, id("mut-closing"))).rejects.toThrow(/immutable/i);
  });

  it("rejects ForecastMarket mutation and removal as immutable", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastMarket" SET probabilities='[{"selection":"HOME","probability":0.9}]'::jsonb WHERE id=$1`, id("mut-market"))).rejects.toThrow(/immutable/i);
    await expectRowExists("ForecastMarket", id("mut-market"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastMarket" WHERE id=$1`, id("mut-market"))).rejects.toThrow(/immutable/i);
  });

  it("rejects ResultVersion mutation and removal as append-only", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "ResultVersion" SET "homeGoals"=9 WHERE id=$1`, id("mut-result"))).rejects.toThrow(/append-only/i);
    await expectRowExists("ResultVersion", id("mut-result"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ResultVersion" WHERE id=$1`, id("mut-result"))).rejects.toThrow(/append-only/i);
  });

  it("rejects SourceObservation mutation and removal as append-only", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "SourceObservation" SET "payloadHash"=$1 WHERE id=$2`, id("mut-payload"), id("mut-result-obs"))).rejects.toThrow(/append-only/i);
    await expectRowExists("SourceObservation", id("mut-result-obs"));
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "SourceObservation" WHERE id=$1`, id("mut-result-obs"))).rejects.toThrow(/append-only/i);
  });
});
