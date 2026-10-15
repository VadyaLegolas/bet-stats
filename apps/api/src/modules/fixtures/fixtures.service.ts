import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { readFreshnessThresholds, readServerConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { classifyFreshness, type DataStateProjection } from "@bet-stats/domain";

import { DAILY_ALLOWANCE, PROVIDER, PROVIDER_MINUTE_LIMIT, PROVIDER_MINUTE_WINDOW_SECONDS } from "./fixtures-budget.js";

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_RANGE_MS = 31 * 86_400_000;
export type SyncQuota = { provider: string; daily: { used: number; allowance: number; remaining: number; resetAt: string; resetTimezone: "UTC" }; minute: { used: number; limit: number; remaining: number; windowSeconds: number } };
export type ProviderStateProjection = { state: "PRIMARY" | "FALLBACK" | "PENDING" | "UNAVAILABLE" | "LIMITED" | "UNSUPPORTED" | "STALE_CAPABILITY" | "BUDGET_PROTECTED" | "CIRCUIT_DENIED"; provider: string; reason: string; capturedAt: string | null; lastValidAt: string | null; retryAllowed: boolean; receipt: { id: string; policyVersion: string; outcome: string; trigger: string } | null };
export type FixtureProjection = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: DataStateProjection<null>; providerState: ProviderStateProjection };
type FixtureRow = { id: string; kickoffUtc: Date; status: string; updatedAt: Date; league: { id: string; name: string }; season: { id: string; label: string }; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; provenance: Array<{ provider: string; observedAt: Date; sourceUpdatedAt: Date | null }> };

const deterministicRow: FixtureRow = { id: "fixture-premier-league-001", kickoffUtc: new Date("2026-08-29T14:00:00.000Z"), status: "SCHEDULED", updatedAt: new Date("2026-08-28T18:45:00.000Z"), league: { id: "league-premier-league", name: "Premier League" }, season: { id: "season-2026", label: "2026/27" }, homeTeam: { id: "team-arsenal", name: "Arsenal" }, awayTeam: { id: "team-chelsea", name: "Chelsea" }, provenance: [{ provider: "deterministic", observedAt: new Date("2026-08-28T18:45:00.000Z"), sourceUpdatedAt: null }] };

/** Keeps the deterministic row permanently inside the default 48-hour window: its kickoff is
 * today's 14:00 UTC while that is still ahead, otherwise tomorrow's 14:00 UTC. Stable within
 * a calendar day, so list and detail always agree. Provenance (and therefore LIMITED state,
 * which depends only on `sourceUpdatedAt: null`) is left untouched. */
function deterministicFixtureRow(now: Date): FixtureRow {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14, 0, 0, 0));
  return { ...deterministicRow, kickoffUtc: slot.getTime() > now.getTime() ? slot : new Date(slot.getTime() + 86_400_000) };
}

