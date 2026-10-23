import { BadRequestException, Injectable, NotFoundException, Optional, type OnModuleDestroy } from "@nestjs/common";
import { DEFAULT_BACKUP_DRILL_INTERVAL_HOURS, DEFAULT_BACKUP_RETENTION_COUNT, readBackupConfig, redactSecrets } from "@bet-stats/config";
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

// --- Backup read model (BAK-03) ------------------------------------------------

export type BackupState = "NOT_CONFIGURED" | "NEVER_VERIFIED" | "STALE" | "FAILED" | "HEALTHY";

/** Raw repository rows (Dates intact) — state is computed at read time, never stored (T-08-15, D-14). */
export type BackupRows = {
  configured: boolean;
  lastBackup: { fileName: string; byteSize: number | null; sha256: string | null; durationMs: number; completedAt: Date; status: string; offsiteStatus: string } | null;
  lastDrill: { overall: string; completedAt: Date; restoreDurationMs: number; containerCleanup: string; failedChecks: string[] } | null;
  retentionCount: number;
  drillIntervalHours: number;
};

/** Closed, secret-free projection DTO: file names (basenames), sizes, timestamps, durations, reason codes and check outcomes only (D-15). */
export type BackupFact = {
  configured: boolean;
  state: BackupState;
  lastBackup: { fileName: string; byteSize: number | null; sha256: string | null; durationMs: number; completedAt: string; status: string; offsiteStatus: string } | null;
  backupStale: boolean;
  lastDrill: { overall: string; completedAt: string; restoreDurationMs: number; containerCleanup: string; failedChecks: string[] } | null;
  drillStale: boolean;
  retentionCount: number;
  drillIntervalHours: number;
};

/** Daily cadence + 1h grace: a successful dump older than 25h renders STALE (D-14). */
export const BACKUP_FRESH_MS = 25 * 3_600_000;
/** Drill interval + 24h grace: an older receipt renders drill-stale (D-14). */
export const DRILL_GRACE_MS = 24 * 3_600_000;
const MAX_FAILED_CHECKS = 10;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

/** System-generated dump names are basenames by construction; anything else
 *  collapses to "unavailable" so a directory path can never cross the boundary. */
function safeFileName(value: string | null): string | null {
  if (!value) return null;
  const base = value.split(/[\\/]/).pop() ?? "";
  return FILE_NAME.test(base) ? base : "unavailable";
}

/** Check names are safe codes (kebab/underscore identifiers and table names);
 *  anything else is stripped so receipt JSON keys cannot smuggle data out. */
function safeCheckName(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64); }

/** Extracts the names of every FAILED entry from the receipt checks JSON
 *  (bounded) — evidence names only, never the underlying excerpts. */
export function failedDrillChecks(checks: unknown): string[] {
  const failed: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (failed.length >= MAX_FAILED_CHECKS) return;
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.state === "FAILED") { if (path) failed.push(safeCheckName(path)); return; }
      for (const [key, entry] of Object.entries(record)) visit(entry, path ? `${path}.${key}` : key);
    }
  };
  visit(checks, "");
  return failed;
}

/** Five-state computation, fail-closed, always at read time (T-08-15/D-14):
 *  green is impossible without a fresh successful backup AND a passing, fresh drill. */
export function computeBackupFact(rows: BackupRows, now: Date): BackupFact {
  const drillIntervalMs = rows.drillIntervalHours * 3_600_000;
  const backupStale = !rows.lastBackup || now.getTime() - rows.lastBackup.completedAt.getTime() > BACKUP_FRESH_MS;
  const drillStale = !rows.lastDrill || now.getTime() - rows.lastDrill.completedAt.getTime() > drillIntervalMs + DRILL_GRACE_MS;
  const state: BackupState = !rows.configured
    ? "NOT_CONFIGURED"
    : !rows.lastDrill
      ? "NEVER_VERIFIED"
      : rows.lastDrill.overall !== "VERIFIED"
        ? "FAILED"
        : backupStale || drillStale
          ? "STALE"
          : "HEALTHY";
  return {
    configured: rows.configured,
    state,
    lastBackup: rows.lastBackup ? { ...rows.lastBackup, completedAt: iso(rows.lastBackup.completedAt)! } : null,
    backupStale,
    lastDrill: rows.lastDrill ? { ...rows.lastDrill, completedAt: iso(rows.lastDrill.completedAt)! } : null,
    drillStale,
    retentionCount: rows.retentionCount,
    drillIntervalHours: rows.drillIntervalHours,
  };
}

export interface OperationsRepository {
  readiness(): Promise<ReadinessFact>;
  providerHealth(since: Date): Promise<ProviderHealthFact[]>;
  quotas(since: Date): Promise<QuotaFact[]>;
  failures(since: Date): Promise<FailureFact[]>;
  dataQuality(since: Date): Promise<DataQualityFact[]>;
  incidents(since: Date): Promise<IncidentFact[]>;
  backups(): Promise<BackupRows>;
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
      const current = now();
      const since = new Date(current.getTime() - query.windowHours * 3_600_000);
      const [readiness, providerHealth, quotas, rawFailures, dataQuality, incidents, backupRows] = await Promise.all([
        repository.readiness(), repository.providerHealth(since), repository.quotas(since), repository.failures(since), repository.dataQuality(since), repository.incidents(since), repository.backups(),
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
        // D-15: belt-and-braces redactSecrets pass — the closed BackupFact carries
        // basenames, sizes, instants, durations and reason codes, nothing else.
        backups: redactSecrets(computeBackupFact(backupRows, current)) as BackupFact,
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
    async backups() {
      // Explicit selects on closed scalars only — raw rows, metadata and logs
      // never cross the boundary (Phase 06 projection discipline, T-08-13).
      const config = readBackupConfig(process.env);
      const [lastSuccess, lastReceipt] = await Promise.all([
        database.backupRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { fileName: true, byteSize: true, sha256: true, durationMs: true, completedAt: true, status: true, offsiteStatus: true } }),
        database.backupVerificationReceipt.findFirst({ orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { overall: true, completedAt: true, restoreDurationMs: true, containerCleanup: true, checks: true } }),
      ]);
      return {
        configured: config.enabled && Boolean(config.dir),
        lastBackup: lastSuccess ? { fileName: safeFileName(lastSuccess.fileName) ?? "unavailable", byteSize: lastSuccess.byteSize, sha256: lastSuccess.sha256, durationMs: lastSuccess.durationMs, completedAt: lastSuccess.completedAt, status: safeCode(lastSuccess.status, "UNKNOWN"), offsiteStatus: safeCode(lastSuccess.offsiteStatus, "NOT_CONFIGURED") } : null,
        lastDrill: lastReceipt ? { overall: safeCode(lastReceipt.overall, "UNVERIFIED"), completedAt: lastReceipt.completedAt, restoreDurationMs: lastReceipt.restoreDurationMs, containerCleanup: safeCode(lastReceipt.containerCleanup, "FAILED"), failedChecks: failedDrillChecks(lastReceipt.checks) } : null,
        retentionCount: config.retentionCount ?? DEFAULT_BACKUP_RETENTION_COUNT,
        drillIntervalHours: config.drillIntervalHours ?? DEFAULT_BACKUP_DRILL_INTERVAL_HOURS,
      };
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
