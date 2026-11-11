import { randomUUID } from "node:crypto";

import { readBackupConfig } from "@bet-stats/config";
import type { PrismaClient } from "@bet-stats/database";

// --- Public shapes -----------------------------------------------------------------

export type AlertSeverity = "CRITICAL" | "WARNING";

/** One fired signal occurrence returned by an adapter; null-ish adapters return no entries. */
export type SignalEvaluation = Readonly<{
  signal: string;
  scope: string;
  severity: AlertSeverity;
  correlationIds: string[];
  firstSeen: Date;
  lastSeen: Date;
}>;

export type WebhookConfig = Readonly<{ webhookUrl?: string | undefined; webhookTimeoutMs?: number | undefined }>;

export type Logger = (event: Readonly<Record<string, unknown>>) => void;

export const defaultLog: Logger = (event) => console.info(JSON.stringify(event));

/** Minimal Redis read surface — keys carry only prefix + minute index (T-09-07). */
export type BucketReader = { get(key: string): Promise<string | null> };

/** Minimal BullMQ failed-set surface (queues/index.ts inspector.getFailed pattern). */
export type DeadLetterJob = Readonly<{ name?: string | null; failedReason?: string | null }>;
export type DeadLetterInspector = { getFailed(start: number, end: number): Promise<DeadLetterJob[]> };

// --- Thresholds (D-03, D-09, D-10, D-11, D-12) --------------------------------------

export const DEFAULT_ALERTS_TICK_MS = 300_000; // default evaluator tick: 5 minutes
export const QUOTA_WARNING_RATIO = 0.8; // >=80% → WARNING (D-10)
export const SYNC_FAILURE_WINDOW_MS = 10 * 60_000; // >=5 FAILED in 10 min → WARNING (D-11)
export const SYNC_FAILURE_BURST = 5;
export const HTTP5XX_WINDOW_MINUTES = 5; // rolling 5-minute window (D-09)
/** Bucket prefixes — byte-identical to apps/api http-5xx-bucket.filter.ts (worker
 *  tsconfig rootDir cannot import apps/api; guarded by unit tests). */
export const HTTP5XX_BUCKET_PREFIX = "bet-stats:http5xx:";
export const HTTPTOTAL_BUCKET_PREFIX = "bet-stats:httpTotal:";
export const HTTP5XX_MIN_VOLUME = 10; // minimum-volume guard: <10 requests cannot page (D-09)
export const HTTP5XX_WARNING_RATIO = 0.1; // >=10% 5xx → WARNING (D-09)
/** Hard threshold → CRITICAL (D-03 "5xx hard threshold"). The ratio+volume guard
 *  is specified numerically in the discussion log; the hard tier is not, so it is
 *  pinned here: half the window's traffic erroring is a hard outage. */
export const HTTP5XX_CRITICAL_RATIO = 0.5;
/** Mirrors BACKUP_FRESH_MS from apps/api operations.service.ts (computeBackupFact
 *  read-time rule, D-12): STALE >= 25h → WARNING. The worker tsconfig rootDir
 *  cannot import apps/api, so the value is pinned here and guarded by unit tests. */
export const BACKUP_STALE_MS = 25 * 3_600_000;
/** >=48h without a successful dump → CRITICAL (D-03). */
export const BACKUP_CRITICAL_MS = 48 * 3_600_000;
const BLOCKING_ROOT_CAUSE = /QUARANTINE|IDENTITY|PAYLOAD/;
const MAX_CORRELATION_IDS = 5;
const MAX_GROUPS = 50;

export function alertFingerprint(signal: string, scope: string): string {
  return `${signal}\0${scope}`;
}

// --- Signal adapters ----------------------------------------------------------------

/**
 * Quota signal (D-10): latest ProviderQuotaObservation per provider/endpointFamily.
 * >=80% → WARNING; >=100% or critical reservations held → CRITICAL. A natural
 * quota reset drops the ratio and the adapter stops firing (auto-resolution).
 */
