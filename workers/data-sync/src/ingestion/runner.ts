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

export interface CircuitProbeRegistry {
  state(provider: string, endpointFamily: string): "CLOSED" | "OPEN" | "HALF_OPEN" | Promise<"CLOSED" | "OPEN" | "HALF_OPEN">;
  acquireProbe(provider: string, endpointFamily: string): boolean | Promise<boolean>;
  releaseProbe(provider: string, endpointFamily: string): void | Promise<void>;
}

export interface GatedIngestionInput<TProvider, TValue> {
  provider: string;
  endpoint: string;
  capability: "SUPPORTED" | "UNKNOWN" | "UNSUPPORTED";
  circuit: "CLOSED" | "OPEN" | "HALF_OPEN";
  circuitRegistry?: CircuitProbeRegistry | undefined;
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
  admitRequest?: (() => Promise<void>) | undefined;
  beforeDispatch?: (() => Promise<void>) | undefined;
  providerFactory: () => TProvider;
  callProvider: (provider: TProvider) => Promise<TValue | { data: TValue; quota?: unknown }>;
  observeQuota?: ((quota: unknown) => void | Promise<void>) | undefined;
  persist?: ((value: TValue) => Promise<void>) | undefined;
  publish?: ((value: TValue) => Promise<void>) | undefined;
  complete?: (() => Promise<void>) | undefined;
}

export type GatedIngestionResult<TValue> =
  | { status: "denied"; reason: GateDenialReason }
  | { status: "cached"; value: TValue | undefined }
  | { status: "completed"; value: TValue; reservationReused: boolean };

export interface RouteExecutionCandidate<TProvider> {
  readonly provider: string;
  readonly factory: () => TProvider;
}

export type RouteExecutionResult<TValue> =
  | { status: "completed"; provider: string; value: TValue }
  | { status: "limited"; reason: "NO_FALLBACK"; lastValidAt: string | null; lastValidValue: TValue | null };

/** Persists selection and each classified attempt before provider I/O; fallback is bounded by the closed candidate list. */
export async function runProviderRoute<TProvider, TValue>(input: {
  candidates: readonly RouteExecutionCandidate<TProvider>[];
  persistRoute: () => Promise<void>;
  persistAttempt: (attempt: { provider: string; ordinal: number; trigger: string }) => Promise<void>;
  call: (provider: TProvider) => Promise<TValue>;
  classifyFailure: (error: unknown) => { eligible: boolean; trigger?: string };
  lastValid?: { at: string; value: TValue } | null;
}): Promise<RouteExecutionResult<TValue>> {
  if (input.candidates.length === 0 || input.candidates.length > 2) throw new Error("INVALID_PROVIDER_CANDIDATE_LIST");
  await input.persistRoute();
  for (let ordinal = 0; ordinal < input.candidates.length; ordinal += 1) {
    const candidate = input.candidates[ordinal]!;
    const trigger = ordinal === 0 ? "PRIMARY" : "ELIGIBLE_FALLBACK";
    await input.persistAttempt({ provider: candidate.provider, ordinal, trigger });
    try {
      return { status: "completed", provider: candidate.provider, value: await input.call(candidate.factory()) };
    } catch (error) {
      const failure = input.classifyFailure(error);
      if (!failure.eligible || ordinal + 1 >= input.candidates.length) {
        return { status: "limited", reason: "NO_FALLBACK", lastValidAt: input.lastValid?.at ?? null, lastValidValue: input.lastValid?.value ?? null };
      }
    }
  }
  return { status: "limited", reason: "NO_FALLBACK", lastValidAt: input.lastValid?.at ?? null, lastValidValue: input.lastValid?.value ?? null };
}

