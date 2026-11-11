import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  alertFingerprint,
  createWarningTickState,
  evaluate5xx,
  evaluateAndDispatch,
  evaluateBackupStaleness,
  evaluateCircuit,
  evaluateDeadLetters,
  evaluateQuota,
  evaluateSyncFailures,
} from "../../workers/data-sync/src/jobs/alerts.js";

// --- Fakes ---------------------------------------------------------------------------

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

type FakeDatabaseInput = {
  alerts?: AlertRow[];
  quotaRows?: Array<{ provider: string; endpointFamily: string; observedLimit: number | null; observedRemaining: number | null; observedAt: Date }>;
  criticalReservations?: number;
  circuitRows?: Array<{ provider: string; endpointFamily: string; state: string; openedAt: Date | null; updatedAt: Date }>;
  syncRows?: Array<{ classifiedReason: string | null; startedAt: Date; syncRun: { correlationId: string | null; provider: string; endpointFamily: string } }>;
  lastBackup?: { completedAt: Date } | null;
  lastReceipt?: { overall: string; completedAt: Date } | null;
};

function createFakeDatabase(input: FakeDatabaseInput = {}) {
  const alerts = new Map<string, AlertRow>();
  const transitions: Array<{ id: string; alertId: string; from: string; to: string; severityFrom: string | null; severityTo: string | null; at: Date }> = [];
  const deliveries: Array<{ id: string; alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number }> = [];
  let sequence = 0;
  for (const row of input.alerts ?? []) alerts.set(row.dedupFingerprint, { ...row });

  const findRow = (where: { id?: string; dedupFingerprint?: string }): AlertRow | undefined => {
    if (where.dedupFingerprint !== undefined) return alerts.get(where.dedupFingerprint);
    return [...alerts.values()].find((row) => row.id === where.id);
  };

  const database = {
    opsAlert: {
      findUnique: async ({ where }: { where: { dedupFingerprint: string } }) => {
        const row = alerts.get(where.dedupFingerprint);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where?: { status?: { in: string[] } } } = {}) =>
        [...alerts.values()]
          .filter((row) => (!where?.status?.in ? true : where.status.in.includes(row.status)))
          .map((row) => ({ ...row, dedupFingerprint: row.dedupFingerprint })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = alertRow(data as Partial<AlertRow> & { dedupFingerprint: string });
        alerts.set(row.dedupFingerprint, row);
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
      create: async ({ data }: { data: { alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number } }) => {
        const row = { id: `delivery-${(sequence += 1)}`, ...data };
        deliveries.push(row);
        return { ...row };
      },
    },
    providerQuotaObservation: {
      findMany: async () => (input.quotaRows ?? []).map((row) => ({ ...row })),
    },
    providerThrottleReservation: {
      count: async () => input.criticalReservations ?? 0,
    },
    providerCircuitState: {
      findMany: async ({ where }: { where?: { state?: { in: string[] } } } = {}) =>
        (input.circuitRows ?? [])
          .filter((row) => (!where?.state?.in ? true : where.state.in.includes(row.state)))
          .map((row) => ({ ...row })),
    },
    syncAttempt: {
      findMany: async () => (input.syncRows ?? []).map((row) => ({ ...row })),
    },
    backupRun: {
      findFirst: async () => (input.lastBackup ? { ...input.lastBackup } : null),
    },
    backupVerificationReceipt: {
      findFirst: async () => (input.lastReceipt ? { ...input.lastReceipt } : null),
    },
  };
  return { database, alerts, transitions, deliveries };
}

function createFakeRedis(buckets: Record<string, number> = {}) {
  return {
    get: async (key: string) => (key in buckets ? String(buckets[key]) : null),
  };
}

const NOW = () => new Date("2026-11-11T12:00:00.000Z");
const NO_WEBHOOK = { webhookUrl: undefined } as const;

const minute = (offsetMinutes: number) => Math.floor(new Date("2026-11-11T12:00:00.000Z").getTime() / 60_000) - offsetMinutes;

