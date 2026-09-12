import type { ForecastDraft, ForecastEvent, ForecastMarket } from "./model.js";

export const FORECAST_KINDS = ["INITIAL", "PRE_MATCH", "LINEUP_CONFIRMED"] as const;
export type ForecastKind = (typeof FORECAST_KINDS)[number];

export interface ForecastRequestDto {
  readonly fixtureId: string;
  readonly kind: ForecastKind;
  readonly cutoff: string;
}

export interface ForecastReceiptDto {
  readonly forecastSnapshotId: string;
  readonly officialLineupObservationId: string | null;
  readonly evidenceBuildIds: readonly string[];
  readonly sourceRefs: ForecastDraft["sources"];
  readonly expectedGoals: ForecastDraft["expectedGoals"];
  readonly adjustments: ForecastDraft["adjustments"];
}

export interface ForecastResponseDto {
  readonly id: string;
  readonly fixtureId: string;
  readonly kind: ForecastKind;
  readonly officialLineupObservationId: string | null;
  readonly revision: number;
  readonly cutoff: string;
  readonly modelVersion: ForecastDraft["modelVersion"];
  readonly modelHash: string;
  readonly configVersion: ForecastDraft["configVersion"];
  readonly configHash: string;
  readonly inputHash: string;
  readonly evidenceFingerprint: string;
  readonly evidenceBuildIds: readonly string[];
  readonly probabilities: ForecastDraft["markets"];
  readonly confidence: ForecastDraft["confidence"];
  readonly limitations: readonly string[];
  readonly tail: Readonly<{
    retainedMass: number;
    tailMass: number;
    warning: boolean;
    normalizationVersion: ForecastDraft["normalizationVersion"];
  }>;
  readonly assumptions: readonly string[];
  readonly receipt: ForecastReceiptDto;
  readonly issuedAt: string;
}

export interface ForecastAvailabilityReceiptDto {
  readonly id: string;
  readonly revision: number;
  readonly cutoff: string;
  readonly sourceCount: number;
  readonly officialLineupObservationId: string | null;
}

export type ForecastAvailabilityEntryDto =
  | { readonly kind: ForecastKind; readonly status: "available"; readonly snapshot: ForecastAvailabilityReceiptDto }
  | { readonly kind: ForecastKind; readonly status: "absent"; readonly reason: "NO_CONFIRMED_LINEUP" | "CAPABILITY_DENIED" | "BUDGET_PROTECTED" | "PROVIDER_UNAVAILABLE" | "INSUFFICIENT_EVIDENCE" };

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) throw new Error(code);
}

function nonEmptyString(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
}

function instant(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !UTC_INSTANT.test(value) || new Date(value).toISOString() !== value) throw new Error(code);
}

function kind(value: unknown): asserts value is ForecastKind {
  if (!FORECAST_KINDS.includes(value as ForecastKind)) throw new Error("INVALID_FORECAST_KIND");
}

export function parseForecastRequest(value: unknown): ForecastRequestDto {
  const dto = record(value, "INVALID_FORECAST_REQUEST");
  exactKeys(dto, ["fixtureId", "kind", "cutoff"], "UNKNOWN_FORECAST_REQUEST_KEY");
  nonEmptyString(dto.fixtureId, "INVALID_FIXTURE_ID");
  kind(dto.kind);
  instant(dto.cutoff, "INVALID_FORECAST_CUTOFF");
  return dto as unknown as ForecastRequestDto;
}

const MARKET_SELECTIONS: Readonly<Record<ForecastMarket, readonly string[]>> = {
  ONE_X_TWO: ["HOME", "DRAW", "AWAY"],
  OVER_UNDER_2_5: ["OVER_2_5", "UNDER_2_5"],
  BTTS: ["YES", "NO"],
};

function probabilities(value: unknown): asserts value is ForecastDraft["markets"] {
  const markets = record(value, "INVALID_FORECAST_PROBABILITY");
  exactKeys(markets, Object.keys(MARKET_SELECTIONS), "INVALID_FORECAST_PROBABILITY");
  for (const [market, selections] of Object.entries(MARKET_SELECTIONS)) {
    const events = markets[market];
    if (!Array.isArray(events) || events.length !== selections.length) throw new Error("INVALID_FORECAST_PROBABILITY");
    for (const [index, raw] of events.entries()) {
      const event = record(raw, "INVALID_FORECAST_PROBABILITY");
      exactKeys(event, ["selection", "probability", "fairOdds"], "INVALID_FORECAST_PROBABILITY");
      if (event.selection !== selections[index] || typeof event.probability !== "number" || !Number.isFinite(event.probability) || event.probability < 0 || event.probability > 1) throw new Error("INVALID_FORECAST_PROBABILITY");
      if (event.fairOdds !== null && (typeof event.fairOdds !== "string" || event.fairOdds.length === 0)) throw new Error("INVALID_FORECAST_PROBABILITY");
    }
    const total = (events as ForecastEvent[]).reduce((sum, event) => sum + event.probability, 0);
    if (Math.abs(total - 1) > 1e-12) throw new Error("INVALID_FORECAST_PROBABILITY");
  }
}

