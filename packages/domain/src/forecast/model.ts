import { createHash } from "node:crypto";
import type { EvidenceProjectionDto, EvidenceSourceRef } from "../evidence/contract.js";
import { calculateConfidence } from "./confidence.js";
import { fairOddsForProbability, FORECAST_CONFIG } from "./config.js";

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
  readonly normalizationVersion: "retained-mass-v1";
  readonly rawMarginals: Readonly<Record<ForecastMarket, readonly ForecastEvent[]>>;
  readonly markets: Readonly<Record<ForecastMarket, readonly ForecastEvent[]>>;
  readonly adjustments: Readonly<Record<"home" | "away", AdjustmentReceipt>>;
  readonly confidence: Readonly<{ version: "confidence-v1"; score: number; components: Readonly<Record<"completeness" | "lineupAvailability" | "freshness" | "sourceReliability" | "modelStability", number>> }>;
  readonly limitations: readonly string[];
  readonly sources: readonly EvidenceSourceRef[];
  readonly assumptions: readonly string[];
}

type AdjustmentKind = "goalRates" | "elo" | "form" | "venue" | "rest" | "h2h";
interface AdjustmentComponent { readonly signal: number; readonly weight: number; readonly applied: number; readonly bounds: readonly [number, number] }
interface AdjustmentReceipt { readonly multiplier: number; readonly components: Readonly<Record<AdjustmentKind, AdjustmentComponent>> }

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

function adjustment(team: EvidenceProjectionDto, opponent: EvidenceProjectionDto, venue: "home" | "away"): AdjustmentReceipt {
  const teamRate = rate(team);
  const opponentRate = rate(opponent);
  const goalSignal = teamRate && opponentRate ? ((teamRate.for + opponentRate.against) / 2 - 1.35) / 1.35 : 0;
  const eloSignal = ((numeric(team, "elo") ?? 1500) - (numeric(opponent, "elo") ?? 1500)) / 400;
  const formSignal = ((numeric(team, "form5") ?? 1.5) - 1.5) / 1.5;
  const venueKind = venue === "home" ? "homeStrength" : "awayStrength";
  const venueSignal = ((numeric(team, venueKind) ?? 1.5) - 1.5) / 1.5;
  const restSignal = ((numeric(team, "restDays") ?? 5) - (numeric(opponent, "restDays") ?? 5)) / 7;
  const h2hSignal = ((h2h(team) ?? 1.5) - 1.5) / 1.5;
  const entry = (signal: number, weight: number, bounds: readonly [number, number]): AdjustmentComponent => ({ signal, weight, applied: clamp(signal * weight, bounds), bounds });
  const components = {
    goalRates: entry(goalSignal, FORECAST_CONFIG.coefficients.goalRates, FORECAST_CONFIG.transformBounds),
    elo: entry(eloSignal, FORECAST_CONFIG.coefficients.elo, FORECAST_CONFIG.transformBounds),
    form: entry(formSignal, FORECAST_CONFIG.coefficients.form, FORECAST_CONFIG.transformBounds),
    venue: entry(venueSignal, FORECAST_CONFIG.coefficients.venue, FORECAST_CONFIG.transformBounds),
    rest: entry(restSignal, FORECAST_CONFIG.coefficients.rest, FORECAST_CONFIG.transformBounds),
    h2h: entry(h2hSignal, FORECAST_CONFIG.coefficients.h2h, FORECAST_CONFIG.h2hBounds),
  };
  const total = Object.values(components).reduce((sum, component) => sum + component.applied, 0);
  return { multiplier: clamp(1 + total, FORECAST_CONFIG.multiplierBounds), components };
}

