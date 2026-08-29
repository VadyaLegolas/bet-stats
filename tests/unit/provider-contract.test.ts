import { describe, expect, it, vi } from "vitest";

import { FootballDataOrgClient, ProviderPayloadError } from "../../packages/football-data/src/index.js";
import { normalizeCompetitionMatches } from "../../packages/football-data/src/index.js";

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
});
