import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import {
  SCANNER_FRESHNESS_V1, SCANNER_LIMIT, SCANNER_MARKET_ORDER, SCANNER_SELECTION_ORDER, SCANNER_WINDOW_DAYS, classifyOddsFreshness,
  type ScannerItem, type ScannerResponse,
} from "@bet-stats/domain";

/**
 * One raw row of the scanner statement. The summary columns repeat on every row; an empty page yields exactly one row whose
 * `receiptId` is null. Value columns are the stored strings, untouched.
 */
export interface ScannerRow {
  readonly checked: number;
  readonly outcomeCounts: Readonly<Record<string, number>>;
  readonly allPolicyMismatch: boolean;
  readonly ord: number | null;
  readonly receiptId: string | null;
  readonly fixtureId: string | null;
  readonly forecastSnapshotId: string | null;
  readonly oddsSnapshotId: string | null;
  readonly market: string | null;
  readonly selection: string | null;
  readonly edge: string | null;
  readonly expectedValue: string | null;
  readonly modelProbability: string | null;
  readonly noVigProbability: string | null;
  readonly fairOdds: string | null;
  readonly decimalOdds: string | null;
  readonly valuePolicyVersion: string | null;
  readonly edgeDefinition: string | null;
  readonly evPolicyVersion: string | null;
  readonly kickoffAt: Date | null;
  readonly homeTeam: string | null;
  readonly awayTeam: string | null;
  readonly competition: string | null;
  readonly oddsSource: string | null;
  readonly oddsSubmittedAt: Date | null;
  readonly oddsCapturedAt: string | null;
  readonly forecastNewerAvailable: boolean | null;
}

export interface ScannerRepository {
  loadWindow(input: { readonly from: Date; readonly to: Date; readonly limit: number }): Promise<readonly ScannerRow[]>;
}

/**
 * The whole window read is ONE statement. The window bounds are bound Date parameters (the database clock is never used),
 * timestamptz columns are read AT TIME ZONE 'UTC', counts are cast to int. The latest receipt per (fixture, market, selection)
 * is chosen over every outcome FIRST; only the later `candidates` step keeps VALUE_CANDIDATE, so an older candidate can never
 * resurface over a newer NO_VALUE. Display order is kickoff, market family, selection: never edge, EV or probability.
 */
