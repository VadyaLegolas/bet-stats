import {
  buildScoreMatrix,
  buildScoreMatrixV1,
  coreMarketsFromCells,
  normalizeOddsBook,
  type ScoreMatrixV1,
} from "@bet-stats/domain";
import type { PrismaClient } from "@bet-stats/database";

import type { ExtendedSeed, ExtendedValueRow, SeededOdds } from "./extended-markets-seed.js";

export { buildCoreValueReceipt, buildExtendedValueReceipt, exactScoreSelections } from "./extended-markets-seed.js";
export type { ExtendedSeed, ExtendedValueRow, SeededOdds } from "./extended-markets-seed.js";

/**
 * Seed helpers of the Phase 15 scanner tests. Every helper is an INSERT of new rows (the immutability triggers stay intact):
 * kickoff, fixture status, forecast kind/state/origin/issuedAt, odds submittedAt/source and receipt createdAt/supersession/
 * outcome/reasons are controlled at insert time. The returned seed satisfies the Phase 14 `ExtendedSeed` shape so the Phase 14
 * receipt builders can be reused unchanged.
 */

export interface ScannerSeedOptions {
  /** Unique id prefix: many seeds live in one database. */
  readonly prefix: string;
  readonly kickoff: Date | string;
  readonly status?: string;
  readonly leagueName?: string;
  readonly homeName?: string;
  readonly awayName?: string;
  /** Overrides of the base forecast snapshot of the fixture. */
  readonly forecast?: ForecastOptions;
  /** false builds a legacy forecast without a sealed matrix (REDERIVED receipts). Default true. */
  readonly persistedMatrix?: boolean;
}

export interface ForecastOptions {
  readonly tag?: string;
  readonly kind?: "INITIAL" | "PRE_MATCH" | "LINEUP_CONFIRMED";
  readonly revision?: number;
  /** Required when `revision` is above 1: the id of the previous revision of the same kind. */
  readonly supersedesForecastId?: string;
  readonly state?: "BUILDING" | "ISSUED" | "FAILED";
  readonly origin?: "PRODUCTION" | "BACKTEST";
  readonly issuedAt?: Date | string | null;
}

export interface ScannerSeed extends ExtendedSeed {
  readonly kickoff: string;
  readonly leagueName: string;
  readonly homeName: string;
  readonly awayName: string;
}

