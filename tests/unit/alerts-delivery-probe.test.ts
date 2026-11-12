import { afterEach, describe, expect, it, vi } from "vitest";

import { DELIVERY_PROBE_FINGERPRINT, DELIVERY_PROBE_INTERVAL_MS, runDeliveryProbe, scheduleDeliveryProbe } from "../../workers/data-sync/src/jobs/delivery-probe.js";

const NOW = () => new Date("2026-11-11T12:00:00.000Z");
const WEBHOOK_URL = "https://hooks.test/channel";
const WEBHOOK_CONFIG = { webhookUrl: WEBHOOK_URL, webhookTimeoutMs: 1_000 };

type AlertRow = { id: string; dedupFingerprint: string; signal: string; scope: string; severity: string; status: string; count: number; firstSeen: Date; lastSeen: Date; resolvedAt: Date | null };

function createFakeDatabase(alerts: AlertRow[] = [], deliveries: Array<{ alertId: string; at: Date }> = []) {
  const alertStore = new Map<string, AlertRow>();
  const transitions: Array<{ id: string; alertId: string; from: string; to: string; severityFrom: string | null; severityTo: string | null; at: Date }> = [];
  const deliveryRows: Array<{ alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number }> = [];
  for (const row of alerts) alertStore.set(row.dedupFingerprint, { ...row });
  let sequence = 0;
  const findRow = (where: { id?: string; dedupFingerprint?: string }) =>
    where.dedupFingerprint !== undefined ? alertStore.get(where.dedupFingerprint) : [...alertStore.values()].find((row) => row.id === where.id);
  const database = {
    opsAlert: {
      findUnique: async ({ where }: { where: { dedupFingerprint: string } }) => {
        const row = alertStore.get(where.dedupFingerprint);
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: AlertRow }) => {
        alertStore.set(data.dedupFingerprint, { ...data });
        return { ...data };
      },
      update: async ({ where, data }: { where: { id?: string; dedupFingerprint?: string }; data: Partial<AlertRow> }) => {
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
        deliveryRows.push({ ...data });
        return { ...data, id: `delivery-${deliveryRows.length}` };
      },
      findFirst: async ({ where }: { where: { alertId: string } }) => {
        const rows = deliveries.filter((row) => row.alertId === where.alertId).sort((left, right) => right.at.getTime() - left.at.getTime());
        return rows[0] ? { ...rows[0] } : null;
      },
    },
  };
  return { database, alertStore, transitions, deliveryRows };
}

