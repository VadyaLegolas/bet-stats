import { describe, expect, it, vi } from "vitest";

import { ApiFootballClient, ApiFootballProviderError } from "../../packages/football-data/src/index.js";

const fixtureEnvelope = {
  get: "fixtures",
  parameters: { league: "39", season: "2026", from: "2026-08-29", to: "2026-08-29" },
  errors: [],
  results: 1,
  paging: { current: 1, total: 1 },
  response: [{
    fixture: { id: 1379123, date: "2026-08-29T14:00:00+00:00", status: { short: "NS" }, timestamp: 1788012000 },
    league: { id: 39, season: 2026 },
    teams: { home: { id: 42, name: "Arsenal FC" }, away: { id: 49, name: "Chelsea FC" } },
    goals: { home: null, away: null },
  }],
};

describe("API-Football strict provider adapter", () => {
  it("encodes a bounded fixture request and returns provider-neutral observations", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixtureEnvelope), { status: 200, headers: { "x-ratelimit-requests-remaining": "91", "x-secret": "no" } }));
    const client = new ApiFootballClient({ apiKey: "secret", fetcher, now: () => new Date("2026-08-28T12:00:00Z") });
    const fixtures = await client.fetchFixtures({ leagueId: 39, season: 2026, competitionCode: "PL", dateFrom: "2026-08-29", dateTo: "2026-08-29" });

    expect(fixtures).toEqual([expect.objectContaining({ provider: "api-football", externalId: "1379123", status: "SCHEDULED", capturedAt: "2026-08-28T12:00:00.000Z" })]);
    expect(fetcher).toHaveBeenCalledWith("https://v3.football.api-sports.io/fixtures?league=39&season=2026&from=2026-08-29&to=2026-08-29", expect.objectContaining({ headers: { "x-apisports-key": "secret" }, signal: expect.any(AbortSignal) }));
  });

  it("fails closed when the envelope does not match the exact request", async () => {
    const payload = { ...fixtureEnvelope, parameters: { ...fixtureEnvelope.parameters, league: "140" } };
    const client = new ApiFootballClient({ apiKey: "secret", fetcher: async () => new Response(JSON.stringify(payload)) });
    await expect(client.fetchFixtures({ leagueId: 39, season: 2026, competitionCode: "PL", dateFrom: "2026-08-29", dateTo: "2026-08-29" })).rejects.toMatchObject({ code: "PAYLOAD_MISMATCH", classification: "quarantine" });
  });

  it.each([[429, "RATE_LIMITED"], [500, "PROVIDER_UNAVAILABLE"]] as const)("classifies HTTP %s without disclosing credentials", async (status, code) => {
    const key = "DO_NOT_DISCLOSE";
    const client = new ApiFootballClient({ apiKey: key, fetcher: async () => new Response(key, { status, headers: { authorization: key, "retry-after": "30" } }) });
    const error = await client.fetchFixtures({ leagueId: 39, season: 2026, competitionCode: "PL", dateFrom: "2026-08-29", dateTo: "2026-08-29" }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiFootballProviderError);
    expect(error).toMatchObject({ code, classification: "fallback", safeHeaders: { "retry-after": "30" } });
    expect(JSON.stringify(error)).not.toContain(key);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("rejects malformed and unexpected payload fields as non-authoritative", async () => {
    const client = new ApiFootballClient({ apiKey: "secret", fetcher: async () => new Response(JSON.stringify({ ...fixtureEnvelope, credential: "unexpected" })) });
    await expect(client.fetchFixtures({ leagueId: 39, season: 2026, competitionCode: "PL", dateFrom: "2026-08-29", dateTo: "2026-08-29" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD", classification: "quarantine" });
  });

  it("supports request-bound leagues, standings and teams envelopes", async () => {
    const responses = [
      { get: "leagues", parameters: { id: "39", season: "2026" }, errors: [], results: 1, paging: { current: 1, total: 1 }, response: [{ league: { id: 39, name: "Premier League", type: "League" }, country: { name: "England", code: "GB" }, seasons: [{ year: 2026, start: "2026-08-08", end: "2027-05-23", current: true }] }] },
      { get: "standings", parameters: { league: "39", season: "2026" }, errors: [], results: 1, paging: { current: 1, total: 1 }, response: [{ league: { id: 39, season: 2026, standings: [[{ rank: 1, team: { id: 42, name: "Arsenal FC" }, points: 9, goalsDiff: 7, all: { played: 3, win: 3, draw: 0, lose: 0, goals: { for: 8, against: 1 } } }]] } }] },
      { get: "teams", parameters: { league: "39", season: "2026" }, errors: [], results: 1, paging: { current: 1, total: 1 }, response: [{ team: { id: 42, name: "Arsenal FC" } }] },
    ];
    const client = new ApiFootballClient({ apiKey: "secret", fetcher: vi.fn(async () => new Response(JSON.stringify(responses.shift()))) });
    await expect(client.fetchLeague({ leagueId: 39, season: 2026 })).resolves.toMatchObject({ leagueId: 39, season: 2026 });
    await expect(client.fetchStandings({ leagueId: 39, season: 2026, competitionCode: "PL" })).resolves.toMatchObject({ provider: "api-football", rows: [{ teamExternalId: "42" }] });
    await expect(client.fetchTeams({ leagueId: 39, season: 2026 })).resolves.toEqual([expect.objectContaining({ provider: "api-football", externalId: "42" })]);
  });
});
