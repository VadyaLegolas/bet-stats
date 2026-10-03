import { timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@bet-stats/database";

import { OperatorGuard } from "../../apps/api/src/modules/reconciliation/operator.guard.js";
import { ReconciliationService } from "../../apps/api/src/modules/reconciliation/reconciliation.service.js";

describe("protected reconciliation review", () => {
  it("is disabled when the server credential is absent", () => {
    const guard = new OperatorGuard(undefined);
    expect(() => guard.authorize(undefined)).toThrow("Not found");
    expect(() => guard.authorize("anything")).toThrow("Not found");
  });

  it("denies invalid credentials with the same generic response and accepts the configured credential", () => {
    const guard = new OperatorGuard("configured-value");
    expect(() => guard.authorize(undefined)).toThrow("Not found");
    expect(() => guard.authorize("wrong-value")).toThrow("Not found");
    expect(guard.authorize("configured-value")).toEqual({ actor: "operator" });
    expect(timingSafeEqual(Buffer.from("a"), Buffer.from("a"))).toBe(true);
  });

  it("lists oldest cases with bounded pagination and complete evidence/history", async () => {
    const database = fakeDatabase();
    const service = new ReconciliationService(database as never);
    const result = await service.listOpen({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "case-old", version: 1, provider: "provider <script>", incomingSnapshot: { name: "<img>" } });
    expect(result.items[0]?.candidates[0]).toMatchObject({ canonicalEntityId: "team-a", evidence: { normalized: "arsenal" } });
    expect(result.nextCursor).toBe("case-old");
  });

  it.each([
    ["approve", { candidateId: "candidate-a" }, "LINK"],
    ["manual-link", { canonicalEntityId: "team-manual" }, "LINK"],
    ["reject-create", { canonicalName: "New Team", countryCode: "PL" }, "CREATE"],
  ] as const)("appends %s atomically and makes retries idempotent", async (kind, target, expectedAction) => {
    const database = fakeDatabase();
    const service = new ReconciliationService(database as never);
    const command = { caseId: "case-old", expectedVersion: 1, idempotencyKey: `retry-${kind}`, note: "Reviewed against source evidence", ...target };
    const first = await service.decide(kind, command, "operator");
    const retry = await service.decide(kind, command, "operator");
    expect(first.decision.action).toBe(expectedAction);
    expect(retry.decision.id).toBe(first.decision.id);
    expect(database.audit).toHaveLength(1);
    expect(database.audit[0]).toMatchObject({ actor: "operator", evidence: expect.objectContaining({ note: command.note }) });
  });

  it("appends a superseding correction and rejects a stale case version without overwriting", async () => {
    const database = fakeDatabase();
    const service = new ReconciliationService(database as never);
    const initial = await service.decide("approve", { caseId: "case-old", expectedVersion: 1, idempotencyKey: "initial", note: "Original evidence note", candidateId: "candidate-a" }, "operator");
    const correction = await service.decide("correction", { caseId: "case-old", expectedVersion: 2, idempotencyKey: "correction", note: "Corrected after source update", canonicalEntityId: "team-manual", supersedesDecisionId: initial.decision.id }, "operator");
    expect(correction.decision.supersedesDecisionId).toBe(initial.decision.id);
    expect(database.audit).toHaveLength(2);
    await expect(service.decide("manual-link", { caseId: "case-old", expectedVersion: 1, idempotencyKey: "stale", note: "This is stale evidence", canonicalEntityId: "team-z" }, "operator")).rejects.toMatchObject({ status: 409 });
    expect(database.audit).toHaveLength(2);
  });
});

it("proves optimistic append-only review against PostgreSQL 18", async () => {
  const name = `bet-stats-review-${process.pid}`; const databaseRoot = resolve(import.meta.dirname, "../../packages/database"); const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
  const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  docker("run", "--detach", "--name", name, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "bet_stats"); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); } }
    const port = docker("port", name, "5432/tcp").split(":").at(-1)!; const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const db = createPrismaClient(url);
    try {
      const team = await db.team.create({ data: { name: "Arsenal", normalizedName: "arsenal", countryCode: "GB" } });
      await db.reconciliationCase.create({ data: { id: "live-case", entityType: "TEAM", provider: "live-test", externalId: "ext-live", incomingSnapshot: { name: "Arsenal FC" }, candidates: { create: { id: "live-candidate", canonicalEntityId: team.id, method: "MANUAL_REVIEW", confidence: 0.9, evidence: { exactCountry: true } } } } });
      const service = new ReconciliationService(db); const result = await service.decide("approve", { caseId: "live-case", expectedVersion: 1, idempotencyKey: "live-approve", note: "Matched official country and name", candidateId: "live-candidate" }, "operator");
      expect((await db.reconciliationCase.findUniqueOrThrow({ where: { id: "live-case" } })).version).toBe(2);
      expect((await db.reconciliationDecision.findMany({ where: { caseId: "live-case" } }))).toHaveLength(1);
      await expect(service.decide("manual-link", { caseId: "live-case", expectedVersion: 1, idempotencyKey: "live-stale", note: "Stale operator decision note", canonicalEntityId: team.id }, "operator")).rejects.toMatchObject({ status: 409 });
      await expect(db.reconciliationDecision.update({ where: { id: result.decision.id }, data: { actor: "changed" } })).rejects.toThrow();
    } finally { await db.$disconnect(); }
  } finally { try { docker("rm", "--force", name); } catch { /* best effort */ } }
}, 120_000);

function fakeDatabase() {
  const audit: Array<Record<string, any>> = [];
  const state = { version: 1, status: "OPEN", resolvedAt: null as Date | null };
  const cases = [{ id: "case-old", entityType: "TEAM", provider: "provider <script>", externalId: "ext-1", status: "OPEN", version: 1, incomingSnapshot: { name: "<img>" }, openedAt: new Date("2026-01-01"), resolvedAt: null, candidates: [{ id: "candidate-a", caseId: "case-old", canonicalEntityId: "team-a", status: "SUGGESTED", method: "MANUAL_REVIEW", confidence: { toString: () => "0.8" }, evidence: { normalized: "arsenal" }, createdAt: new Date("2026-01-01") }], decisions: [] }];
  const db: any = {
    audit,
    reconciliationCase: { findMany: async ({ take }: any) => cases.slice(0, take), findUnique: async () => ({ ...cases[0], ...state }) },
    reconciliationDecision: { findUnique: async ({ where }: any) => audit.find((row) => row.id === where.id) ?? null },
    $transaction: async (callback: any) => callback({
      reconciliationCase: {
        findUnique: async () => ({ ...cases[0], ...state, decisions: audit }),
        updateMany: async ({ where, data }: any) => { if (where.version !== state.version) return { count: 0 }; state.version += 1; state.status = data.status ?? state.status; state.resolvedAt = data.resolvedAt ?? state.resolvedAt; return { count: 1 }; },
      },
      reconciliationDecision: {
        findUnique: async ({ where }: any) => audit.find((row) => row.id === where.id) ?? null,
        create: async ({ data }: any) => { const row = { ...data, decidedAt: new Date(), confidence: { toString: () => String(data.confidence) } }; audit.push(row); return row; },
      },
      team: { create: async ({ data }: any) => ({ id: "created-team", ...data }) },
    }),
  };
  return db;
}
