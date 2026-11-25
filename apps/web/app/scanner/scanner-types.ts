import type { OddsFreshness, ScannerItem as DomainScannerItem, ScannerResponse as DomainScannerResponse } from "@bet-stats/domain";

import type { ScannerFreshnessPolicyView } from "./scanner-labels";

/** Local aliases of the API contract (type-only import: nothing from the domain barrel reaches the page at runtime). */
export type ScannerItem = DomainScannerItem;
export type ScannerFreshness = OddsFreshness;
/** The policy hours are read from the payload; the page never assumes the constants of the API build. */
export type ScannerPayload = Omit<DomainScannerResponse, "freshnessPolicy"> & { readonly freshnessPolicy: ScannerFreshnessPolicyView };

type FieldKind = "string" | "nullable-string" | "integer" | "boolean" | "freshness";

/* Typed as Record over the contract keys: a field added to the API contract breaks the build until it is listed here. */
const RESPONSE_SCHEMA: Record<keyof DomainScannerResponse, "state" | "string" | "window" | "integer" | "boolean" | "policy" | "counts" | "items"> = {
  state: "state",
  generatedAt: "string",
  window: "window",
  limit: "integer",
  truncated: "boolean",
  freshnessPolicy: "policy",
  checkedCount: "integer",
  outcomeCounts: "counts",
  totalCandidates: "integer",
  allPolicyConfigMismatch: "boolean",
  items: "items",
};

const ITEM_SCHEMA: Record<keyof DomainScannerItem, FieldKind> = {
  receiptId: "string",
  fixtureId: "string",
  forecastSnapshotId: "string",
  oddsSnapshotId: "string",
  market: "string",
  selection: "string",
  kickoffAt: "string",
  homeTeam: "string",
  awayTeam: "string",
  competition: "string",
  oddsSource: "nullable-string",
  oddsSubmittedAt: "string",
  oddsCapturedAt: "nullable-string",
  oddsAgeSeconds: "integer",
  freshness: "freshness",
  forecastNewerAvailable: "boolean",
  edge: "nullable-string",
  expectedValue: "nullable-string",
  modelProbability: "nullable-string",
  noVigProbability: "nullable-string",
  fairOdds: "nullable-string",
  decimalOdds: "nullable-string",
  valuePolicyVersion: "nullable-string",
  edgeDefinition: "nullable-string",
  evPolicyVersion: "nullable-string",
};

const FRESHNESS_VALUES: readonly string[] = ["FRESH", "AGING", "STALE"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const isInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

function isValidItem(value: unknown): boolean {
  if (!isPlainObject(value) || !hasExactKeys(value, Object.keys(ITEM_SCHEMA))) return false;
  return (Object.entries(ITEM_SCHEMA) as [string, FieldKind][]).every(([key, kind]) => {
    const field = value[key];
    // Stored value fields are checked by type only: no numeric conversion of any stored string.
    if (kind === "string") return typeof field === "string";
    if (kind === "nullable-string") return field === null || typeof field === "string";
    if (kind === "integer") return isInteger(field);
    if (kind === "boolean") return typeof field === "boolean";
    return typeof field === "string" && FRESHNESS_VALUES.includes(field);
  });
}

function isValidField(kind: (typeof RESPONSE_SCHEMA)[keyof typeof RESPONSE_SCHEMA], field: unknown): boolean {
  switch (kind) {
    case "state": return field === "AVAILABLE" || field === "EMPTY";
    case "string": return typeof field === "string";
    case "integer": return isInteger(field);
    case "boolean": return typeof field === "boolean";
    case "window": return isPlainObject(field) && hasExactKeys(field, ["from", "to"]) && typeof field.from === "string" && typeof field.to === "string";
    case "policy": return isPlainObject(field) && hasExactKeys(field, ["version", "freshMaxHours", "agingMaxHours"]) && typeof field.version === "string" && typeof field.freshMaxHours === "number" && Number.isFinite(field.freshMaxHours) && typeof field.agingMaxHours === "number" && Number.isFinite(field.agingMaxHours);
    case "counts": return isPlainObject(field) && Object.values(field).every(isInteger);
    case "items": return Array.isArray(field) && field.every(isValidItem);
  }
}

/**
 * Fail-closed parser of the `GET /value/scanner` body: exact top-level keys, exact item keys, strict field types and a
 * state that agrees with the item list. Anything else is null, which the page renders as UNAVAILABLE.
 */
export function parseScannerResponse(input: unknown): ScannerPayload | null {
  if (!isPlainObject(input) || !hasExactKeys(input, Object.keys(RESPONSE_SCHEMA))) return null;
  for (const [key, kind] of Object.entries(RESPONSE_SCHEMA)) {
    if (!isValidField(kind, input[key])) return null;
  }
  const items = input.items as readonly unknown[];
  if (input.state === "AVAILABLE" ? items.length === 0 : items.length !== 0) return null;
  return input as unknown as ScannerPayload;
}
