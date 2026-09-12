import { dependencyReadiness, readServerConfig } from "@bet-stats/config";
import { createPrismaBacktestReceiptRepository, createPrismaClient, createPrismaForecastRepository, createReplayProviderPolicyRepository, createSettlementPipelineService, DEFAULT_REPLAY_PROVIDER_POLICIES } from "@bet-stats/database";
import { ForecastOrchestrator } from "@bet-stats/domain";
import { FootballDataOrgClient, type FixtureProvider, type ResultProvider, type StandingsProvider } from "@bet-stats/football-data";
import { runReplayFixtureJob } from "./jobs/fixtures.js";
import { runReplayResultJob } from "./jobs/results.js";
import { runReplayStandingsJob } from "./jobs/standings.js";
import { createSettlementJobHandler } from "./jobs/settlement.js";
import { reconcileBacktestDelivery, runBacktestPlan } from "./jobs/backtests.js";
import { createBacktestQueue, createBacktestWorker, createEnrichmentSchedule, createReplayWorker, createSettlementQueue, createSettlementWorker, type EnrichmentJobData, type ReplayJobData } from "./queues/index.js";
import { createDurableProviderCircuitRegistry } from "./resilience/circuits.js";

export { createSyncWorkers } from "./queues/index.js";

export function createWorkerReadiness(state: { postgres: boolean; redis: boolean }) {
  return dependencyReadiness(state);
}

export async function scheduleFixtureEnrichment(input: { fixtureId: string; kickoffUtc: string; policyVersion: string; enqueue: (job: EnrichmentJobData) => Promise<unknown> }): Promise<void> {
  for (const job of createEnrichmentSchedule(input)) await input.enqueue(job);
}

type ReplayProvider = FixtureProvider & Pick<ResultProvider, "fetchCompetitionResults" | "fetchCompletedResults"> & Pick<StandingsProvider, "fetchCompetitionStandings" | "fetchStandings">;

export function startReplayWorker(input: { databaseUrl: string; redisUrl: string; apiToken: string; prefix?: string; providerFactory?: () => ReplayProvider }) {
  const database = createPrismaClient(input.databaseUrl);
  const providerFactory = input.providerFactory ?? (() => new FootballDataOrgClient({ apiToken: input.apiToken }));
  const providerPolicyRepository = createReplayProviderPolicyRepository({ database, policies: DEFAULT_REPLAY_PROVIDER_POLICIES });
  const circuitRegistry = createDurableProviderCircuitRegistry({ database });
  const settlementQueueHandle = createSettlementQueue({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}) });
  const settlementService = createSettlementPipelineService({ database });
  const backtestReceipts = createPrismaBacktestReceiptRepository({ database, settlementService });
  const backtestQueueHandle = createBacktestQueue({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}) });
  const worker = createReplayWorker({ redisUrl: input.redisUrl, database, ...(input.prefix ? { prefix: input.prefix } : {}), execute: async (job: ReplayJobData, context) => {
    if (job.input.endpointFamily === "FIXTURES") return runReplayFixtureJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry }, context);
    if (job.input.endpointFamily === "RESULTS") return runReplayResultJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry, settlementQueue: settlementQueueHandle }, context);
    if (job.input.endpointFamily === "STANDINGS") return runReplayStandingsJob(job, { database, providerFactory, providerPolicyRepository, circuitRegistry }, context);
    throw Object.assign(new Error("UNSUPPORTED_REPLAY_ENDPOINT"), { code: "UNSUPPORTED_REPLAY_ENDPOINT" });
  } });
  const settlementWorker = createSettlementWorker({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}), execute: createSettlementJobHandler({ service: settlementService }) });
  const forecastRepository = createPrismaForecastRepository(database);
  const backtestWorker = createBacktestWorker({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}), loadPlan: backtestReceipts.findPlan as never, execute: (plan, data) => runBacktestPlan({ plan, receipts: backtestReceipts as never, orchestrator: new ForecastOrchestrator(), repository: forecastRepository, correlationId: data.correlationId }) });
  const reconcile = () => reconcileBacktestDelivery({ receipts: backtestReceipts, queue: backtestQueueHandle }).catch(() => undefined);
  void reconcile();
  const backtestReconcileTimer = setInterval(() => { void reconcile(); }, 5_000);
  return { worker, settlementWorker, backtestWorker, async close() { clearInterval(backtestReconcileTimer); await worker.close(); await settlementWorker.close(); await backtestWorker.close(); await backtestQueueHandle.close(); await settlementQueueHandle.close(); await database.$disconnect(); } };
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
