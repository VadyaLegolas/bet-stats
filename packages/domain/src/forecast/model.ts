import { createHash } from "node:crypto";
import Decimal from "decimal.js";

import type { EvidenceProjectionDto, EvidenceSourceRef } from "../evidence/contract.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type ForecastMarket = "ONE_X_TWO" | "OVER_UNDER_2_5" | "BTTS";
export type ForecastSelection = "HOME" | "DRAW" | "AWAY" | "OVER_2_5" | "UNDER_2_5" | "YES" | "NO";

export interface ForecastInput {
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly cutoff: string;
  readonly canonicalIdentityState: "RESOLVED" | "UNRESOLVED";
  readonly home: EvidenceProjectionDto;
  readonly away: EvidenceProjectionDto;
  readonly lineupAvailable: boolean;
  readonly sourceReliability: number;
}

export interface ForecastEvent {
  readonly selection: ForecastSelection;
  readonly probability: number;
  readonly fairOdds: string | null;
}

export interface ForecastDraft {
  readonly fixtureId: string;
  readonly forecastSnapshotId: string;
  readonly cutoff: string;
  readonly modelVersion: "poisson-ensemble-v1";
  readonly configVersion: "forecast-config-v1";
  readonly configHash: string;
  readonly inputHash: string;
  readonly evidenceBuildIds: readonly string[];
  readonly expectedGoals: Readonly<{ home: number; away: number }>;
  readonly scoreMatrix: readonly Readonly<{ homeGoals: number; awayGoals: number; probability: number }>[];
  readonly retainedMass: number;
  readonly tailMass: number;
  readonly tailWarning: boolean;
  readonly markets: Readonly<Record<ForecastMarket, readonly ForecastEvent[]>>;
  readonly confidence: Readonly<{ version: "confidence-v1"; score: number; components: Readonly<Record<"completeness" | "lineupAvailability" | "freshness" | "sourceReliability" | "modelStability", number>> }>;
  readonly limitations: readonly string[];
  readonly sources: readonly EvidenceSourceRef[];
  readonly assumptions: readonly string[];
}

const CONFIG = {
  version: "forecast-config-v1",
  probabilityTolerance: 1e-12,
  tailWarningThreshold: 0.01,
  baselineGoals: { home: 1.45, away: 1.15 },
  coefficients: { goalRates: 0.35, elo: 0.18, form: 0.12, venue: 0.1, rest: 0.05, h2h: 0.03 },
  transformBounds: [-0.2, 0.2],
  h2hBounds: [-0.03, 0.03],
  multiplierBounds: [0.65, 1.35],
  lambdaBounds: [0.2, 4],
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clamp(value: number, [minimum, maximum]: readonly [number, number]): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function numeric(projection: EvidenceProjectionDto, kind: "form5" | "elo" | "homeStrength" | "awayStrength" | "restDays"): number | null {
  const component = projection.components[kind];
  return component && typeof component.value === "number" && Number.isFinite(component.value) ? component.value : null;
}

function rate(projection: EvidenceProjectionDto): Readonly<{ for: number; against: number }> | null {
  const value = projection.components.goalRates?.value;
  return value && typeof value === "object" && "for" in value && "against" in value ? value as Readonly<{ for: number; against: number }> : null;
}

function h2h(projection: EvidenceProjectionDto): number | null {
  const value = projection.components.h2h?.value;
  return value && typeof value === "object" && "pointsPerMatch" in value ? (value as { pointsPerMatch: number }).pointsPerMatch : null;
}

function adjustment(team: EvidenceProjectionDto, opponent: EvidenceProjectionDto, venue: "home" | "away"): number {
  const teamRate = rate(team);
  const opponentRate = rate(opponent);
  const goalSignal = teamRate && opponentRate ? ((teamRate.for + opponentRate.against) / 2 - 1.35) / 1.35 : 0;
  const eloSignal = ((numeric(team, "elo") ?? 1500) - (numeric(opponent, "elo") ?? 1500)) / 400;
  const formSignal = ((numeric(team, "form5") ?? 1.5) - 1.5) / 1.5;
  const venueKind = venue === "home" ? "homeStrength" : "awayStrength";
  const venueSignal = ((numeric(team, venueKind) ?? 1.5) - 1.5) / 1.5;
  const restSignal = ((numeric(team, "restDays") ?? 5) - (numeric(opponent, "restDays") ?? 5)) / 7;
  const h2hSignal = ((h2h(team) ?? 1.5) - 1.5) / 1.5;
  return clamp(goalSignal * CONFIG.coefficients.goalRates, CONFIG.transformBounds)
    + clamp(eloSignal * CONFIG.coefficients.elo, CONFIG.transformBounds)
    + clamp(formSignal * CONFIG.coefficients.form, CONFIG.transformBounds)
    + clamp(venueSignal * CONFIG.coefficients.venue, CONFIG.transformBounds)
    + clamp(restSignal * CONFIG.coefficients.rest, CONFIG.transformBounds)
    + clamp(h2hSignal * CONFIG.coefficients.h2h, CONFIG.h2hBounds);
}

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let current = 2; current <= goals; current += 1) factorial *= current;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

