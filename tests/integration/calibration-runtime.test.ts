import { execFileSync } from "node:child_process";

import { Queue } from "../../workers/data-sync/node_modules/bullmq/dist/esm/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, type PrismaClient } from "@bet-stats/database";
import { forecastConfigHashFor } from "@bet-stats/domain";

import { calibrationJobId, calibrationQueue } from "../../workers/data-sync/src/jobs/calibration.js";
import { startCalibrationRuntime } from "../../workers/data-sync/src/main.js";
import { migrateDeploy, startPostgres, type TestPostgres } from "../helpers/calibration-db.js";
import { MS_DAY, seedMatches } from "../helpers/calibration-job-seed.js";
import { seedBase } from "../helpers/calibration-fit-seed.js";

/**
 * WR-09: the production branch of `startCalibrationRuntime` (no injected dependencies) on a real BullMQ/Redis and a real
 * PostgreSQL: the tick enqueues, the worker created by the runtime takes the job and its `execute` callback calls
 * `runCalibrationJob` with the right identity. Injected-dependency tests never execute that callback.
 */

const DC_VERSION = "dixon-coles-ensemble-v1";
const DC_HASH = forecastConfigHashFor(DC_VERSION);
const V1_VERSION = "poisson-ensemble-v1";
const V1_HASH = forecastConfigHashFor(V1_VERSION);
const prefix = `calrt-${process.pid}`;
const redisContainer = `bet-stats-calibration-runtime-redis-${process.pid}`;

let server: TestPostgres;
let client: PrismaClient;
let redisUrl = "";
let inspector: Queue;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function waitFor<T>(read: () => Promise<T | undefined>, what: string, attempts = 600): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeAll(async () => {
  server = startPostgres(`bet-stats-calibration-runtime-${process.pid}`);
  migrateDeploy(server.url());
  client = createPrismaClient(server.url());

  docker("run", "--detach", "--name", redisContainer, "--publish", "127.0.0.1::6379", "redis:8-alpine");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if (docker("exec", redisContainer, "redis-cli", "ping") === "PONG") break; } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  redisUrl = `redis://127.0.0.1:${docker("port", redisContainer, "6379/tcp").split(/\r?\n/)[0]!.split(":").at(-1)}`;
  inspector = new Queue(calibrationQueue(prefix), { connection: { url: redisUrl, maxRetriesPerRequest: null } });
}, 300_000);

afterAll(async () => {
  await inspector?.close();
  await client?.$disconnect();
  server?.remove();
  try { docker("rm", "--force", "--volumes", redisContainer); } catch { /* owned cleanup */ }
});

describe("startCalibrationRuntime without injected dependencies", () => {
  it("a tick queues the identities, the created worker runs runCalibrationJob for each and the calibrators are written", async () => {
    const base = await seedBase(client, "rt");
    const start = Date.parse("2026-01-01T12:00:00.000Z");
    const matches = await seedMatches(client, {
      prefix: "rt", count: 600, seed: 7, gamma: 2.5, startMs: start, indexOffset: 0, modelVersion: DC_VERSION, configHash: DC_HASH,
      leagueId: base.leagueId, seasonId: base.seasonId, homeTeamId: base.homeId, awayTeamId: base.awayId,
    });
    const asOfMs = matches[matches.length - 1]!.kickoff.getTime() + MS_DAY;

    // The tick is driven by hand: a fake clock and a captured timer callback; everything else (queue, worker, database) is real.
    let clock = asOfMs;
    const timers: Array<() => void> = [];
    const logs: Array<Record<string, unknown>> = [];
    const runtime = startCalibrationRuntime({
      databaseUrl: server.url(), redisUrl, prefix, log: (event) => logs.push(event),
      now: () => new Date(clock),
      setTimeout: (callback) => { timers.push(callback); return 0 as unknown as ReturnType<typeof setTimeout>; },
      clearTimeout: () => undefined,
    });
    try {
      expect(logs.some((entry) => entry.event === "calibration.armed")).toBe(true);
      clock += 5_000;
      timers.shift()!();

      const asOf = new Date(asOfMs + 5_000).toISOString();
      const dcJobId = calibrationJobId({ modelVersion: DC_VERSION, configHash: DC_HASH, asOf });
      const v1JobId = calibrationJobId({ modelVersion: V1_VERSION, configHash: V1_HASH, asOf });
      const finished = async (id: string) => {
        const job = await inspector.getJob(id);
        const state = job ? await job.getState() : undefined;
        if (state === "failed") throw new Error(`job ${id} failed: ${job!.failedReason}`);
        return state === "completed" ? job : undefined;
      };
      const dcJob = await waitFor(() => finished(dcJobId), "the Dixon-Coles job to complete");
      const v1Job = await waitFor(() => finished(v1JobId), "the Poisson job to complete");

      // The callback passed the right identity: both pairs were accepted, the DC one fitted and promoted all three markets.
      const dcReceipt = dcJob.returnvalue as { identity: { modelVersion: string; configHash: string }; markets: Record<string, { actions: Array<{ type: string }>; data: { state: string } }> };
      expect(dcReceipt.identity).toEqual({ modelVersion: DC_VERSION, configHash: DC_HASH });
      for (const market of ["ONE_X_TWO", "OVER_UNDER_2_5", "BTTS"]) {
        expect(dcReceipt.markets[market]!.data.state).toBe("READY");
        expect(dcReceipt.markets[market]!.actions.map((action) => action.type)).toEqual(["PROMOTE"]);
      }
      expect((v1Job.returnvalue as { identity: { modelVersion: string } }).identity.modelVersion).toBe(V1_VERSION);
      expect((v1Job.returnvalue as { markets: Record<string, { data: { state: string } }> }).markets.ONE_X_TWO!.data.state).toBe("INSUFFICIENT_DATA");

      expect(server.lines(`SELECT "modelVersion" || '|' || count(*) FROM "Calibrator" GROUP BY "modelVersion";`)).toEqual([`${DC_VERSION}|3`]);
      expect(server.lines(`SELECT type || '|' || count(*) FROM "CalibratorEvent" GROUP BY type;`)).toEqual(["PROMOTED|3"]);
      expect(logs.filter((entry) => entry.event === "calibration.job.completed")).toHaveLength(2);
      expect(JSON.stringify(logs)).not.toMatch(/postgres(ql)?:\/\/|redis:\/\//);
    } finally {
      await runtime.close();
    }
  }, 300_000);
});
