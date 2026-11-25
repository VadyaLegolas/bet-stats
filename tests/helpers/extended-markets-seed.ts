import {
  buildScoreMatrix,
  buildScoreMatrixV1,
  coreMarketsFromCells,
  decideExtendedValue,
  type ForecastResponseDto,
  normalizeOddsBook,
  type NormalizedOddsBook,
  type ScoreMatrixCell,
  type ScoreMatrixV1,
} from "@bet-stats/domain";
import type { PrismaClient } from "@bet-stats/database";

/**
 * Shared seed of the Phase 14 database tests (plans 14-05 and 14-07): one finished fixture with an issued forecast
 * (persisted score matrix or a legacy envelope without one), the three stored core markets, a settlement receipt, and
 * builders that assemble CONSISTENT value receipts through `decideExtendedValue` so a test deviates on one field only.
 */

export const EXTENDED_SEED_KICKOFF = "2026-09-10T18:00:00Z";
export const EXTENDED_SEED_ODDS_SUBMITTED_AT = "2026-09-10T16:00:00Z";
const CAPTURED_AT = "2026-09-10T16:00:00.000Z";

export interface ExtendedSeedOptions {
  /** Unique id prefix: several seeds can live in one database. */
  readonly prefix: string;
  readonly homeGoals?: number;
  readonly awayGoals?: number;
  /** false builds a legacy forecast (no `scoreMatrix` key in the envelope); the cells are then used for REDERIVED receipts. */
  readonly persistedMatrix?: boolean;
  /** A custom grid (home outer, away inner, 64 entries); default is a Poisson grid with expected goals 1.6 : 1.1. */
  readonly cells?: readonly ScoreMatrixCell[];
  /** false leaves the settlement to the pipeline under test (`settlementReceiptId` is then the empty string). Default true. */
  readonly settlementReceipt?: boolean;
}

export interface ExtendedSeed {
  readonly prefix: string;
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly resultVersionId: string;
  readonly settlementReceiptId: string;
  readonly persisted: boolean;
  readonly cells: readonly ScoreMatrixCell[];
  /** The sealed persisted form (always built, so tests can read its hash); stored only when `persisted` is true. */
  readonly matrix: ScoreMatrixV1;
}

export interface SeededOdds {
  readonly oddsSnapshotId: string;
  readonly book: NormalizedOddsBook;
  /** ManualOddsSelection id per selection. */
  readonly selectionIds: Readonly<Record<string, string>>;
}

export interface ExtendedValueRow {
  readonly id: string;
  readonly market: string;
  readonly selection: string;
  readonly oddsSnapshotId: string;
  readonly forecastSnapshotId: string;
  readonly outcome: string;
  readonly modelProbability: string;
  readonly noVigProbability: string;
  readonly fairOdds: string | null;
  readonly edge: string;
  readonly expectedValue: string;
  readonly receipt: Record<string, unknown>;
}

async function exec(db: PrismaClient, sql: string, ...params: unknown[]): Promise<number> {
  return db.$executeRawUnsafe(sql, ...params);
}

function defaultCells(): { cells: ScoreMatrixCell[]; matrix: ScoreMatrixV1 } {
  const built = buildScoreMatrix({ expectedGoals: { home: 1.6, away: 1.1 } });
  const matrix = buildScoreMatrixV1(built.scoreMatrix, built.retainedMass);
  return { cells: [...matrix.cells], matrix };
}

