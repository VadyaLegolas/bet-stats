import { describe, expect, it, vi } from "vitest";
import { resolveCandidateExternalMapping } from "../../workers/data-sync/src/jobs/fixtures.js";
import { resolveEndpointCandidateMappings } from "../../workers/data-sync/src/ingestion/provider-route-runtime.js";

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
  it.each([[[]], [[{ leagueExternalId: "39", seasonExternalId: "2026" }, { leagueExternalId: "140", seasonExternalId: "2026" }]], [[{ leagueExternalId: "PL", seasonExternalId: "2026" }]]])("fails closed on missing, duplicate or nonnumeric API-Football mapping", async (rows) => {
    const database = { $queryRawUnsafe: async () => rows } as any;
    await expect(resolveCandidateExternalMapping(database, "league", "season", "api-football")).rejects.toThrow(/PROVIDER_MAPPING/);
  });
});
