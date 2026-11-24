import { calculateNoVigClv, NO_VIG_CLV_POLICY_VERSION, type NoVigClvPriceSet, type NoVigClvUnavailableReason, type OddsMarket, type OddsSelection } from "@bet-stats/domain";

import type { PrismaClient } from "../client.js";

/**
 * Read-time `no-vig-clv-v1` for value candidates (Phase 13, CLV-02, D-04).
 *
 * EVALUATION ONLY (D-05): this module, the pure `no-vig-clv` calculator and the closing-observation repository must never be
 * reachable from value ranking, candidate generation, the future scanner or the journal; `tests/unit/clv-evaluation-only.test.ts`
 * enforces that on the import graph. It only reads (two `findMany` per call) and persists nothing: the result is derived on every
 * read from the candidate's immutable manual-odds snapshot and the append-only closing observations.
 */

export type NoVigClvReading =
  | Readonly<{ status: "UNAVAILABLE"; policyVersion: typeof NO_VIG_CLV_POLICY_VERSION; reason: NoVigClvUnavailableReason; source?: string }>
  | Readonly<{
      status: "AVAILABLE";
      policyVersion: typeof NO_VIG_CLV_POLICY_VERSION;
      value: string;
      pCandidateFair: string;
      pCloseFair: string;
      closingObservedAt: string;
      source: string;
    }>;

export interface NoVigClvCandidate {
  /** Opaque caller key; the result map is keyed by it. */
  readonly key: string;
  readonly fixtureId: string;
  readonly market: string;
  readonly selection: string;
  /** The candidate's ManualOddsSnapshot (the odds the value receipt was computed from). */
  readonly oddsSnapshotId: string;
  readonly kickoffUtc: Date;
}

export type NoVigClvReaderClient = Pick<PrismaClient, "manualOddsSnapshot" | "closingOddsObservation">;

type ClosingRow = { readonly selection: string; readonly decimalOdds: string; readonly sourceConvention: string; readonly observedAt: Date };

function unavailable(reason: NoVigClvUnavailableReason, source?: string): NoVigClvReading {
  return source === undefined
    ? { status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason }
    : { status: "UNAVAILABLE", policyVersion: NO_VIG_CLV_POLICY_VERSION, reason, source };
}

function marketKey(fixtureId: string, market: string): string {
  return JSON.stringify([fixtureId, market]);
}

/** The rows sharing the latest `observedAt` (one closing set); ties between sources resolve to the smallest source name. */
function latestSet(rows: readonly ClosingRow[]): NoVigClvPriceSet | null {
  let latest: ClosingRow | undefined;
  for (const row of rows) {
    if (!latest || row.observedAt.getTime() > latest.observedAt.getTime() || (row.observedAt.getTime() === latest.observedAt.getTime() && row.sourceConvention < latest.sourceConvention)) latest = row;
  }
  if (!latest) return null;
  const set = rows.filter((row) => row.observedAt.getTime() === latest.observedAt.getTime() && row.sourceConvention === latest.sourceConvention);
  return {
    sourceConvention: latest.sourceConvention,
    observedAt: latest.observedAt.toISOString(),
    selections: set.map((row) => ({ selection: row.selection as OddsSelection, decimalOdds: row.decimalOdds })),
  };
}

/**
 * For a page of candidates: ONE query for the candidates' manual-odds snapshots and ONE for the closing observations of their
 * fixtures and markets, regardless of how many candidates there are. Per candidate the closing set is the observations of the
 * SAME source at the latest `observedAt` before kickoff; whether it is usable (complete, not older than the candidate's own
 * submission, same source, valid odds) is decided by the pure `calculateNoVigClv`, which reports a typed reason otherwise.
 * Prices are never completed from another market or another batch. When only other sources closed the market, the latest
 * foreign set is handed to the calculator solely so that it reports SOURCE_CONVENTION_MISMATCH; no value is ever derived from it.
 */
