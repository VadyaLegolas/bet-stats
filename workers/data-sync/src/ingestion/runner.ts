export type IngestionLane = "critical" | "standard" | "optional";

export type GateDenialReason =
  | "CAPABILITY_DENIED"
  | "CIRCUIT_OPEN"
  | "ALLOWANCE_EXHAUSTED"
  | "UNKNOWN_RESET_SEMANTICS"
  | "CRITICAL_HEADROOM";

export interface ReservationDecision {
  reserved: boolean;
  reused?: boolean;
  reason?: GateDenialReason;
}

export interface GatedIngestionInput<TProvider, TValue> {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  lane: IngestionLane;
  allowance: number;
  resetTimezone?: string | null | undefined;
  alreadyAuthorized?: boolean | undefined;
  jobKey: string;
  cache?: { hit: boolean; value?: TValue | undefined } | undefined;
  reserve: (request: {
    provider: string;
    endpoint: string;
    lane: IngestionLane;
    allowance: number;
    jobKey: string;
  }) => Promise<ReservationDecision>;
  providerFactory: () => TProvider;
  callProvider: (provider: TProvider) => Promise<TValue | { data: TValue; quota?: unknown }>;
  observeQuota?: ((quota: unknown) => void | Promise<void>) | undefined;
  persist?: ((value: TValue) => Promise<void>) | undefined;
}

export type GatedIngestionResult<TValue> =
  | { status: "denied"; reason: GateDenialReason }
  | { status: "cached"; value: TValue | undefined }
  | { status: "completed"; value: TValue; reservationReused: boolean };

export async function runGatedIngestion<TProvider, TValue>(
  input: GatedIngestionInput<TProvider, TValue>,
): Promise<GatedIngestionResult<TValue>> {
  if (input.capability !== "SUPPORTED") return { status: "denied", reason: "CAPABILITY_DENIED" };
  if (input.circuit === "OPEN") return { status: "denied", reason: "CIRCUIT_OPEN" };
  if (!Number.isSafeInteger(input.allowance) || input.allowance <= 0) {
    return { status: "denied", reason: "ALLOWANCE_EXHAUSTED" };
  }
  if (input.resetTimezone == null && !(input.lane === "critical" && input.alreadyAuthorized === true)) {
    return { status: "denied", reason: "UNKNOWN_RESET_SEMANTICS" };
  }
  if (input.cache?.hit) return { status: "cached", value: input.cache.value };

  const reservation = await input.reserve({
    provider: input.provider,
    endpoint: input.endpoint,
    lane: input.lane,
    allowance: input.allowance,
    jobKey: input.jobKey,
  });
  if (!reservation.reserved) {
    return { status: "denied", reason: reservation.reason ?? "ALLOWANCE_EXHAUSTED" };
  }

  const response = await input.callProvider(input.providerFactory());
  const wrapped = isWrappedResponse<TValue>(response);
  const value = wrapped ? response.data : response;
  if (wrapped && response.quota !== undefined) await input.observeQuota?.(response.quota);
  await input.persist?.(value);
  return { status: "completed", value, reservationReused: reservation.reused === true };
}

function isWrappedResponse<TValue>(value: TValue | { data: TValue; quota?: unknown }): value is { data: TValue; quota?: unknown } {
  return typeof value === "object" && value !== null && "data" in value;
}
