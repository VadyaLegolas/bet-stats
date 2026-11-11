import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchWebhook, evaluateAndDispatch, type WebhookPayload } from "../../workers/data-sync/src/jobs/alerts.js";

// Fakes are shared in shape with alerts-signals.test.ts but kept local to this file.

function createFakeDatabase(circuitRows: Array<Record<string, unknown>> = []) {
  const deliveries: Array<{ alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number }> = [];
  const alerts = new Map<string, Record<string, unknown>>();
  const database = {
    opsAlertDelivery: {
      create: async ({ data }: { data: { alertId: string; at: Date; httpStatus: number | null; errorCode: string | null; attempt: number } }) => {
        deliveries.push({ ...data });
        return { ...data, id: `delivery-${deliveries.length}` };
      },
    },
    opsAlert: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "alert-1", count: 1, status: "OPEN", ...data };
        alerts.set(String(data.dedupFingerprint), row);
        return row;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "alert-1", count: 2, ...data }),
    },
    opsAlertTransition: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "transition-1", ...data }) },
    providerQuotaObservation: { findMany: async () => [] },
    providerThrottleReservation: { count: async () => 0 },
    providerCircuitState: { findMany: async () => circuitRows.map((row) => ({ ...row })) },
    syncAttempt: { findMany: async () => [] },
    backupRun: { findFirst: async () => null },
    backupVerificationReceipt: { findFirst: async () => null },
  };
  return { database, alerts, deliveries };
}

const NOW = () => new Date("2026-11-11T12:00:00.000Z");
const OPEN_CIRCUIT = [{ provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN", openedAt: null, updatedAt: NOW() }];
const WEBHOOK_URL = "https://hooks.test/channel";
const PAYLOAD: WebhookPayload = {
  event: "alert_opened",
  signal: "PROVIDER_CIRCUIT",
  scope: "football-data.org/RESULTS",
  severity: "CRITICAL",
  count: 1,
  firstSeen: "2026-11-11T11:00:00.000Z",
  lastSeen: "2026-11-11T12:00:00.000Z",
  correlationIds: ["corr-1"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dispatchWebhook", () => {
  it("2xx → delivered with a delivery row carrying httpStatus and no errorCode", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const deliveries: Array<Record<string, unknown>> = [];
    const result = await dispatchWebhook(WEBHOOK_URL, PAYLOAD, {
      recordDelivery: async (attempt, httpStatus, errorCode) => { deliveries.push({ attempt, httpStatus, errorCode }); },
    });
    expect(result).toEqual({ delivered: true, attempts: 1 });
    expect(deliveries).toEqual([{ attempt: 1, httpStatus: 200, errorCode: null }]);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual"); // 3xx must never be silently followed
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("non-2xx 500 → bounded retries (3) with increasing deterministic delays, then FAILED delivery row", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0); // pin jitter
    const fetchStub = vi.fn().mockImplementation(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", fetchStub);
    const deliveries: Array<Record<string, unknown>> = [];
    const delays: number[] = [];
    const result = await dispatchWebhook(WEBHOOK_URL, PAYLOAD, {
      baseBackoffMs: 100,
      sleep: async (ms) => { delays.push(ms); },
      recordDelivery: async (attempt, httpStatus, errorCode) => { deliveries.push({ attempt, httpStatus, errorCode }); },
    });
    expect(randomSpy).toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, attempts: 3 });
    expect(delays).toEqual([100, 200]); // exponential backoff (jitter pinned to 0)
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((row) => row.httpStatus === 500 && row.errorCode === "HTTP_500")).toBe(true);
  });

  it("429 with Retry-After: 1 waits the instructed second before retrying", async () => {
    const fetchStub = vi
      .fn()
      .mockImplementationOnce(async () => new Response("slow down", { status: 429, headers: { "retry-after": "1" } }))
      .mockImplementationOnce(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    const delays: number[] = [];
    const result = await dispatchWebhook(WEBHOOK_URL, PAYLOAD, {
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(result).toEqual({ delivered: true, attempts: 2 });
    expect(delays).toEqual([1000]);
  });

  it("timeout (AbortError) → recorded as TIMEOUT errorCode and retried", async () => {
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const fetchStub = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchStub);
    const deliveries: Array<Record<string, unknown>> = [];
    const result = await dispatchWebhook(WEBHOOK_URL, PAYLOAD, {
      sleep: async () => undefined,
      recordDelivery: async (attempt, httpStatus, errorCode) => { deliveries.push({ attempt, httpStatus, errorCode }); },
    });
    expect(result).toEqual({ delivered: false, attempts: 3 });
    expect(deliveries.every((row) => row.errorCode === "TIMEOUT" && row.httpStatus === null)).toBe(true);
  });

  it("3xx redirect is a failure (redirect: manual), never a silent follow", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("moved", { status: 301, headers: { location: "https://elsewhere.test/hook" } }));
    vi.stubGlobal("fetch", fetchStub);
    const deliveries: Array<Record<string, unknown>> = [];
    const result = await dispatchWebhook(WEBHOOK_URL, PAYLOAD, {
      sleep: async () => undefined,
      recordDelivery: async (attempt, httpStatus, errorCode) => { deliveries.push({ attempt, httpStatus, errorCode }); },
    });
    expect(result.delivered).toBe(false);
    expect(deliveries.every((row) => row.httpStatus === 301 && row.errorCode === "HTTP_301")).toBe(true);
    expect(fetchStub.mock.calls.every(([, init]) => (init as RequestInit).redirect === "manual")).toBe(true);
  });

  it("payload is a typed allowlist with no secret-shaped keys or planted canary values (T-09-04)", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    await dispatchWebhook(WEBHOOK_URL, PAYLOAD);
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["correlationIds", "count", "event", "firstSeen", "lastSeen", "scope", "severity", "signal"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/token|password|secret|api.?key|authorization|database.?url/i);
    expect(serialized).not.toContain("secret-token-canary");
    expect(serialized).not.toContain(WEBHOOK_URL); // the URL itself never appears in any payload
  });
});

