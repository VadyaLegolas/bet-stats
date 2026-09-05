export const DATA_STATES = [
  "AVAILABLE",
  "LIMITED",
  "STALE",
  "UNSUPPORTED",
  "UNRESOLVED",
] as const;

export type DataState = (typeof DATA_STATES)[number];

export interface DataStateMetadata {
  reason: string;
  provider: string;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  freshnessThresholdMs: number;
}

export type DataStateProjection<T> = {
  [State in DataState]: DataStateMetadata & {
    state: State;
    value: T | null;
  };
}[DataState];

export interface DataStateProjectionInput<T> extends DataStateMetadata {
  state: unknown;
  value: T | null;
}

export interface UnknownDataStateTelemetry {
  event: "unknown_data_state";
  receivedType: string;
}

export type DataStateTelemetry = (event: UnknownDataStateTelemetry) => void;

export type FreshnessProjectionInput<T> = Omit<
  DataStateProjectionInput<T>,
  "freshnessThresholdMs"
>;

const dataStateSet: ReadonlySet<unknown> = new Set(DATA_STATES);

function isDataState(value: unknown): value is DataState {
  return dataStateSet.has(value);
}

export function projectDataState<T>(
  input: DataStateProjectionInput<T>,
  telemetry?: DataStateTelemetry,
): DataStateProjection<T> {
  if (!isDataState(input.state)) {
    telemetry?.({
      event: "unknown_data_state",
      receivedType: input.state === null ? "null" : typeof input.state,
    });

    return {
      state: "LIMITED",
      reason: "UNKNOWN_DATA_STATE",
      provider: input.provider,
      capturedAt: input.capturedAt,
      sourceUpdatedAt: input.sourceUpdatedAt,
      freshnessThresholdMs: input.freshnessThresholdMs,
      value: input.value,
    };
  }

  return {
    state: input.state,
    reason: input.reason,
    provider: input.provider,
    capturedAt: input.capturedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    freshnessThresholdMs: input.freshnessThresholdMs,
    value: input.value,
  } as DataStateProjection<T>;
}

export function classifyFreshness<T>(
  input: FreshnessProjectionInput<T>,
  freshnessThresholdMs: number,
  now = new Date(),
  telemetry?: DataStateTelemetry,
): DataStateProjection<T> {
  if (!Number.isSafeInteger(freshnessThresholdMs) || freshnessThresholdMs <= 0) {
    throw new RangeError("Freshness threshold must be a positive integer in milliseconds");
  }

  const projection = projectDataState(
    { ...input, freshnessThresholdMs },
    telemetry,
  );

  if (projection.state !== "AVAILABLE" && projection.state !== "LIMITED") {
    return projection;
  }

  if (projection.sourceUpdatedAt === null) {
    return projection.state === "AVAILABLE"
      ? { ...projection, state: "LIMITED", reason: "SOURCE_UPDATE_TIME_MISSING" }
      : projection;
  }

  const sourceUpdatedAt = Date.parse(projection.sourceUpdatedAt);
  if (!Number.isFinite(sourceUpdatedAt)) {
    return { ...projection, state: "LIMITED", reason: "INVALID_SOURCE_UPDATE_TIME" };
  }

  if (now.getTime() - sourceUpdatedAt > freshnessThresholdMs) {
    return {
      ...projection,
      state: "STALE",
      reason: "FRESHNESS_THRESHOLD_EXCEEDED",
    };
  }

  return projection;
}