export async function seedExtendedMarketsFixture(db: PrismaClient, options: ExtendedSeedOptions): Promise<ExtendedSeed> {
  const { prefix } = options;
  const homeGoals = options.homeGoals ?? 1;
  const awayGoals = options.awayGoals ?? 0;
  const persisted = options.persistedMatrix ?? true;
  const base = defaultCells();
  const matrix = options.cells
    ? buildScoreMatrixV1(options.cells.map(([home, away, probability]) => ({ homeGoals: home, awayGoals: away, probability })), 1)
    : base.matrix;
  const cells = options.cells ?? base.cells;
  const ids = {
    league: `${prefix}-league`, season: `${prefix}-season`, home: `${prefix}-home`, away: `${prefix}-away`,
    fixture: `${prefix}-fixture`, observation: `${prefix}-result-obs`, result: `${prefix}-result`,
    forecast: `${prefix}-forecast`, settlement: `${prefix}-settlement`,
  };
  await exec(db, `INSERT INTO "League" (id,name,"countryCode","updatedAt") VALUES ($1,'League','GB',now())`, ids.league);
  await exec(db, `INSERT INTO "Season" (id,"leagueId",label,"startsOn","endsOn","updatedAt") VALUES ($1,$2,'2026','2026-01-01','2026-12-31',now())`, ids.season, ids.league);
  await exec(db, `INSERT INTO "Team" (id,name,"normalizedName","countryCode","updatedAt") VALUES ($1,'Home','home','GB',now()),($2,'Away','away','GB',now())`, ids.home, ids.away);
  await exec(db, `INSERT INTO "Fixture" (id,"leagueId","seasonId","homeTeamId","awayTeamId","kickoffUtc",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6::timestamptz,'FINISHED',now())`, ids.fixture, ids.league, ids.season, ids.home, ids.away, EXTENDED_SEED_KICKOFF);
  await exec(db, `INSERT INTO "SourceObservation" (id,provider,"endpointFamily","externalIdentity","observedAt","payloadHash","rawPayload","payloadBytes") VALUES ($1,'test','RESULTS',$2,'2026-09-10T20:00:00Z',$3,'{}',2)`, ids.observation, ids.fixture, `${prefix}-result-hash`);
  await exec(db, `INSERT INTO "ResultVersion" (id,"fixtureId","observationId","effectiveAt","observedAt","homeGoals","awayGoals",status,revision) VALUES ($1,$2,$3,'2026-09-10T18:00:00Z','2026-09-10T20:00:00Z',$4,$5,'FINISHED',1)`, ids.result, ids.fixture, ids.observation, homeGoals, awayGoals);
  await exec(
    db,
    `INSERT INTO "ForecastSnapshot" (id,"fixtureId",kind,state,revision,cutoff,"modelVersion","modelHash","configVersion","configHash","inputHash","evidenceFingerprint","sourceRefs",probabilities,confidence,assumptions,receipt,"issuedAt") VALUES ($1,$2,'PRE_MATCH','ISSUED',1,'2026-09-10T17:00:00Z','poisson-v1','model-hash','forecast-config-v1','config-hash',$3,$4,'[]','{}','{}','[]',$5::jsonb,'2026-09-10T17:00:01Z')`,
    ids.forecast, ids.fixture, `${prefix}-input`, `${prefix}-evidence`, JSON.stringify(persisted ? { scoreMatrix: matrix } : {}),
  );
  const core = coreMarketsFromCells(cells);
  const markets: Array<[string, Array<[string, number]>]> = [
    ["ONE_X_TWO", [["HOME", core.HOME], ["DRAW", core.DRAW], ["AWAY", core.AWAY]]],
    ["OVER_UNDER_2_5", [["OVER_2_5", core.OVER_2_5], ["UNDER_2_5", core.UNDER_2_5]]],
    ["BTTS", [["YES", core.YES], ["NO", core.NO]]],
  ];
  for (const [market, events] of markets) {
    await exec(db, `INSERT INTO "ForecastMarket" (id,"forecastSnapshotId",market,probabilities) VALUES ($1,$2,$3,$4::jsonb)`, `${prefix}-market-${market}`, ids.forecast, market, JSON.stringify(events.map(([selection, probability]) => ({ selection, probability }))));
  }
  if (options.settlementReceipt === false) {
    return { prefix, fixtureId: ids.fixture, forecastSnapshotId: ids.forecast, resultVersionId: ids.result, settlementReceiptId: "", persisted, cells, matrix };
  }
  const receipt = { fixtureId: ids.fixture, resultVersionId: ids.result, forecastSnapshotId: ids.forecast, policyVersion: "settlement-policy-v1", policyHash: "value-policy", lifecycle: "FINISHED", scoreability: "SCOREABLE", financialEligibility: "ELIGIBLE", classOutcome: "SCORED", reason: "RESULT_FINISHED" };
  await db.$queryRawUnsafe(
    `SELECT * FROM persist_settlement_receipt($1,$2,$3,$4,'settlement-policy-v1','value-policy','FINISHED','SCOREABLE','ELIGIBLE','SCORED','RESULT_FINISHED',$5::jsonb,'2026-09-10T20:05:00Z',NULL,NULL)`,
    ids.settlement, ids.fixture, ids.result, ids.forecast, JSON.stringify(receipt),
  );
  return { prefix, fixtureId: ids.fixture, forecastSnapshotId: ids.forecast, resultVersionId: ids.result, settlementReceiptId: ids.settlement, persisted, cells, matrix };
}

