import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import {
  ALERT_FINGERPRINT_SEPARATOR,
  dedupUpsert,
  type SignalEvaluation,
} from "../../workers/data-sync/src/jobs/alerts.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;
const run = process.pid.toString();
const fp = (signal: string, scope: string) => `${signal}${ALERT_FINGERPRINT_SEPARATOR}${scope}`;

function evaluation(signal: string, scope: string): SignalEvaluation {
  const at = new Date();
  return {
    signal,
    scope: `${scope}-it-${run}`,
    severity: "WARNING",
    correlationIds: [],
    firstSeen: at,
    lastSeen: at,
  };
}

/**
 * G-09-1 reproduction / proof: the evaluator's dedup upsert path must roundtrip a
 * real fingerprint through PostgreSQL TEXT — findUnique/update by dedupFingerprint
 * that threw `22021 invalid byte sequence for encoding UTF8: 0x00` before the
 * separator fix. All mutations go through the guarded Prisma client paths only
 * (no $executeRawUnsafe bypass of the immutability triggers, no resolveClearedAlerts
 * sweep of unrelated rows).
 */
describe("dedupUpsert fingerprint roundtrip on real PostgreSQL (G-09-1)", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
  });

  afterAll(async () => prisma?.$disconnect());

  it("roundtrip: create → findUnique by real fingerprint succeeds, one OPEN row", async () => {
    const eval_ = evaluation("PROVIDER_QUOTA", "api-football");
    const fingerprint = fp(eval_.signal, eval_.scope);

    // Invariant: no NUL byte ever enters a TEXT column.
    expect(fingerprint).not.toContain("\0");
    expect(fingerprint.split(ALERT_FINGERPRINT_SEPARATOR)).toHaveLength(2);

    const outcome = await dedupUpsert(prisma, eval_, new Date());
    expect(outcome.action).toBe("open");
    expect(outcome.alert.status).toBe("OPEN");
    expect(outcome.alert.count).toBe(1);

    // The exact operation that failed with 22021 before the fix.
    const stored = await prisma.opsAlert.findUnique({ where: { dedupFingerprint: fingerprint } });
    expect(stored).not.toBeNull();
    expect(stored?.dedupFingerprint).toBe(fingerprint);
    expect(stored?.status).toBe("OPEN");
  });

  it("occurrence: second dedupUpsert bumps count to 2, never inserts a second row", async () => {
    const eval_ = evaluation("WEBHOOK_FAILED", "ops-webhook");
    const fingerprint = fp(eval_.signal, eval_.scope);

    const first = await dedupUpsert(prisma, eval_, new Date());
    expect(first.action).toBe("open");

    const second = await dedupUpsert(prisma, eval_, new Date());
    expect(second.action).toBe("occurrence");
    expect(second.alert.count).toBe(2);

    const rows = await prisma.opsAlert.findMany({ where: { dedupFingerprint: fingerprint } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.status).toBe("OPEN");
  });

  it("guarded resolve + re-open: RESOLVED→OPEN transition, count bumped", async () => {
    const eval_ = evaluation("SYNC_FAILURES", `uat09-reopen-${run}`);
    const fingerprint = fp(eval_.signal, eval_.scope);

    const first = await dedupUpsert(prisma, eval_, new Date());
    expect(first.action).toBe("open");

    // Guarded mutation: status flip only — id/dedupFingerprint untouched.
    await prisma.opsAlert.update({
      where: { dedupFingerprint: fingerprint },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });

    const third = await dedupUpsert(prisma, eval_, new Date());
    expect(third.action).toBe("re-open");
    expect(third.alert.status).toBe("OPEN");
    expect(third.alert.count).toBe(2);

    const transitions = await prisma.opsAlertTransition.findMany({
      where: { alertId: third.alert.id },
    });
    expect(transitions.some((t) => t.from === "RESOLVED" && t.to === "OPEN")).toBe(true);
  });
});
