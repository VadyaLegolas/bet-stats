import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { NestFactory } from "../../apps/api/node_modules/@nestjs/core/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../apps/api/src/app.module.js";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-policy-approval-${process.pid}`;
let database: PrismaClient;
let origin: string;
let app: Awaited<ReturnType<typeof NestFactory.create>>;

function docker(...args: string[]) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

describe("provider policy approval", () => {
  beforeAll(async () => {
    docker("run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "-p", "127.0.0.1::5432", "postgres:18-alpine");
    for (let i = 0; i < 60; i += 1) { try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    process.env.OPERATOR_CREDENTIAL = "policy-test-credential";
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: process.env, stdio: "pipe" });
    database = createPrismaClient(process.env.DATABASE_URL);
    await database.league.create({ data: { id: "league-pl", name: "Premier League", countryCode: "GB" } });
    await database.season.create({ data: { id: "season-2026", leagueId: "league-pl", label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-06-01") } });
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 120_000);
  afterAll(async () => { await app?.close(); await database?.$disconnect(); try { docker("rm", "-f", container); } catch { /* owned cleanup */ } }, 30_000);

  it("production Nest graph rejects unauthorized requests before mutation and approves one exact pending artifact", async () => {
    const command = approvalCommand("approval-1");
    const unauthorized = await fetch(`${origin}/internal/providers/policy/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
    expect(unauthorized.status).toBe(404);
    expect(await database.providerCapability.count()).toBe(0);

    const response = await fetch(`${origin}/internal/providers/policy/approve`, { method: "POST", headers: { "content-type": "application/json", "x-operator-credential": "policy-test-credential", "x-operator-actor": "policy-operator" }, body: JSON.stringify(command) });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    const body = await response.json();
    expect(body).toMatchObject({ decisionId: "approval-1", status: "approved", actor: "policy-operator", scope: command.scope });
    expect(JSON.stringify(body)).not.toMatch(/credential|rawHeaders|rawPayload|account/i);
    expect(await database.providerCapability.count()).toBe(1);
    expect(await database.providerRouteAttempt.count()).toBe(1);
    expect(await database.providerRouteReceipt.findUniqueOrThrow({ where: { id: "provider-policy:approval-1" } })).toMatchObject({ circuitSnapshot: { state: "POLICY_APPROVAL", actor: "policy-operator" } });
  });

  it("fails closed with append-only exact-scope rejection evidence", async () => {
    await database.providerCapability.create({ data: { provider: "api-football", leagueId: "league-pl", seasonId: "season-2026", endpoint: "STANDINGS", supported: true, verifiedAt: new Date(), expiresAt: null } });
    const command = approvalCommand("approval-unknown");
    command.artifact.quota = { limit: null, remaining: null, resetAt: null, status: "unknown" };
    const response = await authorized(command);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "UNKNOWN_QUOTA_POLICY" });
    expect(await database.providerRouteAttempt.findUnique({ where: { attemptKey: "approval-unknown" } })).toMatchObject({ admitted: false, reason: "UNKNOWN_QUOTA_POLICY", observationId: null });
    expect(await database.providerCapability.findUnique({ where: { provider_leagueId_seasonId_endpoint: { provider: "api-football", leagueId: "league-pl", seasonId: "season-2026", endpoint: "STANDINGS" } } })).toMatchObject({ supported: true });
  });

  it("returns the prior decision for concurrent duplicate idempotency keys", async () => {
    const command = approvalCommand("approval-concurrent");
    const responses = await Promise.all([authorized(command), authorized(command)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await database.providerRouteAttempt.count({ where: { attemptKey: "approval-concurrent" } })).toBe(1);
    const replay = await fetch(`${origin}/internal/providers/policy/approve`, { method: "POST", headers: { "content-type": "application/json", "x-operator-credential": "policy-test-credential", "x-operator-actor": "different-replay-actor" }, body: JSON.stringify(command) });
    expect(await replay.json()).toMatchObject({ actor: "policy-operator" });
  });

  it("rejects replay of an idempotency key for a different approved command identity", async () => {
    const original = approvalCommand("approval-conflict");
    const conflicting = approvalCommand("approval-conflict");
    conflicting.scope.endpoint = "RESULTS";
    conflicting.artifact.endpoint = "RESULTS";
    conflicting.artifact.scope.endpoint = "RESULTS";
    conflicting.artifact.coverage[0]!.endpoint = "RESULTS";
    conflicting.artifact.artifactId = "candidate-2";
    conflicting.artifact.requestFingerprint = "sha256:different-request";

    const [first, replay] = await Promise.all([authorized(original), authorized(conflicting)]);
    expect([first.status, replay.status].sort()).toEqual([201, 400]);
    const conflict = first.status === 400 ? first : replay;
    expect(await conflict.json()).toEqual({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(await database.providerRouteAttempt.count({ where: { attemptKey: "approval-conflict" } })).toBe(1);
    expect(await database.providerCapability.count({ where: { OR: [{ endpoint: "FIXTURES" }, { endpoint: "RESULTS" }] } })).toBe(1);
  });

  it.each([
    ["stale", (command: any) => { command.artifact.capturedAt = "2020-01-01T00:00:00.000Z"; }, "ARTIFACT_STALE"],
    ["mismatch", (command: any) => { command.artifact.scope.endpoint = "RESULTS"; }, "ARTIFACT_SCOPE_MISMATCH"],
    ["disagreement", (command: any) => { command.artifact.disagreements = ["SEASON_MISMATCH"]; }, "ARTIFACT_DISAGREEMENT"],
    ["version", (command: any) => { command.expectedPolicyVersion = "provider-route-policy/v0"; }, "POLICY_VERSION_CONFLICT"],
  ])("rejects %s authority changes with stable scoped evidence", async (suffix, mutate, code) => {
    const command = approvalCommand(`approval-${suffix}`);
    mutate(command);
    const response = await authorized(command);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code });
    expect(await database.providerRouteAttempt.findUnique({ where: { attemptKey: `approval-${suffix}` } })).toMatchObject({ admitted: false, reason: code });
  });
});

function authorized(command: ReturnType<typeof approvalCommand>) {
  return fetch(`${origin}/internal/providers/policy/approve`, { method: "POST", headers: { "content-type": "application/json", "x-operator-credential": "policy-test-credential", "x-operator-actor": "policy-operator" }, body: JSON.stringify(command) });
}

function approvalCommand(idempotencyKey: string) {
  const capturedAt = new Date().toISOString();
  const scope = { provider: "football-data.org", competitionId: "league-pl", seasonId: "season-2026", endpoint: "FIXTURES" };
  return { idempotencyKey, expectedPolicyVersion: "provider-route-policy/v1", scope, artifact: { schemaVersion: 1, artifactId: "candidate-1", environment: "non-production", capturedAt, provider: scope.provider, endpoint: scope.endpoint, requestFingerprint: "sha256:request", scope, quota: { limit: 10, remaining: 9, resetAt: new Date(Date.now() + 86_400_000).toISOString(), status: "known" }, coverage: [{ competitionId: scope.competitionId, seasonId: scope.seasonId, endpoint: scope.endpoint, supported: true }], disagreements: [], redaction: { credentialsPersisted: false, rawHeadersPersisted: false, rawPayloadPersisted: false }, approval: { status: "pending", approvedBy: null, approvedAt: null, policyVersion: null } } };
}
