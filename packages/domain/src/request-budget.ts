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
