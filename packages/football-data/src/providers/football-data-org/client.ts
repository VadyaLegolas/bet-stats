import type { FixtureProvider, NormalizedFixture, NormalizedResult, NormalizedStandingSnapshot, RequestedDateWindow, ResultProvider, StandingsProvider, StandingsRequestCoverage } from "../../provider.interface.js";
import { normalizeCompetitionMatches, normalizeCompetitionResults, normalizeCompetitionStandings, ProviderPayloadError } from "./normalize.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FootballDataOrgClientOptions {
  apiToken: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  now?: () => Date;
}

export class FootballDataOrgClient implements FixtureProvider, ResultProvider, StandingsProvider {
  readonly #apiToken: string;
  readonly #fetcher: Fetcher;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: FootballDataOrgClientOptions) {
    if (!options.apiToken) throw new Error("football-data.org API token is required");
    this.#apiToken = options.apiToken;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#now = options.now ?? (() => new Date());
  }

  async fetchPremierLeagueFixtures(): Promise<readonly NormalizedFixture[]> {
    try {
      const response = await this.#fetcher("https://api.football-data.org/v4/competitions/PL/matches?status=SCHEDULED", {
        headers: { "X-Auth-Token": this.#apiToken },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeCompetitionMatches(await response.json(), this.#now());
    } catch (error) {
      if (error instanceof ProviderPayloadError) throw error;
      // Provider/network errors may echo request headers; do not retain them on the public error.
      throw new Error("football-data.org request failed");
    }
  }


  async fetchCompetitionResults(window: RequestedDateWindow): Promise<readonly NormalizedResult[]> {
    try {
      const query = new URLSearchParams({ status: "FINISHED", dateFrom: window.dateFrom, dateTo: window.dateTo });
      const response = await this.#fetcher(`https://api.football-data.org/v4/competitions/PL/matches?${query}`, {
        headers: { "X-Auth-Token": this.#apiToken },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeCompetitionResults(await response.json(), window, this.#now());
    } catch (error) {
      if (error instanceof ProviderPayloadError) throw error;
      throw new Error("football-data.org request failed");
    }
  }

  fetchCompletedResults(window: RequestedDateWindow): Promise<readonly NormalizedResult[]> {
    return this.fetchCompetitionResults(window);
  }

  async fetchCompetitionStandings(coverage: StandingsRequestCoverage): Promise<NormalizedStandingSnapshot> {
    try {
      const response = await this.#fetcher(`https://api.football-data.org/v4/competitions/${encodeURIComponent(coverage.competitionCode)}/standings`, {
        headers: { "X-Auth-Token": this.#apiToken },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeCompetitionStandings(await response.json(), coverage, this.#now());
    } catch (error) {
      if (error instanceof ProviderPayloadError) throw error;
      throw new Error("football-data.org request failed");
    }
  }

  fetchStandings(coverage: StandingsRequestCoverage): Promise<NormalizedStandingSnapshot> {
    return this.fetchCompetitionStandings(coverage);
  }
}