export function createPrismaScannerRepository(client: PrismaClient): ScannerRepository {
  return {
    loadWindow: async ({ from, to, limit }) => {
      const marketOrder = [...SCANNER_MARKET_ORDER] as string[];
      const selectionOrder = [...SCANNER_SELECTION_ORDER] as string[];
      return client.$queryRaw<ScannerRow[]>`
WITH latest AS (
  SELECT DISTINCT ON (vr."fixtureId", vr.market, vr.selection)
         vr.id, vr."fixtureId", vr.market, vr.selection, vr.outcome,
         (COALESCE(vr.receipt -> 'reasons', '[]'::jsonb) @> '["POLICY_CONFIG_MISMATCH"]'::jsonb) AS policy_mismatch
  FROM "ValueReceipt" vr
  JOIN "Fixture" fx ON fx.id = vr."fixtureId"
  JOIN "ForecastSnapshot" fs ON fs.id = vr."forecastSnapshotId"
  WHERE fx.status = 'SCHEDULED'
    AND fx."kickoffUtc" >= ${from} AND fx."kickoffUtc" < ${to}
    AND fs.state = 'ISSUED' AND fs.origin = 'PRODUCTION'
    AND NOT EXISTS (SELECT 1 FROM "ValueReceipt" sup WHERE sup."supersedesValueReceiptId" = vr.id)
  ORDER BY vr."fixtureId", vr.market, vr.selection, vr."createdAt" DESC, vr.id DESC
),
per_outcome AS (
  SELECT outcome, count(*)::int AS n, count(*) FILTER (WHERE policy_mismatch)::int AS mismatched
  FROM latest GROUP BY outcome
),
summary AS (
  SELECT COALESCE(sum(n), 0)::int AS checked,
         COALESCE(jsonb_object_agg(outcome, n), '{}'::jsonb) AS outcome_counts,
         (COALESCE(sum(n), 0) > 0 AND sum(mismatched) = sum(n)) AS all_policy_mismatch
  FROM per_outcome
),
candidates AS (
  SELECT l.id, l."fixtureId", l.market, l.selection, fx."kickoffUtc" AS kickoff
  FROM latest l JOIN "Fixture" fx ON fx.id = l."fixtureId"
  WHERE l.outcome = 'VALUE_CANDIDATE'
),
kept AS (
  SELECT "fixtureId" FROM (
    SELECT "fixtureId", count(*) AS n, sum(count(*)) OVER (ORDER BY min(kickoff), "fixtureId") AS running
    FROM candidates GROUP BY "fixtureId"
  ) g
  WHERE running <= ${limit} OR running = n
),
page AS (
  SELECT c.id,
         row_number() OVER (
           ORDER BY c.kickoff, c."fixtureId",
                    array_position(${marketOrder}::text[], split_part(c.market, ':', 1)),
                    c.market,
                    array_position(${selectionOrder}::text[], c.selection),
                    c.selection, c.id
         ) AS ord
  FROM candidates c JOIN kept k ON k."fixtureId" = c."fixtureId"
)
SELECT s.checked, s.outcome_counts AS "outcomeCounts", s.all_policy_mismatch AS "allPolicyMismatch", p.ord::int AS ord,
       vr.id AS "receiptId", vr."fixtureId", vr."forecastSnapshotId", vr."oddsSnapshotId", vr.market, vr.selection,
       vr.edge, vr."expectedValue", vr."modelProbability", vr."noVigProbability", vr."fairOdds",
       sel."decimalOdds",
       vr.receipt #>> '{receipt,valuePolicyVersion}' AS "valuePolicyVersion",
       vr.receipt #>> '{receipt,extended,edgeDefinition}' AS "edgeDefinition",
       vr.receipt #>> '{receipt,extended,evPolicyVersion}' AS "evPolicyVersion",
       fx."kickoffUtc" AS "kickoffAt", hteam.name AS "homeTeam", ateam.name AS "awayTeam", lg.name AS competition,
       o.source AS "oddsSource", (o."submittedAt" AT TIME ZONE 'UTC') AS "oddsSubmittedAt",
       o.receipt ->> 'capturedAt' AS "oddsCapturedAt",
       EXISTS (SELECT 1 FROM "ForecastSnapshot" newer
               WHERE newer."fixtureId" = vr."fixtureId" AND newer.state = 'ISSUED' AND newer.origin = 'PRODUCTION'
                 AND newer."issuedAt" > fs."issuedAt") AS "forecastNewerAvailable"
FROM summary s
LEFT JOIN page p ON true
LEFT JOIN "ValueReceipt" vr ON vr.id = p.id
LEFT JOIN "ForecastSnapshot" fs ON fs.id = vr."forecastSnapshotId"
LEFT JOIN "Fixture" fx ON fx.id = vr."fixtureId"
LEFT JOIN "Team" hteam ON hteam.id = fx."homeTeamId"
LEFT JOIN "Team" ateam ON ateam.id = fx."awayTeamId"
LEFT JOIN "League" lg ON lg.id = fx."leagueId"
LEFT JOIN "ManualOddsSnapshot" o ON o.id = vr."oddsSnapshotId"
LEFT JOIN "ManualOddsSelection" sel ON sel."oddsSnapshotId" = vr."oddsSnapshotId" AND sel.selection = vr.selection
ORDER BY p.ord`;
    },
  };
}

