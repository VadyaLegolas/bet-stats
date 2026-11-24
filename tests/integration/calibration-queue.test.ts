import { execFileSync } from "node:child_process";

import { Queue } from "../../workers/data-sync/node_modules/bullmq/dist/esm/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { forecastConfigHashFor } from "@bet-stats/domain";

import { calibrationJobId, calibrationQueue, createCalibrationQueue, createCalibrationWorker, type CalibrationJobData } from "../../workers/data-sync/src/jobs/calibration.js";

const container = `bet-stats-calibration-redis-${process.pid}`;
const prefix = `cal-${process.pid}`;
let redisUrl = "";
let inspector: Queue;
let queue: ReturnType<typeof createCalibrationQueue>;
let worker: ReturnType<typeof createCalibrationWorker>;
const execute = vi.fn(async (data: CalibrationJobData) => ({ ran: data.modelVersion }));

const DC = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") } as const;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeAll(async () => {
  docker("run", "--detach", "--name", container, "--publish", "127.0.0.1::6379", "redis:8-alpine");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if (docker("exec", container, "redis-cli", "ping") === "PONG") break; } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const port = docker("port", container, "6379/tcp").split(/\r?\n/)[0]!.split(":").at(-1);
  redisUrl = `redis://127.0.0.1:${port}`;
  inspector = new Queue(calibrationQueue(prefix), { connection: { url: redisUrl, maxRetriesPerRequest: null } });
  queue = createCalibrationQueue({ redisUrl, prefix });
  worker = createCalibrationWorker({ redisUrl, prefix, execute });
}, 120_000);

afterAll(async () => {
  await worker?.close();
  await queue?.close();
  await inspector?.close();
  try { docker("rm", "--force", "--volumes", container); } catch { /* owned cleanup */ }
});

describe("calibration queue on a real BullMQ and Redis", () => {
  it("two enqueues with one deterministic id give one job, executed exactly once", async () => {
    const data = { ...DC, asOf: "2026-11-24T10:00:00.000Z" };
    const first = await queue.enqueue(data);
    const second = await queue.enqueue({ ...data, asOf: "2026-11-24T21:30:00.000Z" });
    expect(first.id).toBe(calibrationJobId(data));
    expect(second.id).toBe(first.id);
    expect(await inspector.getJobCountByTypes("waiting", "active", "completed", "delayed", "failed")).toBe(1);

    await waitFor(async () => ((await inspector.getJob(first.id!))?.finishedOn ? true : undefined), "the job to finish");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(data);
    expect(await (await inspector.getJob(first.id!))!.getState()).toBe("completed");
    // A later enqueue of the same day does not run it again.
    await queue.enqueue({ ...data, asOf: "2026-11-24T23:00:00.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(execute).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("a job with a foreign identity fails once, with one attempt and no retry", async () => {
    const before = execute.mock.calls.length;
    const data = { modelVersion: "unknown-model", configHash: DC.configHash, asOf: "2026-11-25T10:00:00.000Z" };
    const job = await queue.enqueue(data);
    await waitFor(async () => {
      const current = await inspector.getJob(job.id!);
      return current && (await current.getState()) === "failed" ? true : undefined;
    }, "the job to fail");
    const failed = (await inspector.getJob(job.id!))!;
    expect(failed.attemptsMade).toBe(1);
    expect(failed.opts.attempts).toBeGreaterThan(1);
    expect(failed.failedReason).toBe("CALIBRATION_IDENTITY_INVALID");
    expect(execute.mock.calls.length).toBe(before);
  }, 60_000);

  it("a malformed payload fails once with INVALID_CALIBRATION_JOB", async () => {
    const job = await queue.enqueue({ ...DC, asOf: "not a date" } as CalibrationJobData).catch((error: unknown) => error);
    // The deterministic id needs a valid day, so the queue refuses before Redis; a payload damaged inside Redis is covered below.
    expect(job).toBeInstanceOf(Error);
    const raw = await inspector.add("calibration", { modelVersion: DC.modelVersion } as never, { attempts: 3, jobId: `damaged-${process.pid}` });
    await waitFor(async () => {
      const current = await inspector.getJob(raw.id!);
      return current && (await current.getState()) === "failed" ? true : undefined;
    }, "the damaged job to fail");
    const failed = (await inspector.getJob(raw.id!))!;
    expect(failed.failedReason).toBe("INVALID_CALIBRATION_JOB");
    expect(failed.attemptsMade).toBe(1);
  }, 60_000);

  it("keeps the retry options of the neighbouring queues for a correct job", async () => {
    const job = await queue.enqueue({ ...DC, asOf: "2026-11-26T10:00:00.000Z" });
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toMatchObject({ type: "exponential", delay: 1_000 });
    expect(job.opts.removeOnComplete).toEqual({ age: 86_400, count: 1_000 });
    expect(job.opts.removeOnFail).toEqual({ age: 604_800, count: 5_000 });
  }, 30_000);
});
