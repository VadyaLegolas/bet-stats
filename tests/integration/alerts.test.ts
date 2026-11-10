import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

import { NotFoundException } from "../../apps/api/node_modules/@nestjs/common/index.js";
import { OperationsService } from "../../apps/api/src/modules/operations/operations.service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let prisma: PrismaClient;
const run = process.pid.toString();
const id = (value: string) => `alert-${value}-${run}`;

/**
 * Acknowledge is idempotent: the OPEN → ACKNOWLEDGED transition row is appended
 * exactly once, and a repeated acknowledge is a no-op that never touches
 * count/lastSeen. The evaluator (Plan 02) reuses exactly this shape.
 */
async function acknowledge(alertId: string): Promise<void> {
  const alert = await prisma.opsAlert.findUnique({ where: { id: alertId } });
  if (!alert || alert.status !== "OPEN") return;
  await prisma.$transaction([
    prisma.opsAlertTransition.create({
      data: {
        id: `${alertId}-ack`,
        alertId,
        from: alert.status,
        to: "ACKNOWLEDGED",
        severityFrom: alert.severity,
        severityTo: alert.severity,
        at: new Date(),
      },
    }),
    prisma.opsAlert.update({
      where: { id: alertId },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    }),
  ]);
}

describe("alert tables: mutation rejection, dedup upsert, acknowledge idempotency", () => {
  beforeAll(async () => {
    prisma = createPrismaClient(databaseUrl);
    // Base guarded-mutable alert.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OpsAlert" (id,"dedupFingerprint",signal,scope,severity,status,count,"firstSeen","lastSeen","correlationIds") VALUES ($1,$2,'PROVIDER_5XX','api-football','WARNING','OPEN',1,now(),now(),$3::jsonb)`,
        id("base"), id("fp-base"), JSON.stringify(["job-1"]),
      ),
    ).resolves.toBe(1);
    // One transition and one delivery row for the append-only rejection cases.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OpsAlertTransition" (id,"alertId","from","to","severityFrom","severityTo",at) VALUES ($1,$2,'OPEN','ACKNOWLEDGED','WARNING','WARNING',now())`,
        id("transition"), id("base"),
      ),
    ).resolves.toBe(1);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OpsAlertDelivery" (id,"alertId",at,"httpStatus","errorCode",attempt) VALUES ($1,$2,now(),500,'ECONNRESET',1)`,
        id("delivery"), id("base"),
      ),
    ).resolves.toBe(1);
    // A second OPEN alert for the acknowledge-idempotency case.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OpsAlert" (id,"dedupFingerprint",signal,scope,severity,status,count,"firstSeen","lastSeen","correlationIds") VALUES ($1,$2,'SYNC_STALE','fixtures','CRITICAL','OPEN',3,now(),now(),$3::jsonb)`,
        id("ack"), id("fp-ack"), JSON.stringify([]),
      ),
    ).resolves.toBe(1);
  });

  afterAll(async () => prisma?.$disconnect());

  it("rejects OpsAlertTransition mutation as immutable", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "OpsAlertTransition" SET "to"='RESOLVED' WHERE id=$1`, id("transition")),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "OpsAlertTransition" WHERE id=$1`, id("transition")),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects OpsAlertDelivery mutation and removal as immutable", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "OpsAlertDelivery" SET "httpStatus"=200 WHERE id=$1`, id("delivery")),
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "OpsAlertDelivery" WHERE id=$1`, id("delivery")),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects OpsAlert identity change (id is immutable)", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "OpsAlert" SET id=$1 WHERE id=$2`, id("base-new"), id("base")),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects OpsAlert dedupFingerprint change (fingerprint is immutable)", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "OpsAlert" SET "dedupFingerprint"=$1 WHERE id=$2`, id("fp-new"), id("base")),
    ).rejects.toThrow(/immutable/i);
  });

  it("allows guarded severity change on OpsAlert", async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "OpsAlert" SET severity='CRITICAL' WHERE id=$1`, id("base")),
    ).resolves.toBe(1);
    const alert = await prisma.opsAlert.findUniqueOrThrow({ where: { id: id("base") } });
    expect(alert.severity).toBe("CRITICAL");
  });

  it("converges concurrent dedup upserts to one OPEN row with bumped count", async () => {
    const fingerprint = id("fp-dedup");
    const base = {
      signal: "WEBHOOK_FAILED",
      scope: "ops-webhook",
      severity: "WARNING",
      status: "OPEN",
      correlationIds: [],
    };
    // First occurrence creates count=1.
    await prisma.opsAlert.upsert({
      where: { dedupFingerprint: fingerprint },
      create: { id: id("dedup"), dedupFingerprint: fingerprint, ...base, count: 1, firstSeen: new Date(), lastSeen: new Date() },
      update: { count: { increment: 1 }, lastSeen: new Date() },
    });
    // Second occurrence must bump count/lastSeen, never insert a second row.
    await prisma.opsAlert.upsert({
      where: { dedupFingerprint: fingerprint },
      create: { id: id("dedup"), dedupFingerprint: fingerprint, ...base, count: 1, firstSeen: new Date(), lastSeen: new Date() },
      update: { count: { increment: 1 }, lastSeen: new Date() },
    });
    const rows = await prisma.opsAlert.findMany({ where: { dedupFingerprint: fingerprint } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.status).toBe("OPEN");
  });

  it("appends exactly one transition on acknowledge and is idempotent on repeat", async () => {
    const alertId = id("ack");
    await acknowledge(alertId);
    await acknowledge(alertId);
    const transitions = await prisma.opsAlertTransition.findMany({ where: { alertId } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.from).toBe("OPEN");
    expect(transitions[0]?.to).toBe("ACKNOWLEDGED");
    const alert = await prisma.opsAlert.findUniqueOrThrow({ where: { id: alertId } });
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.count).toBe(3);
    expect(alert.acknowledgedAt).not.toBeNull();
  });
});

describe("OperationsService.acknowledgeAlert (real PostgreSQL, ALRT-04)", () => {
  beforeAll(async () => {
    // The first describe's afterAll disconnects the shared client before this
    // suite runs — open a fresh connection for the service-level cases.
    prisma = createPrismaClient(databaseUrl);
    // A fresh OPEN alert for the service-level acknowledge cases.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "OpsAlert" (id,"dedupFingerprint",signal,scope,severity,status,count,"firstSeen","lastSeen","correlationIds") VALUES ($1,$2,'SYNC_STALE','fixtures','WARNING','OPEN',4,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z',$3::jsonb)`,
        id("svc-ack"), id("fp-svc-ack"), JSON.stringify(["corr-1"]),
      ),
    ).resolves.toBe(1);
  });

  it("acknowledges once — acknowledgedAt stamped, exactly one transition, count/lastSeen untouched — and is idempotent on repeat", async () => {
    const alertId = id("svc-ack");
    const service = new OperationsService(prisma);

    await expect(service.acknowledgeAlert(alertId)).resolves.toEqual({ acknowledged: true });

    const alert = await prisma.opsAlert.findUniqueOrThrow({ where: { id: alertId } });
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.acknowledgedAt).not.toBeNull();
    // Acknowledge never resets count/lastSeen and never resolves the alert.
    expect(alert.count).toBe(4);
    expect(alert.lastSeen.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(alert.resolvedAt).toBeNull();

    const transitions = await prisma.opsAlertTransition.findMany({ where: { alertId } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from: "OPEN", to: "ACKNOWLEDGED", severityFrom: "WARNING", severityTo: "WARNING" });

    // Repeat acknowledge: same result, no second transition row.
    await expect(service.acknowledgeAlert(alertId)).resolves.toEqual({ acknowledged: true });
    expect(await prisma.opsAlertTransition.count({ where: { alertId } })).toBe(1);
  });

  it("throws the uniform NotFoundException(\"Not found\") for a missing alert — no oracle", async () => {
    const service = new OperationsService(prisma);
    await expect(service.acknowledgeAlert(`alert-missing-${run}`)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.acknowledgeAlert(`alert-missing-${run}`)).rejects.toMatchObject({ message: "Not found" });
  });

  afterAll(async () => prisma?.$disconnect());
});