export async function evaluateQuota(database: PrismaClient, now: Date): Promise<SignalEvaluation[]> {
  const since = new Date(now.getTime() - SYNC_FAILURE_WINDOW_MS);
  const observations = await database.providerQuotaObservation.findMany({
    where: { observedAt: { gte: since } },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take: 250,
    select: { provider: true, endpointFamily: true, observedLimit: true, observedRemaining: true, observedAt: true },
  });
  const latest = new Map<string, (typeof observations)[number]>();
  for (const observation of observations) {
    const key = `${observation.provider}\0${observation.endpointFamily}`;
    if (!latest.has(key)) latest.set(key, observation);
  }
  const evaluations: SignalEvaluation[] = [];
  for (const observation of latest.values()) {
    const criticalReservations = await database.providerThrottleReservation.count({
      where: { provider: observation.provider, endpointFamily: observation.endpointFamily, reservedAt: { gte: since } },
    });
    const used = observation.observedLimit !== null && observation.observedRemaining !== null
      ? Math.max(0, observation.observedLimit - observation.observedRemaining)
      : 0;
    const ratio = observation.observedLimit && observation.observedLimit > 0 ? used / observation.observedLimit : 0;
    const severity: AlertSeverity | null = criticalReservations > 0 || ratio >= 1 ? "CRITICAL" : ratio >= QUOTA_WARNING_RATIO ? "WARNING" : null;
    if (!severity) continue;
    evaluations.push({
      signal: "PROVIDER_QUOTA",
      scope: `${observation.provider}/${observation.endpointFamily}`,
      severity,
      correlationIds: [],
      firstSeen: observation.observedAt,
      lastSeen: now,
    });
    if (evaluations.length >= MAX_GROUPS) break;
  }
  return evaluations;
}

/**
 * Circuit signal (D-03): latest ProviderCircuitState per provider — OPEN →
 * CRITICAL on first detection; HALF_OPEN → WARNING (flap-damped, 2 consecutive
 * ticks via shouldWarn); CLOSED rows are filtered out by the query and never alert.
 */
