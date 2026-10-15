import { ServiceUnavailableException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import { readServerConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { evaluateCapability, reservePriorityRequest } from "@bet-stats/domain";
import { FootballDataOrgClient, isConfiguredCompetitionCode } from "@bet-stats/football-data";

const PROVIDER = "football-data.org";
const SYNC_WINDOW_DAYS = 7;
/** Skip a league when its provenance is fresher than this unless the caller forces a sync. */
const MIN_SYNC_INTERVAL_MS = 6 * 3_600_000;
/** football-data.org free tier: 100 requests/day; headroom keeps critical ingestion viable. */
const DAILY_ALLOWANCE = 100;
const CRITICAL_HEADROOM = 20;
/** Free tier allows 10 provider requests/minute; space consecutive fetches to stay under it. */
const PROVIDER_MIN_SPACING_MS = 3_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  private lastProviderFetchAt = 0;

  async sync(input: { competitions?: readonly string[]; force?: boolean }): Promise<{ results: readonly SyncLeagueResult[] }> {
    const availability = this.availability();
    if (!availability.enabled) throw new ServiceUnavailableException({ message: "Fixtures sync is not available", reason: availability.reason });
    const task = this.pending.then(async () => {
      const database = this.database!;
      const now = new Date();
      const targets = await this.resolveLeagues(database, input.competitions);
      const results: SyncLeagueResult[] = [];
      for (const target of targets) results.push(await this.syncLeague(target, now, input.force === true));
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

  private async syncLeague(league: Awaited<ReturnType<PrismaClient["league"]["findFirst"]>> & { id: string; name: string; countryCode: string; externalRefs: Array<{ externalId: string }> }, now: Date, force: boolean): Promise<SyncLeagueResult> {
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

    const reservation = await reservePriorityRequest({
      database,
      provider: PROVIDER,
      resetDate: now.toISOString().slice(0, 10),
      resetTimezone: "UTC",
      endpointFamily: "FIXTURES",
      lane: "critical",
      configuredAllowance: DAILY_ALLOWANCE,
      criticalHeadroom: CRITICAL_HEADROOM,
      jobKey: `manual-fixtures-sync:${code}:${now.toISOString()}`,
    });
    if (!reservation.reserved) return { league: league.name, status: "denied", fixtures: 0, reason: reservation.reason };

    let fixtures: Awaited<ReturnType<FootballDataOrgClient["fetchCompetitionFixtures"]>>;
    try {
      const waitMs = this.lastProviderFetchAt + PROVIDER_MIN_SPACING_MS - Date.now();
      if (waitMs > 0) await delay(waitMs);
      this.lastProviderFetchAt = Date.now();
      const client = new FootballDataOrgClient({ apiToken: this.config.FOOTBALL_DATA_API_TOKEN! });
      fixtures = await client.fetchCompetitionFixtures({
        competitionCode: code,
        dateFrom: now.toISOString().slice(0, 10),
        dateTo: new Date(now.getTime() + SYNC_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10),
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      // 401/403 mean the subscription does not cover this resource — retrying cannot help.
      if (statusCode === 401 || statusCode === 403) return { league: league.name, status: "failed", fixtures: 0, reason: "PROVIDER_ACCESS_RESTRICTED" };
      return { league: league.name, status: "failed", fixtures: 0, reason: "PROVIDER_REQUEST_FAILED" };
    }

    let persisted = 0;
    for (const fixture of fixtures) {
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
      await database.$executeRawUnsafe(
        `INSERT INTO "FixtureProvenance" (id, "fixtureId", provider, "observedAt", "sourceUpdatedAt", "payloadHash", "rawPayload") VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb) ON CONFLICT ("provider", "payloadHash") DO NOTHING`,
        randomUUID(), fixtureId, fixture.provider, fixture.capturedAt, fixture.sourceUpdatedAt, payloadHash, JSON.stringify(fixture.raw),
      );
      persisted += 1;
    }
    return { league: league.name, status: "synced", fixtures: persisted };
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
