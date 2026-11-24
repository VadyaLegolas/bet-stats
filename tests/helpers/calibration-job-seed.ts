import type { PrismaClient } from "../../packages/database/src/client.js";
import type { ScoreMarket } from "../../packages/domain/src/evaluation/scoring.js";

import { mulberry32 } from "./calibration-samples.js";

/**
 * Deterministic match generator for the calibration job tests.
 *
 * Every match has expected goals (lambdaHome, lambdaAway); the TRUE probabilities of the three score markets come from an
 * independent Poisson grid and the real score is drawn from the same Poisson distributions. The RAW forecast written to the
 * database is the true vector raised to `gamma` and renormalised: gamma > 1 makes it over-confident (a calibrator that
 * softens it improves the Brier score), gamma = 1 is a perfectly calibrated process (a softening calibrator now hurts).
 */

export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
const MAX_GOALS = 12;

export interface GeneratedMatch {
  readonly index: number;
  readonly kickoff: Date;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly probabilities: Record<ScoreMarket, number[]>;
}

export interface GenerateMatchesInput {
  readonly count: number;
  readonly seed: number;
  /** Over-confidence exponent of the raw forecast (1 = calibrated). */
  readonly gamma: number;
  readonly startMs: number;
  /** Spacing between kickoffs; default four hours. */
  readonly stepMs?: number;
  /** Index offset so that ids and kickoffs of consecutive blocks never collide. */
  readonly indexOffset?: number;
}

function poissonPmf(lambda: number): number[] {
  const pmf: number[] = [Math.exp(-lambda)];
  for (let goals = 1; goals <= MAX_GOALS; goals += 1) pmf.push((pmf[goals - 1]! * lambda) / goals);
  return pmf;
}

function draw(pmf: readonly number[], uniform: number): number {
  let cumulative = 0;
  for (let goals = 0; goals < pmf.length; goals += 1) {
    cumulative += pmf[goals]!;
    if (uniform < cumulative) return goals;
  }
  return pmf.length - 1;
}

function temper(vector: readonly number[], gamma: number): number[] {
  const powered = vector.map((value) => Math.max(value, 1e-9) ** gamma);
  const total = powered.reduce((sum, value) => sum + value, 0);
  return powered.map((value) => value / total);
}

export function generateMatches(input: GenerateMatchesInput): GeneratedMatch[] {
  const random = mulberry32(input.seed);
  const step = input.stepMs ?? 4 * MS_HOUR;
  const offset = input.indexOffset ?? 0;
  return Array.from({ length: input.count }, (_, position) => {
    const index = position + offset;
    const lambdaHome = 0.5 + 2.3 * random();
    const lambdaAway = 0.4 + 1.8 * random();
    const homePmf = poissonPmf(lambdaHome);
    const awayPmf = poissonPmf(lambdaAway);
    let home = 0;
    let draws = 0;
    let away = 0;
    let over = 0;
    let both = 0;
    for (let h = 0; h <= MAX_GOALS; h += 1) {
      for (let a = 0; a <= MAX_GOALS; a += 1) {
        const mass = homePmf[h]! * awayPmf[a]!;
        if (h > a) home += mass;
        else if (h === a) draws += mass;
        else away += mass;
        if (h + a >= 3) over += mass;
        if (h > 0 && a > 0) both += mass;
      }
    }
    const homeGoals = draw(homePmf, random());
    const awayGoals = draw(awayPmf, random());
    return {
      index,
      kickoff: new Date(input.startMs + position * step),
      homeGoals,
      awayGoals,
      probabilities: {
        ONE_X_TWO: temper([home, draws, away], input.gamma),
        OVER_UNDER_2_5: temper([over, 1 - over], input.gamma),
        BTTS: temper([both, 1 - both], input.gamma),
      },
    };
  });
}

const SELECTIONS: Record<ScoreMarket, readonly string[]> = {
  ONE_X_TWO: ["HOME", "DRAW", "AWAY"],
  OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"],
  BTTS: ["YES", "NO"],
};

export interface SeedMatchesInput extends GenerateMatchesInput {
  readonly prefix: string;
  readonly modelVersion: string;
  readonly configHash: string;
  readonly leagueId: string;
  readonly seasonId: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

/** Writes a block of finished matches (fixture, result observed two hours after kickoff, one PRODUCTION PRE_MATCH snapshot with three markets) with `createMany`. */
export async function seedMatches(client: PrismaClient, input: SeedMatchesInput): Promise<GeneratedMatch[]> {
  const matches = generateMatches(input);
  if (matches.length === 0) return matches;
  const id = (match: GeneratedMatch): string => `${input.prefix}-${match.index}`;
  await client.fixture.createMany({
    data: matches.map((match) => ({ id: id(match), leagueId: input.leagueId, seasonId: input.seasonId, homeTeamId: input.homeTeamId, awayTeamId: input.awayTeamId, kickoffUtc: match.kickoff, status: "FINISHED" })),
  });
  await client.sourceObservation.createMany({
    data: matches.map((match) => ({
      id: `${id(match)}-obs`, provider: "test", endpointFamily: "RESULTS", externalIdentity: id(match),
      observedAt: new Date(match.kickoff.getTime() + 2 * MS_HOUR), payloadHash: `${id(match)}-hash`, rawPayload: {}, payloadBytes: 2,
    })),
  });
  await client.resultVersion.createMany({
    data: matches.map((match) => ({
      id: `${id(match)}-result`, fixtureId: id(match), observationId: `${id(match)}-obs`,
      effectiveAt: new Date(match.kickoff.getTime() + 2 * MS_HOUR), observedAt: new Date(match.kickoff.getTime() + 2 * MS_HOUR),
      homeGoals: match.homeGoals, awayGoals: match.awayGoals, status: "FINISHED", revision: 1,
    })),
  });
  const block = (match: GeneratedMatch, market: ScoreMarket) => SELECTIONS[market].map((selection, position) => ({ selection, probability: match.probabilities[market][position]!, fairOdds: 1 / match.probabilities[market][position]! }));
  await client.forecastSnapshot.createMany({
    data: matches.map((match) => {
      const cutoff = new Date(match.kickoff.getTime() - MS_HOUR);
      return {
        id: `${id(match)}-snap`, fixtureId: id(match), kind: "PRE_MATCH" as const, state: "ISSUED" as const, origin: "PRODUCTION" as const, revision: 1,
        cutoff, modelVersion: input.modelVersion, modelHash: `${id(match)}-model`, configVersion: "forecast-config-v1", configHash: input.configHash,
        inputHash: `${id(match)}-input`, evidenceFingerprint: `${id(match)}-evidence`, sourceRefs: [] as never,
        probabilities: { ONE_X_TWO: block(match, "ONE_X_TWO"), OVER_UNDER_2_5: block(match, "OVER_UNDER_2_5"), BTTS: block(match, "BTTS") } as never,
        confidence: {} as never, assumptions: [] as never, receipt: {} as never, issuedAt: new Date(cutoff.getTime() + 60_000),
      };
    }),
  });
  await client.forecastMarket.createMany({
    data: matches.flatMap((match) => (["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const).map((market) => ({ id: `${id(match)}-snap-${market}`, forecastSnapshotId: `${id(match)}-snap`, market, probabilities: block(match, market) as never }))),
  });
  return matches;
}
