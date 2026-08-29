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

export interface RequestedDateWindow {
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
  fetchPremierLeagueFixtures(): Promise<readonly NormalizedFixture[]>;
}

export interface ResultProvider {
  fetchCompetitionResults(window: RequestedDateWindow): Promise<readonly NormalizedResult[]>;
  fetchCompletedResults(window: RequestedDateWindow): Promise<readonly NormalizedCompletedResult[]>;
}
