import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;

describe("ci drill frozen-table mutation", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('drill-league','Drill','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('drill-season','drill-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES
        ('drill-home','Drill Home','drill-home','GB',now()),('drill-away','Drill Away','drill-away','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt")
        VALUES ('drill-fixture','drill-league','drill-season','drill-home','drill-away','2026-09-10T18:00:00Z','SCHEDULED',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
        VALUES ('drill-snapshot','drill-fixture','PRE_MATCH','ISSUED',1,NULL,'2026-09-10T16:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash','drill-input','drill-input','[]','{}','{}','[]','{}',now())
        ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => prisma?.$disconnect());

  it("mutates an issued snapshot without rejection handling (guard trigger must raise)", async () => {
    const mutated = await prisma.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET assumptions='["drill-mutated"]' WHERE id=$1`, "drill-snapshot");
    expect(mutated).toBe(1);
  });
});
