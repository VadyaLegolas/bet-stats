import { describe, expect, it, vi } from "vitest";
import { resolveCandidateExternalMapping } from "../../workers/data-sync/src/jobs/fixtures.js";

describe("production provider worker routing", () => {
  it.each([["football-data.org", "PL", "2026"], ["api-football", "39", "2026"]])("resolves one canonical provider mapping for %s", async (provider, leagueExternalId, seasonExternalId) => {
    const database = { $queryRawUnsafe: vi.fn(async () => [{ leagueExternalId, seasonExternalId }]) } as any;
    await expect(resolveCandidateExternalMapping(database, "league-pl", "season-2026", provider)).resolves.toEqual({ provider, leagueExternalId, seasonExternalId, apiFootballLeagueId: provider === "api-football" ? 39 : null, apiFootballSeason: provider === "api-football" ? 2026 : null });
  });
  it.each([[], [{ leagueExternalId: "39", seasonExternalId: "2026" }, { leagueExternalId: "140", seasonExternalId: "2026" }], [{ leagueExternalId: "PL", seasonExternalId: "2026" }]])("fails closed on missing, duplicate or nonnumeric API-Football mapping", async (rows) => {
    const database = { $queryRawUnsafe: async () => rows } as any;
    await expect(resolveCandidateExternalMapping(database, "league", "season", "api-football")).rejects.toThrow(/PROVIDER_MAPPING/);
  });
});
