import { describe, expect, it } from "vitest";

import { DIXON_COLES_CONFIG, FORECAST_CONFIG } from "../../packages/domain/src/forecast/config.js";
import {
  DIXON_COLES_CONVENTION,
  applyDixonColesCorrection,
  assertDixonColesRho,
  dixonColesRhoBounds,
  dixonColesTau,
  dixonColesTauMin,
  estimateDixonColesRho,
} from "../../packages/domain/src/forecast/dixon-coles.js";
import { createForecast } from "../../packages/domain/src/forecast/model.js";
import type { EvidenceProjectionDto } from "../../packages/domain/src/evidence/contract.js";

const cutoff = "2026-09-13T12:00:00.000Z";
const lambdaHome = 1.45;
const lambdaAway = 1.15;

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let current = 2; current <= goals; current += 1) factorial *= current;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

function grid(maxGoals = 7): Array<{ homeGoals: number; awayGoals: number; probability: number }> {
  const cells: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  for (let home = 0; home <= maxGoals; home += 1) for (let away = 0; away <= maxGoals; away += 1) cells.push({ homeGoals: home, awayGoals: away, probability: poisson(home, lambdaHome) * poisson(away, lambdaAway) });
  return cells;
}

function probabilityOf(cells: readonly { homeGoals: number; awayGoals: number; probability: number }[], homeGoals: number, awayGoals: number): number {
  const cell = cells.find((item) => item.homeGoals === homeGoals && item.awayGoals === awayGoals);
  if (!cell) throw new Error("missing cell");
  return cell.probability;
}

describe("dixon-coles tau convention (D-06)", () => {
  it("pins the modern convention literally", () => {
    const rho = -0.08;
    expect(DIXON_COLES_CONVENTION).toBe("tau-1x2-v1");
    expect(DIXON_COLES_CONFIG.dixonColes.convention).toBe(DIXON_COLES_CONVENTION);
    expect(dixonColesTau(0, 0, lambdaHome, lambdaAway, rho)).toBe(1 - lambdaHome * lambdaAway * rho);
    expect(dixonColesTau(1, 0, lambdaHome, lambdaAway, rho)).toBe(1 + lambdaAway * rho);
    expect(dixonColesTau(0, 1, lambdaHome, lambdaAway, rho)).toBe(1 + lambdaHome * rho);
    expect(dixonColesTau(1, 1, lambdaHome, lambdaAway, rho)).toBe(1 - rho);
  });

  it.each([[1, 2], [2, 1], [2, 2], [3, 0], [0, 2], [2, 0], [0, 4], [7, 7], [4, 3]])("leaves cell %i-%i untouched", (home, away) => {
    expect(dixonColesTau(home, away, lambdaHome, lambdaAway, -0.08)).toBe(1);
  });

  it("grows draws and shrinks 1-0 / 0-1 when rho is negative", () => {
    const raw = grid();
    const corrected = applyDixonColesCorrection({ cells: raw, lambdaHome, lambdaAway, rho: -0.08 });
    expect(probabilityOf(corrected, 0, 0)).toBeGreaterThan(probabilityOf(raw, 0, 0));
    expect(probabilityOf(corrected, 1, 1)).toBeGreaterThan(probabilityOf(raw, 1, 1));
    expect(probabilityOf(corrected, 1, 0)).toBeLessThan(probabilityOf(raw, 1, 0));
    expect(probabilityOf(corrected, 0, 1)).toBeLessThan(probabilityOf(raw, 0, 1));
  });
});

