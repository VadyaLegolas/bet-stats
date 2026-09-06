import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;

describe("exact-pair value receipts", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('value-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('value-season','value-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('value-home','Home','home','GB',now()),('value-away','Away','away','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id("value-fixture")}','value-league','value-season','value-home','value-away','2026-09-10T18:00:00Z','SCHEDULED',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id("value-other-fixture")}','value-league','value-season','value-home','value-away','2026-09-11T18:00:00Z','SCHEDULED',now());
    `);
    await prisma.$executeRawUnsafe(`INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$6,'PRE_MATCH','ISSUED',1,'2026-09-10T16:00:00Z','poisson-v1',$2,'forecast-config-v1',$3,$4,$5,'[]','{}','{}','[]','{}',now())`, id("value-forecast"), id("value-model"), id("value-config"), id("value-input"), id("value-evidence"), id("value-fixture"));
    await prisma.$executeRawUnsafe(`INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,'MATCH_RESULT','{}')`, id("value-forecast-market"), id("value-forecast"));
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt) VALUES ($1,$3,'MATCH_RESULT',$2,'manual','{}')`, id("value-odds"), id("value-book"), id("value-fixture"));
  });
  afterAll(async () => prisma?.$disconnect());

  it("persists the exact compatible forecast and odds snapshot IDs", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ($1,$4,'MATCH_RESULT',$2,$3,'VALUE_CANDIDATE','{}')`, id("value-valid"), id("value-forecast"), id("value-odds"), id("value-fixture"))).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueReceipt" SET outcome='NO_VALUE' WHERE id=$1`, id("value-valid"))).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ValueReceipt" WHERE id=$1`, id("value-valid"))).rejects.toThrow(/immutable/i);
  });

  it("rejects a cross-market pair at the database boundary", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ($1,$4,'BTTS',$2,$3,'NO_VALUE','{}')`, id("value-invalid-market"), id("value-forecast"), id("value-odds"), id("value-fixture"))).rejects.toThrow(/exact forecast.*odds pair/i);
  });

  it("rejects a cross-fixture pair at the database boundary", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ($1,$4,'MATCH_RESULT',$2,$3,'NO_VALUE','{}')`, id("value-invalid-fixture"), id("value-forecast"), id("value-odds"), id("value-other-fixture"))).rejects.toThrow(/exact forecast.*odds pair/i);
  });
});
