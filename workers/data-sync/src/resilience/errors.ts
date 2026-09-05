export type ProviderErrorReason = "VALIDATION" | "IDENTITY" | "RATE_LIMIT" | "TIMEOUT" | "SERVER" | "UNKNOWN";

export interface ProviderErrorClassification {
  reason: ProviderErrorReason;
  retryable: boolean;
}

export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const kind = String(record.kind ?? "").toUpperCase();
  const status = typeof record.status === "number" ? record.status : typeof record.statusCode === "number" ? record.statusCode : undefined;
  if (kind === "VALIDATION") return { reason: "VALIDATION", retryable: false };
  if (kind === "IDENTITY") return { reason: "IDENTITY", retryable: false };
  if (kind === "TIMEOUT" || (error instanceof Error && error.name === "AbortError")) return { reason: "TIMEOUT", retryable: true };
  if (kind === "RATE_LIMIT" || status === 429) return { reason: "RATE_LIMIT", retryable: true };
  if (kind === "SERVER" || (status !== undefined && status >= 500)) return { reason: "SERVER", retryable: true };
  return { reason: "UNKNOWN", retryable: false };
}
