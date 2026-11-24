import {
  CALIBRATION_CONFIG,
  SCORE_CLASS_ORDER,
  calibrationOutcomeIndex,
  type CalibratorIdentity,
  type CalibrationSample,
  type ScoreMarket,
} from "@bet-stats/domain";

import type { PrismaClient } from "./client.js";
import { type ActiveCalibratorState, CALIBRATION_MARKETS, createPrismaCalibrationRepository } from "./calibration-repository.js";
import { resolveHistoricalResultGraph } from "./evaluation/backtest-repository.js";

/**
 * Leakage-safe read of calibration fit data and the census of eligible outcomes (Phase 12, D-04, CALIB-02, CALIB-04).
 *
 * The rules repeat those of the rho fit (`dixon-coles-repository.ts`, WR-04/WR-13) instead of rewriting them: a snapshot
 * qualifies only when it is PRODUCTION, ISSUED, of a fit kind, of the exact (modelVersion, configHash), cut off strictly
 * before kickoff, issued at or before `asOf`, and its fixture kicked off at or before `asOf`. The outcome comes from the
 * historical result lineage at `asOf`, so a result observed or corrected later cannot leak back. This module only reads.
 */

export interface CalibrationFitDataInput extends CalibratorIdentity {
  /** ISO-8601 instant: nothing observed, issued or started after it is read. */
  readonly asOf: string;
}

export interface CalibrationFitData {
  readonly identity: CalibratorIdentity;
  readonly asOf: string;
  /** One entry per settled fixture and market, ordered by (kickoffUtc, sampleId). */
  readonly samples: Readonly<Record<ScoreMarket, readonly CalibrationSample[]>>;
  /** Snapshot markets whose probabilities were unreadable (wrong class order, range or sum); an older revision was tried instead. */
  readonly skippedMalformedProbabilities: number;
  /** Fixtures whose visible result could not be used: ambiguous or broken lineage, not FINISHED, or a missing score. */
  readonly skippedUnusableResults: number;
}

export interface MarketCalibrationCensus {
  readonly active: ActiveCalibratorState | null;
  /** Count of settled, leakage-safe outcomes for the market and the exact identity. */
  readonly eligibleSampleSize: number;
}

export type CalibrationState = Readonly<Record<ScoreMarket, MarketCalibrationCensus>>;

const RESULT_BATCH_SIZE = 1000;
const PROBABILITY_SUM_TOLERANCE = 1e-9;

interface CandidateMarket {
  readonly sampleId: string;
  readonly probabilities: readonly number[];
}

interface Candidate {
  readonly fixtureId: string;
  readonly kickoffUtc: Date;
  readonly markets: Map<ScoreMarket, CandidateMarket>;
}

interface ResultNode {
  readonly id: string;
  readonly fixtureId: string;
  readonly observedAt: Date;
  readonly effectiveAt: Date;
  readonly supersedesResultVersionId: string | null;
  readonly status: string;
  readonly homeGoals: number | null;
  readonly awayGoals: number | null;
}

function asOfDate(asOf: string): Date {
  const date = new Date(asOf);
  if (typeof asOf !== "string" || !Number.isFinite(date.getTime())) throw Object.assign(new Error("INVALID_CALIBRATION_AS_OF"), { code: "INVALID_CALIBRATION_AS_OF" });
  return date;
}

