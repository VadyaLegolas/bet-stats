import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";

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
  app.useBodyParser("json", { limit: "100kb" });
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: false, whitelist: true }));
  app.use((request: { headers: Record<string, string | string[] | undefined> }, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    const supplied = request.headers["x-correlation-id"];
    const correlationId = typeof supplied === "string" && supplied.length <= 128 ? supplied : randomUUID();
    response.setHeader("x-correlation-id", correlationId);
    next();
  });
  app.enableShutdownHooks();
  await app.listen(readPort(process.env.API_PORT), process.env.API_HOST ?? "127.0.0.1");
}

bootstrap().catch(() => {
  console.error("API failed to start");
  process.exitCode = 1;
});
