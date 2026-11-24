import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@bet-stats/database";
import { CALIBRATION_CONFIG, forecastConfigHashFor, MODEL_VERSIONS } from "@bet-stats/domain";

import {
  calibrationIdentities,
  calibrationJobId,
  calibrationQueue,
  createCalibrationProcessor,
  scheduleCalibrationTick,
  type CalibrationJobData,
} from "../../workers/data-sync/src/jobs/calibration.js";
import { startCalibrationRuntime } from "../../workers/data-sync/src/main.js";

const DC = { modelVersion: "dixon-coles-ensemble-v1", configHash: forecastConfigHashFor("dixon-coles-ensemble-v1") } as const;
const V1 = { modelVersion: "poisson-ensemble-v1", configHash: forecastConfigHashFor("poisson-ensemble-v1") } as const;
const DAY_MS = 86_400_000;
const MAX_TIMER = 2 ** 31 - 1;

/** Fake timers: the scheduler arms one timer at a time; the test fires it explicitly. */
function fakeTimers(start: Date = new Date("2026-11-24T10:00:00.000Z")) {
  let clock = start.getTime();
  let nextId = 1;
  const armed = new Map<number, { callback: () => void; delay: number }>();
  const setTimeoutFake = ((callback: () => void, delay: number) => {
    const id = nextId;
    nextId += 1;
    armed.set(id, { callback, delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  const clearTimeoutFake = (timer: ReturnType<typeof setTimeout>) => { armed.delete(timer as unknown as number); };
  const only = (): { callback: () => void; delay: number } => {
    expect(armed.size).toBe(1);
    return [...armed.values()][0]!;
  };
  const now = (): Date => new Date(clock);
  /** Fires the armed timer after letting its delay elapse on the fake clock. */
  const fire = async (): Promise<void> => {
    const [id, timer] = [...armed.entries()][0]!;
    armed.delete(id);
    clock += timer.delay;
    timer.callback();
    // The tick is asynchronous (enqueue promises): let the microtask queue drain.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  };
  return { setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, armed, only, fire, now };
}

describe("calibration queue name and job id", () => {
  it("names the queue with the prefix and rejects unsupported prefix characters", () => {
    expect(calibrationQueue()).toBe("bet-stats-calibration");
    expect(calibrationQueue("custom_1-x")).toBe("custom_1-x-calibration");
    expect(() => calibrationQueue("bad:prefix")).toThrow("Queue prefix contains unsupported characters");
    expect(() => calibrationQueue("bad prefix")).toThrow("Queue prefix contains unsupported characters");
  });

  it("is deterministic, colon-free, equal within a UTC day and different across day, model and config hash", () => {
    const morning = calibrationJobId({ ...DC, asOf: "2026-11-24T00:00:01.000Z" });
    const evening = calibrationJobId({ ...DC, asOf: "2026-11-24T23:59:59.999Z" });
    expect(morning).toBe(evening);
    expect(morning).not.toContain(":");
    expect(morning).toContain(DC.modelVersion);
    expect(morning).toContain("2026-11-24");
    expect(morning).toContain(DC.configHash.slice("sha256:".length, "sha256:".length + 12));
    expect(calibrationJobId({ ...DC, asOf: "2026-11-25T00:00:00.000Z" })).not.toBe(morning);
    expect(calibrationJobId({ ...V1, asOf: "2026-11-24T10:00:00.000Z" })).not.toBe(morning);
    expect(calibrationJobId({ modelVersion: DC.modelVersion, configHash: `sha256:${"f".repeat(64)}`, asOf: "2026-11-24T10:00:00.000Z" })).not.toBe(morning);
    expect(() => calibrationJobId({ ...DC, asOf: "yesterday" })).toThrow();
  });

  it("knows both model versions with their own config hash", () => {
    const identities = calibrationIdentities();
    expect(identities.map((identity) => identity.modelVersion)).toEqual([...MODEL_VERSIONS]);
    for (const identity of identities) expect(identity.configHash).toBe(forecastConfigHashFor(identity.modelVersion));
  });
});

describe("calibration worker processor", () => {
  const job = (data: unknown) => ({ data }) as { data: CalibrationJobData };

  it("rejects an incomplete payload without retries", async () => {
    const execute = vi.fn();
    const process = createCalibrationProcessor(execute);
    for (const payload of [undefined, null, {}, { modelVersion: DC.modelVersion }, { ...DC }, { ...DC, asOf: 12 }, { ...DC, asOf: "not a date" }, { modelVersion: 1, configHash: DC.configHash, asOf: "2026-11-24T00:00:00.000Z" }]) {
      const error = await process(job(payload)).catch((caught: unknown) => caught);
      expect((error as Error).name, JSON.stringify(payload)).toBe("UnrecoverableError");
      expect((error as Error).message).toBe("INVALID_CALIBRATION_JOB");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a foreign identity without retries and before executing", async () => {
    const execute = vi.fn();
    const process = createCalibrationProcessor(execute);
    const asOf = "2026-11-24T00:00:00.000Z";
    for (const payload of [{ modelVersion: "unknown-model", configHash: DC.configHash, asOf }, { modelVersion: DC.modelVersion, configHash: V1.configHash, asOf }, { modelVersion: DC.modelVersion, configHash: `sha256:${"0".repeat(64)}`, asOf }]) {
      const error = await process(job(payload)).catch((caught: unknown) => caught);
      expect((error as Error).name).toBe("UnrecoverableError");
      expect((error as Error).message).toBe("CALIBRATION_IDENTITY_INVALID");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a correct payload once and returns its result", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const process = createCalibrationProcessor(execute);
    const data = { ...DC, asOf: "2026-11-24T00:00:00.000Z" };
    await expect(process(job(data))).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(data);
  });
});

describe("calibration daily tick", () => {
  const START = new Date("2026-11-24T10:00:00.000Z");

  it("queues one job per known identity, then repeats at the configured interval", async () => {
    const timers = fakeTimers(START);
    const enqueue = vi.fn(async (data: CalibrationJobData) => data);
    const scheduler = scheduleCalibrationTick({ enqueue, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, startDelayMs: 1_000 });
    expect(timers.only().delay).toBe(1_000);

    await timers.fire();
    const firstAsOf = new Date(START.getTime() + 1_000).toISOString();
    expect(enqueue.mock.calls.map(([data]) => data)).toEqual(calibrationIdentities().map((identity) => ({ ...identity, asOf: firstAsOf })));
    // The next tick is one configured interval away.
    const intervalMs = CALIBRATION_CONFIG.cadence.intervalHours * 3_600_000;
    expect(intervalMs).toBe(DAY_MS);
    expect(timers.only().delay).toBe(intervalMs);

    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(2 * calibrationIdentities().length);
    expect(enqueue.mock.calls.at(-1)![0].asOf).toBe(new Date(START.getTime() + 1_000 + intervalMs).toISOString());
    scheduler.close();
  });

  it("reports an enqueue failure to onError, still tries every identity, and retries after retryMs", async () => {
    const timers = fakeTimers(START);
    const onError = vi.fn();
    const enqueue = vi.fn(async (data: CalibrationJobData) => {
      if (data.modelVersion === calibrationIdentities()[0]!.modelVersion) throw new Error("QUEUE_DOWN");
      return data;
    });
    const scheduler = scheduleCalibrationTick({ enqueue, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, onError, startDelayMs: 0, retryMs: 5_000 });
    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(calibrationIdentities().length);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe("QUEUE_DOWN");
    expect(timers.only().delay).toBe(5_000);
    scheduler.close();
  });

  it("close() stops the timers", () => {
    const timers = fakeTimers(START);
    const enqueue = vi.fn(async () => undefined);
    const scheduler = scheduleCalibrationTick({ enqueue, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, startDelayMs: 10 });
    expect(timers.armed.size).toBe(1);
    scheduler.close();
    expect(timers.armed.size).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never arms a timer longer than 2^31-1 ms and does not fire early after a clamped wait", async () => {
    const timers = fakeTimers(START);
    const enqueue = vi.fn(async (data: CalibrationJobData) => data);
    const scheduler = scheduleCalibrationTick({ enqueue, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, startDelayMs: 0, intervalMs: MAX_TIMER * 3 });
    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(calibrationIdentities().length);
    expect(timers.only().delay).toBe(MAX_TIMER);
    // The clamped wait elapsed but the interval did not: re-arm instead of enqueueing early.
    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(calibrationIdentities().length);
    expect(timers.only().delay).toBe(MAX_TIMER);
    await timers.fire();
    expect(timers.only().delay).toBeLessThanOrEqual(MAX_TIMER);
    // After three clamped waits the interval is due: the next fire enqueues.
    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(2 * calibrationIdentities().length);
    scheduler.close();
  });
});

describe("calibration job module boundaries", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../../workers/data-sync/src/jobs/calibration.ts"), "utf8");
  const code = source.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

  it("does not reach data providers, the network or football-data", () => {
    expect(code).not.toMatch(/@bet-stats\/football-data/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/api-?football|football-?data\.org|football_data|undici|axios|node:https?|node-fetch|XMLHttpRequest/i);
    expect(code).not.toMatch(/FOOTBALL_DATA_API_TOKEN|API_FOOTBALL_API_KEY/);
  });

  it("contains no policy literal of its own: thresholds come from the config and the pure policy", () => {
    expect(code).toContain("decideCalibrationLifecycle");
    expect(code).not.toMatch(/\b0\.002\b|\b300\b|\b1500\b|\bconsecutiveWorse\s*[=:]\s*[0-9]|minimumSamples\s*[=:]\s*\{/);
  });

  it("does not write to the frozen tables", () => {
    expect(code).not.toMatch(/forecastSnapshot|forecastMarket|settlementReceipt|forecastScore|valueReceipt|valueSettlement/);
  });
});

describe("calibration runtime", () => {
  it("arms a tick with injected dependencies, queues the identities and leaves caller-owned dependencies open on close", async () => {
    const timers = fakeTimers();
    const enqueue = vi.fn(async (data: CalibrationJobData) => data);
    const queueClose = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const database = { $disconnect: disconnect } as unknown as PrismaClient;
    const log = vi.fn();
    const runtime = startCalibrationRuntime({
      databaseUrl: "postgresql://unused", redisUrl: "redis://unused", log,
      dependencies: { database, queue: { enqueue, close: queueClose } },
      setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, now: timers.now,
    });
    expect(runtime).toBeDefined();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "calibration.armed", queue: "bet-stats-calibration", identities: calibrationIdentities().length }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgresql:\/\/|redis:\/\//);

    await timers.fire();
    expect(enqueue).toHaveBeenCalledTimes(calibrationIdentities().length);

    await runtime.close();
    expect(timers.armed.size).toBe(0);
    expect(queueClose).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("is wired into start() inside the existing configuration check and closed with the other runtimes", () => {
    const main = readFileSync(resolve(import.meta.dirname, "../../workers/data-sync/src/main.ts"), "utf8");
    expect(main.match(/startCalibrationRuntime/g)!.length).toBeGreaterThanOrEqual(2);
    const startBody = main.slice(main.indexOf("function start()"));
    expect(startBody).toMatch(/if \(config\.DATABASE_URL && config\.REDIS_URL/);
    expect(startBody.indexOf("startCalibrationRuntime")).toBeGreaterThan(startBody.indexOf("if (config.DATABASE_URL"));
    expect(startBody).toMatch(/calibrationRuntime\?\.close\(\)/);
  });
});
