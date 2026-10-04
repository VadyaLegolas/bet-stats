import type { ConfiguredCompetitionCode, NormalizedFixture, NormalizedStandingSnapshot, NormalizedTeamObservation } from "../../provider.interface.js";
import type { z } from "zod";
import { apiFootballFixturesEnvelopeSchema, apiFootballStandingsEnvelopeSchema, apiFootballTeamsEnvelopeSchema, type ApiFootballEnrichmentEndpoint } from "./schema.js";

type FixtureEnvelope = z.infer<typeof apiFootballFixturesEnvelopeSchema>;
type StandingEnvelope = z.infer<typeof apiFootballStandingsEnvelopeSchema>;
type TeamsEnvelope = z.infer<typeof apiFootballTeamsEnvelopeSchema>;

export type ApiFootballEnrichmentObservation =
  | { readonly state: "observed-empty"; readonly capturedAt: string; readonly payload: null }
  | { readonly state: "observed"; readonly capturedAt: string; readonly payload: unknown };

function status(value: string): NormalizedFixture["status"] {
  switch (value) {
    case "TBD": case "NS": return "SCHEDULED";
    case "1H": case "2H": case "ET": case "BT": case "P": case "LIVE": return "IN_PLAY";
    case "HT": case "INT": return "PAUSED";
    case "FT": case "AET": case "PEN": return "FINISHED";
    case "PST": return "POSTPONED";
    case "CANC": case "ABD": case "AWD": case "WO": return "CANCELLED";
    default: throw new Error("Unknown API-Football fixture status");
  }
}

export function normalizeApiFootballFixtures(payload: FixtureEnvelope, capturedAt: Date): readonly NormalizedFixture[] {
  return payload.response.map((entry) => ({
    provider: "api-football",
    externalId: String(entry.fixture.id),
    competitionExternalId: String(entry.league.id),
    seasonExternalId: String(entry.league.season),
    homeTeamExternalId: String(entry.teams.home.id),
    homeTeamName: entry.teams.home.name,
    awayTeamExternalId: String(entry.teams.away.id),
    awayTeamName: entry.teams.away.name,
    kickoffUtc: entry.fixture.date,
    status: status(entry.fixture.status.short),
    capturedAt: capturedAt.toISOString(),
    sourceUpdatedAt: null,
    raw: entry,
  }));
}

export function normalizeApiFootballStandings(payload: StandingEnvelope, competitionCode: ConfiguredCompetitionCode, capturedAt: Date): NormalizedStandingSnapshot {
  const league = payload.response[0]!.league;
  const rows = league.standings[0]!;
  return {
    provider: "api-football",
    competitionExternalId: String(league.id),
    seasonExternalId: String(league.season),
    capturedAt: capturedAt.toISOString(),
    sourceUpdatedAt: null,
    requestedCoverage: { competitionCode },
    returnedCoverage: { stage: "REGULAR_SEASON", type: "TOTAL", rowCount: rows.length },
    rows: rows.map((row) => ({ position: row.rank, teamExternalId: String(row.team.id), teamName: row.team.name, playedGames: row.all.played, won: row.all.win, draw: row.all.draw, lost: row.all.lose, points: row.points, goalsFor: row.all.goals.for, goalsAgainst: row.all.goals.against, goalDifference: row.goalsDiff })),
    raw: payload,
  };
}

export function normalizeApiFootballTeams(payload: TeamsEnvelope, leagueId: number, season: number, capturedAt: Date): readonly NormalizedTeamObservation[] {
  return payload.response.map(({ team }) => ({ provider: "api-football", externalId: String(team.id), name: team.name, competitionExternalId: String(leagueId), seasonExternalId: String(season), capturedAt: capturedAt.toISOString(), sourceUpdatedAt: null, raw: team }));
}

export function normalizeApiFootballEnrichment(
  endpoint: ApiFootballEnrichmentEndpoint,
  payload: { readonly state: "observed-empty"; readonly payload: null } | { readonly state: "observed"; readonly payload: readonly unknown[] },
  externalFixtureId: number,
  canonicalFixtureId: string,
  capturedAt: Date,
): ApiFootballEnrichmentObservation {
  const capturedAtIso = capturedAt.toISOString();
  if (payload.state === "observed-empty") return { ...payload, capturedAt: capturedAtIso };
  if (endpoint !== "lineups") return { state: "observed", capturedAt: capturedAtIso, payload: payload.payload };

  const lineups = payload.payload as ReadonlyArray<{ team: { id: number }; startXI: ReadonlyArray<{ player: { id: number; name: string } }> }>;
  const teamIds = new Set(lineups.map((lineup) => lineup.team.id));
  const starters = lineups.flatMap((lineup) => lineup.startXI.map(({ player }) => player));
  const official = lineups.length === 2 && teamIds.size === 2
    && lineups.every((lineup) => lineup.startXI.length === 11 && new Set(lineup.startXI.map(({ player }) => player.id)).size === 11);
  return {
    state: "observed",
    capturedAt: capturedAtIso,
    payload: {
      fixtureId: canonicalFixtureId,
      externalFixtureId: String(externalFixtureId),
      status: official ? "OFFICIAL_CONFIRMED" : "PROVISIONAL",
      players: starters.map((player) => ({ externalId: String(player.id), name: player.name })),
    },
  };
}
