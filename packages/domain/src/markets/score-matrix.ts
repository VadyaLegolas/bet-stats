import { canonicalSha256 } from "../forecast/canonical-json.js";
import { applyDixonColesCorrection, type DixonColesCell } from "../forecast/dixon-coles.js";
import { isForecastModelVersion } from "../forecast/model-version.js";
import type { ForecastMarket, ForecastSelection } from "../forecast/model.js";

/**
 * The retained score grid as the single source of every derived market.
 *
 * Pure functions only: no I/O, no clock. `buildScoreMatrix` is the exact computation that used to live
 * inline in `createForecast` (same operation order, so the output is bit-identical); `ScoreMatrixV1`
 * is its persisted, hash-sealed form (D-01) and `resolveScoreMatrix` is the fail-closed read path (D-03).
 */

export const SCORE_MATRIX_VERSION = "score-matrix-v1" as const;
export const SCORE_MATRIX_GRID_MAX = 7 as const;
/** Top-level key of the stored forecast envelope that carries the persisted matrix (never part of the public DTO). */
export const SCORE_MATRIX_KEY = "scoreMatrix" as const;

const GRID_SIZE = SCORE_MATRIX_GRID_MAX + 1;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export type ScoreMatrixCell = readonly [homeGoals: number, awayGoals: number, probability: number];

export interface ScoreMatrixV1 {
  readonly version: typeof SCORE_MATRIX_VERSION;
  readonly gridMax: typeof SCORE_MATRIX_GRID_MAX;
  readonly retainedMass: number;
  readonly cells: readonly ScoreMatrixCell[];
  readonly cellsHash: string;
}

export interface BuiltScoreMatrix {
  /** The grid after the optional low-score correction and BEFORE the retained-mass normalisation. */
  readonly corrected: Array<{ homeGoals: number; awayGoals: number; probability: number }>;
  readonly retainedMass: number;
  /** `corrected` divided by `retainedMass`: the grid every market is read from. */
  readonly scoreMatrix: Array<{ homeGoals: number; awayGoals: number; probability: number }>;
}

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let current = 2; current <= goals; current += 1) factorial *= current;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

/**
 * Builds the 0..7 grid. `rho` is passed only for `dixon-coles-ensemble-v1` (including the explicit
 * `out-of-band-zero` rho = 0); the correction is applied BEFORE the retained-mass renormalisation so
 * every market still sums to one and retained + tail stay complementary (T-11-03).
 */
export function buildScoreMatrix(input: { readonly expectedGoals: Readonly<{ home: number; away: number }>; readonly rho?: number | undefined }): BuiltScoreMatrix {
  const { expectedGoals, rho } = input;
  const raw: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) raw.push({ homeGoals, awayGoals, probability: poisson(homeGoals, expectedGoals.home) * poisson(awayGoals, expectedGoals.away) });
  const corrected: Array<{ homeGoals: number; awayGoals: number; probability: number }> = typeof rho === "number"
    ? applyDixonColesCorrection({ cells: raw, lambdaHome: expectedGoals.home, lambdaAway: expectedGoals.away, rho })
    : raw;
  const retainedMass = corrected.reduce((sum, cell) => sum + cell.probability, 0);
  const scoreMatrix = corrected.map((cell) => ({ ...cell, probability: cell.probability / retainedMass }));
  return { corrected, retainedMass, scoreMatrix };
}

function sealed(cells: readonly ScoreMatrixCell[]): string {
  return canonicalSha256({ version: SCORE_MATRIX_VERSION, gridMax: SCORE_MATRIX_GRID_MAX, cells });
}

/** Seals the normalised grid for persistence: 64 cells in row order (home outside, away inside), exact doubles. */
export function buildScoreMatrixV1(scoreMatrix: readonly DixonColesCell[], retainedMass: number): ScoreMatrixV1 {
  const cells: ScoreMatrixCell[] = scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
  return { version: SCORE_MATRIX_VERSION, gridMax: SCORE_MATRIX_GRID_MAX, retainedMass, cells, cellsHash: sealed(cells) };
}

