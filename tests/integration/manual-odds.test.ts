import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { createPrismaManualOddsRepository, submitManualOdds } from "../../apps/api/src/modules/odds/odds.service.js";

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
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc","status","updatedAt") VALUES ('${id("odds-fixture-2")}','odds-league','odds-season','odds-home-team','odds-away-team','2026-09-11T18:00:00Z','SCHEDULED',now()) ON CONFLICT (id) DO NOTHING;
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

  it("persists distinct immutable identities when source provenance changes", async () => {
    const repository = createPrismaManualOddsRepository(prisma);
    const base = { fixtureId: id("odds-fixture"), market: "BTTS" as const, capturedAt: "2026-09-06T12:00:00.000Z", selections: [{ selection: "YES" as const, decimalOdds: "2.2" }, { selection: "NO" as const, decimalOdds: "1.8" }] };
    const first = await submitManualOdds({ ...base, oddsSnapshotId: id("source-a"), sourceLabel: "Book A" }, repository, new Date("2026-09-06T12:00:00.000Z"));
    const second = await submitManualOdds({ ...base, oddsSnapshotId: id("source-b"), sourceLabel: "Book B" }, repository, new Date("2026-09-06T12:00:00.000Z"));
    expect(second.oddsSnapshotId).not.toBe(first.oddsSnapshotId);
  });

  it("re-lists the fixture's saved books newest first and never leaks another fixture's books", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES
        ($1,$5,'OVER_UNDER_2_5',$2,'manual','{}','2026-09-06T12:00:00Z'),
        ($3,$5,'OVER_UNDER_2_5',$4,'manual','{}','2026-09-06T13:00:00Z'),
        ($6,$7,'OVER_UNDER_2_5',$2,'manual','{}','2026-09-06T14:00:00Z')
      ON CONFLICT (id) DO NOTHING;`,
      id("listed-old"), id("hash-old"), id("listed-new"), id("hash-new"), id("odds-fixture"), id("listed-foreign"), id("odds-fixture-2"));
    const repository = createPrismaManualOddsRepository(prisma);
    const listed = await repository.list(id("odds-fixture"));
    const listedIds = listed.map(({ oddsSnapshotId }) => oddsSnapshotId);
    expect(listedIds).toContain(id("listed-old"));
    expect(listedIds).toContain(id("listed-new"));
    expect(listedIds.indexOf(id("listed-new"))).toBeLessThan(listedIds.indexOf(id("listed-old")));
    expect(listedIds).not.toContain(id("listed-foreign"));
  });
});