describe("evaluateAndDispatch delivery evidence", () => {
  const openCircuit = { circuitRows: [{ provider: "football-data.org", endpointFamily: "RESULTS", state: "OPEN", openedAt: null, updatedAt: NOW() }] };

  it("every attempt lands in OpsAlertDelivery; a failed dispatch never loses the alert (D-02)", async () => {
    const fetchStub = vi.fn().mockRejectedValue(Object.assign(new Error("connect refused"), { name: "TypeError" }));
    vi.stubGlobal("fetch", fetchStub);
    const fake = createFakeDatabase(OPEN_CIRCUIT);
    const { database, alerts } = fake;
    await evaluateAndDispatch(database as never, { get: async () => null }, NOW, { webhookUrl: WEBHOOK_URL }, () => undefined, { sleep: async () => undefined });
    expect(fake.deliveries).toHaveLength(3); // bounded attempts, each recorded
    expect(fake.deliveries.every((row) => row.errorCode === "TypeError")).toBe(true);
    const row = [...alerts.values()][0];
    expect(row?.status).toBe("OPEN"); // alert state lives in PostgreSQL, not in delivery
  });

  it("logs alerts.webhook_delivery_failed when all retries are exhausted", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => new Response("no", { status: 503 }));
    vi.stubGlobal("fetch", fetchStub);
    const events: Array<Record<string, unknown>> = [];
    const fake = createFakeDatabase(OPEN_CIRCUIT);
    await evaluateAndDispatch(fake.database as never, { get: async () => null }, NOW, { webhookUrl: WEBHOOK_URL }, (event) => { events.push(event); }, { sleep: async () => undefined });
    expect(events.some((event) => event.event === "alerts.webhook_delivery_failed")).toBe(true);
  });
});
