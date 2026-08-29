import { describe, expect, it, vi } from "vitest";

import { FootballDataOrgClient, ProviderPayloadError } from "../../packages/football-data/src/index.js";
import { normalizeCompetitionMatches, normalizeCompetitionResults, normalizeCompetitionStandings } from "../../packages/football-data/src/index.js";

const validPayload = {
  competition: { code: "PL", name: "Premier League" },
  matches: [{
    id: 497410,
    utcDate: "2026-08-29T14:00:00Z",
    status: "TIMED",
    lastUpdated: null,
    season: { id: 2287, startDate: "2026-08-08", endDate: "2027-05-23" },
    homeTeam: { id: 57, name: "Arsenal FC" },
    awayTeam: { id: 61, name: "Chelsea FC" },
  }],
};

const finishedPayload = {
  competition: { code: "PL", name: "Premier League" },
  matches: [{
    ...validPayload.matches[0],
    status: "FINISHED",
    lastUpdated: "2026-08-29T16:02:03Z",
    score: { fullTime: { home: 2, away: 1 } },
  }],
};

const standingsPayload = {
  competition: { id: 2021, code: "PL", name: "Premier League" },
  season: { id: 2287, startDate: "2026-08-08", endDate: "2027-05-23" },
  lastUpdated: null,
  standings: [{
    stage: "REGULAR_SEASON",
    type: "TOTAL",
    table: [{
      position: 1,
      team: { id: 57, name: "Arsenal FC" },
      playedGames: 3,
      won: 3,
      draw: 0,
      lost: 0,
      points: 9,
      goalsFor: 8,
      goalsAgainst: 1,
      goalDifference: 7,
    }],
  }],
};

describe("football-data.org provider contract", () => {
  it("validates and normalizes nullable fixture data with provenance", () => {
    const capturedAt = new Date("2026-08-28T12:00:00Z");
    expect(normalizeCompetitionMatches(validPayload, capturedAt)).toEqual([expect.objectContaining({
      provider: "football-data.org",
      externalId: "497410",
      competitionExternalId: "PL",
      seasonExternalId: "2287",
      status: "SCHEDULED",
      sourceUpdatedAt: null,
      capturedAt: "2026-08-28T12:00:00.000Z",
      raw: validPayload.matches[0],
    })]);
  });

  it("rejects malformed payloads and unknown statuses", () => {
    expect(() => normalizeCompetitionMatches({ matches: "bad" }, new Date())).toThrow(ProviderPayloadError);
    expect(() => normalizeCompetitionMatches({ ...validPayload, matches: [{ ...validPayload.matches[0], status: "MYSTERY" }] }, new Date())).toThrow(/unknown fixture status/i);
  });

  it("times out fetches and never exposes the API token in errors", async () => {
    const token = "TEST_VALUE_A";
    const fetcher = vi.fn(async () => { throw new Error(`network failed for ${token}`); });
    const client = new FootballDataOrgClient({ apiToken: token, fetcher, timeoutMs: 5 });
    await expect(client.fetchPremierLeagueFixtures()).rejects.toThrow("football-data.org request failed");
    await expect(client.fetchPremierLeagueFixtures()).rejects.not.toThrow(token);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/competitions/PL/matches"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("does not retain credential-bearing provider errors as a public cause", async () => {
    const token = "TEST_VALUE_B";
    const client = new FootballDataOrgClient({ apiToken: token, fetcher: async () => { throw new Error(token); } });
    const error = await client.fetchPremierLeagueFixtures().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(token);
  });

  it("normalizes a finished result with capture and requested coverage provenance", () => {
    const requestedWindow = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    expect(normalizeCompetitionResults(finishedPayload, requestedWindow, new Date("2026-08-30T10:00:00Z"))).toEqual([
      expect.objectContaining({
        provider: "football-data.org",
        externalId: "497410",
        homeScore: 2,
        awayScore: 1,
        capturedAt: "2026-08-30T10:00:00.000Z",
        sourceUpdatedAt: "2026-08-29T16:02:03Z",
        requestedWindow,
        returnedCoverage: { matchCount: 1, earliestKickoffUtc: "2026-08-29T14:00:00Z", latestKickoffUtc: "2026-08-29T14:00:00Z" },
        raw: finishedPayload.matches[0],
      }),
    ]);
  });

  it("fails closed for unfinished or malformed result scores", () => {
    const window = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    expect(() => normalizeCompetitionResults({ ...finishedPayload, matches: [{ ...finishedPayload.matches[0], status: "TIMED" }] }, window)).toThrow(ProviderPayloadError);
    expect(() => normalizeCompetitionResults({ ...finishedPayload, matches: [{ ...finishedPayload.matches[0], score: { fullTime: { home: null, away: 1 } } }] }, window)).toThrow(ProviderPayloadError);
  });

  it("fetches completed results without synthesizing a provider update time", async () => {
    const payload = { ...finishedPayload, matches: [{ ...finishedPayload.matches[0], lastUpdated: null }] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const client = new FootballDataOrgClient({ apiToken: "token", fetcher, now: () => new Date("2026-08-30T10:00:00Z") });
    const results = await client.fetchCompetitionResults({ dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    expect(results[0]?.sourceUpdatedAt).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("status=FINISHED"), expect.any(Object));
  });

  it("normalizes standings as one atomic snapshot with envelope provenance", () => {
    const snapshot = normalizeCompetitionStandings(standingsPayload, { competitionCode: "PL" }, new Date("2026-08-30T10:00:00Z"));
    expect(snapshot).toEqual(expect.objectContaining({
      provider: "football-data.org",
      competitionExternalId: "2021",
      seasonExternalId: "2287",
      capturedAt: "2026-08-30T10:00:00.000Z",
      sourceUpdatedAt: null,
      requestedCoverage: { competitionCode: "PL" },
      returnedCoverage: { stage: "REGULAR_SEASON", type: "TOTAL", rowCount: 1 },
      raw: standingsPayload,
      rows: [expect.objectContaining({ teamExternalId: "57", position: 1, points: 9 })],
    }));
  });

  it("fails closed for malformed or partial standings envelopes", () => {
    expect(() => normalizeCompetitionStandings({ ...standingsPayload, standings: [] }, { competitionCode: "PL" })).toThrow(ProviderPayloadError);
    expect(() => normalizeCompetitionStandings({ ...standingsPayload, standings: [{ ...standingsPayload.standings[0], table: [{ position: 1 }] }] }, { competitionCode: "PL" })).toThrow(ProviderPayloadError);
  });

  it("fetches one complete standings snapshot", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(standingsPayload), { status: 200 }));
    const client = new FootballDataOrgClient({ apiToken: "token", fetcher, now: () => new Date("2026-08-30T10:00:00Z") });
    const snapshot = await client.fetchCompetitionStandings({ competitionCode: "PL" });
    expect(snapshot.rows).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/competitions/PL/standings"), expect.any(Object));
  });
});