function confidence(value: unknown): asserts value is ForecastDraft["confidence"] {
  const dto = record(value, "INVALID_FORECAST_CONFIDENCE");
  exactKeys(dto, ["version", "score", "components"], "INVALID_FORECAST_CONFIDENCE");
  if (dto.version !== "confidence-v1" || typeof dto.score !== "number" || !Number.isFinite(dto.score) || dto.score < 0 || dto.score > 1) throw new Error("INVALID_FORECAST_CONFIDENCE");
  const components = record(dto.components, "INVALID_FORECAST_CONFIDENCE");
  exactKeys(components, ["completeness", "lineupAvailability", "freshness", "sourceReliability", "modelStability"], "INVALID_FORECAST_CONFIDENCE");
  for (const component of Object.values(components)) if (typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1) throw new Error("INVALID_FORECAST_CONFIDENCE");
}

export function parseForecastResponse(value: unknown): ForecastResponseDto {
  const dto = record(value, "INVALID_FORECAST_RESPONSE");
  exactKeys(dto, ["id", "fixtureId", "kind", "officialLineupObservationId", "revision", "cutoff", "modelVersion", "modelHash", "configVersion", "configHash", "inputHash", "evidenceFingerprint", "evidenceBuildIds", "probabilities", "confidence", "limitations", "tail", "assumptions", "receipt", "issuedAt"], "UNKNOWN_FORECAST_RESPONSE_KEY");
  for (const key of ["id", "fixtureId", "modelHash", "configHash", "inputHash", "evidenceFingerprint"] as const) nonEmptyString(dto[key], "INVALID_FORECAST_RESPONSE");
  kind(dto.kind);
  if (dto.officialLineupObservationId !== null) nonEmptyString(dto.officialLineupObservationId, "INVALID_FORECAST_LINEUP_PROVENANCE");
  if ((dto.kind === "LINEUP_CONFIRMED") !== (dto.officialLineupObservationId !== null)) throw new Error("INVALID_FORECAST_LINEUP_PROVENANCE");
  instant(dto.cutoff, "INVALID_FORECAST_CUTOFF");
  instant(dto.issuedAt, "INVALID_FORECAST_ISSUED_AT");
  if (!Number.isInteger(dto.revision) || (dto.revision as number) < 1 || dto.modelVersion !== "poisson-ensemble-v1" || dto.configVersion !== "forecast-config-v1") throw new Error("INVALID_FORECAST_RESPONSE");
  if (!Array.isArray(dto.evidenceBuildIds) || dto.evidenceBuildIds.length !== 2 || dto.evidenceBuildIds.some((id) => typeof id !== "string" || id.length === 0)) throw new Error("INVALID_FORECAST_EVIDENCE");
  probabilities(dto.probabilities);
  confidence(dto.confidence);
  if (!Array.isArray(dto.limitations) || dto.limitations.some((item) => typeof item !== "string") || !Array.isArray(dto.assumptions) || dto.assumptions.some((item) => typeof item !== "string")) throw new Error("INVALID_FORECAST_RESPONSE");
  const tail = record(dto.tail, "INVALID_FORECAST_TAIL");
  exactKeys(tail, ["retainedMass", "tailMass", "warning", "normalizationVersion"], "INVALID_FORECAST_TAIL");
  if (typeof tail.retainedMass !== "number" || typeof tail.tailMass !== "number" || typeof tail.warning !== "boolean" || tail.normalizationVersion !== "retained-mass-v1") throw new Error("INVALID_FORECAST_TAIL");
  const receipt = record(dto.receipt, "INVALID_FORECAST_RECEIPT");
  exactKeys(receipt, ["forecastSnapshotId", "officialLineupObservationId", "evidenceBuildIds", "sourceRefs", "expectedGoals", "adjustments"], "INVALID_FORECAST_RECEIPT");
  if (receipt.forecastSnapshotId !== dto.id || receipt.officialLineupObservationId !== dto.officialLineupObservationId || JSON.stringify(receipt.evidenceBuildIds) !== JSON.stringify(dto.evidenceBuildIds) || !Array.isArray(receipt.sourceRefs)) throw new Error("INVALID_FORECAST_RECEIPT");
  return dto as unknown as ForecastResponseDto;
}