function invalid(): never {
  throw Object.assign(new Error("INVALID_SCORE_MATRIX"), { code: "INVALID_SCORE_MATRIX" });
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Closed, fail-closed parser of a persisted matrix: exact key set, exact grid shape, recomputed seal. */
export function parseScoreMatrixV1(value: unknown): ScoreMatrixV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const block = value as Record<string, unknown>;
  const keys = Object.keys(block).sort();
  const expected = ["cells", "cellsHash", "gridMax", "retainedMass", "version"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) invalid();
  if (block.version !== SCORE_MATRIX_VERSION || block.gridMax !== SCORE_MATRIX_GRID_MAX) invalid();
  const retainedMass = block.retainedMass;
  if (typeof retainedMass !== "number" || !Number.isFinite(retainedMass) || retainedMass <= 0 || retainedMass > 1) invalid();
  const cells = block.cells;
  if (!Array.isArray(cells) || cells.length !== CELL_COUNT) invalid();
  const parsed: ScoreMatrixCell[] = (cells as unknown[]).map((cell, index) => {
    if (!Array.isArray(cell) || cell.length !== 3) invalid();
    const [home, away, probability] = cell as unknown[];
    if (home !== Math.floor(index / GRID_SIZE) || away !== index % GRID_SIZE || !isProbability(probability)) invalid();
    return [home as number, away as number, probability as number] as const;
  });
  if (typeof block.cellsHash !== "string" || block.cellsHash !== sealed(parsed)) invalid();
  return { version: SCORE_MATRIX_VERSION, gridMax: SCORE_MATRIX_GRID_MAX, retainedMass, cells: parsed, cellsHash: block.cellsHash };
}

export type CoreSelectionProbabilities = Readonly<Record<ForecastSelection, number>>;

/**
 * The three frozen markets read from the grid exactly the way `createForecast` computes them: filter and
 * reduce from 0 in grid order; the complements are subtractions, never sums.
 */
export function coreMarketsFromCells(cells: readonly ScoreMatrixCell[]): CoreSelectionProbabilities {
  const sumWhere = (predicate: (home: number, away: number) => boolean) => cells.filter(([home, away]) => predicate(home, away)).reduce((sum, [, , probability]) => sum + probability, 0);
  const home = sumWhere((h, a) => h > a);
  const draw = sumWhere((h, a) => h === a);
  const over = sumWhere((h, a) => h + a > 2);
  const yes = sumWhere((h, a) => h > 0 && a > 0);
  return { HOME: home, DRAW: draw, AWAY: 1 - home - draw, OVER_2_5: over, UNDER_2_5: 1 - over, YES: yes, NO: 1 - yes };
}

const CORE_SELECTIONS: readonly ForecastSelection[] = ["HOME", "DRAW", "AWAY", "OVER_2_5", "UNDER_2_5", "YES", "NO"];

/** Issuance self-check: all seven probabilities must reproduce with `===` (the matrix IS the model's grid). */
export function assertCoreMarketsReproduced(matrix: ScoreMatrixV1, probabilities: Readonly<Record<ForecastMarket, readonly Readonly<{ selection: ForecastSelection; probability: number }>[]>>): void {
  const derived = coreMarketsFromCells(matrix.cells);
  const stored = new Map<ForecastSelection, number>();
  for (const events of Object.values(probabilities)) for (const event of events) stored.set(event.selection, event.probability);
  for (const selection of CORE_SELECTIONS) {
    if (stored.get(selection) !== derived[selection]) throw Object.assign(new Error("SCORE_MATRIX_SELF_CHECK_FAILED"), { code: "SCORE_MATRIX_SELF_CHECK_FAILED" });
  }
}

/**
 * The single place that removes the persisted matrix from a stored forecast envelope. Every reader of
 * `ForecastSnapshot.receipt` goes through it, so the public DTO keeps its closed key set (D-02).
 * Non-objects are returned as `dto` untouched so the strict parser downstream reports them.
 */
export function splitStoredForecast(raw: unknown): { readonly dto: unknown; readonly scoreMatrix: unknown } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { dto: raw, scoreMatrix: undefined };
  const { [SCORE_MATRIX_KEY]: scoreMatrix, ...dto } = raw as Record<string, unknown>;
  return { dto, scoreMatrix };
}

/** Internal reason codes: written to the operator log only, never shown to the client. */
export type ScoreMatrixUnavailableReason =
  | "INVALID_SCORE_MATRIX"
  | "UNKNOWN_MODEL"
  | "MISSING_INPUT"
  | "REDERIVE_FAILED"
  | "MARKETS_MISSING"
  | "MISMATCH";

export type ResolvedScoreMatrix =
  | Readonly<{ state: "AVAILABLE"; source: "PERSISTED" | "REDERIVED"; cells: readonly ScoreMatrixCell[] }>
  | Readonly<{ state: "UNAVAILABLE"; reason: ScoreMatrixUnavailableReason }>;

export interface ResolveScoreMatrixInput {
  /** The envelope's `scoreMatrix` value from `splitStoredForecast`; `undefined` when the key is absent. */
  readonly scoreMatrix: unknown;
  /** The snapshot's model version: never inferred, an unknown value makes the legacy path unavailable. */
  readonly modelVersion: unknown;
  /** The public DTO's receipt block (carries `expectedGoals` and, for dixon-coles, `dixonColes.rho`). */
  readonly receipt: unknown;
  /** The stored `ForecastMarket` rows of this snapshot as `{ market: events }`. */
  readonly markets: unknown;
}