beforeEach(() => {
  vi.stubEnv("BACKUP_ENABLED", "true");
  vi.stubEnv("BACKUP_DIR", "C:\\backups");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// --- Quota adapter (D-10) ------------------------------------------------------------

describe("evaluateQuota", () => {
  const observation = (used: number, allowance: number) => [
    { provider: "api-football", endpointFamily: "FIXTURES", observedLimit: allowance, observedRemaining: allowance - used, observedAt: NOW() },
  ];

  it.each([
    [90, 100, "WARNING"],
    [100, 100, "CRITICAL"],
    [80, 100, "WARNING"],
  ])("used=%i/allowance=%i → %s", async (used, allowance, severity) => {
    const { database } = createFakeDatabase({ quotaRows: observation(used, allowance) });
    const evaluations = await evaluateQuota(database as never, NOW());
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.severity).toBe(severity);
    expect(evaluations[0]?.scope).toBe("api-football/FIXTURES");
  });

  it("criticalReservations > 0 → CRITICAL even below the ratio threshold", async () => {
    const { database } = createFakeDatabase({ quotaRows: observation(10, 100), criticalReservations: 1 });
    const evaluations = await evaluateQuota(database as never, NOW());
    expect(evaluations[0]?.severity).toBe("CRITICAL");
  });

  it("<80% with no critical reservations → no alert", async () => {
    const { database } = createFakeDatabase({ quotaRows: observation(70, 100) });
    const evaluations = await evaluateQuota(database as never, NOW());
    expect(evaluations).toEqual([]);
  });
});

// --- Circuit adapter (D-03) -----------------------------------------------------------

describe("evaluateCircuit", () => {
  const circuit = (state: string) => [{ provider: "football-data.org", endpointFamily: "RESULTS", state, openedAt: new Date("2026-11-11T11:00:00.000Z"), updatedAt: NOW() }];

  it("OPEN → CRITICAL on first detection", async () => {
    const { database } = createFakeDatabase({ circuitRows: circuit("OPEN") });
    const evaluations = await evaluateCircuit(database as never, NOW());
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.severity).toBe("CRITICAL");
  });

  it("CLOSED → no alert", async () => {
    const { database } = createFakeDatabase({ circuitRows: circuit("CLOSED") });
    expect(await evaluateCircuit(database as never, NOW())).toEqual([]);
  });

  it("HALF_OPEN opens as WARNING only on the second consecutive tick (flap damping)", async () => {
    vi.stubEnv("BACKUP_ENABLED", ""); // isolate from the backup signal
    const { database, alerts, transitions } = createFakeDatabase({ circuitRows: circuit("HALF_OPEN") });
    const state = createWarningTickState();
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK, () => undefined, { state });
    expect(alerts.size).toBe(0); // damped first tick
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK, () => undefined, { state });
    const row = alerts.get(alertFingerprint("PROVIDER_CIRCUIT", "football-data.org/RESULTS"));
    expect(row?.severity).toBe("WARNING");
    expect(row?.status).toBe("OPEN");
    expect(transitions).toEqual([]); // opening does not append a transition row
  });
});

// --- Sync failures (D-11) --------------------------------------------------------------

describe("evaluateSyncFailures", () => {
  const failure = (classifiedReason: string | null, provider = "api-football") => ({
    classifiedReason,
    startedAt: NOW(),
    syncRun: { correlationId: "corr-1", provider, endpointFamily: "FIXTURES" },
  });

  it(">=5 FAILED non-blocking in 10 min → WARNING", async () => {
    const { database } = createFakeDatabase({ syncRows: Array.from({ length: 5 }, () => failure("TIMEOUT")) });
    const evaluations = await evaluateSyncFailures(database as never, NOW());
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.severity).toBe("WARNING");
    expect(evaluations[0]?.count === undefined).toBe(true); // adapters carry no count; dedupUpsert owns it
  });

  it("1 FAILED with BLOCKING root cause → CRITICAL regardless of count", async () => {
    const { database } = createFakeDatabase({ syncRows: [failure("QUARANTINE_PAYLOAD")] });
    const evaluations = await evaluateSyncFailures(database as never, NOW());
    expect(evaluations[0]?.severity).toBe("CRITICAL");
  });

  it("<5 FAILED non-blocking → no alert", async () => {
    const { database } = createFakeDatabase({ syncRows: [failure("TIMEOUT"), failure("TIMEOUT"), failure("TIMEOUT")] });
    expect(await evaluateSyncFailures(database as never, NOW())).toEqual([]);
  });
});

// --- Dead letters -----------------------------------------------------------------------

describe("evaluateDeadLetters", () => {
  it("groups per job name + root cause, not per individual job", async () => {
    const inspector = {
      getFailed: async (start: number) =>
        start === 0
          ? [
              { name: "replay", failedReason: "QUARANTINE_PAYLOAD: bad payload" },
              { name: "replay", failedReason: "QUARANTINE_PAYLOAD: other payload" },
              { name: "settlement", failedReason: "TIMEOUT" },
            ]
          : [],
    };
    const evaluations = await evaluateDeadLetters(inspector, NOW());
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map((evaluation) => evaluation.scope).sort()).toEqual(["replay/QUARANTINE_PAYLOAD", "settlement/TIMEOUT"]);
    expect(evaluations.find((evaluation) => evaluation.scope === "replay/QUARANTINE_PAYLOAD")?.severity).toBe("CRITICAL");
    expect(evaluations.find((evaluation) => evaluation.scope === "settlement/TIMEOUT")?.severity).toBe("WARNING");
  });
});

