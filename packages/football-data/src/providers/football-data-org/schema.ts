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