describe("dixon-coles rho bounds (D-07 amended)", () => {
  it("derives three lower and two upper constraints from tau positivity", () => {
    const bounds = dixonColesRhoBounds(lambdaHome, lambdaAway);
    expect(bounds.min).toBe(Math.max(-1 / (lambdaHome * lambdaAway), -1 / lambdaHome, -1 / lambdaAway));
    expect(bounds.max).toBe(Math.min(1 / (lambdaHome * lambdaAway), 1));
    expect(bounds.min).toBeLessThan(bounds.max);
  });

  it.each([
    [1.45, 1.15],
    [0.2, 0.2],
    [4, 4],
    [2.9, 0.35],
  ])("keeps every tau strictly positive inside the band for lambda %s/%s", (home, away) => {
    const bounds = dixonColesRhoBounds(home, away);
    // The band is exclusive: tau reaches zero exactly on the boundary (D-07).
    const epsilon = DIXON_COLES_CONFIG.dixonColes.boundsEpsilon * 1e3;
    for (const rho of [bounds.min + epsilon, bounds.min / 2, 0, bounds.max / 2, bounds.max - epsilon]) {
      for (const cell of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        expect(dixonColesTau(cell[0], cell[1], home, away, rho)).toBeGreaterThan(0);
      }
    }
  });

  it("rejects out-of-band and non-finite rho instead of clamping", () => {
    const bounds = dixonColesRhoBounds(lambdaHome, lambdaAway);
    expect(() => assertDixonColesRho(0, bounds)).not.toThrow();
    expect(() => assertDixonColesRho(-0.08, bounds)).not.toThrow();
    expect(() => assertDixonColesRho(bounds.max, bounds)).toThrow("INVALID_DIXON_COLES_RHO");
    expect(() => assertDixonColesRho(bounds.min, bounds)).toThrow("INVALID_DIXON_COLES_RHO");
    expect(() => assertDixonColesRho(bounds.max - 1e-12, bounds, 1e-9)).toThrow("INVALID_DIXON_COLES_RHO");
    expect(() => assertDixonColesRho(Number.NaN, bounds)).toThrow("INVALID_DIXON_COLES_RHO");
    expect(() => assertDixonColesRho(Number.POSITIVE_INFINITY, bounds)).toThrow("INVALID_DIXON_COLES_RHO");
    expect(() => assertDixonColesRho(Number.NEGATIVE_INFINITY, bounds)).toThrow("INVALID_DIXON_COLES_RHO");
  });

  it("reports the worst-case tau as a provenance summary", () => {
    const rho = -0.08;
    expect(dixonColesTauMin(lambdaHome, lambdaAway, rho)).toBe(Math.min(
      dixonColesTau(0, 0, lambdaHome, lambdaAway, rho),
      dixonColesTau(1, 0, lambdaHome, lambdaAway, rho),
      dixonColesTau(0, 1, lambdaHome, lambdaAway, rho),
      dixonColesTau(1, 1, lambdaHome, lambdaAway, rho),
    ));
    expect(dixonColesTauMin(lambdaHome, lambdaAway, 0)).toBe(1);
  });
});

describe("applyDixonColesCorrection", () => {
  it("changes exactly the four low cells and never mutates the input grid", () => {
    const raw = grid();
    const snapshot = raw.map((cell) => ({ ...cell }));
    const corrected = applyDixonColesCorrection({ cells: raw, lambdaHome, lambdaAway, rho: -0.08 });
    expect(raw).toEqual(snapshot);
    expect(corrected).toHaveLength(raw.length);
    const changed = corrected.filter((cell, index) => cell.probability !== raw[index]!.probability);
    expect(changed.map((cell) => `${cell.homeGoals}-${cell.awayGoals}`).sort()).toEqual(["0-0", "0-1", "1-0", "1-1"]);
  });

  it("reproduces the independent Poisson grid bit-for-bit at rho = 0", () => {
    const raw = grid();
    const corrected = applyDixonColesCorrection({ cells: raw, lambdaHome, lambdaAway, rho: 0 });
    for (const [index, cell] of corrected.entries()) expect(Object.is(cell.probability, raw[index]!.probability)).toBe(true);
  });

  it("fails closed on an invalid rho", () => {
    expect(() => applyDixonColesCorrection({ cells: grid(), lambdaHome, lambdaAway, rho: 5 })).toThrow("INVALID_DIXON_COLES_RHO");
  });
});

