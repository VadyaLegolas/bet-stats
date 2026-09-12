import { ProviderPayloadError, type ConfiguredCompetitionCode, type NormalizedFixture, type NormalizedStandingSnapshot, type NormalizedTeamObservation } from "../../provider.interface.js";
import { normalizeApiFootballFixtures, normalizeApiFootballStandings, normalizeApiFootballTeams } from "./normalize.js";
import { apiFootballFixturesEnvelopeSchema, apiFootballLeaguesEnvelopeSchema, apiFootballStandingsEnvelopeSchema, apiFootballTeamsEnvelopeSchema, parametersMatch, parseApiFootballEnrichmentEnvelope, type ApiFootballEnrichmentEndpoint } from "./schema.js";

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type FailureCode = "TRANSPORT_FAILURE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "REQUEST_REJECTED" | "INVALID_PAYLOAD" | "PAYLOAD_MISMATCH";

export class ApiFootballProviderError extends ProviderPayloadError {
  override readonly name = "ApiFootballProviderError";

  constructor(
    readonly code: FailureCode,
    readonly classification: "fallback" | "quarantine",
    readonly safeHeaders: Readonly<Record<string, string>> = {},
  ) {
    super(`API-Football request failed: ${code}`);
  }
}

export interface ApiFootballClientOptions { apiKey: string; fetcher?: Fetcher; timeoutMs?: number; now?: () => Date }
export interface ApiFootballLeagueRequest { leagueId: number; season: number }
export interface ApiFootballFixtureRequest extends ApiFootballLeagueRequest { competitionCode: ConfiguredCompetitionCode; dateFrom: string; dateTo: string }
export interface ApiFootballCompetitionRequest extends ApiFootballLeagueRequest { competitionCode: ConfiguredCompetitionCode }

export class ApiFootballClient {
  readonly #apiKey: string;
  readonly #fetcher: Fetcher;
  readonly #timeoutMs: number;
  readonly #now: () => Date;

  constructor(options: ApiFootballClientOptions) {
    if (!options.apiKey) throw new Error("API-Football API key is required");
    this.#apiKey = options.apiKey;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#now = options.now ?? (() => new Date());
  }

  async fetchFixtures(request: ApiFootballFixtureRequest): Promise<readonly NormalizedFixture[]> {
    const parameters = { league: String(request.leagueId), season: String(request.season), from: request.dateFrom, to: request.dateTo };
    const payload = await this.#request("fixtures", parameters);
    const parsed = apiFootballFixturesEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw failure("INVALID_PAYLOAD", "quarantine");
    this.#assertEnvelope(parsed.data.parameters, parameters, parsed.data.results, parsed.data.response.length);
    if (parsed.data.response.some((entry) => entry.league.id !== request.leagueId || entry.league.season !== request.season)) throw failure("PAYLOAD_MISMATCH", "quarantine");
    try { return normalizeApiFootballFixtures(parsed.data, this.#now()); }
    catch { throw failure("INVALID_PAYLOAD", "quarantine"); }
  }

  async fetchLeague(request: ApiFootballLeagueRequest): Promise<{ leagueId: number; season: number; name: string; country: string }> {
    const parameters = { id: String(request.leagueId), season: String(request.season) };
    const parsed = apiFootballLeaguesEnvelopeSchema.safeParse(await this.#request("leagues", parameters));
    if (!parsed.success) throw failure("INVALID_PAYLOAD", "quarantine");
    this.#assertEnvelope(parsed.data.parameters, parameters, parsed.data.results, parsed.data.response.length);
    const item = parsed.data.response[0];
    const season = item?.seasons.find((candidate) => candidate.year === request.season);
    if (!item || item.league.id !== request.leagueId || !season) throw failure("PAYLOAD_MISMATCH", "quarantine");
    return { leagueId: item.league.id, season: season.year, name: item.league.name, country: item.country.name };
  }

  async fetchStandings(request: ApiFootballCompetitionRequest): Promise<NormalizedStandingSnapshot> {
    const parameters = { league: String(request.leagueId), season: String(request.season) };
    const parsed = apiFootballStandingsEnvelopeSchema.safeParse(await this.#request("standings", parameters));
    if (!parsed.success) throw failure("INVALID_PAYLOAD", "quarantine");
    this.#assertEnvelope(parsed.data.parameters, parameters, parsed.data.results, parsed.data.response.length);
    const league = parsed.data.response[0]?.league;
    if (!league || league.id !== request.leagueId || league.season !== request.season) throw failure("PAYLOAD_MISMATCH", "quarantine");
    return normalizeApiFootballStandings(parsed.data, request.competitionCode, this.#now());
  }

  async fetchTeams(request: ApiFootballLeagueRequest): Promise<readonly NormalizedTeamObservation[]> {
    const parameters = { league: String(request.leagueId), season: String(request.season) };
    const parsed = apiFootballTeamsEnvelopeSchema.safeParse(await this.#request("teams", parameters));
    if (!parsed.success) throw failure("INVALID_PAYLOAD", "quarantine");
    this.#assertEnvelope(parsed.data.parameters, parameters, parsed.data.results, parsed.data.response.length);
    return normalizeApiFootballTeams(parsed.data, request.leagueId, request.season, this.#now());
  }

  async fetchEnrichment(endpoint: ApiFootballEnrichmentEndpoint, fixtureId: number) {
    const parameters = { fixture: String(fixtureId) };
    return parseApiFootballEnrichmentEnvelope(endpoint, await this.#request(endpoint, parameters), parameters);
  }

  async #request(endpoint: string, parameters: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(parameters);
    let response: Response;
    try {
      response = await this.#fetcher(`https://v3.football.api-sports.io/${endpoint}?${query}`, { headers: { "x-apisports-key": this.#apiKey }, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch {
      throw failure("TRANSPORT_FAILURE", "fallback");
    }
    const headers = safeHeaders(response.headers);
    if (response.status === 429) throw failure("RATE_LIMITED", "fallback", headers);
    if (response.status >= 500) throw failure("PROVIDER_UNAVAILABLE", "fallback", headers);
    if (!response.ok) throw failure("REQUEST_REJECTED", "quarantine", headers);
    try { return await response.json(); }
    catch { throw failure("INVALID_PAYLOAD", "quarantine", headers); }
  }

  #assertEnvelope(actual: Record<string, string>, expected: Record<string, string>, results: number, length: number): void {
    if (!parametersMatch(actual, expected) || results !== length) throw failure("PAYLOAD_MISMATCH", "quarantine");
  }
}

const allowedResponseHeaders = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-requests-limit", "x-ratelimit-requests-remaining"] as const;
function safeHeaders(headers: Headers): Readonly<Record<string, string>> {
  return Object.fromEntries(allowedResponseHeaders.flatMap((name) => { const value = headers.get(name); return value === null ? [] : [[name, value]]; }));
}
function failure(code: FailureCode, classification: "fallback" | "quarantine", headers: Readonly<Record<string, string>> = {}): ApiFootballProviderError {
  return new ApiFootballProviderError(code, classification, headers);
}