export async function runGatedIngestion<TProvider, TValue>(
  input: GatedIngestionInput<TProvider, TValue>,
): Promise<GatedIngestionResult<TValue>> {
  if (input.capability !== "SUPPORTED") return { status: "denied", reason: "CAPABILITY_DENIED" };
  const circuitState = input.circuitRegistry
    ? await input.circuitRegistry.state(input.provider, input.endpoint)
    : input.circuit;
  if (circuitState === "OPEN") return { status: "denied", reason: "CIRCUIT_OPEN" };
  if (circuitState === "HALF_OPEN" && !input.circuitRegistry) {
    return { status: "denied", reason: "CIRCUIT_OPEN" };
  }
  const probeOwned = circuitState === "HALF_OPEN" && await input.circuitRegistry!.acquireProbe(input.provider, input.endpoint);
  if (circuitState === "HALF_OPEN" && !probeOwned) return { status: "denied", reason: "CIRCUIT_OPEN" };

  try {
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

    await input.admitRequest?.();
    await input.beforeDispatch?.();
    const response = await input.callProvider(input.providerFactory());
    const wrapped = isWrappedResponse<TValue>(response);
    const value = wrapped ? response.data : response;
    if (wrapped && response.quota !== undefined) await input.observeQuota?.(response.quota);
    if (input.publish) await input.publish(value);
    else await input.persist?.(value);
    await input.complete?.();
    return { status: "completed", value, reservationReused: reservation.reused === true };
  } finally {
    if (probeOwned) await input.circuitRegistry!.releaseProbe(input.provider, input.endpoint);
  }
}

export interface CompletionManifest {
  readonly expectedUnits: readonly string[];
  readonly completedUnits: readonly string[];
  readonly expectedCaptures: readonly string[];
  readonly completedCaptures: readonly string[];
}

export interface SyncRunCompletionTransaction {
  lockSyncRun(syncRunId: string): Promise<{ state: string; completionManifest: unknown } | null>;
  updateSyncRun(syncRunId: string, update: {
    expectedUnits: number;
    completedUnits: number;
    expectedCaptures: number;
    completedCaptures: number;
    completionManifest: CompletionManifest;
    state: "RUNNING" | "SUCCEEDED";
  }): Promise<void>;
}

export function createCompletionManifest(expectedUnits: readonly string[], expectedCaptures: readonly string[]): CompletionManifest {
  return {
    expectedUnits: uniqueNonEmpty(expectedUnits, "unit"),
    completedUnits: [],
    expectedCaptures: uniqueNonEmpty(expectedCaptures, "capture"),
    completedCaptures: [],
  };
}

export async function recordSyncRunCompletion(
  transaction: SyncRunCompletionTransaction,
  syncRunId: string,
  unitId: string,
  captureIds: readonly string[],
): Promise<CompletionManifest> {
  const run = await transaction.lockSyncRun(syncRunId);
  if (!run) throw new Error("SyncRun completion target was not found");
  if (run.state === "FAILED" || run.state === "CANCELLED") throw new Error(`Cannot complete ${run.state} SyncRun`);
  const manifest = parseCompletionManifest(run.completionManifest);
  if (!manifest.expectedUnits.includes(unitId)) throw new Error("Completion unit was not declared");
  const captures = uniqueNonEmpty(captureIds, "capture");
  if (captures.some((capture) => !manifest.expectedCaptures.includes(capture))) {
    throw new Error("Completion capture was not declared");
  }
  const completedUnits = [...new Set([...manifest.completedUnits, unitId])];
  const completedCaptures = [...new Set([...manifest.completedCaptures, ...captures])];
  const completed = completedUnits.length === manifest.expectedUnits.length && completedCaptures.length === manifest.expectedCaptures.length;
  const next = { ...manifest, completedUnits, completedCaptures };
  await transaction.updateSyncRun(syncRunId, {
    expectedUnits: manifest.expectedUnits.length,
    completedUnits: completedUnits.length,
    expectedCaptures: manifest.expectedCaptures.length,
    completedCaptures: completedCaptures.length,
    completionManifest: next,
    state: completed ? "SUCCEEDED" : "RUNNING",
  });
  return next;
}

function parseCompletionManifest(value: unknown): CompletionManifest {
  if (typeof value !== "object" || value === null) throw new Error("SyncRun completion manifest is invalid");
  const candidate = value as Partial<Record<keyof CompletionManifest, unknown>>;
  return {
    expectedUnits: stringArray(candidate.expectedUnits),
    completedUnits: stringArray(candidate.completedUnits),
    expectedCaptures: stringArray(candidate.expectedCaptures),
    completedCaptures: stringArray(candidate.completedCaptures),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("SyncRun completion manifest is invalid");
  }
  return [...new Set(value)];
}

function uniqueNonEmpty(values: readonly string[], label: string): string[] {
  if (values.some((value) => value.length === 0)) throw new Error(`Expected ${label} identity cannot be empty`);
  return [...new Set(values)];
}

function isWrappedResponse<TValue>(value: TValue | { data: TValue; quota?: unknown }): value is { data: TValue; quota?: unknown } {
  return typeof value === "object" && value !== null && "data" in value;
}
