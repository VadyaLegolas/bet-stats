import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpException, NotFoundException } from "../../apps/api/node_modules/@nestjs/common/index.js";
import type { ArgumentsHost } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { HTTPTOTAL_BUCKET_PREFIX, Http5xxBucketFilter, recordMinuteBucket, type BucketRedisClient } from "../../apps/api/src/modules/operations/http-5xx-bucket.filter.js";

function mockHost() {
  const response = { status: vi.fn(() => response), json: vi.fn(() => response) };
  const host = {
    getArgs: () => [{}, response, () => undefined],
    getArgByIndex: (index: number) => (index === 1 ? response : {}),
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => response, getNext: () => undefined }),
    switchToRpc: () => ({}),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
    getType: () => "http",
  };
  return { response, host: host as unknown as ArgumentsHost };
}

/** Minimal HttpServer double so BaseExceptionFilter.reply assertions are direct. */
function mockApplicationRef() {
  return { isHeadersSent: vi.fn(() => false), reply: vi.fn(), end: vi.fn() };
}

function mockRedis(execImpl: () => Promise<unknown> = async () => []) {
  const exec = vi.fn(execImpl);
  const transaction = { incr: vi.fn(() => transaction), expire: vi.fn(() => transaction), exec };
  const client: BucketRedisClient = { multi: vi.fn(() => transaction) };
  return { client, transaction, exec };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Http5xxBucketFilter", () => {
  it("counts a 500 error into bet-stats:http5xx:<minuteIndex> (INCR + EXPIRE 120s) and then delegates to the base handler", () => {
    const fixedMs = 1_700_000_040_567;
    vi.spyOn(Date, "now").mockReturnValue(fixedMs);
    const redis = mockRedis();
    const applicationRef = mockApplicationRef();
    const { response, host } = mockHost();
    const filter = new Http5xxBucketFilter(redis.client, applicationRef as never);
    const expectedKey = `bet-stats:http5xx:${Math.floor(fixedMs / 60_000)}`;

    filter.catch(new HttpException("boom", 500), host);

    expect(redis.transaction.incr).toHaveBeenCalledWith(expectedKey);
    expect(redis.transaction.expire).toHaveBeenCalledWith(expectedKey, 120);
    expect(redis.transaction.exec).toHaveBeenCalledOnce();
    // Base error contract unchanged: reply carries the exact HttpException body and status.
    expect(applicationRef.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 500, message: "boom" }), 500);
  });

  it("does not write a bucket for 4xx exceptions and keeps the 404 body byte-identical to the base handler", () => {
    const redis = mockRedis();
    const applicationRef = mockApplicationRef();
    const { response, host } = mockHost();
    const filter = new Http5xxBucketFilter(redis.client, applicationRef as never);

    filter.catch(new NotFoundException("Not found"), host);

    expect(redis.client.multi).not.toHaveBeenCalled();
    expect(applicationRef.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 404, message: "Not found" }), 404);
  });

  it("counts a raw exception as a 5xx — Nest answers it 500 «Internal server error»", () => {
    const fixedMs = 1_700_000_040_567;
    vi.spyOn(Date, "now").mockReturnValue(fixedMs);
    const redis = mockRedis();
    const applicationRef = mockApplicationRef();
    const { response, host } = mockHost();
    const filter = new Http5xxBucketFilter(redis.client, applicationRef as never);
    const expectedKey = `bet-stats:http5xx:${Math.floor(fixedMs / 60_000)}`;

    filter.catch(new Error("boom"), host);

    // WR-01: a raw (non-HttpException) error is the class BaseExceptionFilter renders as 500 —
    // the numerator must include it, exactly during unhandled-error bursts.
    expect(redis.client.multi).toHaveBeenCalled();
    expect(redis.transaction.incr).toHaveBeenCalledWith(expectedKey);
    expect(redis.transaction.expire).toHaveBeenCalledWith(expectedKey, expect.anything());
    expect(redis.transaction.exec).toHaveBeenCalledOnce();
    // Response contract unchanged: base reply carries exactly the uniform 500 body.
    expect(applicationRef.reply).toHaveBeenCalledWith(response, { statusCode: 500, message: "Internal server error" }, 500);
  });

  it("is null-safe without a Redis client (no REDIS_URL) — base error handling still proceeds", () => {
    const applicationRef = mockApplicationRef();
    const { response, host } = mockHost();
    const filter = new Http5xxBucketFilter(null, applicationRef as never);

    expect(() => filter.catch(new HttpException("boom", 500), host)).not.toThrow();
    expect(applicationRef.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 500 }), 500);
  });
});

describe("per-request total bucket counter (recordMinuteBucket)", () => {
  it("increments bet-stats:httpTotal:<minuteIndex> with a 120s TTL on every call", () => {
    const fixedMs = 1_700_000_000_123;
    vi.spyOn(Date, "now").mockReturnValue(fixedMs);
    const redis = mockRedis();

    recordMinuteBucket(redis.client, HTTPTOTAL_BUCKET_PREFIX);

    expect(redis.transaction.incr).toHaveBeenCalledWith(`bet-stats:httpTotal:${Math.floor(fixedMs / 60_000)}`);
    expect(redis.transaction.expire).toHaveBeenCalledWith(expect.anything(), 120);
    expect(redis.transaction.exec).toHaveBeenCalledOnce();
  });

  it("swallows a Redis exec rejection — the request continues", () => {
    const redis = mockRedis(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(() => recordMinuteBucket(redis.client, HTTPTOTAL_BUCKET_PREFIX)).not.toThrow();
  });

  it("is a no-op without a Redis client (no REDIS_URL)", () => {
    expect(() => recordMinuteBucket(null, HTTPTOTAL_BUCKET_PREFIX)).not.toThrow();
  });

  it("survives a synchronous multi() failure", () => {
    const client = { multi: () => { throw new Error("offline queue closed"); } };
    expect(() => recordMinuteBucket(client, HTTPTOTAL_BUCKET_PREFIX)).not.toThrow();
  });
});
