import { createHash, createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NotFoundException } from "../../apps/api/node_modules/@nestjs/common/index.js";

import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { computeBackupFact, createBullBackupTriggerEnqueuer, createOperationsProjection, failedDrillChecks, OperationsService, backupTriggerQueueName, type BackupRows } from "../../apps/api/src/modules/operations/operations.service.js";
import { OperationsController } from "../../apps/api/src/modules/operations/operations.controller.js";
import { verifyIngressOperationsRequest } from "../../apps/web/app/internal-api/operations/[[...path]]/route.js";

const CANARIES = [
  "secret-token-canary",
  "raw-payload-canary",
  "authorization-header-canary",
  "environment-canary",
  "stack-trace-canary",
  "unrestricted-log-canary",
];

function flatten(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function repository() {
  return {
    readiness: vi.fn(async () => ({ postgres: true, redis: false, checkedAt: new Date("2026-09-20T12:00:00.000Z") })),
    providerHealth: vi.fn(async () => [{ provider: "football-data.org", endpointFamily: "FIXTURES", state: "OPEN", lastSuccessAt: new Date("2026-09-20T10:00:00.000Z"), reason: "UPSTREAM_5XX", unsafe: CANARIES }] as never),
    quotas: vi.fn(async () => [{ provider: "football-data.org", endpointFamily: "FIXTURES", used: 9, effectiveAllowance: 10, resetAt: new Date("2026-09-21T00:00:00.000Z"), criticalReservations: 2, unsafe: CANARIES }] as never),
    failures: vi.fn(async () => Array.from({ length: 27 }, (_, index) => ({
      id: `job-${String(index + 1).padStart(2, "0")}`,
      rootCause: "UPSTREAM_5XX",
      impact: index === 0 ? "BLOCKING" : "DEGRADED",
      scope: "football-data.org/FIXTURES",
      occurredAt: new Date(`2026-09-20T10:${String(index).padStart(2, "0")}:00.000Z`),
      retryable: true,
      correlationId: `corr-${index + 1}`,
      unsafe: CANARIES,
    })) as never),
    dataQuality: vi.fn(async () => [{ code: "IDENTITY_AMBIGUOUS", scope: "FIXTURE", count: 2, firstOccurrence: new Date("2026-09-20T09:00:00.000Z"), lastOccurrence: new Date("2026-09-20T11:00:00.000Z"), unsafe: CANARIES }] as never),
    incidents: vi.fn(async () => [{ id: "incident-1", status: "OPEN", impact: "DEGRADED", summary: "Provider results delayed", startedAt: new Date("2026-09-20T10:00:00.000Z"), lastUpdatedAt: new Date("2026-09-20T11:00:00.000Z"), correlationId: "corr-incident", unsafe: CANARIES }] as never),
    backups: vi.fn(async () => ({
      configured: true,
      lastBackup: { fileName: "football_prediction-20260920T100000Z.dump", byteSize: 4096, sha256: "d".repeat(64), durationMs: 3_200, completedAt: new Date("2026-09-20T10:00:00.000Z"), status: "SUCCEEDED", offsiteStatus: "COPIED" },
      lastDrill: { overall: "VERIFIED", completedAt: new Date("2026-09-19T12:00:00.000Z"), restoreDurationMs: 9_000, containerCleanup: "REMOVED", failedChecks: [] },
      retentionCount: 14,
      drillIntervalHours: 168,
      unsafe: CANARIES,
    }) as never),
  };
}

describe("operator overview", () => {
  it("does not disconnect an injected application-owned Prisma client", async () => {
    const disconnect = vi.fn(async () => undefined);
    const service = new OperationsService({ $disconnect: disconnect } as never);

    await service.onModuleDestroy();

    expect(disconnect).not.toHaveBeenCalled();
  });

  it("projects the ordered closed D-09/D-10 overview with bounded jobs", async () => {
    const projection = createOperationsProjection(repository(), () => new Date("2026-09-20T12:00:00.000Z"));
    const overview = await projection.overview({ page: 1, pageSize: 25, windowHours: 24 });

    expect(Object.keys(overview)).toEqual(["readiness", "providerHealth", "quotas", "failures", "dataQuality", "incidents", "backups"]);
    expect(overview.readiness).toEqual({ state: "DEGRADED", services: [{ name: "PostgreSQL", state: "AVAILABLE" }, { name: "Redis", state: "UNAVAILABLE" }], lastCheckedAt: "2026-09-20T12:00:00.000Z" });
    expect(overview.quotas[0]).toMatchObject({ used: 9, effectiveAllowance: 10, percentage: 90, criticalReservations: 2 });
    expect(overview.failures.groups[0]).toMatchObject({ rootCause: "UPSTREAM_5XX", impact: "BLOCKING", count: 1, retryable: true });
    expect(overview.failures.pagination).toEqual({ page: 1, pageSize: 25, total: 27, start: 1, end: 25, pages: 2 });
    expect(overview.failures.jobs).toHaveLength(25);
    expect(flatten(overview)).not.toMatch(/secret-token-canary|raw-payload-canary|authorization-header-canary|environment-canary|stack-trace-canary|unrestricted-log-canary/);
  });

  it("rejects arbitrary filters and unsafe correlation identifiers", async () => {
    const unsafe = repository();
    unsafe.failures.mockResolvedValueOnce([{ id: "job", rootCause: "FAILED", impact: "BLOCKING", scope: "sync", occurredAt: new Date(), retryable: false, correlationId: "corr\nsecret-token-canary" }] as never);
    const projection = createOperationsProjection(unsafe, () => new Date("2026-09-20T12:00:00.000Z"));
    await expect(projection.overview({ page: 1, pageSize: 25, windowHours: 24, diagnostics: "all" } as never)).rejects.toThrow("INVALID_OPERATIONS_QUERY");
    const overview = await projection.overview({ page: 1, pageSize: 25, windowHours: 24 });
    expect(overview.failures.jobs[0]?.correlationId).toBeNull();
  });

  it("keeps unauthorized callers at the uniform not-found boundary", () => {
    expect(() => new OperatorGuard("operator-secret").authorize("wrong-secret")).toThrow("Not found");
  });
});

describe("backups read model (five-state, computed at read time)", () => {
  const NOW = new Date("2026-09-20T12:00:00.000Z");
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - Math.round(hours * 3_600_000));
  const rows = (overrides: Partial<BackupRows> = {}): BackupRows => ({
    configured: true,
    lastBackup: { fileName: "football_prediction-20260920T100000Z.dump", byteSize: 4096, sha256: "d".repeat(64), durationMs: 3_200, completedAt: hoursAgo(2), status: "SUCCEEDED", offsiteStatus: "COPIED" },
    lastDrill: { overall: "VERIFIED", completedAt: hoursAgo(24), restoreDurationMs: 9_000, containerCleanup: "REMOVED", failedChecks: [] },
    retentionCount: 14,
    drillIntervalHours: 168,
    ...overrides,
  });
  async function projected(backupRows: Record<string, unknown>) {
    const repo = repository();
    repo.backups.mockResolvedValueOnce(backupRows as never);
    return createOperationsProjection(repo, () => NOW).overview({ page: 1, pageSize: 25, windowHours: 24 });
  }

  it("reports NOT_CONFIGURED when backups are disabled or BACKUP_DIR is absent", async () => {
    const overview = await projected({ ...rows({ configured: false, lastBackup: null, lastDrill: null }), unsafe: CANARIES });
    expect(overview.backups).toMatchObject({ configured: false, state: "NOT_CONFIGURED", lastBackup: null, lastDrill: null });
    expect(flatten(overview.backups)).not.toMatch(/secret-token-canary|raw-payload-canary/);
  });

  it("reports NEVER_VERIFIED when enabled but no backup has ever run", async () => {
    const overview = await projected(rows({ lastBackup: null, lastDrill: null }));
    expect(overview.backups).toMatchObject({ state: "NEVER_VERIFIED", backupStale: true, drillStale: true, lastBackup: null, lastDrill: null });
  });

  it("reports NEVER_VERIFIED (non-green) when backup runs exist but zero receipts do", async () => {
    const overview = await projected(rows({ lastDrill: null }));
    expect(overview.backups.state).toBe("NEVER_VERIFIED");
    expect(overview.backups.lastBackup?.status).toBe("SUCCEEDED");
  });

  it("reports HEALTHY when the backup is fresh (24h59m) and the drill passed and is fresh (191h59m)", async () => {
    const overview = await projected(rows({ lastBackup: { ...rows().lastBackup!, completedAt: hoursAgo(24 + 59 / 60) }, lastDrill: { ...rows().lastDrill!, completedAt: hoursAgo(191 + 59 / 60) } }));
    expect(overview.backups).toMatchObject({ state: "HEALTHY", backupStale: false, drillStale: false });
  });

  it("renders STALE when the last success is older than 25h (25h01m), even with a fresh VERIFIED drill", async () => {
    const overview = await projected(rows({ lastBackup: { ...rows().lastBackup!, completedAt: hoursAgo(25 + 1 / 60) }, lastDrill: { ...rows().lastDrill!, completedAt: hoursAgo(1) } }));
    expect(overview.backups).toMatchObject({ state: "STALE", backupStale: true, drillStale: false });
  });

  it("renders drill-stale STALE when the newest VERIFIED receipt exceeds interval (168h) + 24h grace (192h01m)", async () => {
    const overview = await projected(rows({ lastDrill: { ...rows().lastDrill!, completedAt: hoursAgo(192 + 1 / 60) } }));
    expect(overview.backups).toMatchObject({ state: "STALE", backupStale: false, drillStale: true });
  });

  it.each([["UNVERIFIED"], ["FAILED"]])("renders FAILED when the newest receipt overall is %s, even when fresh", async (overall) => {
    const overview = await projected(rows({ lastDrill: { ...rows().lastDrill!, overall, completedAt: hoursAgo(1), failedChecks: overall === "FAILED" ? ["parity.Fixture", "fkOrphans"] : [] } }));
    expect(overview.backups.state).toBe("FAILED");
  });

  it("emits only basenames and safe codes — no directory path and no connection-string scheme marker in the payload", async () => {
    const overview = await projected({
      ...rows({ lastBackup: { ...rows().lastBackup!, fileName: "football_prediction-20260920T100000Z.dump" } }),
      dir: "D:\\Users\\Vlad\\bet-stats\\backups",
      offsiteDir: "C:/Users/Vlad/OneDrive/backups",
      unsafe: CANARIES,
    });
    const serialized = JSON.stringify(overview.backups);
    expect(serialized).not.toMatch(/postgresql:\/\//i);
    expect(serialized).not.toMatch(/\bredis:\/\//i);
    expect(serialized).not.toMatch(/\bmongodb(\+srv)?:\/\//i);
    expect(serialized).not.toMatch(/\bamqp:\/\//i);
    expect(serialized).not.toMatch(/D:\\|C:\//);
    expect(serialized).not.toMatch(/Users.Vlad/);
    expect(serialized).not.toMatch(/secret-token-canary|raw-payload-canary|authorization-header-canary/);
    expect(overview.backups.lastBackup?.fileName).toBe("football_prediction-20260920T100000Z.dump");
  });

  it("keeps the state computation read-time pure: staleness flips as the injected clock advances", () => {
    const base = rows({ lastBackup: { ...rows().lastBackup!, completedAt: hoursAgo(24 + 59 / 60) } });
    expect(computeBackupFact(base, NOW).state).toBe("HEALTHY");
    expect(computeBackupFact(base, new Date(NOW.getTime() + 2 * 3_600_000)).state).toBe("STALE");
  });

  it("extracts FAILED check names from the receipt checks JSON and strips unsafe key characters", () => {
    const checks = { restore: { state: "PASSED" }, migrations: { state: "AT_HEAD" }, chainIntegrity: true, nonEmpty: { Fixture: { state: "PASSED" } }, parity: { Fixture: { state: "FAILED", restored: 1 }, Team: { state: "FAILED", restored: 0 } }, fkOrphans: { state: "FAILED", total: 2 }, curated: { state: "PASSED" } };
    expect(failedDrillChecks(checks)).toEqual(["parity.Fixture", "parity.Team", "fkOrphans"]);
    expect(failedDrillChecks({ "evil\nkey": { state: "FAILED" } })).toEqual(["evilkey"]);
    expect(failedDrillChecks({ deep: { nested: [{ state: "FAILED" }] } })).toEqual(["deep.nested0"]);
  });
});

describe("manual backup and drill triggers", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  function fakeQueue() {
    const adds: Array<{ name: string; data: unknown; opts?: Record<string, unknown> }> = [];
    return {
      adds,
      queue: {
        add: vi.fn(async (name: string, data: unknown, opts?: Record<string, unknown>) => { adds.push({ name, data, ...(opts ? { opts } : {}) }); return {}; }),
        close: vi.fn(async () => undefined),
      },
    };
  }

  it("computes the queue name as ${prefix}-backup exactly like the worker", () => {
    expect(backupTriggerQueueName("test-prefix")).toBe("test-prefix-backup");
    expect(backupTriggerQueueName()).toBe("bet-stats-backup");
  });

  it("POST backups/run enqueues job backup with data exactly { trigger: MANUAL } and a manual-backup jobId", async () => {
    vi.stubEnv("BACKUP_ENABLED", "true");
    vi.stubEnv("BACKUP_DIR", "D:\\backups-canary");
    const { adds, queue } = fakeQueue();
    const service = new OperationsService({} as never, createBullBackupTriggerEnqueuer({ redisUrl: "redis://127.0.0.1:6379", prefix: "test-prefix", queue }));

    const result = await service.triggerBackup();

    expect(result).toEqual({ queued: true });
    expect(queue.add).toHaveBeenCalledOnce();
    expect(adds).toHaveLength(1);
    expect(adds[0]!.name).toBe("backup");
    expect(adds[0]!.data).toEqual({ trigger: "MANUAL" });
    expect(Object.keys(adds[0]!.data as object)).toEqual(["trigger"]);
    expect(adds[0]!.opts?.jobId).toMatch(/^manual-backup-\d+$/);
    expect(adds[0]!.opts?.attempts).toBe(1);
  });

  it("POST backups/drill enqueues job drill with data exactly { trigger: MANUAL } and a distinct manual-drill jobId", async () => {
    vi.stubEnv("BACKUP_ENABLED", "true");
    vi.stubEnv("BACKUP_DIR", "D:\\backups-canary");
    const { adds, queue } = fakeQueue();
    const service = new OperationsService({} as never, createBullBackupTriggerEnqueuer({ redisUrl: "redis://127.0.0.1:6379", prefix: "test-prefix", queue }));

    await service.triggerDrill();

    expect(adds).toHaveLength(1);
    expect(adds[0]!.name).toBe("drill");
    expect(adds[0]!.data).toEqual({ trigger: "MANUAL" });
    expect(Object.keys(adds[0]!.data as object)).toEqual(["trigger"]);
    expect(adds[0]!.opts?.jobId).toMatch(/^manual-drill-\d+$/);

    const backupJobId = `manual-backup-${Date.now()}`;
    expect(adds[0]!.opts?.jobId).not.toBe(backupJobId);
  });

  it("disabled or unconfigured backups yield the uniform 404 and never enqueue (no oracle, T-08-16)", async () => {
    vi.stubEnv("BACKUP_ENABLED", "false");
    vi.stubEnv("BACKUP_DIR", "D:\\backups-canary");
    const { adds, queue } = fakeQueue();
    const service = new OperationsService({} as never, createBullBackupTriggerEnqueuer({ redisUrl: "redis://127.0.0.1:6379", prefix: "test-prefix", queue }));

    await expect(service.triggerBackup()).rejects.toThrow(NotFoundException);
    await expect(service.triggerDrill()).rejects.toThrow("Not found");
    expect(queue.add).not.toHaveBeenCalled();
    expect(adds).toHaveLength(0);
  });

  it("a bad operator credential on POST internal/operations/backups/run yields 404 Not found without reaching the service", () => {
    const guard = new OperatorGuard("operator-credential-long-enough");
    const service = { triggerBackup: vi.fn(), triggerDrill: vi.fn() };
    const controller = new OperationsController(service as never);
    const handle = (presented: string | undefined) => { guard.authorize(presented); return controller.backupsRun(); };

    expect(() => handle("wrong-credential")).toThrow(NotFoundException);
    expect(() => handle(undefined)).toThrow("Not found");
    expect(service.triggerBackup).not.toHaveBeenCalled();
    expect(service.triggerDrill).not.toHaveBeenCalled();

    expect(() => guard.authorize("operator-credential-long-enough")).not.toThrow();
  });
});

describe("signed gateway", () => {
  it("normalizes and verifies the signed operations ingress", () => {
    vi.stubEnv("OPERATOR_PROXY_SIGNING_SECRET", "operations-signing-secret-that-is-long-enough");
    vi.stubEnv("OPERATOR_AUTHORIZED_SUBJECTS", "ops@example.com");
    const timestamp = "2026-09-20T12:00:00.000Z";
    const pathname = "/internal-api/operations/overview";
    const search = "?page=1&impact=BLOCKING";
    const signature = sign(process.env.OPERATOR_PROXY_SIGNING_SECRET!, "ops@example.com", timestamp, "GET", pathname, queryDigest(search));
    const request = requestLike(pathname, search, { "x-operator-subject": "ops@example.com", "x-operator-timestamp": timestamp, "x-operator-signature": signature });
    expect(verifyIngressOperationsRequest(request as never, Date.parse(timestamp))).toEqual({ subject: "ops@example.com" });
    vi.unstubAllEnvs();
  });

  it("returns the same denial for malformed, expired, invalid and non-NFKC ingress", () => {
    vi.stubEnv("OPERATOR_PROXY_SIGNING_SECRET", "operations-signing-secret-that-is-long-enough");
    vi.stubEnv("OPERATOR_AUTHORIZED_SUBJECTS", "ops@example.com");
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    for (const headers of [
      {},
      { "x-operator-subject": "ops@example.com", "x-operator-timestamp": "2026-09-20T11:00:00.000Z", "x-operator-signature": "x".repeat(43) },
      { "x-operator-subject": "ops@example.com", "x-operator-timestamp": "2026-09-20T12:00:00.000Z", "x-operator-signature": "x".repeat(43) },
      { "x-operator-subject": "ｏps@example.com", "x-operator-timestamp": "2026-09-20T12:00:00.000Z", "x-operator-signature": "x".repeat(43) },
    ]) expect(verifyIngressOperationsRequest(requestLike("/internal-api/operations/overview", "", headers) as never, now)).toBeNull();
    vi.unstubAllEnvs();
  });
});

function sign(secret: string, subject: string, timestamp: string, method: string, pathname: string, queryDigest: string): string {
  return createHmac("sha256", secret).update(`${subject}\n${timestamp}\n${method}\n${pathname}\n${queryDigest}`, "utf8").digest("base64url");
}

void sign;

function queryDigest(search: string): string {
  const pairs = [...new URLSearchParams(search).entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return createHash("sha256").update(new URLSearchParams(pairs).toString(), "utf8").digest("base64url");
}

function requestLike(pathname: string, search: string, values: Record<string, string>) {
  return { method: "GET", nextUrl: { pathname, search }, headers: { get: (name: string) => values[name] ?? null } };
}
