import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { createOperationsProjection } from "../../apps/api/src/modules/operations/operations.service.js";

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
  };
}

describe("operator overview", () => {
  it("projects the ordered closed D-09/D-10 overview with bounded jobs", async () => {
    const projection = createOperationsProjection(repository(), () => new Date("2026-09-20T12:00:00.000Z"));
    const overview = await projection.overview({ page: 1, pageSize: 25, windowHours: 24 });

    expect(Object.keys(overview)).toEqual(["readiness", "providerHealth", "quotas", "failures", "dataQuality", "incidents"]);
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

describe("signed gateway", () => {
  it.todo("normalizes and verifies the signed operations ingress without forwarding unapproved headers");
});

function sign(secret: string, subject: string, timestamp: string, method: string, pathname: string, queryDigest: string): string {
  return createHmac("sha256", secret).update(`${subject}\n${timestamp}\n${method}\n${pathname}\n${queryDigest}`, "utf8").digest("base64url");
}

void sign;
