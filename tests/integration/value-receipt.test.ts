import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;

const probabilities = [{ selection: "HOME", probability: 0.6 }, { selection: "DRAW", probability: 0.2 }];
const selections = [
  { selection: "HOME", decimalOdds: "2", noVigProbability: "0.49" },
  { selection: "DRAW", decimalOdds: "3", noVigProbability: "0.33" },
];
const values = {
  HOME: { modelProbability: "0.6", noVigProbability: "0.49", decimalOdds: "2", fairOdds: "1.6666666666666667", edge: "0.11", expectedValue: "0.2" },
  DRAW: { modelProbability: "0.2", noVigProbability: "0.33", decimalOdds: "3", fairOdds: "5", edge: "-0.13", expectedValue: "-0.4" },
} as const;

async function insertValue(receiptId: string, forecastId: string, selection: keyof typeof values, overrides: Record<string, string> = {}) {
  const value = { market: "MATCH_RESULT", selection, ...values[selection], ...overrides };
  return prisma.$executeRawUnsafe(
    `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt)
     VALUES ($1,$2,'MATCH_RESULT',$3,$4,'VALUE_CANDIDATE',$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    receiptId, id("fixture"), forecastId, id("odds"), selection, value.modelProbability,
    value.noVigProbability, value.fairOdds, value.edge, value.expectedValue, JSON.stringify(value),
  );
}

describe("selection-aware value receipts", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('value-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('value-season','value-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ('value-home','Home','home','GB',now()),('value-away','Away','away','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id("fixture")}','value-league','value-season','value-home','value-away','2026-09-10T18:00:00Z','SCHEDULED',now());
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ('${id("other-fixture")}','value-league','value-season','value-home','value-away','2026-09-11T18:00:00Z','SCHEDULED',now());
    `);
    for (const [suffix, state] of [["issued", "ISSUED"], ["building", "BUILDING"], ["failed", "FAILED"]] as const) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$2,'PRE_MATCH',$3::"ForecastSnapshotState",1,'2026-09-10T16:00:00Z','poisson-v1',$4,'forecast-config-v1',$5,$6,$7,'[]','{}','{}','[]','{}',CASE WHEN $3='ISSUED' THEN now() ELSE NULL END)`,
        id(`forecast-${suffix}`), id("fixture"), state, id(`model-${suffix}`), id(`config-${suffix}`), id(`input-${suffix}`), id(`evidence-${suffix}`),
      );
      await prisma.$executeRawUnsafe(`INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,'MATCH_RESULT',$3::jsonb)`, id(`market-${suffix}`), id(`forecast-${suffix}`), JSON.stringify(probabilities));
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt) VALUES ($1,$2,'MATCH_RESULT',$3,'manual',$4::jsonb)`, id("odds"), id("fixture"), id("book"), JSON.stringify({ selections }));
  });
  afterAll(async () => prisma?.$disconnect());

  it("stores distinct immutable HOME and DRAW receipts for one exact pair", async () => {
    await expect(insertValue(id("home"), id("forecast-issued"), "HOME")).resolves.toBe(1);
    await expect(insertValue(id("draw"), id("forecast-issued"), "DRAW")).resolves.toBe(1);
    await expect(insertValue(id("home-duplicate"), id("forecast-issued"), "HOME")).rejects.toThrow(/unique|duplicate/i);
    await expect(prisma.$executeRawUnsafe(`UPDATE "ValueReceipt" SET outcome='NO_VALUE' WHERE id=$1`, id("home"))).rejects.toThrow(/immutable/i);
  });

  it.each(["building", "failed"])("rejects a %s forecast lifecycle", async (state) => {
    await expect(insertValue(id(state), id(`forecast-${state}`), "HOME")).rejects.toThrow(/exact issued forecast/i);
  });

  it("rejects a selection absent from immutable sources", async () => {
    const value = { market: "MATCH_RESULT", selection: "AWAY", ...values.HOME };
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ($1,$2,'MATCH_RESULT',$3,$4,'NO_VALUE','AWAY',$5,$6,$7,$8,$9,$10::jsonb)`,
      id("absent"), id("fixture"), id("forecast-issued"), id("odds"), value.modelProbability, value.noVigProbability, value.fairOdds, value.edge, value.expectedValue, JSON.stringify(value),
    )).rejects.toThrow(/selection must exist/i);
  });

  it.each([
    ["modelProbability", { modelProbability: "0.61" }], ["decimalOdds", { decimalOdds: "2.1" }],
    ["noVigProbability", { noVigProbability: "0.5" }], ["fairOdds", { fairOdds: "1.7" }],
    ["edge", { edge: "0.12" }], ["expectedValue", { expectedValue: "0.21" }],
  ])("rejects altered %s", async (field, override) => {
    await expect(insertValue(id(`altered-${field}`), id("forecast-issued"), "HOME", override)).rejects.toThrow(/derived fields disagree/i);
  });
});
