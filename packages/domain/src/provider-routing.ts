import { createHash } from "node:crypto";

export const PROVIDER_ROUTE_POLICY_VERSION = "provider-route-policy/v1" as const;
export const providerRouteTriggers = ["PRIMARY", "UNSUPPORTED_COVERAGE", "ALLOWANCE_EXHAUSTED", "CIRCUIT_OPEN", "TRANSPORT_FAILURE", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"] as const;
export const providerRouteOutcomes = ["ADMITTED", "DENIED", "NO_FALLBACK", "SUCCEEDED", "FAILED", "QUARANTINED"] as const;
export type ProviderRouteTrigger = (typeof providerRouteTriggers)[number];
export type ProviderRouteOutcome = (typeof providerRouteOutcomes)[number];

export interface ProviderRouteReceiptContent {
  policyVersion: string;
  policyHash: string;
  competitionId: string;
  seasonId: string;
  endpointFamily: string;
  candidates: readonly string[];
  selectedProvider: string | null;
  trigger: ProviderRouteTrigger;
  outcome: ProviderRouteOutcome;
  capabilitySnapshot: Readonly<Record<string, unknown>>;
  budgetSnapshot: Readonly<Record<string, unknown>>;
  circuitSnapshot: Readonly<Record<string, unknown>>;
  correlationId: string;
}

export function routeReceiptContentHash(receipt: ProviderRouteReceiptContent): string {
  assertRouteReceipt(receipt);
  return `sha256:${createHash("sha256").update(stableJson(receipt)).digest("hex")}`;
}

export function assertRouteReceipt(receipt: ProviderRouteReceiptContent): void {
  if (receipt.policyVersion.length === 0 || receipt.policyHash.length === 0 || receipt.competitionId.length === 0 || receipt.seasonId.length === 0 || receipt.endpointFamily.length === 0 || receipt.correlationId.length === 0) throw new Error("INVALID_ROUTE_RECEIPT");
  if (!providerRouteTriggers.includes(receipt.trigger) || !providerRouteOutcomes.includes(receipt.outcome)) throw new Error("INVALID_ROUTE_RECEIPT");
  if (receipt.candidates.length === 0 || new Set(receipt.candidates).size !== receipt.candidates.length || receipt.candidates.some((value) => value.length === 0)) throw new Error("INVALID_ROUTE_CANDIDATES");
  if (receipt.selectedProvider !== null && !receipt.candidates.includes(receipt.selectedProvider)) throw new Error("SELECTED_PROVIDER_NOT_CANDIDATE");
  if ((receipt.outcome === "NO_FALLBACK" || receipt.outcome === "DENIED") && receipt.selectedProvider !== null) throw new Error("DENIED_ROUTE_HAS_PROVIDER");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