describe("dixon-coles normalization inside createForecast", () => {
  function projection(side: "home" | "away"): EvidenceProjectionDto {
    const source = { observationId: `${side}-observation`, provider: "API_FOOTBALL", providerFixtureId: `${side}-external`, effectiveAt: "2026-09-10T12:00:00.000Z", observedAt: cutoff, payloadHash: `sha256:${side}`, payloadBytes: 42 };
    const component = (kind: string, value: unknown, sampleSize = 10) => ({ kind, value, unit: "test", sampleSize, limitation: null, sourceRefs: [source] });
    return {
      teamId: side,
      requestedAsOf: cutoff,
      resolvedAsOfUtc: cutoff,
      cutoffBoundary: { observedAt: cutoff },
      state: "COMPLETE",
      freshness: "FRESH",
      buildId: `build-${side}`,
      publishedAt: cutoff,
      receipt: { requestedAsOf: cutoff, resolvedAsOf: cutoff, configVersion: "evidence-v1", sourceWindow: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt }, inputs: [source] },
      coverage: { requestedFrom: null, requestedTo: cutoff, returnedFrom: source.effectiveAt, returnedTo: source.effectiveAt },
      components: {
        form5: component("form5", side === "home" ? 2.1 : 1.2, 5),
        form10: component("form10", side === "home" ? 1.9 : 1.3),
        elo: component("elo", side === "home" ? 1640 : 1420),
        homeStrength: component("homeStrength", 2.3),
        awayStrength: component("awayStrength", 0.9),
        goalRates: component("goalRates", side === "home" ? { for: 6, against: 0.2 } : { for: 0.2, against: 6 }),
        restDays: component("restDays", side === "home" ? 20 : 1, 1),
        h2h: component("h2h", { pointsPerMatch: side === "home" ? 3 : 0, weight: 0.03 }, 4),
      },
    };
  }

  const base = { fixtureId: "fixture-1", forecastSnapshotId: "forecast-1", cutoff, canonicalIdentityState: "RESOLVED" as const, home: projection("home"), away: projection("away"), lineupAvailable: false, sourceReliability: 0.8 };
  const provenance = { rho: -0.08, convention: DIXON_COLES_CONVENTION, method: "mle-low-score-v1" as const, windowFrom: "2024-01-01T00:00:00.000Z", windowTo: cutoff, sampleSize: 400, tauMin: 0.9 };

  it("keeps every market summing to one after the retained-mass renormalization", () => {
    const result = createForecast({ ...base, modelVersion: "dixon-coles-ensemble-v1", dixonColes: { rho: -0.08, provenance } });
    for (const market of Object.values(result.markets)) expect(Math.abs(market.reduce((sum, item) => sum + item.probability, 0) - 1)).toBeLessThanOrEqual(FORECAST_CONFIG.probabilityTolerance);
    expect(result.retainedMass + result.tailMass).toBeCloseTo(1, 12);
    expect(result.modelVersion).toBe("dixon-coles-ensemble-v1");
    expect(result.configVersion).toBe("forecast-config-v2");
  });

  it("raises the draw probability relative to the poisson-ensemble-v1 baseline", () => {
    const v1 = createForecast(base);
    const dc = createForecast({ ...base, modelVersion: "dixon-coles-ensemble-v1", dixonColes: { rho: -0.08, provenance } });
    const draw = (result: typeof v1) => result.markets.ONE_X_TWO.find((event) => event.selection === "DRAW")!.probability;
    expect(draw(dc)).toBeGreaterThan(draw(v1));
    expect(dc.configHash).not.toBe(v1.configHash);
    expect(dc.inputHash).not.toBe(v1.inputHash);
  });

  it("reproduces the v1 probabilities exactly at rho = 0", () => {
    const v1 = createForecast(base);
    const dc = createForecast({ ...base, modelVersion: "dixon-coles-ensemble-v1", dixonColes: { rho: 0, provenance: { ...provenance, rho: 0 } } });
    expect(dc.markets).toEqual(v1.markets);
    expect(dc.retainedMass).toBe(v1.retainedMass);
    expect(dc.scoreMatrix.map((cell) => cell.probability)).toEqual(v1.scoreMatrix.map((cell) => cell.probability));
  });
});

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sampleScore(uniform: number, home: number, away: number, rho: number): { homeGoals: number; awayGoals: number } {
  const cells: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  let total = 0;
  for (let h = 0; h <= 9; h += 1) for (let a = 0; a <= 9; a += 1) {
    const probability = poisson(h, home) * poisson(a, away) * dixonColesTau(h, a, home, away, rho);
    cells.push({ homeGoals: h, awayGoals: a, probability });
    total += probability;
  }
  const target = uniform * total;
  let accumulated = 0;
  for (const cell of cells) {
    accumulated += cell.probability;
    if (target <= accumulated) return { homeGoals: cell.homeGoals, awayGoals: cell.awayGoals };
  }
  return { homeGoals: 9, awayGoals: 9 };
}

