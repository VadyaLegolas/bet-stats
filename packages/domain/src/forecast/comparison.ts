import { FORECAST_KINDS, parseForecastResponse, type ForecastAvailabilityEntryDto, type ForecastResponseDto } from "./contract.js";

export const FORECAST_ABSENCE_REASONS = ["NO_CONFIRMED_LINEUP", "CAPABILITY_DENIED", "BUDGET_PROTECTED", "PROVIDER_UNAVAILABLE", "INSUFFICIENT_EVIDENCE"] as const;
export type ForecastAbsenceReason = (typeof FORECAST_ABSENCE_REASONS)[number];
export type DeltaDirection = "increase" | "decrease" | "unchanged";

export interface ForecastComparisonRequestDto { readonly leftId: string; readonly rightId: string }
export interface NumericDelta { readonly left: number; readonly right: number; readonly delta: number; readonly direction: DeltaDirection }
export interface ForecastComparisonDto {
  readonly fixtureId: string;
  readonly left: ForecastResponseDto;
  readonly right: ForecastResponseDto;
  readonly cutoff: NumericDelta;
  readonly sources: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly expectedGoals: { readonly home: NumericDelta; readonly away: NumericDelta };
  readonly adjustments: { readonly home: NumericDelta; readonly away: NumericDelta };
  readonly confidence: { readonly score: NumericDelta; readonly components: Readonly<Record<string, NumericDelta>> };
  readonly limitations: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly probabilities: readonly (NumericDelta & { readonly market: string; readonly selection: string })[];
}

export function parseForecastComparisonRequest(value: unknown): ForecastComparisonRequestDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_FORECAST_COMPARISON");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !("leftId" in input) || !("rightId" in input)) throw new Error("UNKNOWN_FORECAST_COMPARISON_KEY");
  if (typeof input.leftId !== "string" || input.leftId.trim() === "" || typeof input.rightId !== "string" || input.rightId.trim() === "") throw new Error("INVALID_FORECAST_COMPARISON_ID");
  if (input.leftId === input.rightId) throw new Error("FORECAST_PAIR_MUST_DIFFER");
  return { leftId: input.leftId, rightId: input.rightId };
}

export function compareForecastPair(leftValue: unknown, rightValue: unknown): ForecastComparisonDto {
  const left = parseForecastResponse(leftValue);
  const right = parseForecastResponse(rightValue);
  if (left.fixtureId !== right.fixtureId) throw new Error("FORECAST_FIXTURE_MISMATCH");
  const sourceKeys = (forecast: ForecastResponseDto) => forecast.receipt.sourceRefs.map((source) => source.fixtureId).sort();
  const leftSources = sourceKeys(left), rightSources = sourceKeys(right);
  const components: Record<string, NumericDelta> = {};
  for (const key of ["completeness", "lineupAvailability", "freshness", "sourceReliability", "modelStability"] as const) components[key] = delta(left.confidence.components[key], right.confidence.components[key]);
  const probabilities = ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"].flatMap((market) => {
    const leftEvents = left.probabilities[market as keyof typeof left.probabilities];
    const rightEvents = right.probabilities[market as keyof typeof right.probabilities];
    return leftEvents.map((event, index) => ({ market, selection: event.selection, ...delta(event.probability, rightEvents[index]!.probability) }));
  });
  return {
    fixtureId: left.fixtureId, left, right,
    cutoff: delta(Date.parse(left.cutoff), Date.parse(right.cutoff)),
    sources: { added: difference(rightSources, leftSources), removed: difference(leftSources, rightSources) },
    expectedGoals: { home: delta(left.receipt.expectedGoals.home, right.receipt.expectedGoals.home), away: delta(left.receipt.expectedGoals.away, right.receipt.expectedGoals.away) },
    adjustments: { home: delta(left.receipt.adjustments.home.multiplier, right.receipt.adjustments.home.multiplier), away: delta(left.receipt.adjustments.away.multiplier, right.receipt.adjustments.away.multiplier) },
    confidence: { score: delta(left.confidence.score, right.confidence.score), components },
    limitations: { added: difference([...right.limitations].sort(), [...left.limitations].sort()), removed: difference([...left.limitations].sort(), [...right.limitations].sort()) },
    probabilities,
  };
}

export function projectForecastAvailability(snapshots: readonly ForecastResponseDto[], absence: Readonly<Record<(typeof FORECAST_KINDS)[number], ForecastAbsenceReason>>) {
  return FORECAST_KINDS.map((kind) => {
    const snapshot = snapshots.filter((item) => item.kind === kind).sort((a, b) => b.revision - a.revision || b.cutoff.localeCompare(a.cutoff) || a.id.localeCompare(b.id))[0];
    return snapshot ? { kind, status: "available" as const, snapshot: { id: snapshot.id, revision: snapshot.revision, cutoff: snapshot.cutoff, sourceCount: snapshot.receipt.sourceRefs.length, officialLineupObservationId: snapshot.officialLineupObservationId } } : { kind, status: "absent" as const, reason: absence[kind] };
  });
}

export function parseForecastAvailability(value: unknown): readonly ForecastAvailabilityEntryDto[] {
  if (!Array.isArray(value) || value.length !== FORECAST_KINDS.length) throw new Error("INVALID_FORECAST_AVAILABILITY");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_FORECAST_AVAILABILITY");
    const entry = raw as Record<string, unknown>;
    if (entry.kind !== FORECAST_KINDS[index]) throw new Error("INVALID_FORECAST_AVAILABILITY_ORDER");
    const keys = Object.keys(entry).sort();
    if (entry.status === "absent") {
      if (keys.join(",") !== "kind,reason,status") throw new Error("UNKNOWN_FORECAST_AVAILABILITY_KEY");
      if (!FORECAST_ABSENCE_REASONS.includes(entry.reason as ForecastAbsenceReason)) throw new Error("INVALID_FORECAST_ABSENCE_REASON");
    } else if (entry.status === "available") {
      if (keys.join(",") !== "kind,snapshot,status") throw new Error("UNKNOWN_FORECAST_AVAILABILITY_KEY");
      const snapshot = entry.snapshot as Record<string, unknown> | null;
      if (!snapshot || Object.keys(snapshot).sort().join(",") !== "cutoff,id,officialLineupObservationId,revision,sourceCount" || typeof snapshot.id !== "string" || !Number.isInteger(snapshot.revision) || !Number.isInteger(snapshot.sourceCount) || typeof snapshot.cutoff !== "string") throw new Error("INVALID_FORECAST_AVAILABILITY_RECEIPT");
    } else throw new Error("INVALID_FORECAST_AVAILABILITY_STATUS");
    return entry as unknown as ForecastAvailabilityEntryDto;
  });
}

function delta(left: number, right: number): NumericDelta {
  const change = rounded(right - left);
  return { left, right, delta: change, direction: change > 0 ? "increase" : change < 0 ? "decrease" : "unchanged" };
}
function rounded(value: number): number { return Number(value.toFixed(12)); }
function difference(left: readonly string[], right: readonly string[]): string[] { const excluded = new Set(right); return left.filter((item) => !excluded.has(item)); }
