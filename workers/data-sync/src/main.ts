import { dependencyReadiness, readServerConfig } from "@bet-stats/config";
import { createPrismaClient } from "@bet-stats/database";
import { FootballDataOrgClient } from "@bet-stats/football-data";
import { runReplayResultJob } from "./jobs/results.js";
import { runReplayStandingsJob } from "./jobs/standings.js";
import { createReplayWorker, type ReplayJobData } from "./queues/index.js";

export { createSyncWorkers } from "./queues/index.js";

export function createWorkerReadiness(state: { postgres: boolean; redis: boolean }) {
  return dependencyReadiness(state);
}

export function startReplayWorker(input: { databaseUrl: string; redisUrl: string; apiToken: string; prefix?: string }) {
  const database = createPrismaClient(input.databaseUrl);
  const providerFactory = () => new FootballDataOrgClient({ apiToken: input.apiToken });
  const worker = createReplayWorker({ redisUrl: input.redisUrl, database, ...(input.prefix ? { prefix: input.prefix } : {}), execute: async (job: ReplayJobData) => {
    if (job.input.endpointFamily === "RESULTS") return runReplayResultJob(job, { database, providerFactory });
    if (job.input.endpointFamily === "STANDINGS") return runReplayStandingsJob(job, { database, providerFactory });
    throw Object.assign(new Error("UNSUPPORTED_REPLAY_ENDPOINT"), { code: "UNSUPPORTED_REPLAY_ENDPOINT" });
  } });
  return { worker, async close() { await worker.close(); await database.$disconnect(); } };
}

function start(): void {
  const config = readServerConfig(process.env);
  const readiness = createWorkerReadiness({
    postgres: process.env.POSTGRES_READY === "true",
    redis: process.env.REDIS_READY === "true",
  });
  console.info(JSON.stringify({ event: "worker.initialized", readiness }));
  if (config.DATABASE_URL && config.REDIS_URL && config.FOOTBALL_DATA_API_TOKEN) {
    const runtime = startReplayWorker({ databaseUrl: config.DATABASE_URL, redisUrl: config.REDIS_URL, apiToken: config.FOOTBALL_DATA_API_TOKEN });
    const close = () => { void runtime.close(); };
    process.once("SIGTERM", close); process.once("SIGINT", close);
  }
}

try {
  start();
} catch {
  console.error("Data-sync worker configuration is invalid");
  process.exitCode = 1;
}
