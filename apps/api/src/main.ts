import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Redis } from "ioredis";

import { AppModule } from "./app.module.js";
import { HTTPTOTAL_BUCKET_PREFIX, Http5xxBucketFilter, recordMinuteBucket, type BucketRedisClient } from "./modules/operations/http-5xx-bucket.filter.js";

function readPort(value: string | undefined): number {
  if (value === undefined) return 3001;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Best-effort degradation buckets (D-09): null-safe without REDIS_URL, and
  // Redis failures never fail a request or an error response.
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  redis?.on("error", () => {
    // Degradation buckets are best-effort; connection errors surface through the buckets, not crashes.
  });
  const buckets: BucketRedisClient | null = redis ? { multi: () => redis.multi() } : null;
  app.useBodyParser("json", { limit: "100kb" });
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: false, whitelist: true }));
  app.use((request: { headers: Record<string, string | string[] | undefined> }, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    const supplied = request.headers["x-correlation-id"];
    const correlationId = typeof supplied === "string" && supplied.length <= 128 ? supplied : randomUUID();
    response.setHeader("x-correlation-id", correlationId);
    // Per-request total counter — the denominator of the 5xx-ratio evaluation
    // (D-09). Same minute index and TTL as the 5xx bucket; fire-and-forget with
    // swallowed errors so Redis absence or failure never fails the request.
    recordMinuteBucket(buckets, HTTPTOTAL_BUCKET_PREFIX);
    next();
  });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new Http5xxBucketFilter(buckets, httpAdapter));
  app.enableShutdownHooks();
  await app.listen(readPort(process.env.API_PORT), process.env.API_HOST ?? "127.0.0.1");
}

bootstrap().catch(() => {
  console.error("API failed to start");
  process.exitCode = 1;
});
