import { BadRequestException, Injectable, NotFoundException, Optional, type OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const ROOT_CAUSE = /^[A-Z0-9][A-Z0-9_.:-]{0,127}$/;
const MAX_GROUPS = 50;

type ReadinessFact = { postgres: boolean; redis: boolean; checkedAt: Date };
type ProviderHealthFact = { provider: string; endpointFamily: string; state: string; lastSuccessAt: Date | null; reason: string | null };
type QuotaFact = { provider: string; endpointFamily: string; used: number; effectiveAllowance: number | null; resetAt: Date | null; criticalReservations: number };
type FailureFact = { id: string; rootCause: string; impact: "BLOCKING" | "DEGRADED"; scope: string; occurredAt: Date; retryable: boolean; correlationId: string | null };
type DataQualityFact = { code: string; scope: string; count: number; firstOccurrence: Date; lastOccurrence: Date };
type IncidentFact = { id: string; status: "OPEN" | "RESOLVED"; impact: "BLOCKING" | "DEGRADED"; summary: string; startedAt: Date; lastUpdatedAt: Date; correlationId: string | null };

export interface OperationsRepository {
  readiness(): Promise<ReadinessFact>;
  providerHealth(since: Date): Promise<ProviderHealthFact[]>;
  quotas(since: Date): Promise<QuotaFact[]>;
  failures(since: Date): Promise<FailureFact[]>;
  dataQuality(since: Date): Promise<DataQualityFact[]>;
  incidents(since: Date): Promise<IncidentFact[]>;
}

export type OperationsQuery = Readonly<{ page?: number; pageSize?: number; windowHours?: number; impact?: "BLOCKING" | "DEGRADED"; rootCause?: string }>;

function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
function safeCorrelation(value: string | null): string | null { return value && CORRELATION.test(value) ? value : null; }
function safeCode(value: string | null | undefined, fallback = "UNKNOWN"): string { return value && ROOT_CAUSE.test(value) ? value : fallback; }
function safeIdentity(value: string): string { return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/.test(value) ? value : "unavailable"; }

function validateQuery(raw: OperationsQuery): Required<Pick<OperationsQuery, "page" | "pageSize" | "windowHours">> & Pick<OperationsQuery, "impact" | "rootCause"> {
  const allowed = new Set(["page", "pageSize", "windowHours", "impact", "rootCause"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
  const page = raw.page ?? 1; const pageSize = raw.pageSize ?? 25; const windowHours = raw.windowHours ?? 24;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25 || !Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
  if (raw.impact && raw.impact !== "BLOCKING" && raw.impact !== "DEGRADED") throw new BadRequestException("INVALID_OPERATIONS_QUERY");
  if (raw.rootCause && !ROOT_CAUSE.test(raw.rootCause)) throw new BadRequestException("INVALID_OPERATIONS_QUERY");
  return { page, pageSize, windowHours, ...(raw.impact ? { impact: raw.impact } : {}), ...(raw.rootCause ? { rootCause: raw.rootCause } : {}) };
}

export function createOperationsProjection(repository: OperationsRepository, now = () => new Date()) {
  return {
    async overview(raw: OperationsQuery) {
      const query = validateQuery(raw);
      const since = new Date(now().getTime() - query.windowHours * 3_600_000);
      const [readiness, providerHealth, quotas, rawFailures, dataQuality, incidents] = await Promise.all([
        repository.readiness(), repository.providerHealth(since), repository.quotas(since), repository.failures(since), repository.dataQuality(since), repository.incidents(since),
      ]);
      const failures = rawFailures
        .map((failure) => ({ ...failure, rootCause: safeCode(failure.rootCause), scope: safeIdentity(failure.scope), correlationId: safeCorrelation(failure.correlationId) }))
        .filter((failure) => (!query.impact || failure.impact === query.impact) && (!query.rootCause || failure.rootCause === query.rootCause))
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || left.id.localeCompare(right.id));
      const grouped = new Map<string, { rootCause: string; impact: "BLOCKING" | "DEGRADED"; scope: string; count: number; first: Date; last: Date; retryable: boolean; correlations: Set<string> }>();
      for (const failure of failures) {
        const key = `${failure.rootCause}\0${failure.impact}\0${failure.scope}`;
        const group = grouped.get(key) ?? { rootCause: failure.rootCause, impact: failure.impact, scope: failure.scope, count: 0, first: failure.occurredAt, last: failure.occurredAt, retryable: failure.retryable, correlations: new Set<string>() };
        group.count += 1; group.first = failure.occurredAt < group.first ? failure.occurredAt : group.first; group.last = failure.occurredAt > group.last ? failure.occurredAt : group.last; group.retryable &&= failure.retryable;
        if (failure.correlationId) group.correlations.add(failure.correlationId);
        grouped.set(key, group);
      }
      const offset = (query.page - 1) * query.pageSize;
      const jobs = failures.slice(offset, offset + query.pageSize).map((failure) => ({ id: safeIdentity(failure.id), rootCause: failure.rootCause, impact: failure.impact, scope: failure.scope, occurredAt: iso(failure.occurredAt)!, retryable: failure.retryable, correlationId: failure.correlationId }));
      const total = failures.length;
      return {
        readiness: { state: readiness.postgres && readiness.redis ? "READY" as const : readiness.postgres || readiness.redis ? "DEGRADED" as const : "NOT_READY" as const, services: [{ name: "PostgreSQL", state: readiness.postgres ? "AVAILABLE" as const : "UNAVAILABLE" as const }, { name: "Redis", state: readiness.redis ? "AVAILABLE" as const : "UNAVAILABLE" as const }], lastCheckedAt: iso(readiness.checkedAt)! },
        providerHealth: providerHealth.slice(0, MAX_GROUPS).map((fact) => ({ provider: safeIdentity(fact.provider), endpointFamily: safeCode(fact.endpointFamily), circuitState: safeCode(fact.state), lastSuccessfulObservationAt: iso(fact.lastSuccessAt), reason: fact.reason ? safeCode(fact.reason) : null })),
        quotas: quotas.slice(0, MAX_GROUPS).map((fact) => ({ provider: safeIdentity(fact.provider), endpointFamily: safeCode(fact.endpointFamily), used: fact.used, effectiveAllowance: fact.effectiveAllowance, percentage: fact.effectiveAllowance && fact.effectiveAllowance > 0 ? Math.min(100, Math.round(fact.used / fact.effectiveAllowance * 100)) : null, resetAt: iso(fact.resetAt), criticalReservations: fact.criticalReservations })),
        failures: { groups: [...grouped.values()].sort((left, right) => left.rootCause.localeCompare(right.rootCause) || (left.impact === right.impact ? 0 : left.impact === "BLOCKING" ? -1 : 1) || left.scope.localeCompare(right.scope)).slice(0, MAX_GROUPS).map((group) => ({ rootCause: group.rootCause, impact: group.impact, scope: group.scope, count: group.count, firstOccurrence: iso(group.first)!, lastOccurrence: iso(group.last)!, retryable: group.retryable, correlationIds: [...group.correlations].slice(0, 5) })), jobs, pagination: { page: query.page, pageSize: query.pageSize, total, start: total === 0 ? 0 : offset + 1, end: Math.min(total, offset + query.pageSize), pages: Math.ceil(total / query.pageSize) } },
        dataQuality: dataQuality.slice(0, MAX_GROUPS).map((fact) => ({ code: safeCode(fact.code), scope: safeIdentity(fact.scope), count: fact.count, firstOccurrence: iso(fact.firstOccurrence)!, lastOccurrence: iso(fact.lastOccurrence)! })),
        incidents: incidents.slice(0, MAX_GROUPS).map((fact) => ({ id: safeIdentity(fact.id), status: fact.status, impact: fact.impact, summary: safeCode(fact.summary, "PROVIDER_DEGRADED"), startedAt: iso(fact.startedAt)!, lastUpdatedAt: iso(fact.lastUpdatedAt)!, correlationId: safeCorrelation(fact.correlationId) })),
      };
    },
  };
}

export function createPrismaOperationsRepository(database: PrismaClient, clock = () => new Date()): OperationsRepository {
  return {
    async readiness() {
      let postgres = false;
      try { await database.$queryRawUnsafe("SELECT 1"); postgres = true; } catch { postgres = false; }
      return { postgres, redis: process.env.REDIS_READY === "true", checkedAt: clock() };
    },
    async providerHealth(since) {
      const circuits = await database.providerCircuitState.findMany({ where: { updatedAt: { gte: since } }, orderBy: [{ provider: "asc" }, { endpointFamily: "asc" }], take: MAX_GROUPS, select: { provider: true, endpointFamily: true, state: true, lastError: true } });
      return Promise.all(circuits.map(async (circuit) => ({ provider: circuit.provider, endpointFamily: circuit.endpointFamily, state: circuit.state, reason: circuit.lastError, lastSuccessAt: (await database.sourceObservation.findFirst({ where: { provider: circuit.provider, endpointFamily: circuit.endpointFamily }, orderBy: [{ observedAt: "desc" }, { id: "desc" }], select: { observedAt: true } }))?.observedAt ?? null })));
    },
    async quotas(since) {
      const observations = await database.providerQuotaObservation.findMany({ where: { observedAt: { gte: since } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: 250, select: { provider: true, endpointFamily: true, observedLimit: true, observedRemaining: true, resetAt: true, observedAt: true } });
      const latest = new Map<string, typeof observations[number]>();
      for (const observation of observations) { const key = `${observation.provider}\0${observation.endpointFamily}`; if (!latest.has(key)) latest.set(key, observation); }
      return Promise.all([...latest.values()].slice(0, MAX_GROUPS).map(async (observation) => ({ provider: observation.provider, endpointFamily: observation.endpointFamily, used: observation.observedLimit !== null && observation.observedRemaining !== null ? Math.max(0, observation.observedLimit - observation.observedRemaining) : 0, effectiveAllowance: observation.observedLimit, resetAt: observation.resetAt, criticalReservations: await database.providerThrottleReservation.count({ where: { provider: observation.provider, endpointFamily: observation.endpointFamily, reservedAt: { gte: since } } }) })));
    },
    async failures(since) {
      const attempts = await database.syncAttempt.findMany({ where: { state: "FAILED", startedAt: { gte: since } }, orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: 250, select: { id: true, classifiedReason: true, startedAt: true, syncRun: { select: { logicalKey: true, correlationId: true, provider: true, endpointFamily: true } } } });
      return attempts.map((attempt) => ({ id: attempt.syncRun.logicalKey, rootCause: attempt.classifiedReason ?? "UNCLASSIFIED_FAILURE", impact: /QUARANTINE|IDENTITY|PAYLOAD/.test(attempt.classifiedReason ?? "") ? "BLOCKING" as const : "DEGRADED" as const, scope: `${attempt.syncRun.provider}/${attempt.syncRun.endpointFamily}`, occurredAt: attempt.startedAt, retryable: /TIMEOUT|RATE|5XX|UNAVAILABLE/.test(attempt.classifiedReason ?? ""), correlationId: attempt.syncRun.correlationId }));
    },
    async dataQuality(since) {
      const cases = await database.reconciliationCase.groupBy({ by: ["entityType", "provider"], where: { status: "OPEN", openedAt: { gte: since } }, _count: { _all: true }, _min: { openedAt: true }, _max: { openedAt: true }, orderBy: { _count: { provider: "desc" } }, take: MAX_GROUPS });
      return cases.map((row) => ({ code: "IDENTITY_AMBIGUOUS", scope: `${row.entityType}/${row.provider}`, count: row._count._all, firstOccurrence: row._min.openedAt!, lastOccurrence: row._max.openedAt! }));
    },
    async incidents(since) {
      const circuits = await database.providerCircuitState.findMany({ where: { state: { in: ["OPEN", "HALF_OPEN"] }, updatedAt: { gte: since } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: MAX_GROUPS, select: { id: true, provider: true, endpointFamily: true, state: true, openedAt: true, updatedAt: true } });
      return circuits.map((row) => ({ id: row.id, status: "OPEN" as const, impact: row.state === "OPEN" ? "BLOCKING" as const : "DEGRADED" as const, summary: `CIRCUIT_${row.state}`, startedAt: row.openedAt ?? row.updatedAt, lastUpdatedAt: row.updatedAt, correlationId: null }));
    },
  };
}

@Injectable()
export class OperationsService implements OnModuleDestroy {
  private readonly projection: ReturnType<typeof createOperationsProjection> | null;
  private readonly ownedClient: PrismaClient | null;
  constructor(@Optional() database?: PrismaClient) {
    this.ownedClient = database ? null : process.env.DATABASE_URL ? createPrismaClient(process.env.DATABASE_URL) : null;
    const client = database ?? this.ownedClient;
    this.projection = client ? createOperationsProjection(createPrismaOperationsRepository(client)) : null;
  }
  overview(query: OperationsQuery) { if (!this.projection) throw new NotFoundException("Not found"); return this.projection.overview(query); }
  async onModuleDestroy() { await this.ownedClient?.$disconnect(); }
}