export async function evaluateCircuit(database: PrismaClient, now: Date): Promise<SignalEvaluation[]> {
  const rows = await database.providerCircuitState.findMany({
    where: { state: { in: ["OPEN", "HALF_OPEN"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: MAX_GROUPS,
    select: { provider: true, endpointFamily: true, state: true, openedAt: true, updatedAt: true },
  });
  return rows.map((row) => ({
    signal: "PROVIDER_CIRCUIT",
    scope: `${row.provider}/${row.endpointFamily}`,
    severity: row.state === "OPEN" ? ("CRITICAL" as const) : ("WARNING" as const),
    correlationIds: [],
    firstSeen: row.openedAt ?? row.updatedAt,
    lastSeen: now,
  }));
}

/**
 * Sync-failure signal (D-11): groups SyncAttempt FAILED rows by rootCause+scope —
 * individual job failures never open an alert. Any BLOCKING root cause
 * (QUARANTINE|IDENTITY|PAYLOAD) → CRITICAL regardless of count; >=5 non-blocking
 * failures inside the 10-minute window → WARNING.
 */
export async function evaluateSyncFailures(database: PrismaClient, now: Date): Promise<SignalEvaluation[]> {
  const since = new Date(now.getTime() - SYNC_FAILURE_WINDOW_MS);
  const attempts = await database.syncAttempt.findMany({
    where: { state: "FAILED", startedAt: { gte: since } },
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
    take: 250,
    select: { classifiedReason: true, startedAt: true, syncRun: { select: { correlationId: true, provider: true, endpointFamily: true } } },
  });
  const groups = new Map<string, { rootCause: string; scope: string; count: number; first: Date; last: Date; correlations: string[] }>();
  for (const attempt of attempts) {
    const rootCause = attempt.classifiedReason ?? "UNCLASSIFIED_FAILURE";
    const scope = `${attempt.syncRun.provider}/${attempt.syncRun.endpointFamily}`;
    const key = `${rootCause}\0${scope}`;
    const group = groups.get(key) ?? { rootCause, scope, count: 0, first: attempt.startedAt, last: attempt.startedAt, correlations: [] };
    group.count += 1;
    if (attempt.startedAt < group.first) group.first = attempt.startedAt;
    if (attempt.startedAt > group.last) group.last = attempt.startedAt;
    if (attempt.syncRun.correlationId && !group.correlations.includes(attempt.syncRun.correlationId) && group.correlations.length < MAX_CORRELATION_IDS) {
      group.correlations.push(attempt.syncRun.correlationId);
    }
    groups.set(key, group);
  }
  const evaluations: SignalEvaluation[] = [];
  for (const group of groups.values()) {
    const blocking = BLOCKING_ROOT_CAUSE.test(group.rootCause);
    if (!blocking && group.count < SYNC_FAILURE_BURST) continue;
    evaluations.push({
      signal: "SYNC_FAILURES",
      scope: `${group.rootCause}@${group.scope}`,
      severity: blocking ? "CRITICAL" : "WARNING",
      correlationIds: group.correlations,
      firstSeen: group.first,
      lastSeen: group.last,
    });
    if (evaluations.length >= MAX_GROUPS) break;
  }
  return evaluations;
}

/**
 * Dead-letter signal: reads the BullMQ failed set via inspector.getFailed and
 * alerts per job name + root cause — never per individual job. A dead-lettered
 * blocking root cause is CRITICAL (D-03); everything else is WARNING.
 */
export async function evaluateDeadLetters(inspector: DeadLetterInspector, now: Date): Promise<SignalEvaluation[]> {
  const pageSize = 100;
  const groups = new Map<string, { jobName: string; rootCause: string; count: number; last: Date }>();
  for (let start = 0; ; start += pageSize) {
    const failed = await inspector.getFailed(start, start + pageSize - 1);
    for (const job of failed) {
      const jobName = job.name ?? "UNKNOWN";
      const rootCause = extractRootCause(job.failedReason);
      const key = `${jobName}\0${rootCause}`;
      const group = groups.get(key) ?? { jobName, rootCause, count: 0, last: now };
      group.count += 1;
      groups.set(key, group);
    }
    if (failed.length < pageSize) break;
  }
  const evaluations: SignalEvaluation[] = [];
  for (const group of groups.values()) {
    evaluations.push({
      signal: "DEAD_LETTER",
      scope: `${group.jobName}/${group.rootCause}`,
      severity: BLOCKING_ROOT_CAUSE.test(group.rootCause) ? "CRITICAL" : "WARNING",
      correlationIds: [],
      firstSeen: now,
      lastSeen: group.last,
    });
    if (evaluations.length >= MAX_GROUPS) break;
  }
  return evaluations;
}

/** Root-cause codes are safe-code-shaped; anything else collapses to UNKNOWN. */
function extractRootCause(failedReason: string | null | undefined): string {
  const match = /^[A-Z0-9][A-Z0-9_.-]*/.exec(failedReason?.trim() ?? "");
  return match ? match[0] : "UNKNOWN";
}

/**
 * 5xx signal (D-09): sums the per-minute Redis buckets written by Plan 03's
 * Http5xxBucketFilter over a rolling 5-minute window. Fires only when the
 * window holds >= 10 requests (minimum-volume guard so low traffic cannot
 * page) and the 5xx ratio is >= 10% → WARNING, >= hard threshold → CRITICAL.
 */
export async function evaluate5xx(redis: BucketReader, now: Date): Promise<SignalEvaluation[]> {
  const currentMinute = Math.floor(now.getTime() / 60_000);
  let fives = 0;
  let total = 0;
  for (let offset = 0; offset < HTTP5XX_WINDOW_MINUTES; offset += 1) {
    const index = currentMinute - offset;
    const [fivesRaw, totalRaw] = await Promise.all([
      redis.get(`${HTTP5XX_BUCKET_PREFIX}${index}`),
      redis.get(`${HTTPTOTAL_BUCKET_PREFIX}${index}`),
    ]);
    fives += parseBucket(fivesRaw);
    total += parseBucket(totalRaw);
  }
  if (total < HTTP5XX_MIN_VOLUME || fives === 0) return [];
  const ratio = fives / total;
  const severity: AlertSeverity | null = ratio >= HTTP5XX_CRITICAL_RATIO ? "CRITICAL" : ratio >= HTTP5XX_WARNING_RATIO ? "WARNING" : null;
  if (!severity) return [];
  return [{
    signal: "HTTP_5XX",
    scope: "http",
    severity,
    correlationIds: [],
    firstSeen: new Date((currentMinute - HTTP5XX_WINDOW_MINUTES + 1) * 60_000),
    lastSeen: now,
  }];
}

function parseBucket(raw: string | null): number {
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Backup-staleness signal (D-12): reuses the computeBackupFact read-time rule
 * (see BACKUP_STALE_MS note). NOT_CONFIGURED does not alert; FAILED drill or
 * >=48h without a successful dump → CRITICAL; STALE (>=25h) → WARNING.
 */
export async function evaluateBackupStaleness(database: PrismaClient, now: Date): Promise<SignalEvaluation[]> {
  const config = readBackupConfig(process.env);
  if (!config.enabled || !config.dir) return [];
  const [lastSuccess, lastReceipt] = await Promise.all([
    database.backupRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { completedAt: true } }),
    database.backupVerificationReceipt.findFirst({ orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { overall: true, completedAt: true } }),
  ]);
  const sinceSuccessMs = lastSuccess ? now.getTime() - lastSuccess.completedAt.getTime() : Number.POSITIVE_INFINITY;
  const drillFailed = lastReceipt !== null && lastReceipt.overall !== "VERIFIED";
  const severity: AlertSeverity | null = drillFailed || sinceSuccessMs >= BACKUP_CRITICAL_MS
    ? "CRITICAL"
    : sinceSuccessMs >= BACKUP_STALE_MS
      ? "WARNING"
      : null;
  if (!severity) return [];
  return [{
    signal: "BACKUP_STALENESS",
    scope: "backup",
    severity,
    correlationIds: [],
    firstSeen: lastSuccess?.completedAt ?? now,
    lastSeen: now,
  }];
}

// --- Flap damping (WARNING requires 2 consecutive ticks) -----------------------------

/** Consecutive-WARNING-tick counters per fingerprint, held by the evaluator owner. */
export type WarningTickState = Map<string, number>;

export function createWarningTickState(): WarningTickState {
  return new Map();
}

/**
 * WARNING opens only after 2 consecutive ticks (flap damping); CRITICAL opens
 * on first detection and resets the WARNING streak for its fingerprint.
 */
export function shouldWarn(state: WarningTickState, fingerprint: string, severity: AlertSeverity): boolean {
  if (severity === "CRITICAL") {
    state.delete(fingerprint);
    return true;
  }
  const consecutive = (state.get(fingerprint) ?? 0) + 1;
  state.set(fingerprint, consecutive);
  return consecutive >= 2;
}

// --- Dedup upsert + lifecycle (D-04, D-05) -------------------------------------------

export type DedupAction = "open" | "escalation" | "re-open" | "occurrence";

export type DedupOutcome = Readonly<{
  alert: Readonly<{ id: string; signal: string; scope: string; severity: string; status: string; count: number; firstSeen: Date; lastSeen: Date }>;
  action: DedupAction;
}>;

function mergeCorrelations(existing: unknown, incoming: readonly string[]): string[] {
  const merged: string[] = [];
  if (Array.isArray(existing)) {
    for (const value of existing) {
      if (typeof value === "string" && !merged.includes(value)) merged.push(value);
    }
  }
  for (const value of incoming) {
    if (!merged.includes(value)) merged.push(value);
  }
  return merged.slice(0, MAX_CORRELATION_IDS);
}

async function appendTransition(
  database: PrismaClient,
  alertId: string,
  from: string,
  to: string,
  severityFrom: string | null,
  severityTo: string | null,
  at: Date,
): Promise<void> {
  await database.opsAlertTransition.create({ data: { id: randomUUID(), alertId, from, to, severityFrom, severityTo, at } });
}

/**
 * Dedup upsert (D-04): exactly one OPEN row per dedupFingerprint (signal\0scope).
 * Occurrences bump count/lastSeen and never insert. A RESOLVED fingerprint that
 * fires again re-opens the existing row (status → OPEN, resolvedAt cleared,
 * transition appended) and is dispatched as a re-open notification (D-05).
 * Severity escalates in place with an OpsAlertTransition row.
 */
export async function dedupUpsert(database: PrismaClient, evaluation: SignalEvaluation, now: Date): Promise<DedupOutcome> {
  const fingerprint = alertFingerprint(evaluation.signal, evaluation.scope);
  const existing = await database.opsAlert.findUnique({ where: { dedupFingerprint: fingerprint } });
  if (!existing) {
    const alert = await database.opsAlert.create({
      data: {
        id: randomUUID(),
        dedupFingerprint: fingerprint,
        signal: evaluation.signal,
        scope: evaluation.scope,
        severity: evaluation.severity,
        status: "OPEN",
        count: 1,
        firstSeen: evaluation.firstSeen,
        lastSeen: evaluation.lastSeen,
        correlationIds: [...evaluation.correlationIds],
        acknowledgedAt: null,
        resolvedAt: null,
      },
    });
    return { alert, action: "open" };
  }
  const reopened = existing.status === "RESOLVED";
  const escalated = existing.severity !== evaluation.severity;
  const alert = await database.opsAlert.update({
    where: { dedupFingerprint: fingerprint },
    data: {
      severity: evaluation.severity,
      ...(reopened ? { status: "OPEN", resolvedAt: null } : {}),
      count: { increment: 1 },
      lastSeen: evaluation.lastSeen,
      correlationIds: mergeCorrelations(existing.correlationIds, evaluation.correlationIds),
    },
  });
  let action: DedupAction = "occurrence";
  if (reopened) {
    await appendTransition(database, alert.id, "RESOLVED", "OPEN", existing.severity, evaluation.severity, now);
    action = "re-open";
  } else if (escalated) {
    await appendTransition(database, alert.id, existing.status, existing.status, existing.severity, evaluation.severity, now);
    action = "escalation";
  }
  return { alert, action };
}

/**
 * Auto-resolution (D-04): every OPEN/ACKNOWLEDGED alert whose fingerprint did
 * NOT fire this tick transitions to RESOLVED with resolvedAt set and an
 * immutable OpsAlertTransition row — no operator action required.
 */
async function resolveClearedAlerts(database: PrismaClient, fired: ReadonlySet<string>, now: Date): Promise<void> {
  const open = await database.opsAlert.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    select: { id: true, status: true, severity: true, dedupFingerprint: true },
  });
  for (const alert of open) {
    if (fired.has(alert.dedupFingerprint)) continue;
    await database.opsAlert.update({ where: { id: alert.id }, data: { status: "RESOLVED", resolvedAt: now } });
    await appendTransition(database, alert.id, alert.status, "RESOLVED", alert.severity, alert.severity, now);
  }
}

