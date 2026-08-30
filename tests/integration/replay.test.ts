import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { createReplayService } from "../../apps/api/src/modules/replay/replay.service.js";

const request = { provider: "football-data.org", competitionId: "PL", seasonId: "2026", endpointFamily: "RESULTS", from: "2026-08-01T00:00:00.000Z", to: "2026-08-03T00:00:00.000Z" };
const databaseRoot = resolve(import.meta.dirname, "../../packages/database");
const prismaCli = resolve(databaseRoot, "node_modules/prisma/build/index.js");
const containerName = `bet-stats-replay-${process.pid}`;
let databaseUrl = ""; let prisma: PrismaClient;
function docker(...args: string[]) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

describe("durable bounded replay", () => {
  beforeAll(async () => {
    docker("run", "--detach", "--name", containerName, "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=bet_stats", "--publish", "127.0.0.1::5432", "postgres:18-alpine");
    for (let attempt = 0; attempt < 60; attempt += 1) { try { docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "bet_stats"); break; } catch (error) { if (attempt === 59) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); } }
    const port = docker("port", containerName, "5432/tcp").split(":").at(-1); if (!port) throw new Error("PostgreSQL port missing");
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/bet_stats`;
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
    prisma = createPrismaClient(databaseUrl);
  }, 120_000);
  afterAll(async () => { await prisma?.$disconnect(); try { docker("rm", "--force", containerName); } catch { /* best effort */ } });

  it("freezes preview/version and loads them after service reconstruction", async () => {
    const first = createReplayService({ database: prisma, actor: "operator-a" });
    const preview = await first.preview(request);
    expect(preview).toMatchObject({ dryRun: true, bounded: true, calls: 3, builds: 3 });
    const restartedDatabase = createPrismaClient(databaseUrl);
    const restarted = createReplayService({ database: restartedDatabase, actor: "operator-a" });
    expect(await restarted.preview(request)).toEqual(preview);
    await expect(restarted.queue({ previewId: preview.previewId, previewVersion: "stale" })).rejects.toMatchObject({ code: "STALE_PREVIEW", status: 409 });
    await restartedDatabase.$disconnect();
  });

  it("atomically creates versioned runs, consumes once, and reconstructs status", async () => {
    const service = createReplayService({ database: prisma, actor: "operator-b" });
    const preview = await service.preview({ ...request, from: "2026-08-05T00:00:00.000Z", to: "2026-08-06T00:00:00.000Z" });
    const queued = await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion });
    expect(queued).toMatchObject({ queued: true, duplicate: false, revision: 1 });
    expect(await service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion })).toMatchObject({ queued: false, duplicate: true, replayPlanId: queued.replayPlanId });
    expect(await prisma.replayPlan.count({ where: { id: queued.replayPlanId } })).toBe(1);
    expect(await prisma.syncRun.count({ where: { replayPlanId: queued.replayPlanId } })).toBe(2);
    expect(await createReplayService({ database: prisma }).status(queued.replayPlanId)).toMatchObject({ state: "QUEUED", outcome: "PENDING", runs: [{ state: "PENDING" }, { state: "PENDING" }] });
  });

  it("requires audited reason and rejects zero headroom", async () => {
    await expect(createReplayService({ database: prisma, availableCalls: 0 }).preview({ ...request, from: "2026-08-10T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z" })).rejects.toMatchObject({ code: "NO_HEADROOM" });
    const service = createReplayService({ database: prisma });
    const preview = await service.preview({ ...request, from: "2026-08-11T00:00:00.000Z", to: "2026-08-11T00:00:00.000Z" });
    await expect(service.queue({ previewId: preview.previewId, previewVersion: preview.previewVersion, newRevision: true, reason: "" })).rejects.toMatchObject({ code: "REVISION_REASON_REQUIRED" });
  });
});