const anchorRow = (overrides: Partial<AlertRow> = {}): AlertRow => ({
  id: "probe-anchor",
  dedupFingerprint: DELIVERY_PROBE_FINGERPRINT,
  signal: "DELIVERY_HEALTH",
  scope: "synthetic",
  severity: "WARNING",
  status: "RESOLVED",
  count: 1,
  firstSeen: new Date("2026-11-01T00:00:00.000Z"),
  lastSeen: new Date("2026-11-01T00:00:00.000Z"),
  resolvedAt: new Date("2026-11-01T00:00:00.000Z"),
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runDeliveryProbe", () => {
  it("success (2xx) records an OpsAlertDelivery row and raises no alert", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const fake = createFakeDatabase([anchorRow()]);
    const result = await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW);
    expect(result).toEqual({ attempted: true, delivered: true, alertId: "probe-anchor" });
    expect(fake.deliveryRows).toHaveLength(1);
    expect(fake.deliveryRows[0]).toMatchObject({ alertId: "probe-anchor", httpStatus: 200, errorCode: null, attempt: 1 });
    const anchor = fake.alertStore.get(DELIVERY_PROBE_FINGERPRINT);
    expect(anchor?.status).toBe("RESOLVED"); // no alert raised on the healthy path
    expect(fake.transitions).toHaveLength(0);
    const init = fetchStub.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
  });

  it("failure marks delivery rows FAILED and raises the CRITICAL self-alert with a transition row (D-13)", async () => {
    const fetchStub = vi.fn().mockRejectedValue(Object.assign(new Error("connect refused"), { name: "TypeError" }));
    vi.stubGlobal("fetch", fetchStub);
    const fake = createFakeDatabase([anchorRow()]);
    const result = await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW, () => undefined, { sleep: async () => undefined });
    expect(result.delivered).toBe(false);
    expect(fake.deliveryRows).toHaveLength(3); // bounded attempts, each recorded
    expect(fake.deliveryRows.every((row) => row.errorCode === "TypeError")).toBe(true);
    const anchor = fake.alertStore.get(DELIVERY_PROBE_FINGERPRINT);
    expect(anchor?.status).toBe("OPEN");
    expect(anchor?.severity).toBe("CRITICAL");
    expect(anchor?.resolvedAt).toBeNull();
    expect(fake.transitions).toHaveLength(1);
    expect(fake.transitions[0]).toMatchObject({ alertId: "probe-anchor", from: "RESOLVED", to: "OPEN", severityFrom: "WARNING", severityTo: "CRITICAL" });
  });

  it("a repeated failure bumps count/lastSeen without duplicate transitions", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetchStub);
    const failing = anchorRow({ status: "OPEN", severity: "CRITICAL", resolvedAt: null, count: 2 });
    const fake = createFakeDatabase([failing]);
    await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW, () => undefined, { sleep: async () => undefined });
    const anchor = fake.alertStore.get(DELIVERY_PROBE_FINGERPRINT);
    expect(anchor?.count).toBe(3);
    expect(fake.transitions).toHaveLength(0); // already OPEN/CRITICAL — no state change
  });

  it("success after a failure resolves the self-alert with an OPEN→RESOLVED transition", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const failing = anchorRow({ status: "OPEN", severity: "CRITICAL", resolvedAt: null, count: 2 });
    const fake = createFakeDatabase([failing]);
    await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW);
    const anchor = fake.alertStore.get(DELIVERY_PROBE_FINGERPRINT);
    expect(anchor?.status).toBe("RESOLVED");
    expect(anchor?.resolvedAt).toEqual(NOW());
    expect(fake.transitions).toHaveLength(1);
    expect(fake.transitions[0]).toMatchObject({ from: "OPEN", to: "RESOLVED" });
  });

  it("success resolves an ACKNOWLEDGED anchor with a truthful ACKNOWLEDGED→RESOLVED transition (IN-05)", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const acknowledged = anchorRow({ status: "ACKNOWLEDGED", severity: "CRITICAL", resolvedAt: null, count: 2 });
    const fake = createFakeDatabase([acknowledged]);
    const result = await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW);
    expect(result.delivered).toBe(true);
    const anchor = fake.alertStore.get(DELIVERY_PROBE_FINGERPRINT);
    expect(anchor?.status).toBe("RESOLVED");
    expect(anchor?.resolvedAt).toEqual(NOW());
    expect(fake.transitions).toHaveLength(1);
    expect(fake.transitions[0]).toMatchObject({ alertId: "probe-anchor", from: "ACKNOWLEDGED", to: "RESOLVED", severityFrom: "CRITICAL", severityTo: "CRITICAL" });
  });

  it("unconfigured webhook → no probe attempt at all", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const fake = createFakeDatabase([anchorRow()]);
    const result = await runDeliveryProbe(fake.database as never, { webhookUrl: undefined }, NOW);
    expect(result).toEqual({ attempted: false, delivered: false, alertId: null });
    expect(fake.deliveryRows).toHaveLength(0);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("never calls live providers — payload is a typed allowlist only", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const fake = createFakeDatabase([anchorRow()]);
    await runDeliveryProbe(fake.database as never, WEBHOOK_CONFIG, NOW);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL); // the operator-configured webhook only
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["correlationIds", "count", "event", "firstSeen", "lastSeen", "scope", "severity", "signal"]);
    expect(body.signal).toBe("DELIVERY_HEALTH");
    expect(body.scope).toBe("synthetic");
  });
});

describe("scheduleDeliveryProbe", () => {
  it("arms the next probe at the last synthetic delivery + 7 days", async () => {
    const lastDeliveryAt = new Date("2026-11-10T00:00:00.000Z");
    const fake = createFakeDatabase([anchorRow()], [{ alertId: "probe-anchor", at: lastDeliveryAt }]);
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const scheduler = scheduleDeliveryProbe({
      database: fake.database as never,
      webhookConfig: WEBHOOK_CONFIG,
      onError: () => undefined,
      now: NOW,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delay).toBe(lastDeliveryAt.getTime() + DELIVERY_PROBE_INTERVAL_MS - NOW().getTime());
    scheduler.close();
  });

  it("idle-polls until the first delivery exists", async () => {
    const fake = createFakeDatabase([anchorRow()]);
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const scheduler = scheduleDeliveryProbe({
      database: fake.database as never,
      webhookConfig: WEBHOOK_CONFIG,
      onError: () => undefined,
      now: NOW,
      idlePollMs: 5_000,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.map((timer) => timer.delay)).toEqual([5_000]);
    scheduler.close();
  });

  it("retryMs backs off when the arm query fails and close() prevents timer leaks", async () => {
    const failingDatabase = {
      opsAlert: {
        findUnique: async () => { throw new Error("postgres outage"); },
      },
    };
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const errors: unknown[] = [];
    const scheduler = scheduleDeliveryProbe({
      database: failingDatabase as never,
      webhookConfig: WEBHOOK_CONFIG,
      onError: (error) => { errors.push(error); },
      now: NOW,
      retryMs: 25,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveLength(1);
    expect(timers.map((timer) => timer.delay)).toEqual([25]);
    scheduler.close();
    timers[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers).toHaveLength(1); // closed: no re-arm
  });

  it("import-side-effect-free: importing the module never arms a timer", async () => {
    vi.resetModules();
    const setTimerSpy = vi.fn();
    const globalSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", setTimerSpy);
    try {
      await import("../../workers/data-sync/src/jobs/delivery-probe.js");
    } finally {
      vi.stubGlobal("setTimeout", globalSetTimeout);
    }
    expect(setTimerSpy).not.toHaveBeenCalled();
  });
});
