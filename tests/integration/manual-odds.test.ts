import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;

describe("append-only manual odds books", () => {
  beforeAll(() => { prisma = createPrismaClient(databaseUrl); });
  afterAll(async () => prisma?.$disconnect());

  it("preserves canonical decimal strings and links replacements forward", async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt) VALUES ('odds-v1','p3-fixture','MATCH_RESULT','book-v1','manual','{}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ('odds-home','odds-v1','HOME','2.12500000000000000001')`);
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"replacesOddsId") VALUES ('odds-v2','p3-fixture','MATCH_RESULT','book-v2','manual','{}','odds-v1')`);

    const rows = await prisma.$queryRawUnsafe<Array<{ decimalOdds: string }>>(`SELECT "decimalOdds" FROM "ManualOddsSelection" WHERE id='odds-home'`);
    expect(rows[0]?.decimalOdds).toBe("2.12500000000000000001");
    await expect(prisma.$executeRawUnsafe(`UPDATE "ManualOddsSnapshot" SET source='other' WHERE id='odds-v1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ManualOddsSelection" WHERE id='odds-home'`)).rejects.toThrow(/immutable/i);
  });

  it("rejects a replacement for another fixture or market", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"replacesOddsId") VALUES ('odds-invalid','p3-fixture','BTTS','book-invalid','manual','{}','odds-v1')`)).rejects.toThrow(/replacement.*fixture.*market/i);
  });
});
