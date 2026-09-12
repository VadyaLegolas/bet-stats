import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import type { ForecastResponseDto } from "@bet-stats/domain";

import { createPrismaForecastRepository } from "../../apps/api/src/modules/forecasts/forecasts.service.js";

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

  it("does not expose an official lineup whose source receipt was captured after cutoff", async () => {
    const fixtureId = id("p3-fixture");
    await prisma.$executeRawUnsafe(`INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,'api-football','LINEUPS',$2,'2026-09-10T17:05:00Z',$3,'{}',2)`, id("late-source"), fixtureId, id("late-hash"));
    await prisma.$executeRawUnsafe(`INSERT INTO "LineupObservation" (id,"fixtureId","observationId",status,"confirmedAt") VALUES ($1,$2,$3,'OFFICIAL_CONFIRMED','2026-09-10T16:55:00Z')`, id("late-lineup"), fixtureId, id("late-source"));
    const repository = createPrismaForecastRepository(prisma);
    await expect(repository.findOfficialLineup(fixtureId, "2026-09-10T17:00:00.000Z")).resolves.toBeNull();
  });

  it("serializes concurrent distinct contents into consecutive linked revisions", async () => {
    const fixtureId = id("p3-fixture");
    const draft = (suffix: string): ForecastResponseDto => ({
      id: id(`race-${suffix}`),
      fixtureId,
      kind: "INITIAL",
      officialLineupObservationId: null,
      revision: 1,
      cutoff: "2026-09-09T12:00:00.000Z",
      modelVersion: "poisson-ensemble-v1",
      modelHash: id("race-model"),
      configVersion: "forecast-config-v1",
      configHash: id("race-config"),
      inputHash: id(`race-input-${suffix}`),
      evidenceFingerprint: id(`race-evidence-${suffix}`),
      evidenceBuildIds: [id(`away-${suffix}`), id(`home-${suffix}`)],
      probabilities: {
        ONE_X_TWO: [{ selection: "HOME", probability: 0.5, fairOdds: "2" }, { selection: "DRAW", probability: 0.25, fairOdds: "4" }, { selection: "AWAY", probability: 0.25, fairOdds: "4" }],
        OVER_UNDER_2_5: [{ selection: "OVER_2_5", probability: 0.5, fairOdds: "2" }, { selection: "UNDER_2_5", probability: 0.5, fairOdds: "2" }],
        BTTS: [{ selection: "YES", probability: 0.5, fairOdds: "2" }, { selection: "NO", probability: 0.5, fairOdds: "2" }],
      },
      confidence: { version: "confidence-v1", score: 0.8, components: { completeness: 1, lineupAvailability: 0, freshness: 1, sourceReliability: 1, modelStability: 1 } },
      limitations: [],
      tail: { retainedMass: 1, tailMass: 0, warning: false, normalizationVersion: "retained-mass-v1" },
      assumptions: [],
      receipt: { forecastSnapshotId: id(`race-${suffix}`), officialLineupObservationId: null, evidenceBuildIds: [id(`away-${suffix}`), id(`home-${suffix}`)], sourceRefs: [], expectedGoals: { home: 1.5, away: 1 }, adjustments: { home: { multiplier: 1, components: {} }, away: { multiplier: 1, components: {} } } },
      issuedAt: "2026-09-09T12:00:01.000Z",
    });
    const repository = createPrismaForecastRepository(prisma);

    const [first, second] = await Promise.all([repository.publish(draft("a")), repository.publish(draft("b"))]);
    const rows = await prisma.forecastSnapshot.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { revision: "asc" }, select: { id: true, revision: true, supersedesForecastId: true } });

    expect(rows.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(rows[0]?.supersedesForecastId).toBeNull();
    expect(rows[1]?.supersedesForecastId).toBe(rows[0]?.id);
  });
});