// --- Webhook dispatch (T-09-04, T-09-06) ---------------------------------------------

export type WebhookPayload = Readonly<{
  event: "alert_opened" | "alert_escalated" | "alert_reopened" | "delivery_probe";
  signal: string;
  scope: string;
  severity: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  correlationIds: string[];
}>;

export type DispatchResult = Readonly<{ delivered: boolean; attempts: number }>;

export type DispatchOptions = Readonly<{
  timeoutMs?: number | undefined;
  maxAttempts?: number | undefined;
  baseBackoffMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
  log?: Logger | undefined;
  recordDelivery?: ((attempt: number, httpStatus: number | null, errorCode: string | null, at: Date) => Promise<void>) | undefined;
}>;

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;
export const MAX_DISPATCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

/**
 * Outbound webhook dispatch with typed allowlist payload only (T-09-04): native
 * fetch, redirect:"manual" (a 3xx is a failure, never a silent follow), per-
 * attempt AbortSignal.timeout, bounded retries with exponential backoff + jitter,
 * Retry-After honored on 429. Every attempt is appended to OpsAlertDelivery by
 * the caller's recordDelivery hook (T-09-06) — a failed channel never loses the
 * alert because the alert state lives in PostgreSQL, not in delivery (D-02).
 * The webhook URL itself is never logged.
 */
