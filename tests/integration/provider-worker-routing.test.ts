import { describe, expect, it, vi } from "vitest";
import { resolveCandidateExternalMapping } from "../../workers/data-sync/src/jobs/fixtures.js";
import { callMappedFixtureProvider, callMappedResultProvider, callMappedStandingsProvider, createMappedProviderCandidates, resolveEndpointCandidateMappings } from "../../workers/data-sync/src/ingestion/provider-route-runtime.js";
import { createProviderRoute } from "@bet-stats/football-data";

describe("production provider worker routing", () => {
  it.each([["football-data.org", "PL", "2026"], ["api-football", "39", "2026"]])("resolves one canonical provider mapping for %s", async (provider, leagueExternalId, seasonExternalId) => {
    const database = { $queryRawUnsafe: vi.fn(async () => [{ leagueExternalId, seasonExternalId }]) } as any;
    await expect(resolveCandidateExternalMapping(database, "league-pl", "season-2026", provider)).resolves.toEqual({ provider, leagueExternalId, seasonExternalId, apiFootballLeagueId: provider === "api-football" ? 39 : null, apiFootballSeason: provider === "api-football" ? 2026 : null });
  });

  it.each(["FIXTURES", "RESULTS", "STANDINGS"] as const)("uses endpoint-specific %s routes and canonical mappings", async (endpoint) => {
    const resolveMapping = vi.fn(async (_leagueId: string, _seasonId: string, provider: string) => ({ provider, leagueExternalId: provider === "api-football" ? "39" : "PL", seasonExternalId: "2026", apiFootballLeagueId: provider === "api-football" ? 39 : null, apiFootballSeason: provider === "api-football" ? 2026 : null }));
    const result = await resolveEndpointCandidateMappings({ competition: "PL", season: "2026", endpoint, leagueId: "canonical-league", seasonId: "canonical-season", resolveMapping });
    expect(result.route.endpoint).toBe(endpoint);
    expect(result.mappings.map((mapping) => mapping.provider)).toEqual(["football-data.org", "api-football"]);
    expect(resolveMapping).toHaveBeenCalledWith("canonical-league", "canonical-season", "api-football");
  });

  it.each(["EL", "UEL", "UECL"])("keeps %s API-Football-only and fail closed", async (competition) => {
    const resolveMapping = vi.fn(async (_leagueId: string, _seasonId: string, provider: string) => ({ provider } as any));
    const result = await resolveEndpointCandidateMappings({ competition, season: "2026", endpoint: "RESULTS", leagueId: "league", seasonId: "season", resolveMapping });
    expect(result.route.soleSource).toBe(true);
    expect(resolveMapping).toHaveBeenCalledTimes(1);
    expect(resolveMapping).toHaveBeenCalledWith("league", "season", "api-football");
  });

  it("constructs only the route-selected factory and adapts every API-Football endpoint", async () => {
    const football = vi.fn(), fixtures = vi.fn(async () => []), results = vi.fn(async () => []), standings = vi.fn(async () => ({}));
    const api = vi.fn(() => ({ fetchFixtures: fixtures, fetchResults: results, fetchStandings: standings }));
    const route = createProviderRoute({ competition: "UEL", season: "2026", endpoint: "RESULTS" });
    const candidates = createMappedProviderCandidates(route, [{ provider: "api-football", leagueExternalId: "78", seasonExternalId: "2026", apiFootballLeagueId: 78, apiFootballSeason: 2026 }], { "football-data.org": football, "api-football": api });
    expect(football).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
    const dispatch = candidates[0]!.factory();
    await callMappedFixtureProvider(dispatch, { competitionCode: "EL", dateFrom: "2026-01-01", dateTo: "2026-01-02" });
    await callMappedResultProvider(dispatch, { competitionCode: "EL", dateFrom: "2026-01-01", dateTo: "2026-01-02" });
    await callMappedStandingsProvider(dispatch, { competitionCode: "EL" });
    expect(football).not.toHaveBeenCalled(); expect(api).toHaveBeenCalledOnce();
    expect(fixtures).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 78, season: 2026 }));
    expect(results).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 78, season: 2026 }));
    expect(standings).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 78, season: 2026 }));
  });
  it.each([[[]], [[{ leagueExternalId: "39", seasonExternalId: "2026" }, { leagueExternalId: "140", seasonExternalId: "2026" }]], [[{ leagueExternalId: "PL", seasonExternalId: "2026" }]]])("fails closed on missing, duplicate or nonnumeric API-Football mapping", async (rows) => {
    const database = { $queryRawUnsafe: async () => rows } as any;
    await expect(resolveCandidateExternalMapping(database, "league", "season", "api-football")).rejects.toThrow(/PROVIDER_MAPPING/);
  });

  it("binds provider season lookup to the selected canonical league", async () => {
    const query = vi.fn(async () => [{ leagueExternalId: "78", seasonExternalId: "2026" }]);
    await resolveCandidateExternalMapping({ $queryRawUnsafe: query } as any, "league-uel", "season-uel-2026", "api-football");
    const statement = query.mock.calls[0]![0] as string;
    expect(statement).toContain('s."leagueId" = l."leagueId"');
    expect(statement).toContain('season."leagueId" = s."leagueId"');
  });
});
