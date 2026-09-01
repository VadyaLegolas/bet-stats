export type CanonicalFixtureStatus = "SCHEDULED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "CANCELLED";

export interface NormalizedFixture {
  provider: "football-data.org";
  externalId: string;
  competitionExternalId: string;
  seasonExternalId: string;
  homeTeamExternalId: string;
  homeTeamName: string;
  awayTeamExternalId: string;
  awayTeamName: string;
  kickoffUtc: string;
  status: CanonicalFixtureStatus;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  raw: Readonly<Record<string, unknown>>;
}

export const configuredCompetitionCodes = ["PL", "PD", "BL1", "SA", "FL1", "CL", "EL"] as const;
export type ConfiguredCompetitionCode = (typeof configuredCompetitionCodes)[number];

export function isConfiguredCompetitionCode(value: string): value is ConfiguredCompetitionCode {
  return configuredCompetitionCodes.some((code) => code === value);
}

export interface RequestedDateWindow {
  competitionCode: ConfiguredCompetitionCode;
  dateFrom: string;
  dateTo: string;
}

export interface ReturnedMatchCoverage {
  matchCount: number;
  earliestKickoffUtc: string | null;
  latestKickoffUtc: string | null;
}

export interface NormalizedResult {
  provider: "football-data.org";
  externalId: string;
  competitionExternalId: string;
  seasonExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffUtc: string;
  homeScore: number;
  awayScore: number;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  requestedWindow: RequestedDateWindow;
  returnedCoverage: ReturnedMatchCoverage;
  raw: Readonly<Record<string, unknown>>;
}

export type NormalizedCompletedResult = NormalizedResult;

export interface FixtureProvider {
  fetchCompetitionFixtures(window: RequestedDateWindow): Promise<readonly NormalizedFixture[]>;
  /** @deprecated Use fetchCompetitionFixtures with an explicit competition and date window. */
  fetchPremierLeagueFixtures(): Promise<readonly NormalizedFixture[]>;
}

export interface ResultProvider {
  fetchCompetitionResults(window: RequestedDateWindow): Promise<readonly NormalizedResult[]>;
  fetchCompletedResults(window: RequestedDateWindow): Promise<readonly NormalizedCompletedResult[]>;
}

export interface StandingsRequestCoverage {
  competitionCode: ConfiguredCompetitionCode;
}

export interface NormalizedStandingRow {
  position: number;
  teamExternalId: string;
  teamName: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface NormalizedStandingSnapshot {
  provider: "football-data.org";
  competitionExternalId: string;
  seasonExternalId: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  requestedCoverage: StandingsRequestCoverage;
  returnedCoverage: { stage: string; type: "TOTAL"; rowCount: number };
  rows: readonly NormalizedStandingRow[];
  raw: Readonly<Record<string, unknown>>;
}

export type NormalizedStandingsSnapshot = NormalizedStandingSnapshot;

export interface StandingsProvider {
  fetchCompetitionStandings(coverage: StandingsRequestCoverage): Promise<NormalizedStandingSnapshot>;
  fetchStandings(coverage: StandingsRequestCoverage): Promise<NormalizedStandingsSnapshot>;
}