export async function readNoVigClvForCandidates(client: NoVigClvReaderClient, candidates: readonly NoVigClvCandidate[]): Promise<ReadonlyMap<string, NoVigClvReading>> {
  const readings = new Map<string, NoVigClvReading>();
  if (candidates.length === 0) return readings;

  const snapshotIds = [...new Set(candidates.map((candidate) => candidate.oddsSnapshotId))];
  const snapshots = new Map((await client.manualOddsSnapshot.findMany({
    where: { id: { in: snapshotIds } },
    select: { id: true, fixtureId: true, market: true, source: true, submittedAt: true, selections: { select: { selection: true, decimalOdds: true } } },
  })).map((snapshot) => [snapshot.id, snapshot]));

  const kickoffByMarket = new Map<string, { fixtureId: string; market: string; kickoff: Date }>();
  for (const candidate of candidates) {
    const snapshot = snapshots.get(candidate.oddsSnapshotId);
    if (!snapshot || snapshot.fixtureId !== candidate.fixtureId || snapshot.market !== candidate.market) continue;
    const key = marketKey(candidate.fixtureId, candidate.market);
    const known = kickoffByMarket.get(key);
    if (!known || candidate.kickoffUtc.getTime() > known.kickoff.getTime()) kickoffByMarket.set(key, { fixtureId: candidate.fixtureId, market: candidate.market, kickoff: candidate.kickoffUtc });
  }

  const closingByMarket = new Map<string, ClosingRow[]>();
  if (kickoffByMarket.size > 0) {
    const rows = await client.closingOddsObservation.findMany({
      where: {
        oddsFormat: "DECIMAL",
        observationKind: "MARKET_CLOSE",
        OR: [...kickoffByMarket.values()].map(({ fixtureId, market, kickoff }) => ({ fixtureId, market, observedAt: { lt: kickoff } })),
      },
      select: { fixtureId: true, market: true, selection: true, decimalOdds: true, sourceConvention: true, observedAt: true },
    });
    for (const row of rows) {
      const key = marketKey(row.fixtureId, row.market);
      const bucket = closingByMarket.get(key);
      if (bucket) bucket.push(row); else closingByMarket.set(key, [row]);
    }
  }

  for (const candidate of candidates) {
    const snapshot = snapshots.get(candidate.oddsSnapshotId);
    if (!snapshot || snapshot.fixtureId !== candidate.fixtureId || snapshot.market !== candidate.market) {
      readings.set(candidate.key, unavailable("CANDIDATE_SET_INCOMPLETE"));
      continue;
    }
    // Rows are bounded by this candidate's own kickoff even when several candidates of one market carry different kickoffs.
    const rows = (closingByMarket.get(marketKey(candidate.fixtureId, candidate.market)) ?? []).filter((row) => row.observedAt.getTime() < candidate.kickoffUtc.getTime());
    const sameSource = rows.filter((row) => row.sourceConvention === snapshot.source);
    const closing = latestSet(sameSource.length > 0 ? sameSource : rows);
    const result = calculateNoVigClv({
      market: candidate.market as OddsMarket,
      selection: candidate.selection as OddsSelection,
      candidate: { sourceConvention: snapshot.source, observedAt: snapshot.submittedAt.toISOString(), selections: snapshot.selections.map((row) => ({ selection: row.selection as OddsSelection, decimalOdds: row.decimalOdds })) },
      closing,
      kickoffUtc: candidate.kickoffUtc.toISOString(),
    });
    readings.set(candidate.key, result.status === "AVAILABLE"
      ? { status: "AVAILABLE", policyVersion: result.policyVersion, value: result.clv, pCandidateFair: result.pCandidateFair, pCloseFair: result.pCloseFair, closingObservedAt: result.closingObservedAt, source: result.sourceConvention }
      : unavailable(result.reason, snapshot.source));
  }
  return readings;
}
