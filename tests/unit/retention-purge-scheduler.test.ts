import { describe, expect, it } from "vitest";

import { scheduleRetentionPurge } from "../../workers/data-sync/src/jobs/retention-purge.js";

describe("retention purge scheduler", () => {
  const maxTimerDelay = 2 ** 31 - 1;

  it("arms the next purge at the earliest persisted expiry rather than a daily interval", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const delays: number[] = [];
    let callback: (() => void) | undefined;
    let minimumQueries = 0;
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (strings.join("").includes('SELECT min("expiresAt")')) {
          minimumQueries += 1;
          return [{ expiresAt: minimumQueries === 1 ? new Date("2026-09-24T12:00:00.250Z") : null }];
        }
        return [{ oddsDeleted: 0, viewsDeleted: 1 }];
      },
    };

    const scheduler = scheduleRetentionPurge({
      database: database as never,
      now: () => now,
      idlePollMs: 1_000,
      setTimeout: (next, delay) => { callback = next; delays.push(delay); return 1 as never; },
      clearTimeout: () => undefined,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([250]);

    callback?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(delays).toEqual([250, 1_000]);
    scheduler.close();
  });

  it("retries after a transient re-arm query failure and resumes purging", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const errors: unknown[] = [];
    let minimumQueries = 0;
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (strings.join("").includes('SELECT min("expiresAt")')) {
          minimumQueries += 1;
          if (minimumQueries === 2) throw new Error("transient postgres outage");
          return [{ expiresAt: minimumQueries === 1 ? new Date("2026-09-24T12:00:00.001Z") : null }];
        }
        return [{ oddsDeleted: 1, viewsDeleted: 0 }];
      },
    };
    const scheduler = scheduleRetentionPurge({ database: database as never, now: () => now, retryMs: 25, setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; }, clearTimeout: () => undefined, onError: (error) => errors.push(error) });
    await new Promise((resolve) => setImmediate(resolve));
    timers[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveLength(1); expect(timers.map((timer) => timer.delay)).toEqual([1, 25]);
    timers[1]?.callback();
    await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve));
    expect(timers.map((timer) => timer.delay)).toEqual([1, 25, 1_000]);
    scheduler.close();
  });

  it("bounds long expiries and recomputes their remaining delay after each wake", async () => {
    let currentTime = new Date("2026-09-24T12:00:00.000Z");
    const expiry = new Date(currentTime.getTime() + maxTimerDelay + 250);
    const timers: Array<{ callback: () => void; delay: number }> = [];
    let minimumQueries = 0;
    let purges = 0;
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (strings.join("").includes('SELECT min("expiresAt")')) {
          minimumQueries += 1;
          return [{ expiresAt: minimumQueries <= 2 ? expiry : null }];
        }
        purges += 1;
        return [{ oddsDeleted: 0, viewsDeleted: 0 }];
      },
    };
    const scheduler = scheduleRetentionPurge({
      database: database as never,
      now: () => currentTime,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.map((timer) => timer.delay)).toEqual([maxTimerDelay]);

    currentTime = new Date(currentTime.getTime() + maxTimerDelay);
    timers[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.map((timer) => timer.delay)).toEqual([maxTimerDelay, 250]);
    expect(minimumQueries).toBe(2);

    currentTime = new Date(currentTime.getTime() + 250);
    timers[1]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(purges).toBe(2);
    expect(timers.map((timer) => timer.delay)).toEqual([maxTimerDelay, 250, 1_000]);
    scheduler.close();
  });

  it("retries a failed initial expiry query and arms from the successful retry", async () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const timers: Array<{ callback: () => void; delay: number }> = [];
    const errors: unknown[] = [];
    let minimumQueries = 0;
    let purges = 0;
    const database = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        if (strings.join("").includes('SELECT min("expiresAt")')) {
          minimumQueries += 1;
          if (minimumQueries === 1) throw new Error("transient postgres outage");
          return [{ expiresAt: new Date(now.getTime() + 40) }];
        }
        purges += 1;
        return [{ oddsDeleted: 0, viewsDeleted: 0 }];
      },
    };
    const scheduler = scheduleRetentionPurge({
      database: database as never,
      now: () => now,
      retryMs: 25,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
      onError: (error) => errors.push(error),
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveLength(1);
    expect(timers.map((timer) => timer.delay)).toEqual([25]);

    timers[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(minimumQueries).toBe(2);
    expect(purges).toBe(0);
    expect(timers.map((timer) => timer.delay)).toEqual([25, 40]);
    scheduler.close();
  });

  it("does not query again when closed while an initial-query retry is pending", async () => {
    const timers: Array<{ callback: () => void; delay: number }> = [];
    let minimumQueries = 0;
    const database = {
      $queryRaw: async () => {
        minimumQueries += 1;
        throw new Error("transient postgres outage");
      },
    };
    const scheduler = scheduleRetentionPurge({
      database: database as never,
      retryMs: 25,
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length as never; },
      clearTimeout: () => undefined,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.map((timer) => timer.delay)).toEqual([25]);
    scheduler.close();

    timers[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(minimumQueries).toBe(1);
    expect(timers).toHaveLength(1);
  });
});
