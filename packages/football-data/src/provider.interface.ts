import { z } from "zod";

export const productionProviders = ["football-data.org", "api-football"] as const;
export type ProductionProvider = (typeof productionProviders)[number];

export class ProviderPayloadError extends Error {
  override readonly name = "ProviderPayloadError";
}

export type CanonicalFixtureStatus = "SCHEDULED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "CANCELLED";

export interface NormalizedFixture {
  provider: ProductionProvider;
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
  provider: ProductionProvider;
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
  provider: ProductionProvider;
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

export interface NormalizedTeamObservation {
  provider: ProductionProvider;
  externalId: string;
  name: string;
  competitionExternalId: string;
  seasonExternalId: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  raw: Readonly<Record<string, unknown>>;
}

const fixtureStatusSchema = z.enum(["SCHEDULED", "IN_PLAY", "PAUSED", "FINISHED", "POSTPONED", "CANCELLED"]);
const providerSchema = z.enum(productionProviders);
const normalizedFixtureSchema = z.object({
  provider: providerSchema,
  externalId: z.string().min(1),
  competitionExternalId: z.string().min(1),
  seasonExternalId: z.string().min(1),
  homeTeamExternalId: z.string().min(1),
  homeTeamName: z.string().trim().min(1),
  awayTeamExternalId: z.string().min(1),
  awayTeamName: z.string().trim().min(1),
  kickoffUtc: z.string().datetime({ offset: true }),
  status: fixtureStatusSchema,
  capturedAt: z.string().datetime({ offset: true }),
  sourceUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  raw: z.record(z.string(), z.unknown()),
}).strict();

export interface ObservationRequestBinding {
  provider?: ProductionProvider;
  competitionExternalId?: string;
  seasonExternalId?: string;
}

export function parseNormalizedFixture(value: unknown, expected: ObservationRequestBinding = {}): NormalizedFixture {
  const parsed = normalizedFixtureSchema.safeParse(value);
  if (!parsed.success) throw new ProviderPayloadError("Invalid normalized fixture observation");
  if ((expected.provider && parsed.data.provider !== expected.provider)
    || (expected.competitionExternalId && parsed.data.competitionExternalId !== expected.competitionExternalId)
    || (expected.seasonExternalId && parsed.data.seasonExternalId !== expected.seasonExternalId)) {
    throw new ProviderPayloadError("Normalized fixture does not match request");
  }
  return parsed.data;
}

/** Candidate key only: canonical identity resolution still belongs to audited persistence. */
export function canonicalFixtureKey(fixture: Pick<NormalizedFixture, "homeTeamName" | "awayTeamName" | "kickoffUtc">): string {
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return `${normalize(fixture.homeTeamName)}|${normalize(fixture.awayTeamName)}|${new Date(fixture.kickoffUtc).toISOString()}`;
}
