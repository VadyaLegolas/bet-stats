import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;

describe("append-only manual odds books", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('odds-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('odds-season','odds-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('odds-home-team','Home','home','GB',now()),('odds-away-team','Away','away','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id("odds-fixture")}','odds-league','odds-season','odds-home-team','odds-away-team','2026-09-10T18:00:00Z','SCHEDULED',now()) ON CONFLICT (id) DO NOTHING;
    `);
  });
  afterAll(async () => prisma?.$disconnect());

  it("preserves canonical decimal strings and links replacements forward", async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt) VALUES ($1,$3,'MATCH_RESULT',$2,'manual','{}')`, id("odds-v1"), id("book-v1"), id("odds-fixture"));
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ($1,$2,'HOME','2.12500000000000000001')`, id("odds-home"), id("odds-v1"));
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"replacesOddsId") VALUES ($1,$4,'MATCH_RESULT',$2,'manual','{}',$3)`, id("odds-v2"), id("book-v2"), id("odds-v1"), id("odds-fixture"));

    const rows = await prisma.$queryRawUnsafe<Array<{ decimalOdds: string }>>(`SELECT "decimalOdds" FROM "ManualOddsSelection" WHERE id=$1`, id("odds-home"));
    expect(rows[0]?.decimalOdds).toBe("2.12500000000000000001");
    await expect(prisma.$executeRawUnsafe(`UPDATE "ManualOddsSnapshot" SET source='other' WHERE id=$1`, id("odds-v1"))).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ManualOddsSelection" WHERE id=$1`, id("odds-home"))).rejects.toThrow(/immutable/i);
  });

  it("rejects a replacement for another fixture or market", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"replacesOddsId") VALUES ($1,$4,'BTTS',$2,'manual','{}',$3)`, id("odds-invalid"), id("book-invalid"), id("odds-v1"), id("odds-fixture"))).rejects.toThrow(/replacement.*fixture.*market/i);
  });
});
