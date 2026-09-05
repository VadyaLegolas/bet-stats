import { dependencyReadiness, readServerConfig } from "@bet-stats/config";
import { createPrismaClient, createReplayProviderPolicyRepository, DEFAULT_REPLAY_PROVIDER_POLICIES } from "@bet-stats/database";
import { FootballDataOrgClient, type FixtureProvider, type ResultProvider, type StandingsProvider } from "@bet-stats/football-data";
import { runReplayFixtureJob } from "./jobs/fixtures.js";
import { runReplayResultJob } from "./jobs/results.js";
import { runReplayStandingsJob } from "./jobs/standings.js";
import { createReplayWorker, type ReplayJobData } from "./queues/index.js";
import { createDurableProviderCircuitRegistry } from "./resilience/circuits.js";

export { createSyncWorkers } from "./queues/index.js";

export function createWorkerReadiness(state: { postgres: boolean; redis: boolean }) {
  return dependencyReadiness(state);
}

type ReplayProvider = FixtureProvider & Pick<ResultProvider, "fetchCompetitionResults" | "fetchCompletedResults"> & Pick<StandingsProvider, "fetchCompetitionStandings" | "fetchStandings">;

export function startReplayWorker(input: { databaseUrl: string; redisUrl: string; apiToken: string; prefix?: string; providerFactory?: () => ReplayProvider }) {
  const database = createPrismaClient(input.databaseUrl);
  const providerFactory = input.providerFactory ?? (() => new FootballDataOrgClient({ apiToken: input.apiToken }));
  const providerPolicyRepository = createReplayProviderPolicyRepository({ database, policies: DEFAULT_REPLAY_PROVIDER_POLICIES });
  const circuitRegistry = createDurableProviderCircuitRegistry({ database });
  const worker = createReplayWorker({ redisUrl: input.redisUrl, database, ...(input.prefix ? { prefix: input.prefix } : {}), execute: async (job: ReplayJobData, context) => {
    if (job.input.endpointFamily === "FIXTURES") return runReplayFixtureJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry }, context);
    if (job.input.endpointFamily === "RESULTS") return runReplayResultJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry }, context);
    if (job.input.endpointFamily === "STANDINGS") return runReplayStandingsJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry }, context);
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
