import { HttpException } from "@nestjs/common";
import type { ArgumentsHost, HttpServer } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";

/**
 * Bucket TTL shared by both per-minute counters so the evaluator's rolling window reads
 * consistent pairs. Invariant (WR-02): the evaluator reads offsets 0..HTTP5XX_WINDOW_MINUTES-1
 * (D-09's 5-minute window), and each per-minute INCR refreshes the key's TTL, so a minute-M key
 * lives at most TTL past minute M's last write. TTL must therefore cover window*60 plus a
 * margin (>=60s) — 420 = 300 + 120 — or late-in-minute-M reads would lose the -3/-4 buckets
 * and silently shrink the documented window to 2-3 minutes. Pinned by a cross-module mirror
 * test in tests/unit/alerts-5xx-filter.test.ts.
 */
export const BUCKET_TTL_SECONDS = 420;
/** 5xx responses bucket prefix — keys carry only the minute index, never provider tokens or URLs (T-09-07). */
export const HTTP5XX_BUCKET_PREFIX = "bet-stats:http5xx:";
/** Per-request total bucket prefix — the denominator of the 5xx-ratio evaluation (D-09). */
export const HTTPTOTAL_BUCKET_PREFIX = "bet-stats:httpTotal:";

/** Minimal transaction surface (satisfied by ioredis pipelines and test doubles). */
export type BucketTransaction = {
  incr(key: string): BucketTransaction;
  expire(key: string, seconds: number): BucketTransaction;
  exec(): unknown;
};

/** Minimal Redis surface used for bucket writes — never the source of truth for alert state. */
export type BucketRedisClient = { multi(): BucketTransaction };

function minuteIndex(now: number): number {
  return Math.floor(now / 60_000);
}

/**
 * Fire-and-forget per-minute bucket write (MULTI INCR+EXPIRE, TTL 420s).
 * Redis absence or failure must never fail the caller: a missing client is a
 * no-op, synchronous errors are swallowed, and the async exec rejection is
 * caught. Keys contain only the prefix and the minute index (T-09-07).
 */
export function recordMinuteBucket(client: BucketRedisClient | null, prefix: string, now = Date.now()): void {
  if (!client) return;
  try {
    const key = `${prefix}${minuteIndex(now)}`;
    const pending = client.multi().incr(key).expire(key, BUCKET_TTL_SECONDS).exec();
    if (pending && typeof (pending as Promise<unknown>).catch === "function") {
      void (pending as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Best-effort degradation signal: never propagate to the caller.
  }
}

function exceptionStatus(exception: unknown): number | null {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return Number.isInteger(status) ? status : null;
  }
  return null;
}

/**
 * Global 5xx counter (ALRT-01/D-09). Catches every exception, and counts it
 * into bet-stats:http5xx:<minuteIndex> (MULTI INCR+EXPIRE, TTL 420s) whenever
 * it is a raw (non-HttpException) value — which Nest's BaseExceptionFilter
 * itself answers with 500 «Internal server error» — or an HttpException with
 * status >= 500; then it delegates to the Nest base handler so error bodies
 * stay byte-identical — no contract change. Bucket writes are
 * fire-and-forget: a missing REDIS_URL or a Redis failure never changes the
 * response.
 */
export class Http5xxBucketFilter extends BaseExceptionFilter {
  constructor(private readonly buckets: BucketRedisClient | null, applicationRef?: HttpServer) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exceptionStatus(exception);
    // A null status means a raw (non-HttpException) exception: BaseExceptionFilter
    // renders it as 500 «Internal server error», so the numerator must include it (WR-01).
    if (status === null || status >= 500) recordMinuteBucket(this.buckets, HTTP5XX_BUCKET_PREFIX);
    super.catch(exception, host);
  }
}