// --- 5xx buckets (D-09) -------------------------------------------------------------------

describe("evaluate5xx", () => {
  const bucketsFor = (fives: number, total: number) => ({
    [`bet-stats:http5xx:${minute(0)}`]: fives,
    [`bet-stats:httpTotal:${minute(0)}`]: total,
  });

  it("10% with sufficient volume → WARNING", async () => {
    const evaluations = await evaluate5xx(createFakeRedis(bucketsFor(2, 20)), NOW());
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]?.severity).toBe("WARNING");
  });

  it("below minimum volume → no alert even at 20%", async () => {
    const evaluations = await evaluate5xx(createFakeRedis(bucketsFor(1, 5)), NOW());
    expect(evaluations).toEqual([]);
  });

  it("hard threshold (>=50%) → CRITICAL", async () => {
    const evaluations = await evaluate5xx(createFakeRedis(bucketsFor(10, 20)), NOW());
    expect(evaluations[0]?.severity).toBe("CRITICAL");
  });

  it("below 10% with volume → no alert", async () => {
    const evaluations = await evaluate5xx(createFakeRedis(bucketsFor(1, 20)), NOW());
    expect(evaluations).toEqual([]);
  });

  it("sums the rolling 5-minute window across bucket keys", async () => {
    const buckets: Record<string, number> = {};
    for (let offset = 0; offset < 5; offset += 1) {
      buckets[`bet-stats:http5xx:${minute(offset)}`] = 1;
      buckets[`bet-stats:httpTotal:${minute(offset)}`] = 5;
    }
    const evaluations = await evaluate5xx(createFakeRedis(buckets), NOW());
    expect(evaluations).toHaveLength(1); // 5/25 = 20%
    expect(evaluations[0]?.severity).toBe("WARNING");
  });
});

// --- Backup staleness (D-12) ---------------------------------------------------------------

describe("evaluateBackupStaleness", () => {
  it("NOT_CONFIGURED → no alert", async () => {
    vi.stubEnv("BACKUP_ENABLED", "");
    const { database } = createFakeDatabase();
    expect(await evaluateBackupStaleness(database as never, NOW())).toEqual([]);
  });

  it("STALE (>=25h without success) → WARNING", async () => {
    const { database } = createFakeDatabase({
      lastBackup: { completedAt: new Date("2026-11-10T09:00:00.000Z") }, // 27h before NOW
      lastReceipt: { overall: "VERIFIED", completedAt: NOW() },
    });
    const evaluations = await evaluateBackupStaleness(database as never, NOW());
    expect(evaluations[0]?.severity).toBe("WARNING");
  });

  it("FAILED drill → CRITICAL", async () => {
    const { database } = createFakeDatabase({
      lastBackup: { completedAt: NOW() },
      lastReceipt: { overall: "CHAIN_INTEGRITY_FAILED", completedAt: NOW() },
    });
    expect((await evaluateBackupStaleness(database as never, NOW()))[0]?.severity).toBe("CRITICAL");
  });

  it(">=48h without a successful dump → CRITICAL", async () => {
    const { database } = createFakeDatabase({
      lastBackup: { completedAt: new Date("2026-11-09T00:00:00.000Z") },
      lastReceipt: { overall: "VERIFIED", completedAt: NOW() },
    });
    expect((await evaluateBackupStaleness(database as never, NOW()))[0]?.severity).toBe("CRITICAL");
  });

  it("fresh success + verified drill → no alert", async () => {
    const { database } = createFakeDatabase({
      lastBackup: { completedAt: NOW() },
      lastReceipt: { overall: "VERIFIED", completedAt: NOW() },
    });
    expect(await evaluateBackupStaleness(database as never, NOW())).toEqual([]);
  });
});

// --- Dedup upsert + lifecycle (D-04, D-05) ---------------------------------------------------

