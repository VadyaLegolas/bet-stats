import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { dependencyReadiness, readServerConfig } from "@bet-stats/config";
import { createPrismaBacktestReceiptRepository, createPrismaClient, createPrismaForecastRepository, createProviderRoutingRepository, createReplayProviderPolicyRepository, createSettlementPipelineService, DEFAULT_REPLAY_PROVIDER_POLICIES } from "@bet-stats/database";
import { currentForecastConfigHash, ForecastOrchestrator } from "@bet-stats/domain";
import { ApiFootballClient, FootballDataOrgClient, type FixtureProvider, type ResultProvider, type StandingsProvider } from "@bet-stats/football-data";
import { runReplayFixtureJob } from "./jobs/fixtures.js";
import { runReplayResultJob } from "./jobs/results.js";
import { runReplayStandingsJob } from "./jobs/standings.js";
import { ensureTeamEvidence, runForecastPublicationSweep } from "./jobs/forecast-sweep.js";
import { createProductionEnrichmentExecutor } from "./jobs/enrichment.js";
import { createSettlementJobHandler } from "./jobs/settlement.js";
import { reconcileBacktestDelivery, runBacktestPlan } from "./jobs/backtests.js";
import { scheduleRetentionPurge } from "./jobs/retention-purge.js";
import { createBacktestQueue, createBacktestWorker, createEnrichmentQueue, createEnrichmentSchedule, createEnrichmentWorker, createReplayWorker, createSettlementQueue, createSettlementWorker, type EnrichmentJobData, type ReplayJobData } from "./queues/index.js";
import { createDurableProviderCircuitRegistry } from "./resilience/circuits.js";

export { createSyncWorkers } from "./queues/index.js";

export function createWorkerReadiness(state: { postgres: boolean; redis: boolean }) {
  return dependencyReadiness(state);
}

export async function scheduleFixtureEnrichment(input: { fixtureId: string; kickoffUtc: string; policyVersion: string; enqueue: (job: EnrichmentJobData) => Promise<unknown> }): Promise<void> {
  for (const job of createEnrichmentSchedule(input)) await input.enqueue(job);
}

type ReplayProvider = FixtureProvider & Pick<ResultProvider, "fetchCompetitionResults" | "fetchCompletedResults"> & Pick<StandingsProvider, "fetchCompetitionStandings" | "fetchStandings">;

export function createLiveProviderFactories(input: { footballDataApiToken: string; apiFootballApiKey: string }) {
  return {
    "football-data.org": () => new FootballDataOrgClient({ apiToken: input.footballDataApiToken }),
    "api-football": () => new ApiFootballClient({ apiKey: input.apiFootballApiKey }),
  } as const;
}
type ProviderFactories = ReturnType<typeof createLiveProviderFactories>;
export function resolveReplayProviderFactories(input: { footballDataApiToken: string; apiFootballApiKey: string; providerFactories?: ProviderFactories }): ProviderFactories { return input.providerFactories ?? createLiveProviderFactories(input); }