describe("estimateDixonColesRho", () => {
  const window = { windowFrom: "2024-09-13T00:00:00.000Z", windowTo: cutoff };

  it("returns an explicit zero fallback for an empty sample", () => {
    expect(estimateDixonColesRho([])).toMatchObject({ rho: 0, convention: DIXON_COLES_CONVENTION, method: "insufficient-sample-zero", sampleSize: 0, tauMin: 1 });
  });

  it("returns the zero fallback when the sample is below the minimum", () => {
    const rows = Array.from({ length: 10 }, () => ({ lambdaHome: 1.4, lambdaAway: 1.1, homeGoals: 0, awayGoals: 0 }));
    expect(estimateDixonColesRho(rows, { ...window, minSamples: 300 })).toMatchObject({ rho: 0, method: "insufficient-sample-zero", sampleSize: 10 });
  });

  it("returns the zero fallback when no low-score likelihood exists", () => {
    const rows = Array.from({ length: 400 }, (_, index) => ({ lambdaHome: 1.4, lambdaAway: 1.1, homeGoals: 3 + (index % 2), awayGoals: 2 + (index % 3) }));
    expect(estimateDixonColesRho(rows, { ...window, minSamples: 100 })).toMatchObject({ rho: 0, method: "insufficient-sample-zero" });
  });

  it("recovers a known negative rho from synthetic low-score history", () => {
    const target = -0.08;
    const size = 2400;
    const random = lcg(20261120);
    // Stratified inverse-CDF draw `(i + u_i) / N` with a fixed-seed LCG: the empirical
    // cell counts stay within O(1/N) of the model, so the 0.02 tolerance tests the
    // estimator rather than the sampling noise of one particular seed.
    const rows = Array.from({ length: size }, (_, index) => {
      const home = 1.2 + (index % 7) * 0.15;
      const away = 0.9 + (index % 5) * 0.12;
      return { lambdaHome: home, lambdaAway: away, ...sampleScore((index + random()) / size, home, away, target) };
    });
    const result = estimateDixonColesRho(rows, { ...window, minSamples: 300 });
    expect(result.method).toBe("mle-low-score-v1");
    expect(result.sampleSize).toBe(size);
    expect(result.rho).toBeGreaterThan(target - 0.02);
    expect(result.rho).toBeLessThan(target + 0.02);
    expect(result.tauMin).toBeGreaterThan(0);
    expect(result.tauMin).toBeLessThanOrEqual(1);
    expect(result.windowFrom).toBe(window.windowFrom);
    expect(result.windowTo).toBe(window.windowTo);
  });

  it("is deterministic and order-independent", () => {
    const target = -0.08;
    const size = 600;
    const random = lcg(4242);
    const rows = Array.from({ length: size }, (_, index) => {
      const home = 1.3 + (index % 5) * 0.1;
      const away = 1.0 + (index % 4) * 0.1;
      return { lambdaHome: home, lambdaAway: away, ...sampleScore((index + random()) / size, home, away, target) };
    });
    const first = estimateDixonColesRho(rows, { ...window, minSamples: 100 });
    const second = estimateDixonColesRho(rows, { ...window, minSamples: 100 });
    expect(Object.is(first.rho, second.rho)).toBe(true);
    const shuffled = [...rows].reverse();
    expect(Object.is(estimateDixonColesRho(shuffled, { ...window, minSamples: 100 }).rho, first.rho)).toBe(true);
  });

  it("never returns a non-finite rho", () => {
    const rows = Array.from({ length: 400 }, (_, index) => ({ lambdaHome: 1.4, lambdaAway: 1.1, homeGoals: index % 2, awayGoals: index % 3 }));
    const result = estimateDixonColesRho(rows, { ...window, minSamples: 100 });
    expect(Number.isFinite(result.rho)).toBe(true);
  });
});