/** Probabilities in `SCORE_CLASS_ORDER[market]` order, or null when the stored market block is not exactly that shape. */
function parseMarketProbabilities(market: ScoreMarket, stored: unknown): number[] | null {
  const order = SCORE_CLASS_ORDER[market];
  if (!Array.isArray(stored) || stored.length !== order.length) return null;
  const values: number[] = [];
  for (const [index, entry] of (stored as unknown[]).entries()) {
    if (entry === null || typeof entry !== "object") return null;
    const { selection, probability } = entry as Record<string, unknown>;
    if (selection !== order[index]) return null;
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    values.push(probability);
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 1) <= PROBABILITY_SUM_TOLERANCE ? values : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function readCalibrationFitData(client: PrismaClient, input: CalibrationFitDataInput): Promise<CalibrationFitData> {
  const asOf = asOfDate(input.asOf);
  const identity: CalibratorIdentity = { modelVersion: input.modelVersion, configHash: input.configHash };

  const snapshots = await client.forecastSnapshot.findMany({
    where: {
      state: "ISSUED",
      kind: { in: [...CALIBRATION_CONFIG.fit.kinds] },
      // D-04: backtest snapshots never train a served calibrator (they would also let an operator comparison move live fits).
      origin: "PRODUCTION",
      // D-06: the exact pair; V1 and DC forecasts of one fixture are independent samples and never mix.
      modelVersion: identity.modelVersion,
      configHash: identity.configHash,
      cutoff: { lt: asOf },
      // Reproducibility (WR-04): only what had been issued by `asOf` may train the fit.
      issuedAt: { lte: asOf },
      fixture: { kickoffUtc: { lte: asOf } },
    },
    // Explicit select: the heavy `receipt` JSON is never loaded.
    select: {
      id: true,
      fixtureId: true,
      cutoff: true,
      revision: true,
      fixture: { select: { kickoffUtc: true } },
      markets: { select: { market: true, probabilities: true } },
    },
    orderBy: [{ fixtureId: "asc" }, { revision: "desc" }],
  });

  let skippedMalformedProbabilities = 0;
  const candidates = new Map<string, Candidate>();
  for (const snapshot of snapshots) {
    // Revisions arrive newest first: per market take the newest revision that is itself pre-kickoff and readable.
    if (snapshot.cutoff.getTime() >= snapshot.fixture.kickoffUtc.getTime()) continue;
    let candidate = candidates.get(snapshot.fixtureId);
    if (!candidate) {
      candidate = { fixtureId: snapshot.fixtureId, kickoffUtc: snapshot.fixture.kickoffUtc, markets: new Map() };
      candidates.set(snapshot.fixtureId, candidate);
    }
    for (const stored of snapshot.markets) {
      const market = stored.market as ScoreMarket;
      if (!(CALIBRATION_MARKETS as readonly string[]).includes(market) || candidate.markets.has(market)) continue;
      const probabilities = parseMarketProbabilities(market, stored.probabilities);
      if (probabilities === null) {
        skippedMalformedProbabilities += 1;
        continue;
      }
      candidate.markets.set(market, { sampleId: snapshot.id, probabilities });
    }
  }

  const fixtureIds = [...candidates.keys()];
  const resultsByFixture = new Map<string, ResultNode[]>();
  for (let start = 0; start < fixtureIds.length; start += RESULT_BATCH_SIZE) {
    const rows = await client.resultVersion.findMany({
      where: { fixtureId: { in: fixtureIds.slice(start, start + RESULT_BATCH_SIZE) }, observedAt: { lte: asOf }, effectiveAt: { lte: asOf } },
      select: { id: true, fixtureId: true, observedAt: true, effectiveAt: true, supersedesResultVersionId: true, status: true, homeGoals: true, awayGoals: true },
    });
    for (const row of rows) {
      const bucket = resultsByFixture.get(row.fixtureId);
      if (bucket) bucket.push(row);
      else resultsByFixture.set(row.fixtureId, [row]);
    }
  }

  const samples: Record<ScoreMarket, CalibrationSample[]> = { ONE_X_TWO: [], OVER_UNDER_2_5: [], BTTS: [] };
  let skippedUnusableResults = 0;
  for (const candidate of candidates.values()) {
    if (candidate.markets.size === 0) continue;
    const visible = resultsByFixture.get(candidate.fixtureId);
    // A fixture without any visible result has not been settled as of `asOf`: not a skip, just not eligible yet.
    if (!visible || visible.length === 0) continue;
    let leaf: ResultNode | undefined;
    try {
      const selectedId = resolveHistoricalResultGraph(visible, candidate.fixtureId, asOf).id;
      leaf = visible.find((row) => row.id === selectedId);
    } catch {
      skippedUnusableResults += 1;
      continue;
    }
    if (!leaf || leaf.status !== "FINISHED" || leaf.homeGoals === null || leaf.awayGoals === null) {
      skippedUnusableResults += 1;
      continue;
    }
    // knownAt: the first moment any result of the fixture was visible, i.e. the lineage root observed by `asOf`.
    const knownAt = new Date(Math.min(...visible.map((row) => row.observedAt.getTime()))).toISOString();
    const kickoffUtc = candidate.kickoffUtc.toISOString();
    for (const [market, entry] of candidate.markets) {
      samples[market].push({
        sampleId: entry.sampleId,
        kickoffUtc,
        knownAt,
        probabilities: entry.probabilities,
        outcomeIndex: calibrationOutcomeIndex(market, leaf.homeGoals, leaf.awayGoals),
      });
    }
  }
  for (const market of CALIBRATION_MARKETS) {
    samples[market].sort((left, right) => compareText(left.kickoffUtc, right.kickoffUtc) || compareText(left.sampleId, right.sampleId));
  }

  return { identity, asOf: asOf.toISOString(), samples, skippedMalformedProbabilities, skippedUnusableResults };
}

/**
 * Per market: the calibrator active for the exact forecast identity and the number of eligible settled outcomes
 * (the basis of the INSUFFICIENT_DATA state). The identity goes into both reads as a query parameter.
 */
export async function readCalibrationState(client: PrismaClient, input: CalibrationFitDataInput): Promise<CalibrationState> {
  const identity: CalibratorIdentity = { modelVersion: input.modelVersion, configHash: input.configHash };
  const [data, active] = await Promise.all([
    readCalibrationFitData(client, input),
    createPrismaCalibrationRepository(client).findActiveCalibrators(identity),
  ]);
  return {
    ONE_X_TWO: { active: active.ONE_X_TWO, eligibleSampleSize: data.samples.ONE_X_TWO.length },
    OVER_UNDER_2_5: { active: active.OVER_UNDER_2_5, eligibleSampleSize: data.samples.OVER_UNDER_2_5.length },
    BTTS: { active: active.BTTS, eligibleSampleSize: data.samples.BTTS.length },
  };
}
