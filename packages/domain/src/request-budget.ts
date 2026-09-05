interface RawTransaction {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
}

interface TransactionHost {
  $transaction<T>(operation: (transaction: RawTransaction) => Promise<T>): Promise<T>;
}

export interface ReservationRequest {
  provider: string;
  requestDate: string;
  endpoint: string;
  jobKey: string;
  allowance: number;
}

export type ReservationResult = { reserved: true; reused: boolean } | { reserved: false; reason: "ALLOWANCE_EXHAUSTED" };

export async function reserveProviderRequest(database: TransactionHost, request: ReservationRequest): Promise<ReservationResult> {
  if (!Number.isSafeInteger(request.allowance) || request.allowance < 0) throw new RangeError("Allowance must be a non-negative integer");
  return database.$transaction(async (transaction) => {
    const lockKey = `${request.provider}:${request.requestDate}:${request.endpoint}`;
    await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", lockKey);
    const existing = await transaction.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "ProviderRequestReservation" WHERE provider = $1 AND "requestDate" = $2::date AND endpoint = $3 AND "jobKey" = $4) AS exists`,
      request.provider, request.requestDate, request.endpoint, request.jobKey,
    );
    if (existing[0]?.exists) return { reserved: true, reused: true };
    const usage = await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM "ProviderRequestReservation" WHERE provider = $1 AND "requestDate" = $2::date AND endpoint = $3`,
      request.provider, request.requestDate, request.endpoint,
    );
    if (Number(usage[0]?.count ?? 0) >= request.allowance) return { reserved: false, reason: "ALLOWANCE_EXHAUSTED" };
    await transaction.$executeRawUnsafe(
      `INSERT INTO "ProviderRequestReservation" (id, provider, "requestDate", endpoint, "jobKey") VALUES (gen_random_uuid()::text, $1, $2::date, $3, $4)`,
      request.provider, request.requestDate, request.endpoint, request.jobKey,
    );
    return { reserved: true, reused: false };
  });
}

export type RequestPriorityLane = "critical" | "standard" | "optional";

export interface PriorityReservationRequest {
  database?: TransactionHost;
  provider: string;
  resetDate?: string;
  resetTimezone?: string | null;
  endpointFamily?: string;
  lane: RequestPriorityLane;
  configuredAllowance: number;
  criticalHeadroom?: number;
  runtimeAllowance?: number;
  reserved?: number;
  jobKey: string;
}

export type PriorityReservationResult =
  | { reserved: true; reused: boolean; effectiveAllowance: number }
  | { reserved: false; reason: "ALLOWANCE_EXHAUSTED" | "CRITICAL_HEADROOM" | "UNKNOWN_RESET_SEMANTICS"; effectiveAllowance: number };

const localReservations = new Map<string, Set<string>>();

export async function reservePriorityRequest(request: PriorityReservationRequest): Promise<PriorityReservationResult> {
  if (!Number.isSafeInteger(request.configuredAllowance) || request.configuredAllowance < 0) {
    throw new RangeError("Configured allowance must be a non-negative integer");
  }
  const criticalHeadroom = request.criticalHeadroom ?? 0;
  if (!Number.isSafeInteger(criticalHeadroom) || criticalHeadroom < 0) {
    throw new RangeError("Critical headroom must be a non-negative integer");
  }
  const effectiveAllowance = request.configuredAllowance;
  if (!request.resetDate || request.resetTimezone === null) {
    return { reserved: false, reason: "UNKNOWN_RESET_SEMANTICS", effectiveAllowance };
  }
  if (effectiveAllowance === 0) {
    return { reserved: false, reason: "ALLOWANCE_EXHAUSTED", effectiveAllowance };
  }

  if (request.database) return reservePriorityInDatabase(request.database, request, criticalHeadroom);

  // The no-database path is a deterministic test adapter; durable callers share the provider/day lock below.
  const bucketKey = `${request.provider}:${request.resetDate}:${request.endpointFamily ?? "UNKNOWN"}`;
  const jobs = localReservations.get(bucketKey) ?? new Set<string>();
  if (jobs.has(request.jobKey)) return { reserved: true, reused: true, effectiveAllowance };
  const reserved = request.reserved ?? jobs.size;
  const laneLimit = request.lane === "critical" ? effectiveAllowance : Math.max(0, effectiveAllowance - criticalHeadroom);
  if (reserved >= laneLimit) {
    return {
      reserved: false,
      reason: request.lane === "critical" ? "ALLOWANCE_EXHAUSTED" : "CRITICAL_HEADROOM",
      effectiveAllowance,
    };
  }
  jobs.add(request.jobKey);
  localReservations.set(bucketKey, jobs);
  return { reserved: true, reused: false, effectiveAllowance };
}

async function reservePriorityInDatabase(
  database: TransactionHost,
  request: PriorityReservationRequest,
  criticalHeadroom: number,
): Promise<PriorityReservationResult> {
  return database.$transaction(async (transaction) => {
    const endpoint = request.endpointFamily ?? "UNKNOWN";
    const lockKey = `${request.provider}:${request.resetDate}:priority-budget`;
    await transaction.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", lockKey);
    const existing = await transaction.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "ProviderRequestReservation" WHERE provider = $1 AND "requestDate" = $2::date AND endpoint = $3 AND "jobKey" = $4) AS exists`,
      request.provider, request.resetDate, endpoint, request.jobKey,
    );
    if (existing[0]?.exists) return { reserved: true, reused: true, effectiveAllowance: request.configuredAllowance };
    const usage = await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*) AS count FROM "ProviderRequestReservation" WHERE provider = $1 AND "requestDate" = $2::date`,
      request.provider, request.resetDate,
    );
    const reserved = Number(usage[0]?.count ?? 0);
    const laneLimit = request.lane === "critical"
      ? request.configuredAllowance
      : Math.max(0, request.configuredAllowance - criticalHeadroom);
    if (reserved >= laneLimit) {
      return {
        reserved: false,
        reason: request.lane === "critical" ? "ALLOWANCE_EXHAUSTED" : "CRITICAL_HEADROOM",
        effectiveAllowance: request.configuredAllowance,
      };
    }
    await transaction.$executeRawUnsafe(
      `INSERT INTO "ProviderRequestReservation" (id, provider, "requestDate", endpoint, "jobKey") VALUES (gen_random_uuid()::text, $1, $2::date, $3, $4)`,
      request.provider, request.resetDate, endpoint, request.jobKey,
    );
    return { reserved: true, reused: false, effectiveAllowance: request.configuredAllowance };
  });
}
