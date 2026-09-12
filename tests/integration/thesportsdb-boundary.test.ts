import { describe, expect, it, vi } from "vitest";
import { TheSportsDbSuggestionClient } from "../../packages/football-data/src/providers/thesportsdb/client.js";

describe("TheSportsDB review-only boundary", () => {
  it("projects only provenance-bearing name, alias and logo suggestions", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ teams: [{ idTeam: "133604", strTeam: "Arsenal", strTeamShort: "ARS", strAlternate: "Arsenal FC, The Gunners", strBadge: "https://r2.thesportsdb.com/images/media/team/badge/example.png", intFormedYear: "1886", strStadium: "Emirates", strDescriptionEN: "fixture-looking prose" }] }), { status: 200 }));
    const client = new TheSportsDbSuggestionClient({ fetcher, now: () => new Date("2026-09-13T10:00:00Z") });

    const suggestions = await client.searchTeams("Arsenal");

    expect(suggestions).toEqual([{ provider: "THESPORTSDB", capturedAt: "2026-09-13T10:00:00.000Z", externalId: "133604", name: "Arsenal", aliases: ["ARS", "Arsenal FC", "The Gunners"], logoCandidate: "https://r2.thesportsdb.com/images/media/team/badge/example.png" }]);
    expect(JSON.stringify(suggestions)).not.toMatch(/fixture|result|score|statistic|stadium|description/i);
    expect(fetcher.mock.calls[0]?.[0]).toContain("searchteams.php?t=Arsenal");
  });

  it("returns a sanitized provider error and never leaks query contents", async () => {
    const client = new TheSportsDbSuggestionClient({ fetcher: async () => { throw new Error("secret query token"); } });
    await expect(client.searchTeams("secret query token")).rejects.toThrow("TheSportsDB suggestion request failed");
  });
});
