import type { CanonicalFixtureStatus, NormalizedFixture, NormalizedResult, RequestedDateWindow, ReturnedMatchCoverage } from "../../provider.interface.js";
import { competitionMatchesSchema, competitionResultsSchema } from "./schema.js";

export class ProviderPayloadError extends Error {
  override readonly name = "ProviderPayloadError";
}

function normalizeStatus(status: string): CanonicalFixtureStatus {
  switch (status) {
    case "SCHEDULED":
    case "TIMED": return "SCHEDULED";
    case "IN_PLAY": return "IN_PLAY";
    case "PAUSED": return "PAUSED";
    case "FINISHED": return "FINISHED";
    case "POSTPONED": return "POSTPONED";
    case "CANCELLED":
    case "SUSPENDED": return "CANCELLED";
    default: throw new ProviderPayloadError(`Unknown fixture status: ${status}`);
  }
}

export function normalizeCompetitionMatches(payload: unknown, capturedAt = new Date()): readonly NormalizedFixture[] {
  const parsed = competitionMatchesSchema.safeParse(payload);
  if (!parsed.success) throw new ProviderPayloadError("Invalid football-data.org competition matches payload");
  return parsed.data.matches.map((match) => ({
    provider: "football-data.org",
    externalId: String(match.id),
    competitionExternalId: parsed.data.competition.code,
    seasonExternalId: String(match.season.id),
    homeTeamExternalId: String(match.homeTeam.id),
    homeTeamName: match.homeTeam.name,
    awayTeamExternalId: String(match.awayTeam.id),
    awayTeamName: match.awayTeam.name,
    kickoffUtc: match.utcDate,
    status: normalizeStatus(match.status),
    capturedAt: capturedAt.toISOString(),
    sourceUpdatedAt: match.lastUpdated,
    raw: match,
  }));
}

export function normalizeCompetitionResults(
  payload: unknown,
  requestedWindow: RequestedDateWindow,
  capturedAt = new Date(),
): readonly NormalizedResult[] {
  const parsed = competitionResultsSchema.safeParse(payload);
  if (!parsed.success) throw new ProviderPayloadError("Invalid football-data.org competition results payload");

  const kickoffTimes = parsed.data.matches.map((match) => match.utcDate).sort();
  const returnedCoverage: ReturnedMatchCoverage = {
    matchCount: kickoffTimes.length,
    earliestKickoffUtc: kickoffTimes[0] ?? null,
    latestKickoffUtc: kickoffTimes.at(-1) ?? null,
  };

  return parsed.data.matches.map((match) => ({
    provider: "football-data.org",
    externalId: String(match.id),
    competitionExternalId: parsed.data.competition.code,
    seasonExternalId: String(match.season.id),
    homeTeamExternalId: String(match.homeTeam.id),
    awayTeamExternalId: String(match.awayTeam.id),
    kickoffUtc: match.utcDate,
    homeScore: match.score.fullTime.home,
    awayScore: match.score.fullTime.away,
    capturedAt: capturedAt.toISOString(),
    sourceUpdatedAt: match.lastUpdated,
    requestedWindow,
    returnedCoverage,
    raw: match,
  }));
}
