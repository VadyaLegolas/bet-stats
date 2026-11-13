import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@bet-stats/database";

import { dispatchWebhook, alertFingerprint, type DeadLetterInspector, type Logger, type WarningTickState, type WebhookConfig, defaultLog } from "./alerts.js";

// --- Weekly synthetic delivery probe (D-13, T-09-06) ----------------------------------

export const DELIVERY_PROBE_SIGNAL = "DELIVERY_HEALTH";
export const DELIVERY_PROBE_SCOPE = "synthetic";
export const DELIVERY_PROBE_FINGERPRINT = alertFingerprint(DELIVERY_PROBE_SIGNAL, DELIVERY_PROBE_SCOPE);
export const DELIVERY_PROBE_INTERVAL_MS = 7 * 24 * 3_600_000;

export type DeliveryProbeResult = Readonly<{ attempted: boolean; delivered: boolean; alertId: string | null }>;

export type DeliveryProbeOptions = Readonly<{
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
  log?: Logger | undefined;
}>;

/**
 * Anchor row for probe delivery evidence: OpsAlertDelivery.alertId is a hard FK
 * into OpsAlert, so every probe attempt (success included) needs an alert row to
 * attach to. The anchor lives in RESOLVED state while delivery is healthy — it
 * never renders as an active alert and no notification is dispatched for it. This
 * is the "no alert raised" contract of D-13 for the success path.
 */
async function ensureProbeAnchor(database: PrismaClient, at: Date): Promise<{ id: string; status: string; severity: string }> {
  const existing = await database.opsAlert.findUnique({ where: { dedupFingerprint: DELIVERY_PROBE_FINGERPRINT }, select: { id: true, status: true, severity: true } });
  if (existing) return existing;
  const created = await database.opsAlert.create({
    data: {
      id: randomUUID(),
      dedupFingerprint: DELIVERY_PROBE_FINGERPRINT,
      signal: DELIVERY_PROBE_SIGNAL,
      scope: DELIVERY_PROBE_SCOPE,
      severity: "WARNING",
      status: "RESOLVED",
      count: 1,
      firstSeen: at,
      lastSeen: at,
      correlationIds: [],
      acknowledgedAt: null,
      resolvedAt: at,
    },
    select: { id: true, status: true, severity: true },
  });
  return created;
}

/**
 * One synthetic delivery probe (D-13): posts a typed allowlist payload through
 * the real webhook path (native fetch, redirect:"manual", per-attempt
 * AbortSignal.timeout, bounded retries with jitter honoring Retry-After). Every
 * attempt lands in OpsAlertDelivery. Success records the delivery and raises no
 * alert; failure marks the delivery FAILED and raises the CRITICAL self-alert —
 * a broken channel must alert through the durable PostgreSQL state, never
 * through the broken channel itself. Never calls live external providers.
 */
