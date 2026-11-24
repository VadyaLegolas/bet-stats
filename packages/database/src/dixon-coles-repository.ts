import {
  DIXON_COLES_CONFIG,
  DIXON_COLES_CONVENTION,
  dixonColesTauMin,
  estimateDixonColesRho,
  type DixonColesEstimationRow,
  type DixonColesProvenance,
} from "@bet-stats/domain";

import type { PrismaClient } from "./client.js";
import { resolveHistoricalResultGraph } from "./evaluation/backtest-repository.js";

export interface DixonColesParameters {
  readonly rho: number;
  readonly provenance: DixonColesProvenance;
}

interface CandidateRow {
  readonly fixtureId: string;
  readonly lambdaHome: number;
  readonly lambdaAway: number;
}

interface ResultNode {
  readonly id: string;
  readonly fixtureId: string;
  readonly observedAt: Date;
  readonly effectiveAt: Date;
  readonly supersedesResultVersionId: string | null;
  readonly homeGoals: number | null;
  readonly awayGoals: number | null;
}

function coded(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

/**
 * `ForecastSnapshot.receipt` stores the whole published forecast DTO
 * (forecast-repository.ts persists `receipt: response`), so the expected goals
 * live one level down at `receipt.receipt.expectedGoals`, not at the top level.
 */
function expectedGoalsOf(snapshotReceipt: unknown): { home: number; away: number } | null {
  if (snapshotReceipt === null || typeof snapshotReceipt !== "object") return null;
  const receipt = (snapshotReceipt as Record<string, unknown>).receipt;
  if (receipt === null || typeof receipt !== "object") return null;
  const expectedGoals = (receipt as Record<string, unknown>).expectedGoals;
  if (expectedGoals === null || typeof expectedGoals !== "object") return null;
  const { home, away } = expectedGoals as Record<string, unknown>;
  if (typeof home !== "number" || !Number.isFinite(home) || home <= 0) return null;
  if (typeof away !== "number" || !Number.isFinite(away) || away <= 0) return null;
  return { home, away };
}

/**
 * Collects leakage-safe (lambda, observed score) rows for one league or, when
 * `leagueId` is omitted, for every league in the window.
 *
 * A snapshot qualifies only when it was issued (and cut off) before its fixture kicked
 * off, was issued at or before `asOf`, and the fixture kicked off at or before `asOf`. Results are read through the
 * historical lineage graph at `asOf`, so a later correction cannot leak back.
 */
async function collectRows(
  client: PrismaClient,
  input: { asOf: Date; windowFrom: Date; leagueId?: string },
): Promise<DixonColesEstimationRow[]> {
  const snapshots = await client.forecastSnapshot.findMany({
    where: {
      state: "ISSUED",
      kind: "PRE_MATCH",
      cutoff: { lt: input.asOf },
      // Reproducibility (review WR-04): only what had been issued by `asOf` may train the fit,
      // so a later backfill or a re-run backtest cannot change rho for the same (league, asOf).
      issuedAt: { lte: input.asOf },
      // WR-13 / WR-04 residual: backtest snapshots are excluded. Their issuedAt is the wall-clock time
      // of the run, so for a fit at asOf = now (every production forecast) they would let an operator
      // comparison move the rho of live forecasts. Backtest and comparison fits (asOf =
      // window.trainingEndsAt) already exclude them through issuedAt, so nothing changes there.
      // Legacy backtest rows written before the origin migration are labelled PRODUCTION and stay in.
      origin: "PRODUCTION",
      fixture: {
        ...(input.leagueId ? { leagueId: input.leagueId } : {}),
        kickoffUtc: { gte: input.windowFrom, lte: input.asOf },
      },
    },
    select: { fixtureId: true, cutoff: true, revision: true, receipt: true, fixture: { select: { kickoffUtc: true } } },
    orderBy: [{ fixtureId: "asc" }, { revision: "desc" }],
  });

  const candidates: CandidateRow[] = [];
  const seenFixtures = new Set<string>();
  for (const snapshot of snapshots) {
    if (seenFixtures.has(snapshot.fixtureId)) continue;
    // Revisions arrive newest first: take the newest one that is itself pre-kickoff and usable,
    // instead of dropping the whole fixture when only its latest revision qualifies badly.
    if (snapshot.cutoff.getTime() >= snapshot.fixture.kickoffUtc.getTime()) continue;
    const goals = expectedGoalsOf(snapshot.receipt);
    if (!goals) continue;
    seenFixtures.add(snapshot.fixtureId);
    candidates.push({ fixtureId: snapshot.fixtureId, lambdaHome: goals.home, lambdaAway: goals.away });
  }
  if (candidates.length === 0) return [];

  const results = await client.resultVersion.findMany({
    where: { fixtureId: { in: candidates.map((candidate) => candidate.fixtureId) }, observedAt: { lte: input.asOf }, effectiveAt: { lte: input.asOf } },
    select: { id: true, fixtureId: true, observedAt: true, effectiveAt: true, supersedesResultVersionId: true, homeGoals: true, awayGoals: true },
  });
  const byFixture = new Map<string, ResultNode[]>();
  for (const row of results) {
    const bucket = byFixture.get(row.fixtureId);
    if (bucket) bucket.push(row);
    else byFixture.set(row.fixtureId, [row]);
  }

  const rows: DixonColesEstimationRow[] = [];
  for (const candidate of candidates) {
    const fixtureResults = byFixture.get(candidate.fixtureId);
    if (!fixtureResults || fixtureResults.length === 0) continue;
    let selectedId: string;
    try {
      selectedId = resolveHistoricalResultGraph(fixtureResults, candidate.fixtureId, input.asOf).id;
    } catch {
      continue;
    }
    const selected = fixtureResults.find((row) => row.id === selectedId);
    if (!selected || selected.homeGoals === null || selected.awayGoals === null) continue;
    rows.push({ lambdaHome: candidate.lambdaHome, lambdaAway: candidate.lambdaAway, homeGoals: selected.homeGoals, awayGoals: selected.awayGoals });
  }
  return rows;
}

function tauMinOf(rows: readonly DixonColesEstimationRow[], rho: number): number {
  if (rows.length === 0) return 1;
  return rows.reduce((worst, row) => Math.min(worst, dixonColesTauMin(row.lambdaHome, row.lambdaAway, rho)), Number.POSITIVE_INFINITY);
}

/**
 * Fits the pinned `rho` for a league at `asOf`, always returning a value.
 *
 * Order is explicit (D-08): league MLE when the league sample reaches
 * `minLeagueMatches`, otherwise a pooled estimate across all leagues when that
 * sample reaches `minPooledMatches`, otherwise an honest `rho = 0`. The method
 * and the actual league sample size travel in the provenance so a fallback can
 * never be mistaken for a league fit.
 */
export async function fitLeagueDixonColesParameters(
  client: PrismaClient,
  input: { leagueId: string; asOf: string },
): Promise<DixonColesParameters> {
  const asOfMs = Date.parse(input.asOf);
  if (!Number.isFinite(asOfMs)) throw coded("INVALID_FORECAST_CUTOFF");
  const asOf = new Date(asOfMs);
  const estimation = DIXON_COLES_CONFIG.dixonColes.estimation;
  const windowFrom = new Date(asOfMs - estimation.windowDays * 86_400_000);

  const leagueRows = await collectRows(client, { asOf, windowFrom, leagueId: input.leagueId });
  if (leagueRows.length >= estimation.minLeagueMatches) {
    const fitted = estimateDixonColesRho(leagueRows, { windowFrom: windowFrom.toISOString(), windowTo: input.asOf, minSamples: estimation.minLeagueMatches });
    if (fitted.method === "mle-low-score-v1") {
      return { rho: fitted.rho, provenance: { ...fitted, sampleSize: leagueRows.length, tauMin: tauMinOf(leagueRows, fitted.rho) } };
    }
    return { rho: 0, provenance: zeroProvenance(windowFrom, input.asOf, leagueRows.length) };
  }

  const pooledRows = await collectRows(client, { asOf, windowFrom });
  if (pooledRows.length >= estimation.minPooledMatches) {
    const fitted = estimateDixonColesRho(pooledRows, { windowFrom: windowFrom.toISOString(), windowTo: input.asOf, minSamples: estimation.minPooledMatches });
    if (fitted.method === "mle-low-score-v1") {
      return {
        rho: fitted.rho,
        provenance: { ...fitted, method: "pooled-fallback-v1", sampleSize: leagueRows.length, tauMin: tauMinOf(pooledRows, fitted.rho) },
      };
    }
  }

  return { rho: 0, provenance: zeroProvenance(windowFrom, input.asOf, leagueRows.length) };
}

function zeroProvenance(windowFrom: Date, windowTo: string, sampleSize: number): DixonColesProvenance {
  return { rho: 0, convention: DIXON_COLES_CONVENTION, method: "insufficient-sample-zero", windowFrom: windowFrom.toISOString(), windowTo, sampleSize, tauMin: 1 };
}

export function createDixonColesParameterProvider(client: PrismaClient): {
  findDixonColesParameters(input: { leagueId: string; asOf: string }): Promise<DixonColesParameters>;
} {
  return { findDixonColesParameters: (input) => fitLeagueDixonColesParameters(client, input) };
}
