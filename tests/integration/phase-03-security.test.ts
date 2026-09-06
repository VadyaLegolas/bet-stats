import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import {
  createPrismaForecastRepository,
  generateForecast,
  type ForecastPublicationRepository,
} from "../../apps/api/src/modules/forecasts/forecasts.service.js";
import { createPrismaManualOddsRepository, submitManualOdds } from "../../apps/api/src/modules/odds/odds.service.js";
import { compareValue, createPrismaValueRepository, receiptDownload } from "../../apps/api/src/modules/value/value.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const run = process.pid.toString();
const id = (value: string) => `${value}-${run}`;
let prisma: PrismaClient;

const cutoff = "2026-09-10T12:00:00.000Z";
const source = {
  fixtureId: "history-1",
  effectiveAt: "2026-09-01T12:00:00.000Z",
  observedAt: "2026-09-01T12:05:00.000Z",
  sourceUpdatedAt: null,
  payloadHash: "sha256:phase-03-source",
  payloadBytes: 37,
};

function projection(teamId: string, buildId: string, sourceRef = source) {
  return {
    teamId,
    requestedAsOf: cutoff,
    resolvedAsOfUtc: cutoff,
    cutoffBoundary: { observedAt: cutoff },
    state: "COMPLETE" as const,
    freshness: "FRESH" as const,
    buildId,
    publishedAt: cutoff,
    receipt: {
      requestedAsOf: cutoff,
      resolvedAsOf: cutoff,
      configVersion: "evidence-v1",
      sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: sourceRef.effectiveAt, returnedTo: sourceRef.effectiveAt },
      inputs: [sourceRef],
    },
    coverage: { eligibleFixtureCount: 5, earliestKickoff: sourceRef.effectiveAt, latestKickoff: sourceRef.effectiveAt },
    components: {
      goalRates: { kind: "goalRates" as const, value: { for: 1.6, against: 1.1 }, unit: "goals-per-match", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      elo: { kind: "elo" as const, value: 1510, unit: "elo-rating", sampleSize: 1, limitation: null, sourceRefs: [sourceRef] },
      form5: { kind: "form5" as const, value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      homeStrength: { kind: "homeStrength" as const, value: 1.8, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      awayStrength: { kind: "awayStrength" as const, value: 1.2, unit: "points-per-match", sampleSize: 5, limitation: null, sourceRefs: [sourceRef] },
      restDays: { kind: "restDays" as const, value: 7, unit: "days", sampleSize: 1, limitation: null, sourceRefs: [sourceRef] },
    },
  };
}

const request = { fixtureId: "fixture-1", kind: "PRE_MATCH" as const, cutoff };

function forecastRepository(overrides: Partial<ForecastPublicationRepository> = {}): ForecastPublicationRepository {
  return {
    assertEligible: async () => undefined,
    findFixture: async () => ({ id: request.fixtureId, homeTeamId: "home", awayTeamId: "away", kickoffUtc: "2026-09-11T12:00:00.000Z", canonicalIdentityResolved: true }),
    findEvidence: async (teamId) => projection(teamId, `${teamId}-build`),
    findOfficialLineup: async () => null,
    publish: async (draft) => draft,
    ...overrides,
  };
}

describe("Phase 3 trust boundaries", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ('security-league','League','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ('security-season','security-league','2026','2026-01-01','2026-12-31',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES
        ('security-home','Home','security-home','GB',now()),('security-away','Away','security-away','GB',now()) ON CONFLICT (id) DO NOTHING;
      INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt")
        VALUES ('${id("security-fixture")}','security-league','security-season','security-home','security-away','2026-09-11T18:00:00Z','SCHEDULED',now()) ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => prisma?.$disconnect());

  it("fails policy before fixture, evidence, calculation, or persistence access", async () => {
    const calls: string[] = [];
    const repository = forecastRepository({
      assertEligible: async () => { calls.push("policy"); throw Object.assign(new Error("POLICY_INELIGIBLE"), { code: "POLICY_INELIGIBLE" }); },
      findFixture: async () => { calls.push("fixture"); throw new Error("must not query"); },
      findEvidence: async () => { calls.push("evidence"); throw new Error("must not query"); },
      publish: async () => { calls.push("publish"); throw new Error("must not persist"); },
    });
    await expect(generateForecast(request, repository)).rejects.toMatchObject({ code: "POLICY_INELIGIBLE" });
    expect(calls).toEqual(["policy"]);
  });

  it("rejects post-cutoff provenance including source update time before publication", async () => {
    let publications = 0;
    const postCutoff = { ...source, sourceUpdatedAt: "2026-09-10T12:00:00.001Z" };
    await expect(generateForecast(request, forecastRepository({
      findEvidence: async (teamId) => projection(teamId, `${teamId}-build`, postCutoff),
      publish: async (draft) => { publications += 1; return draft; },
    }))).rejects.toMatchObject({ code: "POST_CUTOFF_SOURCE_INPUT" });
    expect(publications).toBe(0);
    expect(postCutoff).toMatchObject({ payloadHash: "sha256:phase-03-source", payloadBytes: 37 });
  });

  it("recognizes only durable OFFICIAL_CONFIRMED lineup provenance", async () => {
    const observationId = id("official-source");
    const lineupId = id("official-lineup");
    await prisma.sourceObservation.create({
      data: { id: observationId, provider: "official-provider", endpointFamily: "LINEUPS", externalIdentity: id("security-fixture"), observedAt: new Date("2026-09-10T11:00:00.000Z"), payloadHash: id("lineup-hash"), rawPayload: {}, payloadBytes: 2 },
    });
    await prisma.lineupObservation.create({
      data: { id: lineupId, fixtureId: id("security-fixture"), observationId, status: "OFFICIAL_CONFIRMED", confirmedAt: new Date("2026-09-10T11:00:00.000Z") },
    });

    const repository = createPrismaForecastRepository(prisma);
    await expect(repository.findOfficialLineup(id("security-fixture"), cutoff)).resolves.toEqual({ id: lineupId });
  });

  it("rejects client-derived odds/value fields before mutation and keeps hostile labels out of download headers", async () => {
    let mutations = 0;
    const book = {
      fixtureId: "fixture-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", sourceLabel: "evil\r\nContent-Disposition: inline",
      capturedAt: cutoff,
      selections: [{ selection: "HOME", decimalOdds: "2.2" }, { selection: "DRAW", decimalOdds: "3.4" }, { selection: "AWAY", decimalOdds: "Infinity" }],
      noVigProbability: "1",
    };
    await expect(submitManualOdds(book, { append: async () => { mutations += 1; throw new Error("must not mutate"); } })).rejects.toMatchObject({ code: "INVALID_ODDS_BOOK_KEYS" });
    await expect(compareValue({ fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", oddsSnapshotId: "odds-1", market: "ONE_X_TWO", selection: "HOME", latest: true }, {
      findForecast: async () => { throw new Error("must not query"); }, findOdds: async () => { throw new Error("must not query"); }, findReceipt: async () => null, insertReceipt: async () => { mutations += 1; throw new Error("must not mutate"); },
    })).rejects.toMatchObject({ code: "INVALID_VALUE_COMMAND_KEYS" });
    const download = await receiptDownload("receipt-safe", { findReceiptById: async () => ({ id: "receipt-safe", sourceLabel: book.sourceLabel }) as never });
    expect(download.filename).toBe("value-receipt-receipt-safe.json");
    expect(download.filename).not.toContain("evil");
    expect(mutations).toBe(0);
  });

  it("converges concurrent identical forecast, odds, and value commands on one durable identity", async () => {
    const fixtureId = id("security-fixture");
    const forecastId = id("concurrent-forecast");
    const oddsId = id("concurrent-odds");
    const forecast = {
      id: forecastId, fixtureId, kind: "PRE_MATCH" as const, revision: 1, cutoff,
      modelVersion: "poisson-ensemble-v1" as const, modelHash: id("model"), configVersion: "forecast-config-v1" as const,
      configHash: id("config"), inputHash: id("forecast-input"), evidenceFingerprint: id("evidence"), evidenceBuildIds: [id("away-build"), id("home-build")],
      probabilities: {
        ONE_X_TWO: [{ selection: "HOME" as const, probability: 0.6, fairOdds: "1.6666666666666667" }, { selection: "DRAW" as const, probability: 0.2, fairOdds: "5" }, { selection: "AWAY" as const, probability: 0.2, fairOdds: "5" }],
        OVER_UNDER_2_5: [{ selection: "OVER_2_5" as const, probability: 0.5, fairOdds: "2" }, { selection: "UNDER_2_5" as const, probability: 0.5, fairOdds: "2" }],
        BTTS: [{ selection: "YES" as const, probability: 0.5, fairOdds: "2" }, { selection: "NO" as const, probability: 0.5, fairOdds: "2" }],
      },
      confidence: { version: "confidence-v1" as const, score: 0.8, components: { completeness: 1, lineupAvailability: 0, freshness: 1, sourceReliability: 1, modelStability: 1 } },
      limitations: [] as string[], tail: { retainedMass: 0.999, tailMass: 0.001, warning: false, normalizationVersion: "retained-mass-v1" as const },
      assumptions: ["independent Poisson"],
      receipt: { forecastSnapshotId: forecastId, evidenceBuildIds: [id("away-build"), id("home-build")], sourceRefs: [source], expectedGoals: { home: 1.5, away: 1 }, adjustments: { home: { multiplier: 1, components: {} }, away: { multiplier: 1, components: {} } } },
      issuedAt: "2026-09-10T12:00:01.000Z", officialLineupObservationId: null,
    };
    const forecastRepository = createPrismaForecastRepository(prisma);
    const forecastResults = await Promise.all([forecastRepository.publish(forecast), forecastRepository.publish(forecast)]);
    expect(forecastResults.map(({ id }) => id)).toEqual([forecastId, forecastId]);

    const book = {
      fixtureId, oddsSnapshotId: oddsId, market: "ONE_X_TWO" as const, sourceLabel: "Manual source", capturedAt: cutoff,
      selections: [{ selection: "HOME" as const, decimalOdds: "2" }, { selection: "DRAW" as const, decimalOdds: "3.5" }, { selection: "AWAY" as const, decimalOdds: "5" }],
    };
    const oddsRepository = createPrismaManualOddsRepository(prisma);
    const oddsResults = await Promise.all([submitManualOdds(book, oddsRepository), submitManualOdds(book, oddsRepository)]);
    expect(oddsResults.map(({ oddsSnapshotId }) => oddsSnapshotId)).toEqual([oddsId, oddsId]);

    const command = { fixtureId, forecastSnapshotId: forecastId, oddsSnapshotId: oddsId, market: "ONE_X_TWO" as const, selection: "HOME" as const };
    const valueRepository = createPrismaValueRepository(prisma);
    const valueResults = await Promise.all([compareValue(command, valueRepository), compareValue(command, valueRepository)]);
    expect(new Set(valueResults.map(({ id }) => id))).toHaveLength(1);
    await expect(prisma.valueReceipt.count({ where: { forecastSnapshotId: forecastId, oddsSnapshotId: oddsId } })).resolves.toBe(1);
  });
});