/** A complete 17-selection exact-score book at one price, with optional per-selection overrides. */
export function exactScoreSelections(defaultOdds = "18", overrides: Readonly<Record<string, string>> = {}): Array<[string, string]> {
  const scores = [0, 1, 2, 3].flatMap((home) => [0, 1, 2, 3].map((away) => `${home}-${away}`));
  return [...scores, "OTHER"].map((selection) => [selection, overrides[selection] ?? defaultOdds]);
}

/** Stores a manual odds snapshot (and one ManualOddsSelection per selection) of any market; `tag` keeps several books of one market apart. */
export async function seedOddsBook(db: PrismaClient, seed: ExtendedSeed, input: { market: string; selections: ReadonlyArray<readonly [string, string]>; tag: string; submittedAt?: string }): Promise<SeededOdds> {
  const oddsSnapshotId = `${seed.prefix}-odds-${input.tag}`;
  const book = normalizeOddsBook({
    fixtureId: seed.fixtureId, oddsSnapshotId, market: input.market as never, sourceLabel: "BOOKMAKER_BACK", capturedAt: CAPTURED_AT,
    selections: input.selections.map(([selection, decimalOdds]) => ({ selection: selection as never, decimalOdds })),
  });
  await exec(db, `INSERT INTO "ManualOddsSnapshot" (id,"fixtureId",market,"inputHash",source,receipt,"submittedAt") VALUES ($1,$2,$3,$4,'BOOKMAKER_BACK',$5::jsonb,$6::timestamptz)`, oddsSnapshotId, seed.fixtureId, input.market, `${oddsSnapshotId}-hash`, JSON.stringify(book), input.submittedAt ?? EXTENDED_SEED_ODDS_SUBMITTED_AT);
  const selectionIds: Record<string, string> = {};
  for (const [selection, decimalOdds] of input.selections) {
    const id = `${oddsSnapshotId}-${selection}`;
    selectionIds[selection] = id;
    await exec(db, `INSERT INTO "ManualOddsSelection" (id,"oddsSnapshotId",selection,"decimalOdds") VALUES ($1,$2,$3,$4)`, id, oddsSnapshotId, selection, decimalOdds);
  }
  return { oddsSnapshotId, book, selectionIds };
}

/** The forecast the value decision reads: the extended branch uses only identity, policy versions and confidence. */
function forecastFor(seed: ExtendedSeed): Parameters<typeof decideExtendedValue>[0]["forecast"] {
  return {
    fixtureId: seed.fixtureId, forecastSnapshotId: seed.forecastSnapshotId, cutoff: "2026-09-10T17:00:00.000Z", modelVersion: "poisson-v1",
    configVersion: "forecast-config-v1", configHash: "config-hash", inputHash: `${seed.prefix}-input`, evidenceBuildIds: [],
    markets: {} as never, confidence: { version: "confidence-v1", score: 1, components: {} } as never, limitations: [], sources: [], assumptions: [],
  } as never;
}

/**
 * A value receipt of an Asian handicap or exact-score selection, assembled by `decideExtendedValue` exactly like the API
 * will. `outcome` can be forced (the guard does not check the outcome; the settlement needs VALUE_CANDIDATE).
 */
export function buildExtendedValueReceipt(seed: ExtendedSeed, odds: SeededOdds, market: string, selection: string, options: { outcome?: string; id?: string } = {}): ExtendedValueRow {
  const decision = decideExtendedValue({
    market: market as never, selection, forecast: forecastFor(seed), odds: odds.book,
    matrix: { cells: seed.cells, source: seed.persisted ? "PERSISTED" : "REDERIVED", cellsHash: seed.persisted ? seed.matrix.cellsHash : null },
  });
  const odd = odds.book.selections.find((entry) => entry.selection === selection)!;
  const outcome = options.outcome ?? decision.outcome;
  return {
    id: options.id ?? `${odds.oddsSnapshotId}-value-${selection}`, market, selection, oddsSnapshotId: odds.oddsSnapshotId, forecastSnapshotId: seed.forecastSnapshotId,
    outcome, modelProbability: decision.modelProbability, noVigProbability: odd.noVigProbability, fairOdds: decision.fairOdds, edge: decision.edge, expectedValue: decision.expectedValue,
    receipt: { ...decision.receipt, market, selection, modelProbability: decision.modelProbability, noVigProbability: odd.noVigProbability, decimalOdds: odd.decimalOdds, outcome, reasons: decision.reasons },
  };
}