export function startReplayWorker(input: { databaseUrl: string; redisUrl: string; footballDataApiToken: string; apiFootballApiKey: string; prefix?: string; providerFactory?: () => ReplayProvider; providerFactories?: ProviderFactories; forecastSweep?: { intervalMs?: number } }) {
  const database = createPrismaClient(input.databaseUrl);
  const providerFactories = resolveReplayProviderFactories(input);
  const providerFactory = input.providerFactory ?? providerFactories["football-data.org"];
  const providerRoutingRepository = createProviderRoutingRepository({ database });
  const providerPolicyRepository = createReplayProviderPolicyRepository({ database, policies: DEFAULT_REPLAY_PROVIDER_POLICIES });
  const circuitRegistry = createDurableProviderCircuitRegistry({ database });
  const settlementQueueHandle = createSettlementQueue({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}) });
  const settlementService = createSettlementPipelineService({ database });
  const backtestReceipts = createPrismaBacktestReceiptRepository({ database, settlementService });
  const backtestQueueHandle = createBacktestQueue({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}) });
  const worker = createReplayWorker({ redisUrl: input.redisUrl, database, ...(input.prefix ? { prefix: input.prefix } : {}), execute: async (job: ReplayJobData, context) => {
    if (job.input.endpointFamily === "FIXTURES") return runReplayFixtureJob(job, { database, providerFactory, providerFactories, providerRoutingRepository, providerPolicyRepository, circuitRegistry, enrichmentQueue: enrichmentQueueHandle }, context);
    if (job.input.endpointFamily === "RESULTS") return runReplayResultJob(job, { database, providerFactory, providerFactories, providerRoutingRepository, providerPolicyRepository, circuitRegistry, settlementQueue: settlementQueueHandle }, context);
    if (job.input.endpointFamily === "STANDINGS") return runReplayStandingsJob(job, { database, providerFactory, providerFactories, providerRoutingRepository, providerPolicyRepository, circuitRegistry }, context);
    throw Object.assign(new Error("UNSUPPORTED_REPLAY_ENDPOINT"), { code: "UNSUPPORTED_REPLAY_ENDPOINT" });
  } });
  const settlementWorker = createSettlementWorker({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}), execute: createSettlementJobHandler({ service: settlementService }) });
  const forecastRepository = createPrismaForecastRepository(database);
  const enrichmentQueueHandle = createEnrichmentQueue({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}) });
  const issueLineupForecastBase = async ({ fixtureId, cutoff }: { fixtureId: string; cutoff: string }) => (await new ForecastOrchestrator().run({ fixtureId, asOf: cutoff, kind: "LINEUP_CONFIRMED", modelVersion: "poisson-ensemble-v1", configHash: currentForecastConfigHash(), initiator: { type: "production", correlationId: `enrichment:${fixtureId}:${cutoff}` } }, forecastRepository)).id;
  const issueLineupForecast = input.forecastSweep
    ? async ({ fixtureId, cutoff }: { fixtureId: string; cutoff: string }) => {
        const fixture = await database.fixture.findUnique({ where: { id: fixtureId }, select: { homeTeamId: true, awayTeamId: true } });
        const homeBuildId = fixture ? await ensureTeamEvidence({ database, teamId: fixture.homeTeamId, cutoff }) : null;
        const awayBuildId = fixture ? await ensureTeamEvidence({ database, teamId: fixture.awayTeamId, cutoff }) : null;
        if (!homeBuildId || !awayBuildId) console.info(JSON.stringify({ event: "forecast.sweep.lineup_evidence_missing", fixtureId, cutoff, homeBuildId, awayBuildId }));
        return issueLineupForecastBase({ fixtureId, cutoff });
      }
    : issueLineupForecastBase;
  const enrichmentWorker = createEnrichmentWorker({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}), execute: createProductionEnrichmentExecutor({ database, apiFootballFactory: providerFactories["api-football"], issueLineupForecast }) });
  const backtestWorker = createBacktestWorker({ redisUrl: input.redisUrl, ...(input.prefix ? { prefix: input.prefix } : {}), loadPlan: backtestReceipts.findPlan as never, execute: (plan, data) => runBacktestPlan({ plan, receipts: backtestReceipts as never, orchestrator: new ForecastOrchestrator(), repository: forecastRepository, correlationId: data.correlationId }) });
  const reconcile = () => reconcileBacktestDelivery({ receipts: backtestReceipts, queue: backtestQueueHandle }).catch(() => undefined);
  void reconcile();
  const backtestReconcileTimer = setInterval(() => { void reconcile(); }, 5_000);
  const retentionPurgeScheduler = scheduleRetentionPurge({ database, onError: (error) => console.error(JSON.stringify({ event: "privacy.retention_purge.failed", error: error instanceof Error ? error.message : "UNKNOWN" })) });
  let forecastSweepStartTimer: NodeJS.Timeout | undefined;
  let forecastSweepInterval: NodeJS.Timeout | undefined;
  let forecastSweepInFlight = false;
  if (input.forecastSweep) {
    const sweepDeps = { database, forecastRepository };
    const tick = () => {
      if (forecastSweepInFlight) return;
      forecastSweepInFlight = true;
      void runForecastPublicationSweep(sweepDeps)
        .catch((error) => console.error(JSON.stringify({ event: "forecast.sweep.tick_failed", error: error instanceof Error ? error.message : "UNKNOWN" })))
        .finally(() => { forecastSweepInFlight = false; });
    };
    forecastSweepStartTimer = setTimeout(tick, 5_000);
    forecastSweepInterval = setInterval(tick, input.forecastSweep.intervalMs ?? 60_000);
  }
  return { worker, settlementWorker, backtestWorker, enrichmentWorker, enrichmentQueue: enrichmentQueueHandle, async waitUntilReady() { await Promise.all([worker.waitUntilReady(), enrichmentWorker.waitUntilReady(), settlementWorker.waitUntilReady(), backtestWorker.waitUntilReady()]); return { ready: true, workers: ["replay", "enrichment", "settlement", "backtest"] as const }; }, async close() { if (forecastSweepStartTimer) clearTimeout(forecastSweepStartTimer); if (forecastSweepInterval) clearInterval(forecastSweepInterval); clearInterval(backtestReconcileTimer); retentionPurgeScheduler.close(); await worker.close(); await enrichmentWorker.close(); await settlementWorker.close(); await backtestWorker.close(); await enrichmentQueueHandle.close(); await backtestQueueHandle.close(); await settlementQueueHandle.close(); await database.$disconnect(); } };
}

function start(): void {
  const config = readServerConfig(process.env);
  const readiness = createWorkerReadiness({
    postgres: process.env.POSTGRES_READY === "true",
    redis: process.env.REDIS_READY === "true",
  });
  console.info(JSON.stringify({ event: "worker.initialized", readiness }));
  if (config.DATABASE_URL && config.REDIS_URL && config.FOOTBALL_DATA_API_TOKEN && config.API_FOOTBALL_API_KEY) {
    const runtime = startReplayWorker({ databaseUrl: config.DATABASE_URL, redisUrl: config.REDIS_URL, footballDataApiToken: config.FOOTBALL_DATA_API_TOKEN, apiFootballApiKey: config.API_FOOTBALL_API_KEY, forecastSweep: { intervalMs: 60_000 } });
    const close = () => { void runtime.close(); };
    process.once("SIGTERM", close); process.once("SIGINT", close);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return pathToFileURL(entry).href === import.meta.url;
  }
}

if (isDirectExecution()) {
  try {
    start();
  } catch {
    console.error("Data-sync worker configuration is invalid");
    process.exitCode = 1;
  }
}
