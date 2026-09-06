import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;

async function seedFixture(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO "League" (id,name,"countryCode") VALUES ('p3-league','League','GB') ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn") VALUES ('p3-season','p3-league','2026','2026-01-01','2026-12-31') ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Team" (id,name,"normalizedName","countryCode") VALUES
      ('p3-home','Home','home','GB'),('p3-away','Away','away','GB') ON CONFLICT (id) DO NOTHING;
    INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status)
      VALUES ('p3-fixture','p3-league','p3-season','p3-home','p3-away','2026-09-10T18:00:00Z','SCHEDULED') ON CONFLICT (id) DO NOTHING;
  `);
}

describe("append-only forecast snapshots", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await seedFixture();
  });
  afterAll(async () => prisma?.$disconnect());

  it("deduplicates identical content and links changed evidence as a revision", async () => {
    const insert = async (id: string, inputHash: string, revision: number, supersedes: string | null) => prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
       VALUES ($1,'p3-fixture','PRE_MATCH','ISSUED',$3,$4,'2026-09-10T16:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash',$2,$2,'[]','{}','{}','[]','{}',now())
       RETURNING id`,
      id, inputHash, revision, supersedes,
    );

    expect((await insert("forecast-v1", "evidence-v1", 1, null))[0]?.id).toBe("forecast-v1");
    await expect(insert("forecast-duplicate", "evidence-v1", 1, null)).rejects.toThrow(/unique constraint/i);
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "ForecastSnapshot" WHERE "inputHash"='evidence-v1'`);
    expect(existing).toEqual([{ id: "forecast-v1" }]);
    expect((await insert("forecast-v2", "evidence-v2", 2, "forecast-v1"))[0]?.id).toBe("forecast-v2");

    await expect(prisma.$executeRawUnsafe(`UPDATE "ForecastSnapshot" SET assumptions='["changed"]' WHERE id='forecast-v1'`)).rejects.toThrow(/immutable/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ForecastSnapshot" WHERE id='forecast-v1'`)).rejects.toThrow(/immutable/i);
  });

  it("requires official confirmed-lineup provenance for LINEUP_CONFIRMED", async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
      VALUES ('lineup-no-source','p3-fixture','LINEUP_CONFIRMED','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','m','forecast-config-v1','c','i','e','[]','{}','{}','[]','{}',now())
    `)).rejects.toThrow(/official confirmed-lineup/i);

    await prisma.$executeRawUnsafe(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ('lineup-source','official-provider','LINEUPS','p3-fixture',now(),'lineup-hash','{}',2)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "LineupObservation" (id,"fixtureId","observationId",status,"confirmedAt") VALUES ('lineup-observation','p3-fixture','lineup-source','OFFICIAL_CONFIRMED',now())`);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,"officialLineupObservationId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt")
      VALUES ('lineup-valid','p3-fixture','LINEUP_CONFIRMED','ISSUED',1,'lineup-observation','2026-09-10T17:00:00Z','poisson-v1','m2','forecast-config-v1','c2','i2','e2','[]','{}','{}','[]','{}',now())
    `)).resolves.toBe(1);
  });
});