function storedProbabilities(markets: unknown): Map<ForecastSelection, number> | null {
  if (markets === null || typeof markets !== "object") return null;
  const found = new Map<ForecastSelection, number>();
  for (const events of Object.values(markets as Record<string, unknown>)) {
    if (!Array.isArray(events)) return null;
    for (const event of events as unknown[]) {
      if (event === null || typeof event !== "object") return null;
      const { selection, probability } = event as { selection?: unknown; probability?: unknown };
      if (typeof probability !== "number" || !Number.isFinite(probability) || !CORE_SELECTIONS.includes(selection as ForecastSelection)) return null;
      found.set(selection as ForecastSelection, probability);
    }
  }
  return CORE_SELECTIONS.every((selection) => found.has(selection)) ? found : null;
}

/** True when all seven probabilities of the derived markets are within `tolerance` of the stored ones. */
function reproducesStored(cells: readonly ScoreMatrixCell[], markets: unknown, tolerance: number): "MARKETS_MISSING" | "MISMATCH" | null {
  const stored = storedProbabilities(markets);
  if (!stored) return "MARKETS_MISSING";
  const derived = coreMarketsFromCells(cells);
  return CORE_SELECTIONS.every((selection) => Math.abs(derived[selection] - stored.get(selection)!) <= tolerance) ? null : "MISMATCH";
}

/** A persisted matrix must reproduce the stored markets this tightly (bit-exact jsonb round trip). */
const PERSISTED_TOLERANCE = 1e-12;

/** A re-derived matrix is recomputed (Math.exp and ** are not guaranteed bit-identical across engines), hence the looser bound (D-03). */
export const SCORE_MATRIX_REDERIVED_TOLERANCE = 1e-9;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Legacy snapshots (no persisted key): the same pure `buildScoreMatrix` over the receipt's expected goals (and the
 * recorded rho for dixon-coles), accepted only when the three markets reproduce the stored ones (D-03).
 */
function rederive(input: ResolveScoreMatrixInput): ResolvedScoreMatrix {
  if (!isForecastModelVersion(input.modelVersion)) return { state: "UNAVAILABLE", reason: "UNKNOWN_MODEL" };
  const receipt = input.receipt;
  const goals = receipt !== null && typeof receipt === "object" ? (receipt as Record<string, unknown>).expectedGoals : undefined;
  if (goals === null || typeof goals !== "object") return { state: "UNAVAILABLE", reason: "MISSING_INPUT" };
  const { home, away } = goals as Record<string, unknown>;
  if (!finitePositive(home) || !finitePositive(away)) return { state: "UNAVAILABLE", reason: "MISSING_INPUT" };
  let rho: number | undefined;
  if (input.modelVersion === "dixon-coles-ensemble-v1") {
    const block = (receipt as Record<string, unknown>).dixonColes;
    const recorded = block !== null && typeof block === "object" ? (block as Record<string, unknown>).rho : undefined;
    if (typeof recorded !== "number" || !Number.isFinite(recorded)) return { state: "UNAVAILABLE", reason: "MISSING_INPUT" };
    rho = recorded;
  }
  let cells: ScoreMatrixCell[];
  try {
    cells = buildScoreMatrix({ expectedGoals: { home, away }, rho }).scoreMatrix.map((cell) => [cell.homeGoals, cell.awayGoals, cell.probability] as const);
  } catch {
    return { state: "UNAVAILABLE", reason: "REDERIVE_FAILED" };
  }
  const failure = reproducesStored(cells, input.markets, SCORE_MATRIX_REDERIVED_TOLERANCE);
  return failure ? { state: "UNAVAILABLE", reason: failure } : { state: "AVAILABLE", source: "REDERIVED", cells };
}

/**
 * Fail-closed resolution of the grid behind a stored forecast. A present-but-invalid key is never
 * masked by a fall-back to re-derivation (a tampered matrix must stay visible); re-derivation runs only
 * when the key is absent (a legacy row). Nothing is ever written.
 */
export function resolveScoreMatrix(input: ResolveScoreMatrixInput): ResolvedScoreMatrix {
  if (input.scoreMatrix === undefined) return rederive(input);
  let parsed: ScoreMatrixV1;
  try {
    parsed = parseScoreMatrixV1(input.scoreMatrix);
  } catch {
    return { state: "UNAVAILABLE", reason: "INVALID_SCORE_MATRIX" };
  }
  const failure = reproducesStored(parsed.cells, input.markets, PERSISTED_TOLERANCE);
  return failure ? { state: "UNAVAILABLE", reason: failure } : { state: "AVAILABLE", source: "PERSISTED", cells: parsed.cells };
}
