import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy } from "@nestjs/common";
import { readFreshnessThresholds, readServerConfig } from "@bet-stats/config";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { classifyFreshness, type DataStateProjection } from "@bet-stats/domain";

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_RANGE_MS = 31 * 86_400_000;
export type ProviderStateProjection = { state: "PRIMARY" | "FALLBACK" | "PENDING" | "UNAVAILABLE" | "LIMITED" | "UNSUPPORTED" | "STALE_CAPABILITY" | "BUDGET_PROTECTED" | "CIRCUIT_DENIED"; provider: string; reason: string; capturedAt: string | null; lastValidAt: string | null; retryAllowed: boolean; receipt: { id: string; policyVersion: string; outcome: string; trigger: string } | null };
export type FixtureProjection = { id: string; competition: { id: string; name: string; season: string }; teams: { home: { id: string; name: string }; away: { id: string; name: string } }; kickoff: string; status: string; dataState: DataStateProjection<null>; providerState: ProviderStateProjection };
type FixtureRow = { id: string; kickoffUtc: Date; status: string; updatedAt: Date; league: { id: string; name: string }; season: { id: string; label: string }; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; provenance: Array<{ provider: string; observedAt: Date; sourceUpdatedAt: Date | null }> };

const deterministicRow: FixtureRow = { id: "fixture-premier-league-001", kickoffUtc: new Date("2026-08-29T14:00:00.000Z"), status: "SCHEDULED", updatedAt: new Date("2026-08-28T18:45:00.000Z"), league: { id: "league-premier-league", name: "Premier League" }, season: { id: "season-2026", label: "2026/27" }, homeTeam: { id: "team-arsenal", name: "Arsenal" }, awayTeam: { id: "team-chelsea", name: "Chelsea" }, provenance: [{ provider: "deterministic", observedAt: new Date("2026-08-28T18:45:00.000Z"), sourceUpdatedAt: null }] };

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
type RouteRow = { id: string; policyVersion: string; selectedProvider: string | null; candidates: unknown; trigger: string; outcome: string; createdAt: Date; attempts: Array<{ provider: string | null; reason: string | null; createdAt: Date; observation: { observedAt: Date } | null }> };
export function projectProviderState(route: RouteRow | null): ProviderStateProjection {
  if (!route) return { state: "PENDING", provider: "unknown", reason: "ROUTE_PENDING", capturedAt: null, lastValidAt: null, retryAllowed: true, receipt: null };
  const candidates = Array.isArray(route.candidates) ? route.candidates.filter((item): item is string => typeof item === "string") : [];
  const latest = route.attempts.at(-1); const capturedAt = latest?.observation?.observedAt.toISOString() ?? null;
  const soleSource = candidates.length === 1;
  let state: ProviderStateProjection["state"] = route.selectedProvider ? (candidates.indexOf(route.selectedProvider) > 0 ? "FALLBACK" : "PRIMARY") : "UNAVAILABLE";
  let reason = route.trigger;
  if (route.outcome === "NO_FALLBACK" && soleSource) { state = "LIMITED"; reason = "NO_PRODUCTION_FALLBACK"; }
  else if (route.trigger === "UNSUPPORTED_CAPABILITY") state = "UNSUPPORTED";
  else if (route.trigger === "STALE_CAPABILITY") state = "STALE_CAPABILITY";
  else if (route.trigger === "CRITICAL_HEADROOM" || route.trigger === "ALLOWANCE_EXHAUSTED") state = "BUDGET_PROTECTED";
  else if (route.trigger === "CIRCUIT_OPEN") state = "CIRCUIT_DENIED";
  return { state, provider: route.selectedProvider ?? latest?.provider ?? candidates[0] ?? "unknown", reason, capturedAt, lastValidAt: null, retryAllowed: state !== "PRIMARY" && state !== "FALLBACK", receipt: { id: route.id, policyVersion: route.policyVersion, outcome: route.outcome, trigger: route.trigger } };
}
function project(row: FixtureRow, providerState: ProviderStateProjection): FixtureProjection {
  const source = row.provenance[0];
  const capturedAt = source?.observedAt ?? row.updatedAt;
  return { id: row.id, competition: { id: row.league.id, name: row.league.name, season: row.season.label }, teams: { home: row.homeTeam, away: row.awayTeam }, kickoff: row.kickoffUtc.toISOString(), status: row.status, dataState: classifyFreshness({ state: source ? "AVAILABLE" : "LIMITED", reason: source ? "PROVIDER_OBSERVATION_RECORDED" : "PROVENANCE_NOT_AVAILABLE", provider: source?.provider ?? "unknown", capturedAt: capturedAt.toISOString(), sourceUpdatedAt: source?.sourceUpdatedAt?.toISOString() ?? null, value: null }, readFreshnessThresholds().fixture, capturedAt), providerState };
}

@Injectable()
export class FixturesService implements OnModuleDestroy {
  private readonly config = readServerConfig(process.env);
  private readonly database: PrismaClient | null = this.config.DATABASE_URL ? createPrismaClient(this.config.DATABASE_URL) : null;
  async onModuleDestroy(): Promise<void> { await this.database?.$disconnect(); }

  async list(filters: { from?: string; to?: string; competition?: string }): Promise<{ items: readonly FixtureProjection[]; range: { from: string; to: string } }> {
    const { from, to } = parseRange(filters.from, filters.to);
    if (filters.competition !== undefined && (filters.competition.trim() === "" || filters.competition.length > 100)) throw new BadRequestException("competition must be between 1 and 100 characters");
    const rows: FixtureRow[] = this.database ? await this.database.fixture.findMany({ where: { kickoffUtc: { gte: from, lt: to }, ...(filters.competition ? { league: { name: filters.competition } } : {}) }, include: { league: true, season: true, homeTeam: true, awayTeam: true, provenance: { orderBy: { observedAt: "desc" }, take: 1 } }, orderBy: [{ kickoffUtc: "asc" }, { id: "asc" }] }) : [deterministicRow].filter((row) => row.kickoffUtc >= from && row.kickoffUtc < to && (!filters.competition || row.league.name === filters.competition));
    const items = await Promise.all(rows.map(async (row) => project(row, await this.providerState(row))));
    return { items, range: { from: from.toISOString(), to: to.toISOString() } };
  }
  async detail(id: string): Promise<FixtureProjection> {
    const row: FixtureRow | null = this.database ? await this.database.fixture.findUnique({ where: { id }, include: { league: true, season: true, homeTeam: true, awayTeam: true, provenance: { orderBy: { observedAt: "desc" }, take: 1 } } }) : deterministicRow.id === id ? deterministicRow : null;
    if (!row) throw new NotFoundException("Fixture not found");
    return project(row, await this.providerState(row));
  }
  private async providerState(row: FixtureRow): Promise<ProviderStateProjection> {
    if (!this.database) return projectProviderState(null);
    const route = await this.database.providerRouteReceipt.findFirst({ where: { competitionId: row.league.id, seasonId: row.season.id, endpointFamily: "FIXTURES" }, include: { attempts: { orderBy: { createdAt: "asc" }, include: { observation: { select: { observedAt: true } } } } }, orderBy: { createdAt: "desc" } });
    return projectProviderState(route as unknown as RouteRow | null);
  }
}
