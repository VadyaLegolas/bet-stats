import { describe, expect, it, vi } from "vitest";
import { TheSportsDbSuggestionClient } from "../../packages/football-data/src/providers/thesportsdb/client.js";
import { ProviderLogoService } from "../../apps/api/src/modules/media/provider-logo.service.js";

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

describe("provider logo validation", () => {
  it("returns an opaque reference only after HTTPS host, DNS, MIME, size and signature validation", async () => {
    const service = new ProviderLogoService({ resolve: async () => ["104.21.1.10"], fetcher: async () => new Response(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), { headers: { "content-type": "image/png", "content-length": "8" } }) });
    const result = await service.validate("https://r2.thesportsdb.com/logo.png");
    expect(result).toMatchObject({ status: "validated" });
    expect(result.logoRef).toMatch(/^provider-logo:/);
    expect(JSON.stringify(result)).not.toContain("https://");
  });
  it.each(["http://r2.thesportsdb.com/a.png", "https://127.0.0.1/a.png", "https://evil.example/a.png"])("rejects unsafe logo URL %s", async (url) => {
    const service = new ProviderLogoService({ resolve: async () => ["127.0.0.1"], fetcher: async () => new Response() });
    await expect(service.validate(url)).resolves.toEqual({ status: "placeholder", reason: "rejected" });
  });
  it("revalidates redirects and records broken media as a placeholder", async () => {
    const service = new ProviderLogoService({ resolve: async () => ["104.21.1.10"], fetcher: async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private.png" } }) });
    await expect(service.validate("https://r2.thesportsdb.com/a.png")).resolves.toEqual({ status: "placeholder", reason: "rejected" });
  });
});
