import { z } from "zod";

export const footballDataMatchSchema = z.object({
  id: z.number().int().nonnegative(),
  utcDate: z.string().datetime({ offset: true }),
  status: z.string().min(1),
  lastUpdated: z.string().datetime({ offset: true }).nullable(),
  season: z.object({ id: z.number().int().nonnegative(), startDate: z.string(), endDate: z.string() }),
  homeTeam: z.object({ id: z.number().int().nonnegative(), name: z.string().min(1) }),
  awayTeam: z.object({ id: z.number().int().nonnegative(), name: z.string().min(1) }),
}).passthrough();

export const competitionMatchesSchema = z.object({
  competition: z.object({ code: z.literal("PL"), name: z.string().min(1) }).passthrough(),
  matches: z.array(footballDataMatchSchema),
}).passthrough();

export type FootballDataCompetitionMatches = z.infer<typeof competitionMatchesSchema>;

export const footballDataFinishedMatchSchema = footballDataMatchSchema.extend({
  status: z.literal("FINISHED"),
  score: z.object({
    fullTime: z.object({
      home: z.number().int().nonnegative(),
      away: z.number().int().nonnegative(),
    }),
  }).passthrough(),
});

export const competitionResultsSchema = z.object({
  competition: z.object({ code: z.literal("PL"), name: z.string().min(1) }).passthrough(),
  matches: z.array(footballDataFinishedMatchSchema),
}).passthrough();

const standingRowSchema = z.object({
  position: z.number().int().positive(),
  team: z.object({ id: z.number().int().nonnegative(), name: z.string().min(1) }).passthrough(),
  playedGames: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  draw: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  points: z.number().int(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  goalDifference: z.number().int(),
}).passthrough();

export const competitionStandingsSchema = z.object({
  competition: z.object({ id: z.number().int().nonnegative(), code: z.literal("PL"), name: z.string().min(1) }).passthrough(),
  season: z.object({ id: z.number().int().nonnegative(), startDate: z.string(), endDate: z.string() }).passthrough(),
  lastUpdated: z.string().datetime({ offset: true }).nullable().optional(),
  standings: z.array(z.object({
    stage: z.string().min(1),
    type: z.string().min(1),
    table: z.array(standingRowSchema).min(1),
  }).passthrough()).min(1),
}).passthrough().superRefine((value, context) => {
  if (value.standings.filter((standing) => standing.type === "TOTAL").length !== 1) {
    context.addIssue({ code: "custom", message: "Standings envelope must contain exactly one TOTAL table", path: ["standings"] });
  }
});