export interface ScannerReceiptOptions {
  readonly createdAt?: Date | string;
  readonly supersedesValueReceiptId?: string | null;
  readonly outcome?: string;
  readonly reasons?: readonly string[];
  /** Verbatim column strings; they must stay within 1e-12 of the computed value (the SQL guard) and are mirrored into the receipt JSON. */
  readonly edge?: string;
  readonly expectedValue?: string;
  readonly id?: string;
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

async function exec(db: PrismaClient, sql: string, ...params: unknown[]): Promise<number> {
  return db.$executeRawUnsafe(sql, ...params);
}

function matrixFor(): { cells: ExtendedSeed["cells"]; matrix: ScoreMatrixV1 } {
  const built = buildScoreMatrix({ expectedGoals: { home: 1.6, away: 1.1 } });
  const matrix = buildScoreMatrixV1(built.scoreMatrix, built.retainedMass);
  return { cells: [...matrix.cells], matrix };
}

/** Appends digits below the 1e-13 tolerance of the guard: the value stays valid and the string becomes longer or zero padded. */
export function padDecimal(value: string, suffix = "000000000000000000000007"): string {
  if (/e/i.test(value) || !value.includes(".")) throw new Error(`padDecimal needs a plain decimal string, got ${value}`);
  return `${value}${suffix}`;
}

/** Inserts one forecast snapshot of a seeded fixture with its three core ForecastMarket rows. Returns the snapshot id. */
export async function seedScannerForecast(db: PrismaClient, seed: ScannerSeed, options: ForecastOptions = {}): Promise<string> {
  const tag = options.tag ?? "extra";
  const id = `${seed.prefix}-forecast-${tag}`;
  const state = options.state ?? "ISSUED";
  const issuedAt = options.issuedAt === undefined ? (state === "ISSUED" ? new Date(Date.parse(seed.kickoff) - 2 * 3_600_000).toISOString() : null) : options.issuedAt === null ? null : iso(options.issuedAt);
  const revision = options.revision ?? 1;
  const kind = options.kind ?? "PRE_MATCH";
  const supersedes = options.supersedesForecastId ?? null;
  await exec(
    db,
    `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,origin,revision,"supersedesForecastId",cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$2,$3::"ForecastKind",$4::"ForecastSnapshotState",$5::"ForecastOrigin",$6,$7,$8::timestamptz,'poisson-v1','model-hash','forecast-config-v1','config-hash',$9,$10,'[]','{}','{}','[]',$11::jsonb,$12::timestamptz)`,
    id, seed.fixtureId, kind, state, options.origin ?? "PRODUCTION", revision, supersedes,
    new Date(Date.parse(seed.kickoff) - 3 * 3_600_000).toISOString(), `${id}-input`, `${id}-evidence`, JSON.stringify(seed.persisted ? { scoreMatrix: seed.matrix } : {}), issuedAt,
  );
  const core = coreMarketsFromCells(seed.cells);
  const markets: Array<[string, Array<[string, number]>]> = [
    ["ONE_X_TWO", [["HOME", core.HOME], ["DRAW", core.DRAW], ["AWAY", core.AWAY]]],
    ["OVER_UNDER_2_5", [["OVER_2_5", core.OVER_2_5], ["UNDER_2_5", core.UNDER_2_5]]],
    ["BTTS", [["YES", core.YES], ["NO", core.NO]]],
  ];
  for (const [market, events] of markets) {
    await exec(db, `INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,$3,$4::jsonb)`, `${id}-market-${market}`, id, market, JSON.stringify(events.map(([selection, probability]) => ({ selection, probability }))));
  }
  return id;
}

/** League, season, two teams, one fixture and its base forecast snapshot. */
export async function seedScannerFixture(db: PrismaClient, options: ScannerSeedOptions): Promise<ScannerSeed> {
  const { prefix } = options;
  const kickoff = iso(options.kickoff);
  const leagueName = options.leagueName ?? `League ${prefix}`;
  const homeName = options.homeName ?? `Home ${prefix}`;
  const awayName = options.awayName ?? `Away ${prefix}`;
  const persisted = options.persistedMatrix ?? true;
  const { cells, matrix } = matrixFor();
  const ids = { league: `${prefix}-league`, season: `${prefix}-season`, home: `${prefix}-home`, away: `${prefix}-away`, fixture: `${prefix}-fixture` };
  await exec(db, `INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ($1,$2,'GB',now())`, ids.league, leagueName);
  await exec(db, `INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ($1,$2,'2026','2026-01-01','2030-12-31',now())`, ids.season, ids.league);
  await exec(db, `INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ($1,$2,$3,'GB',now()),($4,$5,$6,'GB',now())`, ids.home, homeName, `${prefix}-home`, ids.away, awayName, `${prefix}-away`);
  // kickoffUtc is a timestamp without time zone: store the UTC wall clock explicitly.
  await exec(db, `INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,($6::timestamptz AT TIME ZONE 'UTC'),$7,now())`, ids.fixture, ids.league, ids.season, ids.home, ids.away, kickoff, options.status ?? "SCHEDULED");
  const partial: ScannerSeed = {
    prefix, fixtureId: ids.fixture, forecastSnapshotId: `${prefix}-forecast-${options.forecast?.tag ?? "base"}`, resultVersionId: "", settlementReceiptId: "",
    persisted, cells, matrix, kickoff, leagueName, homeName, awayName,
  };
  const forecastSnapshotId = await seedScannerForecast(db, partial, { tag: "base", ...options.forecast });
  return { ...partial, forecastSnapshotId };
}

/** One manual odds book (and its selections) with a controllable source label and submission time. */
export async function seedScannerOdds(
  db: PrismaClient,
  seed: ScannerSeed,
  input: { market: string; selections: ReadonlyArray<readonly [string, string]>; tag: string; submittedAt?: Date | string; source?: string; capturedAt?: string },
): Promise<SeededOdds> {
  const oddsSnapshotId = `${seed.prefix}-odds-${input.tag}`;
  const source = input.source ?? "Scanner Test Bookmaker";
  const capturedAt = input.capturedAt ?? new Date(Date.parse(seed.kickoff) - 5 * 3_600_000).toISOString();
  const book = normalizeOddsBook({
    fixtureId: seed.fixtureId, oddsSnapshotId, market: input.market as never, sourceLabel: source, capturedAt,
    selections: input.selections.map(([selection, decimalOdds]) => ({ selection: selection as never, decimalOdds })),
  });
  await exec(db, `INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)`, oddsSnapshotId, seed.fixtureId, input.market, `${oddsSnapshotId}-hash`, source, JSON.stringify(book), iso(input.submittedAt ?? new Date()));
  const selectionIds: Record<string, string> = {};
  for (const [selection, decimalOdds] of input.selections) {
    const id = `${oddsSnapshotId}-${selection}`;
    selectionIds[selection] = id;
    await exec(db, `INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ($1,$2,$3,$4)`, id, oddsSnapshotId, selection, decimalOdds);
  }
  return { oddsSnapshotId, book, selectionIds };
}

/**
 * Inserts a receipt in the production shape: top-level DTO fields (id, edge, outcome, reasons, receipt) with the decision block
 * nested under `receipt` (carrying `valuePolicyVersion`; Phase 14 builders add `extended`). The SQL guard accepts either shape.
 * Returns the receipt id.
 */
export async function insertScannerReceipt(db: PrismaClient, seed: ScannerSeed, row: ExtendedValueRow, options: ScannerReceiptOptions = {}): Promise<string> {
  const id = options.id ?? row.id;
  const outcome = options.outcome ?? row.outcome;
  const reasons = [...(options.reasons ?? [])];
  const edge = options.edge ?? row.edge;
  const expectedValue = options.expectedValue ?? row.expectedValue;
  const createdAt = options.createdAt === undefined ? null : iso(options.createdAt);
  const body = {
    id, fixtureId: seed.fixtureId, forecastSnapshotId: row.forecastSnapshotId, oddsSnapshotId: row.oddsSnapshotId, market: row.market, selection: row.selection,
    outcome, reasons, modelProbability: row.modelProbability, noVigProbability: row.noVigProbability, fairOdds: row.fairOdds, edge, expectedValue,
    receipt: { valuePolicyVersion: "value-policy-v1", ...row.receipt, outcome, reasons },
  };
  await exec(
    db,
    `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue","supersedesValueReceiptId",receipt,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,COALESCE($15::timestamptz, now()))`,
    id, seed.fixtureId, row.market, row.forecastSnapshotId, row.oddsSnapshotId, outcome, row.selection, row.modelProbability, row.noVigProbability, row.fairOdds, edge, expectedValue, options.supersedesValueReceiptId ?? null, JSON.stringify(body), createdAt,
  );
  return id;
}

/**
 * Single-insert bracket for forecast rows the guard cannot accept (state not ISSUED). Only for the disposable test database:
 * the trigger is re-enabled in a finally block.
 */
export async function insertScannerReceiptUnguarded(db: PrismaClient, seed: ScannerSeed, row: ExtendedValueRow, options: ScannerReceiptOptions = {}): Promise<string> {
  await db.$executeRawUnsafe(`ALTER TABLE "ValueReceipt" DISABLE TRIGGER "ValueReceipt_validate_pair"`);
  try {
    return await insertScannerReceipt(db, seed, row, options);
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE "ValueReceipt" ENABLE TRIGGER "ValueReceipt_validate_pair"`);
  }
}
