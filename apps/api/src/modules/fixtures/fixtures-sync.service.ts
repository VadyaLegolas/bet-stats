import { BadRequestException, ServiceUnavailableException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import { readServerConfig } from "@bet-stats/config";
import { createPrismaClient, createProviderRoutingRepository, type PrismaClient } from "@bet-stats/database";
import { evaluateCapability, PROVIDER_ROUTE_POLICY_VERSION, reservePriorityRequest, routeReceiptContentHash, type ProviderRouteReceiptContent } from "@bet-stats/domain";
import { createProviderRoute, FootballDataOrgClient, isConfiguredCompetitionCode } from "@bet-stats/football-data";

import { CRITICAL_HEADROOM, DAILY_ALLOWANCE, PROVIDER } from "./fixtures-budget.js";

const SYNC_WINDOW_DAYS = 7;
/** Skip a league when its provenance is fresher than this unless the caller forces a sync. */
export const MIN_SYNC_INTERVAL_MS = 6 * 3_600_000;
/** Free tier allows 10 provider requests/minute (rolling); space consecutive fetches to stay
 * under it. 3_000 ms could burst 20/min, so every provider fetch waits 6_500 ms first. */
export const PROVIDER_MIN_SPACING_MS = 6_500;
/** One provider call per chunk; 31 days mirrors the replay WINDOW_TOO_LARGE bound. */
const SYNC_CHUNK_DAYS = 31;
/** Longest operator-requested backfill window (days, inclusive). */
const SYNC_MAX_SPAN_DAYS = 400;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Module-level so the fixtures and results sync services pace against ONE shared timer —
 * both hit the same provider minute budget, so separate timers could still burst. */
let lastProviderFetchAt = 0;
export async function waitForProviderSpacing(): Promise<void> {
  const waitMs = lastProviderFetchAt + PROVIDER_MIN_SPACING_MS - Date.now();
  if (waitMs > 0) await delay(waitMs);
  lastProviderFetchAt = Date.now();
}

function assertDateOnly(field: string, value: string): void {
  if (!DATE_ONLY.test(value)) throw new BadRequestException(`${field} must be a YYYY-MM-DD UTC date`);
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} must be a valid calendar date`);
}

/** Resolves an optional YYYY-MM-DD window (defaults preserve today..+7d) and enforces
 * format, ordering and the 400-day span bound; violations reject with 400. */
export function resolveSyncDateRange(input: { dateFrom?: string; dateTo?: string }, defaults: { from: string; to: string }): { dateFrom: string; dateTo: string } {
  const dateFrom = input.dateFrom ?? defaults.from;
  const dateTo = input.dateTo ?? defaults.to;
  assertDateOnly("dateFrom", dateFrom);
  assertDateOnly("dateTo", dateTo);
  const fromMs = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const toMs = Date.parse(`${dateTo}T00:00:00.000Z`);
  if (fromMs > toMs) throw new BadRequestException("dateFrom must not be after dateTo");
  if (toMs - fromMs > SYNC_MAX_SPAN_DAYS * 86_400_000) throw new BadRequestException(`Date range must not exceed ${SYNC_MAX_SPAN_DAYS} days`);
  return { dateFrom, dateTo };
}

/** Splits a range into inclusive windows of at most SYNC_CHUNK_DAYS days so any span costs
 * one provider call per chunk per league (a season backfill is ~13 calls, not 460). */
export function chunkSyncDateRange(dateFrom: string, dateTo: string): Array<{ dateFrom: string; dateTo: string }> {
  const chunks: Array<{ dateFrom: string; dateTo: string }> = [];
  let cursor = Date.parse(`${dateFrom}T00:00:00.000Z`);
  const end = Date.parse(`${dateTo}T00:00:00.000Z`);
  while (cursor <= end) {
    const chunkEnd = Math.min(cursor + (SYNC_CHUNK_DAYS - 1) * 86_400_000, end);
    chunks.push({ dateFrom: new Date(cursor).toISOString().slice(0, 10), dateTo: new Date(chunkEnd).toISOString().slice(0, 10) });
    cursor = chunkEnd + 86_400_000;
  }
  return chunks;
}

export type SyncLeagueResult = { league: string; status: "synced" | "skipped" | "denied" | "failed"; fixtures: number; reason?: string };

/**
 * MVP manual ingestion: fetches upcoming fixtures from football-data.org and persists them
 * with the same canonical semantics as the worker path (external refs first, provenance
 * append-only). Gated by ProviderCapability and the daily request budget, so repeated use
 * can never exceed the provider allowance. The worker remains the scheduled/replay
 * ingestion owner; this service exists so a local user can pull fresh data on demand.
 */
@Injectable()
export class FixturesSyncService implements OnModuleDestroy {
  private readonly config = readServerConfig(process.env);
  private readonly database: PrismaClient | null = this.config.DATABASE_URL ? createPrismaClient(this.config.DATABASE_URL) : null;
  async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }

  availability(): { enabled: boolean; reason?: string } {
    if (this.config.DATA_PROVIDER_MODE !== "live") return { enabled: false, reason: "DETERMINISTIC_MODE" };
    if (!this.database) return { enabled: false, reason: "DATABASE_NOT_CONFIGURED" };
    if (!this.config.FOOTBALL_DATA_API_TOKEN) return { enabled: false, reason: "PROVIDER_TOKEN_NOT_CONFIGURED" };
    return { enabled: true };
  }

  /** Serializes sync runs: overlapping requests (multiple tabs, auto + manual) must not
   * race the external-ref reads, or they would duplicate canonical fixtures. */
  private pending: Promise<unknown> = Promise.resolve();

  async sync(input: { competitions?: readonly string[]; force?: boolean; dateFrom?: string; dateTo?: string }): Promise<{ results: readonly SyncLeagueResult[] }> {
    const now = new Date();
    // Defaults keep the historical behavior exactly: today .. today+SYNC_WINDOW_DAYS.
    const range = resolveSyncDateRange(input, { from: now.toISOString().slice(0, 10), to: new Date(now.getTime() + SYNC_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10) });
    const availability = this.availability();
    if (!availability.enabled) throw new ServiceUnavailableException({ message: "Fixtures sync is not available", reason: availability.reason });
    const task = this.pending.then(async () => {
      const database = this.database!;
      const targets = await this.resolveLeagues(database, input.competitions);
      const results: SyncLeagueResult[] = [];
      for (const target of targets) results.push(await this.syncLeague(target, now, range, input.force === true));
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

  private async syncLeague(league: Awaited<ReturnType<PrismaClient["league"]["findFirst"]>> & { id: string; name: string; countryCode: string; externalRefs: Array<{ externalId: string }> }, now: Date, range: { dateFrom: string; dateTo: string }, force: boolean): Promise<SyncLeagueResult> {
    const database = this.database!;
    const code = league.externalRefs[0]?.externalId;
    if (!code || !isConfiguredCompetitionCode(code)) return { league: league.name, status: "denied", fixtures: 0, reason: "PROVIDER_MAPPING_MISSING" };

    const seasons = await database.season.findMany({ where: { leagueId: league.id, externalRefs: { some: { provider: PROVIDER } } }, include: { externalRefs: { where: { provider: PROVIDER } } } });
    const season = seasons.find((row) => row.startsOn <= now && now <= row.endsOn) ?? [...seasons].sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime())[0];
    if (!season) return { league: league.name, status: "denied", fixtures: 0, reason: "SEASON_NOT_CONFIGURED" };

    const capability = await database.providerCapability.findUnique({ where: { provider_leagueId_seasonId_endpoint: { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "FIXTURES" } } });
    const decision = evaluateCapability(capability ?? undefined, { provider: PROVIDER, leagueId: league.id, seasonId: season.id, endpoint: "FIXTURES" }, now);
    if (!decision.allowed) return { league: league.name, status: "denied", fixtures: 0, reason: decision.reason };

    if (!force) {
      const latest = await database.$queryRawUnsafe<Array<{ observedAt: Date | null }>>(
        `SELECT MAX(p."observedAt") AS "observedAt" FROM "FixtureProvenance" p JOIN "Fixture" f ON f.id = p."fixtureId" WHERE f."leagueId" = $1`,
        league.id,
      );
      const observedAt = latest[0]?.observedAt ? new Date(latest[0].observedAt).getTime() : null;
      if (observedAt !== null && now.getTime() - observedAt < MIN_SYNC_INTERVAL_MS) return { league: league.name, status: "skipped", fixtures: 0, reason: "RECENTLY_SYNCED" };
    }

    // One run stamp per sync run: every league and chunk of this run shares it, so the
    // per-chunk jobKey below deduplicates only re-runs of the same chunk, never chunks.
    const runStamp = now.toISOString();

    // Raw provider match objects of this run; handed to the FIXTURES route receipt's
    // SourceObservation once the league run succeeds (see recordRouteReceipt).
    const rawMatches: Array<Readonly<Record<string, unknown>>> = [];

    let persisted = 0;
    for (const chunk of chunkSyncDateRange(range.dateFrom, range.dateTo)) {
      // Reserve budget per chunk, not per league: one reservation row per provider fetch
      // per run keeps the daily API-budget accounting accurate (observed 7-for-21 under-count
      // when a single jobKey covered the whole chunked run).
      const reservation = await reservePriorityRequest({
        database,
        provider: PROVIDER,
        resetDate: runStamp.slice(0, 10),
        resetTimezone: "UTC",
        endpointFamily: "FIXTURES",
        lane: "critical",
        configuredAllowance: DAILY_ALLOWANCE,
        criticalHeadroom: CRITICAL_HEADROOM,
        jobKey: `manual-fixtures-sync:${code}:${chunk.dateFrom}:${chunk.dateTo}:${runStamp}`,
      });
      if (!reservation.reserved) return { league: league.name, status: "denied", fixtures: persisted, reason: reservation.reason };
      let fixtures: Awaited<ReturnType<FootballDataOrgClient["fetchCompetitionFixtures"]>>;
      try {
        await waitForProviderSpacing();
        const client = new FootballDataOrgClient({ apiToken: this.config.FOOTBALL_DATA_API_TOKEN! });
        // All statuses: a past window must return FINISHED matches so their canonical rows
        // and FixtureExternalRef exist for ResultsSyncService identity resolution.
        fixtures = await client.fetchCompetitionFixtures({
          competitionCode: code,
          dateFrom: chunk.dateFrom,
          dateTo: chunk.dateTo,
        }, { allStatuses: true });
      } catch (error) {
        const statusCode = (error as { statusCode?: number } | null)?.statusCode;
        // 401/403 mean the subscription does not cover this resource — retrying cannot help.
        if (statusCode === 401 || statusCode === 403) return { league: league.name, status: "failed", fixtures: persisted, reason: "PROVIDER_ACCESS_RESTRICTED" };
        return { league: league.name, status: "failed", fixtures: persisted, reason: "PROVIDER_REQUEST_FAILED" };
      }
      for (const fixture of fixtures) {
        rawMatches.push(fixture.raw);
        const fixtureSeasonId = await this.resolveSeasonRef(database, league.id, season.id, fixture.seasonExternalId);
        if (!fixtureSeasonId) continue;
        const homeTeamId = await this.ensureTeam(database, fixture.provider, fixture.homeTeamExternalId, fixture.homeTeamName, league.countryCode);
        const awayTeamId = await this.ensureTeam(database, fixture.provider, fixture.awayTeamExternalId, fixture.awayTeamName, league.countryCode);
        const reference = await database.fixtureExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.externalId } } });
        let fixtureId: string;
        if (reference) {
          fixtureId = reference.fixtureId;
          await database.fixture.update({ where: { id: fixtureId }, data: { kickoffUtc: new Date(fixture.kickoffUtc), status: fixture.status } });
        } else {
          const candidateId = randomUUID();
          try {
            await database.$transaction([
              database.fixture.create({ data: { id: candidateId, leagueId: league.id, seasonId: fixtureSeasonId, homeTeamId, awayTeamId, kickoffUtc: new Date(fixture.kickoffUtc), status: fixture.status } }),
              database.fixtureExternalRef.create({ data: { id: randomUUID(), fixtureId: candidateId, provider: fixture.provider, externalId: fixture.externalId } }),
            ]);
            fixtureId = candidateId;
          } catch (error) {
            // A concurrent writer won the external-ref race; adopt its canonical fixture
            // (the transaction rolled our candidate back).
            const winner = await database.fixtureExternalRef.findUnique({ where: { provider_externalId: { provider: fixture.provider, externalId: fixture.externalId } } });
            if (!winner) throw error;
            fixtureId = winner.fixtureId;
            await database.fixture.update({ where: { id: fixtureId }, data: { kickoffUtc: new Date(fixture.kickoffUtc), status: fixture.status } });
          }
        }
        const payloadHash = createHash("sha256").update(JSON.stringify(fixture.raw)).digest("hex");
        // Freshness = how recently WE confirmed the fixture with the provider (see the
        // project() comment in fixtures.service.ts), so re-syncing an unchanged payload
        // must move observedAt forward; id, fixtureId and rawPayload are never updated,
        // keeping payload-hash row identity and raw evidence immutable.
        await database.$executeRawUnsafe(
          `INSERT INTO "FixtureProvenance" (id, "fixtureId", provider, "observedAt", "sourceUpdatedAt", "payloadHash", "rawPayload") VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb) ON CONFLICT ("provider", "payloadHash") DO UPDATE SET "observedAt" = EXCLUDED."observedAt", "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt"`,
          randomUUID(), fixtureId, fixture.provider, fixture.capturedAt, fixture.sourceUpdatedAt, payloadHash, JSON.stringify(fixture.raw),
        );
        persisted += 1;
      }
    }
    await this.recordRouteReceipt({ database, leagueId: league.id, seasonId: season.id, seasonLabel: season.label, code, range, runStamp, now, rawMatches });
    return { league: league.name, status: "synced", fixtures: persisted };
  }

  /** Durable provider-route end-state for a successful league run: one FIXTURES
   * SourceObservation over the run's raw payload, one ADMITTED receipt and one SUCCEEDED
   * attempt. Invoked ONLY on the status "synced" path — skipped, denied and failed runs
   * return before it, so coverage is never claimed without a successful provider call. */
  private async recordRouteReceipt(input: {
    database: PrismaClient;
    leagueId: string;
    seasonId: string;
    seasonLabel: string;
    code: string;
    range: { dateFrom: string; dateTo: string };
    runStamp: string;
    now: Date;
    rawMatches: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }): Promise<void> {
    const correlationId = `manual-fixtures-sync:${input.code}:${input.runStamp}`;
    const route = createProviderRoute({ competition: input.code, season: input.seasonLabel, endpoint: "FIXTURES" });
    // Sole-source (api-football) leagues must never be claimed by a football-data.org
    // sync: return without recording (assertRouteReceipt would reject it anyway).
    if (!route.candidates.includes(PROVIDER)) return;
    const content: ProviderRouteReceiptContent = {
      policyVersion: PROVIDER_ROUTE_POLICY_VERSION,
      policyHash: `sha256:${createHash("sha256").update(route.version).digest("hex")}`,
      competitionId: input.leagueId,
      seasonId: input.seasonId,
      endpointFamily: route.endpoint,
      candidates: [...route.candidates],
      selectedProvider: PROVIDER,
      trigger: "PRIMARY",
      outcome: "ADMITTED",
      capabilitySnapshot: { status: "SUPPORTED" },
      budgetSnapshot: { configuredAllowance: DAILY_ALLOWANCE },
      circuitSnapshot: { state: "CLOSED" },
      correlationId,
    };
    const serialized = JSON.stringify({ correlationId, competitionCode: input.code, dateFrom: input.range.dateFrom, dateTo: input.range.dateTo, matches: input.rawMatches });
    const payloadHash = createHash("sha256").update(serialized).digest("hex");
    // Worker dedupe pattern (findFirst by exact hash, create when absent): the correlation
    // id inside the payload makes the hash unique per run, so observedAt truthfully equals
    // the latest confirmation while identical runs reuse one immutable observation row.
    const existing = await input.database.sourceObservation.findFirst({ where: { provider: PROVIDER, endpointFamily: route.endpoint, payloadHash } });
    const observation = existing ?? await input.database.sourceObservation.create({
      data: { id: randomUUID(), provider: PROVIDER, endpointFamily: route.endpoint, externalIdentity: correlationId, observedAt: input.now, payloadHash, rawPayload: JSON.parse(serialized), payloadBytes: Buffer.byteLength(serialized) },
    });
    const receiptId = `${route.version}:${input.leagueId}:${input.seasonId}:${route.endpoint}:${correlationId}`;
    const repository = createProviderRoutingRepository({ database: input.database });
    await repository.appendRoute({ id: receiptId, contentHash: routeReceiptContentHash(content), ...content });
    // Appended directly instead of admitAttempt/completeAttempt: the live manual path has
    // already gated admission before each fetch (evaluateCapability + reservePriorityRequest),
    // and a post-hoc admitAttempt would re-gate an already-succeeded call (it can deny on
    // circuit/quota/throttle facts and requires a CLOSED circuit row), contradicting the
    // observed success — the receipt+attempt shapes still match the worker's durable end-state.
    // A recording error propagates to the sync caller exactly like persistence errors today.
    await repository.appendAttempt({
      id: `${receiptId}:attempt:result`,
      routeReceiptId: receiptId,
      attemptKey: `${receiptId}:result`,
      provider: PROVIDER,
      state: "SUCCEEDED",
      reason: null,
      observationId: observation.id,
      admitted: true,
    });
  }

  /** football-data.org season IDs are opaque (e.g. "2502"), so the canonical season is the
   * date-contained row and its external ref self-heals to the real ID on first fetch. */
  private async resolveSeasonRef(database: PrismaClient, leagueId: string, seasonId: string, externalId: string): Promise<string | null> {
    const existing = await database.seasonExternalRef.findFirst({ where: { provider: PROVIDER, leagueId, externalId } });
    if (existing) return existing.seasonId;
    const stale = await database.seasonExternalRef.findFirst({ where: { provider: PROVIDER, seasonId } });
    if (stale) {
      await database.seasonExternalRef.update({ where: { id: stale.id }, data: { externalId } });
      return stale.seasonId;
    }
    await database.seasonExternalRef.create({ data: { id: randomUUID(), seasonId, leagueId, provider: PROVIDER, externalId } }).catch(() => undefined);
    const created = await database.seasonExternalRef.findFirst({ where: { provider: PROVIDER, leagueId, externalId } });
    return created?.seasonId ?? null;
  }

  private async ensureTeam(database: PrismaClient, provider: string, externalId: string, name: string, countryCode: string): Promise<string> {
    const existing = await database.teamExternalRef.findUnique({ where: { provider_externalId: { provider, externalId } } });
    if (existing) return existing.teamId;
    try {
      return await database.$transaction(async (tx) => {
        const team = await tx.team.create({ data: { name, normalizedName: name.trim().toLowerCase(), countryCode } });
        await tx.teamExternalRef.create({ data: { id: randomUUID(), teamId: team.id, provider, externalId } });
        return team.id;
      });
    } catch (error) {
      // A concurrent writer registered the team first; adopt its canonical team.
      const winner = await database.teamExternalRef.findUnique({ where: { provider_externalId: { provider, externalId } } });
      if (!winner) throw error;
      return winner.teamId;
    }
  }
}
