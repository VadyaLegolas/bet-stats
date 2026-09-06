import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;

async function seedFixture(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('p3-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('p3-season','p3-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES
      ('p3-home','Home','home','GB',now()),('p3-away','Away','away','GB',now()) ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt")
      VALUES ('${id("p3-fixture")}','p3-league','p3-season','p3-home','p3-away','2026-09-10T18:00:00Z','SCHEDULED',now()) ON CONFLICT (id) DO NOTHING;
  `);
}

describe("append-only forecast snapshots", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await seedFixture();
  });
  afterAll(async () => prisma?.$disconnect());

  it("deduplicates identical content and links changed evidence as a revision", async () => {
    const insert = async (snapshotId: string, inputHash: string, revision: number, supersedes: string | null) => prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
       VALUES ($1,'${id("p3-fixture")}','PRE_MATCH','ISSUED',$3,$4,'2026-09-10T16:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash',$2,$2,'[]','{}','{}','[]','{}',now())
       RETURNING id`,
      snapshotId, inputHash, revision, supersedes,
    );

    expect((await insert(id("forecast-v1"), id("evidence-v1"), 1, null))[0]?.id).toBe(id("forecast-v1"));
    await expect(insert(id("forecast-duplicate"), id("evidence-v1"), 1, null)).rejects.toThrow(/unique constraint/i);
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ForecastSnapshot" WHERE "inputHash"=$1`, id("evidence-v1"));
    expect(existing).toEqual([{ id: id("forecast-v1") }]);
    expect((await insert(id("forecast-v2"), id("evidence-v2"), 2, id("forecast-v1")))[0]?.id).toBe(id("forecast-v2"));

    await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET assumptions='["changed"]' WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastSnapshot" WHERE id=$1`, id("forecast-v1"))).rejects.toThrow(/immutable/i);
  });

  it("requires official confirmed-lineup provenance for LINEUP_CONFIRMED", async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
      VALUES ('${id("lineup-no-source")}','${id("p3-fixture")}','LINEUP_CONFIRMED','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','${id("m")}', 'forecast-config-v1','${id("c")}','${id("i")}','${id("e")}','[]','{}','{}','[]','{}',now())
    `)).rejects.toThrow(/official confirmed-lineup/i);

    await prisma.$executeRawUnsafe(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,'official-provider','LINEUPS',$3,now(),$2,'{}',2)`, id("lineup-source"), id("lineup-hash"), id("p3-fixture"));
    await prisma.$executeRawUnsafe(`INSERT INTO "LineupObservation" (id,"fixtureId","observationId",status,"confirmedAt") VALUES ($1,$3,$2,'OFFICIAL_CONFIRMED',now())`, id("lineup-observation"), id("lineup-source"), id("p3-fixture"));
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"officialLineupObservationId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
      VALUES ($1,'${id("p3-fixture")}','LINEUP_CONFIRMED','ISSUED',1,$2,'2026-09-10T17:00:00Z','poisson-v1',$3,'forecast-config-v1',$4,$5,$6,'[]','{}','{}','[]','{}',now())
    `, id("lineup-valid"), id("lineup-observation"), id("m2"), id("c2"), id("i2"), id("e2"))).resolves.toBe(1);
  });
});
