import { SCORE_CLASS_ORDER, type ScoreMarket } from "../../packages/domain/src/evaluation/scoring.js";
import type { PrismaClient } from "../../packages/database/src/client.js";

/**
 * Deterministic seeds for the calibration fit-data tests: real stored shapes (`ForecastMarket.probabilities` is
 * `[{ selection, probability, fairOdds }]` in class order, the revision chain is shared per (fixtureId, kind)).
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
export const DC_VERSION = "dixon-coles-ensemble-v1";
export const V1_VERSION = "poisson-ensemble-v1";
export const DC_CONFIG_HASH = `sha256:${"d".repeat(64)}`;
export const V1_CONFIG_HASH = `sha256:${"e".repeat(64)}`;

export const MARKETS = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"] as const satisfies readonly ScoreMarket[];

export type MarketProbabilities = Record<ScoreMarket, number[]>;

/** A readable block `[{ selection, probability, fairOdds }]` for one market. */
export function marketBlock(market: ScoreMarket, probabilities: readonly number[]): Array<{ selection: string; probability: number; fairOdds: number }> {
  return SCORE_CLASS_ORDER[market].map((selection, index) => ({ selection, probability: probabilities[index]!, fairOdds: 1 / probabilities[index]! }));
}

/** Distinct, valid probabilities per index; `variant` shifts them so that two identities can be told apart. */
export function probabilitiesFor(index: number, variant = 0): MarketProbabilities {
  const home = 0.30 + ((index + variant * 2) % 6) * 0.05;
  const draw = 0.25;
  const over = 0.40 + ((index + variant * 3) % 7) * 0.04;
  const yes = 0.45 + ((index + variant * 4) % 5) * 0.05;
  return {
    ONE_X_TWO: [home, draw, 1 - home - draw],
    OVER_UNDER_2_5: [over, 1 - over],
    BTTS: [yes, 1 - yes],
  };
}

export interface SeedSnapshot {
  readonly id?: string;
  readonly kind?: "INITIAL" | "PRE_MATCH" | "LINEUP_CONFIRMED";
  readonly origin?: "PRODUCTION" | "BACKTEST";
  readonly modelVersion?: string;
  readonly configHash?: string;
  /** Cutoff relative to kickoff; default one hour before. */
  readonly cutoffOffsetMs?: number;
  /** Absolute issue time; default one minute after the cutoff. */
  readonly issuedAt?: Date;
  /** Probabilities per market; default `probabilitiesFor(index)`. */
  readonly probabilities?: Partial<MarketProbabilities>;
  /** Raw stored `probabilities` of one market (replaces the generated block); used for malformed shapes. */
  readonly rawMarkets?: Partial<Record<ScoreMarket, unknown>>;
  readonly variant?: number;
}

export interface SeedResult {
  readonly id: string;
  readonly observedAt: Date;
  readonly effectiveAt?: Date;
  readonly homeGoals: number | null;
  readonly awayGoals: number | null;
  readonly status?: string;
  /** Id of the result version this one supersedes. */
  readonly supersedes?: string;
}

export interface SeedFixture {
  readonly id: string;
  readonly kickoff: Date;
  readonly index?: number;
  readonly snapshots?: readonly SeedSnapshot[];
  readonly results?: readonly SeedResult[];
}

export async function seedBase(client: PrismaClient, prefix: string): Promise<{ leagueId: string; seasonId: string; homeId: string; awayId: string }> {
  const ids = { leagueId: `${prefix}-league`, seasonId: `${prefix}-season`, homeId: `${prefix}-home`, awayId: `${prefix}-away` };
  await client.league.create({ data: { id: ids.leagueId, name: "League", countryCode: "GB" } });
  await client.season.create({ data: { id: ids.seasonId, leagueId: ids.leagueId, label: "2026", startsOn: new Date("2025-01-01"), endsOn: new Date("2027-12-31") } });
  await client.team.createMany({ data: [{ id: ids.homeId, name: "Home", normalizedName: `${prefix}-home`, countryCode: "GB" }, { id: ids.awayId, name: "Away", normalizedName: `${prefix}-away`, countryCode: "GB" }] });
  return ids;
}