function toItem(row: ScannerRow, now: Date): ScannerItem {
  const submitted = row.oddsSubmittedAt;
  const kickoff = row.kickoffAt;
  if (row.receiptId === null || row.fixtureId === null || row.forecastSnapshotId === null || row.oddsSnapshotId === null || row.market === null || row.selection === null
    || kickoff === null || submitted === null || row.homeTeam === null || row.awayTeam === null || row.competition === null) {
    throw new Error("SCANNER_ROW_INCOMPLETE");
  }
  const oddsAgeSeconds = Math.max(0, Math.floor((now.getTime() - submitted.getTime()) / 1000));
  return {
    receiptId: row.receiptId, fixtureId: row.fixtureId, forecastSnapshotId: row.forecastSnapshotId, oddsSnapshotId: row.oddsSnapshotId,
    market: row.market, selection: row.selection, kickoffAt: kickoff.toISOString(),
    homeTeam: row.homeTeam, awayTeam: row.awayTeam, competition: row.competition,
    oddsSource: row.oddsSource, oddsSubmittedAt: submitted.toISOString(), oddsCapturedAt: row.oddsCapturedAt,
    oddsAgeSeconds, freshness: classifyOddsFreshness(oddsAgeSeconds), forecastNewerAvailable: row.forecastNewerAvailable === true,
    edge: row.edge, expectedValue: row.expectedValue, modelProbability: row.modelProbability, noVigProbability: row.noVigProbability,
    fairOdds: row.fairOdds, decimalOdds: row.decimalOdds,
    valuePolicyVersion: row.valuePolicyVersion, edgeDefinition: row.edgeDefinition, evPolicyVersion: row.evPolicyVersion,
  };
}

export async function loadScanner(deps: { readonly now: Date }, repository: ScannerRepository): Promise<ScannerResponse> {
  const from = deps.now;
  const to = new Date(from.getTime() + SCANNER_WINDOW_DAYS * 86_400_000);
  const rows = await repository.loadWindow({ from, to, limit: SCANNER_LIMIT });
  // The summary row exists by construction; an empty result means the read itself failed.
  const summary = rows[0];
  if (!summary) throw new Error("SCANNER_SUMMARY_MISSING");
  const items = rows.filter((row) => row.receiptId !== null).map((row) => toItem(row, deps.now));
  const outcomeCounts = { ...summary.outcomeCounts };
  const totalCandidates = outcomeCounts.VALUE_CANDIDATE ?? 0;
  return {
    state: items.length > 0 ? "AVAILABLE" : "EMPTY",
    generatedAt: deps.now.toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
    limit: SCANNER_LIMIT,
    truncated: totalCandidates > items.length,
    freshnessPolicy: SCANNER_FRESHNESS_V1,
    checkedCount: summary.checked,
    outcomeCounts,
    totalCandidates,
    allPolicyConfigMismatch: summary.allPolicyMismatch,
    items,
  };
}

/** Clients only ever see typed codes; the internal reason goes to the operator log. */
export async function getScanner(repository: ScannerRepository | null, now: Date): Promise<ScannerResponse> {
  if (!repository) throw Object.assign(new ServiceUnavailableException({ code: "DATABASE_UNAVAILABLE" }), { code: "DATABASE_UNAVAILABLE" });
  try {
    return await loadScanner({ now }, repository);
  } catch (error) {
    new Logger("ScannerService").warn(JSON.stringify({ code: "SCANNER_READ_FAILED", reason: error instanceof Error ? error.message : String(error) }));
    throw Object.assign(new ServiceUnavailableException({ code: "SCANNER_READ_FAILED" }), { code: "SCANNER_READ_FAILED" });
  }
}

@Injectable()
export class ScannerService implements OnModuleDestroy {
  private readonly client: PrismaClient | null = process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
  private readonly repository: ScannerRepository | null = this.client ? createPrismaScannerRepository(this.client) : null;
  get(): Promise<ScannerResponse> { return getScanner(this.repository, new Date()); }
  async onModuleDestroy(): Promise<void> { await this.client?.$disconnect(); }
}