/** A value receipt of a core market computed from the stored ForecastMarket probability (the unchanged v1 branch). */
export function buildCoreValueReceipt(seed: ExtendedSeed, odds: SeededOdds, market: string, selection: string, options: { outcome?: string; id?: string } = {}): ExtendedValueRow {
  const probability = (coreMarketsFromCells(seed.cells) as Record<string, number>)[selection]!;
  const odd = odds.book.selections.find((entry) => entry.selection === selection)!;
  const noVig = Number(odd.noVigProbability);
  const outcome = options.outcome ?? "VALUE_CANDIDATE";
  return {
    id: options.id ?? `${odds.oddsSnapshotId}-value-${selection}`, market, selection, oddsSnapshotId: odds.oddsSnapshotId, forecastSnapshotId: seed.forecastSnapshotId, outcome,
    modelProbability: String(probability), noVigProbability: odd.noVigProbability, fairOdds: String(1 / probability), edge: String(probability - noVig), expectedValue: String(probability * Number(odd.decimalOdds) - 1),
    receipt: { market, selection, modelProbability: String(probability), noVigProbability: odd.noVigProbability, decimalOdds: odd.decimalOdds },
  };
}

/** Inserts a row; `overrides` replace row columns, `receiptPatch` shallow-merges into the receipt JSON. */
export async function insertValueReceipt(db: PrismaClient, seed: ExtendedSeed, row: ExtendedValueRow, overrides: Partial<Omit<ExtendedValueRow, "receipt">> = {}, receiptPatch: Record<string, unknown> | null = null): Promise<number> {
  const merged = { ...row, ...overrides };
  const receipt = receiptPatch === null ? merged.receipt : { ...merged.receipt, ...receiptPatch };
  return exec(
    db,
    `INSERT INTO "ValueReceipt" (id,"fixtureId",market,"forecastSnapshotId","oddsSnapshotId",outcome,selection,"modelProbability","noVigProbability","fairOdds",edge,"expectedValue",receipt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    merged.id, seed.fixtureId, merged.market, merged.forecastSnapshotId, merged.oddsSnapshotId, merged.outcome, merged.selection, merged.modelProbability, merged.noVigProbability, merged.fairOdds, merged.edge, merged.expectedValue, JSON.stringify(receipt),
  );
}

export interface LegacyForecastVariants {
  /** A legacy snapshot (no `scoreMatrix` key) whose receipt reproduces the stored markets: the view is AVAILABLE with source REDERIVED. */
  readonly rederivedId: string;
  /** A legacy snapshot whose receipt expected goals no longer reproduce the stored markets: the view is UNAVAILABLE. */
  readonly unavailableId: string;
}

/**
 * E2E variants beside a forecast issued through the API (state AVAILABLE, source PERSISTED). Both rows are INSERTs of new
 * snapshots (INITIAL revision 1 and its linked revision 2): nothing existing is updated, the immutability triggers stay intact.
 * The envelope carries the DTO only, exactly like a snapshot issued before the score matrix was persisted.
 */
export async function seedLegacyForecastVariants(
  db: PrismaClient,
  issued: ForecastResponseDto,
  input: { readonly prefix: string; readonly rederivedCutoff: string; readonly unavailableCutoff: string },
): Promise<LegacyForecastVariants> {
  const { marketCalibration: _calibration, ...base } = issued as ForecastResponseDto & { marketCalibration?: unknown };
  const rederivedId = `${input.prefix}-legacy-rederived`;
  const unavailableId = `${input.prefix}-legacy-unavailable`;
  const insert = async (id: string, revision: number, supersedesForecastId: string | null, cutoff: string, home: number): Promise<void> => {
    const dto: ForecastResponseDto = {
      ...base, id, kind: "INITIAL", revision, cutoff, inputHash: `${id}-input`, evidenceFingerprint: `${id}-evidence`,
      receipt: { ...base.receipt, forecastSnapshotId: id, expectedGoals: { ...base.receipt.expectedGoals, home } },
    };
    await db.forecastSnapshot.create({ data: {
      id, fixtureId: dto.fixtureId, kind: dto.kind, state: "ISSUED", revision, supersedesForecastId, cutoff: new Date(cutoff),
      modelVersion: dto.modelVersion, modelHash: dto.modelHash, configVersion: dto.configVersion, configHash: dto.configHash,
      inputHash: dto.inputHash, evidenceFingerprint: dto.evidenceFingerprint, sourceRefs: dto.receipt.sourceRefs as never,
      probabilities: dto.probabilities as never, confidence: dto.confidence as never, assumptions: dto.assumptions as never,
      receipt: dto as never, issuedAt: new Date(dto.issuedAt),
      markets: { create: Object.entries(dto.probabilities).map(([market, probabilities]) => ({ market, probabilities: probabilities as never })) },
    } });
  };
  const goals = base.receipt.expectedGoals;
  await insert(rederivedId, 1, null, input.rederivedCutoff, goals.home);
  // A distorted home rate: the re-derived markets no longer match the stored ones, so the view fails closed.
  await insert(unavailableId, 2, rederivedId, input.unavailableCutoff, goals.home * 1.35);
  return { rederivedId, unavailableId };
}

/**
 * A NEW INSERT of an INITIAL revision whose envelope carries a persisted matrix built from the given expected goals, so the
 * page shows an extreme main line (a lopsided grid puts it at -2.5 or +2.5). `zeroCell` forces one exact-score cell to
 * probability zero (the grid is renormalised) to cover the unavailable-fair-odds cell. The DTO markets are derived from the
 * same cells, so the issuance self-check (`reproducesStored`) holds.
 */
export async function seedCustomMatrixForecast(
  db: PrismaClient,
  issued: ForecastResponseDto,
  input: { readonly id: string; readonly revision: number; readonly supersedesForecastId: string; readonly cutoff: string; readonly expectedGoals: { readonly home: number; readonly away: number }; readonly zeroCell?: readonly [number, number] },
): Promise<string> {
  const { marketCalibration: _calibration, ...base } = issued as ForecastResponseDto & { marketCalibration?: unknown };
  const built = buildScoreMatrix({ expectedGoals: input.expectedGoals });
  let grid = built.scoreMatrix.map((cell) => ({ ...cell }));
  if (input.zeroCell) {
    const [zeroHome, zeroAway] = input.zeroCell;
    const removed = grid.find((cell) => cell.homeGoals === zeroHome && cell.awayGoals === zeroAway)!.probability;
    grid = grid.map((cell) => (cell.homeGoals === zeroHome && cell.awayGoals === zeroAway ? { ...cell, probability: 0 } : { ...cell, probability: cell.probability / (1 - removed) }));
  }
  const matrix = buildScoreMatrixV1(grid, built.retainedMass);
  const core = coreMarketsFromCells(matrix.cells);
  const event = (selection: keyof typeof core) => ({ selection, probability: core[selection], fairOdds: core[selection] > 0 ? String(1 / core[selection]) : null });
  const probabilities = {
    ONE_X_TWO: [event("HOME"), event("DRAW"), event("AWAY")],
    OVER_UNDER_2_5: [event("OVER_2_5"), event("UNDER_2_5")],
    BTTS: [event("YES"), event("NO")],
  };
  const dto = {
    ...base, id: input.id, kind: "INITIAL" as const, revision: input.revision, cutoff: input.cutoff, inputHash: `${input.id}-input`, evidenceFingerprint: `${input.id}-evidence`,
    probabilities: probabilities as unknown as ForecastResponseDto["probabilities"],
    tail: { ...base.tail, retainedMass: built.retainedMass, tailMass: 1 - built.retainedMass, warning: false },
    receipt: { ...base.receipt, forecastSnapshotId: input.id, expectedGoals: input.expectedGoals },
  };
  await db.forecastSnapshot.create({ data: {
    id: input.id, fixtureId: dto.fixtureId, kind: dto.kind, state: "ISSUED", revision: input.revision, supersedesForecastId: input.supersedesForecastId, cutoff: new Date(input.cutoff),
    modelVersion: dto.modelVersion, modelHash: dto.modelHash, configVersion: dto.configVersion, configHash: dto.configHash,
    inputHash: dto.inputHash, evidenceFingerprint: dto.evidenceFingerprint, sourceRefs: dto.receipt.sourceRefs as never,
    probabilities: dto.probabilities as never, confidence: dto.confidence as never, assumptions: dto.assumptions as never,
    receipt: { ...dto, scoreMatrix: matrix } as never, issuedAt: new Date(dto.issuedAt),
    markets: { create: Object.entries(dto.probabilities).map(([market, events]) => ({ market, probabilities: (events as Array<{ selection: string; probability: number }>).map(({ selection, probability }) => ({ selection, probability })) as never })) },
  } });
  return input.id;
}