/** Seeds one fixture with its result versions and snapshot revisions (sequential `create`, so the revision chain trigger sees each predecessor). */
export async function seedFixture(client: PrismaClient, base: { leagueId: string; seasonId: string; homeId: string; awayId: string }, spec: SeedFixture): Promise<void> {
  await client.fixture.create({
    data: { id: spec.id, leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId, kickoffUtc: spec.kickoff, status: "FINISHED" },
  });

  for (const result of spec.results ?? []) {
    await client.sourceObservation.create({
      data: { id: `${result.id}-obs`, provider: "test", endpointFamily: "RESULTS", externalIdentity: result.id, observedAt: result.observedAt, payloadHash: `${result.id}-hash`, rawPayload: {}, payloadBytes: 2 },
    });
    await client.resultVersion.create({
      data: {
        id: result.id,
        fixtureId: spec.id,
        observationId: `${result.id}-obs`,
        effectiveAt: result.effectiveAt ?? result.observedAt,
        observedAt: result.observedAt,
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
        status: result.status ?? "FINISHED",
        revision: result.supersedes === undefined ? 1 : 2,
        supersedesResultVersionId: result.supersedes ?? null,
      },
    });
  }

  const revisions = new Map<string, { revision: number; lastId: string | null }>();
  let counter = 0;
  for (const snapshot of spec.snapshots ?? []) {
    counter += 1;
    const kind = snapshot.kind ?? "PRE_MATCH";
    const chain = revisions.get(kind) ?? { revision: 0, lastId: null };
    const id = snapshot.id ?? `${spec.id}-snap-${counter}`;
    const cutoff = new Date(spec.kickoff.getTime() + (snapshot.cutoffOffsetMs ?? -HOUR_MS));
    const modelVersion = snapshot.modelVersion ?? DC_VERSION;
    const configHash = snapshot.configHash ?? (modelVersion === V1_VERSION ? V1_CONFIG_HASH : DC_CONFIG_HASH);
    const probabilities = { ...probabilitiesFor(spec.index ?? 0, snapshot.variant ?? 0), ...snapshot.probabilities };
    const blocks: Record<string, unknown> = Object.fromEntries(MARKETS.map((market) => [market, snapshot.rawMarkets?.[market] ?? marketBlock(market, probabilities[market])]));

    let lineupId: string | null = null;
    if (kind === "LINEUP_CONFIRMED") {
      lineupId = `${id}-lineup`;
      await client.sourceObservation.create({
        data: { id: `${lineupId}-obs`, provider: "test", endpointFamily: "LINEUPS", externalIdentity: lineupId, observedAt: new Date(cutoff.getTime() - 60_000), payloadHash: `${lineupId}-hash`, rawPayload: {}, payloadBytes: 2 },
      });
      await client.lineupObservation.create({ data: { id: lineupId, fixtureId: spec.id, observationId: `${lineupId}-obs`, status: "OFFICIAL_CONFIRMED", confirmedAt: new Date(cutoff.getTime() - 60_000) } });
    }

    await client.forecastSnapshot.create({
      data: {
        id,
        fixtureId: spec.id,
        kind,
        state: "ISSUED",
        origin: snapshot.origin ?? "PRODUCTION",
        revision: chain.revision + 1,
        supersedesForecastId: chain.lastId,
        officialLineupObservationId: lineupId,
        cutoff,
        modelVersion,
        modelHash: `${id}-model`,
        configVersion: "forecast-config-v1",
        configHash,
        inputHash: `${id}-input`,
        evidenceFingerprint: `${id}-evidence`,
        sourceRefs: [] as never,
        probabilities: blocks as never,
        confidence: {} as never,
        assumptions: [] as never,
        receipt: { officialLineupObservationId: lineupId } as never,
        issuedAt: snapshot.issuedAt ?? new Date(cutoff.getTime() + 60_000),
        markets: { create: MARKETS.map((market) => ({ id: `${id}-${market}`, market, probabilities: blocks[market] as never })) },
      },
    });
    revisions.set(kind, { revision: chain.revision + 1, lastId: id });
  }
}
