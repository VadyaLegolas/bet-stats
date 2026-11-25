import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../packages/domain/src/forecast/canonical-json.js";
import { createForecast, type ForecastDraft } from "../../packages/domain/src/forecast/model.js";
import {
  assertCoreMarketsReproduced,
  buildScoreMatrix,
  buildScoreMatrixV1,
  coreMarketsFromCells,
  parseScoreMatrixV1,
  resolveScoreMatrix,
  splitStoredForecast,
  type ScoreMatrixV1,
} from "../../packages/domain/src/markets/score-matrix.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";

function projection(side: "home" | "away"): EvidenceProjectionDto {
  const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${side}`, payloadBytes: 42 };
  const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
  return {
    teamId: side, requestedAsOf: cutoff, resolvedAsOfUtc: cutoff, cutoffBoundary: { observedAt: cutoff }, state: "COMPLETE", freshness: "FRESH", buildId: `build-${side}`, publishedAt: cutoff,
    receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
    coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
    components: {
      form5: component("form5", side === "home" ? 2.1 : 1.2, 5), form10: component("form10", side === "home" ? 1.9 : 1.3), elo: component("elo", side === "home" ? 1640 : 1420),
      homeStrength: component("homeStrength", 2.3), awayStrength: component("awayStrength", 0.9),
      goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
      restDays: component("restDays", side === "home" ? 20 : 1, 1), h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
    },
  };
}

const provenance = (rho: number) => ({ rho, convention: "tau-1x2-v1" as const, method: "mle-low-score-v1" as const, windowFrom: "2024-01-01T00:00:00.000Z", windowTo: cutoff, sampleSize: 400, tauMin: 0.9 });

function forecastWith(modelVersion: "poisson-ensemble-v1" | "dixon-coles-ensemble-v1", rho?: number): ForecastDraft {
  return createForecast({
    fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED", home: projection("home"), away: projection("away"), lineupAvailable: false, sourceReliability: 0.8,
    modelVersion, ...(rho === undefined ? {} : { dixonColes: { rho, provenance: provenance(rho) } }),
  });
}

const CASES = [
  ["poisson", () => forecastWith("poisson-ensemble-v1")],
  ["dixon-coles rho > 0", () => forecastWith("dixon-coles-ensemble-v1", 0.05)],
  ["dixon-coles rho < 0", () => forecastWith("dixon-coles-ensemble-v1", -0.08)],
  ["dixon-coles out-of-band-zero", () => forecastWith("dixon-coles-ensemble-v1", 0.99)],
] as const;

describe("buildScoreMatrix", () => {
  it.each(CASES)("matches the matrix createForecast uses, bit for bit (%s)", (_name, make) => {
    const forecast = make();
    const rho = forecast.dixonColes?.rho;
    const built = buildScoreMatrix({ expectedGoals: forecast.expectedGoals, ...(rho === undefined ? {} : { rho }) });
    expect(built.retainedMass).toBe(forecast.retainedMass);
    expect(built.scoreMatrix).toHaveLength(64);
    for (const [index, cell] of built.scoreMatrix.entries()) {
      const expected = forecast.scoreMatrix[index]!;
      expect([cell.homeGoals, cell.awayGoals]).toEqual([expected.homeGoals, expected.awayGoals]);
      expect(Object.is(cell.probability, expected.probability)).toBe(true);
    }
  });
});

describe("buildScoreMatrixV1", () => {
  const forecast = forecastWith("dixon-coles-ensemble-v1", -0.08);
  const matrix = buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass);

  it("seals 64 cells in row order with a stable canonical hash", () => {
    expect(matrix.version).toBe("score-matrix-v1");
    expect(matrix.gridMax).toBe(7);
    expect(matrix.cells).toHaveLength(64);
    expect(matrix.cells[0]).toEqual([0, 0, forecast.scoreMatrix[0]!.probability]);
    expect(matrix.cells[9]!.slice(0, 2)).toEqual([1, 1]);
    expect(matrix.cellsHash).toBe(canonicalSha256({ version: matrix.version, gridMax: matrix.gridMax, cells: matrix.cells }));
    expect(buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass).cellsHash).toBe(matrix.cellsHash);
  });

  it("survives a JSON round trip bit for bit and parses", () => {
    const parsed = parseScoreMatrixV1(JSON.parse(JSON.stringify(matrix)));
    expect(parsed).toEqual(matrix);
    for (const [index, cell] of parsed.cells.entries()) expect(Object.is(cell[2], matrix.cells[index]![2])).toBe(true);
  });

  it("derives the three markets bit for bit equal to createForecast", () => {
    const derived = coreMarketsFromCells(matrix.cells);
    for (const events of Object.values(forecast.markets)) for (const event of events) expect(Object.is(derived[event.selection], event.probability)).toBe(true);
    expect(() => assertCoreMarketsReproduced(matrix, forecast.markets)).not.toThrow();
  });

  it("fails the self-check when one probability differs even by one ulp", () => {
    const tampered = { ...forecast.markets, ONE_X_TWO: forecast.markets.ONE_X_TWO.map((event) => event.selection === "HOME" ? { ...event, probability: event.probability + Number.EPSILON } : event) };
    expect(() => assertCoreMarketsReproduced(matrix, tampered)).toThrow("SCORE_MATRIX_SELF_CHECK_FAILED");
  });
});

describe("parseScoreMatrixV1", () => {
  const forecast = forecastWith("poisson-ensemble-v1");
  const matrix = buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass);
  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(matrix));
  const reseal = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value, cellsHash: canonicalSha256({ version: value.version, gridMax: value.gridMax, cells: value.cells }) });

  it("rejects an extra key", () => {
    expect(() => parseScoreMatrixV1({ ...clone(), extra: true })).toThrow("INVALID_SCORE_MATRIX");
  });

  it("rejects non-objects, a wrong version and a wrong grid size", () => {
    expect(() => parseScoreMatrixV1(null)).toThrow("INVALID_SCORE_MATRIX");
    expect(() => parseScoreMatrixV1([])).toThrow("INVALID_SCORE_MATRIX");
    expect(() => parseScoreMatrixV1({ ...clone(), version: "score-matrix-v2" })).toThrow("INVALID_SCORE_MATRIX");
    expect(() => parseScoreMatrixV1({ ...clone(), gridMax: 6 })).toThrow("INVALID_SCORE_MATRIX");
  });

  it("rejects 63 cells even when the seal is recomputed", () => {
    const value = clone();
    value.cells = (value.cells as unknown[]).slice(0, 63);
    expect(() => parseScoreMatrixV1(reseal(value))).toThrow("INVALID_SCORE_MATRIX");
  });

  it("rejects a wrong cell index even when the seal is recomputed", () => {
    const value = clone();
    const cells = value.cells as number[][];
    [cells[1], cells[2]] = [cells[2]!, cells[1]!];
    expect(() => parseScoreMatrixV1(reseal(value))).toThrow("INVALID_SCORE_MATRIX");
  });

  it.each([-0.1, 1.1, Number.NaN])("rejects a probability of %s", (probability) => {
    const value = clone();
    (value.cells as number[][])[5]![2] = probability;
    expect(() => parseScoreMatrixV1(reseal(value))).toThrow("INVALID_SCORE_MATRIX");
  });

  it("rejects a retained mass outside (0, 1]", () => {
    expect(() => parseScoreMatrixV1({ ...clone(), retainedMass: 0 })).toThrow("INVALID_SCORE_MATRIX");
    expect(() => parseScoreMatrixV1({ ...clone(), retainedMass: 1.5 })).toThrow("INVALID_SCORE_MATRIX");
  });

  it("rejects a replaced cellsHash and a silently changed cell", () => {
    expect(() => parseScoreMatrixV1({ ...clone(), cellsHash: "sha256:00" })).toThrow("INVALID_SCORE_MATRIX");
    const value = clone();
    (value.cells as number[][])[0]![2] = (value.cells as number[][])[0]![2]! * 0.5;
    expect(() => parseScoreMatrixV1(value)).toThrow("INVALID_SCORE_MATRIX");
  });
});

describe("splitStoredForecast", () => {
  it("removes the top-level key without mutating the input", () => {
    const raw = { id: "a", receipt: { x: 1 }, scoreMatrix: { version: "score-matrix-v1" } };
    const frozen = JSON.stringify(raw);
    const { dto, scoreMatrix } = splitStoredForecast(raw);
    expect(dto).toEqual({ id: "a", receipt: { x: 1 } });
    expect(Object.hasOwn(dto as object, "scoreMatrix")).toBe(false);
    expect(scoreMatrix).toEqual({ version: "score-matrix-v1" });
    expect(JSON.stringify(raw)).toBe(frozen);
  });

  it("gives a row without the key the same dto and an undefined matrix", () => {
    const { dto, scoreMatrix } = splitStoredForecast({ id: "a", receipt: { x: 1 } });
    expect(dto).toEqual({ id: "a", receipt: { x: 1 } });
    expect(scoreMatrix).toBeUndefined();
  });

  it("returns non-objects untouched so the strict parser can report them", () => {
    expect(splitStoredForecast(null)).toEqual({ dto: null, scoreMatrix: undefined });
    expect(splitStoredForecast("text").dto).toBe("text");
    expect(splitStoredForecast([1]).dto).toEqual([1]);
  });
});

/** The inputs the repository hands to `resolveScoreMatrix` for a stored snapshot of `forecast`. */
function stored(forecast: ForecastDraft, scoreMatrix: unknown) {
  return {
    scoreMatrix,
    modelVersion: forecast.modelVersion as unknown,
    receipt: JSON.parse(JSON.stringify({ expectedGoals: forecast.expectedGoals, ...(forecast.dixonColes ? { dixonColes: forecast.dixonColes } : {}) })) as unknown,
    markets: JSON.parse(JSON.stringify(forecast.markets)) as unknown,
  };
}

describe("resolveScoreMatrix (persisted path)", () => {
  const forecast = forecastWith("poisson-ensemble-v1");
  const matrix: ScoreMatrixV1 = buildScoreMatrixV1(forecast.scoreMatrix, forecast.retainedMass);
  const json = (): unknown => JSON.parse(JSON.stringify(matrix));

  it("accepts a stored matrix that reproduces the stored markets", () => {
    expect(resolveScoreMatrix(stored(forecast, json()))).toMatchObject({ state: "AVAILABLE", source: "PERSISTED" });
  });

  it("is UNAVAILABLE for an invalid or tampered key and for markets that do not reproduce", () => {
    expect(resolveScoreMatrix(stored(forecast, null))).toEqual({ state: "UNAVAILABLE", reason: "INVALID_SCORE_MATRIX" });
    expect(resolveScoreMatrix(stored(forecast, { ...(json() as object), cellsHash: "sha256:00" }))).toEqual({ state: "UNAVAILABLE", reason: "INVALID_SCORE_MATRIX" });
    const shifted = { ...stored(forecast, json()), markets: { ...forecast.markets, BTTS: forecast.markets.BTTS.map((event) => ({ ...event, probability: event.probability + 1e-6 })) } };
    expect(resolveScoreMatrix(shifted)).toEqual({ state: "UNAVAILABLE", reason: "MISMATCH" });
    expect(resolveScoreMatrix({ ...stored(forecast, json()), markets: {} })).toEqual({ state: "UNAVAILABLE", reason: "MARKETS_MISSING" });
  });

  it("never falls back to re-derivation when a present key is invalid, even if the legacy path would succeed", () => {
    expect(resolveScoreMatrix(stored(forecast, undefined))).toMatchObject({ state: "AVAILABLE", source: "REDERIVED" });
    expect(resolveScoreMatrix(stored(forecast, { ...(json() as object), cellsHash: "sha256:00" }))).toEqual({ state: "UNAVAILABLE", reason: "INVALID_SCORE_MATRIX" });
  });
});

describe("resolveScoreMatrix (legacy re-derivation, D-03)", () => {
  it.each(CASES)("accepts a legacy snapshot whose markets reproduce (%s)", (_name, make) => {
    const forecast = make();
    const resolved = resolveScoreMatrix(stored(forecast, undefined));
    expect(resolved).toMatchObject({ state: "AVAILABLE", source: "REDERIVED" });
    if (resolved.state !== "AVAILABLE") return;
    // The re-derived grid is the one the model used.
    expect(resolved.cells).toHaveLength(64);
    for (const [index, cell] of resolved.cells.entries()) expect(Object.is(cell[2], forecast.scoreMatrix[index]!.probability)).toBe(true);
  });

  it("applies the recorded rho = 0 of an out-of-band dixon-coles snapshot", () => {
    const forecast = forecastWith("dixon-coles-ensemble-v1", 0.99);
    expect(forecast.dixonColes?.rho).toBe(0);
    expect(resolveScoreMatrix(stored(forecast, undefined))).toMatchObject({ state: "AVAILABLE", source: "REDERIVED" });
  });

  it.each(["HOME", "DRAW", "AWAY", "OVER_2_5", "UNDER_2_5", "YES", "NO"] as const)("rejects the snapshot when the stored %s differs by 1e-6", (selection) => {
    const forecast = forecastWith("poisson-ensemble-v1");
    const input = stored(forecast, undefined);
    const shifted = Object.fromEntries(Object.entries(forecast.markets).map(([market, events]) => [market, events.map((event) => event.selection === selection ? { ...event, probability: event.probability + 1e-6 } : event)]));
    expect(resolveScoreMatrix({ ...input, markets: shifted })).toEqual({ state: "UNAVAILABLE", reason: "MISMATCH" });
  });

  it("tolerates a difference far below 1e-9", () => {
    const forecast = forecastWith("poisson-ensemble-v1");
    const input = stored(forecast, undefined);
    const nudged = { ...forecast.markets, ONE_X_TWO: forecast.markets.ONE_X_TWO.map((event) => event.selection === "HOME" ? { ...event, probability: event.probability + 1e-12 } : event) };
    expect(resolveScoreMatrix({ ...input, markets: nudged })).toMatchObject({ state: "AVAILABLE", source: "REDERIVED" });
  });

  it("is UNAVAILABLE for an unknown model version, missing expected goals or a dixon-coles snapshot without rho", () => {
    const poisson = forecastWith("poisson-ensemble-v1");
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), modelVersion: "poisson-ensemble-v9" })).toEqual({ state: "UNAVAILABLE", reason: "UNKNOWN_MODEL" });
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), modelVersion: undefined })).toEqual({ state: "UNAVAILABLE", reason: "UNKNOWN_MODEL" });
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), receipt: {} })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), receipt: { expectedGoals: { home: 0, away: 1 } } })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), receipt: { expectedGoals: { home: "1.4", away: 1.1 } } })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
    expect(resolveScoreMatrix({ ...stored(poisson, undefined), receipt: null })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
    const dixon = forecastWith("dixon-coles-ensemble-v1", -0.08);
    expect(resolveScoreMatrix({ ...stored(dixon, undefined), receipt: { expectedGoals: dixon.expectedGoals } })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
    expect(resolveScoreMatrix({ ...stored(dixon, undefined), receipt: { expectedGoals: dixon.expectedGoals, dixonColes: { rho: Number.NaN } } })).toEqual({ state: "UNAVAILABLE", reason: "MISSING_INPUT" });
  });

  it("is UNAVAILABLE when the recorded rho is outside the feasible band instead of throwing", () => {
    const dixon = forecastWith("dixon-coles-ensemble-v1", -0.08);
    expect(resolveScoreMatrix({ ...stored(dixon, undefined), receipt: { expectedGoals: dixon.expectedGoals, dixonColes: { rho: 0.99 } } })).toEqual({ state: "UNAVAILABLE", reason: "REDERIVE_FAILED" });
  });

  it("is UNAVAILABLE when the stored markets are incomplete", () => {
    const forecast = forecastWith("poisson-ensemble-v1");
    expect(resolveScoreMatrix({ ...stored(forecast, undefined), markets: { ONE_X_TWO: forecast.markets.ONE_X_TWO } })).toEqual({ state: "UNAVAILABLE", reason: "MARKETS_MISSING" });
  });
});