function poisson(goals: number, lambda: number): number {
  let factorial = 1;
  for (let current = 2; current <= goals; current += 1) factorial *= current;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

function event(selection: ForecastSelection, probability: number): ForecastEvent {
  return { selection, probability, fairOdds: fairOddsForProbability(probability) };
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
    const required = [
      ["goalRates", FORECAST_CONFIG.minimumSamples.goalRates], ["elo", FORECAST_CONFIG.minimumSamples.elo],
      ["form5", FORECAST_CONFIG.minimumSamples.form5], [side === "HOME" ? "homeStrength" : "awayStrength", FORECAST_CONFIG.minimumSamples.venue],
      ["restDays", FORECAST_CONFIG.minimumSamples.restDays],
    ] as const;
    for (const [kind, minimum] of required) {
      const component = projection.components[kind];
      if (!component || component.value === null) {
        const reason = `MISSING_${side}_${kind.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
        if (!limitations.includes(reason)) limitations.push(reason);
      } else if (component.sampleSize < minimum) limitations.push(`WEAK_${side}_${kind.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`);
    }
  }
  const homeAdjustment = adjustment(input.home, input.away, "home");
  const awayAdjustment = adjustment(input.away, input.home, "away");
  const homeMultiplier = homeAdjustment.multiplier;
  const awayMultiplier = awayAdjustment.multiplier;
  const expectedGoals = { home: clamp(FORECAST_CONFIG.baselineGoals.home * homeMultiplier, FORECAST_CONFIG.lambdaBounds), away: clamp(FORECAST_CONFIG.baselineGoals.away * awayMultiplier, FORECAST_CONFIG.lambdaBounds) };
  const raw: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) raw.push({ homeGoals, awayGoals, probability: poisson(homeGoals, expectedGoals.home) * poisson(awayGoals, expectedGoals.away) });
  const retainedMass = raw.reduce((sum, cell) => sum + cell.probability, 0);
  const scoreMatrix = raw.map((cell) => ({ ...cell, probability: cell.probability / retainedMass }));
  const sumWhere = (matrix: typeof scoreMatrix | typeof raw, predicate: (cell: (typeof scoreMatrix)[number]) => boolean) => matrix.filter(predicate).reduce((sum, cell) => sum + cell.probability, 0);
  const probability = (predicate: (cell: (typeof scoreMatrix)[number]) => boolean) => sumWhere(scoreMatrix, predicate);
  const home = probability((cell) => cell.homeGoals > cell.awayGoals);
  const draw = probability((cell) => cell.homeGoals === cell.awayGoals);
  const over = probability((cell) => cell.homeGoals + cell.awayGoals > 2);
  const yes = probability((cell) => cell.homeGoals > 0 && cell.awayGoals > 0);
  const rawHome = sumWhere(raw, (cell) => cell.homeGoals > cell.awayGoals);
  const rawDraw = sumWhere(raw, (cell) => cell.homeGoals === cell.awayGoals);
  const rawOver = sumWhere(raw, (cell) => cell.homeGoals + cell.awayGoals > 2);
  const rawYes = sumWhere(raw, (cell) => cell.homeGoals > 0 && cell.awayGoals > 0);
  const rawMarginals = {
    ONE_X_TWO: [event("HOME", rawHome), event("DRAW", rawDraw), event("AWAY", retainedMass - rawHome - rawDraw)],
    OVER_UNDER_2_5: [event("OVER_2_5", rawOver), event("UNDER_2_5", retainedMass - rawOver)],
    BTTS: [event("YES", rawYes), event("NO", retainedMass - rawYes)],
  } as const;
  const components = {
    completeness: limitations.filter((reason) => reason.includes("MISSING") || reason.includes("EVIDENCE_")).length === 0 ? 1 : 0,
    lineupAvailability: input.lineupAvailable ? 1 : 0,
    freshness: input.home.freshness === "FRESH" && input.away.freshness === "FRESH" ? 1 : 0,
    sourceReliability: input.sourceReliability,
    modelStability: 1,
  };
  const confidence = calculateConfidence(components);
  const sources = [...(input.home.receipt?.inputs ?? []), ...(input.away.receipt?.inputs ?? [])].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const evidenceBuildIds = [input.home.buildId, input.away.buildId].filter((value): value is string => value !== null).sort();
  const canonicalInput = { fixtureId: input.fixtureId, forecastSnapshotId: input.forecastSnapshotId, cutoff: input.cutoff, canonicalIdentityState: input.canonicalIdentityState, lineupAvailable: input.lineupAvailable, sourceReliability: input.sourceReliability, evidenceBuildIds, sources };
  return {
    fixtureId: input.fixtureId, forecastSnapshotId: input.forecastSnapshotId, cutoff: input.cutoff,
    modelVersion: "poisson-ensemble-v1", configVersion: "forecast-config-v1", configHash: hash(FORECAST_CONFIG), inputHash: hash(canonicalInput), evidenceBuildIds,
    expectedGoals, scoreMatrix, retainedMass, tailMass: Math.max(0, 1 - retainedMass), tailWarning: 1 - retainedMass > FORECAST_CONFIG.tailWarningThreshold,
    normalizationVersion: "retained-mass-v1", rawMarginals, adjustments: { home: homeAdjustment, away: awayAdjustment },
    markets: { ONE_X_TWO: [event("HOME", home), event("DRAW", draw), event("AWAY", 1 - home - draw)], OVER_UNDER_2_5: [event("OVER_2_5", over), event("UNDER_2_5", 1 - over)], BTTS: [event("YES", yes), event("NO", 1 - yes)] },
    confidence, limitations, sources,
    assumptions: ["independent Poisson goal counts", "0..7 score grid normalized by retained mass", "starting policy pending Phase 4 calibration"],
  };
}
