import { describe, expect, it, vi } from "vitest";

import type { AlertConfig } from "@bet-stats/config";
import type { PrismaClient } from "@bet-stats/database";

import { DEFAULT_ALERTS_TICK_MS, type DeadLetterInspector } from "../../workers/data-sync/src/jobs/alerts.js";
import { startAlertingRuntime } from "../../workers/data-sync/src/main.js";

// --- Fakes (mirrors alerts-signals.test.ts shapes) -------------------------------------

type AlertRow = {
  id: string;
  dedupFingerprint: string;
  signal: string;
  scope: string;
  severity: string;
  status: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  correlationIds: unknown;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
};

function alertRow(overrides: Partial<AlertRow> & { dedupFingerprint: string }): AlertRow {
  return {
    id: `alert-${overrides.dedupFingerprint.replace(/\0/g, "-")}`,
    signal: overrides.dedupFingerprint.split("\0")[0] ?? "UNKNOWN",
    scope: overrides.dedupFingerprint.split("\0")[1] ?? "UNKNOWN",
    severity: "WARNING",
    status: "OPEN",
    count: 1,
    firstSeen: new Date("2026-11-10T00:00:00.000Z"),
    lastSeen: new Date("2026-11-10T00:00:00.000Z"),
    correlationIds: [],
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function createFakeDatabase(seed: AlertRow[] = []) {
  const alerts = new Map<string, AlertRow>();
  const created: AlertRow[] = [];
  const transitions: Array<{ id: string; alertId: string; from: string; to: string; severityFrom: string | null; severityTo: string | null; at: Date }> = [];
  let sequence = 0;
  for (const row of seed) alerts.set(row.dedupFingerprint, { ...row });

  const findRow = (where: { id?: string; dedupFingerprint?: string }): AlertRow | undefined =>
    where.dedupFingerprint !== undefined ? alerts.get(where.dedupFingerprint) : [...alerts.values()].find((row) => row.id === where.id);

  const database = {
    opsAlert: {
      findUnique: async ({ where }: { where: { dedupFingerprint: string } }) => {
        const row = alerts.get(where.dedupFingerprint);
        return row ? { ...row } : null;
      },
      // Honors both `where.status.in` and `where.signal.not` — the latter is what
      // makes the probe-anchor auto-resolution exclusion observable (Task 2).
      findMany: async ({ where }: { where?: { status?: { in: string[] }; signal?: { not: string } } } = {}) =>
        [...alerts.values()]
          .filter((row) => (!where?.status?.in ? true : where.status.in.includes(row.status)))
          .filter((row) => (!where?.signal?.not ? true : row.signal !== where.signal.not))
          .map((row) => ({ ...row })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = alertRow(data as Partial<AlertRow> & { dedupFingerprint: string });
        alerts.set(row.dedupFingerprint, row);
        created.push({ ...row });
        return { ...row };
      },
      update: async ({ where, data }: { where: { id?: string; dedupFingerprint?: string }; data: Record<string, unknown> }) => {
        const row = findRow(where);
        if (!row) throw new Error("OPS_ALERT_NOT_FOUND");
        const patch = { ...data } as Record<string, unknown>;
        if (patch.count && typeof patch.count === "object" && "increment" in (patch.count as Record<string, unknown>)) {
          patch.count = row.count + ((patch.count as { increment: number }).increment ?? 1);
        }
        Object.assign(row, patch);
        return { ...row };
      },
    },
    opsAlertTransition: {
      create: async ({ data }: { data: { alertId: string; from: string; to: string; severityFrom: string | null; severityTo: string | null; at: Date } }) => {
        const row = { id: `transition-${(sequence += 1)}`, ...data };
        transitions.push(row);
        return { ...row };
      },
    },
    opsAlertDelivery: {
      create: async ({ data }: { data: { alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number } }) => ({ id: `delivery-${(sequence += 1)}`, ...data }),
    },
    // The three signal-source queries stay quiet so only the seeded/inspector
    // signals can fire in these tests.
    providerQuotaObservation: { findMany: async () => [] },
    providerThrottleReservation: { count: async () => 0 },
    providerCircuitState: { findMany: async () => [] },
    syncAttempt: { findMany: async () => [] },
  };
  return { database, alerts, created, transitions };
}

const NO_WEBHOOK_CONFIG: AlertConfig = { enabled: true };

type CapturedTimer = { callback: () => void; delay: number };

function injectTimers() {
  const timers: CapturedTimer[] = [];
  return {
    timers,
    setTimeout: (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
      timers.push({ callback, delay });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };
}

/** Flushes the injected 0-delay timer chain: the scheduler arms tick 0 → the tick
 *  runs all fake-async work → it re-arms the next interval timer. */
async function flush(times = 25): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// --- CR-01: the dead-letter inspector must reach scheduleAlertingTick -------------------
describe("startAlertingRuntime composition (CR-01)", () => {
  it("one evaluator tick armed through startAlertingRuntime consumes inspector.getFailed and lands a durable OPEN/CRITICAL DEAD_LETTER row", async () => {
    const fake = createFakeDatabase();
    const fakeRedis = { get: async () => null };
    const fakeInspector = {
      getFailed: vi.fn(async (start: number) =>
        start === 0 ? [{ name: "settlement", failedReason: "QUARANTINE_IDENTITY" }] : [],
      ),
    } satisfies DeadLetterInspector;
    const clock = injectTimers();

    const runtime = startAlertingRuntime({
      databaseUrl: "",
      redisUrl: "",
      alertsConfig: NO_WEBHOOK_CONFIG,
      dependencies: {
        database: fake.database as unknown as PrismaClient,
        redis: fakeRedis,
        inspector: fakeInspector,
      },
      log: () => undefined,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    if (!runtime) throw new Error("runtime should be armed with enabled config");

    // The injected timers are inert storage — firing the armed 0-delay callback
    // runs the one evaluator tick.
    await flush();
    clock.timers[0]?.callback(); // tick 0: run evaluateAndDispatch
    await flush();

    expect(fakeInspector.getFailed).toHaveBeenCalled(); // the DEAD_LETTER adapter ran in the composition
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({
      signal: "DEAD_LETTER",
      scope: "settlement/QUARANTINE_IDENTITY",
      severity: "CRITICAL",
      status: "OPEN",
      resolvedAt: null,
    });
    expect(fake.transitions).toHaveLength(0); // opening does not append a transition row

    await runtime.close();
  });

  it("close() stops the scheduler chain — no further timer is scheduled after close", async () => {
    const fake = createFakeDatabase();
    const fakeInspector: DeadLetterInspector = { getFailed: async () => [] };
    const clock = injectTimers();

    const runtime = startAlertingRuntime({
      databaseUrl: "",
      redisUrl: "",
      alertsConfig: NO_WEBHOOK_CONFIG,
      dependencies: { database: fake.database as unknown as PrismaClient, redis: { get: async () => null }, inspector: fakeInspector },
      log: () => undefined,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    if (!runtime) throw new Error("runtime should be armed with enabled config");

    await flush();
    clock.timers[0]?.callback(); // fire tick 0
    await flush();

    // tick 0 fired, and the self-closing chain re-armed the next interval timer.
    expect(clock.timers.map((timer) => timer.delay)).toEqual([0, DEFAULT_ALERTS_TICK_MS]);
    await runtime.close();
    // A stale pending callback after close must not re-arm (mirrors scheduleAlertingTick's contract).
    clock.timers[1]?.callback();
    await flush();
    expect(clock.timers).toHaveLength(2);
  });
});
