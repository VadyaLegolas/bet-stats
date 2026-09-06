import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;

describe("exact-pair value receipts", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ('forecast-market','forecast-v1','MATCH_RESULT','{}') ON CONFLICT (id) DO NOTHING`);
  });
  afterAll(async () => prisma?.$disconnect());

  it("persists the exact compatible forecast and odds snapshot IDs", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ('value-valid','p3-fixture','MATCH_RESULT','forecast-v1','odds-v1','VALUE_CANDIDATE','{}')`)).resolves.toBe(1);
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueReceipt" SET outcome='NO_VALUE' WHERE id='value-valid'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ValueReceipt" WHERE id='value-valid'`)).rejects.toThrow(/immutable/i);
  });

  it("rejects a cross-market pair at the database boundary", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ('value-invalid-market','p3-fixture','BTTS','forecast-v1','odds-v1','NO_VALUE','{}')`)).rejects.toThrow(/exact forecast.*odds pair/i);
  });

  it("rejects a cross-fixture pair at the database boundary", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,receipt) VALUES ('value-invalid-fixture','other-fixture','MATCH_RESULT','forecast-v1','odds-v1','NO_VALUE','{}')`)).rejects.toThrow(/exact forecast.*odds pair/i);
  });
});