export async function dispatchWebhook(url: string, payload: WebhookPayload, options: DispatchOptions = {}): Promise<DispatchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? MAX_DISPATCH_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? BASE_BACKOFF_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? defaultLog;
  const body = JSON.stringify(payload);
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    let httpStatus: number | null = null;
    let errorCode: string | null = null;
    let retryAfterMs: number | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      httpStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        await options.recordDelivery?.(attempt, httpStatus, null, now());
        return { delivered: true, attempts: attempt };
      }
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = header === null ? Number.NaN : Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = seconds * 1000;
      }
    } catch (error) {
      // Error names only — messages could echo the URL, which must never leak.
      errorCode = error instanceof Error ? (error.name === "AbortError" || error.name === "TimeoutError" ? "TIMEOUT" : error.name) : "UNKNOWN";
    }
    await options.recordDelivery?.(attempt, httpStatus, errorCode ?? `HTTP_${httpStatus}`, now());
    if (attempt < maxAttempts) {
      const backoff = retryAfterMs ?? baseBackoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseBackoffMs);
      await sleep(backoff);
    }
  }
  log({ event: "alerts.webhook_delivery_failed", attempts: attempt });
  return { delivered: false, attempts: attempt };
}

// --- Evaluator tick -------------------------------------------------------------------

export type EvaluateAndDispatchOptions = Readonly<{
  inspector?: DeadLetterInspector | null | undefined;
  state?: WarningTickState | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}>;