function parseUtc(value: string, name: string): Date {
  if (!UTC_INSTANT.test(value)) throw new BadRequestException(`${name} must be an ISO 8601 UTC instant`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException(`${name} must be a valid UTC instant`);
  return parsed;
}
function parseRange(fromValue?: string, toValue?: string): { from: Date; to: Date } {
  const from = fromValue === undefined ? new Date() : parseUtc(fromValue, "from");
  const to = toValue === undefined ? new Date(from.getTime() + 48 * 3_600_000) : parseUtc(toValue, "to");
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException("Fixture range must be positive and no longer than 31 days");
  return { from, to };
}
type RouteRow = { id: string; policyVersion: string; selectedProvider: string | null; candidates: unknown; trigger: string; outcome: string; createdAt: Date; attempts: Array<{ state: string; provider: string | null; reason: string | null; createdAt: Date; observation: { observedAt: Date } | null }> };
export function projectProviderState(route: RouteRow | null, lastValidAt: string | null = null): ProviderStateProjection {
  if (!route) return { state: "PENDING", provider: "unknown", reason: "ROUTE_PENDING", capturedAt: null, lastValidAt: null, retryAllowed: true, receipt: null };
  const candidates = Array.isArray(route.candidates) ? route.candidates.filter((item): item is string => typeof item === "string") : [];
  const latest = route.attempts.at(-1);
  const succeeded = [...route.attempts].reverse().find((attempt) => attempt.state === "SUCCEEDED" && attempt.observation);
  const failedPrimary = route.attempts.find((attempt) => attempt.state === "FAILED");
  const terminalNoFallback = [...route.attempts].reverse().find((attempt) => attempt.state === "NO_FALLBACK");
  const effective = succeeded ?? terminalNoFallback ?? latest;
  const effectiveProvider = effective?.provider ?? route.selectedProvider ?? candidates[0] ?? "unknown";
  const effectiveTrigger = failedPrimary?.reason ?? effective?.reason ?? route.trigger;
  const effectiveOutcome = succeeded ? "SUCCEEDED" : terminalNoFallback ? "NO_FALLBACK" : route.outcome;
  const capturedAt = succeeded?.observation?.observedAt.toISOString() ?? null;
  const soleSource = candidates.length === 1;
  let state: ProviderStateProjection["state"] = succeeded ? (candidates.indexOf(effectiveProvider) > 0 ? "FALLBACK" : "PRIMARY") : "UNAVAILABLE";
  let reason = effectiveTrigger;
  if (terminalNoFallback && soleSource) { state = "LIMITED"; reason = "NO_PRODUCTION_FALLBACK"; }
  else if (effectiveTrigger === "UNSUPPORTED_CAPABILITY") state = "UNSUPPORTED";
  else if (effectiveTrigger === "STALE_CAPABILITY" || effectiveTrigger === "EXPIRED_CAPABILITY") state = "STALE_CAPABILITY";
  else if (effectiveTrigger === "CRITICAL_HEADROOM" || effectiveTrigger === "ALLOWANCE_EXHAUSTED") state = "BUDGET_PROTECTED";
  else if (effectiveTrigger === "CIRCUIT_OPEN") state = "CIRCUIT_DENIED";
  return { state, provider: effectiveProvider, reason, capturedAt, lastValidAt: state === "LIMITED" ? lastValidAt : null, retryAllowed: state !== "PRIMARY" && state !== "FALLBACK", receipt: { id: route.id, policyVersion: route.policyVersion, outcome: effectiveOutcome, trigger: effectiveTrigger } };
}
function project(row: FixtureRow, providerState: ProviderStateProjection): FixtureProjection {
  const source = row.provenance[0];
  const capturedAt = source?.observedAt ?? row.updatedAt;
  const threshold = readFreshnessThresholds().fixture;
  const base = classifyFreshness({ state: source ? "AVAILABLE" : "LIMITED", reason: source ? "PROVIDER_OBSERVATION_RECORDED" : "PROVENANCE_NOT_AVAILABLE", provider: source?.provider ?? "unknown", capturedAt: capturedAt.toISOString(), sourceUpdatedAt: source?.sourceUpdatedAt?.toISOString() ?? null, value: null }, threshold, capturedAt);
  // A scheduled fixture's provider record is only touched when the schedule changes, so
  // record age alone is not staleness. Freshness = how recently WE confirmed the fixture
  // with the provider; the payload keeps the provider's truthful update time.
  const observationStale = Date.now() - capturedAt.getTime() > threshold;
  const dataState = base.state === "STALE" && !observationStale
    ? { ...base, state: "AVAILABLE" as const, reason: "PROVIDER_OBSERVATION_RECORDED" }
    : base.state === "AVAILABLE" && observationStale
      ? { ...base, state: "STALE" as const, reason: "FRESHNESS_THRESHOLD_EXCEEDED" }
      : base;
  return { id: row.id, competition: { id: row.league.id, name: row.league.name, season: row.season.label }, teams: { home: row.homeTeam, away: row.awayTeam }, kickoff: row.kickoffUtc.toISOString(), status: row.status, dataState, providerState };
}

@Injectable()
export class FixturesService implements OnModuleDestroy {
  private readonly config = readServerConfig(process.env);
  private readonly database: PrismaClient | null = this.config.DATABASE_URL ? createPrismaClient(this.config.DATABASE_URL) : null;
  async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }

  async leagues(): Promise<{ items: readonly string[] }> {
    if (!this.database) return { items: [deterministicRow.league.name] };
    const leagues = await this.database.league.findMany({ where: { externalRefs: { some: { provider: "football-data.org" } } }, orderBy: { name: "asc" }, select: { name: true } });
    return { items: leagues.map((league) => league.name) };
  }

  /** Public quota read for the header counter: provider-wide reservations for the current
   * UTC day (exactly the scope the budget enforcement counts) plus the rolling provider
   * minute window observed from football-data.org response headers. The daily bucket rolls
   * over at 00:00 UTC by construction, so a fresh read is always the reset state. */
  async syncQuota(): Promise<SyncQuota> {
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const minuteCutoff = new Date(now.getTime() - PROVIDER_MINUTE_WINDOW_SECONDS * 1000);
    const countRows = async (sql: string, ...params: unknown[]): Promise<number> => {
      if (!this.database) return 0;
      const rows: Array<{ count: bigint }> = await this.database.$queryRawUnsafe(sql, ...params);
      return Number(rows[0]?.count ?? 0);
    };
    const used = await countRows(`SELECT count(*) AS count FROM "ProviderRequestReservation" WHERE provider = $1 AND "requestDate" = $2::date`, PROVIDER, now.toISOString().slice(0, 10));
    const minuteUsed = await countRows(`SELECT count(*) AS count FROM "ProviderRequestReservation" WHERE provider = $1 AND "reservedAt" >= $2`, PROVIDER, minuteCutoff);
    return {
      provider: PROVIDER,
      daily: { used, allowance: DAILY_ALLOWANCE, remaining: Math.max(0, DAILY_ALLOWANCE - used), resetAt: resetAt.toISOString(), resetTimezone: "UTC" },
      minute: { used: minuteUsed, limit: PROVIDER_MINUTE_LIMIT, remaining: Math.max(0, PROVIDER_MINUTE_LIMIT - minuteUsed), windowSeconds: PROVIDER_MINUTE_WINDOW_SECONDS },
    };
  }

  async list(filters: { from?: string; to?: string; competition?: string }): Promise<{ items: readonly FixtureProjection[]; range: { from: string; to: string } }> {
    const { from, to } = parseRange(filters.from, filters.to);
    if (filters.competition !== undefined && (filters.competition.trim() === "" || filters.competition.length > 100)) throw new BadRequestException("competition must be between 1 and 100 characters");
    const rows: FixtureRow[] = this.database ? await this.database.fixture.findMany({ where: { kickoffUtc: { gte: from, lt: to }, ...(filters.competition ? { league: { name: filters.competition } } : { league: { externalRefs: { some: { provider: "football-data.org" } } } }) }, include: { league: true, season: true, homeTeam: true, awayTeam: true, provenance: { orderBy: { observedAt: "desc" }, take: 1 } }, orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }] }) : [deterministicFixtureRow(new Date())].filter((row) => row.kickoffUtc >= from && row.kickoffUtc < to && (!filters.competition || row.league.name === filters.competition));
    const items = await Promise.all(rows.map(async (row) => project(row, await this.providerState(row))));
    return { items, range: { from: from.toISOString(), to: to.toISOString() } };
  }
  async detail(id: string): Promise<FixtureProjection> {
    const row: FixtureRow | null = this.database ? await this.database.fixture.findUnique({ where: { id }, include: { league: true, season: true, homeTeam: true, awayTeam: true, provenance: { orderBy: { observedAt: "desc" }, take: 1 } } }) : deterministicRow.id === id ? deterministicFixtureRow(new Date()) : null;
    if (!row) throw new NotFoundException("Fixture not found");
    return project(row, await this.providerState(row));
  }
  private async providerState(row: FixtureRow): Promise<ProviderStateProjection> {
    if (!this.database) return projectProviderState(null);
    const route = await this.database.providerRouteReceipt.findFirst({ where: { competitionId: row.league.id, seasonId: row.season.id, endpointFamily: "FIXTURES" }, include: { attempts: { orderBy: { createdAt: "asc" }, include: { observation: { select: { observedAt: true } } } } }, orderBy: { createdAt: "desc" } });
    if (!route) return projectProviderState(null);
    const terminalNoFallback = route.attempts.find((attempt) => attempt.state === "NO_FALLBACK");
    const provider = terminalNoFallback?.provider ?? route.selectedProvider ?? (Array.isArray(route.candidates) && typeof route.candidates[0] === "string" ? route.candidates[0] : null);
    const prior = terminalNoFallback && provider ? await this.database.providerRouteAttempt.findFirst({ where: { provider, state: "SUCCEEDED", observationId: { not: null }, routeReceipt: { competitionId: row.league.id, seasonId: row.season.id, endpointFamily: "FIXTURES" } }, include: { observation: { select: { observedAt: true } } }, orderBy: { createdAt: "desc" } }) : null;
    return projectProviderState(route as unknown as RouteRow, prior?.observation?.observedAt.toISOString() ?? null);
  }
}
