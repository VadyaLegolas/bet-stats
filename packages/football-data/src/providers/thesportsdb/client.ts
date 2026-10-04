type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type TheSportsDbSuggestion = Readonly<{ provider: "THESPORTSDB"; capturedAt: string; externalId: string; name: string; aliases: readonly string[]; logoCandidate: string | null }>;

export class TheSportsDbSuggestionClient {
  readonly #fetcher: Fetcher; readonly #timeoutMs: number; readonly #now: () => Date;
  constructor(options: { fetcher?: Fetcher; timeoutMs?: number; now?: () => Date } = {}) { this.#fetcher = options.fetcher ?? fetch; this.#timeoutMs = options.timeoutMs ?? 5_000; this.#now = options.now ?? (() => new Date()); }
  async searchTeams(query: string): Promise<readonly TheSportsDbSuggestion[]> {
    const normalized = query.trim().slice(0, 100); if (!normalized) return [];
    try {
      const response = await this.#fetcher(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(this.#timeoutMs) });
      if (!response.ok) throw new Error(); const value: unknown = await response.json();
      if (!value || typeof value !== "object" || !("teams" in value) || (!Array.isArray(value.teams) && value.teams !== null)) throw new Error();
      return (value.teams ?? []).slice(0, 10).flatMap((team: unknown) => projectTeam(team, this.#now()));
    } catch { throw new Error("TheSportsDB suggestion request failed"); }
  }
}
function projectTeam(value: unknown, capturedAt: Date): TheSportsDbSuggestion[] {
  if (!value || typeof value !== "object") return []; const row = value as Record<string, unknown>;
  if (typeof row.idTeam !== "string" || typeof row.strTeam !== "string" || !row.idTeam || !row.strTeam) return [];
  const aliases = [row.strTeamShort, ...(typeof row.strAlternate === "string" ? row.strAlternate.split(",") : [])].filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 10);
  return [{ provider: "THESPORTSDB", capturedAt: capturedAt.toISOString(), externalId: row.idTeam.slice(0, 100), name: row.strTeam.trim().slice(0, 200), aliases, logoCandidate: typeof row.strBadge === "string" ? row.strBadge.slice(0, 2_000) : null }];
}