function event(selection: ForecastSelection, probability: number): ForecastEvent {
  return { selection, probability, fairOdds: probability <= 0 ? null : new Decimal(1).div(probability).toString() };
}

export function createForecast(input: ForecastInput): ForecastDraft {
  if (!Number.isFinite(Date.parse(input.cutoff))) throw new Error("INVALID_FORECAST_CUTOFF");
  if (!Number.isFinite(input.sourceReliability) || input.sourceReliability < 0 || input.sourceReliability > 1) throw new Error("INVALID_SOURCE_RELIABILITY");
  const limitations: string[] = [];
  if (input.canonicalIdentityState !== "RESOLVED") limitations.push("UNRESOLVED_CANONICAL_IDENTITY");
  if (rate(input.home) === null) limitations.push("MISSING_HOME_GOAL_RATES");
  if (rate(input.away) === null) limitations.push("MISSING_AWAY_GOAL_RATES");
  for (const [side, projection] of [["HOME", input.home], ["AWAY", input.away]] as const) {
    if (projection.resolvedAsOfUtc !== input.cutoff || projection.cutoffBoundary.observedAt !== input.cutoff) limitations.push(`${side}_CUTOFF_MISMATCH`);
    if (projection.state !== "COMPLETE") limitations.push(`${side}_EVIDENCE_${projection.state}`);
    if (projection.freshness !== "FRESH") limitations.push(`${side}_EVIDENCE_${projection.freshness}`);
    if (!projection.buildId) limitations.push(`MISSING_${side}_BUILD_ID`);
  }
  const homeMultiplier = clamp(1 + adjustment(input.home, input.away, "home"), CONFIG.multiplierBounds);
  const awayMultiplier = clamp(1 + adjustment(input.away, input.home, "away"), CONFIG.multiplierBounds);
  const expectedGoals = { home: clamp(CONFIG.baselineGoals.home * homeMultiplier, CONFIG.lambdaBounds), away: clamp(CONFIG.baselineGoals.away * awayMultiplier, CONFIG.lambdaBounds) };
  const raw: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) raw.push({ homeGoals, awayGoals, probability: poisson(homeGoals, expectedGoals.home) * poisson(awayGoals, expectedGoals.away) });
  const retainedMass = raw.reduce((sum, cell) => sum + cell.probability, 0);
  const scoreMatrix = raw.map((cell) => ({ ...cell, probability: cell.probability / retainedMass }));
  const probability = (predicate: (cell: (typeof scoreMatrix)[number]) => boolean) => scoreMatrix.filter(predicate).reduce((sum, cell) => sum + cell.probability, 0);
  const home = probability((cell) => cell.homeGoals > cell.awayGoals);
  const draw = probability((cell) => cell.homeGoals === cell.awayGoals);
  const over = probability((cell) => cell.homeGoals + cell.awayGoals > 2);
  const yes = probability((cell) => cell.homeGoals > 0 && cell.awayGoals > 0);
  const components = {
    completeness: limitations.filter((reason) => reason.includes("MISSING") || reason.includes("EVIDENCE_")).length === 0 ? 1 : 0,
    lineupAvailability: input.lineupAvailable ? 1 : 0,
    freshness: input.home.freshness === "FRESH" && input.away.freshness === "FRESH" ? 1 : 0,
    sourceReliability: input.sourceReliability,
    modelStability: 1,
  };
  const confidenceScore = components.completeness * 0.3 + components.lineupAvailability * 0.1 + components.freshness * 0.25 + components.sourceReliability * 0.2 + components.modelStability * 0.15;
  const sources = [...(input.home.receipt?.inputs ?? []), ...(input.away.receipt?.inputs ?? [])].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const evidenceBuildIds = [input.home.buildId, input.away.buildId].filter((value): value is string => value !== null).sort();
  return {
    fixtureId: input.fixtureId, forecastSnapshotId: input.forecastSnapshotId, cutoff: input.cutoff,
    modelVersion: "poisson-ensemble-v1", configVersion: "forecast-config-v1", configHash: hash(CONFIG), inputHash: hash({ ...input, sources }), evidenceBuildIds,
    expectedGoals, scoreMatrix, retainedMass, tailMass: Math.max(0, 1 - retainedMass), tailWarning: 1 - retainedMass > CONFIG.tailWarningThreshold,
    markets: { ONE_X_TWO: [event("HOME", home), event("DRAW", draw), event("AWAY", 1 - home - draw)], OVER_UNDER_2_5: [event("OVER_2_5", over), event("UNDER_2_5", 1 - over)], BTTS: [event("YES", yes), event("NO", 1 - yes)] },
    confidence: { version: "confidence-v1", score: confidenceScore, components }, limitations, sources,
    assumptions: ["independent Poisson goal counts", "0..7 score grid normalized by retained mass", "starting policy pending Phase 4 calibration"],
  };
}