describe("evaluateAndDispatch dedup and lifecycle", () => {
  beforeEach(() => {
    // Backup alerting is a separate concern in this suite; NOT_CONFIGURED keeps
    // the adapter silent so lifecycle assertions see only the seeded signals.
    vi.stubEnv("BACKUP_ENABLED", "");
  });

  const openCircuit = { circuitRows: [{ provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN", openedAt: null, updatedAt: NOW() }] };

  it("same fingerprint twice → one row with count=2; different fingerprints → separate rows", async () => {
    const { database, alerts } = createFakeDatabase({
      ...openCircuit,
      quotaRows: [{ provider: "api-football", endpointFamily: "FIXTURES", observedLimit: 100, observedRemaining: 10, observedAt: NOW() }],
    });
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    expect(alerts.size).toBe(2);
    // The circuit fired on tick 1, so two ticks → two occurrences (count=2).
    expect(alerts.get(alertFingerprint("PROVIDER_CIRCUIT", "football-data.org/RESULTS"))?.count).toBe(2);
    // The quota WARNING is flap-damped on tick 1, so its opened count reflects
    // opened occurrences only (count=1) — damping never pre-creates rows.
    expect(alerts.get(alertFingerprint("PROVIDER_QUOTA", "api-football/FIXTURES"))?.count).toBe(1);
  });

  it("adapter clear → OPEN row RESOLVED with resolvedAt and exactly one OPEN→RESOLVED transition; second clear tick adds none", async () => {
    const fingerprint = alertFingerprint("PROVIDER_QUOTA", "api-football/FIXTURES");
    const seeded = alertRow({ dedupFingerprint: fingerprint, severity: "WARNING", status: "OPEN" });
    const { database, alerts, transitions } = createFakeDatabase({ alerts: [seeded] });
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK); // no quota rows → clear
    const row = alerts.get(fingerprint);
    expect(row?.status).toBe("RESOLVED");
    expect(row?.resolvedAt).toEqual(NOW());
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ alertId: seeded.id, from: "OPEN", to: "RESOLVED" });
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    expect(transitions).toHaveLength(1);
  });

  it("ACKNOWLEDGED row also auto-resolves with a transition row", async () => {
    const fingerprint = alertFingerprint("PROVIDER_QUOTA", "api-football/FIXTURES");
    const seeded = alertRow({ dedupFingerprint: fingerprint, severity: "WARNING", status: "ACKNOWLEDGED", acknowledgedAt: NOW() });
    const { database, alerts, transitions } = createFakeDatabase({ alerts: [seeded] });
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    expect(alerts.get(fingerprint)?.status).toBe("RESOLVED");
    expect(transitions[0]).toMatchObject({ from: "ACKNOWLEDGED", to: "RESOLVED" });
  });

  it("RESOLVED fingerprint that fires again re-opens the row and dispatches as re-open (D-04/D-05)", async () => {
    const fingerprint = alertFingerprint("PROVIDER_CIRCUIT", "football-data.org/RESULTS");
    const seeded = alertRow({ dedupFingerprint: fingerprint, severity: "CRITICAL", status: "RESOLVED", resolvedAt: NOW() });
    const { database, alerts, transitions } = createFakeDatabase({ alerts: [seeded], ...openCircuit });
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, { webhookUrl: "https://hooks.test/channel" });
    const row = alerts.get(fingerprint);
    expect(row?.status).toBe("OPEN");
    expect(row?.resolvedAt).toBeNull();
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from: "RESOLVED", to: "OPEN", severityTo: "CRITICAL" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as { event: string };
    expect(payload.event).toBe("alert_reopened");
  });

  it("escalation happens in place with a transition row (WARNING → CRITICAL)", async () => {
    const fingerprint = alertFingerprint("PROVIDER_CIRCUIT", "football-data.org/RESULTS");
    const seeded = alertRow({ dedupFingerprint: fingerprint, severity: "WARNING", status: "OPEN" });
    const { database, alerts, transitions } = createFakeDatabase({ alerts: [seeded], ...openCircuit });
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    const row = alerts.get(fingerprint);
    expect(row?.severity).toBe("CRITICAL");
    expect(row?.status).toBe("OPEN");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from: "OPEN", to: "OPEN", severityFrom: "WARNING", severityTo: "CRITICAL" });
  });

  it("unconfigured webhook (no ALERT_WEBHOOK_URL): detection still runs, no alert lost, no dispatch", async () => {
    const { database, alerts } = createFakeDatabase(openCircuit);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, NO_WEBHOOK);
    expect(alerts.size).toBe(1);
    expect([...alerts.values()][0]?.status).toBe("OPEN");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("occurrence ticks (no severity/status change) never dispatch (D-05 anti-fatigue)", async () => {
    const { database } = createFakeDatabase(openCircuit);
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, { webhookUrl: "https://hooks.test/channel" });
    expect(fetchStub).toHaveBeenCalledTimes(1); // open dispatch
    await evaluateAndDispatch(database as never, createFakeRedis(), NOW, { webhookUrl: "https://hooks.test/channel" });
    expect(fetchStub).toHaveBeenCalledTimes(1); // occurrence: no dispatch
  });
});
