import { z } from "zod";

const pagingSchema = z.object({ current: z.number().int().positive(), total: z.number().int().nonnegative() }).strict();
const envelopeBase = {
  get: z.string().min(1),
  parameters: z.record(z.string(), z.string()),
  errors: z.array(z.unknown()).max(20),
  results: z.number().int().nonnegative().max(10_000),
  paging: pagingSchema,
};
const teamSchema = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1) }).strict();

export const apiFootballFixtureSchema = z.object({
  fixture: z.object({
    id: z.number().int().positive(),
    date: z.string().datetime({ offset: true }),
    status: z.object({ short: z.string().min(1) }).strict(),
    timestamp: z.number().int().nonnegative(),
  }).strict(),
  league: z.object({ id: z.number().int().positive(), season: z.number().int().min(2000).max(2200) }).strict(),
  teams: z.object({ home: teamSchema, away: teamSchema }).strict(),
  goals: z.object({ home: z.number().int().nonnegative().nullable(), away: z.number().int().nonnegative().nullable() }).strict(),
}).strict();

export const apiFootballFixturesEnvelopeSchema = z.object({
  ...envelopeBase,
  get: z.literal("fixtures"),
  response: z.array(apiFootballFixtureSchema).max(10_000),
}).strict();

const seasonSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  start: z.string().date(),
  end: z.string().date(),
  current: z.boolean(),
}).strict();

export const apiFootballLeaguesEnvelopeSchema = z.object({
  ...envelopeBase,
  get: z.literal("leagues"),
  response: z.array(z.object({
    league: z.object({ id: z.number().int().positive(), name: z.string().min(1), type: z.string().min(1) }).strict(),
    country: z.object({ name: z.string().min(1), code: z.string().min(1).nullable() }).strict(),
    seasons: z.array(seasonSchema).min(1).max(100),
  }).strict()).max(1),
}).strict();

const standingRowSchema = z.object({
  rank: z.number().int().positive(),
  team: teamSchema,
  points: z.number().int(),
  goalsDiff: z.number().int(),
  all: z.object({
    played: z.number().int().nonnegative(),
    win: z.number().int().nonnegative(),
    draw: z.number().int().nonnegative(),
    lose: z.number().int().nonnegative(),
    goals: z.object({ for: z.number().int().nonnegative(), against: z.number().int().nonnegative() }).strict(),
  }).strict(),
}).strict();

export const apiFootballStandingsEnvelopeSchema = z.object({
  ...envelopeBase,
  get: z.literal("standings"),
  response: z.array(z.object({ league: z.object({
    id: z.number().int().positive(),
    season: z.number().int().min(2000).max(2200),
    standings: z.array(z.array(standingRowSchema).min(1)).min(1).max(10),
  }).strict() }).strict()).max(1),
}).strict();

export const apiFootballTeamsEnvelopeSchema = z.object({
  ...envelopeBase,
  get: z.literal("teams"),
  response: z.array(z.object({ team: teamSchema }).strict()).max(1_000),
}).strict();

export function parametersMatch(actual: Record<string, string>, expected: Record<string, string>): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

export const apiFootballEnrichmentEndpoints = ["lineups", "injuries", "odds", "fixtures/statistics"] as const;
export type ApiFootballEnrichmentEndpoint = (typeof apiFootballEnrichmentEndpoints)[number];

const nullableUrl = z.string().url().nullable();
const lineupPlayerSchema = z.object({ id: z.number().int().positive(), name: z.string().min(1), number: z.number().int().nullable(), pos: z.string().min(1).nullable(), grid: z.string().nullable() }).strict();
const lineupItemSchema = z.object({
  team: teamSchema.extend({ logo: nullableUrl, colors: z.unknown().nullable() }).strict(),
  formation: z.string().min(1),
  coach: z.object({ id: z.number().int().positive().nullable(), name: z.string().min(1), photo: nullableUrl }).strict(),
  startXI: z.array(z.object({ player: lineupPlayerSchema }).strict()).max(20),
  substitutes: z.array(z.object({ player: lineupPlayerSchema }).strict()).max(30),
}).strict();
const fixtureIdentitySchema = z.object({ id: z.number().int().positive(), timezone: z.string().min(1), date: z.string().datetime({ offset: true }), timestamp: z.number().int().nonnegative() }).strict();
const injuryItemSchema = z.object({
  player: z.object({ id: z.number().int().positive(), name: z.string().min(1), photo: nullableUrl, type: z.string().min(1), reason: z.string().min(1) }).strict(),
  team: teamSchema.extend({ logo: nullableUrl }).strict(),
  fixture: fixtureIdentitySchema,
  league: z.object({ id: z.number().int().positive(), season: z.number().int(), name: z.string().min(1), country: z.string().min(1), logo: nullableUrl, flag: nullableUrl }).strict(),
}).strict();
const oddsItemSchema = z.object({
  league: z.object({ id: z.number().int().positive(), name: z.string().min(1), country: z.string().min(1), logo: nullableUrl, flag: nullableUrl, season: z.number().int() }).strict(),
  fixture: fixtureIdentitySchema,
  update: z.string().datetime({ offset: true }),
  bookmakers: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1), bets: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1), values: z.array(z.object({ value: z.string().min(1), odd: z.string().regex(/^\d+(?:\.\d+)?$/) }).strict()).max(500) }).strict()).max(500) }).strict()).max(250),
}).strict();
const statisticsItemSchema = z.object({
  team: teamSchema.extend({ logo: nullableUrl }).strict(),
  statistics: z.array(z.object({ type: z.string().min(1), value: z.union([z.number().finite(), z.string(), z.null()]) }).strict()).max(250),
}).strict();

export function parseApiFootballEnrichmentEnvelope(endpoint: ApiFootballEnrichmentEndpoint, value: unknown, expectedParameters: Record<string, string>) {
  const item = endpoint === "lineups" ? lineupItemSchema : endpoint === "injuries" ? injuryItemSchema : endpoint === "odds" ? oddsItemSchema : statisticsItemSchema;
  const parsed = z.object({ ...envelopeBase, get: z.literal(endpoint), response: z.array(item).max(1_000) }).strict().safeParse(value);
  if (!parsed.success || !parametersMatch(parsed.data.parameters, expectedParameters) || parsed.data.results !== parsed.data.response.length) throw new Error("INVALID_ENRICHMENT_PAYLOAD");
  return parsed.data.response.length === 0
    ? { state: "observed-empty" as const, payload: null }
    : { state: "observed" as const, payload: parsed.data.response };
}
