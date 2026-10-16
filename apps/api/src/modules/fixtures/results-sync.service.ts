import { ServiceUnavailableException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { Queue } from "bullmq";

import { readServerConfig } from "@bet-stats/config";
import { createPrismaClient, persistResultsInTransaction, SETTLEMENT_PIPELINE_POLICY_HASH, type PrismaClient } from "@bet-stats/database";
import { evaluateCapability, reservePriorityRequest } from "@bet-stats/domain";
import { FootballDataOrgClient, isConfiguredCompetitionCode } from "@bet-stats/football-data";

import { CRITICAL_HEADROOM, DAILY_ALLOWANCE, PROVIDER } from "./fixtures-budget.js";
import { MIN_SYNC_INTERVAL_MS, chunkSyncDateRange, resolveSyncDateRange, waitForProviderSpacing } from "./fixtures-sync.service.js";

const RESULTS_WINDOW_DAYS = 7;

/** Mirrors workers/data-sync/src/queues/index.ts SettlementJobData — kept local because the
 * API must never import worker code. */
interface SettlementJobData {
  fixtureId: string;
  resultVersionId: string;
  forecastSnapshotId: string;
  policyVersion: string;
  policyHash: string;
  correlationId: string;
}

/** Same constants as the worker's settlement queue (workers/data-sync/src/queues/index.ts). */
const SETTLEMENT_MAX_ATTEMPTS = 3;

/** Same queue-name construction as the worker: `${prefix}-settlement` with a safe prefix. */
function settlementQueueName(prefix = "bet-stats"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Queue prefix contains unsupported characters");
  return `${prefix}-settlement`;
}

/** Same jobId format as the worker: `settlement:<resultVersionId>:<policyHash>:<snapshotId>`. */
function settlementJobId(data: SettlementJobData): string {
  return `settlement:${data.resultVersionId}:${data.policyHash}:${data.forecastSnapshotId}`;
}

export type ResultsLeagueResult = { league: string; status: "synced" | "skipped" | "denied" | "failed"; fixtures: number; results?: number; reason?: string };

type SyncLeagueRow = Awaited<ReturnType<PrismaClient["league"]["findFirst"]>> & { id: string; name: string; countryCode: string; externalRefs: Array<{ externalId: string }> };

/**
 * Production results ingestion: pulls FINISHED matches from football-data.org for a bounded
 * date window, persists them through the shared @bet-stats/database result persistence
 * (ResultVersion + SourceObservation, idempotent), and afterwards enqueues exactly one
 * idempotent settlement job per issued forecast snapshot of every published result. Gated by
 * ProviderCapability (endpoint RESULTS), the daily request budget and the shared provider
 * spacing gate, so a manual run can never exceed the provider allowance.
 */
@Injectable()
export class ResultsSyncService implements OnModuleDestroy {
  private readonly config = readServerConfig(process.env);
  private readonly database: PrismaClient | null = this.config.DATABASE_URL ? createPrismaClient(this.config.DATABASE_URL) : null;
  async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }

  availability(): { enabled: boolean; reason?: string } {
    if (this.config.DATA_PROVIDER_MODE !== "live") return { enabled: false, reason: "DETERMINISTIC_MODE" };
    if (!this.database) return { enabled: false, reason: "DATABASE_NOT_CONFIGURED" };
    if (!this.config.FOOTBALL_DATA_API_TOKEN) return { enabled: false, reason: "PROVIDER_TOKEN_NOT_CONFIGURED" };
    if (!this.config.REDIS_URL) return { enabled: false, reason: "REDIS_NOT_CONFIGURED" };
    return { enabled: true };
  }

  /** Serializes results runs the same way FixturesSyncService serializes fixture syncs:
   * concurrent operator requests must not race the budget/capability reads. */
  private pending: Promise<unknown> = Promise.resolve();

  async sync(input: { competitions?: readonly string[]; dateFrom?: string; dateTo?: string; force?: boolean }): Promise<{ results: readonly ResultsLeagueResult[] }> {
    const now = new Date();
    // Trailing window for a daily manual run: today-7d .. today unless the operator overrides it.
    const range = resolveSyncDateRange(input, { from: new Date(now.getTime() - RESULTS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
    const availability = this.availability();
    if (!availability.enabled) throw new ServiceUnavailableException({ message: "Results sync is not available", reason: availability.reason });
    const task = this.pending.then(async () => {
      const database = this.database!;
      const targets = await this.resolveLeagues(database, input.competitions);
      const published: Array<{ fixtureId: string; resultVersionId: string }> = [];
      const results: ResultsLeagueResult[] = [];
      for (const target of targets) results.push(await this.syncLeague(target, now, range, input.force === true, published));
      // Settlements are enqueued only after ALL persistence for the run has finished.
      if (published.length > 0) await this.enqueueSettlements(published);
      console.info(JSON.stringify({ event: "results-sync.completed", dateFrom: range.dateFrom, dateTo: range.dateTo, leagues: results.length, published: published.length }));
      return { results };
    });
    this.pending = task.catch(() => undefined);
    return task;
  }

  private async resolveLeagues(database: PrismaClient, competitions?: readonly string[]) {
    const leagues = await database.league.findMany({
      where: { externalRefs: { some: { provider: PROVIDER } } },
      include: { externalRefs: { where: { provider: PROVIDER } } },
      orderBy: { name: "asc" },
    });
    if (!competitions?.length) return leagues;
    const wanted = new Set(competitions.map((name) => name.trim()).filter((name) => name !== ""));
    return leagues.filter((league) => wanted.has(league.name));
  }

  private async syncLeague(league: SyncLeagueRow, now: Date, range: { dateFrom: string; dateTo: string }, force: boolean, published: Array<{ fixtureId: string; resultVersionId: string }>): Promise<ResultsLeagueResult> {
    const database = this.database!;
    const code = league.externalRefs[0]?.externalId;
    if (!code || !isConfiguredCompetitionCode(code)) return { league: league.name, status: "denied", fixtures: 0, reason: "PROVIDER_MAPPING_MISSING" };

    const seasons = await database.season.findMany({ where: { leagueId: league.id, externalRefs: { some: { provider: PROVIDER } } }, include: { externalRefs: { where: { provider: PROVIDER } } } });
    const season = seasons.find((row) => row.startsOn <= now && now <= row.endsOn) ?? [...seasons].sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime())[0];
    if (!season) return { league: league.name, status: "denied", fixtures: 0, reason: "SEASON_NOT_CONFIGURED" };

    const capability = await database.providerCapability.findUnique({ where: { provider_leagueId_seasonId_endpoint: { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "RESULTS" } } });
    const decision = evaluateCapability(capability ?? undefined, { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "RESULTS" }, now);
    if (!decision.allowed) return { league: league.name, status: "denied", fixtures: 0, reason: decision.reason };

    if (!force) {
      // Skip rule: mirror the fixtures freshness gate — a league whose latest RESULTS
      // observation (matched to its fixtures through FixtureExternalRef, the same identity
      // persistResults uses) is fresher than MIN_SYNC_INTERVAL_MS needs no refetch.
      const latest = await database.$queryRawUnsafe<Array<{ observedAt: Date | null }>>(
        `SELECT MAX(o."observedAt") AS "observedAt" FROM "SourceObservation" o JOIN "FixtureExternalRef" r ON r.provider = o.provider AND r."externalId" = o."externalIdentity" JOIN "Fixture" f ON f.id = r."fixtureId" AND f."leagueId" = $1 WHERE o."endpointFamily" = 'RESULTS'`,
        league.id,
      );
      const observedAt = latest[0]?.observedAt ? new Date(latest[0].observedAt).getTime() : null;
      if (observedAt !== null && now.getTime() - observedAt < MIN_SYNC_INTERVAL_MS) return { league: league.name, status: "skipped", fixtures: 0, reason: "RECENTLY_SYNCED" };
    }

    const reservation = await reservePriorityRequest({
      database,
      provider: PROVIDER,
      resetDate: now.toISOString().slice(0, 10),
      resetTimezone: "UTC",
      endpointFamily: "RESULTS",
      lane: "critical",
      configuredAllowance: DAILY_ALLOWANCE,
      criticalHeadroom: CRITICAL_HEADROOM,
      jobKey: `manual-results-sync:${code}:${range.dateFrom}:${range.dateTo}`,
    });
    if (!reservation.reserved) return { league: league.name, status: "denied", fixtures: 0, reason: reservation.reason };

    let fixtures = 0;
    let results = 0;
    try {
      for (const chunk of chunkSyncDateRange(range.dateFrom, range.dateTo)) {
        await waitForProviderSpacing();
        const client = new FootballDataOrgClient({ apiToken: this.config.FOOTBALL_DATA_API_TOKEN! });
        const fetched = await client.fetchCompetitionResults({ competitionCode: code, dateFrom: chunk.dateFrom, dateTo: chunk.dateTo });
        fixtures += fetched.length;
        const publishedItems = await database.$transaction((transaction) => persistResultsInTransaction(transaction as unknown as PrismaClient, fetched));
        published.push(...publishedItems);
        results += publishedItems.length;
      }
    } catch (error) {
      // One league failing stays isolated: RESULT_FIXTURE_UNRESOLVED signals the fixtures
      // must be backfilled first; 401/403 is a permanent subscription rejection.
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      const unresolved = error instanceof Error && error.message === "Result fixture identity is unresolved";
      const reason = unresolved ? "RESULT_FIXTURE_UNRESOLVED"
        : statusCode === 401 || statusCode === 403 ? "PROVIDER_ACCESS_RESTRICTED"
        : "PROVIDER_REQUEST_FAILED";
      console.info(JSON.stringify({ event: "results-sync.league_failed", league: league.name, reason }));
      return { league: league.name, status: "failed", fixtures, results, reason };
    }
    return { league: league.name, status: "synced", fixtures, results };
  }

  /** Replicates the worker settlement contract (workers/data-sync/src/queues/index.ts) with a
   * locally constructed bullmq Queue: same queue name, options, job name, payload and jobId —
   * one idempotent job per issued snapshot per published result. */
  private async enqueueSettlements(published: readonly { fixtureId: string; resultVersionId: string }[]): Promise<void> {
    const redisUrl = this.config.REDIS_URL!;
    const queue = new Queue<SettlementJobData>(settlementQueueName(process.env.QUEUE_PREFIX ?? "bet-stats"), { connection: { url: redisUrl, maxRetriesPerRequest: null } });
    const correlationId = randomUUID();
    try {
      for (const item of published) {
        const forecasts = await this.database!.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM "ForecastSnapshot" WHERE "fixtureId"=$1 AND state='ISSUED' AND kind IN ('PRE_MATCH','LINEUP_CONFIRMED') ORDER BY id`,
          item.fixtureId,
        );
        for (const forecast of forecasts) {
          const data: SettlementJobData = { fixtureId: item.fixtureId, resultVersionId: item.resultVersionId, forecastSnapshotId: forecast.id, policyVersion: "settlement-policy-v1", policyHash: SETTLEMENT_PIPELINE_POLICY_HASH, correlationId };
          await queue.add("settlement", data, {
            attempts: SETTLEMENT_MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: 1_000, jitter: 0.25 },
            removeOnComplete: { age: 86_400, count: 1_000 },
            removeOnFail: { age: 604_800, count: 5_000 },
            jobId: settlementJobId(data).replaceAll(":", "-"),
          });
        }
      }
    } finally {
      await queue.close();
    }
  }
}