export async function runDeliveryProbe(database: PrismaClient, webhookConfig: WebhookConfig, now: () => Date = () => new Date(), log: Logger = defaultLog, options: DeliveryProbeOptions = {}): Promise<DeliveryProbeResult> {
  const url = webhookConfig.webhookUrl;
  if (!url) return { attempted: false, delivered: false, alertId: null }; // unconfigured channel: nothing to probe
  const at = now();
  const anchor = await ensureProbeAnchor(database, at);
  const outcome = await dispatchWebhook(
    url,
    {
      event: "delivery_probe",
      signal: DELIVERY_PROBE_SIGNAL,
      scope: DELIVERY_PROBE_SCOPE,
      severity: anchor.severity,
      count: 1,
      firstSeen: at.toISOString(),
      lastSeen: at.toISOString(),
      correlationIds: [],
    },
    {
      timeoutMs: webhookConfig.webhookTimeoutMs,
      sleep: options.sleep,
      now,
      log,
      recordDelivery: async (attempt, httpStatus, errorCode, deliveryAt) => {
        await database.opsAlertDelivery.create({ data: { id: randomUUID(), alertId: anchor.id, at: deliveryAt, httpStatus, errorCode, attempt } });
      },
    },
  );
  if (outcome.delivered) {
    // Health confirmed (D-04): a previously failing probe alert auto-resolves.
    // IN-05: any non-RESOLVED status (OPEN or ACKNOWLEDGED) is resolved — an
    // operator-acknowledged anchor must not block health recovery.
    if (anchor.status !== "RESOLVED") {
      await database.opsAlert.update({ where: { id: anchor.id }, data: { status: "RESOLVED", resolvedAt: at } });
      await database.opsAlertTransition.create({ data: { id: randomUUID(), alertId: anchor.id, from: anchor.status, to: "RESOLVED", severityFrom: anchor.severity, severityTo: anchor.severity, at } });
    }
    return { attempted: true, delivered: true, alertId: anchor.id };
  }
  // Failure → CRITICAL self-alert (D-13): OPEN, severity CRITICAL, transition
  // row appended; a repeated failure bumps count/lastSeen without new transitions.
  const reopened = anchor.status === "RESOLVED";
  const escalated = anchor.severity !== "CRITICAL";
  await database.opsAlert.update({
    where: { id: anchor.id },
    data: {
      status: "OPEN",
      severity: "CRITICAL",
      resolvedAt: null,
      count: { increment: 1 },
      lastSeen: at,
    },
  });
  if (reopened || escalated) {
    await database.opsAlertTransition.create({ data: { id: randomUUID(), alertId: anchor.id, from: anchor.status, to: "OPEN", severityFrom: anchor.severity, severityTo: "CRITICAL", at } });
  }
  log({ event: "alerts.delivery_probe_failed", attempts: outcome.attempts });
  return { attempted: true, delivered: false, alertId: anchor.id };
}

// --- Weekly scheduler (retention-purge / backup-drill persisted-anchor pattern) -------

export type DeliveryProbeScheduler = Readonly<{ close(): void }>;

const MAX_TIMER_DELAY = 2 ** 31 - 1;

/**
 * Arms the next probe at the latest synthetic OpsAlertDelivery timestamp + 7
 * days (idle-poll until the first delivery exists), then re-arms after each
 * tick. Import-side-effect-free: the timer exists only when startAlertingRuntime
 * arms it. A failing probe tick retries on the short retryMs and never crashes
 * the worker (T-09-05).
 */
export function scheduleDeliveryProbe(input: {
  database: PrismaClient;
  webhookConfig: WebhookConfig;
  onError: (error: unknown) => void;
  now?: () => Date;
  log?: Logger;
  inspector?: DeadLetterInspector | null;
  state?: WarningTickState;
  idlePollMs?: number;
  retryMs?: number;
  setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}): DeliveryProbeScheduler {
  const now = input.now ?? (() => new Date());
  const log = input.log ?? defaultLog;
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const arm = async (): Promise<void> => {
    if (closed) return;
    if (timer) clearTimer(timer);
    try {
      const anchor = await input.database.opsAlert.findUnique({ where: { dedupFingerprint: DELIVERY_PROBE_FINGERPRINT }, select: { id: true } });
      const last = anchor
        ? await input.database.opsAlertDelivery.findFirst({ where: { alertId: anchor.id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { at: true } })
        : null;
      if (closed) return;
      const rawDelay = last?.at
        ? last.at.getTime() + DELIVERY_PROBE_INTERVAL_MS - now().getTime()
        : (input.idlePollMs ?? 3_600_000);
      const delay = Math.min(MAX_TIMER_DELAY, Math.max(0, rawDelay));
      timer = setTimer(() => { void run(); }, delay);
    } catch (error) {
      input.onError(error);
      if (!closed) timer = setTimer(() => { void arm(); }, input.retryMs ?? 60_000);
    }
  };

  const run = async (): Promise<void> => {
    if (closed) return;
    try {
      await runDeliveryProbe(input.database, input.webhookConfig, now, log);
      await arm();
    } catch (error) {
      input.onError(error);
      if (!closed) timer = setTimer(() => { void run(); }, input.retryMs ?? 60_000);
    }
  };

  void arm();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimer(timer);
    },
  };
}
