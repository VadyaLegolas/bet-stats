import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, createProviderRoutingRepository, type PrismaClient } from "@bet-stats/database";
import { PROVIDER_ROUTE_POLICY_VERSION, routeReceiptContentHash } from "@bet-stats/domain";

const root = resolve(import.meta.dirname, "../..");
const databaseRoot = resolve(root, "packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const container = `bet-stats-provider-routing-${process.pid}`;
let database: PrismaClient;

function docker(...args: string[]): string { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

describe("provider routing repository", () => {
  beforeAll(() => {
    docker("run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=bet_stats", "-p", "127.0.0.1::5432", "postgres:18-alpine");
    for (let i = 0; i < 60; i += 1) { try { docker("exec", container, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); } }
    const port = docker("port", container, "5432/tcp").split(":").at(-1)!;
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    database = createPrismaClient(url);
  }, 120_000);

  afterAll(async () => { await database?.$disconnect(); try { docker("rm", "-f", container); } catch { /* owned cleanup */ } }, 30_000);

  it("minimal migrated repository appends and reads a complete denial route", async () => {
    const repository = createProviderRoutingRepository({ database });
    const receipt = {
      policyVersion: PROVIDER_ROUTE_POLICY_VERSION,
      policyHash: "sha256:route-policy",
      competitionId: "league-pl",
      seasonId: "season-2026",
      endpointFamily: "FIXTURES",
      candidates: ["football-data.org", "api-football"] as const,
      selectedProvider: null,
      trigger: "ALLOWANCE_EXHAUSTED" as const,
      outcome: "NO_FALLBACK" as const,
      capabilitySnapshot: { status: "SUPPORTED" },
      budgetSnapshot: { remaining: 0 },
      circuitSnapshot: { state: "CLOSED" },
      correlationId: "corr-minimal",
    };
    const created = await repository.appendRoute({ id: "route-minimal", contentHash: routeReceiptContentHash(receipt), ...receipt });
    expect(await repository.readRoute(created.id)).toMatchObject({ ...receipt, id: "route-minimal", attempts: [] });
  });
});
