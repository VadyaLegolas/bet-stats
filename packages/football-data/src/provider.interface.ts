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

export interface FixtureProvider {
  fetchPremierLeagueFixtures(): Promise<readonly NormalizedFixture[]>;
}