/**
 * One evaluation cycle: run all six signal adapters, auto-resolve cleared
 * fingerprints (D-04), upsert deduplicated alerts with flap damping, and
 * dispatch to the webhook only on open/escalation/re-open (D-05 anti-fatigue).
 * Without ALERT_WEBHOOK_URL the dispatch is skipped but detection continues —
 * no alert is lost (D-02): the state lives in PostgreSQL.
 */
export async function evaluateAndDispatch(
  database: PrismaClient,
  redis: BucketReader,
  now: () => Date,
  webhookConfig: WebhookConfig,
  log: Logger = defaultLog,
  options: EvaluateAndDispatchOptions = {},
): Promise<void> {
  const at = now();
  const [quotas, circuits, syncFailures, deadLetters, fivexx, backups] = await Promise.all([
    evaluateQuota(database, at),
    evaluateCircuit(database, at),
    evaluateSyncFailures(database, at),
    options.inspector ? evaluateDeadLetters(options.inspector, at) : Promise.resolve<SignalEvaluation[]>([]),
    evaluate5xx(redis, at),
    evaluateBackupStaleness(database, at),
  ]);
  const evaluations = [...quotas, ...circuits, ...syncFailures, ...deadLetters, ...fivexx, ...backups];
  const fired = new Map<string, SignalEvaluation>();
  for (const evaluation of evaluations) fired.set(alertFingerprint(evaluation.signal, evaluation.scope), evaluation);

  const state = options.state ?? moduleWarningTickState;
  for (const key of [...state.keys()]) {
    if (!fired.has(key)) state.delete(key);
  }
  const actionable = evaluations.filter((evaluation) => shouldWarn(state, alertFingerprint(evaluation.signal, evaluation.scope), evaluation.severity));

  await resolveClearedAlerts(database, new Set(fired.keys()), at);

  const url = webhookConfig.webhookUrl;
  for (const evaluation of actionable) {
    const outcome = await dedupUpsert(database, evaluation, at);
    if (!url) continue; // unconfigured channel: detection continues, no alert lost (D-02)
    if (outcome.action === "occurrence") continue; // D-05: no per-occurrence notifications
    const event = outcome.action === "open" ? "alert_opened" : outcome.action === "escalation" ? "alert_escalated" : "alert_reopened";
    const payload: WebhookPayload = {
      event,
      signal: outcome.alert.signal,
      scope: outcome.alert.scope,
      severity: outcome.alert.severity,
      count: outcome.alert.count,
      firstSeen: outcome.alert.firstSeen.toISOString(),
      lastSeen: outcome.alert.lastSeen.toISOString(),
      correlationIds: evaluation.correlationIds,
    };
    await dispatchWebhook(url, payload, {
      timeoutMs: webhookConfig.webhookTimeoutMs,
      sleep: options.sleep,
      now,
      log,
      recordDelivery: async (attempt, httpStatus, errorCode, deliveryAt) => {
        await database.opsAlertDelivery.create({ data: { id: randomUUID(), alertId: outcome.alert.id, at: deliveryAt, httpStatus, errorCode, attempt } });
      },
    });
  }
}

/** Module-level damping state for callers that do not inject one. */
const moduleWarningTickState: WarningTickState = createWarningTickState();

// --- Interval scheduler (scheduleRetentionPurge pattern) -------------------------------

export type AlertingScheduler = Readonly<{ close(): void }>;

const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * Self-closing interval chain (D-08): one evaluator tick every intervalMs with
 * an injected clock and onError catch-all (T-09-05) — a failing tick never
 * crashes the worker and close() prevents timer leaks.
 */
export function scheduleAlertingTick(input: {
  database: PrismaClient;
  redis: BucketReader;
  intervalMs: number;
  webhookConfig: WebhookConfig;
  onError: (error: unknown) => void;
  now?: () => Date;
  log?: Logger;
  inspector?: DeadLetterInspector | null;
  state?: WarningTickState;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}): AlertingScheduler {
  const now = input.now ?? (() => new Date());
  const log = input.log ?? defaultLog;
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      await evaluateAndDispatch(input.database, input.redis, now, input.webhookConfig, log, { inspector: input.inspector ?? null, state: input.state });
    } catch (error) {
      log({ event: "alerts.tick_failed", error: error instanceof Error ? error.message : "UNKNOWN" });
      input.onError(error);
    }
    if (!closed) timer = setTimer(() => { void tick(); }, input.intervalMs);
  };

  timer = setTimer(() => { void tick(); }, 0);
  return {
    close: () => {
      closed = true;
      if (timer) clearTimer(timer);
    },
  };
}
